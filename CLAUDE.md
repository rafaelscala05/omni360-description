# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Express + Vite on port 3000)
npm run build        # Build frontend with Vite
npm run lint         # Type-check with tsc --noEmit
```

There are no automated tests. The app is validated manually by running the dev server.

## Environment

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to a valid Google Gemini API key. The app will fail to call any AI endpoint without it.

## Architecture

This is a full-stack TypeScript app with two runtimes:

**Backend** (`server.ts`): Express server started via `tsx`. Serves as both the API layer and the Vite dev server proxy.

Note: product AI generation (description, attributes, ambient images, enrichment, category hierarchy) **no longer runs on the server** — it migrated to the client via Firebase AI Logic. `server.ts` itself only hosts `/api/upload` and the Asaas payment routes; everything else lives in the `server/*.ts` modules registered from it. Anything that needs to observe a generation must hook the client (see the CRM below), not a server endpoint.

- `POST /api/upload` — saves uploaded images to `./uploads/` and returns a URL
- Tiny ERP (v2 token + v3 OAuth, selected per user; the UI currently only exposes v2) — `server/tinyAgent.ts` (v3 + shared types), `server/tinyV2.ts` (v2 client), `server/tinyProvider.ts` (version dispatch + `POST /api/tiny/push`); client: `src/services/tinyService.ts`, `src/components/integrations/TinyConnector.tsx`. Products tagged `_tinyProductId`.
  Two invariants on the push, both learned from production bugs — verify with `npx tsx scripts/verify-tiny-push.mjs`:
  1. **The push only ever writes título, descrição complementar, SEO and imagens.** `TinyPushProduct` carries no fiscal/logistics fields on either side, so local (spreadsheet/AI-enrichment) values for `ncm`, `gtin`, `cest`, pesos and dimensões can't reach Tiny by accident — writing `ncm` also makes Tiny re-derive `cest`.
  2. **v2 `produto.alterar.php` is a whole-record operation: a field left out of the payload is reset, not kept.** Omitting the fiscal data is therefore not enough — `buildV2AlterarPayload` echoes Tiny's *own* current value for every preservable field (`PRESERVED_V2_FIELDS`), which preserves it under a full replace and is a no-op if Tiny ever treats the call as a patch. Watch the casing: `produto.obter.php` answers the packaging dimensions in **camelCase** (`larguraEmbalagem`) while `produto.alterar.php` reads them in **snake_case** (`largura_embalagem`); reading the wrong one silently yields `undefined`. The reset applies to **scalar** fields: `variacoes` survives being omitted (confirmed on a real push, 2026-09-03) and the docs say the same about `tags`, so collections are left alone and only `PRESERVED_V2_FIELDS` + the `seo` block need echoing. The `seo` block therefore goes out on *every* call, not only when SEO changed. `anexos` is still unverified.
  3. **Only 7 fields are required by `produto.alterar.php`** (per its layout table): `sequencia`, `nome` (≤120), `unidade` (≤3), `preco`, `origem`, `situacao`, `tipo`. `localizacao` and `kit[]` are conditional; everything else is optional. Two traps when echoing: `produto.obter.php` answers `"0"` for an unset `tipo_embalagem` / `id_fornecedor`, but `alterar` only accepts 1/2/3 for the first and a registered supplier for the second (`ZERO_MEANS_UNSET`); and the SEO fields have hard limits (`seo_title` 120, `seo_description`/`seo_keywords` 255) that reject the whole record, so an oversized local value is skipped and reported instead of sent.
  4. **v2 `produto.alterar.php` reports the real reason in `registros[].registro.erros`, not at the top level.** It returns HTTP 200 with `retorno.status = "Erro"`, an empty top-level `erros` and no `codigo_erro`; `tinyV2CallRaw` must collect the per-record errors *before* deciding what to throw, or every failure surfaces as the useless `Tiny v2 status Erro (cod ?)`. `nome` is capped at 120 chars — over that, the title is skipped with an explanatory step instead of failing the whole record.

- Bling ERP (API v3, OAuth2) — mirrors Tiny: `POST/GET /api/bling/oauth/*`, `/api/bling/status`, `/api/bling/disconnect`, `/api/bling/import/*`, `/api/bling/push`, and a single app-level HMAC webhook `POST /api/bling/webhook` (+ `/api/bling/webhook/config`). Server modules: `server/blingAgent.ts`, `server/blingImportWorker.ts`, `server/blingWebhook.ts`; client: `src/services/blingService.ts`, `src/components/integrations/BlingConnector.tsx`. Products tagged `_blingProductId`; deletions set `_blingDeleted: true`.

- IdWorks (REST API, JWT bearer, no OAuth) — mirrors Tiny v2: `POST /api/idworks/connect`, `GET /api/idworks/status`, `DELETE /api/idworks/disconnect`, `POST /api/idworks/import/*`, `POST /api/idworks/push`, and a per-user webhook `POST /api/idworks/webhook/:uid/:secret` (+ `/api/idworks/webhook/config`). Server modules: `server/idworksAgent.ts`, `server/idworksImportWorker.ts`, `server/idworksWebhook.ts`; client: `src/services/idworksService.ts`, `src/components/integrations/IdworksConnector.tsx`. Products tagged `_idworksProductId`; deletions set `_idworksDeleted: true`. IdWorks calls products "SKU". Auth is `POST /user/signin/local` (public) with `{ email, password }` returning a JWT in `token` — the help-site's "POST /auth/token" is not the real path (confirmed against the OpenAPI spec and the `teste` demo account). The webhook envelope (from the `WebhookLogListItem.PostData` schema) carries at minimum `Topic`, `AccountName`, `IDSku`, and a relative detail URL. Both are handled in `server/idworksAgent.ts` (`obtainToken`) and `server/idworksWebhook.ts` (`parseWebhookEnvelope`) (see `docs/superpowers/specs/2026-08-24-idworks-integration-design.md`).

**Frontend** (`src/`): React 19 SPA with Tailwind CSS v4. All state lives in `App.tsx` (very large file). The app is Portuguese (Brazilian) — all UI text, AI prompts, and product field names are in pt-BR.

**Firebase** (`src/firebase.ts`): Used for Google Auth and Firestore persistence. Data is stored under `users/{uid}/products`, `users/{uid}/settings/excel`, and `users/{uid}/categories`. Credits are tracked in `users/{uid}` and debited transactionally per AI operation via `users/{uid}/credit_logs`.

**CRM admin** (`/admin`): internal CRM over the user base. Access is a Firebase Auth custom claim `admin: true`, granted by `npx tsx scripts/set-admin-claim.mjs <email>` (needs a **service account** — user ADC is rejected by the Auth Admin API) and verified server-side on every `/api/admin/*` call. All CRM collections are denied to the client in `firestore.rules`, so the Admin SDK is the only way in.

Three sources feed it, in precedence order: server-emitted events (`recordEvent` from ERP/onboarding/payment paths), a client beacon (`POST /api/events`, allowlisted names — this is where generation events come from, since generation is client-side), and `server/crmReconcile.ts`, which derives the journey from existing `products` / `credit_logs` / `settings` state. That third one is what backfills users who predate the event store, and `credit_logs` is the authoritative signal for the "generated content" milestone.

**WhatsApp automation**: one automation per Kanban stage (`crm_automations/{stage}`, id = the stage), with trigger `entered` or `stagnant` plus a delay. `server/crmAutomation.ts` is the worker; `server/whatsappProvider.ts` isolates the Meta Cloud API; `server/crmAutomationRules.ts` holds the pure send/skip logic (verify with `npx tsx scripts/verify-crm-automation.mjs`). Five non-negotiable guards: idempotency via `create()` on `users/{uid}/crm_messages/{stage}`, per-customer opt-out, a 09h–20h BRT window, a per-run cap, and approved templates only. Needs `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_WABA_ID`; `WHATSAPP_DRY_RUN=true` records sends without calling Meta. Unconfigured, the worker no-ops and the rest of the CRM is unaffected.

State lives denormalized in `users/{uid}.crm` (stage, milestones, counters, health), plus `users/{uid}/events`, `users/{uid}/crm_notes`, `crm_tasks`, `crm_audit`. All business rules (stage resolution, health score, stagnation) live in the pure, I/O-free `server/crmStage.ts` — verify with `npx tsx scripts/verify-crm-stage.mjs`. Server: `server/crm{Stage,Events,Reconcile,Admin}.ts`; client: `src/modules/admin/*`, `src/services/adminService.ts`, `src/types/crm.ts`.

**Agente Operacional** (`modules.operationsAgent === true`): chat que opera a loja/ERP do usuário por linguagem natural. `server/agent/registry.ts` é um registry de ferramentas independente de transporte — hoje vira `functionDeclarations` do Gemini, depois um MCP server (`tools/list`/`tools/call`) sem tocar em nenhuma ferramenta. Ferramentas em `server/agent/tools/{wake,tiny,discovery}.ts` (27: Wake banners/hotsites/produtos/preço/estoque/SEO, Tiny **v2 apenas** produtos/preço/estoque/pedidos/contatos, mais `docs.buscar` e os escape hatches `*.api.chamar` restritos a leitura).

O invariante: **o loop do modelo nunca chama `execute()`**. Uma ferramenta `write` declara `preview()` (que lê o estado atual e monta o diff) e `execute()`; o loop só alcança `preview()`, grava `users/{uid}/agent_actions/{id}` como `pending` e para. Só `server/agent/actions.ts` executa, depois do POST de aprovação, em transação (não dá para executar duas vezes). `registerTool` recusa no boot uma ferramenta de escrita sem `preview`/`execute`. `connections.ts` só expõe ferramentas de plataformas realmente conectadas, então o modelo não consegue chamar uma integração ausente. `AGENT_DRY_RUN=true` monta o payload sem chamar a API. Toda chamada HTTP a Wake/Tiny passa por `withLog` (`server/agent/telemetry.ts`) e vira um doc em `users/{uid}/agent_logs` com requisição, resposta, status e duração — base64 e tokens redigidos —, exposto em `GET /api/agent/logs` e no painel "Logs" do módulo. Isso existe porque as duas APIs falham genericamente: a Wake devolve 422 com "Erro ao inserir banner!" e o motivo real só no corpo; o Tiny embute erro dentro de HTTP 200. Verificar com `npx tsx scripts/verify-agent-tools.mjs` (lógica pura) e `npx tsx scripts/verify-wake-banner-payload.mjs` (trava os campos obrigatórios de POST /banners contra o OpenAPI da Wake; precisa de ADC). Server: `server/agent/*`; client: `src/modules/operations/*`, `src/services/operationsService.ts`, `src/types/agent.ts`. SSRF guards compartilhados em `server/safeUrl.ts` (extraídos de `server.ts`).

**Agente de Conteúdo conversacional**: o mesmo registry acima (`server/agent/registry.ts`) também alimenta um segundo consumidor — `provider: 'content'`, 41 ferramentas (14 leitura, 27 escrita) em `server/agent/tools/{content,contentSeo,contentBlog}.ts`, cascas finas sobre `contentAgent.ts`/`seoAgent.ts` (gestão de conta/geração por IA) ou Firestore direto via Admin SDK (CRUD de clusters/calendário/artigos/projeto/blog nativo — mesmos documentos que `src/services/{content,blog}Service.ts` escrevem do cliente, dando ao agente paridade total com o que a UI faz). `jsonSchemaToZod`/`jsonSchemaPropertyToZod` em `registry.ts` convertem `type: 'object'` recursivamente quando o schema já declara `properties` aninhadas — objeto aberto (`z.record`) faz o Vertex AI recusar a chamada inteira com HTTP 400 (o catálogo inteiro é vinculado de uma vez, então isso quebra qualquer mensagem, não só a ferramenta com o schema ruim). `content.projetos.listar` deixa o modelo resolver nome→ID; `ContentAgentPanel.tsx` também manda o projeto/artigo abertos no workspace a cada mensagem/ação (`WorkspaceContext`, `config.configurable.contexto`), injetado no system prompt em `contentGraph.ts` — o usuário nunca vê nem digita um ID. Orquestrado por um **grafo LangGraph.js** (`server/agent/contentGraph.ts`), rodando como serviço próprio (`Dockerfile.contentAgent`, dev via `npm run dev:content-agent` na porta 8123) — não embutido no processo Express principal. O mesmo invariante de aprovação existe, mas via `interrupt()`/`Command(resume)` do LangGraph em vez de `agent_actions` — persistido por um checkpointer próprio no Firestore (`server/agent/firestoreCheckpointer.ts`, não existe um oficial). Modo automático/sempre-perguntar por ferramenta em `users/{uid}/agent_settings` (`server/agent/agentSettings.ts`); publicar, despublicar e conectar credencial são travas fixas, ignoram o modo automático. Ponte com o app principal em `server/agent/contentAgentChat.ts` — REST + SSE hand-rolado (não CopilotKit: removido por trade-offs de telemetria/estabilidade da v2), no mesmo padrão do Agente Operacional acima: SSE só entrega o "pensando ao vivo" (`delta`/`leitura`/`acao`/`resultado`), e mensagens/ações persistem como docs legíveis em `users/{uid}/content_agent_threads/{id}/messages` e `users/{uid}/content_agent_actions` para o frontend consumir via `onSnapshot`. Frontend em `src/modules/content/chat/*` (`ContentAgentPanel.tsx` é o painel docado que substituiu o `CopilotSidebar`) e `src/services/contentAgentChatService.ts`. Ver `CONTENT_MODULE.md` para o detalhe completo. O Agente Operacional **não foi migrado** para este motor — continua no loop de function-calling próprio acima; as duas superfícies de chat coexistem sem unificação por enquanto.

## Key Data Model

`Product` (`src/types/models.ts`) uses Brazilian e-commerce spreadsheet column names as field keys (e.g., `'Código (SKU)'`, `'Descrição complementar'`). Internal runtime fields are prefixed with `_` (`_id`, `_isDirty`, `_isGenerating`, etc.). Products are stored flat in Firestore; parent/child (variation) relationships use `'Código do pai'` referencing the parent's `'Código (SKU)'`.

`Category` supports hierarchical nesting with `parentId`/`pathIds` and carries `AttributeDefinition[]` that cascade to child categories via `inheritParentAttributes`.

## Frontend Structure

- `src/App.tsx` — monolithic root component (~2700 lines); handles all product CRUD, AI generation flows, cloud sync, auth, export, and most UI
- `src/services/productService.ts` — `generateDescriptionText`, `generateProductAttributes`, `generateAttributesFromImage`, and the `defaultTemplate`
- `src/services/categoryService.ts` — `fetchCategories`, `generateCategoryHierarchy`, `flattenHierarchy`, `getEffectiveAttributes`
- `src/components/categories/CategoryManager.tsx` — full category tree editor
- `src/components/modals/` — `ProductEditModal.tsx` (inline product editing), `CategoryImportModal.tsx` (post-upload category matching)
- `src/components/ImageSearchModal.tsx` — image search and ambient image generation UI

## Export Models

The app exports to two spreadsheet formats:
- **Standard** — preserves the original upload headers, adds/updates generated columns
- **TinyERP** — maps fields to the fixed TinyERP column schema (`TINY_ERP_HEADERS` in `App.tsx`)

Dynamic product attributes (from categories) are appended as extra columns in both formats.
