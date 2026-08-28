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

O Agente de Conteúdo pode ser operado por chat (LangGraph.js + uma ponte
REST+SSE própria), além da UI de botões já descrita acima. Ver
`docs/superpowers/specs/2026-08-28-content-agent-chat-copilotkit-langgraph-design.md`
para o design original e
`docs/superpowers/plans/2026-08-28-content-agent-chat-copilotkit-langgraph.md`
para o histórico de implementação — ambos escritos quando a camada de UI
ainda era CopilotKit; **o front-end e a ponte com o app principal foram
reescritos depois** para remover essa dependência (ver nota no topo de cada
documento). O grafo LangGraph.js, o registry de ferramentas e o checkpointer
do Firestore não mudaram nessa reescrita.

**Onde fica cada coisa:**

- Ferramentas: **41 no total (14 leitura, 27 escrita)**, paridade completa com
  o que a UI de botões faz — `server/agent/tools/content.ts` (onboarding,
  listar projetos, clusters CRUD, calendário/artigos CRUD, produtos para
  vincular, projeto CRUD, produção de artigo, publicar/despublicar, conectar
  credencial),
  `server/agent/tools/contentSeo.ts` (auditoria de SEO) e
  `server/agent/tools/contentBlog.ts` (blog nativo: config, posts,
  categorias). As tools de geração/pipeline por IA são cascas finas sobre
  `contentAgent.ts`/`seoAgent.ts`; as de CRUD (clusters/calendário/artigos/
  projeto/blog) escrevem direto no Firestore via Admin SDK, nos mesmos
  documentos que `src/services/{content,blog}Service.ts` escrevem do
  cliente — o agente e a UI de botões operam sobre o mesmo estado. Fora do
  escopo por ora: gestão de domínio customizado do blog (claim-slug, CNAME/
  proxy via Cloudflare) — vive em rotas inline em `server/blogAdmin.ts`, não
  em funções exportadas reaproveitáveis, e envolve verificação DNS
  assíncrona externa; extrair isso com segurança é um trabalho à parte.
  Todas registradas no mesmo registry do Agente Operacional (`server/agent/
  registry.ts`), só com `provider: 'content'`.
- Orquestração: `server/agent/contentGraph.ts` — um `StateGraph` do
  LangGraph.js, rodando como **serviço próprio** (não embutido no processo
  Express principal), empacotado por `Dockerfile.contentAgent` (dev via
  `npm run dev:content-agent`, porta 8123).
- Ponte com o frontend: `server/agent/contentAgentChat.ts` expõe
  `/api/content-agent/*` no app principal — REST simples (`express.json()`
  de boas, sem tratamento especial de body) + SSE hand-rolado, no mesmo
  molde do Agente Operacional (`server/agent/routes.ts`). Verifica o token
  Firebase e chama o servidor LangGraph.js nativamente
  (`POST /threads/{id}/runs/stream` com `stream_mode: ["messages-tuple",
  "values"]`), traduzindo o stream em eventos SSE (`delta`/`leitura`/`acao`/
  `resultado`/`fim`) e em documentos Firestore legíveis
  (`users/{uid}/content_agent_threads/{id}/messages`,
  `users/{uid}/content_agent_actions`) que o frontend consome via
  `onSnapshot` — o modelo nunca decide de quem é a sessão, o `uid` verificado
  vai direto em `config.configurable`.
- Aprovação: `users/{uid}/agent_settings` (`server/agent/agentSettings.ts`)
  guarda o modo `ask`/`auto` (global + por ferramenta). Publicar, despublicar
  e conectar credencial são travas fixas — sempre pedem aprovação, ignorando
  o modo automático. O mecanismo em si é o `interrupt()` do LangGraph.js
  (não o `agent_actions` do Operacional) — persistido por um checkpointer
  próprio no Firestore (`server/agent/firestoreCheckpointer.ts`, já que não
  existe um checkpointer oficial do LangGraph.js para Firestore). A ponte
  reivindica a ação numa transação do Firestore antes de mandar o resume
  (`claimAction()` em `contentAgentChat.ts`) para um duplo clique/duas abas
  não conseguirem resolver o mesmo `interrupt()` duas vezes.
