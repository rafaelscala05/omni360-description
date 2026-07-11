# Blog — Templates completos (Revista/Minimal/Vitrine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar os 3 "templates" do blog nativo em 3 temas completos e visualmente distintos (Revista/Minimal/Vitrine), cada um cobrindo Home, Categoria e Artigo, mantendo cores/fontes/logo/textos sob controle do usuário.

**Architecture:** Refatorar `server/blogTemplates.ts` (monolítico) em um shell compartilhado (`server/blog/shell.ts` — casca do documento, SEO, fontes, vars de cor, utils) + um módulo por tema (`server/blog/themes/{revista,minimal,vitrine}.ts`) implementando um contrato `BlogTheme` com `renderHome/renderCategory/renderArticle` + `css`. `blogTemplates.ts` vira um dispatcher com API pública estável. `blogPublic.ts` passa a chamar `renderCategory` na rota de categoria.

**Tech Stack:** TypeScript, Express SSR (funções puras que devolvem HTML string), React 19 + Tailwind (admin). Sem framework de testes no projeto — verificação por `npm run lint` (tsc --noEmit) + preview manual no dev server.

## Global Constraints

- **Sem migração de dados:** `BlogTemplateId` continua `'editorial' | 'minimal' | 'grid'`. Mapeamento de exibição: `editorial`=Revista, `minimal`=Minimal, `grid`=Vitrine.
- **Idioma:** todo texto de UI/SSR em pt-BR.
- **Sem rede no SSR além das fontes:** imagens de preview continuam SVG inline; único recurso externo permitido é Google Fonts (já existente via `googleFontsLink`).
- **API pública de `blogTemplates.ts` estável:** deve continuar exportando `renderHome`, `renderPost`, `renderNotFound`, `escapeHtml`, `googleFontsLink` e o tipo `BlogRenderContext` (consumidos por `server/blogPublic.ts`).
- **Escape obrigatório:** todo dado dinâmico em atributos/texto passa por `escapeHtml`; `post.html` é o único conteúdo já-HTML injetado cru (como hoje).
- **Verificação por tarefa:** `npm run lint` deve passar ao fim de cada tarefa.
- **Cor da marca do admin:** laranja `#FF5B03` (hover `#E14E00`), como no restante de `BlogAppearance.tsx`.

---

### Task 1: Shell compartilhado (`server/blog/shell.ts`)

Extrai utilitários e a casca do documento de `blogTemplates.ts` para um módulo reutilizável pelos temas. Adiciona `readingTime` e helpers de URL.

**Files:**
- Create: `server/blog/shell.ts`

**Interfaces:**
- Consumes: `BlogSettings, BlogPost, BlogCategory, BlogFonts, BlogLayout, BLOG_FONTS, DEFAULT_BLOG_FONTS, DEFAULT_BLOG_LAYOUT` de `../../src/modules/content/blog/types`.
- Produces (usado por Tasks 2-5):
  - `interface BlogRenderContext { settings: BlogSettings; categories: BlogCategory[]; baseUrl: string; canonicalBase: string; canonicalPathPrefix?: string; demoQuery?: string; }`
  - `interface Head { title: string; description: string; canonicalPath: string; ogImage?: string; jsonLd: object; }`
  - `escapeHtml(s: string): string`
  - `fmtDate(iso?: string): string`
  - `readingTime(html: string): number` — minutos, mínimo 1
  - `withDemoQuery(ctx: BlogRenderContext, path: string): string`
  - `effectiveFonts(s: BlogSettings): BlogFonts`
  - `effectiveLayout(s: BlogSettings): BlogLayout`
  - `fontStack(family: string): string`
  - `googleFontsLink(s: BlogSettings): string`
  - `homeUrl(ctx): string`, `postUrl(ctx, p: BlogPost): string`, `categoryUrl(ctx, c: BlogCategory): string`
  - `pagerHtml(ctx, basePath: string, opts: { page: number; hasMore: boolean }): string`
  - `renderDocument(ctx, head: Head, parts: { css: string; body: string }): string`

- [ ] **Step 1: Criar o módulo shell**

Create `server/blog/shell.ts`:

