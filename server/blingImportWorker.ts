// Background import/sync for Bling ERP (API v3). A server-side worker paginates
// the Bling catalog in slices, writing products straight to Firestore, so the
// import survives the browser tab closing and can run on a recurring schedule.
// Mirrors server/tinyImportWorker.ts (in-process setInterval scheduler + a
// secret-gated /api/bling/cron/tick backstop for Cloud Scheduler). Unlike Tiny,
// there is no version/provider layer — it lists/gets straight from the v3 client.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { PACE_MS, sleep, blingFetch, normalizeProduct, type BlingNormalizedProduct } from './blingAgent';
import { recordEvent } from './crmEvents';

const JOB_COL = 'bling_import_jobs';
const JOB_REF = (uid: string) => adminDb.collection(JOB_COL).doc(uid);
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

const PAGE_LIMIT = 100;         // Bling max page size
const LEASE_MS = 120_000;
const MAX_PRODUCTS_PER_JOB = 200_000;
const TICK_MS = 20_000;
const BUDGET_MS = 90_000;
const AUTOSYNC_SWEEP_MS = 60 * 60 * 1000;
// Optional Bling query param name for the "update" date filter. Left empty by
// default (update paginates the full catalog and relies on idempotent upsert);
// set BLING_UPDATE_DATE_PARAM once the exact filter is confirmed via OpenAPI.
const UPDATE_DATE_PARAM = process.env.BLING_UPDATE_DATE_PARAM ?? '';

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

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

// Writes one normalized product to Firestore. Source fields always update;
// enriched fields (description/SEO) only fill when empty, preserving local work.
// Uses the SAME column keys as the Tiny importer. Returns the Firestore doc id.
export async function upsertProduct(uid: string, b: BlingNormalizedProduct, source = 'bling-bg-import'): Promise<string> {
  const existingSnap = await PRODUCTS(uid).where('_blingProductId', '==', b.blingId).limit(1).get();
  const existing = existingSnap.docs[0];
  const ref = existing ? existing.ref : PRODUCTS(uid).doc(`bling_${b.blingId}`);
  const cur: Record<string, any> = existing?.data() ?? {};

  const data: Record<string, any> = {
    'Código (SKU)': b.sku || undefined,
    'Descrição': b.nome || undefined,
    'Categoria': b.categorias[0] || undefined,
    'Preço': b.precoPor,
    'Preço promocional': b.precoDe,
    'GTIN/EAN': b.gtin || undefined,
    'NCM (Classificação fiscal)': b.ncm || undefined,
    'CEST': b.cest || undefined,
    'Peso líquido (Kg)': b.pesoLiquido,
    'Peso bruto (Kg)': b.pesoBruto,
    'Largura embalagem': b.largura,
    'Altura Embalagem': b.altura,
    'Comprimento embalagem': b.comprimento,
    'Marca': b.marca || undefined,
    _blingProductId: b.blingId,
    _blingDeleted: false,
    ownerId: uid,
    createdAt: cur.createdAt || iso(),
    updatedAt: iso(),
  };
  b.imagens.slice(0, 6).forEach((url, i) => { data[`URL imagem ${i + 1}`] = url; });

  const fillIfEmpty = (key: string, val?: string) => {
    if (val && !cur[key]) data[key] = val;
  };
  fillIfEmpty('Descrição complementar', b.descricaoHtml);
  fillIfEmpty('Título SEO', b.seoTitle);
  fillIfEmpty('Descrição SEO', b.seoDescription);
  fillIfEmpty('Palavras chave SEO', b.seoKeywords);

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('bling_versions').add({
    source,
    raw: b.raw && typeof b.raw === 'object' ? stripUndefined(b.raw as any) : null,
    importedAt: iso(),
  }).catch(() => { /* backup is best-effort */ });

  return ref.id;
}

// Lists one page of product ids from Bling v3.
async function blingListPage(
  uid: string,
  opts: { offset: number; mode: 'full' | 'update'; sinceISO?: string | null },
): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  const pagina = Math.floor(opts.offset / PAGE_LIMIT) + 1;
  const params = new URLSearchParams({ pagina: String(pagina), limite: String(PAGE_LIMIT) });
  if (opts.mode === 'update' && opts.sinceISO && UPDATE_DATE_PARAM) {
    params.set(UPDATE_DATE_PARAM, opts.sinceISO.slice(0, 10));
  }
  const page = await blingFetch<any>(uid, 'GET', `/produtos?${params.toString()}`);
  const arr: any[] = Array.isArray(page?.data) ? page.data : [];
  const items = arr.map((i) => ({ id: String(i.id) }));
  return { items, total: 0, done: items.length < PAGE_LIMIT };
}

async function processSlice(uid: string, job: Job): Promise<{ total: number; imported: number; newOffset: number; done: boolean }> {
  const { items, done } = await blingListPage(uid, { offset: job.offset, mode: job.mode, sinceISO: job.lastSyncAt });
  for (let i = 0; i < items.length; i++) {
    const detail = await blingFetch<any>(uid, 'GET', `/produtos/${items[i].id}`).catch(() => null);
    if (detail?.data) await upsertProduct(uid, normalizeProduct(detail.data));
    if (PACE_MS && i < items.length - 1) await sleep(PACE_MS);
  }
  const newOffset = job.offset + items.length;
  return { total: job.total || 0, imported: items.length, newOffset, done };
}

