import assert from 'node:assert';
import { resolveApprovalMode } from '../server/agent/agentSettings.ts';

// auto global, sem override → auto
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.clusters.gerar'),
  'auto',
);
// ask global, override auto numa ferramenta específica → auto só nela
assert.strictEqual(
  resolveApprovalMode(
    { approvalMode: 'ask', toolOverrides: { 'content.clusters.gerar': 'auto' } },
    'content.clusters.gerar',
  ),
  'auto',
);
assert.strictEqual(
  resolveApprovalMode(
    { approvalMode: 'auto', toolOverrides: { 'content.clusters.gerar': 'ask' } },
    'content.calendario.gerar',
  ),
  'auto',
);
// travas fixas de publicar/despublicar ignoram tudo, mesmo com auto global
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.artigo.publicar'),
  'ask',
);
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.artigo.despublicar'),
  'ask',
);

console.log('OK: verify-content-langchain-adapter');