```ts
// Shell compartilhado dos temas do blog nativo. Utilitários puros + casca do
// documento (SEO/OG/JSON-LD/fontes/vars de cor). Cada tema fornece seu próprio
// css + body; renderDocument os envolve num HTML completo.
import type { BlogSettings, BlogPost, BlogCategory, BlogFonts, BlogLayout } from '../../src/modules/content/blog/types';
import { BLOG_FONTS, DEFAULT_BLOG_FONTS, DEFAULT_BLOG_LAYOUT } from '../../src/modules/content/blog/types';

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

export function effectiveFonts(s: BlogSettings): BlogFonts {
  return { ...DEFAULT_BLOG_FONTS, ...(s.fonts ?? {}) };
}
export function effectiveLayout(s: BlogSettings): BlogLayout {
  return { ...DEFAULT_BLOG_LAYOUT, ...(s.layout ?? {}) };
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
  return `:root{--primary:${c.primary};--bg:${c.background};--text:${c.text};--heading-font:${fontStack(f.heading)};--body-font:${fontStack(f.body)};}
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
```

- [ ] **Step 2: Verificar tipagem**

Run: `npm run lint`
Expected: PASS (sem erros). `server/blog/shell.ts` compila; ainda não é importado por ninguém.

- [ ] **Step 3: Sanity-check de `readingTime`**

Run: `npx tsx -e "import { readingTime } from './server/blog/shell'; console.log(readingTime('<p>'+Array(400).fill('palavra').join(' ')+'</p>'));"`
Expected: imprime `2` (400 palavras / 200 ≈ 2).

- [ ] **Step 4: Commit**

```bash
git add server/blog/shell.ts
git commit -m "feat(blog): shell compartilhado dos temas (SEO, fontes, utils, readingTime)"
```

---

### Task 2: Contrato de tema + tema Revista (`server/blog/themes/types.ts`, `revista.ts`, `index.ts`)

Define o contrato `BlogTheme` e implementa o primeiro tema (Revista = magazine). Cria o registry `THEMES`.

**Files:**
- Create: `server/blog/themes/types.ts`
- Create: `server/blog/themes/revista.ts`
- Create: `server/blog/themes/index.ts`

**Interfaces:**
- Consumes: tudo de `../shell` (Task 1); `BlogPost, BlogCategory, BlogTemplateId` de `../../../src/modules/content/blog/types`.
- Produces:
  - `interface ListOpts { page: number; hasMore: boolean; }`
  - `interface BlogTheme { css(ctx): string; renderHome(ctx, posts: BlogPost[], opts: ListOpts): string; renderCategory(ctx, category: BlogCategory, posts: BlogPost[], opts: ListOpts): string; renderArticle(ctx, post: BlogPost): string; }`
  - `const revista: BlogTheme`
  - `const THEMES: Record<BlogTemplateId, BlogTheme>` (Revista já preenchida em `editorial`; `minimal`/`grid` completados nas Tasks 3-4)

- [ ] **Step 1: Criar o contrato**

Create `server/blog/themes/types.ts`:

```ts
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
```

- [ ] **Step 2: Criar o tema Revista**

Create `server/blog/themes/revista.ts`:

```ts
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
```

- [ ] **Step 3: Criar o registry (Revista preenchida; placeholders temporários para os outros)**

Create `server/blog/themes/index.ts`:

```ts
import type { BlogTemplateId } from '../../../src/modules/content/blog/types';
import type { BlogTheme } from './types';
import { revista } from './revista';

// minimal e vitrine são adicionados nas Tasks 3 e 4. Até lá, apontam para
// revista para manter o módulo compilável.
export const THEMES: Record<BlogTemplateId, BlogTheme> = {
  editorial: revista,
  minimal: revista,
  grid: revista,
};
```

- [ ] **Step 4: Verificar tipagem**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/blog/themes/types.ts server/blog/themes/revista.ts server/blog/themes/index.ts
git commit -m "feat(blog): contrato BlogTheme + tema Revista (magazine)"
```

---

### Task 3: Tema Minimal (`server/blog/themes/minimal.ts`)

Tema tipográfico de uma coluna, serifado, cabeçalho centralizado, quase sem imagens na listagem.

**Files:**
- Create: `server/blog/themes/minimal.ts`
- Modify: `server/blog/themes/index.ts`

**Interfaces:**
- Consumes: `../shell`, `./types` (Task 2).
- Produces: `const minimal: BlogTheme`.

- [ ] **Step 1: Criar o tema Minimal**

Create `server/blog/themes/minimal.ts`:

```ts
// Tema "Minimal" (id 'minimal'): uma coluna central serifada, foco na leitura.
// Cabeçalho centralizado, listagem sem capas, byline discreta.
import type { BlogPost } from '../../../src/modules/content/blog/types';
import {
  escapeHtml, fmtDate, readingTime, homeUrl, postUrl, categoryUrl,
  pagerHtml, effectiveLayout, type BlogRenderContext,
} from '../shell';
import type { BlogTheme, ListOpts } from './types';

function meta(ctx: BlogRenderContext, p: BlogPost): string {
  const cat = ctx.categories.find((c) => (p.categoryIds ?? []).includes(c.id));
  return `<div class="mn-meta">${fmtDate(p.publishedAt)} · ${readingTime(p.html)} min${
    p.authorName ? ` · ${escapeHtml(p.authorName)}` : ''
  }${cat ? ` · <a href="${categoryUrl(ctx, cat)}">${escapeHtml(cat.name)}</a>` : ''}</div>`;
}

function header(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<header class="mn-header">
    <a class="mn-brand" href="${homeUrl(ctx)}">${s.logoUrl
      ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
      : escapeHtml(s.title)}</a>
    ${s.description ? `<p class="mn-tagline">${escapeHtml(s.description)}</p>` : ''}
    ${l.showCategoriesNav && ctx.categories.length
      ? `<nav class="mn-nav">${ctx.categories.map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`).join('')}</nav>`
      : ''}
  </header>`;
}

function footer(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<footer class="mn-footer">${
    l.footerText?.trim() ? escapeHtml(l.footerText.trim()) : `© ${new Date().getFullYear()} ${escapeHtml(s.title)}`
  }</footer>`;
}

