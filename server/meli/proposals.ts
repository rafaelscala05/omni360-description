import { adminDb } from '../firebaseAdmin';
import type {
  MeliAnalysisRecord,
  MeliApprovalStatus,
  MeliChangeRisk,
  MeliListingChange,
  MeliListingProposal,
  MeliListingRecord,
  MeliProposalStatus,
} from './types';
import { jsonSafe } from './utils';
import { collectProposalCandidates } from '../../src/modules/meli/proposalCandidates';
import { validateSuggestedDescription, validateSuggestedTitle } from './rules';

const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const ANALYSES_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_analyses');
const PROPOSALS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_proposals');
const CHANGES_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_changes');
const AUDIT_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_audit_events');

const HIGH_RISK_IDS = /(?:GTIN|EAN|UPC|MPN|PART_NUMBER|COMPATIB|CERTIFIC|ANATEL|WARRANTY|GARANTIA)/i;

function asObjects(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object')) : [];
}

function currentValue(entries: unknown, id: string): unknown {
  const match = asObjects(entries).find((entry) => String(entry.id) === id);
  if (!match) return null;
  return { id, valueId: match.value_id ?? null, valueName: match.value_name ?? null };
}

export function riskForChange(fieldPath: string, reason = ''): { riskLevel: MeliChangeRisk; requiresConfirmation: boolean } {
  if (fieldPath === 'category_id' || fieldPath.startsWith('price') || fieldPath.startsWith('available_quantity')) {
    return { riskLevel: 'blocked', requiresConfirmation: true };
  }
  if (fieldPath === 'title') return { riskLevel: 'high', requiresConfirmation: true };
  if (fieldPath === 'description.plain_text') {
    const spellingOnly = /ortogr[aá]f|pontua[cç][aã]o|typo/i.test(reason);
    return { riskLevel: spellingOnly ? 'low' : 'medium', requiresConfirmation: false };
  }
  if (fieldPath.startsWith('pictures.')) return {
    riskLevel: /remove|replace|main|principal/i.test(`${fieldPath} ${reason}`) ? 'high' : 'medium',
    requiresConfirmation: /remove|replace|main|principal/i.test(`${fieldPath} ${reason}`),
  };
  if (HIGH_RISK_IDS.test(fieldPath)) return { riskLevel: 'high', requiresConfirmation: true };
  if (fieldPath.startsWith('attributes.') || fieldPath.startsWith('sale_terms.')) return { riskLevel: 'medium', requiresConfirmation: false };
  return { riskLevel: 'medium', requiresConfirmation: false };
}

export function proposalStatus(approvals: MeliApprovalStatus[]): MeliProposalStatus {
  if (!approvals.length) return 'draft';
  const approved = approvals.filter((status) => status === 'approved').length;
  const rejected = approvals.filter((status) => status === 'rejected').length;
  const pending = approvals.length - approved - rejected;
  if (approved === approvals.length) return 'approved';
  if (rejected === approvals.length) return 'rejected';
  if (approved === 0 && pending > 0) return 'awaiting_review';
  if (approved > 0 && pending === 0) return 'partially_approved';
  if (approved > 0 || rejected > 0) return 'partially_approved';
  return 'awaiting_review';
}

async function impactScope(uid: string, listing: MeliListingRecord) {
  const allListings = await LISTINGS_REF(uid).get();
  const localRelatedItemIds = listing.userProductId
    ? allListings.docs.map((doc) => doc.data() as MeliListingRecord)
      .filter((candidate) => candidate.userProductId === listing.userProductId && candidate.itemId !== listing.itemId)
      .map((candidate) => candidate.itemId)
    : [];
  const relatedItemIds = [...new Set([...(listing.relatedItemIds || []), ...localRelatedItemIds])]
    .filter((itemId) => itemId !== listing.itemId);
  const warnings: string[] = [];
  const catalogControlledFields: string[] = [];
  if (listing.catalogProductId) {
    warnings.push('Este anúncio pertence ao catálogo; título e outros campos podem ser controlados pelo Mercado Livre.');
    catalogControlledFields.push('title');
  }
  if (listing.userProductId) warnings.push('Campos compartilhados podem alcançar outros anúncios do mesmo User Product.');
  if (asObjects(listing.variations).length) warnings.push('Alterações de atributos e imagens devem preservar as variações existentes.');
  return {
    userProductId: listing.userProductId,
    familyId: listing.familyId,
    catalogProductId: listing.catalogProductId,
    variationCount: asObjects(listing.variations).length,
    relatedItemIds,
    catalogControlledFields,
    warnings,
  };
}

