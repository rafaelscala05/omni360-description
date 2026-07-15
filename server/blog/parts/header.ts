// Partial de cabeçalho do blog nativo — 3 variantes de posicionamento de logo
// e menu, escolhidas em BlogAppearance.header. Cada variante compartilha as
// classes .bc-header* e difere só pelo modificador no elemento raiz.
import {
  escapeHtml, homeUrl, categoryUrl, effectiveLayout, effectiveAppearance,
  type BlogRenderContext,
} from '../shell';

function brand(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  return `<a class="bc-brand" href="${homeUrl(ctx)}">${s.logoUrl
    ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
    : escapeHtml(s.title)}</a>`;
}

function nav(ctx: BlogRenderContext): string {
  const l = effectiveLayout(ctx.settings);
  if (!l.showCategoriesNav || !ctx.categories.length) return '';
  return `<nav class="bc-nav">${ctx.categories
    .map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`)
    .join('')}</nav>`;
}

export function renderHeader(ctx: BlogRenderContext): string {
  const a = effectiveAppearance(ctx.settings);
  const tagline = ctx.settings.description
    ? `<p class="bc-tagline">${escapeHtml(ctx.settings.description)}</p>`
    : '';
  if (a.header === 'logo-centro') {
    return `<header class="bc-header bc-header--centro"><div class="bc-inner">
      ${brand(ctx)}${nav(ctx)}
    </div></header>`;
  }
  if (a.header === 'logo-topo') {
    return `<header class="bc-header bc-header--topo"><div class="bc-inner">
      ${brand(ctx)}${tagline}${nav(ctx)}
    </div></header>`;
  }
  // logo-esquerda (default): logo à esquerda, nav à direita.
  return `<header class="bc-header bc-header--esquerda"><div class="bc-inner">
    ${brand(ctx)}${nav(ctx)}
  </div></header>`;
}

export const headerCss = `
  .bc-header{border-bottom:1px solid rgba(0,0,0,.08);padding:22px 0;}
  .bc-brand{font-family:var(--heading-font);font-weight:800;font-size:1.5rem;line-height:1;}
  .bc-brand img{max-height:44px;width:auto;}
  .bc-nav{display:flex;gap:20px;flex-wrap:wrap;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
  .bc-nav a{opacity:.65;transition:opacity .15s,color .15s;} .bc-nav a:hover{opacity:1;color:var(--primary);}
  .bc-tagline{opacity:.6;font-size:1rem;}

  .bc-header--esquerda .bc-inner{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}

  .bc-header--centro{text-align:center;}
  .bc-header--centro .bc-inner{display:flex;flex-direction:column;align-items:center;gap:16px;}
  .bc-header--centro .bc-nav{justify-content:center;}

  .bc-header--topo{text-align:center;padding:52px 0 30px;}
  .bc-header--topo .bc-inner{display:flex;flex-direction:column;align-items:center;gap:12px;}
  .bc-header--topo .bc-brand{font-size:2rem;}
  .bc-header--topo .bc-brand img{max-height:56px;}
  .bc-header--topo .bc-nav{justify-content:center;margin-top:6px;}
`;
