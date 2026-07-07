# Módulo Blog (CMS nativo) — Design

**Data:** 2026-07-06
**Status:** Aprovado pelo usuário (brainstorming em sessão)

## Objetivo

Dentro do módulo de Conteúdo (Alfred), oferecer um CMS de blog hospedado pela
própria plataforma: os artigos produzidos pelo pipeline podem ser publicados
nele, e o usuário pode criar/editar posts e categorias manualmente, escolher
entre 3 templates visuais, personalizar logo e cores, e apontar um domínio
próprio para o blog. Segue padrões de CMS consolidados (WordPress/Sanity):
conteúdo estruturado, status draft/published, slugs amigáveis e estáveis,
SEO nativo (canonical, Open Graph, JSON-LD, sitemap, RSS).

## Decisões tomadas

1. **Domínio customizado:** subdomínio via CNAME (`blog.minhaloja.com.br`) é o
   caminho principal, com suporte também a reverse proxy do cliente
   (`minhaloja.com.br/blog` → plataforma). O servidor resolve o tenant pelo
   header `Host`/`X-Forwarded-Host` em ambos os casos. *(Apontar um caminho
   `/blog` só com DNS não é possível — DNS resolve hosts, não paths.)*
2. **Vínculo:** 1 blog por `contentProject` (empresa/marca), mantendo o modelo
   multi-marca existente em `users/{uid}/contentProjects/{projectId}`.
3. **Habilitação:** flag `modules.blog === true` no doc `users/{uid}`, mesmo
   padrão de `modules.contentAgent` e `modules.video`.
4. **Convivência:** o blog nativo é um destino de publicação adicional ao lado
   de WordPress e Sanity externos — nada existente é removido.
5. **Renderização:** SSR no Express existente (`server.ts`), lendo Firestore
   via Admin SDK, com cache. Alternativas descartadas: geração estática
   (invalidação complexa, desnecessária no volume atual) e SPA client-side
   (SEO fraco).

## Modelo de dados (Firestore)

Sob `users/{uid}/contentProjects/{projectId}`:

- **`blog/settings`** (doc único):
  ```ts
  interface BlogSettings {
    enabled: boolean;
    slug: string;              // identificador público, único global (ex.: "minhaloja")
    title: string;
    description: string;
    template: 'editorial' | 'minimal' | 'grid';
    logoUrl?: string;
    colors: { primary: string; background: string; text: string };
    customDomains: string[];   // espelho de blogDomains p/ exibição na UI
    createdAt: string;
    updatedAt: string;
  }
  ```
- **`blogPosts/{postId}`**:
  ```ts
  interface BlogPost {
    title: string;
    slug: string;              // kebab-case sem acentos; imutável após publicado
    html: string;              // corpo (mesmo formato HTML do pipeline)
    excerpt: string;
    coverImageUrl?: string;
    categoryIds: string[];
    status: 'draft' | 'published';
    publishedAt?: string;
    seo: { metaTitle?: string; metaDescription?: string };
    authorName?: string;
    sourceArticleId?: string;  // quando veio do calendário editorial
    createdAt: string;
    updatedAt: string;
  }
  ```
- **`blogCategories/{catId}`**: `{ name, slug, description?, createdAt }`

Coleções raiz (lookup do serving público):

- **`blogSlugs/{slug}`**: `{ uid, projectId }` — unicidade global do slug do
  blog e resolução O(1) de `/b/{slug}`.
- **`blogDomains/{domain}`**: `{ uid, projectId, verified: boolean,
  verificationToken: string, createdAt }` — resolução O(1) por `Host`.

Slug de post: gerado do título (minúsculas, sem acentos, hífens); em colisão
dentro do blog, sufixo `-2`, `-3`, …

## URLs públicas

Na plataforma:
- `GET /b/{blogSlug}/` — home do blog (lista paginada)
- `GET /b/{blogSlug}/{postSlug}` — post
- `GET /b/{blogSlug}/categoria/{catSlug}` — arquivo de categoria
- `GET /b/{blogSlug}/sitemap.xml`, `GET /b/{blogSlug}/feed.xml`

Em domínio customizado (mesmas rotas sem o prefixo `/b/{blogSlug}`):
- `/`, `/{postSlug}`, `/categoria/{catSlug}`, `/sitemap.xml`, `/feed.xml`
- Quando servido atrás de proxy do cliente em `/blog`, o servidor aceita e
  remove o prefixo `/blog` (e usa `X-Forwarded-Host` para resolver o tenant).

