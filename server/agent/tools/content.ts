// Ferramentas do Agente de Conteúdo. Cada uma é uma casca fina sobre uma
// função que já existe em contentAgent.ts/seoAgent.ts — nenhuma lógica de
// negócio é duplicada aqui. Mesmo padrão de server/agent/tools/wake.ts.

import { registerTool } from '../registry';
import { makePreview, buildFieldDiff, requireStr } from '../preview';
import type { ToolCtx } from '../types';
import { adminDb } from '../../firebaseAdmin';
import {
  scanWebsite,
  getReusableArticles,
  detectSanityTypes,
  detectSanityFields,
  loadProject,
  projectRef,
  generateClusters,
  generateCalendar,
  runArticlePipeline,
  regenerateArticleImage,
  publishToBlog,
  publishToSanity,
  publishToWordpress,
  unpublishArticle,
} from '../../contentAgent';
import type { ContentProjectConfig, ContentCluster, CalendarArticle, ArticleSize } from '../../../src/modules/content/types';

function notFound(entidade: string): never {
  throw Object.assign(new Error(`${entidade} não encontrado.`), { status: 404 });
}

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

registerTool({
  name: 'content.artigo.publicar',
  provider: 'content',
  mode: 'write',
  description: 'Publica um artigo revisado — no blog nativo, no WordPress ou no Sanity, conforme configurado no projeto (ou "destination" explícito). Torna o conteúdo público. Sempre pede aprovação, mesmo com o modo automático ligado para outras ferramentas.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      articleId: { type: 'string' },
      destination: { type: 'string', enum: ['blog', 'wordpress', 'sanity'] },
    },
    required: ['projectId', 'articleId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Publicar este artigo${args.destination ? ` em ${args.destination}` : ''}. Isso torna o conteúdo público.`,
    alvo: requireStr(args, 'articleId'),
    campos: [{ campo: 'status', antes: 'rascunho', depois: 'publicado', mudou: true }],
    avisos: ['Ação pública e visível para terceiros — confira o artigo antes de aprovar.'],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId, destination } = preview.payload as {
      projectId: string; articleId: string; destination?: 'blog' | 'wordpress' | 'sanity';
    };
    let url: string;
    if (destination === 'blog') url = await publishToBlog(ctx.uid, projectId, articleId);
    else if (destination === 'sanity') url = await publishToSanity(ctx.uid, projectId, articleId);
    else if (destination === 'wordpress') url = await publishToWordpress(ctx.uid, projectId, articleId);
    else {
      const project = await loadProject(ctx.uid, projectId);
      url = project.config.sanityProjectId
        ? await publishToSanity(ctx.uid, projectId, articleId)
        : project.config.wordpressUrl
          ? await publishToWordpress(ctx.uid, projectId, articleId)
          : await publishToBlog(ctx.uid, projectId, articleId);
    }
    return { url };
  },
});

registerTool({
  name: 'content.artigo.despublicar',
  provider: 'content',
  mode: 'write',
  description: 'Remove um artigo publicado do ar (blog nativo, WordPress ou Sanity). Sempre pede aprovação.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, articleId: { type: 'string' } },
    required: ['projectId', 'articleId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Despublicar este artigo (remove do ar).',
    alvo: requireStr(args, 'articleId'),
    campos: [{ campo: 'status', antes: 'publicado', depois: 'despublicado', mudou: true }],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId } = preview.payload as { projectId: string; articleId: string };
    await unpublishArticle(ctx.uid, projectId, articleId);
    return { ok: true };
  },
});

