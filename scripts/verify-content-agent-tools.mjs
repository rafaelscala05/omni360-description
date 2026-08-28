import assert from 'node:assert';
import '../server/agent/tools/content.ts';
import { describeTools } from '../server/agent/registry.ts';
import { resolveApprovalMode } from '../server/agent/agentSettings.ts';

const tools = describeTools(['content']);
const expectedReadTools = [
  'content.site.escanear',
  'content.artigos.reutilizaveis.listar',
  'content.publicacoes.logs.listar',
  'content.sanity.tipos.listar',
  'content.sanity.campos.listar',
];

for (const name of expectedReadTools) {
  const def = tools.find((t) => t.name === name);
  assert.ok(def, `ferramenta ausente: ${name}`);
  assert.strictEqual(def.mode, 'read', `${name} deveria ser read`);
  assert.strictEqual(def.inputSchema.type, 'object', `${name}: schema inválido`);
}

const expectedWriteTools = [
  'content.projeto.criar',
  'content.clusters.gerar',
  'content.calendario.gerar',
  'content.artigo.produzir',
  'content.artigo.imagem.regenerar',
  'content.artigo.publicar',
  'content.artigo.despublicar',
];
for (const name of expectedWriteTools) {
  const def = tools.find((t) => t.name === name);
  assert.ok(def, `ferramenta ausente: ${name}`);
  assert.strictEqual(def.mode, 'write', `${name} deveria ser write`);
}

for (const name of ['content.artigo.publicar', 'content.artigo.despublicar']) {
  assert.strictEqual(
    resolveApprovalMode({ approvalMode: 'auto' }, name),
    'ask',
    `${name} deveria ignorar approvalMode: 'auto'`,
  );
}

console.log(`OK: verify-content-agent-tools (${expectedReadTools.length} leitura, ${expectedWriteTools.length} escrita)`);
