// Verificação da lógica pura de mapeamento IdWorks (server/idworksAgent.ts).
// Não sobe servidor e não toca o Firestore.
// Rodar com: npx tsx scripts/verify-idworks-mapping.mjs
import { normalizeProduct, buildSkuUpdateBody } from '../server/idworksAgent.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok' : 'FALHA'}  ${label}${
      ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`
    }`,
  );
}

// --- normalizeProduct tests ---

// Test 1: Full SkuDetail-shaped fixture maps every field correctly
const fullSku = {
  IDSku: '12345',
  IDSkuCompany: 'SKU001',
  SkuName: 'Produto Teste',
  EcommerceDescription: '<p>Descrição longa do produto</p>',
  EcommerceDescriptionShort: 'Desc curta',
  EcommerceTitle: 'Título SEO',
  EcommerceMetaTagDescription: 'Meta descrição',
  EcommerceKeyWords: 'palavra-chave1, palavra-chave2',
  EcommerceLinkId: 'produto-teste-slug',
  EcommerceVideoUrl: 'https://youtube.com/watch?v=abc123',
  SkuNCM: '12345678',
  SkuNCMExTipi: '01234',
  SkuCest: '1234567',
  BarCode: '5901234123457',
  SkuWeightNet: '2.5',
  SkuWeight: '3.0',
  SkuWidth: '10.5',
  SkuHeight: '15.0',
  SkuLength: '20.5',
  Brand: 'Marca Teste',
  CategoryTree: 'Eletrônicos > Computadores > Laptops',
  MainImageURL: 'https://example.com/image.jpg',
};

const normalized = normalizeProduct(fullSku);
check('idworksId mapeia IDSku', normalized.idworksId, '12345');
check('sku mapeia IDSkuCompany', normalized.sku, 'SKU001');
check('nome mapeia SkuName', normalized.nome, 'Produto Teste');
check('descricaoHtml mapeia EcommerceDescription', normalized.descricaoHtml, '<p>Descrição longa do produto</p>');
check('descricaoCurta mapeia EcommerceDescriptionShort', normalized.descricaoCurta, 'Desc curta');
check('seoTitle mapeia EcommerceTitle', normalized.seoTitle, 'Título SEO');
check('seoDescription mapeia EcommerceMetaTagDescription', normalized.seoDescription, 'Meta descrição');
check('seoKeywords mapeia EcommerceKeyWords', normalized.seoKeywords, 'palavra-chave1, palavra-chave2');
check('slug mapeia EcommerceLinkId', normalized.slug, 'produto-teste-slug');
check('linkVideo mapeia EcommerceVideoUrl', normalized.linkVideo, 'https://youtube.com/watch?v=abc123');
check('ncm mapeia SkuNCM', normalized.ncm, '12345678');
check('ncmExTipi mapeia SkuNCMExTipi', normalized.ncmExTipi, '01234');
check('cest mapeia SkuCest', normalized.cest, '1234567');
check('gtin mapeia BarCode', normalized.gtin, '5901234123457');
check('pesoLiquido converte SkuWeightNet para número', normalized.pesoLiquido, 2.5);
check('pesoBruto converte SkuWeight para número', normalized.pesoBruto, 3.0);
check('largura converte SkuWidth para número', normalized.largura, 10.5);
check('altura converte SkuHeight para número', normalized.altura, 15.0);
check('comprimento converte SkuLength para número', normalized.comprimento, 20.5);
check('marca mapeia Brand', normalized.marca, 'Marca Teste');
check('categorias extrai de CategoryTree', normalized.categorias, ['Eletrônicos > Computadores > Laptops']);
check('imagens extrai de MainImageURL', normalized.imagens, ['https://example.com/image.jpg']);
check('codigoPai é undefined sem IDProduct', normalized.codigoPai, undefined);

// Test 2: IDProduct presente define codigoPai
const skuWithParent = {
  IDSku: '67890',
  IDSkuCompany: 'VAR001',
  SkuName: 'Variação Teste',
  IDProduct: '12345', // Parent SKU
};

