import type { BlogPost, BlogCategory } from '../../../src/modules/content/blog/types';
import type { BlogRenderContext } from '../shell';

export interface ListOpts { page: number; hasMore: boolean; }

// Cada tema devolve o <body> interno completo (header + main + footer) de cada
// página, mais seu CSS. renderDocument (shell) envolve com <head> e SEO.
export interface BlogTheme {
  css(ctx: BlogRenderContext): string;
  renderHome(ctx: BlogRenderContext, posts: BlogPost[], opts: ListOpts): string;
  renderCategory(ctx: BlogRenderContext, category: BlogCategory, posts: BlogPost[], opts: ListOpts): string;
  renderArticle(ctx: BlogRenderContext, post: BlogPost): string;
}
