// Ferramentas do Agente de Conteúdo. Cada uma é uma casca fina sobre uma
// função que já existe em contentAgent.ts/seoAgent.ts — nenhuma lógica de
// negócio é duplicada aqui. Mesmo padrão de server/agent/tools/wake.ts.

import { registerTool } from '../registry';
import { requireStr } from '../preview';
import type { ToolCtx } from '../types';
import {
  scanWebsite,
  getReusableArticles,
  detectSanityTypes,
  detectSanityFields,
  loadProject,
  projectRef,
} from '../../contentAgent';

registerTool({
  name: 'content.site.escanear',
  provider: 'content',
  mode: 'read',
  description: 'Analisa um site (URL pública) e sugere um perfil de empresa (nome, descrição, produto/serviço, público-alvo, tom de voz, objetivos, palavras-chave) para pré-preencher o onboarding de um projeto de conteúdo.',
  schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL do site a analisar, ex.: https://minhaempresa.com.br' } },
    required: ['url'],
  },
  read: async (_ctx: ToolCtx, args: Record<string, unknown>) => {
    const url = requireStr(args, 'url');
    return scanWebsite(url);
  },
});

registerTool({
  name: 'content.artigos.reutilizaveis.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista artigos já aprovados/publicados do usuário que podem ser reaproveitados (ex.: linkados na descrição de um produto).',
  schema: { type: 'object', properties: {} },
  read: async (ctx: ToolCtx) => getReusableArticles(ctx.uid),
});

registerTool({
  name: 'content.publicacoes.logs.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista as últimas chamadas HTTP que a publicação de artigos fez para WordPress/Sanity, com requisição, resposta e status — para diagnosticar falha de publicação.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      limit: { type: 'number', description: 'Máximo de logs (padrão 50, teto 200).' },
    },
    required: ['projectId'],
  },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId); // valida posse do projeto
    const limit = Math.min(Number(args.limit ?? 50), 200);
    const snap = await projectRef(ctx.uid, projectId)
      .collection('publishLogs').orderBy('at', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
});

registerTool({
  name: 'content.sanity.tipos.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os _type existentes no dataset do Sanity configurado no projeto, amostrando o conteúdo (não depende de "sanity schema deploy").',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => detectSanityTypes(ctx.uid, requireStr(args, 'projectId')),
});

registerTool({
  name: 'content.sanity.campos.listar',
  provider: 'content',
  mode: 'read',
  description: 'Dado um _type do Sanity (de content.sanity.tipos.listar), lista os campos de um documento de exemplo com um palpite de natureza (texto rico/referência/string).',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, type: { type: 'string' } },
    required: ['projectId', 'type'],
  },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) =>
    detectSanityFields(ctx.uid, requireStr(args, 'projectId'), requireStr(args, 'type')),
});
