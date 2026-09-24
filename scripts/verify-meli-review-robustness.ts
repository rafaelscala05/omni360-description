import assert from 'node:assert/strict';
import { parseMeliWebhookNotification } from '../server/mercadoLivreWebhook';
import { proposalStatus, riskForChange } from '../server/meli/proposals';
import { acquireMeliSlot, meliLimiterSnapshot, reportMeliResponse } from '../server/meli/rateLimit';

assert.deepEqual(riskForChange('title'), { riskLevel: 'high', requiresConfirmation: true });
assert.deepEqual(riskForChange('attributes.GTIN'), { riskLevel: 'high', requiresConfirmation: true });
assert.deepEqual(riskForChange('description.plain_text', 'Correção ortográfica'), { riskLevel: 'low', requiresConfirmation: false });
assert.deepEqual(riskForChange('category_id'), { riskLevel: 'blocked', requiresConfirmation: true });
assert.equal(proposalStatus(['pending', 'pending']), 'awaiting_review');
assert.equal(proposalStatus(['rejected', 'pending']), 'awaiting_review');
assert.equal(proposalStatus(['approved', 'rejected']), 'partially_approved');
assert.equal(proposalStatus(['rejected', 'rejected']), 'rejected');
assert.equal(proposalStatus(['approved', 'approved']), 'approved');

const notification = parseMeliWebhookNotification({
  resource: '/items/MLB123456', user_id: 42, topic: 'items', application_id: 99,
  attempts: 1, sent: '2026-09-24T12:00:00.000Z', received: '2026-09-24T12:00:01.000Z',
});
assert.equal(notification?.topic, 'items');
assert.equal(notification?.userId, '42');
assert.equal(notification?.resource, '/items/MLB123456');
assert.equal(parseMeliWebhookNotification({ topic: 'orders', user_id: 42, resource: '/orders/1', application_id: 99, sent: 'x' }), null);

const releases = await Promise.all([0, 1, 2, 3].map(() => acquireMeliSlot('test-seller')));
let fifthAcquired = false;
const fifth = acquireMeliSlot('test-seller').then((release) => { fifthAcquired = true; return release; });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(fifthAcquired, false);
releases[0]();
const fifthRelease = await fifth;
assert.equal(fifthAcquired, true);
fifthRelease();
releases.slice(1).forEach((release) => release());
reportMeliResponse('test-seller', 429, 1_000);
assert.equal(meliLimiterSnapshot('test-seller').limit, 2);

let active = 0;
let maxActive = 0;
await Promise.all(Array.from({ length: 50 }, async () => {
  const release = await acquireMeliSlot('load-seller');
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 1));
  active -= 1;
  release();
}));
assert.ok(maxActive <= 4, `concorrência observada: ${maxActive}`);
assert.equal(meliLimiterSnapshot('load-seller').queued, 0);

console.log('MELI review and robustness verification passed.');
