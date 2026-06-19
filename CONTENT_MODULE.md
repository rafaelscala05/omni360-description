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

## Pendências / melhorias futuras

- Mover o segredo do WordPress para o Secret Manager (hoje em Firestore, com
  leitura bloqueada ao cliente).
- Avaliar um teto diário de produção por projeto (a produção autônoma consome
  créditos sem o usuário presente).
- Índice composto no Firestore pode ser exigido pela query do cron
  (`collectionGroup('calendar')` com `status` + `scheduledDate`); o console do
  Firebase fornece o link de criação quando necessário.
