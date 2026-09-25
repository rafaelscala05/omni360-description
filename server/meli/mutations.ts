import crypto from 'node:crypto';
import { adminDb } from '../firebaseAdmin';
import { MeliApiClient } from './apiClient';
import { MELI_SECRET_REF } from './oauth';
import { getProposal, riskForChange } from './proposals';
import { refreshListingNow } from './sync';
import type {
  MeliConnectionSecret,
  MeliListingChange,
  MeliListingProposal,
  MeliListingRecord,
  MeliMutationRun,
} from './types';
import { jsonSafe, sanitizeError } from './utils';

const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const SNAPSHOTS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_snapshots');
const PROPOSALS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_proposals');
const CHANGES_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_changes');
export const MUTATIONS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_mutation_runs');
const AUDIT_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_audit_events');

function objects(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object')) : [];
}

function normalizedValue(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function compactEntries(value: unknown): Array<{ id: string; valueId: string; valueName: string }> {
  return objects(value).map((entry) => ({
    id: String(entry.id || ''),
    valueId: String(entry.value_id ?? entry.valueId ?? ''),
    valueName: String(entry.value_name ?? entry.valueName ?? ''),
  })).filter((entry) => entry.id).sort((a, b) => a.id.localeCompare(b.id));
}

function pictureIds(value: unknown): string[] {
  return objects(value).map((picture) => String(picture.id || '')).filter(Boolean);
}

function variationPictureIds(value: unknown): string[][] {
  return objects(value).map((variation) => Array.isArray(variation.picture_ids) ? variation.picture_ids.map(String).sort() : []);
}

export function mutationFingerprint(item: Record<string, any>, description: Record<string, any> | null): unknown {
  return {
    sellerId: String(item.seller_id ?? ''),
    categoryId: String(item.category_id ?? ''),
    catalogProductId: String(item.catalog_product_id ?? ''),
    userProductId: String(item.user_product_id ?? ''),
    title: String(item.title ?? ''),
    description: String(description?.plain_text ?? ''),
    attributes: compactEntries(item.attributes),
    saleTerms: compactEntries(item.sale_terms),
    pictures: pictureIds(item.pictures),
    variationPictures: variationPictureIds(item.variations),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasWriteScope(scopes: string[]): boolean {
  return scopes.some((scope) => scope.toLowerCase() === 'write');
}

function writeEntry(value: unknown, expectedId: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const id = String(entry.id || expectedId);
  if (id !== expectedId) throw Object.assign(new Error(`O valor de ${expectedId} possui um ID incompatível.`), { status: 422 });
  const valueName = String(entry.valueName ?? entry.value_name ?? '').trim();
  const valueId = String(entry.valueId ?? entry.value_id ?? '').trim();
  if (!valueName && !valueId) throw Object.assign(new Error(`O valor de ${expectedId} está vazio.`), { status: 422 });
  return { id, ...(valueId ? { value_id: valueId } : { value_name: valueName }) };
}

export function mergeMeliEntries(
  current: unknown,
  changes: MeliListingChange[],
  prefix: 'attributes.' | 'sale_terms.',
): Record<string, unknown>[] {
  const result = objects(current).map((entry) => ({
    id: String(entry.id || ''),
    ...(entry.value_id ? { value_id: String(entry.value_id) } : {}),
    ...(entry.value_name != null ? { value_name: String(entry.value_name) } : {}),
    ...(entry.value_struct && typeof entry.value_struct === 'object' ? { value_struct: entry.value_struct } : {}),
  })).filter((entry) => entry.id);
  for (const change of changes.filter((candidate) => candidate.fieldPath.startsWith(prefix))) {
    const id = change.fieldPath.slice(prefix.length);
    const index = result.findIndex((entry) => String(entry.id) === id);
    const next = writeEntry(change.newValue, id);
    if (!next || change.changeType === 'remove') {
      if (index >= 0) result.splice(index, 1);
    } else if (index >= 0) result[index] = next;
    else result.push(next);
  }
  return result;
}

interface PictureBuildResult {
  pictures: Array<{ id?: string; source?: string }>;
  touched: boolean;
}

export function buildPictures(
  currentPictures: unknown,
  variations: unknown,
  changes: MeliListingChange[],
): PictureBuildResult {
  let pictures: Array<{ id?: string; source?: string }> = objects(currentPictures)
    .map((picture) => picture.id ? { id: String(picture.id) } : picture.source ? { source: String(picture.source) } : {})
    .filter((picture) => picture.id || picture.source);
  const linked = new Set(objects(variations).flatMap((variation) => Array.isArray(variation.picture_ids) ? variation.picture_ids.map(String) : []));
  const pictureChanges = changes.filter((change) => change.fieldPath.startsWith('pictures.'));
  for (const change of pictureChanges) {
    const value = change.newValue && typeof change.newValue === 'object' ? change.newValue as Record<string, any> : {};
    const action = String(value.action || '');
    const pictureId = value.pictureId ? String(value.pictureId) : change.fieldPath.startsWith('pictures.plan.') ? '' : change.fieldPath.slice('pictures.'.length);
    if ((action === 'remove' || action === 'replace') && pictureId && linked.has(pictureId)) {
      throw Object.assign(new Error(`A imagem ${pictureId} está vinculada a uma variação e não pode ser ${action === 'remove' ? 'removida' : 'substituída'}.`), { status: 422 });
    }
    if (action === 'restore') {
      pictures = objects(value.pictures).map((picture) => ({ id: String(picture.id || '') })).filter((picture) => picture.id);
      continue;
    }
    const index = pictures.findIndex((picture) => picture.id === pictureId);
    if (action === 'remove') {
      if (index < 0) throw Object.assign(new Error(`A imagem ${pictureId} não existe mais no anúncio.`), { status: 409 });
      pictures.splice(index, 1);
    } else if (action === 'replace') {
      if (index < 0) throw Object.assign(new Error(`A imagem ${pictureId} não existe mais no anúncio.`), { status: 409 });
      if (!/^https:\/\//i.test(String(value.source || ''))) throw Object.assign(new Error('A substituição exige uma URL HTTPS.'), { status: 422 });
      pictures.splice(index, 1, { source: String(value.source) });
    } else if (action === 'create') {
      if (!/^https:\/\//i.test(String(value.source || ''))) throw Object.assign(new Error('A nova imagem exige uma URL HTTPS.'), { status: 422 });
      pictures.push({ source: String(value.source) });
    } else if (action === 'reorder') {
      if (index < 0) throw Object.assign(new Error(`A imagem ${pictureId} não existe mais no anúncio.`), { status: 409 });
      const target = Number(value.targetOrder) - 1;
      if (!Number.isInteger(target) || target < 0 || target >= pictures.length) throw Object.assign(new Error('A posição de imagem informada é inválida.'), { status: 422 });
      const [picture] = pictures.splice(index, 1);
      pictures.splice(target, 0, picture);
    }
  }
  if (pictureChanges.length && !pictures.length) throw Object.assign(new Error('A publicação não pode ficar sem imagens.'), { status: 422 });
  return { pictures, touched: pictureChanges.length > 0 };
}

function warningsFrom(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const warnings = Array.isArray((value as any).warnings) ? (value as any).warnings : [];
  return warnings.map((warning: any) => String(warning?.message || warning?.code || warning)).filter(Boolean);
}

function currentEntry(value: unknown, id: string): { id: string; valueId: string | null; valueName: string | null } | null {
  const match = objects(value).find((entry) => String(entry.id) === id);
  return match ? { id, valueId: match.value_id ?? null, valueName: match.value_name ?? null } : null;
}

function currentLogicalValue(listing: MeliListingRecord, change: MeliListingChange): unknown {
  if (change.fieldPath === 'title') return listing.title;
  if (change.fieldPath === 'description.plain_text') return listing.descriptionPlainText || null;
  if (change.fieldPath.startsWith('attributes.')) return currentEntry(listing.attributes, change.fieldPath.slice('attributes.'.length));
  if (change.fieldPath.startsWith('sale_terms.')) return currentEntry(listing.saleTerms, change.fieldPath.slice('sale_terms.'.length));
  if (change.fieldPath.startsWith('pictures.')) {
    const id = change.fieldPath.slice('pictures.'.length);
    return objects(listing.pictures).find((picture) => String(picture.id) === id) || null;
  }
  return null;
}

function verifyChange(change: MeliListingChange, beforeItem: Record<string, any>, afterItem: Record<string, any>, afterDescription: Record<string, any> | null): boolean {
  if (change.fieldPath === 'title') return String(afterItem.title || '') === String(change.newValue || '');
  if (change.fieldPath === 'description.plain_text') return String(afterDescription?.plain_text || '') === String(change.newValue || '');
  if (change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.')) {
    const prefix = change.fieldPath.startsWith('attributes.') ? 'attributes.' : 'sale_terms.';
    const source = prefix === 'attributes.' ? afterItem.attributes : afterItem.sale_terms;
    const id = change.fieldPath.slice(prefix.length);
    const actual = currentEntry(source, id);
    if (change.changeType === 'remove' || change.newValue == null) return actual == null;
    const expected = change.newValue as any;
    return actual != null && (expected.valueId ? normalizedValue(actual.valueId) === normalizedValue(expected.valueId) : normalizedValue(actual.valueName) === normalizedValue(expected.valueName));
  }
  if (change.fieldPath.startsWith('pictures.')) {
    const value = change.newValue as any;
    const action = String(value?.action || '');
    const id = String(value?.pictureId || change.fieldPath.slice('pictures.'.length));
    const beforeIds = pictureIds(beforeItem.pictures);
    const afterIds = pictureIds(afterItem.pictures);
    if (action === 'remove') return !afterIds.includes(id);
    if (action === 'replace') return !afterIds.includes(id) && afterIds.length === beforeIds.length;
    if (action === 'create') return afterIds.length > beforeIds.length;
    if (action === 'reorder') return afterIds.indexOf(id) === Number(value.targetOrder) - 1;
    if (action === 'restore') return sameJson(afterIds, objects(value.pictures).map((picture) => String(picture.id || '')).filter(Boolean));
  }
  return false;
}

async function fetchLive(client: MeliApiClient, itemId: string) {
  const [item, description] = await Promise.all([
    client.get<Record<string, any>>(`/items/${encodeURIComponent(itemId)}?include_attributes=all`),
    client.get<Record<string, any>>(`/items/${encodeURIComponent(itemId)}/description`, { allowNotFound: true }),
  ]);
  if (!item) throw Object.assign(new Error('O anúncio não foi encontrado no Mercado Livre.'), { status: 404 });
  return { item, description };
}

async function captureSnapshot(uid: string, listingId: string, reason: 'before_mutation' | 'after_mutation' | 'rollback', live: Awaited<ReturnType<typeof fetchLive>>): Promise<string> {
  const ref = SNAPSHOTS_REF(uid).doc();
  await ref.set(jsonSafe({
    id: ref.id, listingId, reason, item: live.item, description: live.description,
    fingerprint: mutationFingerprint(live.item, live.description), capturedAt: new Date().toISOString(),
  }));
  return ref.id;
}

function publicRun(run: MeliMutationRun): MeliMutationRun {
  return jsonSafe(run);
}

export async function createMutationRun(uid: string, proposalId: string, idempotencyKey?: string): Promise<MeliMutationRun> {
  const key = String(idempotencyKey || crypto.randomUUID()).slice(0, 120);
  const runId = crypto.createHash('sha256').update(`${proposalId}:${key}`).digest('hex');
  const ref = MUTATIONS_REF(uid).doc(runId);
  const existing = await ref.get();
  if (existing.exists) return publicRun(existing.data() as MeliMutationRun);
  const proposalResult = await getProposal(uid, proposalId);
  if (!proposalResult) throw Object.assign(new Error('Proposta não encontrada.'), { status: 404 });
  const { proposal, changes } = proposalResult;
  const pending = changes.filter((change) => change.approvalStatus === 'pending');
  const approved = changes.filter((change) => change.approvalStatus === 'approved');
  if (pending.length) throw Object.assign(new Error('Aprove ou rejeite todas as mudanças antes de publicar.'), { status: 409 });
  if (!approved.length) throw Object.assign(new Error('Não há mudanças aprovadas para publicar.'), { status: 422 });
  if (!['approved', 'partially_approved', 'failed'].includes(proposal.status)) throw Object.assign(new Error('A proposta não está pronta para publicação.'), { status: 409 });
  if (approved.some((change) => change.riskLevel === 'blocked')) throw Object.assign(new Error('A proposta contém uma mudança bloqueada.'), { status: 422 });
  const listing = await LISTINGS_REF(uid).doc(proposal.listingId).get();
  if (!listing.exists || listing.data()?.contentHash !== proposal.baseContentHash) throw Object.assign(new Error('O anúncio mudou. Sincronize e revise a proposta novamente.'), { status: 409 });

  const now = new Date().toISOString();
  const run: MeliMutationRun = {
    id: ref.id, proposalId, listingId: proposal.listingId, idempotencyKey: key, status: 'queued',
    sanitizedRequest: {}, sanitizedResponse: null, warnings: [], differences: [],
    approvedChangeIds: approved.map((change) => change.id), appliedChangeIds: [], verifiedChangeIds: [],
    beforeSnapshotId: null, afterSnapshotId: null, error: null, startedAt: null, completedAt: null,
    processingLeaseId: null, processingLeaseUntil: null, createdAt: now, updatedAt: now,
  };
  const created = await adminDb.runTransaction(async (tx) => {
    const [current, currentRun] = await Promise.all([
      tx.get(PROPOSALS_REF(uid).doc(proposalId)), tx.get(ref),
    ]);
    if (currentRun.exists) return false;
    if (!current.exists || !['approved', 'partially_approved', 'failed'].includes(current.data()?.status)) {
      throw Object.assign(new Error('A proposta já está sendo processada ou não está pronta.'), { status: 409 });
    }
    tx.set(ref, run);
    tx.set(current.ref, { status: 'applying', lastMutationRunId: ref.id, updatedAt: now }, { merge: true });
    tx.set(LISTINGS_REF(uid).doc(proposal.listingId), {
      proposalSummary: { proposalId: proposal.id, version: proposal.version, status: 'applying', changeCount: proposal.changeCount, updatedAt: now },
    }, { merge: true });
    return true;
  });
  if (!created) {
    const current = await ref.get();
    return publicRun(current.data() as MeliMutationRun);
  }
  return run;
}

async function finishRun(uid: string, runRef: FirebaseFirestore.DocumentReference, proposal: MeliListingProposal, patch: Partial<MeliMutationRun>, proposalStatus: MeliListingProposal['status']): Promise<void> {
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  batch.set(runRef, { ...jsonSafe(patch), status: patch.status, completedAt: now, updatedAt: now, processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
  batch.set(PROPOSALS_REF(uid).doc(proposal.id), { status: proposalStatus, lastMutationRunId: runRef.id, updatedAt: now }, { merge: true });
  batch.set(LISTINGS_REF(uid).doc(proposal.listingId), {
    proposalSummary: { proposalId: proposal.id, version: proposal.version, status: proposalStatus, changeCount: proposal.changeCount, updatedAt: now },
  }, { merge: true });
  batch.set(AUDIT_REF(uid).doc(), {
    actorType: 'user', actorId: uid, action: `meli.proposal.${proposalStatus}`,
    resourceType: 'meli_listing_proposal', resourceId: proposal.id,
    metadata: { mutationRunId: runRef.id, listingId: proposal.listingId }, createdAt: now,
  });
  await batch.commit();
}

export async function runMutation(uid: string, runId: string): Promise<void> {
  const runRef = MUTATIONS_REF(uid).doc(runId);
  const leaseId = crypto.randomUUID();
  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) return null;
    const run = snap.data() as MeliMutationRun;
    if (!['queued', 'running', 'verifying'].includes(run.status)) return null;
    if (run.processingLeaseUntil && run.processingLeaseUntil > Date.now()) return null;
    tx.set(runRef, {
      status: 'running', startedAt: run.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      processingLeaseId: leaseId, processingLeaseUntil: Date.now() + 10 * 60 * 1000,
    }, { merge: true });
    return run;
  });
  if (!claimed) return;

  let proposal: MeliListingProposal | null = null;
  try {
    const [proposalSnap, changesSnap] = await Promise.all([
      PROPOSALS_REF(uid).doc(claimed.proposalId).get(),
      CHANGES_REF(uid).where('proposalId', '==', claimed.proposalId).get(),
    ]);
    if (!proposalSnap.exists) throw new Error('Proposta não encontrada.');
    proposal = proposalSnap.data() as MeliListingProposal;
    const proposalChanges = changesSnap.docs.map((doc) => doc.data() as MeliListingChange);
    const approved = proposalChanges.filter((change) => claimed.approvedChangeIds.includes(change.id) && change.approvalStatus === 'approved');
    if (approved.length !== claimed.approvedChangeIds.length) throw new Error('As aprovações da proposta mudaram antes da publicação.');
    const [secretSnap, listingSnap] = await Promise.all([MELI_SECRET_REF(uid).get(), LISTINGS_REF(uid).doc(proposal.listingId).get()]);
    if (!secretSnap.exists || !listingSnap.exists) throw new Error('Conexão ou anúncio local não encontrado.');
    const secret = secretSnap.data() as MeliConnectionSecret;
    if (secret.status !== 'active' || !hasWriteScope(secret.scopes)) throw Object.assign(new Error('Reconecte o Mercado Livre com permissão de leitura e escrita.'), { status: 403 });
    if (!claimed.beforeSnapshotId && listingSnap.data()?.contentHash !== proposal.baseContentHash) {
      throw Object.assign(new Error('O anúncio mudou antes da publicação.'), { status: 409 });
    }
    const client = new MeliApiClient(uid);
    const before = await fetchLive(client, proposal.listingId);
    if (String(before.item.seller_id) !== secret.sellerId) throw Object.assign(new Error('O anúncio não pertence ao seller autenticado.'), { status: 403 });
    if (approved.some((change) => change.fieldPath === 'title') && Number(before.item.sold_quantity || 0) > 0) {
      throw Object.assign(new Error('O título não pode ser alterado porque o anúncio já possui vendas.'), { status: 409 });
    }
    if (!proposal.baseSnapshotId) throw Object.assign(new Error('A proposta não possui snapshot-base e não pode ser publicada.'), { status: 409 });

    // A process may restart after the provider accepted a write but before the
    // run was finalized. Reconcile first and never blindly repeat an ambiguous
    // mutation. PUTs can then be retried only when no requested value appeared.
    if (claimed.beforeSnapshotId) {
      const mutationSnapshot = await SNAPSHOTS_REF(uid).doc(claimed.beforeSnapshotId).get();
      const snapshotItem = (mutationSnapshot.data()?.item || {}) as Record<string, any>;
      let observed = before;
      let observedIds = approved.filter((change) => verifyChange(change, snapshotItem, observed.item, observed.description)).map((change) => change.id);
      if (claimed.status === 'verifying') {
        for (const waitMs of [500, 1_500]) {
          if (observedIds.length === approved.length) break;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          observed = await fetchLive(client, proposal.listingId);
          observedIds = approved.filter((change) => verifyChange(change, snapshotItem, observed.item, observed.description)).map((change) => change.id);
        }
      }
      if (claimed.status === 'verifying' || observedIds.length || claimed.appliedChangeIds.length) {
        const afterSnapshotId = await captureSnapshot(uid, proposal.listingId, 'after_mutation', observed);
        const succeeded = observedIds.length === approved.length;
        const partial = !succeeded && (observedIds.length > 0 || claimed.appliedChangeIds.length > 0);
        const status: MeliMutationRun['status'] = succeeded ? 'succeeded' : partial ? 'partial' : 'failed';
        const proposalStatus: MeliListingProposal['status'] = succeeded ? 'applied' : partial ? 'partially_applied' : 'failed';
        await finishRun(uid, runRef, proposal, {
          status, appliedChangeIds: [...new Set([...claimed.appliedChangeIds, ...observedIds])], verifiedChangeIds: observedIds,
          beforeSnapshotId: claimed.beforeSnapshotId, afterSnapshotId,
          differences: approved.filter((change) => !observedIds.includes(change.id)).map((change) => `Não confirmado: ${change.fieldPath}`),
          error: succeeded ? null : 'Execução retomada e reconciliada pela releitura do Mercado Livre.',
        }, proposalStatus);
        try { await refreshListingNow(uid, proposal.listingId); } catch { /* the mutation result remains authoritative */ }
        return;
      }
    }
    const baseSnapshot = await SNAPSHOTS_REF(uid).doc(proposal.baseSnapshotId).get();
    if (!baseSnapshot.exists) throw Object.assign(new Error('O snapshot-base da proposta não foi encontrado.'), { status: 409 });
    const base = baseSnapshot.data() || {};
    if (!sameJson(mutationFingerprint(base.item || {}, base.description || null), mutationFingerprint(before.item, before.description))) {
      await PROPOSALS_REF(uid).doc(proposal.id).set({ status: 'stale', updatedAt: new Date().toISOString() }, { merge: true });
      throw Object.assign(new Error('O anúncio divergiu do snapshot revisado. Sincronize e gere uma nova proposta.'), { status: 409 });
    }
    const beforeSnapshotId = await captureSnapshot(uid, proposal.listingId, 'before_mutation', before);
    const itemChanges = approved.filter((change) => change.resource === 'item');
    const descriptionChanges = approved.filter((change) => change.resource === 'description');
    const itemPayload: Record<string, unknown> = {};
    const title = itemChanges.find((change) => change.fieldPath === 'title');
    if (title) itemPayload.title = title.newValue;
    if (itemChanges.some((change) => change.fieldPath.startsWith('attributes.'))) itemPayload.attributes = mergeMeliEntries(before.item.attributes, itemChanges, 'attributes.');
    if (itemChanges.some((change) => change.fieldPath.startsWith('sale_terms.'))) itemPayload.sale_terms = mergeMeliEntries(before.item.sale_terms, itemChanges, 'sale_terms.');
    const pictureBuild = buildPictures(before.item.pictures, before.item.variations, itemChanges);
    if (pictureBuild.touched) itemPayload.pictures = pictureBuild.pictures;
    const descriptionValue = descriptionChanges[0]?.newValue;
    const sanitizedRequest = jsonSafe({
      ...(Object.keys(itemPayload).length ? { item: itemPayload } : {}),
      ...(descriptionChanges.length ? { description: { plain_text: descriptionValue } } : {}),
    });
    await runRef.set({ sanitizedRequest, beforeSnapshotId, updatedAt: new Date().toISOString() }, { merge: true });

    const appliedChangeIds: string[] = [];
    const responsePayload: Record<string, unknown> = {};
    const warnings: string[] = [];
    const operationErrors: string[] = [];
    if (Object.keys(itemPayload).length) {
      try {
        const response = await client.put<Record<string, unknown>>(`/items/${encodeURIComponent(proposal.listingId)}`, itemPayload);
        responsePayload.item = response;
        warnings.push(...warningsFrom(response));
        appliedChangeIds.push(...itemChanges.map((change) => change.id));
      } catch (error) {
        operationErrors.push(`Item: ${sanitizeError(error)}`);
      }
    }
    if (descriptionChanges.length) {
      try {
        const path = `/items/${encodeURIComponent(proposal.listingId)}/description${before.description ? '?api_version=2' : ''}`;
        const response = before.description
          ? await client.put<Record<string, unknown>>(path, { plain_text: descriptionValue })
          : await client.post<Record<string, unknown>>(path, { plain_text: descriptionValue });
        responsePayload.description = response;
        warnings.push(...warningsFrom(response));
        appliedChangeIds.push(...descriptionChanges.map((change) => change.id));
      } catch (error) {
        operationErrors.push(`Descrição: ${sanitizeError(error)}`);
      }
    }

    await runRef.set({ status: 'verifying', appliedChangeIds, warnings, sanitizedResponse: jsonSafe(responsePayload), updatedAt: new Date().toISOString() }, { merge: true });
    let after = await fetchLive(client, proposal.listingId);
    let verifiedChangeIds = approved.filter((change) => verifyChange(change, before.item, after.item, after.description)).map((change) => change.id);
    for (const waitMs of [500, 1_500]) {
      if (verifiedChangeIds.length === approved.length) break;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      after = await fetchLive(client, proposal.listingId);
      verifiedChangeIds = approved.filter((change) => verifyChange(change, before.item, after.item, after.description)).map((change) => change.id);
    }
    verifiedChangeIds.forEach((changeId) => { if (!appliedChangeIds.includes(changeId)) appliedChangeIds.push(changeId); });
    const differences = approved.filter((change) => !verifiedChangeIds.includes(change.id)).map((change) => `Não confirmado: ${change.fieldPath}`);
    const afterSnapshotId = await captureSnapshot(uid, proposal.listingId, 'after_mutation', after);
    const succeeded = verifiedChangeIds.length === approved.length;
    const partial = !succeeded && (appliedChangeIds.length > 0 || verifiedChangeIds.length > 0);
    const status: MeliMutationRun['status'] = succeeded ? 'succeeded' : partial ? 'partial' : 'failed';
    const proposalStatus: MeliListingProposal['status'] = succeeded ? 'applied' : partial ? 'partially_applied' : 'failed';
    await finishRun(uid, runRef, proposal, {
      status, appliedChangeIds, verifiedChangeIds, beforeSnapshotId, afterSnapshotId,
      warnings, differences, sanitizedResponse: jsonSafe(responsePayload),
      error: operationErrors.length ? operationErrors.join(' | ') : differences.length ? 'Nem todas as mudanças foram confirmadas na releitura.' : null,
    }, proposalStatus);
    try {
      await refreshListingNow(uid, proposal.listingId);
    } catch (error) {
      await runRef.set({ warnings: [...warnings, `A atualização local posterior falhou: ${sanitizeError(error)}`] }, { merge: true });
    }
  } catch (error) {
    const message = sanitizeError(error);
    if (proposal) {
      const current = await PROPOSALS_REF(uid).doc(proposal.id).get();
      const currentStatus = current.data()?.status;
      await finishRun(uid, runRef, proposal, { status: 'failed', error: message }, currentStatus === 'stale' ? 'stale' : 'failed');
    }
    else await runRef.set({ status: 'failed', error: message, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
  }
}

const mutationQueue: Array<{ uid: string; runId: string }> = [];
let activeMutations = 0;

function drainMutationQueue(): void {
  while (activeMutations < 2 && mutationQueue.length) {
    const next = mutationQueue.shift()!;
    activeMutations += 1;
    void runMutation(next.uid, next.runId).finally(() => {
      activeMutations -= 1;
      drainMutationQueue();
    });
  }
}

export function scheduleMutation(uid: string, runId: string): void {
  if (mutationQueue.some((entry) => entry.uid === uid && entry.runId === runId)) return;
  mutationQueue.push({ uid, runId });
  setImmediate(drainMutationQueue);
}

export async function getMutationRun(uid: string, runId: string): Promise<MeliMutationRun | null> {
  const snap = await MUTATIONS_REF(uid).doc(runId).get();
  return snap.exists ? publicRun(snap.data() as MeliMutationRun) : null;
}

export async function createRollbackProposal(uid: string, proposalId: string): Promise<{ proposal: MeliListingProposal; changes: MeliListingChange[] }> {
  const originalResult = await getProposal(uid, proposalId);
  if (!originalResult || !['applied', 'partially_applied'].includes(originalResult.proposal.status)) {
    throw Object.assign(new Error('Somente propostas aplicadas podem originar uma reversão.'), { status: 409 });
  }
  const runId = originalResult.proposal.lastMutationRunId;
  if (!runId) throw Object.assign(new Error('A execução da proposta não foi encontrada.'), { status: 409 });
  const run = await getMutationRun(uid, runId);
  if (!run?.beforeSnapshotId || !run.verifiedChangeIds.length) throw Object.assign(new Error('Não há mudanças verificadas que possam ser revertidas.'), { status: 409 });
  const previousRollbacks = await PROPOSALS_REF(uid).where('rollbackOfProposalId', '==', proposalId).get();
  const reusable = previousRollbacks.docs.map((doc) => doc.data() as MeliListingProposal)
    .filter((candidate) => !['rejected', 'failed', 'stale'].includes(candidate.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (reusable) {
    const existing = await getProposal(uid, reusable.id);
    if (existing && existing.proposal.status !== 'stale') return existing;
  }
  const beforeSnapshot = await SNAPSHOTS_REF(uid).doc(run.beforeSnapshotId).get();
  if (!beforeSnapshot.exists) throw Object.assign(new Error('O snapshot anterior não foi encontrado.'), { status: 409 });
  const refreshed = await refreshListingNow(uid, originalResult.proposal.listingId);
  const rollbackBase = await captureSnapshot(uid, refreshed.itemId, 'rollback', {
    item: refreshed.rawItem as Record<string, any>,
    description: { plain_text: refreshed.descriptionPlainText },
  });
  const originalChanges = originalResult.changes.filter((change) => run.verifiedChangeIds.includes(change.id));
  const now = new Date().toISOString();
  const proposalRef = PROPOSALS_REF(uid).doc();
  const existing = await PROPOSALS_REF(uid).where('listingId', '==', refreshed.itemId).get();
  const version = await adminDb.runTransaction(async (tx) => {
    const listingRef = LISTINGS_REF(uid).doc(refreshed.itemId);
    const current = await tx.get(listingRef);
    const next = Math.max(Number(current.data()?.proposalVersion || 0), existing.size) + 1;
    tx.set(listingRef, { proposalVersion: next }, { merge: true });
    return next;
  });
  const rollbackDrafts: Array<Omit<MeliListingChange, 'id' | 'proposalId' | 'createdAt'>> = [];
  for (const change of originalChanges.filter((candidate) => !candidate.fieldPath.startsWith('pictures.'))) {
    if (change.fieldPath === 'description.plain_text' && change.oldValue == null) continue;
    const risk = riskForChange(change.fieldPath, 'Reversão de uma mudança aplicada anteriormente.');
    rollbackDrafts.push({
      fieldPath: change.fieldPath, resource: change.resource,
      changeType: change.changeType === 'add' ? 'remove' : 'replace',
      oldValue: currentLogicalValue(refreshed, change), newValue: change.oldValue,
      reason: `Reverter a mudança aplicada pela proposta v${originalResult.proposal.version}.`,
      evidence: [`Snapshot anterior ${run.beforeSnapshotId}`], confidence: 1,
      ...risk, approvalStatus: 'pending', approvedBy: null, approvedAt: null,
    });
  }
  if (originalChanges.some((change) => change.fieldPath.startsWith('pictures.'))) {
    const oldPictures = pictureIds((beforeSnapshot.data() as any)?.item?.pictures).map((id) => ({ id }));
    rollbackDrafts.push({
      fieldPath: 'pictures.rollback', resource: 'item', changeType: 'replace',
      oldValue: refreshed.pictures, newValue: { action: 'restore', pictures: oldPictures },
      reason: `Restaurar somente a ordem e o conjunto de imagens do snapshot anterior à proposta v${originalResult.proposal.version}.`,
      evidence: [`Snapshot anterior ${run.beforeSnapshotId}`], confidence: 0.9,
      riskLevel: 'high', requiresConfirmation: true, approvalStatus: 'pending', approvedBy: null, approvedAt: null,
    });
  }
  if (!rollbackDrafts.length) throw Object.assign(new Error('Nenhuma mudança desta execução possui reversão segura disponível.'), { status: 422 });
  const proposal: MeliListingProposal = {
    id: proposalRef.id, listingId: refreshed.itemId, analysisId: originalResult.proposal.analysisId,
    baseSnapshotId: rollbackBase, baseContentHash: refreshed.contentHash, version, status: 'awaiting_review',
    summary: `${rollbackDrafts.length} mudança(s) de reversão aguardando nova aprovação humana.`,
    impactScope: originalResult.proposal.impactScope, createdByType: 'user',
    changeCount: rollbackDrafts.length, approvedCount: 0, rejectedCount: 0,
    rollbackOfProposalId: originalResult.proposal.id, lastMutationRunId: null,
    createdAt: now, updatedAt: now,
  };
  const batch = adminDb.batch();
  batch.set(proposalRef, proposal);
  const changes = rollbackDrafts.map((draft) => {
    const ref = CHANGES_REF(uid).doc();
    const change: MeliListingChange = { id: ref.id, proposalId: proposal.id, ...draft, createdAt: now };
    batch.set(ref, jsonSafe(change));
    return change;
  });
  batch.set(LISTINGS_REF(uid).doc(refreshed.itemId), {
    proposalVersion: version,
    proposalSummary: { proposalId: proposal.id, version, status: proposal.status, changeCount: changes.length, updatedAt: now },
  }, { merge: true });
  batch.set(AUDIT_REF(uid).doc(), {
    actorType: 'user', actorId: uid, action: 'meli.rollback_proposal.created',
    resourceType: 'meli_listing_proposal', resourceId: proposal.id,
    metadata: { rollbackOfProposalId: proposalId, mutationRunId: runId }, createdAt: now,
  });
  await batch.commit();
  return { proposal, changes };
}
