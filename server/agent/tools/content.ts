// Ferramentas do Agente de Conteúdo. Cada uma é uma casca fina sobre uma
// função que já existe em contentAgent.ts/seoAgent.ts — nenhuma lógica de
// negócio é duplicada aqui. Mesmo padrão de server/agent/tools/wake.ts.

import { registerTool } from '../registry';
import { makePreview, requireStr } from '../preview';
import type { ToolCtx } from '../types';
import { adminDb } from '../../firebaseAdmin';
import { CREDIT_ACTIONS } from '../../../src/credits';
import {
  scanWebsite,
  getReusableArticles,
  detectSanityTypes,
  detectSanityFields,
  loadProject,
  projectRef,
  generateClusters,
  generateCalendar,
  debitCreditsAdmin,
  runArticlePipeline,
  regenerateArticleImage,
} from '../../contentAgent';
import type { ContentProjectConfig } from '../../../src/modules/content/types';

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

// ---------------------------------------------------------------------------
// Onboarding: criar projeto (perfil da empresa). A credencial de WordPress/
// Sanity NUNCA passa por aqui — fica no formulário de credencial (fora do
// modelo), ver src/modules/content/chat/CredentialForm.tsx.
// ---------------------------------------------------------------------------
registerTool({
  name: 'content.projeto.criar',
  provider: 'content',
  mode: 'write',
  description: 'Cria um novo projeto de conteúdo com o perfil da empresa (nome, descrição, produto/serviço, público-alvo, tom de voz, objetivos, palavras-chave, frequência de postagens). Não edita um projeto já existente — para isso, use a tela de configurações.',
  schema: {
    type: 'object',
    properties: {
      nomeEmpresa: { type: 'string' },
      descricao: { type: 'string' },
      produtoServico: { type: 'string' },
      publicoAlvo: { type: 'array', items: { type: 'string' } },
      tomDeVoz: { type: 'string' },
      objetivos: { type: 'array', items: { type: 'string' } },
      palavrasChave: { type: 'array', items: { type: 'string' } },
      frequenciaPostagens: { type: 'string', description: 'Ex.: "2x por semana", "4x por mês".' },
      wordpressUrl: { type: 'string' },
      wordpressUser: { type: 'string' },
      sanityProjectId: { type: 'string' },
      sanityDataset: { type: 'string' },
    },
    required: ['nomeEmpresa', 'descricao', 'produtoServico', 'tomDeVoz'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Criar o projeto de conteúdo "${requireStr(args, 'nomeEmpresa')}".`,
    alvo: 'novo projeto de conteúdo',
    campos: [],
    criacao: true,
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const payload = preview.payload as Record<string, unknown>;
    const config: ContentProjectConfig = {
      nomeEmpresa: String(payload.nomeEmpresa ?? ''),
      descricao: String(payload.descricao ?? ''),
      produtoServico: String(payload.produtoServico ?? ''),
      publicoAlvo: Array.isArray(payload.publicoAlvo) ? payload.publicoAlvo as string[] : [],
      tomDeVoz: String(payload.tomDeVoz ?? ''),
      objetivos: Array.isArray(payload.objetivos) ? payload.objetivos as string[] : [],
      palavrasChave: Array.isArray(payload.palavrasChave) ? payload.palavrasChave as string[] : [],
      referencias: [],
      frequenciaPostagens: String(payload.frequenciaPostagens ?? '2x por semana'),
      wordpressUrl: String(payload.wordpressUrl ?? ''),
      wordpressUser: String(payload.wordpressUser ?? ''),
      sanityProjectId: String(payload.sanityProjectId ?? ''),
      sanityDataset: String(payload.sanityDataset ?? ''),
    };
    const ref = adminDb.collection('users').doc(ctx.uid).collection('contentProjects').doc();
    const now = new Date().toISOString();
    await ref.set({ config, status: 'onboarding', ownerId: ctx.uid, createdAt: now, updatedAt: now });
    return { projectId: ref.id };
  },
});

registerTool({
  name: 'content.clusters.gerar',
  provider: 'content',
  mode: 'write',
  description: 'Gera clusters de conteúdo (pesquisa de palavras-chave + agrupamento temático) para um projeto. Custa créditos.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Gerar clusters de conteúdo para "${project.config.nomeEmpresa}". Isso debita créditos de geração de clusters e de pesquisa de palavras-chave.`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      criacao: true,
      payload: { projectId: args.projectId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const projectId = String((preview.payload as Record<string, unknown>).projectId);
    const project = await loadProject(ctx.uid, projectId);
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.contentClusters, { productName: project.config.nomeEmpresa });
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.seoKeywordResearch, { productName: project.config.nomeEmpresa });
    return { clusters: await generateClusters(ctx.uid, project) };
  },
});

registerTool({
  name: 'content.calendario.gerar',
  provider: 'content',
  mode: 'write',
  description: 'Distribui os artigos aprovados dos clusters por data, conforme a frequência de postagem configurada no projeto. Custa créditos.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Gerar o calendário editorial de "${project.config.nomeEmpresa}".`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      criacao: true,
      payload: { projectId: args.projectId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const projectId = String((preview.payload as Record<string, unknown>).projectId);
    const project = await loadProject(ctx.uid, projectId);
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.contentCalendar, { productName: project.config.nomeEmpresa });
    return { calendar: await generateCalendar(ctx.uid, project) };
  },
});

registerTool({
  name: 'content.artigo.produzir',
  provider: 'content',
  mode: 'write',
  description: 'Roda o pipeline completo de produção de um artigo já agendado no calendário: pesquisa → outline → rascunho → imagem → revisão. Custa créditos e pode levar alguns minutos.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, articleId: { type: 'string' } },
    required: ['projectId', 'articleId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Produzir este artigo agora (pipeline de 5 etapas: pesquisa, outline, rascunho, imagem, revisão).',
    alvo: requireStr(args, 'articleId'),
    campos: [],
    criacao: true,
    payload: { projectId: args.projectId, articleId: args.articleId },
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId } = preview.payload as { projectId: string; articleId: string };
    await runArticlePipeline(ctx.uid, projectId, articleId);
    return { ok: true };
  },
});

registerTool({
  name: 'content.artigo.imagem.regenerar',
  provider: 'content',
  mode: 'write',
  description: 'Regenera a imagem de capa de um artigo — "improve" melhora a imagem atual com uma instrução, "fromProduct" gera a partir da imagem de um produto vinculado.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      articleId: { type: 'string' },
      mode: { type: 'string', enum: ['improve', 'fromProduct'] },
      improvementPrompt: { type: 'string' },
      baseProductImageUrl: { type: 'string' },
    },
    required: ['projectId', 'articleId', 'mode'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Regenerar a imagem de capa (modo: ${requireStr(args, 'mode')}).`,
    alvo: requireStr(args, 'articleId'),
    campos: [],
    criacao: true,
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const p = preview.payload as {
      projectId: string; articleId: string; mode: 'improve' | 'fromProduct';
      improvementPrompt?: string; baseProductImageUrl?: string;
    };
    const imageUrl = await regenerateArticleImage(ctx.uid, p.projectId, p.articleId, {
      mode: p.mode, improvementPrompt: p.improvementPrompt, baseProductImageUrl: p.baseProductImageUrl,
    });
    return { imageUrl };
  },
});
