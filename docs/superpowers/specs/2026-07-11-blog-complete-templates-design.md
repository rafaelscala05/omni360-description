# Blog — Templates completos (Revista / Minimal / Vitrine)

**Data:** 2026-07-11
**Status:** Aprovado (design)

## Contexto

Hoje a seção de Blog (agente de Conteúdo → aba Aparência) tem um seletor de
"template" com 3 opções (`editorial`, `minimal`, `grid`), mas cada template só
altera o **layout da listagem** (`listBody` em `server/blogTemplates.ts`).
Cabeçalho, rodapé, cores, fontes e 4 knobs de layout (largura, alinhamento,
estilo de card, cantos) são controles separados e compartilhados por todos.
Além disso, a página de **Categoria reutiliza o render da Home** (`renderHome`
com um param `category`); só o **Artigo** (`renderPost`) é separado.

## Objetivo

Transformar cada template num **tema completo e visualmente distinto**, no
formato "loja de templates": o usuário pré-visualiza o modelo padrão e seus
dados (título, logo, cores, fontes, posts) fluem para dentro. Cada tema cobre
as **3 páginas**: Home, Categoria e Artigo.

## Decisões (brainstorming)

1. **Customização:** cada tema traz seu próprio visual/estrutura (largura,
   alinhamento, cards, cantos passam a ser definidos pelo tema). O usuário
   continua controlando **cores, logo, título/descrição, rodapé e fontes**.
2. **Seção "Layout" do admin:** remover os 4 knobs
   (largura/alinhamento/card/cantos); **manter o toggle "menu de categorias"**
   (é escolha de conteúdo, não de estilo).
3. **IDs internos preservados:** `editorial`/`minimal`/`grid` continuam sendo os
   valores gravados no Firestore — muda apenas nome, descrição, preview e a
   renderização. **Sem migração de dados**; blogs existentes só mudam a aparência.

## Os 3 temas

| Nome (pt-BR) | Estilo               | ID interno |
|--------------|----------------------|------------|
| **Revista**  | Magazine (Sanity Ignite) | `editorial` |
| **Minimal**  | Leitura tipográfica  | `minimal`  |
| **Vitrine**  | Bold / visual (masonry) | `grid`   |

### Revista (`editorial`)
- **Home:** post em destaque grande no topo + grade de cards em 3 colunas.
  Cada card: capa, chip de categoria, título, excerto, meta (data · autor ·
  tempo de leitura). Muito espaço em branco.
- **Categoria:** faixa de cabeçalho com nome + descrição da categoria, depois a
  mesma grade de 3 colunas (sem o post em destaque).
- **Artigo:** capa larga no topo, título, byline horizontal
  (data · autor · categoria · tempo de leitura), coluna de conteúdo central
  (~720px).

### Minimal (`minimal`)
- **Home:** uma coluna central (~680px), tipografia serifada, lista de posts
  com título, data e excerto; quase sem imagens na listagem. Cabeçalho
  centralizado.
- **Categoria:** título + descrição da categoria centralizados, depois a lista.
- **Artigo:** coluna estreita (~680px), byline centralizada, capa opcional
  discreta acima do título.

### Vitrine (`grid`)
- **Home:** mosaico masonry com capas grandes ocupando o card inteiro; chip de
  categoria e título sobre a imagem. Cabeçalho escuro, sans-serif geométrica.
- **Categoria:** faixa da categoria + o mosaico filtrado.
- **Artigo:** capa edge-to-edge com título em destaque sobre/junto à imagem,
  coluna de conteúdo, sans geométrica.

### Transversal a todos os temas
- **Tempo de leitura**: calculado a partir do HTML do post (contagem de
  palavras / ~200 wpm), exibido na meta/byline.
- **Chips de categoria**: já existem os dados; passam a ter tratamento visual
  por tema.

## Arquitetura de renderização (server)

Refatorar `server/blogTemplates.ts` (hoje monolítico) em unidades focadas:

- **`server/blog/shell.ts`** (shell compartilhado): utilitários e a "casca" do
  documento — `escapeHtml`, `fmtDate`, `readingTime`, `effectiveFonts`,
  `effectiveLayout`, `fontStack`, `googleFontsLink`, variáveis de cor CSS
  (`--primary/--bg/--text`), e `renderDocument(ctx, head, { css, body })` que
  monta `<!doctype>…<head>{SEO/OG/JSON-LD/fonts}…<body>{body}`. A `head`
  (title/description/canonical/ogImage/jsonLd) permanece responsabilidade de
  quem chama, como hoje.
