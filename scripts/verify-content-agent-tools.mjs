import assert from 'node:assert';
import '../server/agent/tools/content.ts';
import '../server/agent/tools/contentSeo.ts';
import '../server/agent/tools/contentBlog.ts';
import { describeTools } from '../server/agent/registry.ts';
import { resolveApprovalMode } from '../server/agent/agentSettings.ts';

const tools = describeTools(['content']);
const expectedReadTools = [
  'content.site.escanear',
  'content.artigos.reutilizaveis.listar',
  'content.publicacoes.logs.listar',
  'content.sanity.tipos.listar',
  'content.sanity.campos.listar',
  'content.clusters.listar',
  'content.calendario.listar',
  'content.calendario.artigo.ler',
  'content.produtos.listar',
  'content.projetos.listar',
  'content.blog.config.ler',
  'content.blog.posts.listar',
  'content.blog.post.ler',
  'content.blog.categorias.listar',
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
  'content.seo.auditoria.gerar',
  'content.seo.auditoria.atualizar',
  'content.seo.auditoria.cancelar',
  'content.credencial.conectar',
  'content.cluster.aprovar',
  'content.cluster.renomear',
  'content.cluster.excluir',
  'content.cluster.criar',
  'content.artigo.editar',
  'content.artigo.excluir',
  'content.artigo.criar',
  'content.artigo.mover',
  'content.projeto.renomear',
  'content.projeto.excluir',
  'content.projeto.config.atualizar',
  'content.blog.config.atualizar',
  'content.blog.post.salvar',
  'content.blog.post.excluir',
  'content.blog.categoria.salvar',
  'content.blog.categoria.excluir',
];
for (const name of expectedWriteTools) {
  const def = tools.find((t) => t.name === name);
  assert.ok(def, `ferramenta ausente: ${name}`);
  assert.strictEqual(def.mode, 'write', `${name} deveria ser write`);
}

for (const name of ['content.artigo.publicar', 'content.artigo.despublicar', 'content.credencial.conectar', 'content.projeto.excluir']) {
  assert.strictEqual(
    resolveApprovalMode({ approvalMode: 'auto' }, name),
    'ask',
    `${name} deveria ignorar approvalMode: 'auto'`,
  );
}

assert.strictEqual(
  tools.length,
  expectedReadTools.length + expectedWriteTools.length,
  `esperava exatamente ${expectedReadTools.length + expectedWriteTools.length} ferramentas 'content', achei ${tools.length} — alguma ferramenta nova ficou de fora desta lista (ou sobrou uma removida)`,
);

console.log(`OK: verify-content-agent-tools (${expectedReadTools.length} leitura, ${expectedWriteTools.length} escrita)`);
