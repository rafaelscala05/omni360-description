// Background import/sync for Tiny ERP. A server-side worker paginates the Tiny
// catalog in slices, writing products straight to Firestore, so the import
// survives the browser tab closing and can run on a recurring schedule.
//
// Mirrors the in-process scheduler pattern of server/contentAgent.ts
// (startContentScheduler): setInterval(tick) on the warm App Hosting instance,
// plus POST /api/tiny/cron/tick (secret-gated) for Cloud Scheduler in production.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { PACE_MS, sleep, type TinyNormalizedProduct } from './tinyAgent';
import { tinyListPage, tinyGetProduct, getActiveVersion, type TinyVersion } from './tinyProvider';

const JOB_COL = 'tiny_import_jobs';
const JOB_REF = (uid: string) => adminDb.collection(JOB_COL).doc(uid);
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

const LEASE_MS = 120_000;      // how long a claimed slice is reserved to one instance
const MAX_PRODUCTS_PER_JOB = 200_000; // safety cap against a non-terminating list/queue
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

// Category-name cache, keyed by uid, populated lazily from Firestore and reused
// across the whole job run so we don't re-query per product.
const categoryCache = new Map<string, Set<string>>();

// Spreadsheet import lets the user review/enrich new categories via a modal;
// this background worker has no UI to prompt, so it silently creates any
// category missing from Firestore as a flat, top-level category (mirrors the
// "no AI enrichment" branch of App.processCategoryImport).
async function ensureCategoryExists(uid: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  let cache = categoryCache.get(uid);
  if (!cache) {
    cache = new Set();
    const snap = await adminDb.collection('users').doc(uid).collection('categories').get();
    snap.docs.forEach((d) => {
      const n = (d.data()?.name ?? '').toString().trim().toLowerCase();
      if (n) cache!.add(n);
    });
    categoryCache.set(uid, cache);
  }
  const key = trimmed.toLowerCase();
  if (cache.has(key)) return;
  cache.add(key);

  const ref = adminDb.collection('users').doc(uid).collection('categories').doc();
  const now = iso();
  await ref.set({
    id: ref.id,
    name: trimmed,
    slug: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    parentId: null,
    level: 0,
    path: [trimmed],
    pathIds: [ref.id],
    attributes: [],
    inheritParentAttributes: true,
    productCount: 0,
    aiGenerated: false,
    createdAt: now,
    updatedAt: now,
  }).catch((e) => console.warn(`[tiny] falha ao criar categoria "${trimmed}" para ${uid}:`, e?.message));
}

// Writes one normalized product to Firestore. "Source" fields always update;
// enriched fields (description/SEO) only fill when empty, preserving local work.
// Returns the Firestore doc id — the webhook handler uses it as idMapeamento.
export async function upsertProduct(uid: string, t: TinyNormalizedProduct, source = 'tiny-bg-import'): Promise<string> {
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
    'Estoque': t.estoque,
    'Estoque mínimo': t.estoqueMinimo,
    'Estoque máximo': t.estoqueMaximo,
    'Localização': t.localizacao || undefined,
    'Marca': t.marca || undefined,
    'Garantia': t.garantia || undefined,
    'Sob encomenda': t.sobEncomenda || undefined,
    'CEST': t.cest || undefined,
    'Dias para preparação': t.diasPreparacao,
    'Observações': t.obs || undefined,
    'Unidade por caixa': t.unidadePorCaixa || undefined,
    'Cód do fornecedor': t.codigoFornecedor || undefined,
    'Unidade': t.unidade || undefined,
    'Código do pai': t.codigoPai || undefined,
    'Variações': t.variacaoGrade || undefined,
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
  fillIfEmpty('Link do vídeo', t.linkVideo);
  fillIfEmpty('Slug', t.slug);

  if (t.categorias[0]) await ensureCategoryExists(uid, t.categorias[0]);

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('tiny_versions').add({
    source,
    raw: t.raw && typeof t.raw === 'object' ? stripUndefined(t.raw as any) : null,
    importedAt: iso(),
  }).catch(() => { /* backup is best-effort */ });

  return ref.id;
}


// Processes one page of products via the version-aware provider (v2 or v3).
async function processSlice(uid: string, job: Job, version: TinyVersion): Promise<{ total: number; imported: number; newOffset: number; done: boolean }> {
  const { items, total, done } = await tinyListPage(
    uid,
    { offset: job.offset, mode: job.mode, sinceISO: job.lastSyncAt },
    version,
  );

  for (let i = 0; i < items.length; i++) {
    const detail = await tinyGetProduct(uid, items[i].id, version).catch(() => null);
    if (detail) await upsertProduct(uid, detail);
    if (PACE_MS && i < items.length - 1) await sleep(PACE_MS);
  }

  const newOffset = job.offset + items.length;
  return { total: total || job.total || 0, imported: items.length, newOffset, done };
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

  const version = await getActiveVersion(uid);
  if (!version) {
    await JOB_REF(uid).update({ status: 'error', error: 'Tiny não conectado.', lease: null, updatedAt: iso() }).catch(() => {});
    return;
  }

  let job = claimed;
  const start = Date.now();
  try {
    while (true) {
      const { total, imported, newOffset, done } = await processSlice(uid, job, version);
      const nextImported = (job.imported ?? 0) + imported;

      // Safety valve: stop if the list/queue never terminates (e.g. a drained
      // queue that keeps returning records), so a job can't loop forever.
      const capped = newOffset >= MAX_PRODUCTS_PER_JOB;
      if (capped) console.warn(`[tiny] job ${uid} atingiu o limite de ${MAX_PRODUCTS_PER_JOB} produtos; encerrando.`);

      if (done || capped) {
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