const normalizedVar = normalizeProduct(skuWithParent);
check('codigoPai mapeia IDProduct quando presente', normalizedVar.codigoPai, '12345');

// Test 3: Missing/empty optional fields return undefined, not empty string
const minimalSku = {
  IDSku: '',
  IDSkuCompany: '',
  SkuName: '',
};

const normalizedMin = normalizeProduct(minimalSku);
check('descricaoHtml é undefined quando falta', normalizedMin.descricaoHtml, undefined);
check('seoTitle é undefined quando falta', normalizedMin.seoTitle, undefined);
check('marca é undefined quando falta', normalizedMin.marca, undefined);
check('codigoPai é undefined quando falta', normalizedMin.codigoPai, undefined);
check('categorias é array vazio quando falta', normalizedMin.categorias, []);
check('imagens é array vazio quando falta', normalizedMin.imagens, []);

// Test 4: Empty string fields are treated as undefined
const skuWithEmpty = {
  IDSku: '111',
  IDSkuCompany: 'SKU111',
  SkuName: 'Produto',
  EcommerceTitle: '', // empty string
  Brand: '', // empty string
};

const normalizedEmpty = normalizeProduct(skuWithEmpty);
check('seoTitle é undefined se vazio', normalizedEmpty.seoTitle, undefined);
check('marca é undefined se vazio', normalizedEmpty.marca, undefined);

// Test 5: Numeric conversion handles comma as decimal separator
const skuWithComma = {
  IDSku: '222',
  IDSkuCompany: 'SKU222',
  SkuName: 'Produto',
  SkuWeightNet: '2,5', // comma separator
  SkuHeight: '15,75', // comma separator
};

const normalizedComma = normalizeProduct(skuWithComma);
check('pesoLiquido converte "2,5" para 2.5', normalizedComma.pesoLiquido, 2.5);
check('altura converte "15,75" para 15.75', normalizedComma.altura, 15.75);

// Test 6: Category fallback to Category field
const skuWithCategory = {
  IDSku: '333',
  IDSkuCompany: 'SKU333',
  SkuName: 'Produto',
  Category: 'Roupas', // Category instead of CategoryTree
};

const normalizedCat = normalizeProduct(skuWithCategory);
check('categorias usa Category quando CategoryTree falta', normalizedCat.categorias, ['Roupas']);

// --- buildSkuUpdateBody tests ---

// Test 7: Unchanged local values produce 'sem alteração' and no key in body
const currentUnchanged = {
  IDSku: '1000',
  IDSkuCompany: 'SKU1000',
  SkuName: 'Produto',
  EcommerceDescription: 'Descrição igual',
  EcommerceDescriptionShort: 'Curta igual',
};

const prodUnchanged = {
  idworksId: '1000',
  descricaoHtml: 'Descrição igual',
  descricaoCurta: 'Curta igual',
  campos: { descricao: true, seo: false, fiscal: false, imagens: false },
};

const resultUnchanged = buildSkuUpdateBody(currentUnchanged, prodUnchanged);
check('descricao unchanged → sem alteração', resultUnchanged.steps.descricao, 'sem alteração');
check('descricao unchanged → body.EcommerceDescription ausente', resultUnchanged.body.EcommerceDescription, undefined);
check('descricao unchanged → body.EcommerceDescriptionShort ausente', resultUnchanged.body.EcommerceDescriptionShort, undefined);

// Test 8: Changed SEO title produces steps.seo = 'ok' and body.EcommerceTitle set
const currentSeo = {
  IDSku: '2000',
  IDSkuCompany: 'SKU2000',
  SkuName: 'Produto',
  EcommerceTitle: 'Título antigo',
  EcommerceMetaTagDescription: 'Meta igual',
  EcommerceKeyWords: 'palavra igual',
};

const prodSeoChanged = {
  idworksId: '2000',
  seoTitle: 'Título novo',
  seoDescription: 'Meta igual',
  seoKeywords: 'palavra igual',
  campos: { descricao: false, seo: true, fiscal: false, imagens: false },
};

