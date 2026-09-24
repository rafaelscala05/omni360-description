import { adminDb } from '../firebaseAdmin';
import { MeliApiClient } from './apiClient';
import { MELI_SECRET_REF, MELI_STATUS_REF } from './oauth';
import type { MeliConnectionSecret, MeliListingRecord, MeliListingStatus, MeliSyncJob } from './types';
import { chunk, contentHash, jsonSafe, normalizeBulkItems, sanitizeError } from './utils';

const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const SNAPSHOTS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_snapshots');
const SCHEMAS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_category_schemas');
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

async function listItemIds(client: MeliApiClient, sellerId: string, statuses: MeliListingStatus[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const status of statuses) {
    let scrollId: string | null = null;
    for (let page = 0; page < 1000; page += 1) {
      const params = new URLSearchParams({ status, search_type: 'scan', limit: '100' });
      if (scrollId) params.set('scroll_id', scrollId);
      const payload = await client.get<any>(`/users/${encodeURIComponent(sellerId)}/items/search?${params.toString()}`);
      const results = Array.isArray(payload?.results) ? payload.results.map(String) : [];
      results.forEach((id: string) => ids.add(id));
      scrollId = payload?.scroll_id ? String(payload.scroll_id) : null;
      if (!results.length || !scrollId) break;
    }
  }
  return [...ids];
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

async function loadFullItems(client: MeliApiClient, itemIds: string[]): Promise<Map<string, Record<string, any>>> {
  const byId = new Map<string, Record<string, any>>();
  for (const group of chunk(itemIds, 20)) {
    const payload = await client.get(`/items/bulk?ids=${group.map(encodeURIComponent).join(',')}`);
    normalizeBulkItems(payload).forEach((item) => {
      if (item?.id) byId.set(String(item.id), item);
    });
    const missing = group.filter((id) => !byId.has(id));
    await mapLimit(missing, 3, async (id) => {
      const item = await client.get<Record<string, any>>(`/items/${encodeURIComponent(id)}?include_attributes=all`);
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
  const now = new Date().toISOString();
  const ref = LISTINGS_REF(uid).doc(itemId);
  const previous = await ref.get();
  const previousData = previous.data() as MeliListingRecord | undefined;
  const hashInput = {
    item,
    description: description?.plain_text || '',
    performance,
    catalogQuality,
  };
  const hash = contentHash(hashInput);
  const record: MeliListingRecord = jsonSafe({
    itemId,
    sellerId: String(item.seller_id ?? connectionData.sellerId),
    siteId: String(item.site_id ?? connectionData.siteId),
    userProductId: item.user_product_id ? String(item.user_product_id) : null,
    familyId: item.family_id ? String(item.family_id) : null,
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
    rawItem: item,
    contentHash: hash,
    sourceLastUpdatedAt: item.last_updated ? String(item.last_updated) : null,
    lastSyncedAt: now,
    createdAt: previousData?.createdAt || now,
    updatedAt: now,
  });

  if (!previousData || previousData.contentHash !== hash) {
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
  await fetchCategorySchema(uid, client, record.categoryId);
}

async function updateJob(uid: string, jobId: string, patch: Partial<MeliSyncJob>): Promise<void> {
  await MELI_JOBS_REF(uid).doc(jobId).set(patch, { merge: true });
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
  };
  await ref.set(job);
  return job;
}

export async function runSyncJob(uid: string, jobId: string): Promise<void> {
  const ref = MELI_JOBS_REF(uid).doc(jobId);
  const jobSnap = await ref.get();
  if (!jobSnap.exists) return;
  const job = jobSnap.data() as MeliSyncJob;
  await updateJob(uid, jobId, { status: 'running', startedAt: new Date().toISOString(), lastStep: 'Validando conexão' });

  try {
    const connectionData = await connection(uid);
    const client = new MeliApiClient(uid);
    const me = await client.get<any>('/users/me');
    if (!me || String(me.id) !== connectionData.sellerId) throw new Error('A conexão não pertence ao seller armazenado.');

    let itemIds: string[];
    if (job.itemId) {
      if (!/^[A-Z]{2,4}\d+$/i.test(job.itemId)) throw new Error('ID de anúncio inválido.');
      itemIds = [job.itemId.toUpperCase()];
    } else {
      await updateJob(uid, jobId, { lastStep: 'Listando anúncios por status' });
      itemIds = await listItemIds(client, connectionData.sellerId, job.requestedStatuses);
    }
    await updateJob(uid, jobId, { total: itemIds.length, lastStep: 'Buscando detalhes em lotes de 20' });
    const items = await loadFullItems(client, itemIds);

    let succeeded = 0;
    let failed = 0;
    let processed = 0;
    await mapLimit(itemIds, 3, async (itemId) => {
      const item = items.get(itemId);
      try {
        if (!item) throw new Error('O item não foi retornado pela API.');
        if (String(item.seller_id) !== connectionData.sellerId) throw new Error('Item não pertence ao seller autenticado.');
        await persistListing(uid, connectionData, client, item);
        succeeded += 1;
      } catch {
        failed += 1;
      }
      processed += 1;
      await updateJob(uid, jobId, {
        processed,
        succeeded,
        failed,
        progress: itemIds.length ? Math.round((processed / itemIds.length) * 100) : 100,
        lastStep: `Sincronizando anúncios (${processed}/${itemIds.length})`,
      });
    });

    const completedAt = new Date().toISOString();
    const status = failed ? (succeeded ? 'partial' : 'failed') : 'succeeded';
    await Promise.all([
      updateJob(uid, jobId, {
        status,
        processed: itemIds.length,
        succeeded,
        failed,
        progress: 100,
        lastStep: status === 'succeeded' ? 'Sincronização concluída' : 'Sincronização concluída com falhas',
        completedAt,
      }),
      MELI_STATUS_REF(uid).set({ lastSyncedAt: completedAt, lastSyncJobId: jobId }, { merge: true }),
      AUDIT_REF(uid).add({
        actorType: 'user',
        actorId: uid,
        action: 'meli.sync.completed',
        resourceType: 'meli_job',
        resourceId: jobId,
        metadata: { total: itemIds.length, succeeded, failed, statuses: job.requestedStatuses },
        createdAt: completedAt,
      }),
    ]);
  } catch (error) {
    await updateJob(uid, jobId, {
      status: 'failed',
      error: sanitizeError(error),
      lastStep: 'Falha na sincronização',
      completedAt: new Date().toISOString(),
    });
  }
}

export async function recordAudit(uid: string, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await AUDIT_REF(uid).add({
    actorType: 'user', actorId: uid, action, resourceType, resourceId,
    metadata: jsonSafe(metadata), createdAt: new Date().toISOString(),
  });
}
