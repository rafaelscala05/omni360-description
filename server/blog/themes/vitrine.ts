// Tema "Vitrine" (id 'grid'): mosaico visual com capas grandes ocupando o card,
// tag + título sobre a imagem. Cabeçalho escuro, sans geométrica.
import type { BlogPost } from '../../../src/modules/content/blog/types';
import {
  escapeHtml, fmtDate, readingTime, homeUrl, postUrl, categoryUrl,
  pagerHtml, effectiveLayout, type BlogRenderContext,
} from '../shell';
import type { BlogTheme, ListOpts } from './types';

// Cor de capa determinística p/ posts sem coverImageUrl (evita card vazio).
const FALLBACKS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6'];
function coverBg(p: BlogPost, i: number): string {
  return p.coverImageUrl ? `background-image:url('${escapeHtml(p.coverImageUrl)}')` : `background-color:${FALLBACKS[i % FALLBACKS.length]}`;
}

function header(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<header class="vt-header"><div class="vt-inner">
    <a class="vt-brand" href="${homeUrl(ctx)}">${s.logoUrl
      ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
      : escapeHtml(s.title)}</a>
    ${l.showCategoriesNav && ctx.categories.length
      ? `<nav class="vt-nav">${ctx.categories.map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`).join('')}</nav>`
      : ''}
  </div></header>`;
}

function footer(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<footer class="vt-footer"><div class="vt-inner">${
    l.footerText?.trim() ? escapeHtml(l.footerText.trim()) : `© ${new Date().getFullYear()} ${escapeHtml(s.title)}`
  }</div></footer>`;
}

function tile(ctx: BlogRenderContext, p: BlogPost, i: number): string {
  const cat = ctx.categories.find((c) => (p.categoryIds ?? []).includes(c.id));
  return `<a class="vt-tile" href="${postUrl(ctx, p)}" style="${coverBg(p, i)}">
    <div class="vt-tile-overlay">
      ${cat ? `<span class="vt-chip">${escapeHtml(cat.name)}</span>` : ''}
      <h3>${escapeHtml(p.title)}</h3>
      <div class="vt-tile-meta">${fmtDate(p.publishedAt)} · ${readingTime(p.html)} min</div>
    </div>
  </a>`;
}

function masonry(ctx: BlogRenderContext, posts: BlogPost[]): string {
  return `<div class="vt-masonry">${posts.map((p, i) => tile(ctx, p, i)).join('')}</div>`;
}

function shell(ctx: BlogRenderContext, main: string): string {
  return `${header(ctx)}<main class="vt-main"><div class="vt-inner">${main}</div></main>${footer(ctx)}`;
}

export const vitrine: BlogTheme = {
  css: () => `
    .vt-inner{max-width:1200px;margin:0 auto;padding:0 24px;}
    .vt-header{background:#0f172a;color:#fff;padding:18px 0;}
    .vt-header .vt-inner{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}
    .vt-brand{font-family:var(--heading-font);font-weight:800;font-size:1.4rem;letter-spacing:.02em;color:#fff;}
    .vt-brand img{max-height:40px;width:auto;}
    .vt-nav{display:flex;gap:18px;flex-wrap:wrap;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
    .vt-nav a{color:#94a3b8;} .vt-nav a:hover{color:#fff;}
    .vt-main{padding:40px 0 64px;}
    .vt-masonry{columns:3;column-gap:20px;}
    .vt-tile{display:block;break-inside:avoid;margin-bottom:20px;border-radius:14px;overflow:hidden;position:relative;min-height:220px;background-size:cover;background-position:center;color:#fff;}
    .vt-tile:nth-child(3n+1){min-height:300px;} .vt-tile:nth-child(4n){min-height:250px;}
    .vt-tile-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:18px;background:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,.05) 65%);}
    .vt-chip{align-self:flex-start;background:var(--primary);color:#fff;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
    .vt-tile h3{font-size:1.25rem;line-height:1.25;color:#fff;}
    .vt-tile-meta{font-size:.75rem;opacity:.85;}
    .vt-cat-head{margin-bottom:32px;} .vt-cat-head h1{font-size:2.4rem;} .vt-cat-head p{opacity:.7;margin-top:8px;max-width:640px;}
    .vt-article-hero{position:relative;min-height:360px;border-radius:0;display:flex;align-items:flex-end;background-size:cover;background-position:center;color:#fff;margin-bottom:36px;}
    .vt-article-hero .vt-hero-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.8),rgba(0,0,0,.1));}
    .vt-article-hero .vt-hero-inner{position:relative;padding:40px 24px;max-width:820px;margin:0 auto;width:100%;}
    .vt-article-hero h1{font-size:2.8rem;line-height:1.1;color:#fff;margin-bottom:12px;}
    .vt-article-hero .vt-byline{font-size:.85rem;opacity:.9;}
    .vt-article-hero .vt-chip{margin-bottom:12px;}
    .vt-article{max-width:760px;margin:0 auto;}
    .empty{opacity:.6;padding:40px 0;}
    @media(max-width:900px){.vt-masonry{columns:2;}}
    @media(max-width:560px){.vt-masonry{columns:1;}.vt-article-hero h1{font-size:1.9rem;}.vt-article-hero{min-height:260px;}}
  `,

  renderHome(ctx, posts, opts) {
    const body = posts.length
      ? `${masonry(ctx, posts)}${pagerHtml(ctx, '/', opts)}`
      : `<p class="empty">Nenhum post publicado ainda.</p>`;
    return shell(ctx, body);
  },

  renderCategory(ctx, category, posts, opts) {
    const head = `<div class="vt-cat-head"><h1>${escapeHtml(category.name)}</h1>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}</div>`;
    const body = posts.length
      ? `${masonry(ctx, posts)}${pagerHtml(ctx, `/categoria/${encodeURIComponent(category.slug)}`, opts)}`
      : `<p class="empty">Nenhum post nesta categoria ainda.</p>`;
    return shell(ctx, `${head}${body}`);
  },

  renderArticle(ctx, post) {
    const cat = ctx.categories.find((c) => (post.categoryIds ?? []).includes(c.id));
    const heroStyle = post.coverImageUrl ? `background-image:url('${escapeHtml(post.coverImageUrl)}')` : `background-color:#0f172a`;
    const hero = `<div class="vt-article-hero" style="${heroStyle}">
      <div class="vt-hero-overlay"></div>
      <div class="vt-hero-inner">
        ${cat ? `<span class="vt-chip">${escapeHtml(cat.name)}</span>` : ''}
        <h1>${escapeHtml(post.title)}</h1>
        <div class="vt-byline">${fmtDate(post.publishedAt)} · ${readingTime(post.html)} min de leitura${post.authorName ? ` · ${escapeHtml(post.authorName)}` : ''}</div>
      </div>
    </div>`;
    // O hero é full-bleed (fora do .vt-inner); o corpo fica no container.
    return `${header(ctx)}<main class="vt-main">${hero}<div class="vt-inner"><article class="vt-article post-body">${post.html}</article></div></main>${footer(ctx)}`;
  },
};