- Frontend: `src/modules/content/chat/ContentAgentPanel.tsx` é um painel
  docado (substitui o antigo `CopilotSidebar`) montado no workspace de
  Conteúdo, com `ContentChatThread.tsx`/`ContentActionCard.tsx`/
  `ContentComposer.tsx` e o client `src/services/contentAgentChatService.ts`.
  `ContentActionCard` decide por `action.tool` se renderiza o cartão de
  aprovação genérico ou o formulário de credencial (`CredentialForm.tsx`, que
  grava direto no Firestore — a senha/token nunca vira argumento de tool call
  nem trafega pela ponte). Uma única conversa persistente por usuário nesta
  entrega (sem troca de thread na UI, ao contrário do Agente Operacional).
  `ContentAgentPanel` recebe `projeto`/`articleId` de `ContentApp.tsx` (o que
  está aberto no workspace) e manda como `WorkspaceContext` em toda mensagem/
  ação; `contentAgentChat.ts` repassa isso como `config.configurable.contexto`
  pro grafo, que injeta no system prompt a cada chamada (`buildSystemPrompt`
  em `contentGraph.ts`) — o modelo usa o projeto aberto por padrão em vez de
  perguntar o ID (que a UI nunca mostra ao usuário). Quando não há projeto
  aberto, ou o usuário menciona outro pelo nome, `content.projetos.listar`
  deixa o modelo resolver nome → ID sozinho.

**Fora de escopo desta entrega** (specs futuros): migrar o Agente Operacional
para este mesmo motor LangGraph.js (ele continua no loop de function-calling
próprio, `server/agent/loop.ts`), mover a geração do Agente de Produto para
o servidor, e um seletor de conversas na UI do Agente de Conteúdo. As duas
superfícies de chat (Operacional e Conteúdo) coexistem por enquanto, sem
unificação.

**Verificação:** sem suíte automatizada (padrão do projeto) — `scripts/
verify-content-langchain-adapter.mjs`, `verify-content-approval-settings.mjs`
e `verify-content-agent-tools.mjs` cobrem a lógica pura (branching de
aprovação, catálogo de ferramentas). O mecanismo de ponta a ponta (grafo real
+ Firestore + Vertex AI + ponte REST/SSE) foi validado ao vivo direto contra
a API do `/api/content-agent/*` do app principal para cada categoria de
fluxo — resposta simples, chamada de ferramenta de leitura, interrupt de
escrita com aprovação, execução após aprovação, rejeição, dupla-execução
bloqueada pelo `claimAction()`, criação/listagem/exclusão de thread, e (nas
41 ferramentas de `content`) listar clusters, criar cluster manual via
interrupt/aprovação, e atualizar a config do blog nativo com objeto aninhado
(`colors`) — além do checkpointer do Firestore isoladamente (put/getTuple/
putWrites/list/deleteThread).

**Pegadinha real encontrada e corrigida nesse teste ao vivo:** um schema de
ferramenta com `type: 'object'` sem `properties` explícitas vira, na
conversão pra Zod (`jsonSchemaPropertyToZod` em `registry.ts`), um objeto
aberto (`z.record`) — o Vertex AI recusa isso com HTTP 400 na chamada
inteira do modelo, não só quando aquela ferramenta é usada, porque o
catálogo inteiro é vinculado de uma vez (`toLangChainTools`). Toda mensagem
na conversa quebrava silenciosamente até o fix: a conversão agora respeita
`properties` aninhadas recursivamente quando declaradas no JSON Schema.
Qualquer ferramenta nova com um argumento `type: 'object'` PRECISA declarar
`properties` explícitas (ver `content.blog.config.atualizar` em
`contentBlog.ts` para o padrão) — nunca deixar um objeto aberto.

**Não foi validado** (ambiente sem os recursos necessários, listado para
quem for revisar antes do merge):
- Um clique-a-clique completo pela UI real do navegador (login, abrir o
  workspace de Conteúdo, abrir o painel do chat, aprovar um card de verdade)
  — a extensão do Chrome não estava conectada no ambiente desta sessão.
- As ferramentas que debitam créditos de um usuário real (`content.clusters.
  gerar`, `.calendario.gerar`, `.artigo.produzir`, `.seo.auditoria.gerar`) —
  testadas só na lógica de schema/registro, não executadas de ponta a ponta
  (exigem um usuário com créditos de verdade; `content.artigo.produzir` em
  particular chama o pipeline completo de 5 etapas, com custo real de API).
- `docker build`/`docker run` do `Dockerfile.contentAgent` (Docker Desktop
  sem daemon ativo no ambiente desta sessão).

### Deploy

O grafo LangGraph.js roda como um **serviço Cloud Run separado** do app
principal (não dá pra rodar embutido no mesmo processo Express — a ponte em
`server/agent/contentAgentChat.ts` fala com o LangGraph via HTTP, não em
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
