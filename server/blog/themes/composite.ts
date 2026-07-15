// Tema compositor do blog nativo. Substitui os 3 temas monolíticos: monta cada
// página a partir dos 5 eixos independentes de BlogAppearance (header, footer,
// listagem de categoria, estilo de card, página de artigo), resolvidos por
// effectiveAppearance (com fallback no preset do template legado).
import { effectiveAppearance, type BlogRenderContext } from '../shell';
import type { BlogTheme, ListOpts } from './types';
import { renderHeader, headerCss } from '../parts/header';
import { renderFooter, footerCss } from '../parts/footer';
import { cardCss } from '../parts/card';
import {
  renderListing, renderCategoryHead, renderCategoryEmpty, categoryCss,
} from '../parts/category';
import { renderArticle, articleCss } from '../parts/article';

const baseCss = `
  .bc-inner{max-width:var(--content-width);margin:0 auto;padding:0 24px;}
  .bc-main{padding:48px 0 0;}
`;

function page(ctx: BlogRenderContext, main: string): string {
  return `${renderHeader(ctx)}<main class="bc-main">${main}</main>${renderFooter(ctx)}`;
}

export const composite: BlogTheme = {
  css: () =>
    `${baseCss}${headerCss}${footerCss}${cardCss}${categoryCss}${articleCss}`,

  renderHome(ctx, posts, opts: ListOpts) {
    return page(ctx, `<div class="bc-inner">${renderListing(ctx, posts, opts, '/')}</div>`);
  },

  renderCategory(ctx, category, posts, opts: ListOpts) {
    const basePath = `/categoria/${encodeURIComponent(category.slug)}`;
    const body = posts.length
      ? renderListing(ctx, posts, opts, basePath)
      : renderCategoryEmpty();
    return page(ctx, `<div class="bc-inner">${renderCategoryHead(category)}${body}</div>`);
  },

  renderArticle(ctx, post) {
    const a = effectiveAppearance(ctx.settings);
    // renderArticle já cuida do seu próprio container (.bc-inner ou hero full-bleed).
    return page(ctx, renderArticle(ctx, post, a.article));
  },
};
