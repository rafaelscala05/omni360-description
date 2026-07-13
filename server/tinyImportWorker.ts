// Background import/sync for Tiny ERP. A server-side worker paginates the Tiny
// catalog in slices, writing products straight to Firestore, so the import
// survives the browser tab closing and can run on a recurring schedule.
//
// Mirrors the in-process scheduler pattern of server/contentAgent.ts
// (startContentScheduler): setInterval(tick) on the warm App Hosting instance,
// plus POST /api/tiny/cron/tick (secret-gated) for Cloud Scheduler in production.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { tinyFetch, normalizeProduct, PACE_MS, sleep, type TinyNormalizedProduct } from './tinyAgent';

const JOB_COL = 'tiny_import_jobs';
const JOB_REF = (uid: string) => adminDb.collection(JOB_COL).doc(uid);
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

const PAGE_LIMIT = 50;
const LEASE_MS = 120_000;      // how long a claimed slice is reserved to one instance
const TICK_MS = 20_000;        // scheduler cadence
const BUDGET_MS = 90_000;      // max wall-time one claim keeps processing before releasing
const AUTOSYNC_SWEEP_MS = 60 * 60 * 1000; // check due auto-syncs hourly

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

// --- Firestore product mapping (server-side equivalent of App.handleTinyImport) --

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

// Writes one normalized product to Firestore. "Source" fields always update;
// enriched fields (description/SEO) only fill when empty, preserving local work.
async function upsertProduct(uid: string, t: TinyNormalizedProduct): Promise<void> {
  const existingSnap = await PRODUCTS(uid).where('_tinyProductId', '==', t.tinyId).limit(1).get();
  const existing = existingSnap.docs[0];
  const ref = existing ? existing.ref : PRODUCTS(uid).doc(`tiny_${t.tinyId}`);
  const cur: Record<string, any> = existing?.data() ?? {};

  const data: Record<string, any> = {
    // Source-of-truth fields: always refreshed from Tiny.
    'Código (SKU)': t.sku || undefined,
    'Descrição': t.nome || undefined,
    'Categoria': t.categorias[0] || undefined,
    'Preço': t.precoPor,
    'Preço promocional': t.precoDe,
    'GTIN/EAN': t.gtin || undefined,
    'NCM (Classificação fiscal)': t.ncm || undefined,
    'Peso líquido (Kg)': t.pesoLiquido,
    'Peso bruto (Kg)': t.pesoBruto,
    'Largura embalagem': t.largura,
    'Altura Embalagem': t.altura,
    'Comprimento embalagem': t.comprimento,
    _tinyProductId: t.tinyId,
    ownerId: uid,
    createdAt: cur.createdAt || iso(),
    updatedAt: iso(),
  };
  t.imagens.slice(0, 6).forEach((url, i) => { data[`URL imagem ${i + 1}`] = url; });

  // Enriched fields: only fill when the current value is empty.
  const fillIfEmpty = (key: string, val?: string) => {
    if (val && !cur[key]) data[key] = val;
  };
  fillIfEmpty('Descrição complementar', t.descricaoHtml);
  fillIfEmpty('Título SEO', t.seoTitle);
  fillIfEmpty('Descrição SEO', t.seoDescription);
  fillIfEmpty('Palavras chave SEO', t.seoKeywords);

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('tiny_versions').add({
    source: 'tiny-bg-import',
    raw: t.raw && typeof t.raw === 'object' ? stripUndefined(t.raw as any) : null,
    importedAt: iso(),
  }).catch(() => { /* backup is best-effort */ });
}

// Formats an ISO timestamp as the yyyy-MM-dd the Tiny list filter expects.
const toTinyDate = (isoStr: string) => isoStr.slice(0, 10);

