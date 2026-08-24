// Background import/sync for IdWorks ERP. A server-side worker paginates the
// IdWorks catalog (GET /sku) in slices, writing products straight to
// Firestore, so the import survives the browser tab closing and can run on a
// recurring schedule.
//
// Mirrors tinyImportWorker.ts's control flow (lease claiming, tick/scheduler,
// "only fill empty local fields" merge policy, version-backup subcollection,
// autosync/cron backstop). The one structural difference: IdWorks has no
// OAuth / v2-v3 dispatch layer, so paging and detail-fetch call idworksFetch
// directly instead of going through a provider module.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { idworksFetch, normalizeProduct, STATUS_REF, type IdworksNormalizedProduct } from './idworksAgent';
import { recordEvent } from './crmEvents';

const JOB_COL = 'idworks_import_jobs';
const JOB_REF = (uid: string) => adminDb.collection(JOB_COL).doc(uid);
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

const LEASE_MS = 120_000;      // how long a claimed slice is reserved to one instance
const MAX_PRODUCTS_PER_JOB = 200_000; // safety cap against a non-terminating list/queue
const TICK_MS = 20_000;        // scheduler cadence
const BUDGET_MS = 90_000;      // max wall-time one claim keeps processing before releasing
const AUTOSYNC_SWEEP_MS = 60 * 60 * 1000; // check due auto-syncs hourly
const PAGE_SIZE = 500;         // GET /sku pages 500 records at a time

type JobStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';
interface Job {
  status: JobStatus;
  mode: 'full' | 'update';
  offset: number;
  total: number;
  imported: number;
  lease: number | null;
  lastSyncAt: string | null;
  startedAt?: string;
  autoSync?: { enabled: boolean; everyHours: number };
}

const iso = () => new Date().toISOString();

// --- Firestore product mapping ----------------------------------------------

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

// Writes one normalized product to Firestore. "Source" fields always update;
// enriched fields (description/SEO/fiscal/dimensions) only fill when empty,
// preserving local work. Returns the Firestore doc id.
export async function upsertProduct(uid: string, p: IdworksNormalizedProduct, source = 'idworks-bg-import'): Promise<string> {
  const existingSnap = await PRODUCTS(uid).where('_idworksProductId', '==', p.idworksId).limit(1).get();
  let existing = existingSnap.docs[0];
  if (!existing && p.sku) {
    const skuSnap = await PRODUCTS(uid).where('Código (SKU)', '==', p.sku).limit(1).get();
    existing = skuSnap.docs[0];
  }
  const ref = existing ? existing.ref : PRODUCTS(uid).doc(`idworks_${p.idworksId}`);
  const cur: Record<string, any> = existing?.data() ?? {};

  const data: Record<string, any> = {
    // Source-of-truth fields: always refreshed from IdWorks.
    _idworksProductId: p.idworksId,
    'Código (SKU)': p.sku || undefined,
    'Descrição': p.nome || undefined,
    'Código do pai': p.codigoPai || undefined,
    ownerId: uid,
    createdAt: cur.createdAt || iso(),
    updatedAt: iso(),
  };

  // Enriched fields: only fill when the current value is empty.
  const isEmpty = (v: any) => v === undefined || v === null || v === '';
  const fillIfEmpty = (key: string, val?: string | number) => {
    if (!isEmpty(val) && isEmpty(cur[key])) data[key] = val;
  };
  fillIfEmpty('Descrição complementar', p.descricaoHtml);
  fillIfEmpty('Título SEO', p.seoTitle);
  fillIfEmpty('Descrição SEO', p.seoDescription);
  fillIfEmpty('Palavras chave SEO', p.seoKeywords);
  fillIfEmpty('NCM (Classificação fiscal)', p.ncm);
  fillIfEmpty('CEST', p.cest);
  fillIfEmpty('GTIN/EAN', p.gtin);
  fillIfEmpty('Peso líquido (Kg)', p.pesoLiquido);
  fillIfEmpty('Peso bruto (Kg)', p.pesoBruto);
  fillIfEmpty('Largura embalagem', p.largura);
  fillIfEmpty('Altura Embalagem', p.altura);
  fillIfEmpty('Comprimento embalagem', p.comprimento);
  fillIfEmpty('Marca', p.marca);
  fillIfEmpty('Categoria', p.categorias[0]);

  // Images: don't clobber locally-generated ambient images — only fill when
  // there are no local images at all (same rule as Tiny).
  const hasLocalImages = [1, 2, 3, 4, 5, 6].some((i) => !isEmpty(cur[`URL imagem ${i}`]));
  if (!hasLocalImages) {
    p.imagens.slice(0, 6).forEach((url, i) => { data[`URL imagem ${i + 1}`] = url; });
  }

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('idworks_versions').add({
    source,
    at: FieldValue.serverTimestamp(),
    raw: p.raw,
  }).catch(() => { /* backup is best-effort */ });

  return ref.id;
}

