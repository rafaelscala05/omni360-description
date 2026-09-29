import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildChecklist, buildMediaSummary } from '../server/meli/media';
import { factsHash, factsSourceText, normalizeFactAnswers } from '../server/meli/facts';
import {
  descriptionRejectionReason, enrichQuestions, evidenceSupportsValue, fieldLabel, validateSuggestedTitle,
  type MeliCategorySchemaRecord,
} from '../server/meli/rules';
import { opportunity } from '../server/meli/routes';
import { buildPictures } from '../server/meli/mutations';
import { buildPicturePrompt, normalizeGeneratedPicture, TARGET_ORDER } from '../server/meli/pictureGenerator';
import { normalizeMediaPatch } from '../server/meli/videoAssets';
import { collectProposalCandidates } from '../src/modules/meli/proposalCandidates';
import type { MeliImageDiagnostic, MeliListingChange, MeliListingFacts, MeliListingRecord } from '../server/meli/types';

const listing = {
  itemId: 'MLB1', title: 'Garrafa Térmica Inox', descriptionPlainText: 'Garrafa térmica para café.',
  attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'Acme' }], saleTerms: [], pictures: [{ id: 'P1' }, { id: 'P2' }],
  variations: [], soldQuantity: 0, videoId: null, categoryId: 'MLB123',
} as unknown as MeliListingRecord;

// --- Mídia e checklist ---------------------------------------------------
const diagnostic = (order: number, role: MeliImageDiagnostic['role'], side: number, whiteBackground: boolean | null = null): MeliImageDiagnostic => ({
  pictureId: `P${order + 1}`, order, url: null, width: side, height: side, perceptualHash: null,
  action: 'keep', issues: [], strengths: [], confidence: 1, role, whiteBackground,
});
const noLifestyle = buildMediaSummary(listing, [diagnostic(0, 'other', 800, false), diagnostic(1, 'detail', 1400)]);
assert.equal(noLifestyle.mainWhiteBackground, false);
assert.equal(noLifestyle.lifestyleCount, 0);
assert.equal(noLifestyle.zoomReadyCount, 1);
assert.equal(noLifestyle.hasVideo, false);
const checklist = buildChecklist(listing, [], noLifestyle);
const status = (id: string) => checklist.find((item) => item.id === id)?.status;
assert.equal(status('lifestyle_picture'), 'missing');
assert.equal(status('video'), 'missing');
assert.equal(status('main_picture'), 'warning');
assert.equal(status('detail_picture'), 'ok');
assert.equal(status('picture_quality'), 'warning', 'duas fotos e uma sem zoom');
assert.equal(status('title'), 'warning', 'título curto');
const withVideo = buildMediaSummary({ ...listing, videoId: 'abc' }, [diagnostic(0, 'main_white_background', 1200), diagnostic(1, 'lifestyle', 1200)]);
assert.equal(withVideo.mainWhiteBackground, true, 'role de capa em fundo branco conta como fundo branco');
assert.equal(buildChecklist(listing, [], withVideo).find((item) => item.id === 'video')?.status, 'ok');
assert.equal(buildChecklist(listing, [{ code: 'REQUIRED_ATTRIBUTE_MISSING', fieldPath: 'attributes.MODEL', severity: 'medium', message: '', evidence: [], source: 'category_schema', confidence: 1, requiresConfirmation: false }], withVideo)
  .find((item) => item.id === 'attributes')?.status, 'missing');

// --- Fatos do vendedor ---------------------------------------------------
const answers = normalizeFactAnswers({
  'attributes.MATERIAL': 'Aço inox', 'attributes.CAPACITY': { value: '1,5 L', valueId: null }, 'rawItem.price': '1', 'description.plain_text': 'Acompanha tampa',
});
assert.deepEqual(Object.keys(answers).sort(), ['attributes.CAPACITY', 'attributes.MATERIAL', 'description.plain_text'], 'chave fora da lista é ignorada');
assert.throws(() => normalizeFactAnswers({ 'attributes.BRAND': 'veja https://x.com' }), /link/);
assert.throws(() => normalizeFactAnswers(['x']), /objeto/);
assert.equal(factsHash(null), null);
const facts: MeliListingFacts = {
  itemId: 'MLB1', updatedAt: '', answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { ...value, answeredAt: '' }])),
};
assert.equal(typeof factsHash(facts), 'string');
const sellerSource = factsSourceText(facts);

// Sem os fatos, número e "material" são invenção; com eles, passam.
const description = 'Garrafa térmica de aço inox com 1,5 L. Material resistente. Acompanha tampa.';
assert.match(String(descriptionRejectionReason(description, listing)), /números|material/);
assert.equal(descriptionRejectionReason(description, listing, sellerSource), null);
assert.equal(validateSuggestedTitle('Garrafa Térmica Inox Acme 1,5 L Aço', listing), null, 'sem fatos, "aço" é palavra nova');
assert.equal(validateSuggestedTitle('Garrafa Térmica Inox Acme 1,5 L Aço', listing, sellerSource), 'Garrafa Térmica Inox Acme 1,5 L Aço');
assert.equal(evidenceSupportsValue('Aço inox', ['Informado pelo vendedor: Aço inox'], listing), false);
assert.equal(evidenceSupportsValue('Aço inox', ['Informado pelo vendedor: Aço inox'], listing, sellerSource), true);

