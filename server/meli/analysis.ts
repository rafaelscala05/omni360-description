import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { adminDb } from '../firebaseAdmin';
import { assertSafeImageUrl } from '../safeUrl';
import {
  enrichQuestions,
  evidenceSupportsValue,
  descriptionRejectionReason,
  runListingRules,
  validateSuggestedDescription,
  validateSuggestedTitle,
  weightedMeliScore,
  type MeliCategorySchemaRecord,
} from './rules';
import type {
  MeliAnalysisFinding,
  MeliAnalysisQuestion,
  MeliAnalysisRecord,
  MeliBuyerQuestion,
  MeliImageDiagnostic,
  MeliListingFacts,
  MeliListingRecord,
  MeliScoreComponents,
  MeliValueSuggestion,
} from './types';
import { buyerAnswersSourceText, factsHash, factsSourceText, fetchBuyerQuestions, getListingFacts } from './facts';
import { buildChecklist, buildMediaSummary } from './media';
import { generateListingCopy } from './copywriter';
import { createProposal } from './proposals';
import { jsonSafe, sanitizeError } from './utils';
import { isServingSchemaComplexityError, simplifyServingJsonSchema } from './aiSchema';

const RULESET_VERSION = '2026-09-29.1';
const PROMPT_VERSION = 'meli-audit-2026-09-29.1';
const MODEL = process.env.MELI_ANALYSIS_MODEL || 'gemini-2.5-flash';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const MAX_IMAGES = 10;
const DEFAULT_MAX_TITLE_LENGTH = 60;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const ANALYSES_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_analyses');
const SNAPSHOTS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_snapshots');
const SCHEMAS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_category_schemas');
const AUDIT_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_audit_events');

const FindingSchema = z.object({
  code: z.string().min(1).max(80),
  field_path: z.string().min(1).max(160),
  severity: z.enum(['info', 'low', 'medium', 'high', 'blocked']),
  message: z.string().min(1).max(500),
  evidence: z.array(z.string().min(1).max(500)).max(8),
  source: z.enum(['listing', 'category_schema', 'meli_performance', 'image']),
  confidence: z.number().min(0).max(1),
  requires_confirmation: z.boolean(),
}).strict();

const QuestionSchema = z.object({
  field_path: z.string().min(1).max(160),
  question: z.string().min(1).max(500),
  reason: z.string().min(1).max(500),
}).strict();

const SuggestedValueSchema = z.object({
  id: z.string().min(1).max(100),
  value_name: z.string().min(1).max(500),
  value_id: z.string().max(200).nullable(),
  reason: z.string().min(1).max(500),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(8),
}).strict();

const PicturePlanSchema = z.object({
  picture_id: z.string().max(200).nullable(),
  action: z.enum(['keep', 'reorder', 'remove', 'replace', 'create', 'needs_review']),
  target_order: z.number().int().min(1).max(30).nullable(),
  reason: z.string().min(1).max(500),
}).strict();

const ImageDiagnosticSchema = z.object({
  picture_id: z.string().min(1).max(200),
  order: z.number().int().min(0),
  role: z.enum(['main_white_background', 'lifestyle', 'detail', 'dimensions', 'packaging', 'infographic', 'other']).nullable(),
  white_background: z.boolean().nullable(),
  has_text_or_watermark: z.boolean().nullable(),
  action: z.enum(['keep', 'reorder', 'remove', 'replace', 'create', 'needs_review']),
  issues: z.array(z.string().min(1).max(300)).max(10),
  strengths: z.array(z.string().min(1).max(300)).max(10),
  confidence: z.number().min(0).max(1),
}).strict();

const AiOutputSchema = z.object({
  summary: z.string().min(1).max(1200),
  score_components: z.object({
    title: z.number().min(0).max(100),
    description: z.number().min(0).max(100),
    technical_completeness: z.number().min(0).max(100),
    consistency: z.number().min(0).max(100),
    images: z.number().min(0).max(100),
  }).strict(),
  findings: z.array(FindingSchema).max(40),
  questions: z.array(QuestionSchema).max(25),
  suggestions: z.object({
    title: z.string().max(300).nullable(),
    description_plain_text: z.string().max(10000).nullable(),
    attributes: z.array(SuggestedValueSchema).max(40),
    sale_terms: z.array(SuggestedValueSchema).max(20),
    picture_plan: z.array(PicturePlanSchema).max(30),
  }).strict(),
  image_diagnostics: z.array(ImageDiagnosticSchema).max(MAX_IMAGES),
}).strict();

