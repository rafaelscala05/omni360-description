# Agência de Criação de Conteúdo (Alfred)

Segundo agente do app, ativável pelo seletor de workspace na sidebar. Funciona ao
lado do Agente de Geração de Produto, compartilhando login, créditos e Firestore.

## Arquitetura

- **Frontend**: `src/modules/content/` (workspace próprio: Painel, Clusters,
  Calendário, Configurações). Acionado por `workspace === 'content'` em `App.tsx`.
- **IA server-side**: `server/contentAgent.ts` usa `@google/genai` +
  `GEMINI_API_KEY` (diferente do Agente de Produto, que roda IA no cliente). Isso
  permite **produção autônoma** sem o navegador aberto.
- **Persistência**: `users/{uid}/contentProjects/{projectId}` com subcoleções
  `clusters`, `calendar` e `secrets/wordpress` (segredo, leitura bloqueada ao cliente).
- **Créditos**: debitados server-side via Admin SDK (`debitCreditsAdmin`), na mesma
  coleção `users/{uid}/credit_logs` do Agente de Produto.

## Setup operacional

1. **Variáveis de ambiente** (`.env` / Secret Manager em produção):
   - `GEMINI_API_KEY` — obrigatório para o pipeline de conteúdo.
   - `CONTENT_CRON_SECRET` — segredo que protege `POST /api/content/cron/tick`.
   - `APP_URL` — usado para montar URLs absolutas das imagens geradas.

2. **Seed dos custos de crédito** (novas ações: `content_clusters`,
   `content_calendar`, `content_article`, `content_image`, `content_publish`):
   ```bash
   node seed-credit-config.cjs --project="<PROJECT_ID>" --db="alfstorage260612"
   ```

3. **Regras do Firestore** — publicar `firestore.rules` (inclui `contentProjects`
   e o bloqueio de leitura de `secrets/`):
   ```bash
   firebase deploy --only firestore:rules
   ```

4. **Agendamento autônomo (produção)** — o Cloud Run escala a zero, então o
   agendador roda via **Cloud Scheduler** chamando o endpoint diariamente:
   ```bash
   gcloud scheduler jobs create http alfred-content-tick \
     --schedule="0 7 * * *" \
     --uri="https://<APP_URL>/api/content/cron/tick" \
     --http-method=POST \
     --headers="x-content-cron-secret=<CONTENT_CRON_SECRET>" \
     --location=<REGIAO>
   ```
   Em **dev**, `startContentScheduler` roda um tick a cada hora automaticamente
   (somente quando `NODE_ENV !== production` e `CONTENT_CRON_SECRET` está definido).

## Fluxo de uso

1. **Onboarding** → cria um projeto com config da empresa + credenciais WordPress.
2. **Clusters** → gera (pesquisa com Google Search) e o usuário aprova.
3. **Calendário** → distribui artigos por data conforme a frequência.
4. **Produção** → roda automaticamente na data agendada (cron) ou via "Produzir
   agora". Pipeline de 5 etapas: Pesquisa → Outline → Rascunho → Imagem → Revisão.
5. **Publicação** → publica no WordPress (REST API) e grava a URL.

## Compartilhamento de dados entre módulos

- **Conteúdo → Produto/Categorias**: o servidor lê `products`/`categories` do
  usuário para contextualizar clusters e artigos (`loadStoreContext`).
- **Produto → Conteúdo**: o `ProductEditModal` lista artigos aprovados/publicados
  (`GET /api/content/articles/reusable`) e permite inseri-los na descrição.

## Blog nativo (CMS)

CMS de blog embutido na plataforma: cada projeto de conteúdo pode publicar um blog
público, servido via SSR direto do Firestore (sem build estático), com templates
prontos e domínio próprio opcional.

### Habilitação

- Ativado por projeto/usuário via `modules.blog = true` no documento
  `users/{uid}` (o mesmo doc que guarda os módulos habilitados do app). Com a
  flag ligada, a aba **Blog** aparece no workspace de Conteúdo
  (`src/modules/content/blog/`).
- Dentro da aba, o usuário configura slug público, título, descrição, template
  (`editorial` | `minimal` | `grid`), cores e logo — persistidos em
  `.../blog/settings` (ver estrutura abaixo).

