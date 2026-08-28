// Ferramentas do blog nativo (CMS) do Agente de Conteúdo — paridade com
// src/modules/content/blog/BlogView.tsx (src/services/blogService.ts).
// Mesmo padrão de content.ts: casca fina sobre Firestore via Admin SDK, sem
// duplicar regras de negócio (não há pipeline de IA aqui, é CRUD direto).
//
// Gestão de domínio customizado (claim-slug, CNAME/proxy via Cloudflare) FICA
// DE FORA por ora — vive em rotas inline em server/blogAdmin.ts (não em
// funções exportadas reaproveitáveis) e envolve verificação DNS assíncrona
// externa; extrair isso com segurança é um trabalho à parte.

import { registerTool } from '../registry';
import { makePreview, buildFieldDiff, requireStr } from '../preview';
import type { ToolCtx } from '../types';
import { loadProject, projectRef } from '../../contentAgent';
import type { BlogPost, BlogCategory } from '../../../src/modules/content/blog/types';

function notFound(entidade: string): never {
  throw Object.assign(new Error(`${entidade} não encontrado.`), { status: 404 });
}

const blogSettingsRef = (uid: string, projectId: string) => projectRef(uid, projectId).collection('blog').doc('settings');
const blogPostsCol = (uid: string, projectId: string) => projectRef(uid, projectId).collection('blogPosts');
const blogCategoriesCol = (uid: string, projectId: string) => projectRef(uid, projectId).collection('blogCategories');

registerTool({
  name: 'content.blog.config.ler',
  provider: 'content',
  mode: 'read',
  description: 'Lê a configuração do blog nativo de um projeto: habilitado, slug público, título, descrição, template, cores, fontes, layout, aparência e domínios customizados.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const snap = await blogSettingsRef(ctx.uid, projectId).get();
    return snap.exists ? snap.data() : null;
  },
});

registerTool({
  name: 'content.blog.config.atualizar',
  provider: 'content',
  mode: 'write',
  description: 'Atualiza a configuração do blog nativo (habilitar/desabilitar, título, descrição, template, logo, cores, fontes, layout, aparência). O slug público (URL) e os domínios customizados não são alterados aqui. Só os campos informados mudam.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      enabled: { type: 'boolean' },
      title: { type: 'string' },
      description: { type: 'string' },
      template: { type: 'string', enum: ['editorial', 'minimal', 'grid'] },
      logoUrl: { type: 'string' },
      colors: {
        type: 'object',
        description: 'Cores em hex, ex.: {"primary":"#2563eb","background":"#ffffff","text":"#0f172a"}.',
        properties: { primary: { type: 'string' }, background: { type: 'string' }, text: { type: 'string' } },
      },
      fonts: {
        type: 'object',
        description: 'Nomes de fontes do Google Fonts, ex.: {"heading":"Playfair Display","body":"Merriweather"}.',
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
      },
      layout: {
        type: 'object',
        properties: {
          contentWidth: { type: 'string', enum: ['estreito', 'normal', 'largo'] },
          headerAlign: { type: 'string', enum: ['esquerda', 'centro'] },
          cardStyle: { type: 'string', enum: ['sombra', 'borda', 'plano'] },
          cornerRadius: { type: 'string', enum: ['reto', 'suave', 'arredondado'] },
          showCategoriesNav: { type: 'boolean' },
          footerText: { type: 'string' },
        },
      },
      appearance: {
        type: 'object',
        description: 'Variantes descritas em BLOG_APPEARANCE_OPTIONS.',
        properties: {
          header: { type: 'string', enum: ['logo-esquerda', 'logo-centro', 'logo-topo'] },
          footer: { type: 'string', enum: ['simples', 'colunas', 'centralizado'] },
          footerShowCategories: { type: 'boolean' },
          category: { type: 'string', enum: ['grade', 'lista', 'destaque-grade'] },
          card: { type: 'string', enum: ['com-borda', 'plano', 'sombra'] },
          cardShowAuthor: { type: 'boolean' },
          cardShowExcerpt: { type: 'boolean' },
          cardShowMeta: { type: 'boolean' },
          cardShowCategory: { type: 'boolean' },
          article: { type: 'string', enum: ['centrado', 'capa-larga', 'lateral-meta'] },
        },
      },
    },
    required: ['projectId'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const snap = await blogSettingsRef(ctx.uid, projectId).get();
    const atual = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
    const patchable = ['enabled', 'title', 'description', 'template', 'logoUrl', 'colors', 'fonts', 'layout', 'appearance'] as const;
    const patch: Record<string, unknown> = {};
    for (const campo of patchable) if (args[campo] !== undefined) patch[campo] = args[campo];
    return makePreview({
      resumo: 'Atualizar a configuração do blog nativo.',
      alvo: String(atual.title ?? 'blog'),
      campos: buildFieldDiff(atual, patch, {}),
      criacao: !snap.exists,
      payload: { projectId, patch },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, patch } = preview.payload as { projectId: string; patch: Record<string, unknown> };
    await blogSettingsRef(ctx.uid, projectId).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    return { ok: true };
  },
});