// Onboarding, parte 2: conectar WordPress/Sanity. Precisa ser uma ferramenta
// de SERVIDOR (não uma ferramenta de frontend via useHumanInTheLoop) —
// testado lendo o código-fonte de @ag-ui/langgraph: o adaptador desestrutura
// `tools` de RunAgentInput mas nunca o repassa para o payload enviado ao
// LangGraph, então ferramentas registradas só no cliente nunca chegam a
// aparecer pro modelo. Por isso esta ferramenta existe no registry e usa o
// mesmo mecanismo de interrupt()/aprovação das outras — mas o `execute()`
// dela não faz nada com a credencial: o valor real é gravado direto pelo
// formulário no cliente (src/modules/content/chat/CredentialForm.tsx, via
// saveWordpressSecret/saveSanitySecret) ANTES do interrupt ser resolvido.
// A senha/token nunca vira argumento de tool call nem passa pelo servidor.
registerTool({
  name: 'content.credencial.conectar',
  provider: 'content',
  mode: 'write',
  description: 'Abre o formulário para o usuário conectar WordPress ou Sanity a um projeto. Nunca peça a senha/token de aplicativo por texto — sempre chame esta ferramenta e espere o usuário preencher o formulário.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      provider: { type: 'string', enum: ['wordpress', 'sanity'] },
    },
    required: ['projectId', 'provider'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Conectar ${requireStr(args, 'provider')} a este projeto.`,
    alvo: requireStr(args, 'projectId'),
    campos: [],
    criacao: true, // não é uma edição com antes/depois — evita o aviso automático de "no-op"
    payload: args,
  }),
  execute: async () => ({ conectado: true }),
});

// ---------------------------------------------------------------------------
// Clusters — paridade com ClustersView.tsx (src/services/contentService.ts).
// ---------------------------------------------------------------------------

registerTool({
  name: 'content.clusters.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os clusters de conteúdo de um projeto: tema, estratégia, palavras-chave, se está aprovado ou excluído.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const snap = await projectRef(ctx.uid, projectId).collection('clusters').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
});

registerTool({
  name: 'content.cluster.aprovar',
  provider: 'content',
  mode: 'write',
  description: 'Aprova ou reprova um cluster de conteúdo — só clusters aprovados entram no calendário editorial gerado por content.calendario.gerar.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, clusterId: { type: 'string' }, aprovado: { type: 'boolean' } },
    required: ['projectId', 'clusterId', 'aprovado'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const clusterId = requireStr(args, 'clusterId');
    const snap = await projectRef(ctx.uid, projectId).collection('clusters').doc(clusterId).get();
    if (!snap.exists) notFound('Cluster');
    const atual = snap.data() as ContentCluster;
    const aprovado = !!args.aprovado;
    return makePreview({
      resumo: `${aprovado ? 'Aprovar' : 'Reprovar'} o cluster "${atual.nome}".`,
      alvo: atual.nome,
      campos: buildFieldDiff({ aprovado: atual.aprovado }, { aprovado }, { aprovado: 'Aprovado' }),
      payload: { projectId, clusterId, aprovado },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, clusterId, aprovado } = preview.payload as { projectId: string; clusterId: string; aprovado: boolean };
    await projectRef(ctx.uid, projectId).collection('clusters').doc(clusterId).update({ aprovado });
    return { ok: true };
  },
});

registerTool({
  name: 'content.cluster.renomear',
  provider: 'content',
  mode: 'write',
  description: 'Renomeia o tema principal de um cluster de conteúdo.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, clusterId: { type: 'string' }, nome: { type: 'string' } },
    required: ['projectId', 'clusterId', 'nome'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const clusterId = requireStr(args, 'clusterId');
    const nome = requireStr(args, 'nome');
    const snap = await projectRef(ctx.uid, projectId).collection('clusters').doc(clusterId).get();
    if (!snap.exists) notFound('Cluster');
    const atual = snap.data() as ContentCluster;
    return makePreview({
      resumo: `Renomear o cluster "${atual.nome}".`,
      alvo: atual.nome,
      campos: buildFieldDiff({ nome: atual.nome }, { nome }, { nome: 'Nome' }),
      payload: { projectId, clusterId, nome },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, clusterId, nome } = preview.payload as { projectId: string; clusterId: string; nome: string };
    await projectRef(ctx.uid, projectId).collection('clusters').doc(clusterId).update({ nome });
    return { ok: true };
  },
});

registerTool({
  name: 'content.cluster.excluir',
  provider: 'content',
  mode: 'write',
  description: 'Exclui (soft-delete) um cluster de conteúdo — some da listagem ativa, mas artigos já vinculados a ele permanecem, sob "Sem cluster".',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, clusterId: { type: 'string' } },
    required: ['projectId', 'clusterId'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const clusterId = requireStr(args, 'clusterId');
    const snap = await projectRef(ctx.uid, projectId).collection('clusters').doc(clusterId).get();
    if (!snap.exists) notFound('Cluster');
    const atual = snap.data() as ContentCluster;
    return makePreview({
      resumo: `Excluir o cluster "${atual.nome}".`,
      alvo: atual.nome,
      campos: [],
      avisos: ['Artigos já vinculados a este cluster continuam existindo, sem cluster.'],
      payload: { projectId, clusterId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, clusterId } = preview.payload as { projectId: string; clusterId: string };
    await projectRef(ctx.uid, projectId).collection('clusters').doc(clusterId).update({ excluido: true, aprovado: false });
    return { ok: true };
  },
});

registerTool({
  name: 'content.cluster.criar',
  provider: 'content',
  mode: 'write',
  description: 'Cria manualmente um cluster de conteúdo (sem pesquisa de palavras-chave por IA) — já entra aprovado.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, nome: { type: 'string' }, estrategia: { type: 'string' } },
    required: ['projectId', 'nome', 'estrategia'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const nome = requireStr(args, 'nome');
    return makePreview({
      resumo: `Criar o cluster "${nome}".`,
      alvo: nome,
      campos: [],
      criacao: true,
      payload: { projectId, nome, estrategia: requireStr(args, 'estrategia') },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, nome, estrategia } = preview.payload as { projectId: string; nome: string; estrategia: string };
    const ref = await projectRef(ctx.uid, projectId).collection('clusters').add({
      nome, estrategia, palavrasChave: [], aprovado: true, excluido: false, createdAt: new Date().toISOString(),
    });
    return { clusterId: ref.id };
  },
});

// ---------------------------------------------------------------------------
// Calendário / artigos — paridade com ArticlesProductionView.tsx/CalendarView.tsx.
// ---------------------------------------------------------------------------

const CALENDAR_SUMMARY_FIELDS = [
  'titulo', 'kwPrincipal', 'clusterId', 'scheduledDate', 'scheduledTime', 'tamanho',
  'status', 'stage', 'priority', 'urlPublicado', 'publishDestination', 'lastError',
] as const;

registerTool({
  name: 'content.calendario.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os artigos do calendário editorial de um projeto (título, palavra-chave, cluster, data agendada, status, etapa do pipeline). Não inclui o conteúdo completo do artigo — para isso, use content.calendario.artigo.ler.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const snap = await projectRef(ctx.uid, projectId).collection('calendar').orderBy('scheduledDate', 'asc').get();
    return snap.docs.map((d) => {
      const a = d.data() as CalendarArticle;
      const resumo: Record<string, unknown> = { id: d.id };
      for (const campo of CALENDAR_SUMMARY_FIELDS) resumo[campo] = (a as unknown as Record<string, unknown>)[campo] ?? null;
      return resumo;
    });
  },
});

registerTool({
  name: 'content.calendario.artigo.ler',
  provider: 'content',
  mode: 'read',
  description: 'Lê um artigo do calendário por completo, incluindo o conteúdo já gerado pelo pipeline (pesquisa, outline, rascunho, texto final, meta descrição).',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, articleId: { type: 'string' } },
    required: ['projectId', 'articleId'],
  },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const articleId = requireStr(args, 'articleId');
    const snap = await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId).get();
    if (!snap.exists) notFound('Artigo');
    return { id: snap.id, ...snap.data() };
  },
});

registerTool({
  name: 'content.artigo.editar',
  provider: 'content',
  mode: 'write',
  description: 'Edita os campos editáveis de um artigo do calendário (título, palavra-chave principal, data/hora agendada, tamanho, cluster, produtos vinculados, responsável). Não edita o conteúdo gerado pelo pipeline (outline/rascunho/final) — isso acontece via content.artigo.produzir.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      articleId: { type: 'string' },
      titulo: { type: 'string' },
      kwPrincipal: { type: 'string' },
      scheduledDate: { type: 'string', description: 'YYYY-MM-DD' },
      scheduledTime: { type: 'string', description: 'HH:MM' },
      tamanho: { type: 'string', enum: ['curto', 'medio', 'longo'] },
      clusterId: { type: 'string', description: 'Vazio para "Sem cluster".' },
      produtosVinculados: { type: 'array', items: { type: 'string' } },
      responsavel: { type: 'string' },
    },
    required: ['projectId', 'articleId'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const articleId = requireStr(args, 'articleId');
    const snap = await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId).get();
    if (!snap.exists) notFound('Artigo');
    const atual = snap.data() as CalendarArticle;
    const editaveis = ['titulo', 'kwPrincipal', 'scheduledDate', 'scheduledTime', 'tamanho', 'clusterId', 'produtosVinculados', 'responsavel'] as const;
    const patch: Record<string, unknown> = {};
    for (const campo of editaveis) if (args[campo] !== undefined) patch[campo] = args[campo];
    const labels: Record<string, string> = {
      titulo: 'Título', kwPrincipal: 'Palavra-chave', scheduledDate: 'Data agendada', scheduledTime: 'Horário',
      tamanho: 'Tamanho', clusterId: 'Cluster', produtosVinculados: 'Produtos vinculados', responsavel: 'Responsável',
    };
    return makePreview({
      resumo: `Editar o artigo "${atual.titulo}".`,
      alvo: atual.titulo,
      campos: buildFieldDiff(atual as unknown as Record<string, unknown>, patch, labels),
      payload: { projectId, articleId, patch },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId, patch } = preview.payload as { projectId: string; articleId: string; patch: Record<string, unknown> };
    await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId)
      .update({ ...patch, updatedAt: new Date().toISOString() });
    return { ok: true };
  },
});

registerTool({
  name: 'content.artigo.excluir',
  provider: 'content',
  mode: 'write',
  description: 'Remove um artigo do calendário editorial. Não despublica sozinho — se o artigo estiver publicado, use content.artigo.despublicar antes.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, articleId: { type: 'string' } },
    required: ['projectId', 'articleId'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const articleId = requireStr(args, 'articleId');
    const snap = await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId).get();
    if (!snap.exists) notFound('Artigo');
    const atual = snap.data() as CalendarArticle;
    return makePreview({
      resumo: `Excluir o artigo "${atual.titulo}".`,
      alvo: atual.titulo,
      campos: [],
      avisos: atual.status === 'publicado'
        ? ['Este artigo está publicado — excluir aqui não remove do ar. Use content.artigo.despublicar antes.']
        : [],
      payload: { projectId, articleId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId } = preview.payload as { projectId: string; articleId: string };
    await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId).delete();
    return { ok: true };
  },
});

registerTool({
  name: 'content.artigo.criar',
  provider: 'content',
  mode: 'write',
  description: 'Cria manualmente um artigo no calendário editorial (sem gerar pelo calendário automático) — fica pronto para rodar content.artigo.produzir. Entra no topo da fila de produção.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      titulo: { type: 'string' },
      kwPrincipal: { type: 'string' },
      tamanho: { type: 'string', enum: ['curto', 'medio', 'longo'] },
      scheduledDate: { type: 'string', description: 'YYYY-MM-DD' },
      clusterId: { type: 'string', description: 'Vazio para "Sem cluster".' },
      produtosVinculados: { type: 'array', items: { type: 'string' } },
    },
    required: ['projectId', 'titulo', 'kwPrincipal', 'tamanho', 'scheduledDate'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const titulo = requireStr(args, 'titulo');
    return makePreview({
      resumo: `Criar o artigo "${titulo}" no calendário.`,
      alvo: titulo,
      campos: [],
      criacao: true,
      payload: {
        projectId, titulo, kwPrincipal: requireStr(args, 'kwPrincipal'), tamanho: requireStr(args, 'tamanho'),
        scheduledDate: requireStr(args, 'scheduledDate'), clusterId: args.clusterId ?? '',
        produtosVinculados: Array.isArray(args.produtosVinculados) ? args.produtosVinculados : [],
      },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const p = preview.payload as {
      projectId: string; titulo: string; kwPrincipal: string; tamanho: ArticleSize;
      scheduledDate: string; clusterId: string; produtosVinculados: string[];
    };
    const col = projectRef(ctx.uid, p.projectId).collection('calendar');
    const existing = await col.get();
    const minPriority = existing.docs.length
      ? Math.min(...existing.docs.map((d) => Number((d.data() as CalendarArticle).priority ?? 0)))
      : 0;
    const now = new Date().toISOString();
    const ref = await col.add({
      titulo: p.titulo, kwPrincipal: p.kwPrincipal, clusterId: p.clusterId,
      scheduledDate: p.scheduledDate, tamanho: p.tamanho, produtosVinculados: p.produtosVinculados,
      status: 'agendado', stage: 0, priority: minPriority - 1, createdAt: now, updatedAt: now,
    });
    return { articleId: ref.id };
  },
});

registerTool({
  name: 'content.artigo.mover',
  provider: 'content',
  mode: 'write',
  description: 'Move um artigo para outro cluster (ou remove do cluster atual, deixando "Sem cluster").',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' }, articleId: { type: 'string' },
      clusterId: { type: 'string', description: 'Vazio para "Sem cluster".' },
    },
    required: ['projectId', 'articleId'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const articleId = requireStr(args, 'articleId');
    const snap = await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId).get();
    if (!snap.exists) notFound('Artigo');
    const atual = snap.data() as CalendarArticle;
    const clusterId = String(args.clusterId ?? '');
    return makePreview({
      resumo: `Mover o artigo "${atual.titulo}".`,
      alvo: atual.titulo,
      campos: buildFieldDiff({ clusterId: atual.clusterId ?? '' }, { clusterId }, { clusterId: 'Cluster' }),
      payload: { projectId, articleId, clusterId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId, clusterId } = preview.payload as { projectId: string; articleId: string; clusterId: string };
    await projectRef(ctx.uid, projectId).collection('calendar').doc(articleId)
      .update({ clusterId, updatedAt: new Date().toISOString() });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Produtos — só leitura, para vincular a um artigo (mesma fonte de
// listProductsForLinking em contentService.ts: users/{uid}/products).
// ---------------------------------------------------------------------------

registerTool({
  name: 'content.produtos.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os produtos do catálogo do usuário (id, nome, SKU) para vincular a um artigo.',
  schema: { type: 'object', properties: {} },
  read: async (ctx: ToolCtx) => {
    const snap = await adminDb.collection('users').doc(ctx.uid).collection('products').get();
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const id = (typeof data._id === 'string' && data._id) || d.id;
      const nome = (typeof data['Descrição'] === 'string' && data['Descrição']) || '(sem nome)';
      const sku = (typeof data['Código (SKU)'] === 'string' && data['Código (SKU)']) || '';
      return { id, nome, sku };
    });
  },
});

// ---------------------------------------------------------------------------
// Projeto — paridade com CompanyManager.tsx/IntegrationsView.tsx.
// ---------------------------------------------------------------------------

registerTool({
  name: 'content.projetos.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os projetos de conteúdo do usuário (id, nome da empresa, status). Use para descobrir o projectId de um projeto pelo nome — nunca peça o ID diretamente ao usuário sem antes tentar resolver pelo nome aqui, e se o workspace já tiver um projeto aberto (indicado no contexto do sistema), use o dele por padrão em vez de perguntar.',
  schema: { type: 'object', properties: {} },
  read: async (ctx: ToolCtx) => {
    const snap = await adminDb.collection('users').doc(ctx.uid).collection('contentProjects').get();
    return snap.docs.map((d) => {
      const data = d.data() as { config: ContentProjectConfig; status: string };
      return { id: d.id, nomeEmpresa: data.config?.nomeEmpresa ?? '(sem nome)', status: data.status };
    });
  },
});

registerTool({
  name: 'content.projeto.renomear',
  provider: 'content',
  mode: 'write',
  description: 'Renomeia a empresa/marca de um projeto de conteúdo. Para outros campos, use content.projeto.config.atualizar.',
  schema: { type: 'object', properties: { projectId: { type: 'string' }, nomeEmpresa: { type: 'string' } }, required: ['projectId', 'nomeEmpresa'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    const nomeEmpresa = requireStr(args, 'nomeEmpresa');
    return makePreview({
      resumo: `Renomear o projeto "${project.config.nomeEmpresa}".`,
      alvo: project.config.nomeEmpresa,
      campos: buildFieldDiff({ nomeEmpresa: project.config.nomeEmpresa }, { nomeEmpresa }, { nomeEmpresa: 'Nome' }),
      payload: { projectId: project.id, nomeEmpresa },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, nomeEmpresa } = preview.payload as { projectId: string; nomeEmpresa: string };
    await projectRef(ctx.uid, projectId).update({ 'config.nomeEmpresa': nomeEmpresa, updatedAt: new Date().toISOString() });
    return { ok: true };
  },
});

const PROJECT_SUBCOLLECTIONS = ['clusters', 'calendar', 'seoAudits', 'blogPosts', 'blogCategories'] as const;
const PROJECT_FIXED_DOCS: Array<[string, string]> = [['secrets', 'wordpress'], ['secrets', 'sanity'], ['blog', 'settings']];

// Sempre pede aprovação (ver ALWAYS_ASK_TOOLS em agentSettings.ts) — apaga o
// projeto inteiro em cascata, irreversível, alto raio de impacto.
registerTool({
  name: 'content.projeto.excluir',
  provider: 'content',
  mode: 'write',
  description: 'Exclui um projeto de conteúdo inteiro — clusters, calendário, auditorias de SEO, posts e categorias do blog nativo, e credenciais conectadas. Irreversível. Sempre pede aprovação.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Excluir o projeto "${project.config.nomeEmpresa}" e tudo dentro dele.`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      avisos: ['Irreversível: apaga clusters, calendário, auditorias de SEO, blog nativo e credenciais conectadas.'],
      payload: { projectId: project.id },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId } = preview.payload as { projectId: string };
    const base = projectRef(ctx.uid, projectId);
    const refsToDelete: FirebaseFirestore.DocumentReference[] = [];
    for (const sub of PROJECT_SUBCOLLECTIONS) {
      const snap = await base.collection(sub).get();
      snap.forEach((d) => refsToDelete.push(d.ref));
    }
    for (const [col, id] of PROJECT_FIXED_DOCS) refsToDelete.push(base.collection(col).doc(id));
    refsToDelete.push(base);
    const CHUNK = 500;
    for (let i = 0; i < refsToDelete.length; i += CHUNK) {
      const batch = adminDb.batch();
      for (const ref of refsToDelete.slice(i, i + CHUNK)) batch.delete(ref);
      await batch.commit();
    }
    return { ok: true };
  },
});