### Estrutura no Firestore

Sob o projeto de conteúdo (`users/{uid}/contentProjects/{projectId}/`):

- `blog/settings` — doc único: `{ enabled, slug, title, description, template,
  logoUrl?, colors: { primary, background, text }, customDomains[],
  verifiedDomains?, createdAt, updatedAt }`.
- `blogPosts/{postId}` — `{ title, slug, html, excerpt, coverImageUrl?,
  categoryIds[], status: 'draft'|'published', publishedAt?, seo: { metaTitle?,
  metaDescription? }, authorName?, sourceArticleId?, createdAt, updatedAt }`.
- `blogCategories/{catId}` — `{ name, slug, description?, createdAt }`.

Duas coleções **raiz** (fora do doc do usuário) dão suporte ao serving público
sem exigir o uid/projectId na URL:

- `blogSlugs/{slug}` → `{ uid, projectId }` — resolve `/b/{slug}/...` para o
  tenant certo.
- `blogDomains/{dominio}` → `{ uid, projectId, verified, verificationToken,
  createdAt }` — resolve domínio customizado (`Host`/`X-Forwarded-Host`) para o
  tenant, só quando `verified === true`.

### URLs públicas

- **Padrão da plataforma**: `/b/{slug}/` (home), `/b/{slug}/{postSlug}`,
  `/b/{slug}/categoria/{catSlug}`, `/b/{slug}/sitemap.xml`, `/b/{slug}/feed.xml`.
  Servidas por `server/blogPublic.ts` (SSR com `server/blogTemplates.ts`),
  lendo Firestore via Admin SDK a cada request (com cache em memória de 60s por
  URL).
- **Domínio customizado**: o usuário aponta um CNAME para a plataforma e cria
  um TXT `_alfred-verify.<dominio>` com o `verificationToken` gerado; após a
  verificação, `blogDomains/{dominio}.verified` é marcado `true` e o mesmo
  serving passa a responder para requests com `Host: <dominio>`.
- **Alternativa via reverse proxy**: se o cliente preferir manter o domínio
  atrás do próprio proxy/CDN em vez de apontar DNS direto, o serving também
  aceita o prefixo `/blog` combinado com o header `X-Forwarded-Host:
  <dominio>` (ex.: proxy repassando `/blog/*` para a plataforma). Nesse caso as
  URLs internas usam `/blog` como `baseUrl` (sitemap, feed, links) em vez da
  raiz do domínio.
- Todo HTML inclui `<link rel="canonical">`, Open Graph e JSON-LD
  (`Blog`/`BlogPosting`) coerentes com a URL efetivamente acessada
  (`canonicalBase` deriva de `X-Forwarded-Proto`/`X-Forwarded-Host` quando
  presentes).

### Publicação de artigos no Blog nativo

No calendário editorial, publicar um artigo com destino **"Blog nativo"**
(`POST /api/content/projects/{projectId}/articles/{articleId}/publish` com
`{ destination: 'blog' }`) copia o `articleFinal` para `blogPosts` como
`published` (reaproveitando o mesmo post/slug em republicações via
`sourceArticleId`) e grava a URL pública em `urlPublicado` no artigo do
calendário. Diferente das demais ações de IA do módulo, **esta publicação não
debita créditos** — é apenas uma cópia de conteúdo já gerado para dentro do
Firestore, sem chamada ao Gemini.

### Deploy / operação

1. `firebase deploy --only firestore:rules` — publica as regras que protegem
   as coleções do blog (settings/posts/categories só editáveis pelo dono;
   `blogSlugs`/`blogDomains` negam leitura e escrita ao cliente — só o
   backend, via Admin SDK, acessa essas coleções).
2. `firebase deploy --only firestore:indexes` — publica o índice composto
   novo de `blogPosts` (`status` ASC + `publishedAt` DESC), exigido pela
   listagem de posts publicados no serving público. **Atenção**: esse comando
   só tem efeito se `firebase.json` tiver `firestore.indexes` apontando para
   `firestore.indexes.json` — sem essa chave o deploy roda "com sucesso" mas
   não lê nem aplica o arquivo de índices.