type AiOutput = z.infer<typeof AiOutputSchema>;

interface PreparedImage {
  pictureId: string;
  order: number;
  url: string;
  width: number | null;
  height: number | null;
  perceptualHash: string | null;
  base64?: string;
  mimeType?: string;
  error?: string;
}

function asObjects(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object')) : [];
}

function parseDimensions(picture: Record<string, any>): { width: number | null; height: number | null } {
  for (const value of [picture.max_size, picture.size]) {
    const match = String(value || '').match(/^(\d+)x(\d+)$/i);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  }
  return {
    width: Number.isFinite(Number(picture.width)) ? Number(picture.width) : null,
    height: Number.isFinite(Number(picture.height)) ? Number(picture.height) : null,
  };
}

async function averageHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  let bits = '';
  for (const value of data) bits += value >= average ? '1' : '0';
  return Buffer.from(bits.match(/.{1,8}/g)!.map((byte) => Number.parseInt(byte, 2))).toString('hex');
}

async function preparePicture(picture: Record<string, any>, order: number): Promise<PreparedImage> {
  const pictureId = String(picture.id || `picture-${order + 1}`);
  const url = String(picture.secure_url || picture.url || '');
  const dimensions = parseDimensions(picture);
  const base: PreparedImage = { pictureId, order, url, ...dimensions, perceptualHash: null };
  if (!url) return { ...base, error: 'Imagem sem URL.' };
  try {
    await assertSafeImageUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'error', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) throw new Error('arquivo maior que 8 MB');
    const original = Buffer.from(await response.arrayBuffer());
    if (original.byteLength > MAX_IMAGE_BYTES) throw new Error('arquivo maior que 8 MB');
    const metadata = await sharp(original).metadata();
    const resized = await sharp(original).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return {
      ...base,
      width: metadata.width || base.width,
      height: metadata.height || base.height,
      perceptualHash: await averageHash(original),
      base64: resized.toString('base64'),
      mimeType: 'image/jpeg',
    };
  } catch (error) {
    return { ...base, error: sanitizeError(error) };
  }
}

async function prepareImages(listing: MeliListingRecord): Promise<PreparedImage[]> {
  const pictures = asObjects(listing.pictures);
  const prepared: PreparedImage[] = [];
  for (let index = 0; index < pictures.length; index += 1) {
    if (index < MAX_IMAGES) prepared.push(await preparePicture(pictures[index], index));
    else {
      const dimensions = parseDimensions(pictures[index]);
      prepared.push({
        pictureId: String(pictures[index].id || `picture-${index + 1}`), order: index,
        url: String(pictures[index].secure_url || pictures[index].url || ''), ...dimensions, perceptualHash: null,
      });
    }
  }
  return prepared;
}

function deterministicImageDiagnostics(images: PreparedImage[]): MeliImageDiagnostic[] {
  const counts = new Map<string, number>();
  images.forEach((image) => image.perceptualHash && counts.set(image.perceptualHash, (counts.get(image.perceptualHash) || 0) + 1));
  return images.map((image) => {
    const issues: string[] = [];
    if (image.error) issues.push(`Não foi possível inspecionar o arquivo: ${image.error}`);
    if (image.width && image.height && Math.min(image.width, image.height) < 500) issues.push('Resolução inferior a 500 px em um dos lados.');
    if (image.perceptualHash && (counts.get(image.perceptualHash) || 0) > 1) issues.push('Imagem visualmente duplicada no conjunto.');
    return {
      pictureId: image.pictureId,
      order: image.order,
      url: image.url || null,
      width: image.width,
      height: image.height,
      perceptualHash: image.perceptualHash,
      action: issues.length ? 'needs_review' : 'keep',
      issues,
      strengths: [],
      confidence: image.error ? 0.4 : 0.9,
    };
  });
}

function categoryDigest(schemaRecord: MeliCategorySchemaRecord | null): unknown {
  if (!schemaRecord) return null;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.slice(0, 150).map(visit);
    if (!value || typeof value !== 'object') return value;
    const allowed = new Set(['id', 'name', 'value_type', 'value_max_length', 'tags', 'allowed_units', 'values', 'attributes', 'components', 'groups']);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => allowed.has(key)).map(([key, nested]) => [key, visit(nested)]));
  };
  return visit(schemaRecord.schema);
}

