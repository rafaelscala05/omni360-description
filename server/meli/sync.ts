import crypto from 'node:crypto';
import { adminDb } from '../firebaseAdmin';
import { MeliApiClient } from './apiClient';
import { MELI_SECRET_REF, MELI_SELLER_REGISTRY_REF, MELI_STATUS_REF } from './oauth';
import type { MeliConnectionSecret, MeliListingRecord, MeliListingStatus, MeliSyncCursor, MeliSyncJob } from './types';
import { chunk, contentHash, jsonSafe, normalizeBulkItems, sanitizeError } from './utils';
import { enqueueAnalysisIfNeeded } from './analysis';
import { markListingProposalsStale } from './proposals';

const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const SNAPSHOTS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_snapshots');
const SCHEMAS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_category_schemas');
const USER_PRODUCTS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_user_products');
export const MELI_JOBS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_jobs');
const AUDIT_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_audit_events');

async function mapLimit<T, R>(values: T[], limit: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function connection(uid: string): Promise<MeliConnectionSecret> {
  const snap = await MELI_SECRET_REF(uid).get();
  if (!snap.exists) throw Object.assign(new Error('Conta Mercado Livre não conectada.'), { status: 401 });
  const data = snap.data() as MeliConnectionSecret;
  if (data.status !== 'active') throw Object.assign(new Error('Reconecte a conta Mercado Livre.'), { status: 401 });
  return data;
}

async function bestEffort<T>(operation: () => Promise<T | null>): Promise<T | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

async function fetchCategorySchema(uid: string, client: MeliApiClient, categoryId: string): Promise<void> {
  if (!categoryId) return;
  const ref = SCHEMAS_REF(uid).doc(categoryId);
  const cached = await ref.get();
  const cachedAt = cached.data()?.fetchedAt ? Date.parse(cached.data()?.fetchedAt) : 0;
  if (cached.exists && cachedAt > Date.now() - 24 * 60 * 60 * 1000) return;

  const [attributes, input, output] = await Promise.all([
    bestEffort(() => client.get(`/categories/${encodeURIComponent(categoryId)}/attributes`)),
    bestEffort(() => client.get(`/categories/${encodeURIComponent(categoryId)}/technical_specs/input`)),
    bestEffort(() => client.get(`/categories/${encodeURIComponent(categoryId)}/technical_specs/output`)),
  ]);
  const schema = jsonSafe({ attributes, input, output });
  await ref.set({ categoryId, schema, schemaHash: contentHash(schema), fetchedAt: new Date().toISOString() });
}

async function fetchUserProductScope(
  uid: string,
  client: MeliApiClient,
  connectionData: MeliConnectionSecret,
  userProductId: string | null,
): Promise<{ userProduct: unknown | null; family: unknown | null; familyId: string | null; relatedItemIds: string[] }> {
  if (!userProductId) return { userProduct: null, family: null, familyId: null, relatedItemIds: [] };
  const ref = USER_PRODUCTS_REF(uid).doc(userProductId);
  const cached = await ref.get();
  const cachedAt = cached.data()?.fetchedAt ? Date.parse(cached.data()?.fetchedAt) : 0;
  if (cached.exists && cachedAt > Date.now() - 6 * 60 * 60 * 1000) {
    const data = cached.data() || {};
    return { userProduct: data.userProduct || null, family: data.family || null, familyId: data.familyId || null, relatedItemIds: data.relatedItemIds || [] };
  }
  const userProduct = await bestEffort(() => client.get<any>(`/user-products/${encodeURIComponent(userProductId)}`));
  const familyId = userProduct?.family_id ? String(userProduct.family_id) : null;
  const [family, related] = await Promise.all([
    familyId ? bestEffort(() => client.get(`/sites/${encodeURIComponent(connectionData.siteId)}/user-products-families/${encodeURIComponent(familyId)}`)) : Promise.resolve(null),
    bestEffort(() => client.get<any>(`/users/${encodeURIComponent(connectionData.sellerId)}/items/search?user_product_id=${encodeURIComponent(userProductId)}`)),
  ]);
  const relatedItemIds = Array.isArray(related?.results) ? related.results.map(String) : [];
  const result = jsonSafe({ userProduct, family, familyId, relatedItemIds, fetchedAt: new Date().toISOString() });
  await ref.set({ userProductId, ...result });
  return result;
}

// Chamado por lote (≤ BATCH_SIZE IDs), nunca com a conta inteira: segurar
// milhares de itens completos em memória antes de salvar o primeiro era o que
// impedia contas grandes de terminar. Falha de um bulk não derruba o lote —
// os IDs que faltarem são buscados um a um, e o que ainda faltar vira falha
// daquele item só.
async function loadFullItems(client: MeliApiClient, itemIds: string[]): Promise<Map<string, Record<string, any>>> {
  const byId = new Map<string, Record<string, any>>();
  for (const group of chunk(itemIds, 20)) {
    const payload = await bestEffort(() => client.get(`/items/bulk?ids=${group.map(encodeURIComponent).join(',')}`));
    normalizeBulkItems(payload).forEach((item) => {
      if (item?.id) byId.set(String(item.id), item);
    });
    const missing = group.filter((id) => !byId.has(id));
    await mapLimit(missing, 3, async (id) => {
      const item = await bestEffort(() => client.get<Record<string, any>>(`/items/${encodeURIComponent(id)}?include_attributes=all`));
      if (item?.id) byId.set(String(item.id), item);
    });
  }
  return byId;
}

async function persistListing(
  uid: string,
  connectionData: MeliConnectionSecret,
  client: MeliApiClient,
  item: Record<string, any>,
): Promise<void> {
  const itemId = String(item.id);
  const [description, performance, catalogQuality] = await Promise.all([
    bestEffort(() => client.get<any>(`/items/${encodeURIComponent(itemId)}/description`, { allowNotFound: true })),
    bestEffort(() => client.get(`/item/${encodeURIComponent(itemId)}/performance`, { allowNotFound: true })),
    bestEffort(() => client.get(`/catalog_quality/status?item_id=${encodeURIComponent(itemId)}&v=3`, { allowNotFound: true })),
  ]);
  const userProductId = item.user_product_id ? String(item.user_product_id) : null;
  const userProductScope = await fetchUserProductScope(uid, client, connectionData, userProductId);
  const now = new Date().toISOString();
  const ref = LISTINGS_REF(uid).doc(itemId);
  const previous = await ref.get();
  const previousData = previous.data() as MeliListingRecord | undefined;
  const hashInput = {
    item,
    description: description?.plain_text || '',
    performance,
    catalogQuality,
    userProductScope: {
      userProduct: userProductScope.userProduct,
      family: userProductScope.family,
      familyId: userProductScope.familyId,
      relatedItemIds: userProductScope.relatedItemIds,
    },
  };
  const hash = contentHash(hashInput);
  const changed = !previousData || previousData.contentHash !== hash;
  const record: MeliListingRecord = jsonSafe({
    itemId,
    sellerId: String(item.seller_id ?? connectionData.sellerId),
    siteId: String(item.site_id ?? connectionData.siteId),
    userProductId,
    familyId: userProductScope.familyId || (item.family_id ? String(item.family_id) : null),
    catalogProductId: item.catalog_product_id ? String(item.catalog_product_id) : null,
    categoryId: String(item.category_id ?? ''),
    domainId: item.domain_id ? String(item.domain_id) : null,
    status: String(item.status ?? 'unknown'),
    title: String(item.title ?? ''),
    condition: item.condition ? String(item.condition) : null,
    soldQuantity: Number(item.sold_quantity ?? 0),
    availableQuantity: Number(item.available_quantity ?? 0),
    permalink: item.permalink ? String(item.permalink) : null,
    thumbnail: item.thumbnail ? String(item.thumbnail) : item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || null,
    descriptionPlainText: String(description?.plain_text ?? ''),
    attributes: Array.isArray(item.attributes) ? item.attributes : [],
    saleTerms: Array.isArray(item.sale_terms) ? item.sale_terms : [],
    variations: Array.isArray(item.variations) ? item.variations : [],
    pictures: Array.isArray(item.pictures) ? item.pictures : [],
    shipping: item.shipping ?? null,
    performance,
    catalogQuality,
    userProduct: userProductScope.userProduct,
    userProductFamily: userProductScope.family,
    relatedItemIds: userProductScope.relatedItemIds,
    rawItem: item,
    contentHash: hash,
    sourceLastUpdatedAt: item.last_updated ? String(item.last_updated) : null,
    lastSyncedAt: now,
    createdAt: previousData?.createdAt || now,
    updatedAt: now,
    ...(!changed && previousData?.analysisSummary ? { analysisSummary: previousData.analysisSummary } : {}),
    ...(previousData?.proposalVersion ? { proposalVersion: previousData.proposalVersion } : {}),
    ...(previousData?.proposalSummary ? {
      proposalSummary: changed ? { ...previousData.proposalSummary, status: 'stale', updatedAt: now } : previousData.proposalSummary,
    } : {}),
  });

  if (changed) {
    await SNAPSHOTS_REF(uid).add({
      listingId: itemId,
      reason: 'sync',
      item: jsonSafe(item),
      description: jsonSafe(description),
      contentHash: hash,
      capturedAt: now,
    });
  }
  await ref.set(record);
  if (changed && previousData) await markListingProposalsStale(uid, itemId);
  await fetchCategorySchema(uid, client, record.categoryId);
  if (changed) await enqueueAnalysisIfNeeded(uid, itemId, hash);
}

export async function refreshListingNow(uid: string, itemId: string): Promise<MeliListingRecord> {
  const connectionData = await connection(uid);
  const normalizedId = itemId.toUpperCase();
  const client = new MeliApiClient(uid);
  const item = await client.get<Record<string, any>>(`/items/${encodeURIComponent(normalizedId)}?include_attributes=all`);
  if (!item || String(item.seller_id) !== connectionData.sellerId) {
    throw Object.assign(new Error('O anúncio não pertence ao seller autenticado.'), { status: 403 });
  }
  await persistListing(uid, connectionData, client, item);
  const refreshed = await LISTINGS_REF(uid).doc(normalizedId).get();
  return refreshed.data() as MeliListingRecord;
}

const TERMINAL_JOB_STATUSES = ['succeeded', 'partial', 'failed', 'cancelled'];
const BATCHES_REF = (uid: string, jobId: string) => MELI_JOBS_REF(uid).doc(jobId).collection('batches');
const BATCH_SIZE = 50;
// O lease é renovado a cada gravação de progresso; se a instância morrer, o
// scheduler (60s) retoma o job assim que ele expira, a partir do último lote.
const LEASE_MS = 10 * 60 * 1000;
// Depois disso a execução devolve o job para o fim da fila, para uma conta
// com dezenas de milhares de anúncios não monopolizar os dois slots de sync.
const RUN_BUDGET_MS = 4 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 3_000;
const MAX_ATTEMPTS = 5;
const MAX_FAILED_IDS = 200;
const EMPTY_CURSOR: MeliSyncCursor = { nextBatch: 0, processed: 0, succeeded: 0, failed: 0 };

const batchDocId = (index: number) => String(index).padStart(6, '0');

async function updateJob(uid: string, jobId: string, patch: Partial<MeliSyncJob>): Promise<void> {
  const terminal = patch.status && TERMINAL_JOB_STATUSES.includes(patch.status);
  await MELI_JOBS_REF(uid).doc(jobId).set({
    ...patch,
    ...(terminal ? { processingLeaseId: null, processingLeaseUntil: null } : { processingLeaseUntil: Date.now() + LEASE_MS }),
  }, { merge: true });
}

export async function createSyncJob(
  uid: string,
  options: { statuses?: MeliListingStatus[]; itemId?: string },
): Promise<MeliSyncJob> {
  await connection(uid);
  const ref = MELI_JOBS_REF(uid).doc();
  const now = new Date().toISOString();
  const statuses: MeliListingStatus[] = options.statuses?.length
    ? options.statuses
    : ['active', 'paused', 'closed'];
  const job: MeliSyncJob = {
    id: ref.id,
    kind: options.itemId ? 'listing_sync' : 'account_sync',
    status: 'queued',
    requestedStatuses: statuses,
    ...(options.itemId ? { itemId: options.itemId } : {}),
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    progress: 0,
    lastStep: 'Aguardando processamento',
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    processingLeaseId: null,
    processingLeaseUntil: null,
    phase: 'listing',
    listedStatuses: [],
    batchCount: 0,
    cursor: EMPTY_CURSOR,
    attempts: 0,
    failedItemIds: [],
  };
  await ref.set(job);
  return job;
}

// Uma sync de conta por vez: clicar de novo (ou abrir outra aba) devolve a que
// já está andando em vez de enfileirar outra varredura da conta inteira.
export async function findActiveAccountSyncJob(uid: string): Promise<MeliSyncJob | null> {
  const recent = await MELI_JOBS_REF(uid).orderBy('createdAt', 'desc').limit(20).get();
  const active = recent.docs
    .map((doc) => doc.data() as MeliSyncJob)
    .find((job) => job.kind === 'account_sync' && !TERMINAL_JOB_STATUSES.includes(job.status));
  return active || null;
}

// Fase 1: enumera os IDs pelo scan e grava em lotes de BATCH_SIZE. O scroll_id
// do scan expira em minutos e não dá para retomá-lo, então uma listagem
// interrompida recomeça o status inteiro — deduplicando contra os lotes já
// gravados, para nenhum anúncio entrar duas vezes.
async function listIntoBatches(
  uid: string,
  jobId: string,
  job: MeliSyncJob,
  client: MeliApiClient,
  sellerId: string,
): Promise<{ batchCount: number; total: number }> {
  const existing = await BATCHES_REF(uid, jobId).get();
  const known = new Set<string>();
  let batchCount = 0;
  existing.docs.forEach((doc) => {
    const data = doc.data();
    (Array.isArray(data.itemIds) ? data.itemIds : []).forEach((id: unknown) => known.add(String(id)));
    batchCount = Math.max(batchCount, Number(data.index) + 1);
  });

  const writeBatch = async (itemIds: string[]) => {
    await BATCHES_REF(uid, jobId).doc(batchDocId(batchCount)).set({
      index: batchCount, itemIds, createdAt: new Date().toISOString(),
    });
    batchCount += 1;
  };

  if (job.itemId) {
    if (!/^[A-Z]{2,4}\d+$/i.test(job.itemId)) throw new Error('ID de anúncio inválido.');
    if (!batchCount) await writeBatch([job.itemId.toUpperCase()]);
    return { batchCount, total: 1 };
  }

  const listedStatuses = new Set<MeliListingStatus>(job.listedStatuses || []);
  for (const status of job.requestedStatuses) {
    if (listedStatuses.has(status)) continue;
    const pending: string[] = [];
    let scrollId: string | null = null;
    for (let page = 0; page < 1000; page += 1) {
      const params = new URLSearchParams({ status, search_type: 'scan', limit: '100' });
      if (scrollId) params.set('scroll_id', scrollId);
      const payload = await client.get<any>(`/users/${encodeURIComponent(sellerId)}/items/search?${params.toString()}`);
      const results: string[] = Array.isArray(payload?.results) ? payload.results.map(String) : [];
      results.forEach((id) => {
        if (known.has(id)) return;
        known.add(id);
        pending.push(id);
      });
      while (pending.length >= BATCH_SIZE) await writeBatch(pending.splice(0, BATCH_SIZE));
      await updateJob(uid, jobId, {
        total: known.size, batchCount, lastStep: `Listando anúncios: ${known.size} encontrados`,
      });
      scrollId = payload?.scroll_id ? String(payload.scroll_id) : null;
      if (!results.length || !scrollId) break;
    }
    while (pending.length) await writeBatch(pending.splice(0, BATCH_SIZE));
    listedStatuses.add(status);
    await updateJob(uid, jobId, { listedStatuses: [...listedStatuses], batchCount, total: known.size });
  }
  return { batchCount, total: known.size };
}

type RunOutcome = 'done' | 'yield' | 'cancelled';

// Fase 2: consome os lotes em ordem. Cada lote conclui com UMA gravação
// atômica (lote marcado + cursor do job), então uma queda no meio do lote só
// refaz aquele lote — os anúncios já salvos são idempotentes (contentHash).
async function processBatches(
  uid: string,
  jobId: string,
  job: MeliSyncJob,
  client: MeliApiClient,
  connectionData: MeliConnectionSecret,
  batchCount: number,
  total: number,
  runStartedAt: number,
): Promise<RunOutcome> {
  const jobRef = MELI_JOBS_REF(uid).doc(jobId);
  let cursor: MeliSyncCursor = { ...EMPTY_CURSOR, ...(job.cursor || {}) };
  let failedItemIds = job.failedItemIds || [];
  const progressOf = (processed: number) => (total ? Math.min(99, Math.round((processed / total) * 100)) : 0);

  while (cursor.nextBatch < batchCount) {
    if (Date.now() - runStartedAt > RUN_BUDGET_MS) return 'yield';
    const fresh = (await jobRef.get()).data() as MeliSyncJob | undefined;
    if (!fresh || fresh.status === 'cancelled') return 'cancelled';

    const batchRef = BATCHES_REF(uid, jobId).doc(batchDocId(cursor.nextBatch));
    const batchSnap = await batchRef.get();
    const itemIds: string[] = Array.isArray(batchSnap.data()?.itemIds) ? batchSnap.data()!.itemIds.map(String) : [];
    const items = await loadFullItems(client, itemIds);

    let batchSucceeded = 0;
    const batchFailed: string[] = [];
    let batchDone = 0;
    let lastProgressAt = Date.now();
    await mapLimit(itemIds, 3, async (itemId) => {
      const item = items.get(itemId);
      try {
        if (!item) throw new Error('O item não foi retornado pela API.');
        if (String(item.seller_id) !== connectionData.sellerId) throw new Error('Item não pertence ao seller autenticado.');
        await persistListing(uid, connectionData, client, item);
        batchSucceeded += 1;
      } catch {
        batchFailed.push(itemId);
      }
      batchDone += 1;
      if (Date.now() - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        lastProgressAt = Date.now();
        const processed = cursor.processed + batchDone;
        await updateJob(uid, jobId, {
          processed,
          progress: progressOf(processed),
          lastStep: `Salvando anúncios (${processed}/${total})`,
        });
      }
    });

    cursor = {
      nextBatch: cursor.nextBatch + 1,
      processed: cursor.processed + itemIds.length,
      succeeded: cursor.succeeded + batchSucceeded,
      failed: cursor.failed + batchFailed.length,
    };
    failedItemIds = [...failedItemIds, ...batchFailed].slice(0, MAX_FAILED_IDS);
    const commit = adminDb.batch();
    commit.set(batchRef, {
      done: true, succeeded: batchSucceeded, failed: batchFailed.length, failedItemIds: batchFailed,
      processedAt: new Date().toISOString(),
    }, { merge: true });
    commit.set(jobRef, {
      cursor,
      processed: cursor.processed,
      succeeded: cursor.succeeded,
      failed: cursor.failed,
      failedItemIds,
      attempts: 0,
      progress: progressOf(cursor.processed),
      lastStep: `Salvando anúncios (${cursor.processed}/${total}) · lote ${cursor.nextBatch}/${batchCount}`,
      processingLeaseUntil: Date.now() + LEASE_MS,
    }, { merge: true });
    await commit.commit();
  }
  return 'done';
}

export async function runSyncJob(uid: string, jobId: string): Promise<void> {
  const ref = MELI_JOBS_REF(uid).doc(jobId);
  const leaseId = crypto.randomUUID();
  const runStartedAt = Date.now();
  const job = await adminDb.runTransaction(async (tx) => {
    const jobSnap = await tx.get(ref);
    if (!jobSnap.exists) return null;
    const value = jobSnap.data() as MeliSyncJob;
    if (TERMINAL_JOB_STATUSES.includes(value.status)) return null;
    if (value.processingLeaseUntil && value.processingLeaseUntil > Date.now()) return null;
    tx.set(ref, {
      status: 'running', startedAt: value.startedAt || new Date().toISOString(), lastStep: 'Validando conexão',
      processingLeaseId: leaseId, processingLeaseUntil: Date.now() + LEASE_MS,
    }, { merge: true });
    return value;
  });
  if (!job) return;

  try {
    const connectionData = await connection(uid);
    await MELI_SELLER_REGISTRY_REF(connectionData.sellerId).set({
      uid, sellerId: connectionData.sellerId, siteId: connectionData.siteId, status: 'active', updatedAt: new Date().toISOString(),
    }, { merge: true });
    const client = new MeliApiClient(uid);
    const me = await client.get<any>('/users/me');
    if (!me || String(me.id) !== connectionData.sellerId) throw Object.assign(new Error('A conexão não pertence ao seller armazenado.'), { status: 403 });

    let batchCount = job.batchCount || 0;
    let total = job.total || 0;
    if (job.phase !== 'processing') {
      await updateJob(uid, jobId, { lastStep: 'Listando anúncios por status' });
      ({ batchCount, total } = await listIntoBatches(uid, jobId, job, client, connectionData.sellerId));
      await updateJob(uid, jobId, { phase: 'processing', batchCount, total, lastStep: `${total} anúncios encontrados` });
    }

    const outcome = await processBatches(uid, jobId, job, client, connectionData, batchCount, total, runStartedAt);
    if (outcome === 'cancelled') {
      await ref.set({ processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
      return;
    }
    if (outcome === 'yield') {
      await ref.set({ processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
      scheduleSyncJob(uid, jobId);
      return;
    }

    const final = (await ref.get()).data() as MeliSyncJob;
    const { succeeded, failed } = final.cursor || EMPTY_CURSOR;
    const completedAt = new Date().toISOString();
    const status = failed ? (succeeded ? 'partial' : 'failed') : 'succeeded';
    await Promise.all([
      updateJob(uid, jobId, {
        status,
        progress: 100,
        lastStep: status === 'succeeded'
          ? `Sincronização concluída: ${succeeded} anúncios`
          : `Sincronização concluída: ${succeeded} salvos, ${failed} com falha`,
        completedAt,
      }),
      MELI_STATUS_REF(uid).set({ lastSyncedAt: completedAt, lastSyncJobId: jobId }, { merge: true }),
      AUDIT_REF(uid).add({
        actorType: 'user',
        actorId: uid,
        action: 'meli.sync.completed',
        resourceType: 'meli_job',
        resourceId: jobId,
        metadata: { total, succeeded, failed, statuses: job.requestedStatuses },
        createdAt: completedAt,
      }),
    ]);
    // Os lotes só servem para retomar; concluído o job, os IDs com falha já
    // estão em failedItemIds.
    await adminDb.recursiveDelete(BATCHES_REF(uid, jobId)).catch(() => undefined);
  } catch (error) {
    // Erro transitório (rede, 5xx esgotado, 429 longo) não joga fora o que já
    // foi salvo: o job volta para a fila e retoma do cursor. Só conexão
    // inválida ou tentativas esgotadas encerram como falha.
    const httpStatus = Number((error as any)?.status);
    const attempts = (job.attempts || 0) + 1;
    const permanent = httpStatus === 401 || httpStatus === 403 || attempts >= MAX_ATTEMPTS;
    if (permanent) {
      await updateJob(uid, jobId, {
        status: 'failed',
        attempts,
        error: sanitizeError(error),
        lastStep: 'Falha na sincronização',
        completedAt: new Date().toISOString(),
      });
    } else {
      await ref.set({
        status: 'retry_scheduled',
        attempts,
        error: sanitizeError(error),
        lastStep: `Erro temporário; retomando do ponto salvo (tentativa ${attempts + 1}/${MAX_ATTEMPTS})`,
        processingLeaseId: null,
        processingLeaseUntil: Date.now() + 60_000 * attempts,
      }, { merge: true });
    }
  }
}

const syncQueue: Array<{ uid: string; jobId: string }> = [];
let activeSyncJobs = 0;

function drainSyncQueue(): void {
  while (activeSyncJobs < 2 && syncQueue.length) {
    const next = syncQueue.shift()!;
    activeSyncJobs += 1;
    void runSyncJob(next.uid, next.jobId).finally(() => {
      activeSyncJobs -= 1;
      drainSyncQueue();
    });
  }
}

export function scheduleSyncJob(uid: string, jobId: string): void {
  if (syncQueue.some((entry) => entry.uid === uid && entry.jobId === jobId)) return;
  syncQueue.push({ uid, jobId });
  setImmediate(drainSyncQueue);
}

export async function recordAudit(uid: string, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await AUDIT_REF(uid).add({
    actorType: 'user', actorId: uid, action, resourceType, resourceId,
    metadata: jsonSafe(metadata), createdAt: new Date().toISOString(),
  });
}

export async function createScopeSyncJobs(
  uid: string,
  scope: { userProductId?: string; familyId?: string },
): Promise<MeliSyncJob[]> {
  const listings = await LISTINGS_REF(uid).get();
  const itemIds = listings.docs.map((doc) => doc.data() as MeliListingRecord)
    .filter((listing) => scope.userProductId ? listing.userProductId === scope.userProductId : listing.familyId === scope.familyId)
    .map((listing) => listing.itemId);
  if (scope.userProductId) {
    const connectionData = await connection(uid);
    const client = new MeliApiClient(uid);
    const remote = await bestEffort(() => client.get<any>(
      `/users/${encodeURIComponent(connectionData.sellerId)}/items/search?user_product_id=${encodeURIComponent(scope.userProductId!)}`,
    ));
    if (Array.isArray(remote?.results)) remote.results.map(String).forEach((itemId: string) => itemIds.push(itemId));
  }
  if (scope.familyId) {
    const connectionData = await connection(uid);
    const client = new MeliApiClient(uid);
    const family = await bestEffort(() => client.get<any>(
      `/sites/${encodeURIComponent(connectionData.siteId)}/user-products-families/${encodeURIComponent(scope.familyId!)}`,
    ));
    const userProductIds = [family?.user_products, family?.products, family?.members]
      .flatMap((value) => Array.isArray(value) ? value : [])
      .map((entry: any) => String(entry?.id || entry?.user_product_id || entry || ''))
      .filter(Boolean)
      .slice(0, 20);
    for (const userProductId of userProductIds) {
      const remote = await bestEffort(() => client.get<any>(
        `/users/${encodeURIComponent(connectionData.sellerId)}/items/search?user_product_id=${encodeURIComponent(userProductId)}`,
      ));
      if (Array.isArray(remote?.results)) remote.results.map(String).forEach((itemId: string) => itemIds.push(itemId));
    }
  }
  const jobs: MeliSyncJob[] = [];
  for (const itemId of [...new Set(itemIds)].slice(0, 100)) jobs.push(await createSyncJob(uid, { itemId }));
  return jobs;
}
