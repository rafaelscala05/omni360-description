// Partial de rodapé — 3 variantes. O texto vem de layout.footerText (fallback
// "© ano título"); o submenu de categorias é opcional (footerShowCategories).
import {
  escapeHtml, homeUrl, categoryUrl, effectiveLayout, effectiveAppearance,
  type BlogRenderContext,
} from '../shell';

function footerText(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return l.footerText?.trim()
    ? escapeHtml(l.footerText.trim())
    : `© ${new Date().getFullYear()} ${escapeHtml(s.title)}`;
}

function categoryLinks(ctx: BlogRenderContext): string {
  if (!ctx.categories.length) return '';
  return `<nav class="bc-foot-cats">${ctx.categories
    .map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`)
    .join('')}</nav>`;
}

export function renderFooter(ctx: BlogRenderContext): string {
  const a = effectiveAppearance(ctx.settings);
  const showCats = a.footerShowCategories && ctx.categories.length > 0;

  if (a.footer === 'colunas') {
    return `<footer class="bc-footer bc-footer--colunas"><div class="bc-inner">
      <div class="bc-foot-brand">
        <a class="bc-brand" href="${homeUrl(ctx)}">${escapeHtml(ctx.settings.title)}</a>
        <p class="bc-foot-text">${footerText(ctx)}</p>
      </div>
      ${showCats ? `<div class="bc-foot-col"><span class="bc-foot-title">Categorias</span>${categoryLinks(ctx)}</div>` : ''}
    </div></footer>`;
  }

  if (a.footer === 'centralizado') {
    return `<footer class="bc-footer bc-footer--centralizado"><div class="bc-inner">
      ${showCats ? categoryLinks(ctx) : ''}
      <p class="bc-foot-text">${footerText(ctx)}</p>
    </div></footer>`;
  }

  // simples: uma linha (texto à esquerda, categorias à direita se ativadas).
  return `<footer class="bc-footer bc-footer--simples"><div class="bc-inner">
    <p class="bc-foot-text">${footerText(ctx)}</p>
    ${showCats ? categoryLinks(ctx) : ''}
  </div></footer>`;
}

export const footerCss = `
  .bc-footer{border-top:1px solid rgba(0,0,0,.08);margin-top:64px;padding:32px 0;font-size:.85rem;}
  .bc-foot-text{opacity:.6;}
  .bc-foot-cats{display:flex;flex-wrap:wrap;gap:16px;}
  .bc-foot-cats a{opacity:.7;} .bc-foot-cats a:hover{opacity:1;color:var(--primary);}
  .bc-foot-title{display:block;font-family:var(--heading-font);font-weight:700;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;opacity:.8;}

  .bc-footer--simples .bc-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;}

  .bc-footer--colunas .bc-inner{display:flex;justify-content:space-between;gap:40px;flex-wrap:wrap;}
  .bc-footer--colunas .bc-foot-brand .bc-brand{font-size:1.3rem;display:block;margin-bottom:8px;}
  .bc-footer--colunas .bc-foot-cats{flex-direction:column;gap:8px;}

  .bc-footer--centralizado{text-align:center;}
  .bc-footer--centralizado .bc-inner{display:flex;flex-direction:column;align-items:center;gap:16px;}
  .bc-footer--centralizado .bc-foot-cats{justify-content:center;}
`;
