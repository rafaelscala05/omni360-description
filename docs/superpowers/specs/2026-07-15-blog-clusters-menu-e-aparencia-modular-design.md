# Blog: Menu por Clusters + Aparência Modular

Data: 2026-07-15

## Objetivo

Dois recursos no módulo Blog (CMS nativo):

1. **Popular menus pelos Clusters** — botão na aba Categorias que cria/reaproveita
   categorias com o nome de cada Cluster e vincula os posts publicados daquele
   cluster à categoria.
2. **Aparência modular** — substituir os 3 temas monolíticos por 5 eixos de
   customização independentes (mix-and-match), preservando os temas antigos como
   presets de atalho.

## Decisões (aprovadas)

- Aparência: **seletores independentes** (mix-and-match), 3 variantes por eixo.
- Botão Clusters: vincula **somente posts já publicados** (`BlogPost` com
  `sourceArticleId`).
- Duplicatas de categoria: **reaproveitar** categoria existente com mesmo slug
  (idempotente).
- Template legado (Revista/Minimal/Vitrine): vira **preset "Estilos rápidos"**.
- Card: toggles para Autor, Excerpt, Data+leitura, Chip de categoria.

## 1. Botão "Popular menus pelos Clusters"

Local: topo de `src/modules/content/blog/BlogCategories.tsx`.

Fluxo ao clicar (com `window.confirm` antes):
- Recebe via props `clusters: ContentCluster[]`, `articles: CalendarArticle[]`,
  `posts: BlogPost[]` (BlogView já escuta posts; passa a escutar clusters +
  calendário e repassa).
- Monta `articleId → clusterId` a partir de `articles`.
- Para cada `BlogPost` com `sourceArticleId`, resolve o cluster.
- Agrupa posts publicados por cluster. Para cada cluster com ≥1 post:
  - Reaproveita categoria com `slug === slugify(cluster.nome)` (busca em
    `categories`); senão cria via `saveBlogCategory`.
  - Para cada post do grupo, se `categoryId` não estiver em `post.categoryIds`,
    adiciona e persiste via `saveBlogPost`.
- Feedback: "N categorias / M posts vinculados".

Idempotente: rodar de novo não duplica categorias nem vínculos.

## 2. Modelo de dados — `BlogAppearance`

Novo em `src/modules/content/blog/types.ts`. Campo opcional
`BlogSettings.appearance`; ausência → defaults (sem migração). `template`
continua existindo (legado) e mapeia para preset quando `appearance` ausente.

```ts
export interface BlogAppearance {
  header: 'logo-esquerda' | 'logo-centro' | 'logo-topo';
  footer: 'simples' | 'colunas' | 'centralizado';
  footerShowCategories: boolean;
  category: 'grade' | 'lista' | 'destaque-grade';
  card: 'com-borda' | 'plano' | 'sombra';
  cardShowAuthor: boolean;
  cardShowExcerpt: boolean;
  cardShowMeta: boolean;      // data + tempo de leitura
  cardShowCategory: boolean;  // chip
  article: 'centrado' | 'capa-larga' | 'lateral-meta';
}
```

`DEFAULT_BLOG_APPEARANCE` e `PRESETS: Record<BlogTemplateId, BlogAppearance>`
(revista/minimal/vitrine → combinações equivalentes aos temas atuais).
Helper `effectiveAppearance(s)` = `appearance ?? PRESETS[template] ?? default`.

Cores, fontes, logo, `contentWidth`, `cornerRadius` seguem globais (já em
`BlogSettings.colors/fonts/layout`).

## 3. SSR — partials componíveis

Refatorar `server/blog/themes/`:
- Novo `server/blog/parts/`: `headers.ts`, `footers.ts`, `cards.ts`,
  `category.ts`, `article.ts`. Cada um exporta as 3 variantes (render + css).
- `shell.ts` ganha `effectiveAppearance` e helpers de card (autor/meta/chip).
- `themes/index.ts` → nova função `renderBlogBody(ctx, page)` que resolve o
  `appearance` e compõe header + main (home/category/article) + footer.
- `blogPublic.ts` passa a chamar o compositor no lugar de `THEMES[template]`.
  Home usa a variante de categoria/card; artigo usa a variante de artigo.
- CSS: `baseVars` + CSS de cada variante ativa concatenado (só as escolhidas).

Preview ao vivo (iframe `/b/:slug/?preview=1`) inalterado.

## 4. UI — aba Aparência

`BlogAppearance.tsx`:
- Bloco "Estilos rápidos" (3 presets) no topo — clique preenche os 5 eixos.
- 5 blocos de seletor (Header, Footer, Categoria, Card, Artigo), cada um com 3
  cards de preview em CSS puro (padrão do `TemplatePreview` atual) + toggles do
  eixo (footer: incluir categorias; card: autor/excerpt/meta/chip).
- Mantém Cores, Tipografia, Identidade/textos, Navegação, preview iframe.
- Persistência incremental via `patch({ appearance })` (mesmo padrão atual).

Visual dos seletores e das variantes SSR seguem a skill frontend-design.

## Fora de escopo

- Não altera pipeline de artigos, domínios, nem persistência de posts além de
  `categoryIds`.
- Sem novas dependências.

## Verificação

- `npm run lint` (tsc) limpo.
- Dev server: aba Aparência troca cada eixo e o preview reflete; botão Clusters
  cria categorias e vincula posts publicados.