- **`server/blog/themes/{revista,minimal,vitrine}.ts`**: um módulo por tema.
  Cada um exporta um objeto `BlogTheme` com:
  - `css(ctx): string` — CSS específico do tema (inclui header/footer/páginas).
  - `renderHome(ctx, posts, opts): string` — `<body>` interno completo
    (header + main + footer) da Home.
  - `renderCategory(ctx, category, posts, opts): string` — idem para Categoria.
  - `renderArticle(ctx, post): string` — idem para o Artigo.
  - `header(ctx)` / `footer(ctx)` são helpers internos do módulo (o header/footer
    é próprio de cada tema: Revista claro, Minimal centrado, Vitrine escuro).
- **`server/blogTemplates.ts`** (dispatcher, API pública estável): mantém as
  assinaturas usadas por `blogPublic.ts` —
  `renderHome(ctx, posts, opts)`, `renderPost(ctx, post)`,
  `renderNotFound(ctx, msg)` — e adiciona **`renderCategory(ctx, category, posts, opts)`**.
  Cada função escolhe o tema por `ctx.settings.template` e chama
  `renderDocument` do shell com `theme.css(ctx)` + o corpo do tema. Reexporta
  `escapeHtml`, `googleFontsLink`, `BlogRenderContext` como hoje.

### `BlogRenderContext`
Inalterado (`settings`, `categories`, `baseUrl`, `canonicalBase`,
`canonicalPathPrefix?`, `demoQuery?`). O helper `withDemoQuery` migra para o
shell e é usado pelos temas para preservar `?preview=1` nos links internos.

## Roteamento (`server/blogPublic.ts`)

- A rota `/categoria/:slug` passa a chamar **`renderCategory`** em vez de
  `renderHome(..., { category })`.
- Home e Artigo permanecem em `renderHome` / `renderPost`.
- Sitemap, feed, paginação, cache e resolução de tenant/domínio: inalterados.

## Tipos (`src/modules/content/blog/types.ts`)

- `BlogTemplateId` continua `'editorial' | 'minimal' | 'grid'`.
- `BLOG_TEMPLATES` atualiza `nome`/`descricao`:
  - `editorial` → **Revista** — "Estilo magazine: destaque + grade de 3 colunas."
  - `minimal` → **Minimal** — "Uma coluna serifada, foco na leitura."
  - `grid` → **Vitrine** — "Mosaico visual com capas grandes."
- `BlogLayout`: os campos `contentWidth`, `headerAlign`, `cardStyle`,
  `cornerRadius` permanecem **opcionais no tipo** (compat com settings antigos),
  mas os temas **deixam de lê-los**. `showCategoriesNav` e `footerText`
  continuam em uso. `DEFAULT_BLOG_LAYOUT` mantido.

## Admin (`src/modules/content/blog/BlogAppearance.tsx`)

- **`TemplatePreview`**: redesenhar os 3 mini-previews em CSS puro para
  refletir Revista (destaque + grade), Minimal (coluna/linhas) e Vitrine
  (mosaico). Rótulos vêm de `BLOG_TEMPLATES`.
- **Seção "Layout"**: remover os 4 grupos `OptionPills`
  (largura/alinhamento/card/cantos). Manter apenas o toggle
  "Menu de categorias no cabeçalho" (realocado como um bloco enxuto, ex.
  junto de "Identidade e textos" ou como card curto próprio).
- Tipografia, Cores, Identidade/textos, logo, rodapé e o iframe de preview ao
  vivo: inalterados. O preview já navega Home → Categoria → Artigo.

## Preview / conteúdo fictício (`src/modules/content/blog/placeholderContent.ts`)

- Garantir **≥ 2 posts por categoria** para a página de Categoria não ficar
  vazia no preview. Hoje há 3 categorias; adicionar 1–2 posts extras cobrindo
  as categorias com um único post. Capas continuam via SVG inline (sem rede).

## Fora de escopo

- Não mexer em auth, domínios customizados, editor de posts, calendário
  editorial, créditos ou export.
- Não adicionar novos knobs de customização além dos já existentes.
- Sem avatar de autor com upload (a byline usa apenas `authorName`; um monograma
  de iniciais é aceitável quando o tema pedir).

## Critérios de aceite

1. Selecionar cada um dos 3 temas no admin muda visivelmente Home, Categoria e
   Artigo no preview ao vivo, cada um com estrutura/visual distinto.
2. Cores, fontes, logo, título/descrição e rodapé escolhidos pelo usuário se
   aplicam em todos os temas e nas 3 páginas.
3. A seção "Layout" do admin não tem mais os 4 knobs; o toggle "menu de
   categorias" continua funcionando.
4. Blogs existentes (com `template` já gravado) renderizam sem erro e sem
   migração — apenas com a nova aparência.
5. Tempo de leitura aparece na meta/byline dos posts.
6. `npm run lint` (tsc --noEmit) passa.