registerTool({
  name: 'content.blog.posts.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os posts do blog nativo (título, slug, resumo, status, categorias, data de publicação). Não inclui o HTML completo — para isso, use content.blog.post.ler.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const snap = await blogPostsCol(ctx.uid, projectId).orderBy('updatedAt', 'desc').get();
    return snap.docs.map((d) => {
      const p = d.data() as BlogPost;
      return {
        id: d.id, title: p.title, slug: p.slug, excerpt: p.excerpt, status: p.status,
        categoryIds: p.categoryIds, publishedAt: p.publishedAt ?? null, updatedAt: p.updatedAt,
      };
    });
  },
});

registerTool({
  name: 'content.blog.post.ler',
  provider: 'content',
  mode: 'read',
  description: 'Lê um post do blog nativo por completo, incluindo o HTML do corpo.',
  schema: { type: 'object', properties: { projectId: { type: 'string' }, postId: { type: 'string' } }, required: ['projectId', 'postId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const postId = requireStr(args, 'postId');
    const snap = await blogPostsCol(ctx.uid, projectId).doc(postId).get();
    if (!snap.exists) notFound('Post');
    return { id: snap.id, ...snap.data() };
  },
});

registerTool({
  name: 'content.blog.post.salvar',
  provider: 'content',
  mode: 'write',
  description: 'Cria ou atualiza (se postId for informado) um post do blog nativo.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      postId: { type: 'string', description: 'Omitir para criar um post novo.' },
      title: { type: 'string' },
      slug: { type: 'string' },
      html: { type: 'string' },
      excerpt: { type: 'string' },
      coverImageUrl: { type: 'string' },
      categoryIds: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['draft', 'published'] },
      metaTitle: { type: 'string' },
      metaDescription: { type: 'string' },
      authorName: { type: 'string' },
    },
    required: ['projectId', 'title', 'slug', 'html', 'excerpt', 'categoryIds', 'status'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const postId = typeof args.postId === 'string' ? args.postId : undefined;
    let atual: Record<string, unknown> = {};
    if (postId) {
      const snap = await blogPostsCol(ctx.uid, projectId).doc(postId).get();
      if (!snap.exists) notFound('Post');
      atual = snap.data() as Record<string, unknown>;
    }
    const { projectId: _pid, postId: _pidArg, ...rest } = args;
    const titulo = requireStr(args, 'title');
    return makePreview({
      resumo: `${postId ? 'Atualizar' : 'Criar'} o post "${titulo}".`,
      alvo: titulo,
      campos: postId ? buildFieldDiff(atual, rest, {}) : [],
      criacao: !postId,
      avisos: args.status === 'published' ? ['Post fica público imediatamente ao salvar.'] : [],
      payload: { projectId, postId, patch: rest },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, postId, patch } = preview.payload as { projectId: string; postId?: string; patch: Record<string, unknown> };
    const col = blogPostsCol(ctx.uid, projectId);
    const now = new Date().toISOString();
    if (postId) {
      await col.doc(postId).update({ ...patch, updatedAt: now });
      return { postId };
    }
    const ref = await col.add({ ...patch, updatedAt: now, createdAt: now });
    return { postId: ref.id };
  },
});