interface SellerContext {
  facts: MeliListingFacts | null;
  buyerQuestions: MeliBuyerQuestion[];
}

function aiContext(listing: MeliListingRecord, schemaRecord: MeliCategorySchemaRecord | null, images: PreparedImage[], seller: SellerContext): unknown {
  return {
    seller_facts: Object.entries(seller.facts?.answers ?? {} as MeliListingFacts['answers']).map(([field_path, answer]) => ({ field_path, value: answer.value, value_id: answer.valueId ?? null })),
    buyer_questions: seller.buyerQuestions.slice(0, 25).map((question) => ({ question: question.text, seller_answer: question.answer })),
    listing: {
      item_id: listing.itemId,
      category_id: listing.categoryId,
      title: listing.title,
      description_plain_text: listing.descriptionPlainText,
      condition: listing.condition,
      sold_quantity: listing.soldQuantity,
      attributes: asObjects(listing.attributes).map(({ id, name, value_id, value_name }) => ({ id, name, value_id, value_name })),
      sale_terms: asObjects(listing.saleTerms).map(({ id, name, value_id, value_name }) => ({ id, name, value_id, value_name })),
      variations: asObjects(listing.variations).map(({ id, attribute_combinations, picture_ids }) => ({ id, attribute_combinations, picture_ids })),
      user_product_id: listing.userProductId,
      catalog_product_id: listing.catalogProductId,
    },
    official_quality: { performance: listing.performance, catalog_quality: listing.catalogQuality },
    category_schema: categoryDigest(schemaRecord),
    pictures: images.map(({ pictureId, order, width, height, error }) => ({ picture_id: pictureId, order, width, height, available_to_model: !error && order < MAX_IMAGES })),
  };
}

async function runAiAnalysis(
  listing: MeliListingRecord,
  schemaRecord: MeliCategorySchemaRecord | null,
  images: PreparedImage[],
  seller: SellerContext,
): Promise<AiOutput> {
  // Só Vertex (credenciais ADC da service account), como productImport.ts e
  // contentAgent.ts. A GEMINI_API_KEY do ambiente não é usada aqui.
  const ai = new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  const systemInstruction = [
    'Você audita anúncios brasileiros do Mercado Livre em português do Brasil.',
    'Use exclusivamente os fatos presentes no contexto ou visíveis nas imagens. Nunca invente GTIN, marca, modelo, dimensões, material, compatibilidade, certificação, garantia ou conteúdo da embalagem.',
    'seller_facts são dados confirmados pelo próprio vendedor: podem ser usados como evidência (cite "Informado pelo vendedor: <valor>"). As respostas do vendedor em buyer_questions também são fatos. Não repita perguntas já respondidas em seller_facts.',
    'Perguntas de compradores sem resposta indicam o que falta explicar no anúncio: transforme em questions objetivas ao vendedor quando o dado não estiver nas fontes.',
    'Quando um fato não estiver comprovado, não o inclua em suggestions; crie uma pergunta objetiva em questions.',
    'description_plain_text deve ser texto simples, sem HTML, URLs, contato, preço, estoque ou promessa sem evidência.',
    'Cada atributo ou termo sugerido precisa citar evidência literal que contenha o valor proposto.',
    'Avalie imagens quanto a resolução, nitidez, iluminação, fundo, texto promocional, marca d’água, duplicidade, coerência e cobertura. Não afirme com certeza o que não estiver visível.',
    'Em image_diagnostics, classifique cada imagem em role: main_white_background (produto isolado em fundo branco ou quase branco), lifestyle (produto em uso ou em ambiente real), detail (close de acabamento/detalhe), dimensions (medidas), packaging (embalagem), infographic (arte com textos ou ícones de benefícios) ou other. Informe white_background e has_text_or_watermark.',
    'A imagem order=0 é a capa da busca: precisa ser o produto em fundo branco, sem textos, logos, bordas ou marca d’água. Se não for, registre um issue nela.',
    'Em picture_plan use apenas reorder (ex.: levar a melhor foto em fundo branco para a posição 1) ou remove (duplicada, ilegível). Não proponha create ou replace: novas fotos são geradas por outra ferramenta.',
    'Para action=reorder, informe target_order começando em 1. Para as demais ações use target_order=null. Nunca invente uma URL de imagem.',
    'Não recomende publicar ou editar automaticamente. Sua saída será validada e usada apenas como auditoria assistida.',
    'Responda com um objeto JSON contendo exatamente: summary, score_components, findings, questions, suggestions e image_diagnostics. score_components contém title, description, technical_completeness, consistency e images. suggestions contém title, description_plain_text, attributes, sale_terms e picture_plan.',
  ].join(' ');
  const parts: any[] = images.filter((image) => image.base64).slice(0, MAX_IMAGES)
    .map((image) => ({ inlineData: { mimeType: image.mimeType!, data: image.base64! } }));
  parts.push({ text: `Analise o contexto JSON a seguir. A ordem das imagens anexadas corresponde aos registros pictures com available_to_model=true.\n${JSON.stringify(aiContext(listing, schemaRecord, images, seller))}` });
  const baseRequest = {
    model: MODEL,
    contents: [{ role: 'user', parts }],
  };
  const baseConfig = {
    systemInstruction,
    temperature: 0.15,
    responseMimeType: 'application/json' as const,
  };
  let response;
  try {
    response = await ai.models.generateContent({
      ...baseRequest,
      config: {
        ...baseConfig,
        responseJsonSchema: simplifyServingJsonSchema(z.toJSONSchema(AiOutputSchema)),
      },
    });
  } catch (error) {
    if (!isServingSchemaComplexityError(error)) throw error;
    // JSON mode still constrains the transport format. The complete Zod schema
    // below remains authoritative and rejects incomplete or invented shapes.
    console.warn('[meli-analysis] schema estruturado rejeitado por complexidade; repetindo em JSON mode.', { model: MODEL });
    response = await ai.models.generateContent({ ...baseRequest, config: baseConfig });
  }
  const parsed = JSON.parse(response.text || '{}');
  return AiOutputSchema.parse(parsed);
}

