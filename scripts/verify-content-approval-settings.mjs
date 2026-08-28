import assert from 'node:assert';
import { resolveApprovalMode, DEFAULT_AGENT_SETTINGS } from '../server/agent/agentSettings.ts';

assert.strictEqual(resolveApprovalMode(DEFAULT_AGENT_SETTINGS, 'content.clusters.gerar'), 'ask');
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.clusters.gerar'),
  'auto',
);
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.artigo.publicar'),
  'ask',
);
assert.strictEqual(
  resolveApprovalMode(
    { approvalMode: 'ask', toolOverrides: { 'content.artigo.produzir': 'auto' } },
    'content.artigo.produzir',
  ),
  'auto',
);

console.log('OK: verify-content-approval-settings');
