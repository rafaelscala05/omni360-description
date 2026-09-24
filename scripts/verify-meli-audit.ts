import assert from 'node:assert/strict';
import { isServingSchemaComplexityError, simplifyServingJsonSchema } from '../server/meli/aiSchema';
import { collectSchemaAttributes, evidenceSupportsValue, runListingRules, validateSuggestedDescription, validateSuggestedTitle } from '../server/meli/rules';
import type { MeliListingRecord } from '../server/meli/types';

const listing: MeliListingRecord = {
  itemId: 'MLB123', sellerId: '42', siteId: 'MLB', userProductId: 'UP123', familyId: null,
  catalogProductId: null, categoryId: 'MLB-CAT', domainId: null, status: 'active',
  title: 'Tênis Acme Runner 42', condition: 'new', soldQuantity: 2, availableQuantity: 3,
  permalink: null, thumbnail: null,
  descriptionPlainText: 'Marca: Outra\n<p>Modelo esportivo tamanho 42.</p>',
  attributes: [
    { id: 'BRAND', name: 'Marca', value_name: 'Acme' },
    { id: 'SIZE', name: 'Tamanho', value_name: '42' },
  ],
  saleTerms: [], variations: [{ id: 1, picture_ids: ['MISSING'] }], pictures: [], shipping: null,
  performance: { score: 61 }, catalogQuality: null, rawItem: {}, contentHash: 'hash',
  sourceLastUpdatedAt: null, lastSyncedAt: '2026-09-24T00:00:00.000Z',
  createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z',
};

const category = {
  categoryId: 'MLB-CAT', schemaHash: 'schema', fetchedAt: '2026-09-24T00:00:00.000Z',
  schema: {
    attributes: [
      { id: 'BRAND', name: 'Marca', value_type: 'string' },
      { id: 'GTIN', name: 'GTIN', value_type: 'string', tags: { required: true } },
      { id: 'SIZE', name: 'Tamanho', value_type: 'number', value_max_length: 3 },
    ],
    input: { groups: [{ components: [{ attributes: [{ id: 'MODEL', name: 'Modelo', value_type: 'string' }] }] }] },
    output: null,
  },
};

const schema = collectSchemaAttributes(category);
assert.equal(schema.has('GTIN'), true);
assert.equal(schema.get('MODEL')?.__technicalInput, true);

const result = runListingRules(listing, category);
const codes = new Set(result.findings.map((finding) => finding.code));
assert.equal(codes.has('REQUIRED_ATTRIBUTE_MISSING'), true);
assert.equal(codes.has('RECOMMENDED_ATTRIBUTE_MISSING'), true);
assert.equal(codes.has('DESCRIPTION_CONTAINS_HTML'), true);
assert.equal(codes.has('PICTURES_MISSING'), true);
assert.equal(codes.has('VARIATION_REFERENCES_MISSING_PICTURE'), true);
assert.equal(codes.has('USER_PRODUCT_PROPAGATION_SCOPE'), true);
assert.equal(codes.has('ATTRIBUTE_LITERAL_DIVERGENCE'), true);
assert.equal(result.riskLevel, 'blocked');
assert.ok(result.score <= 45);
assert.ok(result.questions.some((question) => question.fieldPath === 'attributes.GTIN'));

assert.equal(evidenceSupportsValue('Acme', ['Marca atual: Acme'], listing), true);
assert.equal(evidenceSupportsValue('Inventada', ['Marca: Inventada'], listing), false);
assert.equal(validateSuggestedDescription('Tênis Acme no tamanho 42.', listing), 'Tênis Acme no tamanho 42.');
assert.equal(validateSuggestedDescription('Tênis com garantia de 12 meses.', listing), null);
assert.equal(validateSuggestedDescription('<b>Tênis</b>', listing), null);
assert.equal(validateSuggestedDescription('Tênis impermeável tamanho 42.', listing), null);
assert.equal(validateSuggestedTitle('Tênis Acme Runner 42', listing), 'Tênis Acme Runner 42');
assert.equal(validateSuggestedTitle('Tênis Acme Premium 42', listing), null);

const servingSchema = simplifyServingJsonSchema({
  type: 'object',
  maxProperties: 20,
  properties: {
    findings: {
      type: 'array',
      maxItems: 40,
      items: { type: 'object', properties: { confidence: { type: 'number', minimum: 0, maximum: 1 } } },
    },
  },
});
assert.equal('maxProperties' in servingSchema, false);
assert.equal('maxItems' in servingSchema.properties.findings, false);
assert.deepEqual(servingSchema.properties.findings.items.properties.confidence, { type: 'number' });
assert.equal(isServingSchemaComplexityError(new Error('The specified schema produces a constraint that has too many states for serving.')), true);
assert.equal(isServingSchemaComplexityError(new Error('Unauthorized')), false);

console.log('MELI audit verification passed.');