const resultSeoChanged = buildSkuUpdateBody(currentSeo, prodSeoChanged);
check('seo changed → steps.seo = ok', resultSeoChanged.steps.seo, 'ok');
check('seo changed → body.EcommerceTitle setado', resultSeoChanged.body.EcommerceTitle, 'Título novo');
check('seo unchanged → body.EcommerceMetaTagDescription ausente', resultSeoChanged.body.EcommerceMetaTagDescription, undefined);
check('seo unchanged → body.EcommerceKeyWords ausente', resultSeoChanged.body.EcommerceKeyWords, undefined);

// Test 9: Partial SEO update (only title changes, others absent from prod)
const currentPartialSeo = {
  IDSku: '2500',
  IDSkuCompany: 'SKU2500',
  SkuName: 'Produto',
  EcommerceTitle: 'Título antigo',
  EcommerceMetaTagDescription: 'Meta descrição',
};

const prodPartialSeo = {
  idworksId: '2500',
  seoTitle: 'Título novo', // only this changes
  // seoDescription, seoKeywords, slug, linkVideo are undefined
  campos: { descricao: false, seo: true, fiscal: false, imagens: false },
};

const resultPartialSeo = buildSkuUpdateBody(currentPartialSeo, prodPartialSeo);
check('partial seo → steps.seo = ok', resultPartialSeo.steps.seo, 'ok');
check('partial seo → body.EcommerceTitle setado', resultPartialSeo.body.EcommerceTitle, 'Título novo');
check('partial seo → body contém apenas 1 chave', Object.keys(resultPartialSeo.body).length, 1);

// Test 10: No local fiscal data at all → steps.fiscal = 'sem dado local'
const currentNoFiscal = {
  IDSku: '3000',
  IDSkuCompany: 'SKU3000',
  SkuName: 'Produto',
};

const prodNoFiscal = {
  idworksId: '3000',
  // Nenhum campo fiscal local (ncm, cest, pesos, dimensões todos undefined)
  campos: { descricao: false, seo: false, fiscal: true, imagens: false },
};

const resultNoFiscal = buildSkuUpdateBody(currentNoFiscal, prodNoFiscal);
check('no fiscal data → steps.fiscal = sem dado local', resultNoFiscal.steps.fiscal, 'sem dado local');
check('no fiscal data → body vazio', Object.keys(resultNoFiscal.body).length, 0);

// Test 11: Fiscal data changed (weight, dimensions)
const currentFiscal = {
  IDSku: '3500',
  IDSkuCompany: 'SKU3500',
  SkuName: 'Produto',
  SkuNCM: '12345678',
  SkuWeightNet: '2.0',
  SkuHeight: '10.0',
};

const prodFiscalChanged = {
  idworksId: '3500',
  ncm: '12345678', // unchanged
  pesoLiquido: 2.5, // changed
  altura: 10.0, // unchanged
  campos: { descricao: false, seo: false, fiscal: true, imagens: false },
};

const resultFiscalChanged = buildSkuUpdateBody(currentFiscal, prodFiscalChanged);
check('fiscal partial changed → steps.fiscal = ok', resultFiscalChanged.steps.fiscal, 'ok');
check('fiscal changed → body.SkuWeightNet setado', resultFiscalChanged.body.SkuWeightNet, 2.5);
check('fiscal unchanged → body.SkuNCM ausente', resultFiscalChanged.body.SkuNCM, undefined);
check('fiscal unchanged → body.SkuHeight ausente', resultFiscalChanged.body.SkuHeight, undefined);

// Test 12: Whitespace-only strings are treated as unchanged
const currentWhitespace = {
  IDSku: '4000',
  IDSkuCompany: 'SKU4000',
  SkuName: 'Produto',
  EcommerceTitle: '  Título com espaços  ',
};

const prodWhitespace = {
  idworksId: '4000',
  seoTitle: 'Título com espaços', // Same content, different whitespace
  campos: { descricao: false, seo: true, fiscal: false, imagens: false },
};

const resultWhitespace = buildSkuUpdateBody(currentWhitespace, prodWhitespace);
check('whitespace trimmed → steps.seo = sem alteração', resultWhitespace.steps.seo, 'sem alteração');
check('whitespace trimmed → body vazio', Object.keys(resultWhitespace.body).length, 0);