// Processes one page of products. Returns pagination progress for the job.
async function processSlice(uid: string, job: Job): Promise<{ total: number; imported: number; newOffset: number; done: boolean }> {
  const params = new URLSearchParams({
    situacao: 'A',
    limit: String(PAGE_LIMIT),
    offset: String(job.offset),
  });
  if (job.mode === 'update' && job.lastSyncAt) params.set('dataAlteracao', toTinyDate(job.lastSyncAt));

  const page = await tinyFetch<any>(uid, 'GET', `/produtos?${params.toString()}`);
  const itens: any[] = Array.isArray(page?.itens) ? page.itens : [];
  const total = Number(page?.paginacao?.total ?? job.total ?? 0);

  for (let i = 0; i < itens.length; i++) {
    const detail = await tinyFetch<any>(uid, 'GET', `/produtos/${itens[i].id}`).catch(() => itens[i]);
    await upsertProduct(uid, normalizeProduct(detail));
    if (PACE_MS && i < itens.length - 1) await sleep(PACE_MS);
  }

  const newOffset = job.offset + itens.length;
  // Trust page fullness for the end-of-catalog signal (paginacao.total may be
  // absent/0). A short or empty page means we've reached the end.
  const done = itens.length < PAGE_LIMIT || (total > 0 && newOffset >= total);
  return { total, imported: itens.length, newOffset, done };
}

// --- Lease + tick ----------------------------------------------------------

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

  let job = claimed;
  const start = Date.now();
  try {
    while (true) {
      const { total, imported, newOffset, done } = await processSlice(uid, job);
      const nextImported = (job.imported ?? 0) + imported;

      if (done) {
        await JOB_REF(uid).update({
          status: 'done', offset: newOffset, total, imported: nextImported,
          finishedAt: iso(), lastSyncAt: iso(), lease: null, updatedAt: iso(), error: null,
        });
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
      await sweepAutoSync().catch((e) => console.warn('[tiny] sweepAutoSync falhou:', e?.message));
    }
    const snap = await adminDb.collection(JOB_COL).where('status', 'in', ['queued', 'running']).get();
    for (const doc of snap.docs) {
      await processJob(doc.id).catch((e) => console.warn(`[tiny] processJob ${doc.id} falhou:`, e?.message));
    }
  } finally {
    isTicking = false;
  }
}

export function startTinyScheduler(): void {
  // The warm instance (minInstances >= 1) keeps this timer alive; Cloud Scheduler
  // hitting /api/tiny/cron/tick is the production backstop.
  setInterval(() => { tick().catch((e) => console.warn('[tiny] tick falhou:', e?.message)); }, TICK_MS);
  console.log('[tiny] scheduler de importação iniciado');
}

// --- Routes ----------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const CRON_SECRET = process.env.TINY_CRON_SECRET || process.env.CONTENT_CRON_SECRET || '';

function publicJob(j: Job | undefined) {
  if (!j) return { status: 'idle', mode: 'full', offset: 0, total: 0, imported: 0, lastSyncAt: null, autoSync: { enabled: false, everyHours: 24 } };
  return {
    status: j.status, mode: j.mode, offset: j.offset ?? 0, total: j.total ?? 0,
    imported: j.imported ?? 0, lastSyncAt: j.lastSyncAt ?? null,
    error: (j as any).error ?? null,
    autoSync: j.autoSync ?? { enabled: false, everyHours: 24 },
  };
}

export function registerTinyImportRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/tiny/import/start', async (req, res) => {
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

  app.get('/api/tiny/import/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await JOB_REF(uid).get();
      return res.json({ job: publicJob(snap.data() as Job | undefined) });
    } catch (e: any) {
      return res.status(401).json({ message: e?.message });
    }
  });

  app.post('/api/tiny/import/cancel', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await JOB_REF(uid).set({ status: 'canceled', lease: null, updatedAt: iso() }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  app.post('/api/tiny/import/autosync', async (req, res) => {
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
  app.post('/api/tiny/cron/tick', async (req, res) => {
    if (!CRON_SECRET || req.headers['x-tiny-cron-secret'] !== CRON_SECRET) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await tick().catch((e) => console.warn('[tiny] cron tick falhou:', e?.message));
    return res.json({ ok: true });
  });
}