function row(ctx: BlogRenderContext, p: BlogPost): string {
  return `<article class="mn-item">
    <h2><a href="${postUrl(ctx, p)}">${escapeHtml(p.title)}</a></h2>
    ${meta(ctx, p)}
    <p>${escapeHtml(p.excerpt)}</p>
  </article>`;
}

function list(ctx: BlogRenderContext, posts: BlogPost[]): string {
  return `<div class="mn-list">${posts.map((p) => row(ctx, p)).join('')}</div>`;
}

function shell(ctx: BlogRenderContext, main: string): string {
  return `${header(ctx)}<main class="mn-main">${main}</main>${footer(ctx)}`;
}

export const minimal: BlogTheme = {
  css: () => `
    .mn-main,.mn-header,.mn-footer{max-width:680px;margin-left:auto;margin-right:auto;padding-left:24px;padding-right:24px;}
    .mn-header{text-align:center;padding-top:56px;padding-bottom:32px;border-bottom:1px solid rgba(0,0,0,.08);}
    .mn-brand{font-family:var(--heading-font);font-weight:700;font-size:1.8rem;display:inline-block;}
    .mn-brand img{max-height:48px;width:auto;margin:0 auto;}
    .mn-tagline{opacity:.6;margin-top:8px;font-size:1rem;}
    .mn-nav{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:18px;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;}
    .mn-nav a{opacity:.6;} .mn-nav a:hover{opacity:1;color:var(--primary);}
    .mn-main{padding-top:40px;padding-bottom:56px;}
    .mn-item{padding:28px 0;border-bottom:1px solid rgba(0,0,0,.07);}
    .mn-item h2{font-size:1.6rem;margin-bottom:8px;}
    .mn-item h2 a:hover{color:var(--primary);}
    .mn-meta{font-size:.8rem;opacity:.55;margin-bottom:10px;}
    .mn-meta a{color:var(--primary);}
    .mn-item p{opacity:.8;}
    .mn-cat-head{text-align:center;padding:8px 0 8px;} .mn-cat-head h1{font-size:2rem;} .mn-cat-head p{opacity:.65;margin-top:8px;}
    .mn-article h1{font-size:2.3rem;line-height:1.2;text-align:center;margin-bottom:16px;}
    .mn-article .mn-byline{text-align:center;margin-bottom:28px;}
    .mn-article .mn-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:28px;}
    .empty{opacity:.6;padding:40px 0;text-align:center;}
    @media(max-width:560px){.mn-item h2{font-size:1.35rem;}.mn-article h1{font-size:1.8rem;}}
  `,

  renderHome(ctx, posts, opts) {
    const body = posts.length
      ? `${list(ctx, posts)}${pagerHtml(ctx, '/', opts)}`
      : `<p class="empty">Nenhum post publicado ainda.</p>`;
    return shell(ctx, body);
  },

  renderCategory(ctx, category, posts, opts) {
    const head = `<div class="mn-cat-head"><h1>${escapeHtml(category.name)}</h1>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}</div>`;
    const body = posts.length
      ? `${list(ctx, posts)}${pagerHtml(ctx, `/categoria/${encodeURIComponent(category.slug)}`, opts)}`
      : `<p class="empty">Nenhum post nesta categoria ainda.</p>`;
    return shell(ctx, `${head}${body}`);
  },

  renderArticle(ctx, post) {
    const body = `<article class="mn-article post-body">
      ${post.coverImageUrl ? `<img class="mn-cover" src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.title)}">` : ''}
      <h1>${escapeHtml(post.title)}</h1>
      <div class="mn-byline">${meta(ctx, post)}</div>
      ${post.html}
    </article>`;
    return shell(ctx, body);
  },
};
```

- [ ] **Step 2: Registrar no index**

Edit `server/blog/themes/index.ts` — importar e apontar `minimal`:

```ts
import type { BlogTemplateId } from '../../../src/modules/content/blog/types';
import type { BlogTheme } from './types';
import { revista } from './revista';
import { minimal } from './minimal';

export const THEMES: Record<BlogTemplateId, BlogTheme> = {
  editorial: revista,
  minimal,
  grid: revista,
};
```

- [ ] **Step 3: Verificar tipagem**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/blog/themes/minimal.ts server/blog/themes/index.ts
git commit -m "feat(blog): tema Minimal (leitura tipográfica)"
```

---

### Task 4: Tema Vitrine (`server/blog/themes/vitrine.ts`)

Tema visual/bold: mosaico masonry com capas grandes, tag e título sobre a imagem, cabeçalho escuro.

**Files:**
- Create: `server/blog/themes/vitrine.ts`
- Modify: `server/blog/themes/index.ts`

**Interfaces:**
- Consumes: `../shell`, `./types`.
- Produces: `const vitrine: BlogTheme`.

- [ ] **Step 1: Criar o tema Vitrine**

Create `server/blog/themes/vitrine.ts`:

```ts
// Tema "Vitrine" (id 'grid'): mosaico visual com capas grandes ocupando o card,
// tag + título sobre a imagem. Cabeçalho escuro, sans geométrica.
import type { BlogPost } from '../../../src/modules/content/blog/types';
import {
  escapeHtml, fmtDate, readingTime, homeUrl, postUrl, categoryUrl,
  pagerHtml, effectiveLayout, type BlogRenderContext,
} from '../shell';
import type { BlogTheme, ListOpts } from './types';