function changeDrafts(listing: MeliListingRecord, analysis: MeliAnalysisRecord): Array<Omit<MeliListingChange, 'id' | 'proposalId' | 'createdAt'>> {
  const changes: Array<Omit<MeliListingChange, 'id' | 'proposalId' | 'createdAt'>> = [];
  const candidates = collectProposalCandidates(listing, analysis);
  const add = (draft: Omit<MeliListingChange, 'id' | 'proposalId' | 'createdAt' | 'riskLevel' | 'requiresConfirmation'>) => {
    const risk = riskForChange(draft.fieldPath, draft.reason);
    changes.push({ ...draft, ...risk });
  };
  const title = candidates.title ? validateSuggestedTitle(candidates.title.value, listing) : null;
  if (title) add({
    fieldPath: 'title', resource: 'item', changeType: 'replace', oldValue: listing.title,
    newValue: title,
    reason: candidates.title?.source === 'rule'
      ? 'Remoção determinística de linguagem promocional ou símbolos ornamentais.'
      : 'Título reorganizado a partir dos fatos sincronizados.',
    evidence: [listing.title], confidence: candidates.title?.source === 'rule' ? 1 : 0.8,
    approvalStatus: 'pending', approvedBy: null, approvedAt: null,
  });
  const description = candidates.description ? validateSuggestedDescription(candidates.description.value, listing) : null;
  if (description) add({
    fieldPath: 'description.plain_text', resource: 'description',
    changeType: listing.descriptionPlainText ? 'replace' : 'add', oldValue: listing.descriptionPlainText || null,
    newValue: description,
    reason: candidates.description?.source === 'rule'
      ? 'Conversão determinística do HTML atual para texto simples, sem acrescentar fatos.'
      : 'Descrição estruturada somente com fatos validados.',
    evidence: analysis.findings.filter((finding) => finding.fieldPath.startsWith('description')).flatMap((finding) => finding.evidence).slice(0, 8),
    confidence: candidates.description?.source === 'rule' ? 1 : 0.85,
    approvalStatus: 'pending', approvedBy: null, approvedAt: null,
  });
  candidates.attributes.forEach((suggestion) => add({
    fieldPath: `attributes.${suggestion.id}`, resource: 'item',
    changeType: currentValue(listing.attributes, suggestion.id) ? 'replace' : 'add',
    oldValue: currentValue(listing.attributes, suggestion.id),
    newValue: { id: suggestion.id, valueId: suggestion.valueId, valueName: suggestion.valueName },
    reason: suggestion.reason, evidence: suggestion.evidence, confidence: 0.9,
    approvalStatus: 'pending', approvedBy: null, approvedAt: null,
  }));
  candidates.saleTerms.forEach((suggestion) => add({
    fieldPath: `sale_terms.${suggestion.id}`, resource: 'item',
    changeType: currentValue(listing.saleTerms, suggestion.id) ? 'replace' : 'add',
    oldValue: currentValue(listing.saleTerms, suggestion.id),
    newValue: { id: suggestion.id, valueId: suggestion.valueId, valueName: suggestion.valueName },
    reason: suggestion.reason, evidence: suggestion.evidence, confidence: 0.9,
    approvalStatus: 'pending', approvedBy: null, approvedAt: null,
  }));
  candidates.picturePlan.forEach((plan, index) => add({
    fieldPath: plan.pictureId ? `pictures.${plan.pictureId}` : `pictures.plan.${index}`,
    resource: 'item', changeType: plan.action === 'reorder' ? 'reorder' : plan.action === 'remove' ? 'remove' : plan.action === 'create' ? 'add' : 'replace',
    oldValue: plan.pictureId ? asObjects(listing.pictures).find((picture) => String(picture.id) === plan.pictureId) || null : null,
    newValue: { action: plan.action, pictureId: plan.pictureId, ...(plan.targetOrder ? { targetOrder: plan.targetOrder } : {}) }, reason: plan.reason, evidence: [], confidence: 0.7,
    approvalStatus: 'pending', approvedBy: null, approvedAt: null,
  }));
  return changes;
}