// Pages GET /sku (500 records/page), filtering to sellable SKUs (IDTypeSku 3
// = Sku, 4 = Produto-pai com variação) — same recorte the Tiny import makes
// implicitly. No provider/version dispatch: IdWorks has a single auth model.
async function listPage(uid: string, offset: number, mode: 'full' | 'update', sinceISO?: string | null): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  const page = Math.floor(offset / PAGE_SIZE);
  const params = new URLSearchParams({ Page: String(page), Simple: '0' });
  if (mode === 'update' && sinceISO) params.set('SinceDateLastRecordModification', sinceISO);
  const items = await idworksFetch<any[]>(uid, 'GET', `/sku?${params.toString()}`);
  const filtered = (Array.isArray(items) ? items : []).filter((s) => s?.IDTypeSku === 3 || s?.IDTypeSku === 4);
  const ids = filtered.map((s) => ({ id: String(s.IDSku) }));
  return { items: ids, total: 0, done: ids.length < PAGE_SIZE };
}

// Processes one page of products: list, then fetch + normalize + upsert each detail.
async function processSlice(uid: string, job: Job): Promise<{ total: number; imported: number; newOffset: number; done: boolean }> {
  const { items, total, done } = await listPage(uid, job.offset, job.mode, job.lastSyncAt);

  for (const item of items) {
    const detail = await idworksFetch<any[]>(uid, 'GET', `/sku/${item.id}`).catch(() => null);
    if (detail) {
      const normalized = normalizeProduct(Array.isArray(detail) ? detail[0] : detail);
      await upsertProduct(uid, normalized);
    }
  }

  const newOffset = job.offset + items.length;
  return { total: total || job.total || 0, imported: items.length, newOffset, done };
}

// --- Lease + tick ------------------------------------------------------------

// Claims a job for this instance if it isn't leased by another. Returns the job
// snapshot to process, or null if nothing to claim.
async function claimJob(uid: string): Promise<Job | null> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(JOB_REF(uid));
    const j = snap.data() as Job | undefined;
    if (!j || (j.status !== 'queued' && j.status !== 'running')) return null;
    const now = Date.now();
    if (j.lease && j.lease > now) return null; // held by another instance
    tx.update(JOB_REF(uid), {
      status: 'running',
      lease: now + LEASE_MS,
      startedAt: j.startedAt ?? iso(),
      updatedAt: iso(),
    });
    return { ...j, status: 'running', offset: j.offset ?? 0, imported: j.imported ?? 0 };
  });
}

async function processJob(uid: string): Promise<void> {
  const claimed = await claimJob(uid);
  if (!claimed) return;

  const statusSnap = await STATUS_REF(uid).get();
  if (!statusSnap.data()?.connected) {
    await JOB_REF(uid).update({ status: 'error', error: 'IdWorks não conectado.', lease: null, updatedAt: iso() }).catch(() => {});
    return;
  }

  let job = claimed;
  const start = Date.now();
  try {
    while (true) {
      const { total, imported, newOffset, done } = await processSlice(uid, job);
      const nextImported = (job.imported ?? 0) + imported;

      // Safety valve: stop if the list/queue never terminates (e.g. a drained
      // queue that keeps returning records), so a job can't loop forever.
      const capped = newOffset >= MAX_PRODUCTS_PER_JOB;
      if (capped) console.warn(`[idworks] job ${uid} atingiu o limite de ${MAX_PRODUCTS_PER_JOB} produtos; encerrando.`);

      if (done || capped) {
        await JOB_REF(uid).update({
          status: 'done', offset: newOffset, total, imported: nextImported,
          finishedAt: iso(), lastSyncAt: iso(), lease: null, updatedAt: iso(), error: null,
        });
        // Marca a jornada de ativação do CRM: importar do ERP conta como
        // "Subiu Produtos". Nunca await — telemetria não segura o worker.
        void recordEvent(uid, 'erp_import', { provider: 'idworks', product_count: nextImported });
        return;
      }

      // Honor a cancellation requested mid-run.
      const fresh = (await JOB_REF(uid).get()).data() as Job | undefined;
      if (fresh?.status === 'canceled') {
        await JOB_REF(uid).update({ lease: null, updatedAt: iso() });
        return;
      }

      job = { ...job, offset: newOffset, imported: nextImported, total };

      if (Date.now() - start > BUDGET_MS) {
        // Release the lease; the next tick continues from the saved offset.
        await JOB_REF(uid).update({ offset: newOffset, total, imported: nextImported, lease: null, updatedAt: iso() });
        return;
      }
      // Renew the lease and keep going.
      await JOB_REF(uid).update({ offset: newOffset, total, imported: nextImported, lease: Date.now() + LEASE_MS, updatedAt: iso() });
    }
  } catch (e: any) {
    await JOB_REF(uid).update({
      status: 'error', error: e?.message ?? 'Falha na importação em background.', lease: null, updatedAt: iso(),
    }).catch(() => {});
  }
}