async function claimJob(uid: string): Promise<Job | null> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(JOB_REF(uid));
    const j = snap.data() as Job | undefined;
    if (!j || (j.status !== 'queued' && j.status !== 'running')) return null;
    const now = Date.now();
    if (j.lease && j.lease > now) return null;
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

  const secretSnap = await adminDb.collection('users').doc(uid).collection('integration_secrets').doc('bling').get();
  if (!secretSnap.exists) {
    await JOB_REF(uid).update({ status: 'error', error: 'Bling não conectado.', lease: null, updatedAt: iso() }).catch(() => {});
    return;
  }

  let job = claimed;
  const start = Date.now();
  try {
    while (true) {
      const { total, imported, newOffset, done } = await processSlice(uid, job);
      const nextImported = (job.imported ?? 0) + imported;

      const capped = newOffset >= MAX_PRODUCTS_PER_JOB;
      if (capped) console.warn(`[bling] job ${uid} atingiu o limite de ${MAX_PRODUCTS_PER_JOB} produtos; encerrando.`);

      if (done || capped) {
        await JOB_REF(uid).update({
          status: 'done', offset: newOffset, total, imported: nextImported,
          finishedAt: iso(), lastSyncAt: iso(), lease: null, updatedAt: iso(), error: null,
        });
        // Marca a jornada de ativação do CRM: importar do ERP conta como
        // "Subiu Produtos". Nunca await — telemetria não segura o worker.
        void recordEvent(uid, 'erp_import', { provider: 'bling', product_count: nextImported });
        return;
      }

      const fresh = (await JOB_REF(uid).get()).data() as Job | undefined;
      if (fresh?.status === 'canceled') {
        await JOB_REF(uid).update({ lease: null, updatedAt: iso() });
        return;
      }

      job = { ...job, offset: newOffset, imported: nextImported, total };

      if (Date.now() - start > BUDGET_MS) {
        await JOB_REF(uid).update({ offset: newOffset, total, imported: nextImported, lease: null, updatedAt: iso() });
        return;
      }
      await JOB_REF(uid).update({ offset: newOffset, total, imported: nextImported, lease: Date.now() + LEASE_MS, updatedAt: iso() });
    }
  } catch (e: any) {
    await JOB_REF(uid).update({
      status: 'error', error: e?.message ?? 'Falha na importação em background.', lease: null, updatedAt: iso(),
    }).catch(() => {});
  }
}

let nextSweepAt = 0;

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
      await sweepAutoSync().catch((e) => console.warn('[bling] sweepAutoSync falhou:', e?.message));
    }
    const snap = await adminDb.collection(JOB_COL).where('status', 'in', ['queued', 'running']).get();
    for (const doc of snap.docs) {
      await processJob(doc.id).catch((e) => console.warn(`[bling] processJob ${doc.id} falhou:`, e?.message));
    }
  } finally {
    isTicking = false;
  }
}

export function startBlingScheduler(): void {
  setInterval(() => { tick().catch((e) => console.warn('[bling] tick falhou:', e?.message)); }, TICK_MS);
  console.log('[bling] scheduler de importação iniciado');
}

// --- Routes ----------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const CRON_SECRET = process.env.BLING_CRON_SECRET || process.env.CONTENT_CRON_SECRET || '';

function publicJob(j: Job | undefined) {
  if (!j) return { status: 'idle', mode: 'full', offset: 0, total: 0, imported: 0, lastSyncAt: null, autoSync: { enabled: false, everyHours: 24 } };
  return {
    status: j.status, mode: j.mode, offset: j.offset ?? 0, total: j.total ?? 0,
    imported: j.imported ?? 0, lastSyncAt: j.lastSyncAt ?? null,
    error: (j as any).error ?? null,
    autoSync: j.autoSync ?? { enabled: false, everyHours: 24 },
  };
}

export function registerBlingImportRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/bling/import/start', async (req, res) => {
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
        lastSyncAt: cur?.lastSyncAt ?? null,
        autoSync: cur?.autoSync ?? { enabled: false, everyHours: 24 },
      };
      await JOB_REF(uid).set({ ...job, error: null, updatedAt: iso() }, { merge: true });
      tick().catch(() => {});
      return res.json({ job: publicJob({ ...(cur ?? {} as Job), ...job } as Job) });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao iniciar importação.' });
    }
  });

  app.get('/api/bling/import/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await JOB_REF(uid).get();
      return res.json({ job: publicJob(snap.data() as Job | undefined) });
    } catch (e: any) {
      return res.status(401).json({ message: e?.message });
    }
  });

  app.post('/api/bling/import/cancel', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await JOB_REF(uid).set({ status: 'canceled', lease: null, updatedAt: iso() }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  app.post('/api/bling/import/autosync', async (req, res) => {
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

  app.post('/api/bling/cron/tick', async (req, res) => {
    if (!CRON_SECRET || req.headers['x-bling-cron-secret'] !== CRON_SECRET) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await tick().catch((e) => console.warn('[bling] cron tick falhou:', e?.message));
    return res.json({ ok: true });
  });
}