function mapAiFinding(finding: AiOutput['findings'][number]): MeliAnalysisFinding {
  return {
    code: finding.code,
    fieldPath: finding.field_path,
    severity: finding.severity,
    message: finding.message,
    evidence: finding.evidence,
    source: finding.source,
    confidence: finding.confidence,
    requiresConfirmation: finding.requires_confirmation,
  };
}

function dedupeFindings(findings: MeliAnalysisFinding[]): MeliAnalysisFinding[] {
  const rank = { info: 0, low: 1, medium: 2, high: 3, blocked: 4 } as const;
  const result = new Map<string, MeliAnalysisFinding>();
  for (const finding of findings) {
    const key = `${finding.code}:${finding.fieldPath}`;
    const current = result.get(key);
    if (!current || rank[finding.severity] > rank[current.severity]) result.set(key, finding);
  }
  return [...result.values()];
}

function dedupeQuestions(questions: MeliAnalysisQuestion[]): MeliAnalysisQuestion[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = `${question.fieldPath}:${question.question.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeImageDiagnostics(base: MeliImageDiagnostic[], ai: AiOutput | null, variationPictureIds: Set<string>): MeliImageDiagnostic[] {
  const aiById = new Map((ai?.image_diagnostics || []).map((item) => [item.picture_id, item]));
  return base.map((item) => {
    const visual = aiById.get(item.pictureId);
    if (!visual) return item;
    const variationLinkedRemoval = visual.action === 'remove' && variationPictureIds.has(item.pictureId);
    return {
      ...item,
      action: item.issues.length || variationLinkedRemoval ? 'needs_review' : visual.action,
      issues: [...new Set([
        ...item.issues,
        ...visual.issues,
        ...(variationLinkedRemoval ? ['A imagem está vinculada a uma variação e não pode ser removida sem reconciliação.'] : []),
      ])],
      strengths: visual.strengths,
      confidence: Math.min(item.confidence, visual.confidence),
      role: visual.role,
      whiteBackground: visual.white_background,
      hasTextOrWatermark: visual.has_text_or_watermark,
    };
  });
}

function riskFrom(findings: MeliAnalysisFinding[]): MeliAnalysisRecord['riskLevel'] {
  return findings.some((finding) => finding.severity === 'blocked') ? 'blocked'
    : findings.some((finding) => finding.severity === 'high') ? 'high'
      : findings.some((finding) => finding.severity === 'medium') ? 'medium' : 'low';
}

function officialScore(listing: MeliListingRecord): number | null {
  const value = Number((listing.performance as any)?.score);
  return Number.isFinite(value) ? value : null;
}

async function latestSnapshotId(uid: string, listingId: string, contentHash: string): Promise<string | null> {
  const snap = await SNAPSHOTS_REF(uid).where('listingId', '==', listingId).get();
  const matching = snap.docs.filter((doc) => doc.data().contentHash === contentHash)
    .sort((a, b) => String(b.data().capturedAt).localeCompare(String(a.data().capturedAt)));
  return matching[0]?.id || null;
}

export async function createAnalysis(uid: string, itemId: string): Promise<MeliAnalysisRecord> {
  const normalizedId = itemId.toUpperCase();
  const listingSnap = await LISTINGS_REF(uid).doc(normalizedId).get();
  if (!listingSnap.exists) throw Object.assign(new Error('Anúncio não encontrado. Sincronize antes de analisar.'), { status: 404 });
  const listing = listingSnap.data() as MeliListingRecord;
  const ref = ANALYSES_REF(uid).doc();
  const now = new Date().toISOString();
  const empty: MeliAnalysisRecord = {
    id: ref.id,
    listingId: normalizedId,
    snapshotId: await latestSnapshotId(uid, normalizedId, listing.contentHash),
    contentHash: listing.contentHash,
    rulesetVersion: RULESET_VERSION,
    modelProvider: null,
    modelName: null,
    promptVersion: null,
    officialScore: officialScore(listing),
    alfredsScore: null,
    scoreComponents: null,
    riskLevel: 'low',
    summary: '',
    findings: [],
    questions: [],
    suggestions: { title: null, descriptionPlainText: null, attributes: [], saleTerms: [], picturePlan: [] },
    imageDiagnostics: [],
    aiStatus: 'pending',
    aiError: null,
    status: 'queued',
    createdAt: now,
    completedAt: null,
    processingLeaseId: null,
    processingLeaseUntil: null,
  };
  await ref.set(empty);
  await LISTINGS_REF(uid).doc(normalizedId).set({ analysisInProgress: ref.id }, { merge: true });
  return empty;
}

// Só limpa se a marca ainda for desta análise: uma análise mais nova do mesmo
// anúncio pode ter sido criada enquanto esta rodava.
async function clearAnalysisInProgress(uid: string, listingId: string, analysisId: string): Promise<void> {
  const ref = LISTINGS_REF(uid).doc(listingId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.analysisInProgress === analysisId) tx.update(ref, { analysisInProgress: null });
  }).catch(() => undefined);
}

const analysisQueue: Array<{ uid: string; analysisId: string }> = [];
let activeAnalyses = 0;

function drainAnalysisQueue(): void {
  while (activeAnalyses < 2 && analysisQueue.length) {
    const next = analysisQueue.shift()!;
    activeAnalyses += 1;
    void runAnalysis(next.uid, next.analysisId).finally(() => {
      activeAnalyses -= 1;
      drainAnalysisQueue();
    });
  }
}

export function scheduleAnalysis(uid: string, analysisId: string): void {
  if (analysisQueue.some((entry) => entry.uid === uid && entry.analysisId === analysisId)) return;
  analysisQueue.push({ uid, analysisId });
  setImmediate(drainAnalysisQueue);
}

export const MAX_BULK_ANALYSES = 100;

export interface BulkAnalysisResult {
  queued: Array<{ itemId: string; analysisId: string }>;
  skipped: Array<{ itemId: string; reason: 'in_progress' | 'not_found' }>;
}

// Análise em massa pedida pela lista. Usa a mesma fila da individual (2 por
// vez); anúncio que já tem análise na fila/rodando é pulado para o mesmo
// anúncio não ir duas vezes ao modelo.
export async function createBulkAnalyses(uid: string, itemIds: string[]): Promise<BulkAnalysisResult> {
  const ids = [...new Set(itemIds.map((id) => String(id).trim().toUpperCase()).filter(Boolean))];
  if (ids.length > MAX_BULK_ANALYSES) {
    throw Object.assign(new Error(`Selecione no máximo ${MAX_BULK_ANALYSES} anúncios por vez.`), { status: 422 });
  }
  const result: BulkAnalysisResult = { queued: [], skipped: [] };
  const listings = ids.length ? await adminDb.getAll(...ids.map((id) => LISTINGS_REF(uid).doc(id))) : [];
  for (const [index, listingSnap] of listings.entries()) {
    const itemId = ids[index];
    if (!listingSnap.exists) { result.skipped.push({ itemId, reason: 'not_found' }); continue; }
    const inProgressId = listingSnap.data()?.analysisInProgress;
    if (inProgressId) {
      const current = await ANALYSES_REF(uid).doc(String(inProgressId)).get();
      if (['queued', 'running'].includes(current.data()?.status)) {
        result.skipped.push({ itemId, reason: 'in_progress' });
        continue;
      }
    }
    const analysis = await createAnalysis(uid, itemId);
    scheduleAnalysis(uid, analysis.id);
    result.queued.push({ itemId, analysisId: analysis.id });
  }
  return result;
}

export async function runAnalysis(uid: string, analysisId: string): Promise<void> {
  const ref = ANALYSES_REF(uid).doc(analysisId);
  const leaseId = crypto.randomUUID();
  const analysis = await adminDb.runTransaction(async (tx) => {
    const queued = await tx.get(ref);
    if (!queued.exists) return null;
    const value = queued.data() as MeliAnalysisRecord;
    if (['completed', 'failed', 'stale'].includes(value.status)) return null;
    if (value.processingLeaseUntil && value.processingLeaseUntil > Date.now()) return null;
    tx.set(ref, { status: 'running', processingLeaseId: leaseId, processingLeaseUntil: Date.now() + 20 * 60 * 1000 }, { merge: true });
    return value;
  });
  if (!analysis) return;
  try {
    const listingSnap = await LISTINGS_REF(uid).doc(analysis.listingId).get();
    if (!listingSnap.exists) throw new Error('Anúncio removido durante a análise.');
    const listing = listingSnap.data() as MeliListingRecord;
    const schemaSnap = await SCHEMAS_REF(uid).doc(listing.categoryId || '_missing').get();
    if (listing.contentHash !== analysis.contentHash) {
      await ref.set({ status: 'stale', completedAt: new Date().toISOString(), summary: 'O anúncio mudou durante a análise. Execute uma nova auditoria.', processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
      return;
    }
    const schemaRecord = schemaSnap.exists ? schemaSnap.data() as MeliCategorySchemaRecord : null;
    const ruleResult = runListingRules(listing, schemaRecord);
    const [images, facts, buyerQuestions] = await Promise.all([
      prepareImages(listing),
      getListingFacts(uid, analysis.listingId).catch(() => null),
      fetchBuyerQuestions(uid, analysis.listingId),
    ]);
    // Tudo o que o vendedor afirmou (respostas às perguntas da análise e aos
    // compradores) passa a contar como fonte para o validador factual.
    const sellerSource = [factsSourceText(facts), buyerAnswersSourceText(buyerQuestions)].filter(Boolean).join('\n');
    const baseImageDiagnostics = deterministicImageDiagnostics(images);
    const variationPictureIds = new Set(asObjects(listing.variations)
      .flatMap((variation) => Array.isArray(variation.picture_ids) ? variation.picture_ids.map(String) : []));
    let ai: AiOutput | null = null;
    let aiStatus: MeliAnalysisRecord['aiStatus'] = 'not_configured';
    let aiError: string | null = null;
    const aiConfigured = Boolean(VERTEX_PROJECT);
    if (aiConfigured) {
      try {
        ai = await runAiAnalysis(listing, schemaRecord, images, { facts, buyerQuestions });
        aiStatus = 'completed';
      } catch (error) {
        aiStatus = 'failed';
        aiError = sanitizeError(error);
      }
    }

    const aiComponents: MeliScoreComponents | null = ai ? {
      title: ai.score_components.title,
      description: ai.score_components.description,
      technicalCompleteness: ai.score_components.technical_completeness,
      consistency: ai.score_components.consistency,
      images: ai.score_components.images,
    } : null;
    const components: MeliScoreComponents = aiComponents ? {
      title: Math.min(ruleResult.scoreComponents.title, aiComponents.title),
      description: Math.min(ruleResult.scoreComponents.description, aiComponents.description),
      technicalCompleteness: Math.min(ruleResult.scoreComponents.technicalCompleteness, aiComponents.technicalCompleteness),
      consistency: Math.min(ruleResult.scoreComponents.consistency, aiComponents.consistency),
      images: Math.min(ruleResult.scoreComponents.images, aiComponents.images),
    } : ruleResult.scoreComponents;
    const findings = dedupeFindings([...ruleResult.findings, ...(ai?.findings || []).map(mapAiFinding)]);
    const questions = [...ruleResult.questions, ...(ai?.questions || []).map((question) => ({
      fieldPath: question.field_path, question: question.question, reason: question.reason,
    }))];
    const rejectedAttributes: MeliAnalysisQuestion[] = [];
    const toSuggestion = (item: AiOutput['suggestions']['attributes'][number]) => ({
      id: item.id, valueName: item.value_name, valueId: item.value_id, reason: item.reason, evidence: item.evidence,
    });
    const aiAttributes = (ai?.suggestions.attributes || []).filter((item) => {
      const supported = evidenceSupportsValue(item.value_name, item.evidence, listing, sellerSource);
      if (!supported) rejectedAttributes.push({
        fieldPath: `attributes.${item.id}`,
        question: `Qual é o valor confirmado de ${item.id}?`,
        reason: 'A sugestão da IA não possuía evidência literal nas fontes sincronizadas.',
      });
      return supported;
    }).map(toSuggestion);
    const aiTerms = (ai?.suggestions.sale_terms || [])
      .filter((item) => evidenceSupportsValue(item.value_name, item.evidence, listing, sellerSource))
      .map(toSuggestion);
    // O que o vendedor respondeu vira sugestão direta e vence a da IA para o
    // mesmo campo: é o dado confirmado pela pessoa que conhece o produto.
    const answers: MeliListingFacts['answers'] = facts?.answers ?? {};
    const sellerSuggestions = (prefix: 'attributes.' | 'sale_terms.'): MeliValueSuggestion[] => Object.entries(answers)
      .filter(([fieldPath]) => fieldPath.startsWith(prefix))
      .map(([fieldPath, answer]) => ({
        id: fieldPath.slice(prefix.length), valueName: answer.value, valueId: answer.valueId ?? null,
        reason: 'Valor informado por você na análise.', evidence: [`Informado pelo vendedor: ${answer.value}`], fromSeller: true,
      }));
    const mergeSuggestions = (seller: MeliValueSuggestion[], fromAi: MeliValueSuggestion[]) => [
      ...seller, ...fromAi.filter((item) => !seller.some((candidate) => candidate.id === item.id)),
    ];
    const suggestedAttributes = mergeSuggestions(sellerSuggestions('attributes.'), aiAttributes);
    const suggestedTerms = mergeSuggestions(sellerSuggestions('sale_terms.'), aiTerms);

    const titleEditable = listing.soldQuantity === 0 && !listing.catalogProductId;
    let copy: Awaited<ReturnType<typeof generateListingCopy>> | null = null;
    if (aiConfigured && aiStatus !== 'failed') {
      const rawSettings = (listing.rawItem as any)?.settings;
      const maxTitleLength = Number(rawSettings?.max_title_length) > 0 ? Number(rawSettings.max_title_length) : DEFAULT_MAX_TITLE_LENGTH;
      copy = await generateListingCopy({
        listing, factsText: sellerSource, buyerQuestions, titleEditable, maxTitleLength,
        visualNotes: (ai?.image_diagnostics || []).flatMap((image) => image.strengths).slice(0, 12),
      }).catch((error) => {
        console.warn('[meli-analysis] geração de texto falhou; mantendo sugestões da auditoria.', sanitizeError(error));
        return null;
      });
    }
    const auditDescription = validateSuggestedDescription(ai?.suggestions.description_plain_text || null, listing, sellerSource);
    const descriptionSuggestion = copy?.description || auditDescription;
    const rawDescriptionDraft = ai?.suggestions.description_plain_text || null;
    if (!descriptionSuggestion && (copy?.descriptionRejection || rawDescriptionDraft)) questions.push({
      fieldPath: 'description.plain_text',
      question: 'Confirme os dados técnicos adicionais que devem constar na nova descrição.',
      reason: `A descrição gerada foi descartada: ${copy?.descriptionRejection || descriptionRejectionReason(rawDescriptionDraft, listing, sellerSource) || 'informação não comprovada'}. Responda às perguntas acima para liberar esses dados.`,
    });
    const titleSuggestion = titleEditable
      ? copy?.title || validateSuggestedTitle(ai?.suggestions.title || null, listing, sellerSource)
      : null;
    const mergedQuestions = enrichQuestions(dedupeQuestions([...questions, ...rejectedAttributes]), listing, schemaRecord);
    const riskLevel = riskFrom(findings);
    let score = weightedMeliScore(components);
    if (riskLevel === 'blocked') score = Math.min(score, 45);
    else if (findings.some((finding) => finding.severity === 'high' && finding.requiresConfirmation)) score = Math.min(score, 59);
    const imageDiagnostics = mergeImageDiagnostics(baseImageDiagnostics, ai, variationPictureIds);
    const media = buildMediaSummary(listing, imageDiagnostics);
    const checklist = buildChecklist(listing, findings, media);
    const completedAt = new Date().toISOString();
    const result: Partial<MeliAnalysisRecord> = jsonSafe({
      modelProvider: ai ? 'vertex' : null,
      modelName: ai ? MODEL : null,
      promptVersion: ai ? PROMPT_VERSION : null,
      officialScore: officialScore(listing),
      alfredsScore: score,
      scoreComponents: components,
      riskLevel,
      summary: ai?.summary || `Auditoria determinística concluída com ${findings.length} achado(s).`,
      findings,
      questions: mergedQuestions,
      suggestions: {
        title: titleSuggestion,
        descriptionPlainText: descriptionSuggestion,
        discardedDescription: !descriptionSuggestion && rawDescriptionDraft
          ? { value: rawDescriptionDraft, reason: descriptionRejectionReason(rawDescriptionDraft, listing, sellerSource) || 'Rejeitada pelo validador.' }
          : null,
        attributes: suggestedAttributes,
        saleTerms: suggestedTerms,
        picturePlan: (ai?.suggestions.picture_plan || []).map((item) => {
          const linkedRemoval = item.action === 'remove' && item.picture_id && variationPictureIds.has(item.picture_id);
          return {
            pictureId: item.picture_id,
            action: linkedRemoval ? 'needs_review' : item.action,
            targetOrder: item.target_order,
            reason: linkedRemoval ? `${item.reason} A imagem está vinculada a uma variação.` : item.reason,
          };
        }),
      },
      imageDiagnostics,
      media,
      checklist,
      buyerQuestions: buyerQuestions.slice(0, 25),
      sellerSourceText: sellerSource || null,
      factsHash: factsHash(facts),
      aiStatus,
      aiError,
      status: 'completed',
      // true até a proposta automática ser gravada: a tela espera por ela em
      // vez de concluir "sem melhorias" no intervalo entre as duas gravações.
      proposalPending: true,
      completedAt,
      processingLeaseId: null,
      processingLeaseUntil: null,
    });
    const currentListing = await LISTINGS_REF(uid).doc(analysis.listingId).get();
    if (currentListing.data()?.contentHash !== analysis.contentHash) {
      await ref.set({ status: 'stale', completedAt, summary: 'O anúncio mudou durante a análise. Execute uma nova auditoria.', processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
      return;
    }
    await Promise.all([
      ref.set(result, { merge: true }),
      LISTINGS_REF(uid).doc(analysis.listingId).set({
        analysisSummary: {
          analysisId, status: 'completed', alfredsScore: score, riskLevel, findingCount: findings.length, completedAt, contentHash: analysis.contentHash,
          missingChecklist: checklist.filter((item) => item.status !== 'ok').map((item) => item.id),
        },
      }, { merge: true }),
      AUDIT_REF(uid).add({
        actorType: 'system', actorId: null, action: 'meli.analysis.completed', resourceType: 'meli_listing_analysis', resourceId: analysisId,
        metadata: { listingId: analysis.listingId, alfredsScore: score, riskLevel, findingCount: findings.length, aiStatus }, createdAt: completedAt,
      }),
    ]);
    // A proposta nasce junto com a análise: o vendedor chega direto nas
    // melhorias prontas para aprovar. Sem mudança segura, simplesmente não há proposta.
    let autoProposalId: string | null = null;
    try {
      autoProposalId = (await createProposal(uid, analysis.listingId, analysisId, { actor: 'system' })).proposal.id;
    } catch (error: any) {
      if (![409, 422].includes(Number(error?.status))) console.warn('[meli-analysis] proposta automática falhou', sanitizeError(error));
    }
    await ref.set({ autoProposalId, proposalPending: false }, { merge: true });
  } catch (error) {
    await ref.set({ status: 'failed', aiStatus: 'failed', aiError: sanitizeError(error), completedAt: new Date().toISOString(), processingLeaseId: null, processingLeaseUntil: null }, { merge: true });
  } finally {
    await clearAnalysisInProgress(uid, analysis.listingId, analysisId);
  }
}

export async function getLatestAnalysis(uid: string, itemId: string): Promise<MeliAnalysisRecord | null> {
  const snap = await ANALYSES_REF(uid).where('listingId', '==', itemId.toUpperCase()).get();
  const records = snap.docs.map((doc) => doc.data() as MeliAnalysisRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records[0] || null;
}
