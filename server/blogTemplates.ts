// Templates SSR do blog nativo. Funções puras que recebem dados já carregados
// e devolvem HTML completo. CSS inline com as cores do BlogSettings.
import type { BlogSettings, BlogPost, BlogCategory } from '../src/modules/content/blog/types';

export interface BlogRenderContext {
  settings: BlogSettings;
  categories: BlogCategory[];
  baseUrl: string;
  canonicalBase: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

function css(s: BlogSettings): string {
  const c = s.colors;
  return `
    :root { --primary:${c.primary}; --bg:${c.background}; --text:${c.text}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; }
    a { color: var(--primary); text-decoration: none; }
    header.site { border-bottom: 2px solid var(--primary); padding: 24px 16px; }
    header.site .inner, main, footer.site .inner { max-width: 1024px; margin: 0 auto; padding: 0 16px; }
    header.site img.logo { max-height: 48px; }
    header.site h1 { font-size: 1.6rem; } header.site p { opacity: .7; font-size: .95rem; }
    nav.cats { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; font-size: .9rem; text-transform: uppercase; letter-spacing: .05em; }
    main { padding: 32px 16px; }
    article.post-body img { max-width: 100%; height: auto; }
    article.post-body h2, article.post-body h3 { margin: 1.4em 0 .5em; }
    article.post-body p, article.post-body ul, article.post-body ol { margin-bottom: 1em; }
    .meta { font-size: .85rem; opacity: .65; }
    .pager { display: flex; justify-content: space-between; margin-top: 32px; }
    footer.site { border-top: 1px solid rgba(0,0,0,.1); padding: 24px 16px; margin-top: 48px; font-size: .85rem; opacity: .7; }
    /* editorial */
    .ed-featured { margin-bottom: 40px; } .ed-featured img { width: 100%; max-height: 420px; object-fit: cover; }
    .ed-featured h2 { font-size: 2rem; margin-top: 12px; }
    .ed-item { display: flex; gap: 20px; padding: 20px 0; border-top: 1px solid rgba(0,0,0,.1); }
    .ed-item img { width: 200px; height: 130px; object-fit: cover; flex-shrink: 0; }
    /* minimal */
    .mn-list { max-width: 680px; margin: 0 auto; } .mn-item { padding: 24px 0; border-bottom: 1px solid rgba(0,0,0,.08); }
    .mn-item h2 { font-size: 1.5rem; } article.post-body.minimal { max-width: 680px; margin: 0 auto; }
    /* grid */
    .gr-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }
    .gr-card { border: 1px solid rgba(0,0,0,.1); border-radius: 10px; overflow: hidden; background: var(--bg); }
    .gr-card img { width: 100%; height: 180px; object-fit: cover; } .gr-card .pad { padding: 16px; }
    @media (max-width: 640px) { .ed-item { flex-direction: column; } .ed-item img { width: 100%; height: auto; } }
  `;
}

interface Head { title: string; description: string; canonicalPath: string; ogImage?: string; jsonLd: object; }

function layout(ctx: BlogRenderContext, head: Head, body: string): string {
  const { settings: s, categories, baseUrl, canonicalBase } = ctx;
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
<style>${css(s)}</style>
</head>
<body>
<header class="site"><div class="inner">
  <a href="${baseUrl}/">${s.logoUrl
    ? `<img class="logo" src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
    : `<h1>${escapeHtml(s.title)}</h1>`}</a>
  ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
  ${categories.length ? `<nav class="cats">${categories.map((c) =>
    `<a href="${baseUrl}/categoria/${encodeURIComponent(c.slug)}">${escapeHtml(c.name)}</a>`).join('')}</nav>` : ''}
</div></header>
<main>${body}</main>
<footer class="site"><div class="inner">© ${new Date().getFullYear()} ${escapeHtml(s.title)}</div></footer>
</body>
</html>`;
}

const postUrl = (ctx: BlogRenderContext, p: BlogPost) => `${ctx.baseUrl}/${encodeURIComponent(p.slug)}`;

function listItemMeta(ctx: BlogRenderContext, p: BlogPost): string {
  return `<div class="meta">${fmtDate(p.publishedAt)}</div>`;
}

// ---- corpos de listagem por template ----
function listBody(ctx: BlogRenderContext, posts: BlogPost[]): string {
  const t = ctx.settings.template;
  if (t === 'minimal') {
    return `<div class="mn-list">${posts.map((p) => `
      <div class="mn-item">
        <h2><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h2>
        ${listItemMeta(ctx, p)}
        <p>${escapeHtml(p.excerpt)}</p>
      </div>`).join('')}</div>`;
  }
  if (t === 'grid') {
    return `<div class="gr-list">${posts.map((p) => `
      <div class="gr-card">
        ${p.coverImageUrl ? `<a href="${postUrl(ctx, p)}"><img src="${escapeHtml(p.coverImageUrl)}" alt="${escapeHtml(p.title)}"></a>` : ''}
        <div class="pad">
          <h2 style="font-size:1.15rem"><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h2>
          ${listItemMeta(ctx, p)}
          <p style="font-size:.92rem">${escapeHtml(p.excerpt)}</p>
        </div>
      </div>`).join('')}</div>`;
  }
  // editorial: primeiro post em destaque, demais em lista horizontal
  const [featured, ...rest] = posts;
  return `${featured ? `
    <div class="ed-featured">
      ${featured.coverImageUrl ? `<a href="${postUrl(ctx, featured)}"><img src="${escapeHtml(featured.coverImageUrl)}" alt="${escapeHtml(featured.title)}"></a>` : ''}
      <h2><a href="${postUrl(ctx, featured)}">${escapeHtml(featured.title)}</a></h2>
      ${listItemMeta(ctx, featured)}
      <p>${escapeHtml(featured.excerpt)}</p>
    </div>` : ''}
    ${rest.map((p) => `
    <div class="ed-item">
      ${p.coverImageUrl ? `<a href="${postUrl(ctx, p)}"><img src="${escapeHtml(p.coverImageUrl)}" alt="${escapeHtml(p.title)}"></a>` : ''}
      <div>
        <h2 style="font-size:1.3rem"><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h2>
        ${listItemMeta(ctx, p)}
        <p>${escapeHtml(p.excerpt)}</p>
      </div>
    </div>`).join('')}`;
}

export function renderHome(
  ctx: BlogRenderContext,
  posts: BlogPost[],
  opts: { page: number; hasMore: boolean; category?: BlogCategory },
): string {
  const { settings: s } = ctx;
  const cat = opts.category;
  const pathBase = cat ? `/categoria/${encodeURIComponent(cat.slug)}` : '/';
  const title = cat ? `${cat.name} — ${s.title}` : s.title;
  const body = `
    ${cat ? `<h1 style="margin-bottom:24px">${escapeHtml(cat.name)}</h1>` : ''}
    ${posts.length ? listBody(ctx, posts) : '<p>Nenhum post publicado ainda.</p>'}
    <div class="pager">
      <span>${opts.page > 1 ? `<a href="${ctx.baseUrl}${pathBase}?page=${opts.page - 1}">← Mais recentes</a>` : ''}</span>
      <span>${opts.hasMore ? `<a href="${ctx.baseUrl}${pathBase}?page=${opts.page + 1}">Posts anteriores →</a>` : ''}</span>
    </div>`;
  return layout(ctx, {
    title,
    description: cat?.description || s.description,
    canonicalPath: `${ctx.baseUrl}${pathBase}`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: s.title, description: s.description, url: ctx.canonicalBase + ctx.baseUrl + '/' },
  }, body);
}

export function renderPost(ctx: BlogRenderContext, post: BlogPost): string {
  const { settings: s } = ctx;
  const cats = ctx.categories.filter((c) => post.categoryIds.includes(c.id));
  const body = `
    <article class="post-body${s.template === 'minimal' ? ' minimal' : ''}">
      <h1 style="font-size:2.2rem;margin-bottom:8px">${escapeHtml(post.title)}</h1>
      <div class="meta" style="margin-bottom:24px">
        ${fmtDate(post.publishedAt)}${post.authorName ? ` · ${escapeHtml(post.authorName)}` : ''}
        ${cats.map((c) => ` · <a href="${ctx.baseUrl}/categoria/${encodeURIComponent(c.slug)}">${escapeHtml(c.name)}</a>`).join('')}
      </div>
      ${post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.title)}" style="width:100%;margin-bottom:24px">` : ''}
      ${post.html}
    </article>`;
  return layout(ctx, {
    title: post.seo.metaTitle || `${post.title} — ${s.title}`,
    description: post.seo.metaDescription || post.excerpt,
    canonicalPath: `${ctx.baseUrl}/${encodeURIComponent(post.slug)}`,
    ogImage: post.coverImageUrl,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: post.seo.metaDescription || post.excerpt,
      image: post.coverImageUrl, datePublished: post.publishedAt, dateModified: post.updatedAt,
      author: post.authorName ? { '@type': 'Person', name: post.authorName } : { '@type': 'Organization', name: s.title },
      mainEntityOfPage: ctx.canonicalBase + ctx.baseUrl + '/' + encodeURIComponent(post.slug),
    },
  }, body);
}

export function renderNotFound(ctx: BlogRenderContext | null, message: string): string {
  if (!ctx) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Não encontrado</title></head><body style="font-family:sans-serif;text-align:center;padding:80px 16px"><h1>404</h1><p>${escapeHtml(message)}</p></body></html>`;
  }
  return layout(ctx, {
    title: `Não encontrado — ${ctx.settings.title}`, description: message,
    canonicalPath: `${ctx.baseUrl}/`, jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Não encontrado' },
  }, `<h1>404</h1><p>${escapeHtml(message)}</p><p><a href="${ctx.baseUrl}/">← Voltar ao blog</a></p>`);
}