// Test 13: campos.X = false skips that category entirely
const currentAllFields = {
  IDSku: '5000',
  IDSkuCompany: 'SKU5000',
  SkuName: 'Produto',
  EcommerceDescription: 'Desc antiga',
  EcommerceTitle: 'Título antigo',
  SkuNCM: '12345678',
};

const prodDisabled = {
  idworksId: '5000',
  descricaoHtml: 'Desc nova',
  seoTitle: 'Título novo',
  ncm: '87654321',
  campos: { descricao: false, seo: false, fiscal: false, imagens: false }, // All disabled
};

const resultDisabled = buildSkuUpdateBody(currentAllFields, prodDisabled);
check('all campos false → body vazio', Object.keys(resultDisabled.body).length, 0);
check('all campos false → descricao = sem dado local', resultDisabled.steps.descricao, 'sem dado local');
check('all campos false → seo = sem dado local', resultDisabled.steps.seo, 'sem dado local');
check('all campos false → fiscal = sem dado local', resultDisabled.steps.fiscal, 'sem dado local');

// Test 14: Description with only one field provided
const currentDesc = {
  IDSku: '6000',
  IDSkuCompany: 'SKU6000',
  SkuName: 'Produto',
  EcommerceDescription: 'Desc velha',
  EcommerceDescriptionShort: 'Curta velha',
};

const prodDescOneField = {
  idworksId: '6000',
  descricaoHtml: 'Desc nova',
  // descricaoCurta is undefined
  campos: { descricao: true, seo: false, fiscal: false, imagens: false },
};

const resultDescOneField = buildSkuUpdateBody(currentDesc, prodDescOneField);
check('desc one field changed → steps.descricao = ok', resultDescOneField.steps.descricao, 'ok');
check('desc one field → body.EcommerceDescription setado', resultDescOneField.body.EcommerceDescription, 'Desc nova');
check('desc one field → body.EcommerceDescriptionShort ausente', resultDescOneField.body.EcommerceDescriptionShort, undefined);

// --- parseWebhookEnvelope tests (server/idworksWebhook.ts) ---
// The IdWorks OpenAPI schema WebhookLogListItem.PostData documents the webhook payload as
// carrying at minimum `Topic`, `AccountName`, the resource id `IDSku`, and a relative detail
// URL. Feed the parser the exact documented shape and confirm it extracts topic + idSku.

import { parseWebhookEnvelope } from '../server/idworksWebhook.ts';

// Documented-envelope fixture (a SkuPost).
const skuPostEnvelope = {
  Topic: 'SkuPost',
  AccountName: 'teste',
  IDSku: 1234,
  IDSkuURL: 'sku/1234',
  ModificationTimestamp: '2026-08-24T10:00:00Z',
};
const parsedSkuPost = parseWebhookEnvelope(skuPostEnvelope);
check('envelope SkuPost → topic = SkuPost', parsedSkuPost.topic, 'SkuPost');
check('envelope SkuPost → idSku = "1234"', parsedSkuPost.idSku, '1234');
check('envelope SkuPost → modifiedAt presente', parsedSkuPost.modifiedAt, '2026-08-24T10:00:00Z');

// Envelope for a non-SKU resource (OrderStatus) — idSku should be null, topic still read.
const orderEnvelope = { Topic: 'OrderStatus', AccountName: 'teste', IDOrder: 99, IDOrderURL: 'orders/99' };
const parsedOrder = parseWebhookEnvelope(orderEnvelope);
check('envelope OrderStatus → topic = OrderStatus', parsedOrder.topic, 'OrderStatus');
check('envelope OrderStatus → idSku = null (não é SKU)', parsedOrder.idSku, null);

// Missing/empty body → no throw, idSku null.
const parsedEmpty = parseWebhookEnvelope({});
check('envelope vazio → topic = ""', parsedEmpty.topic, '');
check('envelope vazio → idSku = null', parsedEmpty.idSku, null);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
