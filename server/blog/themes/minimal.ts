// Tema "Minimal" (id 'minimal'): uma coluna central serifada, foco na leitura.
// Cabeçalho centralizado, listagem sem capas, byline discreta.
import type { BlogPost } from '../../../src/modules/content/blog/types';
import {
  escapeHtml, fmtDate, readingTime, homeUrl, postUrl, categoryUrl,
  pagerHtml, effectiveLayout, type BlogRenderContext,
} from '../shell';
import type { BlogTheme, ListOpts } from './types';

function meta(ctx: BlogRenderContext, p: BlogPost): string {
  const cat = ctx.categories.find((c) => (p.categoryIds ?? []).includes(c.id));
  return `<div class="mn-meta">${fmtDate(p.publishedAt)} · ${readingTime(p.html)} min${
    p.authorName ? ` · ${escapeHtml(p.authorName)}` : ''
  }${cat ? ` · <a href="${categoryUrl(ctx, cat)}">${escapeHtml(cat.name)}</a>` : ''}</div>`;
}

function header(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<header class="mn-header">
    <a class="mn-brand" href="${homeUrl(ctx)}">${s.logoUrl
      ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
      : escapeHtml(s.title)}</a>
    ${s.description ? `<p class="mn-tagline">${escapeHtml(s.description)}</p>` : ''}
    ${l.showCategoriesNav && ctx.categories.length
      ? `<nav class="mn-nav">${ctx.categories.map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`).join('')}</nav>`
      : ''}
  </header>`;
}

function footer(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<footer class="mn-footer">${
    l.footerText?.trim() ? escapeHtml(l.footerText.trim()) : `© ${new Date().getFullYear()} ${escapeHtml(s.title)}`
  }</footer>`;
}

function row(ctx: BlogRenderContext, p: BlogPost): string {
  return `<article class="mn-item">
    <h2><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h2>
    ${meta(ctx, p)}
    <p>${escapeHtml(p.excerpt)}</p>
  </article>`;
}

function list(ctx: BlogRenderContext, posts: BlogPost[]): string {
  return `<div class="mn-list">${posts.map((p) => row(ctx, p)).join('')}</div>`;
}

function shell(ctx: BlogRenderContext, main: string): string {
  return `${header(ctx)}<main class="mn-main">${main}</main>${footer(ctx)}`;
}

export const minimal: BlogTheme = {
  css: () => `
    .mn-main,.mn-header,.mn-footer{max-width:680px;margin-left:auto;margin-right:auto;padding-left:24px;padding-right:24px;}
    .mn-header{text-align:center;padding-top:56px;padding-bottom:32px;border-bottom:1px solid rgba(0,0,0,.08);}
    .mn-brand{font-family:var(--heading-font);font-weight:700;font-size:1.8rem;display:inline-block;}
    .mn-brand img{max-height:48px;width:auto;margin:0 auto;}
    .mn-tagline{opacity:.6;margin-top:8px;font-size:1rem;}
    .mn-nav{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:18px;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;}
    .mn-nav a{opacity:.6;} .mn-nav a:hover{opacity:1;color:var(--primary);}
    .mn-main{padding-top:40px;padding-bottom:56px;}
    .mn-item{padding:28px 0;border-bottom:1px solid rgba(0,0,0,.07);}
    .mn-item h2{font-size:1.6rem;margin-bottom:8px;}
    .mn-item h2 a:hover{color:var(--primary);}
    .mn-meta{font-size:.8rem;opacity:.55;margin-bottom:10px;}
    .mn-meta a{color:var(--primary);}
    .mn-item p{opacity:.8;}
    .mn-cat-head{text-align:center;padding:8px 0 8px;} .mn-cat-head h1{font-size:2rem;} .mn-cat-head p{opacity:.65;margin-top:8px;}
    .mn-article h1{font-size:2.3rem;line-height:1.2;text-align:center;margin-bottom:16px;}
    .mn-article .mn-byline{text-align:center;margin-bottom:28px;}
    .mn-article .mn-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:28px;}
    .empty{opacity:.6;padding:40px 0;text-align:center;}
    @media(max-width:560px){.mn-item h2{font-size:1.35rem;}.mn-article h1{font-size:1.8rem;}}
  `,

  renderHome(ctx, posts, opts) {
    const body = posts.length
      ? `${list(ctx, posts)}${pagerHtml(ctx, '/', opts)}`
      : `<p class="empty">Nenhum post publicado ainda.</p>`;
    return shell(ctx, body);
  },

  renderCategory(ctx, category, posts, opts) {
    const head = `<div class="mn-cat-head"><h1>${escapeHtml(category.name)}</h1>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}</div>`;
    const body = posts.length
      ? `${list(ctx, posts)}${pagerHtml(ctx, `/categoria/${encodeURIComponent(category.slug)}`, opts)}`
      : `<p class="empty">Nenhum post nesta categoria ainda.</p>`;
    return shell(ctx, `${head}${body}`);
  },

  renderArticle(ctx, post) {
    const body = `<article class="mn-article post-body">
      ${post.coverImageUrl ? `<img class="mn-cover" src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.title)}">` : ''}
      <h1>${escapeHtml(post.title)}</h1>
      <div class="mn-byline">${meta(ctx, post)}</div>
      ${post.html}
    </article>`;
    return shell(ctx, body);
  },
};