SEO em todas as páginas: `<title>`/meta description (com override do campo
`seo`), canonical apontando para o domínio customizado verificado (quando
existir), Open Graph/Twitter cards, JSON-LD `Blog`/`BlogPosting`.

## Serving (novo `server/blogPublic.ts`)

- Registrado em `server.ts` **antes** do Vite middleware/static.
- Middleware: se `Host` (ou `X-Forwarded-Host`) não é domínio da plataforma,
  busca `blogDomains/{host}`; se verificado, serve o blog do tenant. Caso
  contrário segue o fluxo normal. Rotas `/b/:blogSlug/*` sempre ativas.
- **Templates** são funções TypeScript puras `(settings, dados) => string`
  gerando HTML completo com CSS inline (variáveis de cor do settings):
  - **Editorial** — estilo revista: post em destaque + lista com imagens.
  - **Minimal** — uma coluna tipográfica, foco em leitura.
  - **Grid** — cards em grade com capa.
- Cache em memória por rota (TTL 60s) + `Cache-Control: public, max-age=60`.
- 404 amigável para blog/post/categoria inexistente ou não publicado.

### Domínios customizados

- UI "Domínios": usuário adiciona domínio → servidor grava `blogDomains` com
  `verificationToken` → UI mostra instruções (TXT `_alfred-verify.<domínio>` +
  CNAME para o host da plataforma) → botão "Verificar" chama endpoint que faz
  lookup DNS (módulo `node:dns`) e marca `verified: true`.
- Emissão de SSL/apontamento final no Firebase App Hosting/Cloud Run é etapa
  operacional documentada (adicionar o domínio no console), fora do código.

## Admin (frontend — dentro do módulo de Conteúdo)

Nova área "Blog" no `ContentApp` (`src/modules/content/blog/`), visível quando
`modules.blog === true` no doc do usuário:

- **Posts**: lista com status/busca; editor com título, slug editável (até a
  publicação), capa (via `/api/upload`), categorias, campos SEO e corpo em
  rich-text simples (contentEditable produzindo o mesmo HTML do pipeline).
- **Categorias**: CRUD simples (nome, slug, descrição).
- **Aparência**: seleção entre os 3 templates com preview, upload de logo,
  cores (primária, fundo, texto).
- **Domínios**: adicionar/verificar/remover domínios.
- **Publicação do calendário**: o publish de artigo ganha o destino "Blog
  nativo" — copia `articleFinal`/meta/slug/imagem para `blogPosts` como
  `published` e grava `urlPublicado` no artigo.

Serviço cliente: `src/services/blogService.ts` (CRUD direto no Firestore
owner-scoped + chamadas ao servidor para domínios, mesmo padrão do
`contentService.ts`).

## Segurança e créditos

- Firestore rules: `blog/settings`, `blogPosts`, `blogCategories` — leitura e
  escrita apenas pelo dono (`request.auth.uid == uid`). `blogSlugs` e
  `blogDomains` — sem acesso de cliente; apenas o servidor (Admin SDK) lê e
  escreve. O público nunca acessa Firestore: todo conteúdo público sai pelo
  SSR do servidor.
- Sanitização: o HTML dos posts é do próprio dono e renderizado no blog dele;
  ainda assim, campos de texto (título, excerpt, meta) são escapados no SSR.
- Créditos: publicar no blog nativo não debita créditos (o artigo já foi
  pago); criação/edição manual de posts é gratuita (sem IA).

## Validação

Manual via `npm run dev` (padrão do projeto):
1. Habilitar `modules.blog` no usuário de teste; criar settings, categorias e
   um post manual; conferir home, post e categoria nos 3 templates.
2. Publicar um artigo do calendário no blog nativo e conferir a URL.
3. `curl -H "Host: blog.exemplo.com" localhost:3000/` com domínio verificado
   fake no Firestore; e `curl -H "X-Forwarded-Host: exemplo.com" localhost:3000/blog/`.
4. Conferir sitemap.xml, feed.xml, canonical e JSON-LD no HTML gerado.
5. `npm run lint` limpo.

## Fora de escopo (YAGNI)

- Comentários, múltiplos autores/perfis, agendamento de posts próprio do blog
  (o calendário editorial já agenda), temas customizados além dos 3, editor de
  blocos avançado, automação de SSL por API.
