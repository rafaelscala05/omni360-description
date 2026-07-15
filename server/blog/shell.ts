// Shell compartilhado dos temas do blog nativo. Utilitários puros + casca do
// documento (SEO/OG/JSON-LD/fontes/vars de cor). Cada tema fornece seu próprio
// css + body; renderDocument os envolve num HTML completo.
import type { BlogSettings, BlogPost, BlogCategory, BlogFonts, BlogLayout, BlogAppearance } from '../../src/modules/content/blog/types';
import { BLOG_FONTS, DEFAULT_BLOG_FONTS, DEFAULT_BLOG_LAYOUT, effectiveAppearance as computeAppearance } from '../../src/modules/content/blog/types';

export interface BlogRenderContext {
  settings: BlogSettings;
  categories: BlogCategory[];
  baseUrl: string;
  canonicalBase: string;
  // Prefixo usado só no canonical/OG/JSON-LD (não nos links <a> internos).
  canonicalPathPrefix?: string;
  // Querystring (ex.: 'preview=1') propagada nos links internos do preview.
  demoQuery?: string;
}

export interface Head { title: string; description: string; canonicalPath: string; ogImage?: string; jsonLd: object; }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const fmtDate = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

// Tempo de leitura em minutos a partir do HTML do post (~200 palavras/min).
export function readingTime(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function withDemoQuery(ctx: BlogRenderContext, path: string): string {
  if (!ctx.demoQuery) return path;
  return path + (path.includes('?') ? '&' : '?') + ctx.demoQuery;
}

// Sanitiza uma URL para interpolar com segurança dentro de url('...') num
// atributo style inline: remove aspas, parênteses, barra invertida e espaços/
// quebras — os únicos caracteres que permitiriam sair do url() e injetar CSS.
// (escapeHtml NÃO basta aqui: o parser HTML decodifica &#39; de volta para '
// dentro do atributo antes de o CSS ser interpretado.)
export function cssUrl(u: string): string {
  return u.replace(/["'()\\\s]/g, '');
}

export function effectiveFonts(s: BlogSettings): BlogFonts {
  return { ...DEFAULT_BLOG_FONTS, ...(s.fonts ?? {}) };
}
export function effectiveLayout(s: BlogSettings): BlogLayout {
  return { ...DEFAULT_BLOG_LAYOUT, ...(s.layout ?? {}) };
}
export function effectiveAppearance(s: BlogSettings): BlogAppearance {
  return computeAppearance(s);
}
// Categorias de um post, na ordem em que aparecem em ctx.categories.
export function postCategories(ctx: BlogRenderContext, p: BlogPost): BlogCategory[] {
  const ids = p.categoryIds ?? [];
  return ctx.categories.filter((c) => ids.includes(c.id));
}
export const fontStack = (family: string): string =>
  `'${family}', ${BLOG_FONTS.find((f) => f.family === family)?.stack ?? 'Georgia, serif'}`;

export function googleFontsLink(s: BlogSettings): string {
  const f = effectiveFonts(s);
  const families = Array.from(new Set([f.heading, f.body]))
    .map((fam) => `family=${fam.replace(/ /g, '+')}:wght@400;700`)
    .join('&');
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
}

export const homeUrl = (ctx: BlogRenderContext): string => withDemoQuery(ctx, `${ctx.baseUrl}/`);
export const postUrl = (ctx: BlogRenderContext, p: BlogPost): string =>
  withDemoQuery(ctx, `${ctx.baseUrl}/${encodeURIComponent(p.slug)}`);
export const categoryUrl = (ctx: BlogRenderContext, c: BlogCategory): string =>
  withDemoQuery(ctx, `${ctx.baseUrl}/categoria/${encodeURIComponent(c.slug)}`);

// Paginação compartilhada; cada tema estiliza a classe .pager.
export function pagerHtml(ctx: BlogRenderContext, basePath: string, opts: { page: number; hasMore: boolean }): string {
  const mk = (page: number) => withDemoQuery(ctx, `${ctx.baseUrl}${basePath}?page=${page}`);
  return `<nav class="pager">
    ${opts.page > 1 ? `<a href="${mk(opts.page - 1)}">← Mais recentes</a>` : '<span></span>'}
    ${opts.hasMore ? `<a href="${mk(opts.page + 1)}">Posts anteriores →</a>` : '<span></span>'}
  </nav>`;
}

// CSS base comum a todos os temas: reset, vars de cor/fonte e tipografia do corpo do artigo.
function baseVars(s: BlogSettings): string {
  const c = s.colors;
  const f = effectiveFonts(s);
  const l = effectiveLayout(s);
  const width = l.contentWidth === 'estreito' ? '680px' : l.contentWidth === 'largo' ? '1280px' : 1024 + 'px';
  const radius = l.cornerRadius === 'reto' ? '0px' : l.cornerRadius === 'arredondado' ? '16px' : '8px';
  return `:root{--primary:${c.primary};--bg:${c.background};--text:${c.text};--heading-font:${fontStack(f.heading)};--body-font:${fontStack(f.body)};--content-width:${width};--radius:${radius};}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--body-font);line-height:1.7;-webkit-font-smoothing:antialiased;}
  h1,h2,h3,h4{font-family:var(--heading-font);line-height:1.2;}
  a{color:inherit;text-decoration:none;}
  img{max-width:100%;display:block;}
  .pager{display:flex;justify-content:space-between;margin-top:48px;font-size:.9rem;}
  .pager a{color:var(--primary);}
  .post-body h2,.post-body h3{margin:1.5em 0 .5em;}
  .post-body p,.post-body ul,.post-body ol{margin-bottom:1em;}
  .post-body ul,.post-body ol{padding-left:1.4em;}
  .post-body img{height:auto;border-radius:8px;margin:1.2em 0;}
  .post-body a{color:var(--primary);text-decoration:underline;}
  .post-body blockquote{border-left:3px solid var(--primary);padding-left:1em;margin:1.2em 0;opacity:.85;font-style:italic;}`;
}

export function renderDocument(ctx: BlogRenderContext, head: Head, parts: { css: string; body: string }): string {
  const { settings: s, baseUrl, canonicalBase } = ctx;
  const canonical = canonicalBase + head.canonicalPath;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(head.title)}</title>
<meta name="description" content="${escapeHtml(head.description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(s.title)}" href="${baseUrl}/feed.xml">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(head.title)}">
<meta property="og:description" content="${escapeHtml(head.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${head.ogImage ? `<meta property="og:image" content="${escapeHtml(head.ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(head.jsonLd).replace(/</g, '\\u003c')}</script>
${googleFontsLink(s)}
<style>${baseVars(s)}${parts.css}</style>
</head>
<body>${parts.body}</body>
</html>`;
}