// Cor de capa determinística p/ posts sem coverImageUrl (evita card vazio).
const FALLBACKS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6'];
function coverBg(p: BlogPost, i: number): string {
  return p.coverImageUrl ? `background-image:url('${escapeHtml(p.coverImageUrl)}')` : `background-color:${FALLBACKS[i % FALLBACKS.length]}`;
}

function header(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<header class="vt-header"><div class="vt-inner">
    <a class="vt-brand" href="${homeUrl(ctx)}">${s.logoUrl
      ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.title)}">`
      : escapeHtml(s.title)}</a>
    ${l.showCategoriesNav && ctx.categories.length
      ? `<nav class="vt-nav">${ctx.categories.map((c) => `<a href="${categoryUrl(ctx, c)}">${escapeHtml(c.name)}</a>`).join('')}</nav>`
      : ''}
  </div></header>`;
}

function footer(ctx: BlogRenderContext): string {
  const s = ctx.settings;
  const l = effectiveLayout(s);
  return `<footer class="vt-footer"><div class="vt-inner">${
    l.footerText?.trim() ? escapeHtml(l.footerText.trim()) : `© ${new Date().getFullYear()} ${escapeHtml(s.title)}`
  }</div></footer>`;
}

function tile(ctx: BlogRenderContext, p: BlogPost, i: number): string {
  const cat = ctx.categories.find((c) => (p.categoryIds ?? []).includes(c.id));
  return `<a class="vt-tile" href="${postUrl(ctx, p)}" style="${coverBg(p, i)}">
    <div class="vt-tile-overlay">
      ${cat ? `<span class="vt-chip">${escapeHtml(cat.name)}</span>` : ''}
      <h3>${escapeHtml(p.title)}</h3>
      <div class="vt-tile-meta">${fmtDate(p.publishedAt)} · ${readingTime(p.html)} min</div>
    </div>
  </a>`;
}

function masonry(ctx: BlogRenderContext, posts: BlogPost[]): string {
  return `<div class="vt-masonry">${posts.map((p, i) => tile(ctx, p, i)).join('')}</div>`;
}

function shell(ctx: BlogRenderContext, main: string): string {
  return `${header(ctx)}<main class="vt-main"><div class="vt-inner">${main}</div></main>${footer(ctx)}`;
}

export const vitrine: BlogTheme = {
  css: () => `
    .vt-inner{max-width:1200px;margin:0 auto;padding:0 24px;}
    .vt-header{background:#0f172a;color:#fff;padding:18px 0;}
    .vt-header .vt-inner{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}
    .vt-brand{font-family:var(--heading-font);font-weight:800;font-size:1.4rem;letter-spacing:.02em;color:#fff;}
    .vt-brand img{max-height:40px;width:auto;}
    .vt-nav{display:flex;gap:18px;flex-wrap:wrap;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
    .vt-nav a{color:#94a3b8;} .vt-nav a:hover{color:#fff;}
    .vt-main{padding:40px 0 64px;}
    .vt-masonry{columns:3;column-gap:20px;}
    .vt-tile{display:block;break-inside:avoid;margin-bottom:20px;border-radius:14px;overflow:hidden;position:relative;min-height:220px;background-size:cover;background-position:center;color:#fff;}
    .vt-tile:nth-child(3n+1){min-height:300px;} .vt-tile:nth-child(4n){min-height:250px;}
    .vt-tile-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:18px;background:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,.05) 65%);}
    .vt-chip{align-self:flex-start;background:var(--primary);color:#fff;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
    .vt-tile h3{font-size:1.25rem;line-height:1.25;color:#fff;}
    .vt-tile-meta{font-size:.75rem;opacity:.85;}
    .vt-cat-head{margin-bottom:32px;} .vt-cat-head h1{font-size:2.4rem;} .vt-cat-head p{opacity:.7;margin-top:8px;max-width:640px;}
    .vt-article-hero{position:relative;min-height:360px;border-radius:0;display:flex;align-items:flex-end;background-size:cover;background-position:center;color:#fff;margin-bottom:36px;}
    .vt-article-hero .vt-hero-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.8),rgba(0,0,0,.1));}
    .vt-article-hero .vt-hero-inner{position:relative;padding:40px 24px;max-width:820px;margin:0 auto;width:100%;}
    .vt-article-hero h1{font-size:2.8rem;line-height:1.1;color:#fff;margin-bottom:12px;}
    .vt-article-hero .vt-byline{font-size:.85rem;opacity:.9;}
    .vt-article-hero .vt-chip{margin-bottom:12px;}
    .vt-article{max-width:760px;margin:0 auto;}
    .empty{opacity:.6;padding:40px 0;}
    @media(max-width:900px){.vt-masonry{columns:2;}}
    @media(max-width:560px){.vt-masonry{columns:1;}.vt-article-hero h1{font-size:1.9rem;}.vt-article-hero{min-height:260px;}}
  `,

  renderHome(ctx, posts, opts) {
    const body = posts.length
      ? `${masonry(ctx, posts)}${pagerHtml(ctx, '/', opts)}`
      : `<p class="empty">Nenhum post publicado ainda.</p>`;
    return shell(ctx, body);
  },

  renderCategory(ctx, category, posts, opts) {
    const head = `<div class="vt-cat-head"><h1>${escapeHtml(category.name)}</h1>${category.description ? `<p>${escapeHtml(category.description)}</p>` : ''}</div>`;
    const body = posts.length
      ? `${masonry(ctx, posts)}${pagerHtml(ctx, `/categoria/${encodeURIComponent(category.slug)}`, opts)}`
      : `<p class="empty">Nenhum post nesta categoria ainda.</p>`;
    return shell(ctx, `${head}${body}`);
  },

  renderArticle(ctx, post) {
    const cat = ctx.categories.find((c) => (post.categoryIds ?? []).includes(c.id));
    const heroStyle = post.coverImageUrl ? `background-image:url('${escapeHtml(post.coverImageUrl)}')` : `background-color:#0f172a`;
    const hero = `<div class="vt-article-hero" style="${heroStyle}">
      <div class="vt-hero-overlay"></div>
      <div class="vt-hero-inner">
        ${cat ? `<span class="vt-chip">${escapeHtml(cat.name)}</span>` : ''}
        <h1>${escapeHtml(post.title)}</h1>
        <div class="vt-byline">${fmtDate(post.publishedAt)} · ${readingTime(post.html)} min de leitura${post.authorName ? ` · ${escapeHtml(post.authorName)}` : ''}</div>
      </div>
    </div>`;
    // O hero é full-bleed (fora do .vt-inner); o corpo fica no container.
    return `${header(ctx)}<main class="vt-main">${hero}<div class="vt-inner"><article class="vt-article post-body">${post.html}</article></div></main>${footer(ctx)}`;
  },
};
```

- [ ] **Step 2: Registrar no index**

Edit `server/blog/themes/index.ts` — versão final:

```ts
import type { BlogTemplateId } from '../../../src/modules/content/blog/types';
import type { BlogTheme } from './types';
import { revista } from './revista';
import { minimal } from './minimal';
import { vitrine } from './vitrine';

export const THEMES: Record<BlogTemplateId, BlogTheme> = {
  editorial: revista,
  minimal,
  grid: vitrine,
};
```

- [ ] **Step 3: Verificar tipagem**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/blog/themes/vitrine.ts server/blog/themes/index.ts
git commit -m "feat(blog): tema Vitrine (mosaico visual)"
```

---

### Task 5: Dispatcher + roteamento de Categoria (`server/blogTemplates.ts`, `server/blogPublic.ts`)

Reescreve `blogTemplates.ts` como dispatcher fino sobre `THEMES` + shell, adiciona `renderCategory`, e faz `blogPublic.ts` usá-lo.

**Files:**
- Modify (rewrite): `server/blogTemplates.ts`
- Modify: `server/blogPublic.ts:6` (import) e `server/blogPublic.ts:208-216` (rota de categoria)

**Interfaces:**
- Consumes: `THEMES` (Task 4), `renderDocument, BlogRenderContext, escapeHtml, googleFontsLink` (Task 1).
- Produces (API pública estável + nova):
  - `renderHome(ctx, posts: BlogPost[], opts: { page: number; hasMore: boolean }): string`
  - `renderCategory(ctx, category: BlogCategory, posts: BlogPost[], opts: { page: number; hasMore: boolean }): string`
  - `renderPost(ctx, post: BlogPost): string`
  - `renderNotFound(ctx: BlogRenderContext | null, message: string): string`
  - re-exports: `escapeHtml`, `googleFontsLink`, type `BlogRenderContext`

- [ ] **Step 1: Reescrever `server/blogTemplates.ts`**

Replace the entire file contents of `server/blogTemplates.ts` with:

```ts
// Dispatcher SSR do blog nativo. Escolhe o tema por settings.template e compõe
// o <head>/SEO (aqui) + o corpo do tema (server/blog/themes/*) via renderDocument.
import type { BlogSettings, BlogPost, BlogCategory, BlogTemplateId } from '../src/modules/content/blog/types';
import {
  renderDocument, escapeHtml, googleFontsLink, homeUrl, withDemoQuery,
  type BlogRenderContext,
} from './blog/shell';
import { THEMES } from './blog/themes';

export type { BlogRenderContext } from './blog/shell';
export { escapeHtml, googleFontsLink } from './blog/shell';

function theme(id: BlogTemplateId) {
  return THEMES[id] ?? THEMES.editorial;
}
function cpBase(ctx: BlogRenderContext): string {
  return ctx.canonicalPathPrefix ?? ctx.baseUrl;
}

export function renderHome(
  ctx: BlogRenderContext,
  posts: BlogPost[],
  opts: { page: number; hasMore: boolean },
): string {
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  return renderDocument(ctx, {
    title: s.title,
    description: s.description,
    canonicalPath: `${cp}/`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: s.title, description: s.description, url: ctx.canonicalBase + cp + '/' },
  }, { css: t.css(ctx), body: t.renderHome(ctx, posts, opts) });
}

export function renderCategory(
  ctx: BlogRenderContext,
  category: BlogCategory,
  posts: BlogPost[],
  opts: { page: number; hasMore: boolean },
): string {
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  const path = `/categoria/${encodeURIComponent(category.slug)}`;
  return renderDocument(ctx, {
    title: `${category.name} — ${s.title}`,
    description: category.description || s.description,
    canonicalPath: `${cp}${path}`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: `${category.name} — ${s.title}`, description: category.description || s.description, url: ctx.canonicalBase + cp + path },
  }, { css: t.css(ctx), body: t.renderCategory(ctx, category, posts, opts) });
}

export function renderPost(ctx: BlogRenderContext, post: BlogPost): string {
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  return renderDocument(ctx, {
    title: post.seo.metaTitle || `${post.title} — ${s.title}`,
    description: post.seo.metaDescription || post.excerpt,
    canonicalPath: `${cp}/${encodeURIComponent(post.slug)}`,
    ogImage: post.coverImageUrl,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: post.seo.metaDescription || post.excerpt,
      image: post.coverImageUrl, datePublished: post.publishedAt, dateModified: post.updatedAt,
      author: post.authorName ? { '@type': 'Person', name: post.authorName } : { '@type': 'Organization', name: s.title },
      mainEntityOfPage: ctx.canonicalBase + cp + '/' + encodeURIComponent(post.slug),
    },
  }, { css: t.css(ctx), body: t.renderArticle(ctx, post) });
}

export function renderNotFound(ctx: BlogRenderContext | null, message: string): string {
  if (!ctx) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Não encontrado</title></head><body style="font-family:sans-serif;text-align:center;padding:80px 16px"><h1>404</h1><p>${escapeHtml(message)}</p></body></html>`;
  }
  const s = ctx.settings;
  const t = theme(s.template);
  const cp = cpBase(ctx);
  const body = `<main style="max-width:680px;margin:0 auto;padding:80px 24px;text-align:center"><h1 style="font-size:2.4rem;margin-bottom:12px">404</h1><p style="margin-bottom:20px">${escapeHtml(message)}</p><p><a style="color:var(--primary)" href="${homeUrl(ctx)}">← Voltar ao blog</a></p></main>`;
  return renderDocument(ctx, {
    title: `Não encontrado — ${s.title}`, description: message,
    canonicalPath: `${cp}/`, jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Não encontrado' },
  }, { css: t.css(ctx), body });
}

