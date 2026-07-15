// Partial de listagem (home e página de categoria) — 3 variantes de disposição
// dos posts. Envolve os cards (card.ts) com a classe de estilo escolhida e, na
// variante 'destaque-grade', promove o primeiro post da página 1 a destaque.
import {
  escapeHtml, fmtDate, readingTime, postUrl, categoryUrl, pagerHtml,
  postCategories, effectiveAppearance, type BlogRenderContext,
} from '../shell';
import type { BlogPost, BlogCategory } from '../../../src/modules/content/blog/types';
import { renderCard } from './card';

interface ListOpts { page: number; hasMore: boolean; }

function featured(ctx: BlogRenderContext, p: BlogPost): string {
  const a = effectiveAppearance(ctx.settings);
  const cat = postCategories(ctx, p)[0];
  return `<a class="bc-featured" href="${postUrl(ctx, p)}">
    ${p.coverImageUrl ? `<div class="bc-featured-media"><img src="${escapeHtml(p.coverImageUrl)}" alt="${escapeHtml(p.title)}"></div>` : ''}
    <div class="bc-featured-body">
      ${a.cardShowCategory && cat ? `<span class="bc-chip">${escapeHtml(cat.name)}</span>` : ''}
      <h2>${escapeHtml(p.title)}</h2>
      ${a.cardShowExcerpt && p.excerpt ? `<p>${escapeHtml(p.excerpt)}</p>` : ''}
      <div class="bc-card-meta">${fmtDate(p.publishedAt)}<span class="bc-dot">·</span>${readingTime(p.html)} min${
        a.cardShowAuthor && p.authorName ? `<span class="bc-dot">·</span>${escapeHtml(p.authorName)}` : ''
      }</div>
    </div>
  </a>`;
}

// Corpo da listagem (sem o container .bc-inner nem o header de categoria).
export function renderListing(
  ctx: BlogRenderContext, posts: BlogPost[], opts: ListOpts, basePath: string,
): string {
  const a = effectiveAppearance(ctx.settings);
  if (!posts.length) return `<p class="bc-empty">Nenhum post publicado ainda.</p>`;

  const styleClass = `bc-cards bc-cards--${a.card}`;
  const grid = (items: BlogPost[]) =>
    `<div class="${styleClass} bc-grid">${items.map((p) => renderCard(ctx, p)).join('')}</div>`;
  const list = (items: BlogPost[]) =>
    `<div class="${styleClass} bc-list">${items.map((p) => renderCard(ctx, p)).join('')}</div>`;

  let body: string;
  if (a.category === 'lista') {
    body = list(posts);
  } else if (a.category === 'destaque-grade' && opts.page === 1) {
    const [first, ...rest] = posts;
    body = `${featured(ctx, first)}${rest.length ? grid(rest) : ''}`;
  } else {
    body = grid(posts);
  }
  return `${body}${pagerHtml(ctx, basePath, opts)}`;
}

export function renderCategoryHead(category: BlogCategory): string {
  return `<div class="bc-cat-head"><h1>${escapeHtml(category.name)}</h1>${
    category.description ? `<p>${escapeHtml(category.description)}</p>` : ''
  }</div>`;
}

export function renderCategoryEmpty(): string {
  return `<p class="bc-empty">Nenhum post nesta categoria ainda.</p>`;
}

export const categoryCss = `
  .bc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:34px 28px;}
  .bc-list{display:flex;flex-direction:column;gap:0;}
  .bc-list .bc-card{flex-direction:row;gap:22px;align-items:flex-start;padding:26px 0;border-bottom:1px solid rgba(0,0,0,.08);border-radius:0;box-shadow:none;}
  .bc-list.bc-cards--com-borda .bc-card,.bc-list.bc-cards--sombra .bc-card{border-left:0;border-right:0;border-top:0;}
  .bc-list .bc-card-media{flex:0 0 240px;} .bc-list .bc-card-media img{aspect-ratio:16/10;border-radius:var(--radius);}
  .bc-list .bc-card-body{flex:1;padding:2px 0;}
  .bc-list .bc-card-title{font-size:1.5rem;}

  .bc-featured{display:grid;grid-template-columns:1.15fr 1fr;gap:36px;align-items:center;margin-bottom:52px;}
  .bc-featured-media img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:var(--radius);}
  .bc-featured-body{display:flex;flex-direction:column;gap:12px;}
  .bc-featured h2{font-size:2.3rem;line-height:1.1;}
  .bc-featured p{opacity:.75;font-size:1.05rem;}

  .bc-cat-head{margin-bottom:44px;}
  .bc-cat-head h1{font-size:2.6rem;line-height:1.1;}
  .bc-cat-head p{opacity:.7;margin-top:10px;font-size:1.05rem;max-width:640px;}
  .bc-empty{opacity:.6;padding:40px 0;}

  @media(max-width:860px){
    .bc-grid{grid-template-columns:1fr 1fr;}
    .bc-featured{grid-template-columns:1fr;} .bc-featured h2{font-size:1.8rem;}
    .bc-list .bc-card{flex-direction:column;gap:14px;} .bc-list .bc-card-media{flex-basis:auto;width:100%;}
  }
  @media(max-width:560px){ .bc-grid{grid-template-columns:1fr;} }
`;
