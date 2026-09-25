import assert from 'node:assert/strict';
import { buildPictures, hasWriteScope, mergeMeliEntries, mutationFingerprint } from '../server/meli/mutations';
import type { MeliListingChange } from '../server/meli/types';

function change(patch: Partial<MeliListingChange>): MeliListingChange {
  return {
    id: 'change', proposalId: 'proposal', fieldPath: 'attributes.BRAND', resource: 'item',
    changeType: 'replace', oldValue: null, newValue: null, reason: 'Teste', evidence: [], confidence: 1,
    riskLevel: 'medium', requiresConfirmation: false, approvalStatus: 'approved', approvedBy: 'user',
    approvedAt: new Date().toISOString(), createdAt: new Date().toISOString(), ...patch,
  };
}

assert.equal(hasWriteScope(['offline_access', 'read', 'write']), true);
assert.equal(hasWriteScope(['offline_access', 'read']), false);

const attributes = mergeMeliEntries([
  { id: 'BRAND', value_name: 'Antiga', name: 'Marca' },
  { id: 'MODEL', value_name: 'Runner', name: 'Modelo' },
], [change({ fieldPath: 'attributes.BRAND', newValue: { id: 'BRAND', valueId: null, valueName: 'Acme' } })], 'attributes.');
assert.equal(attributes.length, 2);
assert.equal(attributes.find((entry) => entry.id === 'BRAND')?.value_name, 'Acme');
assert.equal(attributes.find((entry) => entry.id === 'MODEL')?.value_name, 'Runner');

const removed = mergeMeliEntries(attributes, [change({
  fieldPath: 'attributes.BRAND', changeType: 'remove', newValue: null,
})], 'attributes.');
assert.equal(removed.some((entry) => entry.id === 'BRAND'), false);

const reordered = buildPictures(
  [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  [],
  [change({ fieldPath: 'pictures.C', newValue: { action: 'reorder', pictureId: 'C', targetOrder: 1 } })],
);
assert.deepEqual(reordered.pictures, [{ id: 'C' }, { id: 'A' }, { id: 'B' }]);

assert.throws(() => buildPictures(
  [{ id: 'A' }, { id: 'B' }],
  [{ id: 1, picture_ids: ['A'] }],
  [change({ fieldPath: 'pictures.A', changeType: 'remove', newValue: { action: 'remove', pictureId: 'A' } })],
), /vinculada a uma variação/);

const base = mutationFingerprint({
  seller_id: 42, category_id: 'MLB1', title: 'Produto', attributes: [{ id: 'B', value_name: '2' }, { id: 'A', value_name: '1' }],
  sale_terms: [], pictures: [{ id: 'P1' }], variations: [],
}, { plain_text: 'Descrição' });
const same = mutationFingerprint({
  seller_id: '42', category_id: 'MLB1', title: 'Produto', attributes: [{ id: 'A', value_name: '1' }, { id: 'B', value_name: '2' }],
  sale_terms: [], pictures: [{ id: 'P1' }], variations: [],
}, { plain_text: 'Descrição' });
assert.deepEqual(base, same);

console.log('MELI controlled write verification passed.');