async function latestCompletedAnalysis(uid: string, itemId: string): Promise<MeliAnalysisRecord | null> {
  const snap = await ANALYSES_REF(uid).where('listingId', '==', itemId).get();
  return snap.docs.map((doc) => doc.data() as MeliAnalysisRecord)
    .filter((analysis) => analysis.status === 'completed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

// Operator-authored starting points for when the audit produced nothing safe to
// propose. Every seed is high risk and needs an explicit factual confirmation,
// and the operator edits it through the normal editChange path.
export function manualDrafts(
  listing: MeliListingRecord,
  analysis: MeliAnalysisRecord,
  existing: Array<{ fieldPath: string }>,
): Array<Omit<MeliListingChange, 'id' | 'proposalId' | 'createdAt'>> {
  const drafts: Array<Omit<MeliListingChange, 'id' | 'proposalId' | 'createdAt'>> = [];
  const base = { resource: 'item' as const, confidence: 0, riskLevel: 'high' as const, requiresConfirmation: true,
    approvalStatus: 'pending' as const, approvedBy: null, approvedAt: null };
  if (!existing.some((change) => change.fieldPath === 'description.plain_text')) {
    const discarded = analysis.suggestions.discardedDescription;
    drafts.push({
      ...base, fieldPath: 'description.plain_text', resource: 'description',
      changeType: listing.descriptionPlainText ? 'replace' : 'add', oldValue: listing.descriptionPlainText || null,
      newValue: discarded?.value || listing.descriptionPlainText || '',
      reason: discarded
        ? `Rascunho da IA descartado pela validação (${discarded.reason}) e devolvido para revisão manual. Remova ou confirme cada afirmação.`
        : 'Ponto de partida para escrita manual. Preencha somente com fatos que você pode confirmar.',
      evidence: [],
    });
  }
  if (!existing.some((change) => change.fieldPath === 'title') && listing.soldQuantity === 0 && !listing.catalogProductId) {
    drafts.push({
      ...base, fieldPath: 'title', changeType: 'replace', oldValue: listing.title, newValue: listing.title,
      reason: 'Ponto de partida para escrita manual do título. Rejeite se não quiser alterá-lo.', evidence: [listing.title],
    });
  }
  return drafts;
}

export async function createProposal(uid: string, itemId: string, requestedAnalysisId?: string, options: { manual?: boolean } = {}): Promise<{ proposal: MeliListingProposal; changes: MeliListingChange[] }> {
  const normalizedId = itemId.toUpperCase();
  const listingSnap = await LISTINGS_REF(uid).doc(normalizedId).get();
  if (!listingSnap.exists) throw Object.assign(new Error('Anúncio não encontrado.'), { status: 404 });
  const listing = listingSnap.data() as MeliListingRecord;
  let analysis: MeliAnalysisRecord | null = null;
  if (requestedAnalysisId) {
    const snap = await ANALYSES_REF(uid).doc(requestedAnalysisId).get();
    analysis = snap.exists ? snap.data() as MeliAnalysisRecord : null;
  } else analysis = await latestCompletedAnalysis(uid, normalizedId);
  if (!analysis || analysis.listingId !== normalizedId || analysis.status !== 'completed') {
    throw Object.assign(new Error('Execute uma auditoria concluída antes de criar a proposta.'), { status: 409 });
  }
  if (analysis.contentHash !== listing.contentHash) throw Object.assign(new Error('A auditoria está desatualizada. Sincronize e analise novamente.'), { status: 409 });
  const drafts = changeDrafts(listing, analysis);
  if (options.manual) drafts.push(...manualDrafts(listing, analysis, drafts));
  if (!drafts.length) {
    const message = analysis.aiStatus === 'failed'
      ? 'A auditoria foi concluída sem sugestões da IA. Execute “Analisar novamente” antes de criar a proposta.'
      : analysis.questions.length
        ? 'Não há mudanças seguras enquanto as informações factuais pendentes não forem confirmadas.'
        : 'A auditoria não identificou alterações seguras e diferentes do anúncio atual.';
    throw Object.assign(new Error(message), { status: analysis.aiStatus === 'failed' ? 409 : 422 });
  }

  const existing = await PROPOSALS_REF(uid).where('listingId', '==', normalizedId).get();
  const version = await adminDb.runTransaction(async (tx) => {
    const current = await tx.get(LISTINGS_REF(uid).doc(normalizedId));
    if (!current.exists || current.data()?.contentHash !== listing.contentHash) {
      throw Object.assign(new Error('O anúncio mudou durante a criação da proposta.'), { status: 409 });
    }
    const next = Math.max(Number(current.data()?.proposalVersion || 0), existing.size) + 1;
    tx.set(current.ref, { proposalVersion: next }, { merge: true });
    return next;
  });
  const ref = PROPOSALS_REF(uid).doc();
  const now = new Date().toISOString();
  const scope = await impactScope(uid, listing);
  const proposal: MeliListingProposal = {
    id: ref.id, listingId: normalizedId, analysisId: analysis.id, baseSnapshotId: analysis.snapshotId,
    baseContentHash: listing.contentHash, version, status: 'awaiting_review',
    summary: `${drafts.length} mudança(s) candidata(s) gerada(s) pela auditoria Alfreds.`,
    impactScope: scope, createdByType: 'ai', changeCount: drafts.length,
    approvedCount: 0, rejectedCount: 0, createdAt: now, updatedAt: now,
  };
  const batch = adminDb.batch();
  batch.set(ref, jsonSafe(proposal));
  const changes = drafts.map((draft) => {
    const changeRef = CHANGES_REF(uid).doc();
    let change: MeliListingChange = { id: changeRef.id, proposalId: ref.id, ...draft, createdAt: now };
    if (scope.catalogControlledFields.includes(change.fieldPath)) {
      change = { ...change, riskLevel: 'blocked', requiresConfirmation: true, approvalStatus: 'rejected', reason: `${change.reason} Campo potencialmente controlado pelo catálogo.` };
    }
    batch.set(changeRef, jsonSafe(change));
    return change;
  });
  const initialStatuses = changes.map((change) => change.approvalStatus);
  proposal.status = proposalStatus(initialStatuses);
  proposal.rejectedCount = initialStatuses.filter((status) => status === 'rejected').length;
  batch.set(ref, jsonSafe(proposal));
  batch.set(AUDIT_REF(uid).doc(), {
    actorType: 'user', actorId: uid, action: 'meli.proposal.created', resourceType: 'meli_listing_proposal', resourceId: ref.id,
    metadata: { listingId: normalizedId, analysisId: analysis.id, version, changeCount: changes.length }, createdAt: now,
  });
  await batch.commit();
  await LISTINGS_REF(uid).doc(normalizedId).set({ proposalSummary: { proposalId: ref.id, version, status: proposal.status, changeCount: changes.length, updatedAt: now } }, { merge: true });
  return { proposal, changes };
}

async function changesForProposal(uid: string, proposalId: string): Promise<MeliListingChange[]> {
  const snap = await CHANGES_REF(uid).where('proposalId', '==', proposalId).get();
  return snap.docs.map((doc) => doc.data() as MeliListingChange).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getProposal(uid: string, proposalId: string): Promise<{ proposal: MeliListingProposal; changes: MeliListingChange[] } | null> {
  const proposalSnap = await PROPOSALS_REF(uid).doc(proposalId).get();
  if (!proposalSnap.exists) return null;
  let proposal = proposalSnap.data() as MeliListingProposal;
  const listing = await LISTINGS_REF(uid).doc(proposal.listingId).get();
  if (listing.exists && listing.data()?.contentHash !== proposal.baseContentHash
    && !['stale', 'applied', 'partially_applied', 'failed', 'rejected'].includes(proposal.status)) {
    proposal = { ...proposal, status: 'stale', updatedAt: new Date().toISOString() };
    await proposalSnap.ref.set({ status: 'stale', updatedAt: proposal.updatedAt }, { merge: true });
  }
  return { proposal, changes: await changesForProposal(uid, proposalId) };
}

export async function getLatestProposal(uid: string, itemId: string) {
  const snap = await PROPOSALS_REF(uid).where('listingId', '==', itemId.toUpperCase()).get();
  const latest = snap.docs.map((doc) => doc.data() as MeliListingProposal).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? getProposal(uid, latest.id) : null;
}

export async function markListingProposalsStale(uid: string, itemId: string): Promise<void> {
  const snap = await PROPOSALS_REF(uid).where('listingId', '==', itemId.toUpperCase()).get();
  if (snap.empty) return;
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  snap.docs.forEach((doc) => {
    const status = (doc.data() as MeliListingProposal).status;
    if (!['stale', 'applied', 'partially_applied', 'failed', 'rejected'].includes(status)) {
      batch.set(doc.ref, { status: 'stale', updatedAt: now }, { merge: true });
    }
  });
  await batch.commit();
}

export async function decideChange(
  uid: string,
  proposalId: string,
  changeId: string,
  approvalStatus: Exclude<MeliApprovalStatus, 'pending'>,
  confirmed: boolean,
): Promise<{ proposal: MeliListingProposal; changes: MeliListingChange[] }> {
  const proposalRef = PROPOSALS_REF(uid).doc(proposalId);
  const changeRef = CHANGES_REF(uid).doc(changeId);
  const proposalBefore = await proposalRef.get();
  if (!proposalBefore.exists) throw Object.assign(new Error('Proposta não encontrada.'), { status: 404 });
  const proposalData = proposalBefore.data() as MeliListingProposal;
  const listingBefore = await LISTINGS_REF(uid).doc(proposalData.listingId).get();
  if (!listingBefore.exists || listingBefore.data()?.contentHash !== proposalData.baseContentHash) {
    await proposalRef.set({ status: 'stale', updatedAt: new Date().toISOString() }, { merge: true });
    throw Object.assign(new Error('O anúncio mudou. A proposta foi marcada como desatualizada.'), { status: 409 });
  }
  const outcome = await adminDb.runTransaction(async (tx) => {
    const [proposalSnap, changeSnap, changesSnap, listingSnap] = await Promise.all([
      tx.get(proposalRef), tx.get(changeRef), tx.get(CHANGES_REF(uid).where('proposalId', '==', proposalId)),
      tx.get(LISTINGS_REF(uid).doc(proposalData.listingId)),
    ]);
    if (!proposalSnap.exists || !changeSnap.exists) throw Object.assign(new Error('Proposta ou mudança não encontrada.'), { status: 404 });
    const proposal = proposalSnap.data() as MeliListingProposal;
    const change = changeSnap.data() as MeliListingChange;
    if (change.proposalId !== proposalId) throw Object.assign(new Error('A mudança não pertence à proposta.'), { status: 409 });
    if (['stale', 'applying', 'applied', 'partially_applied'].includes(proposal.status)) {
      throw Object.assign(new Error('Esta proposta não pode mais ser revisada neste estado.'), { status: 409 });
    }
    if (!listingSnap.exists || listingSnap.data()?.contentHash !== proposal.baseContentHash) {
      tx.set(proposalRef, { status: 'stale', updatedAt: new Date().toISOString() }, { merge: true });
      return 'stale' as const;
    }
    if (change.riskLevel === 'blocked' && approvalStatus === 'approved') throw Object.assign(new Error('Mudanças bloqueadas não podem ser aprovadas.'), { status: 422 });
    if (change.requiresConfirmation && approvalStatus === 'approved' && !confirmed) throw Object.assign(new Error('Esta mudança exige confirmação factual explícita.'), { status: 422 });
    if (approvalStatus === 'approved' && change.fieldPath.startsWith('pictures.')) {
      normalizeEditedValue(change.fieldPath, change.newValue, listingSnap.data() as MeliListingRecord);
    }
    const now = new Date().toISOString();
    const statuses = changesSnap.docs.map((doc) => doc.id === changeId ? approvalStatus : (doc.data() as MeliListingChange).approvalStatus);
    const status = proposalStatus(statuses);
    tx.set(changeRef, { approvalStatus, approvedBy: uid, approvedAt: now }, { merge: true });
    tx.set(proposalRef, {
      status, approvedCount: statuses.filter((value) => value === 'approved').length,
      rejectedCount: statuses.filter((value) => value === 'rejected').length, updatedAt: now,
    }, { merge: true });
    tx.set(AUDIT_REF(uid).doc(), {
      actorType: 'user', actorId: uid, action: approvalStatus === 'approved' ? 'meli.change.approved' : 'meli.change.rejected',
      resourceType: 'meli_listing_change', resourceId: changeId,
      metadata: { proposalId, fieldPath: change.fieldPath, riskLevel: change.riskLevel, confirmed }, createdAt: now,
    });
    return 'updated' as const;
  });
  if (outcome === 'stale') throw Object.assign(new Error('O anúncio mudou. A proposta foi marcada como desatualizada.'), { status: 409 });
  const result = await getProposal(uid, proposalId);
  if (!result) throw Object.assign(new Error('Proposta não encontrada após atualização.'), { status: 404 });
  await LISTINGS_REF(uid).doc(result.proposal.listingId).set({
    proposalSummary: { proposalId, version: result.proposal.version, status: result.proposal.status, changeCount: result.changes.length, updatedAt: result.proposal.updatedAt },
  }, { merge: true });
  return result;
}

function normalizeEditedValue(fieldPath: string, value: unknown, listing: MeliListingRecord): unknown {
  if (fieldPath === 'title') {
    if (listing.soldQuantity > 0) throw Object.assign(new Error('O título não pode ser editado após o anúncio registrar vendas.'), { status: 422 });
    if (listing.catalogProductId) throw Object.assign(new Error('O título deste anúncio pode ser controlado pelo catálogo.'), { status: 422 });
    const title = typeof value === 'string' ? value.trim() : '';
    if (!title || title.length > 300 || /<[^>]+>|https?:\/\/|www\.|\b(?:whats|telefone|e-mail|email)\b/i.test(title)) {
      throw Object.assign(new Error('Informe um título válido, sem HTML, URL ou contato.'), { status: 422 });
    }
    return title;
  }
  if (fieldPath === 'description.plain_text') {
    const description = typeof value === 'string' ? value.trim() : '';
    if (!description || description.length > 10_000 || /<\/?[a-z][^>]*>|https?:\/\/|www\.|\b(?:whats|telefone|e-mail|email)\b/i.test(description)) {
      throw Object.assign(new Error('Informe uma descrição em texto simples, sem HTML, URL ou contato.'), { status: 422 });
    }
    return description;
  }
  if (fieldPath.startsWith('attributes.') || fieldPath.startsWith('sale_terms.')) {
    const id = fieldPath.split('.').slice(1).join('.');
    const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const valueName = typeof candidate.valueName === 'string' ? candidate.valueName.trim() : '';
    const valueId = typeof candidate.valueId === 'string' && candidate.valueId.trim() ? candidate.valueId.trim() : null;
    if (!id || !valueName || valueName.length > 500) throw Object.assign(new Error('Informe um valor válido para o campo.'), { status: 422 });
    return { id, valueId, valueName };
  }
  if (fieldPath.startsWith('pictures.')) {
    const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const action = String(candidate.action || '');
    if (!['reorder', 'remove', 'replace', 'create', 'restore'].includes(action)) {
      throw Object.assign(new Error('Ação de imagem inválida.'), { status: 422 });
    }
    const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
    if ((action === 'create' || action === 'replace') && !/^https:\/\//i.test(source)) {
      throw Object.assign(new Error('Criação e substituição de imagem exigem uma URL HTTPS.'), { status: 422 });
    }
    const targetOrder = Number(candidate.targetOrder);
    if (action === 'reorder' && (!Number.isInteger(targetOrder) || targetOrder < 1)) {
      throw Object.assign(new Error('Informe uma posição de imagem válida, começando em 1.'), { status: 422 });
    }
    const pictures = action === 'restore' && Array.isArray(candidate.pictures)
      ? candidate.pictures.map((picture) => ({ id: String((picture as any)?.id || '') })).filter((picture) => picture.id)
      : undefined;
    if (action === 'restore' && !pictures?.length) throw Object.assign(new Error('O conjunto de imagens para restauração está vazio.'), { status: 422 });
    return {
      action,
      pictureId: candidate.pictureId ? String(candidate.pictureId) : null,
      ...(source ? { source } : {}),
      ...(action === 'reorder' ? { targetOrder } : {}),
      ...(pictures ? { pictures } : {}),
    };
  }
  throw Object.assign(new Error('Este campo não pode ser editado na proposta.'), { status: 422 });
}

export async function editChange(
  uid: string,
  proposalId: string,
  changeId: string,
  newValue: unknown,
): Promise<{ proposal: MeliListingProposal; changes: MeliListingChange[] }> {
  const proposalRef = PROPOSALS_REF(uid).doc(proposalId);
  const changeRef = CHANGES_REF(uid).doc(changeId);
  await adminDb.runTransaction(async (tx) => {
    const [proposalSnap, changeSnap, changesSnap] = await Promise.all([
      tx.get(proposalRef), tx.get(changeRef), tx.get(CHANGES_REF(uid).where('proposalId', '==', proposalId)),
    ]);
    if (!proposalSnap.exists || !changeSnap.exists) throw Object.assign(new Error('Proposta ou mudança não encontrada.'), { status: 404 });
    const proposal = proposalSnap.data() as MeliListingProposal;
    const change = changeSnap.data() as MeliListingChange;
    if (change.proposalId !== proposalId) throw Object.assign(new Error('A mudança não pertence à proposta.'), { status: 409 });
    if (['stale', 'applying', 'applied', 'partially_applied'].includes(proposal.status)) {
      throw Object.assign(new Error('Esta proposta não pode mais ser editada neste estado.'), { status: 409 });
    }
    const listingSnap = await tx.get(LISTINGS_REF(uid).doc(proposal.listingId));
    if (!listingSnap.exists || listingSnap.data()?.contentHash !== proposal.baseContentHash) {
      tx.set(proposalRef, { status: 'stale', updatedAt: new Date().toISOString() }, { merge: true });
      return;
    }
    const normalized = normalizeEditedValue(change.fieldPath, newValue, listingSnap.data() as MeliListingRecord);
    const now = new Date().toISOString();
    const statuses = changesSnap.docs.map((doc) => doc.id === changeId ? 'pending' as const : (doc.data() as MeliListingChange).approvalStatus);
    const baseRisk = riskForChange(change.fieldPath, `Edição manual pelo operador. ${JSON.stringify(normalized)}`);
    const manuallyConfirmedField = change.fieldPath === 'description.plain_text'
      || change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.');
    tx.set(changeRef, {
      newValue: jsonSafe(normalized),
      reason: `${change.reason} Valor ajustado manualmente pelo operador.`,
      approvalStatus: 'pending', approvedBy: null, approvedAt: null,
      editedBy: uid, editedAt: now,
      riskLevel: manuallyConfirmedField && baseRisk.riskLevel === 'medium' ? 'high' : baseRisk.riskLevel,
      requiresConfirmation: baseRisk.requiresConfirmation || manuallyConfirmedField,
    }, { merge: true });
    tx.set(proposalRef, {
      status: proposalStatus(statuses),
      approvedCount: statuses.filter((status) => status === 'approved').length,
      rejectedCount: statuses.filter((status) => status === 'rejected').length,
      updatedAt: now,
    }, { merge: true });
    tx.set(AUDIT_REF(uid).doc(), {
      actorType: 'user', actorId: uid, action: 'meli.change.edited',
      resourceType: 'meli_listing_change', resourceId: changeId,
      metadata: { proposalId, fieldPath: change.fieldPath }, createdAt: now,
    });
  });
  const result = await getProposal(uid, proposalId);
  if (!result) throw Object.assign(new Error('Proposta não encontrada após a edição.'), { status: 404 });
  return result;
}