// Reexport para consumidores que ainda importam daqui (compat).
export { withDemoQuery };
```

- [ ] **Step 2: Verificar tipagem do dispatcher**

Run: `npm run lint`
Expected: PASS. `blogPublic.ts` ainda chama `renderHome(ctx, slice, { page, hasMore, category })` na rota de categoria — o campo extra `category` é aceito por excesso? **Não** em objeto literal com tipo estrito. Se `npm run lint` acusar erro em `blogPublic.ts` na linha da categoria (`Object literal may only specify known properties, 'category' ...`), é esperado e corrigido no Step 3.

- [ ] **Step 3: Atualizar `server/blogPublic.ts` — import**

Edit `server/blogPublic.ts` line 6. Replace:

```ts
import { renderHome, renderPost, renderNotFound, escapeHtml, type BlogRenderContext } from './blogTemplates';
```

with:

```ts
import { renderHome, renderCategory, renderPost, renderNotFound, escapeHtml, type BlogRenderContext } from './blogTemplates';
```

- [ ] **Step 4: Atualizar a rota de categoria em `server/blogPublic.ts`**

Edit `server/blogPublic.ts` — no bloco `if (catMatch) { ... }` (por volta das linhas 208-216), a última linha usa `renderHome`. Replace:

```ts
    const { slice, hasMore } = paginate(filtered);
    return send(renderHome(ctx, slice, { page, hasMore, category }));
