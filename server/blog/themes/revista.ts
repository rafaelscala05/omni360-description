// Tema "Revista" (id interno 'editorial'): estilo magazine — post em destaque
// grande + grade de 3 colunas. Cabeçalho claro com logo à esquerda e nav de
// categorias. Byline com chip de categoria, data, tempo de leitura e autor.
import type { BlogPost, BlogCategory } from '../../../src/modules/content/blog/types';
import {
  escapeHtml, fmtDate, readingTime, homeUrl, postUrl, categoryUrl,
  pagerHtml, effectiveLayout, type BlogRenderContext,
} from '../shell';
import type { BlogTheme, ListOpts } from './types';

function postCats(ctx: BlogRenderContext, p: BlogPost): BlogCategory[] {
  return ctx.categories.filter((c) => (p.categoryIds ?? []).includes(c.id));
}

function meta(ctx: BlogRenderContext, p: BlogPost): string {
  const cat = postCats(ctx, p)[0];
  return `<div class="rv-meta">
    ${cat ? `<a class="rv-chip" href="${categoryUrl(ctx, cat)}">${escapeHtml(cat.name)}</a>` : ''}
    <span>${fmtDate(p.publishedAt)}</span>
    <span>${readingTime(p.html)} min de leitura</span>
    ${p.authorName ? `<span>${escapeHtml(p.authorName)}</span>` : ''}
  </div>`;
}

function header(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<header class="rv-header"><div class="rv-inner">
    <a class="rv-brand" href="${homeUrl(ctx)}">${s.logoUrl
      ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
      : escapeHtml(s.title)}</a>
    ${l.showCategoriesNav && ctx.categories.length
      ? `<nav class="rv-nav">${ctx.categories.map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`).join('')}</nav>`
      : ''}
  </div></header>`;
}

function footer(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<footer class="rv-footer"><div class="rv-inner">${
    l.footerText?.trim() ? escapeHtml(l.footerText.trim()) : `© ${new Date().getFullYear()} ${escapeHtml(s.title)}`
  }</div></footer>`;
}

function card(ctx: BlogRenderContext, p: BlogPost): string {
  return `<article class="rv-card">
    ${p.coverImageUrl ? `<a class="rv-card-img" href="${postUrl(ctx, p)}"><img src="${escapeHtml(p.coverImageUrl)}" alt="${escapeHtml(p.title)}"></a>` : ''}
    <div class="rv-card-body">
      ${meta(ctx, p)}
      <h3><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h3>
      <p>${escapeHtml(p.excerpt)}</p>
    </div>
  </article>`;
}

function grid(ctx: BlogRenderContext, posts: BlogPost[]): string {
  return `<div class="rv-grid">${posts.map((p) => card(ctx, p)).join('')}</div>`;
}

function featured(ctx: BlogRenderContext, p: BlogPost): string {
  return `<a class="rv-featured" href="${postUrl(ctx, p)}">
    ${p.coverImageUrl ? `<div class="rv-featured-img"><img src="${escapeHtml(p.coverImageUrl)}" alt="${escapeHtml(p.title)}"></div>` : ''}
    <div class="rv-featured-body">
      ${meta(ctx, p)}
      <h2>${escapeHtml(p.title)}</h2>
      <p>${escapeHtml(p.excerpt)}</p>
    </div>
  </a>`;
}

function shell(ctx: BlogRenderContext, main: string): string {
  return `${header(ctx)}<main class="rv-main">${main}</main>${footer(ctx)}`;
}

export const revista: BlogTheme = {
  css: () => `
    .rv-inner{max-width:1180px;margin:0 auto;padding:0 24px;}
    .rv-header{border-bottom:1px solid rgba(0,0,0,.08);padding:20px 0;}
    .rv-header .rv-inner{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}
    .rv-brand{font-family:var(--heading-font);font-weight:800;font-size:1.5rem;}
    .rv-brand img{max-height:44px;width:auto;}
    .rv-nav{display:flex;gap:20px;flex-wrap:wrap;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
    .rv-nav a{opacity:.7;} .rv-nav a:hover{opacity:1;color:var(--primary);}
    .rv-main{padding:48px 0 64px;} .rv-main>.rv-inner{}
    .rv-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:.78rem;opacity:.6;margin-bottom:10px;}
    .rv-chip{background:var(--primary);color:#fff;opacity:1;padding:3px 9px;border-radius:999px;font-weight:700;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;}
    .rv-featured{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;align-items:center;margin-bottom:56px;}
    .rv-featured-img img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:14px;}
    .rv-featured h2{font-size:2.4rem;margin:6px 0 12px;}
    .rv-featured p{opacity:.75;font-size:1.05rem;}
    .rv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:32px 28px;}
    .rv-card-img img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px;margin-bottom:14px;}
    .rv-card h3{font-size:1.2rem;margin-bottom:8px;line-height:1.3;}
    .rv-card p{opacity:.7;font-size:.92rem;}
    .rv-cat-head{margin-bottom:44px;} .rv-cat-head h1{font-size:2.6rem;} .rv-cat-head p{opacity:.7;margin-top:8px;font-size:1.05rem;max-width:640px;}
    .rv-article{max-width:720px;margin:0 auto;}
    .rv-article .rv-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;margin-bottom:28px;}
    .rv-article h1{font-size:2.6rem;line-height:1.15;margin-bottom:16px;}
    .rv-article .rv-byline{margin-bottom:32px;}
    .empty{opacity:.6;padding:40px 0;}
    @media(max-width:860px){.rv-featured{grid-template-columns:1fr;}.rv-grid{grid-template-columns:1fr 1fr;}}
    @media(max-width:560px){.rv-grid{grid-template-columns:1fr;}.rv-featured h2{font-size:1.8rem;}.rv-article h1{font-size:2rem;}}
  `,

  renderHome(ctx, posts, opts) {
    const [first, ...rest] = posts;
    const body = posts.length
      ? `${opts.page === 1 && first ? featured(ctx, first) : ''}${grid(ctx, opts.page === 1 ? rest : posts)}${pagerHtml(ctx, '/', opts)}`
      : `<p class="empty">Nenhum post publicado ainda.</p>`;
    return shell(ctx, `<div class="rv-inner">${body}</div>`);
  },

  renderCategory(ctx, category, posts, opts) {
    const head = `<div class="rv-cat-head"><h1>${escapeHtml(category.name)}</h1>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}</div>`;
    const body = posts.length
      ? `${grid(ctx, posts)}${pagerHtml(ctx, `/categoria/${encodeURIComponent(category.slug)}`, opts)}`
      : `<p class="empty">Nenhum post nesta categoria ainda.</p>`;
    return shell(ctx, `<div class="rv-inner">${head}${body}</div>`);
  },

  renderArticle(ctx, post) {
    const body = `<article class="rv-article post-body">
      ${post.coverImageUrl ? `<img class="rv-cover" src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.title)}">` : ''}
      <h1>${escapeHtml(post.title)}</h1>
      <div class="rv-byline">${meta(ctx, post)}</div>
      ${post.html}
    </article>`;
    return shell(ctx, `<div class="rv-inner">${body}</div>`);
  },
};