registerTool({
  name: 'content.blog.post.excluir',
  provider: 'content',
  mode: 'write',
  description: 'Exclui um post do blog nativo.',
  schema: { type: 'object', properties: { projectId: { type: 'string' }, postId: { type: 'string' } }, required: ['projectId', 'postId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const postId = requireStr(args, 'postId');
    const snap = await blogPostsCol(ctx.uid, projectId).doc(postId).get();
    if (!snap.exists) notFound('Post');
    const atual = snap.data() as BlogPost;
    return makePreview({
      resumo: `Excluir o post "${atual.title}".`,
      alvo: atual.title,
      campos: [],
      avisos: atual.status === 'published' ? ['Este post está publicado — excluir remove do ar imediatamente.'] : [],
      payload: { projectId, postId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, postId } = preview.payload as { projectId: string; postId: string };
    await blogPostsCol(ctx.uid, projectId).doc(postId).delete();
    return { ok: true };
  },
});

registerTool({
  name: 'content.blog.categorias.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista as categorias do blog nativo.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const snap = await blogCategoriesCol(ctx.uid, projectId).orderBy('name').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
});

registerTool({
  name: 'content.blog.categoria.salvar',
  provider: 'content',
  mode: 'write',
  description: 'Cria ou atualiza (se catId for informado) uma categoria do blog nativo.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      catId: { type: 'string', description: 'Omitir para criar uma categoria nova.' },
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['projectId', 'name', 'slug'],
  },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId);
    const catId = typeof args.catId === 'string' ? args.catId : undefined;
    let atual: Record<string, unknown> = {};
    if (catId) {
      const snap = await blogCategoriesCol(ctx.uid, projectId).doc(catId).get();
      if (!snap.exists) notFound('Categoria');
      atual = snap.data() as Record<string, unknown>;
    }
    const { projectId: _pid, catId: _catIdArg, ...rest } = args;
    const nome = requireStr(args, 'name');
    return makePreview({
      resumo: `${catId ? 'Atualizar' : 'Criar'} a categoria "${nome}".`,
      alvo: nome,
      campos: catId ? buildFieldDiff(atual, rest, {}) : [],
      criacao: !catId,
      payload: { projectId, catId, patch: rest },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, catId, patch } = preview.payload as { projectId: string; catId?: string; patch: Record<string, unknown> };
    const col = blogCategoriesCol(ctx.uid, projectId);
    if (catId) {
      await col.doc(catId).update(patch);
      return { catId };
    }
    const ref = await col.add({ ...patch, createdAt: new Date().toISOString() });
    return { catId: ref.id };
  },
});

registerTool({
  name: 'content.blog.categoria.excluir',
  provider: 'content',
  mode: 'write',
  description: 'Exclui uma categoria do blog nativo. Posts vinculados a ela não são excluídos, só perdem a categoria.',
  schema: { type: 'object', properties: { projectId: { type: 'string' }, catId: { type: 'string' } }, required: ['projectId', 'catId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    const catId = requireStr(args, 'catId');
    const snap = await blogCategoriesCol(ctx.uid, projectId).doc(catId).get();
    if (!snap.exists) notFound('Categoria');
    const atual = snap.data() as BlogCategory;
    return makePreview({
      resumo: `Excluir a categoria "${atual.name}".`,
      alvo: atual.name,
      campos: [],
      payload: { projectId, catId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, catId } = preview.payload as { projectId: string; catId: string };
    await blogCategoriesCol(ctx.uid, projectId).doc(catId).delete();
    return { ok: true };
  },
});