```

with:

```ts
    const { slice, hasMore } = paginate(filtered);
    return send(renderCategory(ctx, category, slice, { page, hasMore }));
```

- [ ] **Step 5: Verificar tipagem completa**

Run: `npm run lint`
Expected: PASS (sem erros).

- [ ] **Step 6: Commit**

```bash
git add server/blogTemplates.ts server/blogPublic.ts
git commit -m "feat(blog): dispatcher de temas + rota de categoria dedicada (renderCategory)"
```

---

### Task 6: Rótulos dos temas + admin (`src/modules/content/blog/types.ts`, `BlogAppearance.tsx`)

Atualiza nomes/descrições dos templates, redesenha os mini-previews e remove os 4 knobs de layout (mantendo o toggle de categorias).

**Files:**
- Modify: `src/modules/content/blog/types.ts:10-14` (BLOG_TEMPLATES)
- Modify: `src/modules/content/blog/BlogAppearance.tsx` (TemplatePreview 52-84; remover OptionPills 86-114; card Layout 231-293)

**Interfaces:**
- Consumes: `BLOG_TEMPLATES` (rótulos), `settings.template` (id).
- Produces: nenhuma nova API.

- [ ] **Step 1: Atualizar rótulos em `types.ts`**

Edit `src/modules/content/blog/types.ts` lines 10-14. Replace the `BLOG_TEMPLATES` array with:

```ts
export const BLOG_TEMPLATES: Array<{ id: BlogTemplateId; nome: string; descricao: string }> = [
  { id: 'editorial', nome: 'Revista', descricao: 'Estilo magazine: post em destaque + grade de 3 colunas.' },
  { id: 'minimal', nome: 'Minimal', descricao: 'Uma coluna serifada, foco total na leitura.' },
  { id: 'grid', nome: 'Vitrine', descricao: 'Mosaico visual com capas grandes e cabeçalho escuro.' },
];
```

- [ ] **Step 2: Redesenhar os mini-previews (`TemplatePreview`)**

Edit `src/modules/content/blog/BlogAppearance.tsx` — replace the `TemplatePreview` component (lines 52-84) with:

```tsx
// Mini-previews em CSS puro para cada tema — refletem a estrutura de cada um.
const TemplatePreview: React.FC<{ id: BlogTemplateId }> = ({ id }) => {
  if (id === 'editorial') {
    // Revista: destaque no topo + grade de 3 colunas.
    return (
      <div className="h-20 w-full bg-slate-50 rounded-lg p-2 flex flex-col gap-1.5">
        <div className="flex gap-1.5 h-1/2">
          <div className="w-1/2 bg-slate-300 rounded" />
          <div className="w-1/2 flex flex-col gap-1 justify-center">
            <div className="h-1.5 bg-slate-300 rounded w-3/4" />
            <div className="h-1 bg-slate-200 rounded" />
            <div className="h-1 bg-slate-200 rounded w-5/6" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 h-1/2">
          {[0, 1, 2].map((i) => <div key={i} className="bg-slate-200 rounded" />)}
        </div>
      </div>
    );
  }
  if (id === 'minimal') {
    // Minimal: coluna central de linhas.
    return (
      <div className="h-20 w-full bg-slate-50 rounded-lg p-2 flex justify-center">
        <div className="w-2/3 flex flex-col gap-1.5 justify-center">
          <div className="h-2 bg-slate-300 rounded w-1/2 mx-auto" />
          <div className="h-1.5 bg-slate-200 rounded" />
          <div className="h-1.5 bg-slate-200 rounded" />
          <div className="h-1.5 bg-slate-200 rounded w-2/3 mx-auto" />
        </div>
      </div>
    );
  }
  // Vitrine: cabeçalho escuro + mosaico de blocos cheios.
  return (
    <div className="h-20 w-full bg-slate-50 rounded-lg overflow-hidden flex flex-col">
      <div className="h-2.5 bg-slate-800 w-full" />
      <div className="flex-1 p-1.5 grid grid-cols-3 gap-1.5">
        <div className="bg-slate-400 rounded row-span-2" />
        <div className="bg-slate-300 rounded" />
        <div className="bg-slate-400 rounded" />
        <div className="bg-slate-300 rounded" />
        <div className="bg-slate-400 rounded" />
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Remover a função `OptionPills` (ficará sem uso)**

Edit `src/modules/content/blog/BlogAppearance.tsx` — delete the entire `OptionPills` function (lines 86-114, do comentário `// Grupo de botões-pílula...` até o `}` de fechamento da função, inclusive).

- [ ] **Step 4: Substituir o card "Layout" pelo card "Navegação" (só o toggle)**

Edit `src/modules/content/blog/BlogAppearance.tsx` — replace the entire "Layout" card `<div>` (o bloco `<div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">` cujo `<h3>` é `Layout`, linhas ~231-293) with:

```tsx
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-900 mb-1">Navegação</h3>
            <p className="text-xs text-slate-500 mb-4">A estrutura e o visual das páginas vêm do template escolhido.</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Menu de categorias no cabeçalho</p>
                <p className="text-[11px] text-slate-400">Exibe os links das categorias no topo do blog.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={layout.showCategoriesNav}
                onClick={() => patchLayout({ showCategoriesNav: !layout.showCategoriesNav })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  layout.showCategoriesNav ? 'bg-[#FF5B03]' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  layout.showCategoriesNav ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </div>
```

- [ ] **Step 5: Verificar tipagem e imports não usados**

Run: `npm run lint`
Expected: PASS. Se `tsc` acusar `BlogLayout` importado mas não usado: `layout` ainda é tipado como `BlogLayout` (linha `const layout: BlogLayout = ...`), então o import permanece usado — não remover. Se acusar algum outro símbolo sem uso, remover só esse símbolo do import.

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/blog/types.ts src/modules/content/blog/BlogAppearance.tsx
git commit -m "feat(blog): renomeia templates (Revista/Minimal/Vitrine), novos previews e remove knobs de layout"
```

---

### Task 7: Conteúdo de preview + verificação manual (`src/modules/content/blog/placeholderContent.ts`)

Garante ≥2 posts por categoria no preview (a categoria "Bastidores" tem só 1) e valida as 3 páginas dos 3 temas no dev server.

**Files:**
- Modify: `src/modules/content/blog/placeholderContent.ts` (adicionar 1 post na categoria `placeholder-cat-bastidores`)

**Interfaces:**
- Consumes: `BlogPost` (formato existente no arquivo).
- Produces: nenhuma nova API.

- [ ] **Step 1: Adicionar um 6º post de exemplo (categoria Bastidores)**

Edit `src/modules/content/blog/placeholderContent.ts` — no array `PLACEHOLDER_POSTS`, adicionar mais um objeto (seguindo exatamente o mesmo formato dos existentes) antes do `]` que fecha o array:

```ts
  {
    id: 'placeholder-post-6',
    title: 'Como revisamos cada texto antes de publicar',
    slug: 'como-revisamos-cada-texto-antes-de-publicar',
    excerpt: 'Todo post passa por três leituras: clareza, precisão e tom. Veja o checklist que a equipe usa para manter a qualidade do blog.',
    coverImageUrl: placeholderImage('Bastidores', '#7c3aed'),
    categoryIds: ['placeholder-cat-bastidores'],
    status: 'published',
    publishedAt: daysAgo(9),
    authorName: 'Equipe Alfred',
    seo: { metaTitle: 'Como revisamos cada texto antes de publicar', metaDescription: 'O checklist de revisão em três etapas que mantém a qualidade do blog.' },
    createdAt: daysAgo(12),
    updatedAt: daysAgo(9),
    html: `
      <p>Publicar rápido não pode custar a confiança do leitor. Por isso, todo texto passa por três leituras antes de ir ao ar.</p>
      <h2>1. Clareza</h2>
      <p>A primeira leitura corta jargão e frases longas. Se um parágrafo precisa ser relido para fazer sentido, ele volta para a edição.</p>
      <h2>2. Precisão</h2>
      <p>Conferimos números, nomes e links. Cada afirmação forte precisa de uma fonte ou de um exemplo concreto.</p>
      <h2>3. Tom</h2>
      <p>Por fim, ajustamos o tom para soar como a marca: direto, útil e sem promessas exageradas.</p>`,
  },
```

- [ ] **Step 2: Verificar tipagem**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Subir o dev server**

Run: `npm run dev`
Expected: servidor Express + Vite sobe na porta 3000 sem erros no console.

- [ ] **Step 4: Verificação manual das 9 combinações (3 temas × 3 páginas)**

No app (autenticado), abrir o agente de Conteúdo → Blog → aba Aparência. Para cada template (Revista, Minimal, Vitrine):
1. Clicar no template no seletor (o preview recarrega).
2. No iframe de preview (ou "Abrir em nova aba" → `/b/{slug}/?preview=1`):
   - **Home** — confirmar a estrutura do tema (Revista: destaque + grade 3 col; Minimal: coluna serifada de linhas; Vitrine: mosaico com cabeçalho escuro).
   - Clicar numa **categoria** no menu — confirmar a página de Categoria (faixa/título com nome + descrição + lista/grade filtrada; ≥2 posts em cada categoria).
   - Clicar num **post** — confirmar a página de Artigo (Revista: capa larga + byline horizontal; Minimal: coluna estreita centralizada; Vitrine: hero com capa edge-to-edge).
3. Confirmar que **tempo de leitura** ("X min de leitura") aparece na meta/byline.
4. Trocar uma **cor** (primária) e o **título** e confirmar que refletem no preview dos 3 temas.

Expected: cada combinação renderiza sem erro, visualmente distinta, com os dados do usuário aplicados.

- [ ] **Step 5: Confirmar compatibilidade (sem migração)**

Confirmar que um blog cujo `settings.template` já era `editorial`/`minimal`/`grid` (o valor não muda) renderiza normalmente — os IDs internos foram preservados, então nada a migrar.

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/blog/placeholderContent.ts
git commit -m "feat(blog): 6º post de exemplo garante 2+ posts por categoria no preview"
```

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura do spec:**
- Decisão 1 (customização mantém cores/logo/textos/fontes) → Tasks 1-4 (temas leem só cor/fonte/logo/texto; knobs não lidos).
- Decisão 2 (remover 4 knobs, manter toggle categorias) → Task 6 Steps 3-4.
- Decisão 3 (IDs internos preservados) → Global Constraints + Task 6 Step 1 (mapeamento) + Task 4 index.
- 3 temas × 3 páginas → Tasks 2 (Revista), 3 (Minimal), 4 (Vitrine), cada um com renderHome/renderCategory/renderArticle.
- Tempo de leitura → Task 1 (`readingTime`) usado em todos os temas.
- renderCategory + roteamento → Task 5.
- Refactor shell + módulos → Tasks 1-2.
- Admin previews + rótulos → Task 6.
- Preview ≥2 posts/categoria → Task 7.
- Critérios de aceite 1-6 → cobertos pela verificação manual da Task 7 + `npm run lint` por tarefa.

**Placeholder scan:** sem TBD/TODO; todo código presente por extenso.

**Consistência de tipos:** `BlogTheme`/`ListOpts` (Task 2) usados idênticos nas Tasks 3-4; `BlogRenderContext`/`Head`/`renderDocument`/`readingTime`/`pagerHtml` (Task 1) consumidos com as mesmas assinaturas; dispatcher (Task 5) expõe `renderHome/renderCategory/renderPost/renderNotFound` com os tipos que `blogPublic.ts` chama.