3. Adicionar `APP_URL` ao `apphosting.yaml` — usado por
   `server/blogPublic.ts` para montar o conjunto de hosts da própria
   plataforma (`platformHosts`), distinguindo tráfego normal do app de
   requests que devem cair no serving de domínio customizado.
4. Domínio customizado: depois do CNAME/TXT verificados e `blogDomains/{dominio}
   .verified = true`, o apontamento final de SSL é feito no **console do
   Firebase App Hosting** (ou Cloud Run, conforme o ambiente), adicionando o
   domínio customizado à instância — a aplicação em si só decide o roteamento
   por `Host`/`X-Forwarded-Host`, não provisiona certificado.

## Agente conversacional (chat)

O Agente de Conteúdo pode ser operado por chat (CopilotKit + LangGraph.js),
além da UI de botões já descrita acima. Ver
`docs/superpowers/specs/2026-08-28-content-agent-chat-copilotkit-langgraph-design.md`
para o design completo.

### Deploy

O grafo LangGraph.js roda como um **serviço Cloud Run separado** do app
principal (não dá pra rodar embutido no mesmo processo Express — a
integração `@copilotkit/runtime` fala com o LangGraph via HTTP, não em
processo). `Dockerfile.contentAgent` empacota o mesmo código-fonte do
repositório (a lógica das ferramentas de chat mora em `server/agent/tools/
content.ts`/`contentSeo.ts`, reaproveitando as funções de `contentAgent.ts`/
`seoAgent.ts` — nenhum código duplicado), só com outro entrypoint
(`server/agent/contentGraph.ts:graph`, registrado em `langgraph.json`).

1. **Buildar a imagem:**
   ```bash
   npx @langchain/langgraph-cli build -t content-agent-graph
   ```
   (requer Docker rodando localmente; não validado nesta sessão de
   desenvolvimento por falta de um daemon Docker ativo no ambiente — rodar
   antes do merge.)

2. **Publicar no Artifact Registry e criar o serviço Cloud Run:**
   ```bash
   docker tag content-agent-graph gcr.io/<PROJECT_ID>/content-agent-graph
   docker push gcr.io/<PROJECT_ID>/content-agent-graph
   gcloud run deploy content-agent-graph \
     --image gcr.io/<PROJECT_ID>/content-agent-graph \
     --region <REGIAO> \
     --set-env-vars VERTEX_PROJECT_ID=<PROJECT_ID>,VERTEX_LOCATION=<REGIAO> \
     --no-allow-unauthenticated
   ```
   O serviço precisa das mesmas credenciais Admin do Firebase que o app
   principal (ADC via identidade da conta de serviço do Cloud Run — mesmo
   mecanismo de `server/firebaseAdmin.ts`), mais `VERTEX_PROJECT_ID`/
   `VERTEX_LOCATION`. `--no-allow-unauthenticated`: só o app principal deve
   conseguir chamá-lo — configurar IAM (`roles/run.invoker`) para a conta de
   serviço do serviço principal, não deixar público.

3. **Apontar o app principal pro novo serviço:** configurar
   `CONTENT_AGENT_LANGGRAPH_URL` (em `apphosting.yaml`/Secret Manager, mesmo
   padrão das outras variáveis) com a URL do serviço Cloud Run criado.

## Pendências / melhorias futuras

- Dockerfile.contentAgent foi gerado e ajustado (`.dockerignore` adicionado
  pra não vazar `.env`/`node_modules`/`.git` pra dentro da imagem), mas o
  build/run local não foi validado nesta sessão por falta de um daemon
  Docker ativo no ambiente de desenvolvimento — validar antes do primeiro
  deploy.

- Mover o segredo do WordPress para o Secret Manager (hoje em Firestore, com
  leitura bloqueada ao cliente).
- Avaliar um teto diário de produção por projeto (a produção autônoma consome
  créditos sem o usuário presente).
- Índice composto no Firestore pode ser exigido pela query do cron
  (`collectionGroup('calendar')` com `status` + `scheduledDate`); o console do
  Firebase fornece o link de criação quando necessário.
