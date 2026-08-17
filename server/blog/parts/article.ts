// Partial de página de artigo — 3 variantes de leitura. Todas usam .post-body
// (tipografia base do shell) para o corpo; diferem no arranjo de capa e meta.
import {
  escapeHtml, fmtDate, readingTime, categoryUrl, cssUrl,
  postCategories, type BlogRenderContext,
} from '../shell';
import type { BlogPost } from '../../../src/modules/content/blog/types';

function byline(ctx: BlogRenderContext, p: BlogPost, light = false): string {
  const cat = postCategories(ctx, p)[0];
  return `<div class="bc-byline${light ? ' bc-byline--light' : ''}">
    ${cat ? `<a class="bc-chip" href="${categoryUrl(ctx, cat)}">${escapeHtml(cat.name)}</a>` : ''}
    <span>${fmtDate(p.publishedAt)}</span>
    <span class="bc-dot">·</span>
    <span>${readingTime(p.html)} min de leitura</span>
    ${p.authorName ? `<span class="bc-dot">·</span><span>${escapeHtml(p.authorName)}</span>` : ''}
  </div>`;
}

function fmtPrice(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Vitrine dos produtos vinculados ao artigo (Produção → "Produtos vinculados").
// Sem link: os produtos não têm URL pública cadastrada nesta plataforma.
function productsSection(post: BlogPost): string {
  if (!post.products?.length) return '';
  const cards = post.products.map((prod) => `
    <div class="bc-product-card">
      ${prod.imagemPrincipal
        ? `<img class="bc-product-img" src="${escapeHtml(prod.imagemPrincipal)}" alt="${escapeHtml(prod.nome)}">`
        : `<div class="bc-product-img bc-product-img--placeholder"></div>`}
      <div class="bc-product-info">
        <span class="bc-product-name">${escapeHtml(prod.nome)}</span>
        ${prod.preco != null ? `<span class="bc-product-price">${fmtPrice(prod.preco)}</span>` : ''}
      </div>
    </div>`).join('');
  return `<div class="bc-products">
    <h2 class="bc-products-title">Produtos</h2>
    <div class="bc-products-grid">${cards}</div>
  </div>`;
}

export function renderArticle(ctx: BlogRenderContext, post: BlogPost, variant: string): string {
  if (variant === 'capa-larga') {
    const heroStyle = post.coverImageUrl
      ? `background-image:url('${cssUrl(post.coverImageUrl)}')`
      : 'background-color:var(--text)';
    return `<div class="bc-hero" style="${heroStyle}">
      <div class="bc-hero-overlay"></div>
      <div class="bc-hero-inner">
        <h1>${escapeHtml(post.title)}</h1>
        ${byline(ctx, post, true)}
      </div>
    </div>
    <div class="bc-inner"><article class="bc-article post-body">${post.html}${productsSection(post)}</article></div>`;
  }

  if (variant === 'lateral-meta') {
    return `<div class="bc-inner"><div class="bc-article-split">
      <aside class="bc-article-aside">
        <h1>${escapeHtml(post.title)}</h1>
        ${byline(ctx, post)}
      </aside>
      <article class="bc-article post-body">
        ${post.coverImageUrl ? `<img class="bc-article-cover" src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.title)}">` : ''}
        ${post.html}
        ${productsSection(post)}
      </article>
    </div></div>`;
  }

  // centrado (default): coluna única, capa no topo.
  return `<div class="bc-inner"><article class="bc-article bc-article--centrado post-body">
    ${post.coverImageUrl ? `<img class="bc-article-cover" src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.title)}">` : ''}
    <h1>${escapeHtml(post.title)}</h1>
    ${byline(ctx, post)}
    ${post.html}
    ${productsSection(post)}
  </article></div>`;
}

export const articleCss = `
  .bc-byline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.82rem;opacity:.62;margin:14px 0 28px;}
  .bc-byline .bc-chip{opacity:1;}
  .bc-byline--light{opacity:.92;color:#fff;} .bc-byline--light .bc-dot{color:#fff;}

  .bc-article{max-width:720px;margin:0 auto;}
  .bc-article-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius);margin-bottom:28px;}
  .bc-article h1{font-size:2.6rem;line-height:1.15;}
  .bc-article--centrado h1{margin-top:6px;}

  /* capa-larga: hero full-bleed com título sobreposto. */
  .bc-hero{position:relative;min-height:380px;display:flex;align-items:flex-end;background-size:cover;background-position:center;color:#fff;margin-bottom:40px;}
  .bc-hero-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,.1));}
  .bc-hero-inner{position:relative;width:100%;max-width:820px;margin:0 auto;padding:44px 24px;}
  .bc-hero-inner h1{font-size:2.9rem;line-height:1.1;color:#fff;}

  /* lateral-meta: título+meta numa coluna sticky à esquerda. */
  .bc-article-split{display:grid;grid-template-columns:280px 1fr;gap:52px;align-items:start;}
  .bc-article-aside{position:sticky;top:32px;}
  .bc-article-aside h1{font-size:2.1rem;line-height:1.15;}
  .bc-article-split .bc-article{max-width:none;margin:0;}

  @media(max-width:860px){
    .bc-hero-inner h1{font-size:2rem;} .bc-hero{min-height:280px;}
    .bc-article h1{font-size:2rem;}
    .bc-article-split{grid-template-columns:1fr;gap:20px;} .bc-article-aside{position:static;}
  }

  .bc-products{margin-top:44px;padding-top:32px;border-top:1px solid rgba(0,0,0,.1);}
  .bc-products-title{font-size:1.3rem;margin-bottom:16px;}
  .bc-products-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;}
  .bc-product-card{border:1px solid rgba(0,0,0,.1);border-radius:var(--radius);overflow:hidden;}
  .bc-product-img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:rgba(0,0,0,.04);}
  .bc-product-img--placeholder{background:rgba(0,0,0,.06);}
  .bc-product-info{padding:10px 12px;}
  .bc-product-name{display:block;font-size:.86rem;font-weight:600;line-height:1.3;margin-bottom:4px;}
  .bc-product-price{display:block;font-size:.82rem;opacity:.72;}
`;
