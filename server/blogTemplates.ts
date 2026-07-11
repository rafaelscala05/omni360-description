// Dispatcher SSR do blog nativo. Escolhe o tema por settings.template e compõe
// o <head>/SEO (aqui) + o corpo do tema (server/blog/themes/*) via renderDocument.
import type { BlogSettings, BlogPost, BlogCategory, BlogTemplateId } from '../src/modules/content/blog/types';
import {
  renderDocument, escapeHtml, googleFontsLink, homeUrl, withDemoQuery,
  type BlogRenderContext,
} from './blog/shell';
import { THEMES } from './blog/themes';

export type { BlogRenderContext } from './blog/shell';
export { escapeHtml, googleFontsLink } from './blog/shell';

function theme(id: BlogTemplateId) {
  return THEMES[id] ?? THEMES.editorial;
}
function cpBase(ctx: BlogRenderContext): string {
  return ctx.canonicalPathPrefix ?? ctx.baseUrl;
}

export function renderHome(
  ctx: BlogRenderContext,
  posts: BlogPost[],
  opts: { page: number; hasMore: boolean },
): string {
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  return renderDocument(ctx, {
    title: s.title,
    description: s.description,
    canonicalPath: `${cp}/`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: s.title, description: s.description, url: ctx.canonicalBase + cp + '/' },
  }, { css: t.css(ctx), body: t.renderHome(ctx, posts, opts) });
}

export function renderCategory(
  ctx: BlogRenderContext,
  category: BlogCategory,
  posts: BlogPost[],
  opts: { page: number; hasMore: boolean },
): string {
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  const path = `/categoria/${encodeURIComponent(category.slug)}`;
  return renderDocument(ctx, {
    title: `${category.name} — ${s.title}`,
    description: category.description || s.description,
    canonicalPath: `${cp}${path}`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: `${category.name} — ${s.title}`, description: category.description || s.description, url: ctx.canonicalBase + cp + path },
  }, { css: t.css(ctx), body: t.renderCategory(ctx, category, posts, opts) });
}

export function renderPost(ctx: BlogRenderContext, post: BlogPost): string {
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  return renderDocument(ctx, {
    title: post.seo.metaTitle || `${post.title} — ${s.title}`,
    description: post.seo.metaDescription || post.excerpt,
    canonicalPath: `${cp}/${encodeURIComponent(post.slug)}`,
    ogImage: post.coverImageUrl,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: post.seo.metaDescription || post.excerpt,
      image: post.coverImageUrl, datePublished: post.publishedAt, dateModified: post.updatedAt,
      author: post.authorName ? { '@type': 'Person', name: post.authorName } : { '@type': 'Organization', name: s.title },
      mainEntityOfPage: ctx.canonicalBase + cp + '/' + encodeURIComponent(post.slug),
    },
  }, { css: t.css(ctx), body: t.renderArticle(ctx, post) });
}

export function renderNotFound(ctx: BlogRenderContext | null, message: string): string {
  if (!ctx) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Não encontrado</title></head><body style="font-family:sans-serif;text-align:center;padding:80px 16px"><h1>404</h1><p>${escapeHtml(message)}</p></body></html>`;
  }
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  const body = `<main style="max-width:680px;margin:0 auto;padding:80px 24px;text-align:center"><h1 style="font-size:2.4rem;margin-bottom:12px">404</h1><p style="margin-bottom:20px">${escapeHtml(message)}</p><p><a style="color:var(--primary)" href="${homeUrl(ctx)}">← Voltar ao blog</a></p></main>`;
  return renderDocument(ctx, {
    title: `Não encontrado — ${s.title}`, description: message,
    canonicalPath: `${cp}/`, jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Não encontrado' },
  }, { css: t.css(ctx), body });
}

// Reexport para consumidores que ainda importam daqui (compat).
export { withDemoQuery };
