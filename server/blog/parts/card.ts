// Partial de card de conteúdo. Um único markup serve às variantes de listagem
// (grade/lista); o estilo (com-borda/plano/sombra) e os itens exibidos (autor,
// excerpt, meta, chip) vêm de BlogAppearance. A classe de estilo é aplicada
// pelo container de listagem (category.ts) para não repetir aqui.
import {
  escapeHtml, fmtDate, readingTime, postUrl, categoryUrl,
  postCategories, effectiveAppearance, type BlogRenderContext,
} from '../shell';
import type { BlogPost } from '../../../src/modules/content/blog/types';

function cardMeta(ctx: BlogRenderContext, p: BlogPost): string {
  const a = effectiveAppearance(ctx.settings);
  const bits: string[] = [];
  if (a.cardShowMeta) {
    bits.push(fmtDate(p.publishedAt));
    bits.push(`${readingTime(p.html)} min`);
  }
  if (a.cardShowAuthor && p.authorName) bits.push(escapeHtml(p.authorName));
  if (!bits.length) return '';
  return `<div class="bc-card-meta">${bits.join('<span class="bc-dot">·</span>')}</div>`;
}

export function renderCard(ctx: BlogRenderContext, p: BlogPost): string {
  const a = effectiveAppearance(ctx.settings);
  const cat = postCategories(ctx, p)[0];
  const chip = a.cardShowCategory && cat
    ? `<a class="bc-chip" href="${categoryUrl(ctx, cat)}">${escapeHtml(cat.name)}</a>`
    : '';
  const cover = p.coverImageUrl
    ? `<a class="bc-card-media" href="${postUrl(ctx, p)}"><img src="${escapeHtml(p.coverImageUrl)}" alt="${escapeHtml(p.title)}" loading="lazy"></a>`
    : '';
  const excerpt = a.cardShowExcerpt && p.excerpt
    ? `<p class="bc-card-excerpt">${escapeHtml(p.excerpt)}</p>`
    : '';
  return `<article class="bc-card">
    ${cover}
    <div class="bc-card-body">
      ${chip}
      <h3 class="bc-card-title"><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h3>
      ${excerpt}
      ${cardMeta(ctx, p)}
    </div>
  </article>`;
}

export const cardCss = `
  .bc-card{display:flex;flex-direction:column;overflow:hidden;}
  .bc-card-media img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;}
  .bc-card-body{display:flex;flex-direction:column;gap:8px;padding:0;}
  .bc-card-title{font-size:1.2rem;line-height:1.3;}
  .bc-card-title a{transition:color .15s;} .bc-card-title a:hover{color:var(--primary);}
  .bc-card-excerpt{opacity:.72;font-size:.92rem;}
  .bc-card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.76rem;opacity:.55;margin-top:2px;}
  .bc-dot{opacity:.5;}
  .bc-chip{align-self:flex-start;background:var(--primary);color:#fff;padding:3px 10px;border-radius:999px;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}

  /* Estilo com-borda: card delimitado. */
  .bc-cards--com-borda .bc-card{border:1px solid rgba(0,0,0,.1);border-radius:var(--radius);}
  .bc-cards--com-borda .bc-card-media img{border-radius:0;}
  .bc-cards--com-borda .bc-card-body{padding:16px 18px 18px;}

  /* Estilo sombra: card elevado. */
  .bc-cards--sombra .bc-card{border-radius:var(--radius);box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 28px -12px rgba(0,0,0,.22);background:var(--bg);transition:transform .2s,box-shadow .2s;}
  .bc-cards--sombra .bc-card:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(0,0,0,.08),0 20px 40px -14px rgba(0,0,0,.3);}
  .bc-cards--sombra .bc-card-body{padding:16px 18px 20px;}

  /* Estilo plano: sem contorno; só a capa arredonda. */
  .bc-cards--plano .bc-card-media img{border-radius:var(--radius);}
  .bc-cards--plano .bc-card-body{padding:12px 0 0;}
`;