const CONFIG_PATCHABLE_FIELDS = [
  'descricao', 'produtoServico', 'publicoAlvo', 'tomDeVoz', 'objetivos', 'palavrasChave', 'frequenciaPostagens',
  'wordpressUrl', 'wordpressUser', 'sanityProjectId', 'sanityDataset', 'sanityBlogUrl', 'sanityDocType',
  'sanityBodyField', 'sanityCategoryField', 'sanityCategoryType', 'sanityCategoryNameField', 'sanityImageField',
  'sanityCategoryIsArray', 'estiloImagem', 'siteUrl',
] as const;

registerTool({
  name: 'content.projeto.config.atualizar',
  provider: 'content',
  mode: 'write',
  description: 'Atualiza a configuração de um projeto de conteúdo (descrição, produto/serviço, público-alvo, tom de voz, objetivos, palavras-chave, frequência de postagens, config de publicação WordPress/Sanity). NUNCA aceita senha/token — isso é sempre content.credencial.conectar. Só os campos informados mudam.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      descricao: { type: 'string' },
      produtoServico: { type: 'string' },
      publicoAlvo: { type: 'array', items: { type: 'string' } },
      tomDeVoz: { type: 'string' },
      objetivos: { type: 'array', items: { type: 'string' } },
      palavrasChave: { type: 'array', items: { type: 'string' } },
      frequenciaPostagens: { type: 'string' },
      wordpressUrl: { type: 'string' },
      wordpressUser: { type: 'string' },
      sanityProjectId: { type: 'string' },
      sanityDataset: { type: 'string' },
      sanityBlogUrl: { type: 'string' },
      sanityDocType: { type: 'string' },
      sanityBodyField: { type: 'string' },
      sanityCategoryField: { type: 'string' },
      sanityCategoryType: { type: 'string' },
      sanityCategoryNameField: { type: 'string' },
      sanityImageField: { type: 'string' },
      sanityCategoryIsArray: { type: 'boolean' },
      estiloImagem: { type: 'string', enum: ['Realista', 'Ilustracao', '3D', 'Cartoon'] },
      siteUrl: { type: 'string' },
    },
    required: ['projectId'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    const patch: Record<string, unknown> = {};
    for (const campo of CONFIG_PATCHABLE_FIELDS) if (args[campo] !== undefined) patch[campo] = args[campo];
    return makePreview({
      resumo: `Atualizar a configuração de "${project.config.nomeEmpresa}".`,
      alvo: project.config.nomeEmpresa,
      campos: buildFieldDiff(project.config as unknown as Record<string, unknown>, patch, {}),
      payload: { projectId: project.id, patch },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, patch } = preview.payload as { projectId: string; patch: Record<string, unknown> };
    const project = await loadProject(ctx.uid, projectId);
    const config: ContentProjectConfig = { ...project.config, ...patch };
    await projectRef(ctx.uid, projectId).update({ config, updatedAt: new Date().toISOString() });
    return { ok: true };
  },
});
