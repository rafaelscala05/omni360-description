import assert from 'node:assert/strict';
import { chunk, contentHash, normalizeBulkItems, sanitizeError } from '../server/meli/utils';
import { decryptSecret, encryptSecret } from '../server/meli/crypto';

process.env.MELI_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
assert.deepEqual(
  normalizeBulkItems([
    { id: 'MLB1', status_code: 200, body: { id: 'MLB1' } },
    { id: 'MLB2', status_code: 404, body: { id: 'MLB2' } },
    { code: 206, body: { id: 'MLB3' } },
  ]).map((item) => item.id),
  ['MLB1', 'MLB3'],
);

const encrypted = encryptSecret('APP_USR-sensitive-token');
assert.notEqual(encrypted.ciphertext, 'APP_USR-sensitive-token');
assert.equal(decryptSecret(encrypted), 'APP_USR-sensitive-token');
assert.equal(sanitizeError(new Error('Authorization: Bearer APP_USR-secret-value')), 'Authorization: Bearer [REDACTED]');
assert.equal(sanitizeError(new Error('refresh_token=TG-sensitive-value')), 'refresh_token=[REDACTED_TOKEN]');

console.log('MELI foundation verification passed.');