// --- Perguntas enriquecidas pelo schema ----------------------------------
const schema: MeliCategorySchemaRecord = {
  categoryId: 'MLB123', schemaHash: 'h', fetchedAt: '',
  schema: { attributes: [
    { id: 'COLOR', name: 'Cor', value_type: 'list', values: [{ id: '1', name: 'Azul' }, { id: '2', name: 'Preto' }], tags: { required: true } },
    { id: 'CAPACITY', name: 'Capacidade', value_type: 'number_unit', allowed_units: [{ id: 'L', name: 'L' }, { id: 'mL', name: 'mL' }] },
  ] },
};
const [color, capacity] = enrichQuestions([
  { fieldPath: 'attributes.COLOR', question: 'Qual a cor?', reason: 'x' },
  { fieldPath: 'attributes.CAPACITY', question: 'Qual a capacidade?', reason: 'x' },
], listing, schema);
assert.equal(color.label, 'Cor');
assert.deepEqual(color.options?.map((option) => option.name), ['Azul', 'Preto']);
assert.deepEqual(capacity.units, ['L', 'mL']);
assert.equal(fieldLabel('attributes.BRAND', listing, schema), 'Marca');
assert.equal(fieldLabel('description.plain_text', listing, schema), 'Descrição');

// --- Oportunidade --------------------------------------------------------
assert.ok(opportunity({ visits30d: 1000, analysisSummary: { alfredsScore: 50 } }) > opportunity({ visits30d: 1000, analysisSummary: { alfredsScore: 90 } }));
assert.ok(opportunity({ visits30d: 1000, analysisSummary: { alfredsScore: 70 } }) > opportunity({ visits30d: 10, analysisSummary: { alfredsScore: 20 } }));
assert.equal(opportunity({}), 50, 'sem visitas nem nota ainda ordena');

// --- Fotos: plano da IA e foto gerada numa posição -----------------------
const candidates = collectProposalCandidates(listing, {
  findings: [], suggestions: { title: null, descriptionPlainText: null, attributes: [], saleTerms: [], picturePlan: [
    { pictureId: 'P2', action: 'reorder', targetOrder: 1, reason: 'melhor capa' },
    { pictureId: null, action: 'create', reason: 'sem URL' },
    { pictureId: 'P1', action: 'replace', reason: 'sem URL' },
  ] },
});
assert.deepEqual(candidates.picturePlan.map((plan) => plan.action), ['reorder'], 'create/replace sem URL não viram proposta');
const create = (targetOrder: number | null) => ({
  id: 'c', proposalId: 'p', fieldPath: 'pictures.plan.generated-x', resource: 'item', changeType: 'add', oldValue: null,
  newValue: { action: 'create', source: 'https://example.com/a.jpg', ...(targetOrder ? { targetOrder } : {}) },
  reason: '', evidence: [], confidence: 1, riskLevel: 'medium', requiresConfirmation: false, approvalStatus: 'approved',
  approvedBy: null, approvedAt: null, createdAt: '',
}) as MeliListingChange;
assert.deepEqual(buildPictures(listing.pictures, [], [create(1)]).pictures, [{ source: 'https://example.com/a.jpg' }, { id: 'P1' }, { id: 'P2' }]);
assert.deepEqual(buildPictures(listing.pictures, [], [create(2)]).pictures, [{ id: 'P1' }, { source: 'https://example.com/a.jpg' }, { id: 'P2' }]);
assert.deepEqual(buildPictures(listing.pictures, [], [create(null)]).pictures, [{ id: 'P1' }, { id: 'P2' }, { source: 'https://example.com/a.jpg' }]);
assert.equal(TARGET_ORDER.white_background, 1);
assert.match(buildPicturePrompt('white_background', 'Garrafa', null), /fundo branco puro/);
assert.match(buildPicturePrompt('lifestyle', 'Garrafa', 'cozinha clara'), /cozinha clara/);
assert.match(buildPicturePrompt('lifestyle', 'Garrafa', null), /IDÊNTICO/);

const png = await sharp({ create: { width: 640, height: 400, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
for (const kind of ['white_background', 'lifestyle'] as const) {
  const meta = await sharp(await normalizeGeneratedPicture(png, kind)).metadata();
  assert.equal(meta.width, 1200); assert.equal(meta.height, 1200); assert.equal(meta.format, 'jpeg');
}

// --- Vídeo: referência e arquivo só por HTTPS -----------------------------
assert.deepEqual(normalizeMediaPatch({ videoUrl: 'https://x.com/v.mp4', videoJobId: 'job_1' }), { videoUrl: 'https://x.com/v.mp4', videoJobId: 'job_1' });
assert.throws(() => normalizeMediaPatch({ videoUrl: 'http://x.com/v.mp4' }), /HTTPS/);
assert.throws(() => normalizeMediaPatch({ productReference: { imageUrl: 'data:image/png;base64,xx' } }), /HTTPS/);
assert.equal(normalizeMediaPatch({ videoJobId: '../etc' }).videoJobId, null);
assert.deepEqual(normalizeMediaPatch({ productReference: { imageUrl: 'https://x.com/r.jpg', sourceImages: ['https://x.com/a.jpg', 'ftp://b'] } }).productReference?.sourceImages, ['https://x.com/a.jpg']);
assert.deepEqual(normalizeMediaPatch({ title: 'ignorado' }), {});

console.log('MELI optimize verification passed.');
process.exit(0);