let nextSweepAt = 0;

// Enqueues an 'update' sync for jobs whose auto-sync interval is due.
async function sweepAutoSync(): Promise<void> {
  const snap = await adminDb.collection(JOB_COL).where('autoSync.enabled', '==', true).get();
  const now = Date.now();
  for (const doc of snap.docs) {
    const j = doc.data() as Job;
    if (j.status === 'running' || j.status === 'queued') continue;
    const everyMs = Math.max(1, j.autoSync?.everyHours ?? 24) * 60 * 60 * 1000;
    const last = j.lastSyncAt ? Date.parse(j.lastSyncAt) : 0;
    if (now - last >= everyMs) {
      await doc.ref.update({
        status: 'queued', mode: 'update', offset: 0, imported: 0, total: 0,
        lease: null, error: null, updatedAt: iso(),
      });
    }
  }
}

let isTicking = false;

export async function tick(): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    if (Date.now() >= nextSweepAt) {
      nextSweepAt = Date.now() + AUTOSYNC_SWEEP_MS;
      await sweepAutoSync().catch((e) => console.warn('[idworks] sweepAutoSync falhou:', e?.message));
    }
    const snap = await adminDb.collection(JOB_COL).where('status', 'in', ['queued', 'running']).get();
    for (const doc of snap.docs) {
      await processJob(doc.id).catch((e) => console.warn(`[idworks] processJob ${doc.id} falhou:`, e?.message));
    }
  } finally {
    isTicking = false;
  }
}

export function startIdworksScheduler(): void {
  // The warm instance (minInstances >= 1) keeps this timer alive; Cloud Scheduler
  // hitting /api/idworks/cron/tick is the production backstop.
  setInterval(() => { tick().catch((e) => console.warn('[idworks] tick falhou:', e?.message)); }, TICK_MS);
  console.log('[idworks] scheduler de importação iniciado');
}

// --- Routes ------------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const CRON_SECRET = process.env.IDWORKS_CRON_SECRET || process.env.CONTENT_CRON_SECRET || '';

function publicJob(j: Job | undefined) {
  if (!j) return { status: 'idle', mode: 'full', offset: 0, total: 0, imported: 0, lastSyncAt: null, autoSync: { enabled: false, everyHours: 24 } };
  return {
    status: j.status, mode: j.mode, offset: j.offset ?? 0, total: j.total ?? 0,
    imported: j.imported ?? 0, lastSyncAt: j.lastSyncAt ?? null,
    error: (j as any).error ?? null,
    autoSync: j.autoSync ?? { enabled: false, everyHours: 24 },
  };
}

export function registerIdworksImportRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/idworks/import/start', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const mode = req.body?.mode === 'update' ? 'update' : 'full';
      const snap = await JOB_REF(uid).get();
      const cur = snap.data() as Job | undefined;
      if (cur?.status === 'running' || cur?.status === 'queued') {
        return res.status(409).json({ message: 'Já existe uma importação em andamento.', job: publicJob(cur) });
      }
      const job: Partial<Job> = {
        status: 'queued', mode, offset: 0, imported: 0, total: 0, lease: null,
        startedAt: iso(),
        lastSyncAt: mode === 'update' ? (cur?.lastSyncAt ?? null) : (cur?.lastSyncAt ?? null),
        autoSync: cur?.autoSync ?? { enabled: false, everyHours: 24 },
      };
      await JOB_REF(uid).set({ ...job, error: null, updatedAt: iso() }, { merge: true });
      // Kick a tick so it starts promptly instead of waiting for the interval.
      tick().catch(() => {});
      return res.json({ job: publicJob({ ...(cur ?? {} as Job), ...job } as Job) });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao iniciar importação.' });
    }
  });

  app.get('/api/idworks/import/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await JOB_REF(uid).get();
      return res.json({ job: publicJob(snap.data() as Job | undefined) });
    } catch (e: any) {
      return res.status(401).json({ message: e?.message });
    }
  });

  app.post('/api/idworks/import/cancel', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await JOB_REF(uid).set({ status: 'canceled', lease: null, updatedAt: iso() }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  app.post('/api/idworks/import/autosync', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const enabled = !!req.body?.enabled;
      const everyHours = Math.min(Math.max(Number(req.body?.everyHours ?? 24), 1), 168);
      await JOB_REF(uid).set({ autoSync: { enabled, everyHours }, updatedAt: iso() }, { merge: true });
      return res.json({ ok: true, autoSync: { enabled, everyHours } });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  // Cloud Scheduler backstop — never gated by a user token.
  app.post('/api/idworks/cron/tick', async (req, res) => {
    if (!CRON_SECRET || req.headers['x-idworks-cron-secret'] !== CRON_SECRET) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await tick().catch((e) => console.warn('[idworks] cron tick falhou:', e?.message));
    return res.json({ ok: true });
  });
}
