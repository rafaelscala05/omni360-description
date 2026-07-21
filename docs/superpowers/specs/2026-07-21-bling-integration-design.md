# Integração Bling ERP — Design

**Data:** 2026-07-21
**Status:** Aprovado para plano de implementação
**Autor:** Rafael + Claude

## Objetivo

Criar uma integração com o **Bling ERP** (API v3) no mesmo formato da integração
existente com o **Tiny ERP**: conectar a conta do lojista via OAuth2, importar o
catálogo de produtos em background, **receber produtos via webhooks**, e **enviar
campos enriquecidos** (descrição / SEO / fiscal / imagens) de volta ao Bling via API.

Escopo desta entrega: **paridade total com o Tiny** (connect + import em background +
webhook + push).

## Contexto / referências

- API Bling v3 (base): `https://api.bling.com.br/Api/v3`
- OAuth2 authorize: `https://www.bling.com.br/Api/v3/oauth/authorize`
- OAuth2 token: `https://www.bling.com.br/Api/v3/oauth/token`
  (credenciais no header `Authorization: Basic base64(client_id:client_secret)`;
  **não** no corpo)
- `refresh_token` expira em 30 dias; `authorization_code` expira em 1 minuto.
- Rate limit: ~3 req/s e 120.000 req/dia (respeitado via `BLING_PACE_MS`).
- Webhooks: <https://developer.bling.com.br/webhooks>
- Integração-espelho existente: `server/tinyAgent.ts`, `server/tinyImportWorker.ts`,
  `server/tinyWebhook.ts`, `src/services/tinyService.ts`,
  `src/components/integrations/TinyConnector.tsx`.

## Diferenças-chave em relação ao Tiny

Estas diferenças justificam desvios pontuais em relação ao espelho do Tiny:

1. **Só existe v3 (OAuth2).** Não há equivalente ao token estático v2 do Tiny.
   Portanto **não há camada `provider`/dispatch** — o `blingAgent` fala direto com a v3.
2. **OAuth com Basic auth.** A troca de token usa header
   `Basic base64(client_id:client_secret)`, diferente do Tiny (que envia
   `client_id`/`client_secret` no corpo).
3. **Webhook é nível-aplicativo, não nível-usuário.** O Bling tem **uma única URL
   de callback por aplicativo** (configurada no painel do Bling), compartilhada por
   todos os lojistas que autorizaram o app. Cada evento traz um `companyId`; o
   usuário é identificado por ele — **não** por uma URL secreta por usuário como no
   Tiny. Isso exige um mapa reverso `companyId → uid`, preenchido no connect.
4. **Assinatura HMAC-SHA256.** O Bling assina cada webhook no header
   `X-Bling-Signature-256: sha256=<hex>`, computado sobre o **corpo cru** (raw body)
   usando o `client_secret` do app. Precisa ser validado antes de processar.
5. **Envelope fino.** O webhook manda
   `{ eventId, date, version, event, companyId, data }`. O `data` normalmente traz o
   **id** do produto, não o produto completo — então o handler chama
   `GET /produtos/{id}` para obter os detalhes.
6. **Janela de 5s + idempotência.** O Bling espera resposta `2xx` em até 5s e pode
   reenviar (retries por até 3 dias, sem garantia de ordem). O processamento pesado
   (fetch + upsert) roda **em background** após responder `2xx`, com **dedup por
   `eventId`**.

## Decisões de produto

- **`product.deleted`** → marcar o produto como inativo no Firestore
  (flag `_blingDeleted: true` + `updatedAt`), preservando o enriquecimento local.
  Não excluir o documento.
- O usuário tem acesso ao painel de desenvolvedor do Bling e configurará o app
  (client_id/secret, URL de callback do webhook, escopos/eventos de produto).

## Arquitetura

### Server (novos arquivos)

| Arquivo | Espelha | Responsabilidade |
|---|---|---|
| `server/blingAgent.ts` | `tinyAgent.ts` | OAuth2 (troca com Basic auth, refresh, persistência via Admin SDK), `blingFetch` (Bearer, backoff em 429/5xx, 1 refresh automático em 401), tipo `BlingNormalizedProduct`, `normalizeProduct`, `BlingPushProduct`/`BlingPushResult`, `buildProductPutBody`, **rota de push**, e rotas OAuth `start`/`callback`/`status`/`disconnect`. |
| `server/blingImportWorker.ts` | `tinyImportWorker.ts` | Scheduler em processo (`setInterval(tick)`) + jobs em `bling_import_jobs`, `upsertProduct` (grava no Firestore com **as mesmas chaves de coluna** do Tiny), autosync (varredura horária) e cron backstop `POST /api/bling/cron/tick` (gated por `BLING_CRON_SECRET`). |
| `server/blingWebhook.ts` | `tinyWebhook.ts` | Rota pública **única** `POST /api/bling/webhook` (raw body p/ HMAC): valida `X-Bling-Signature-256`, resolve `uid` pelo `companyId`, responde `2xx`, e processa o evento em background. Rota autenticada `POST /api/bling/webhook/config` (habilita/desabilita syncMode=webhook, retorna a URL de callback e o companyId). |

Não haverá `blingProvider.ts` (sem v2). A rota de push fica em `blingAgent.ts`.

### Frontend (novos arquivos)

- `src/services/blingService.ts` — wrappers do proxy `/api/bling/*`, espelhando
  `tinyService.ts`: `blingStatus`, `blingConnect` (popup OAuth), `blingDisconnect`,
  `blingImportStart/Status/Cancel/SetAutosync`, `blingPush`, `blingWebhookConfig`.
  Tokens nunca vivem no browser.
- `src/components/integrations/BlingConnector.tsx` — UI espelhando
  `TinyConnector.tsx`: conectar/desconectar, controles de importação + autosync,
  painel de push (descrição / SEO / fiscal / imagens), e bloco de webhook que
  **exibe a URL de callback fixa** (para colar no painel do Bling), o `companyId`
  capturado e as estatísticas (`lastReceivedAt`, `totalReceived`).
- Registro em `src/components/integrations/IntegrationsView.tsx` e no card de
  marketing `src/marketing/components/IntegrationsGrid.tsx`.

### Wiring em `server.ts`

```ts
import { registerBlingRoutes } from "./server/blingAgent";
import { registerBlingImportRoutes, startBlingScheduler } from "./server/blingImportWorker";
import { registerBlingWebhookRoutes } from "./server/blingWebhook";
// ...
registerBlingRoutes(app, { verifyFirebaseToken });
registerBlingImportRoutes(app, { verifyFirebaseToken });
registerBlingWebhookRoutes(app, { verifyFirebaseToken });
// ...
startBlingScheduler();
```

> **Atenção ao raw body para HMAC:** a rota do webhook precisa do corpo cru para
> validar a assinatura. Registrar a rota do webhook com um `express.raw({ type: '*/*' })`
> local (ou capturar o raw via `verify` no `express.json` global) **antes** de qualquer
> parser que consuma o corpo. Confirmar na implementação como o `server.ts` monta o
> `express.json()` global (o Tiny contorna isso com `express.json({ type: () => true })`
> na própria rota).

## Modelo de dados (Firestore)

- `users/{uid}/integration_secrets/bling` — `{ accessToken, refreshToken, expiresAt, version: 'v3', updatedAt }`.
- `users/{uid}/settings/bling` — `{ connected, validated, companyId, syncMode: 'polling'|'webhook', lastValidatedAt, webhookStats: { lastReceivedAt, totalReceived } }`.
- `bling_companies/{companyId}` — `{ uid, updatedAt }` (mapa reverso p/ o webhook compartilhado).
- `bling_import_jobs/{uid}` — job de importação (mesma forma do `tiny_import_jobs`:
  `status, mode, offset, total, imported, lease, lastSyncAt, autoSync`).
- `bling_webhook_events/{eventId}` — marcador de dedup/idempotência (TTL opcional),
  gravado antes de processar; se já existir, o evento é ignorado.
- Backup por versão: subcoleção `bling_versions` no doc do produto (espelha `tiny_versions`).

## Fluxos

### 1. Connect (OAuth2 authorization_code)

1. `GET /api/bling/oauth/start` (autenticado) → gera `state` em `oauth_states/{state}`
   (reutiliza a coleção do Tiny) e retorna a URL do authorize com `response_type=code`,
   `client_id`, `redirect_uri`, `scope` (escopos de produto), `state`.
2. `GET /api/bling/oauth/callback` (validado pelo `state`, não por token Firebase) →
   troca o `code` no token endpoint com header `Basic base64(id:secret)` →
   persiste tokens em `integration_secrets/bling`.
3. **Captura do `companyId`:** ler o claim do JWT `access_token` (ou chamar o endpoint
   `/me`-equivalente da v3 — a fonte exata será confirmada na implementação lendo a
   spec OpenAPI) → gravar `settings/bling.companyId` e `bling_companies/{companyId}={uid}`.
4. Marca `connected/validated` e responde com o HTML que fecha o popup
   (`postMessage({ source: 'bling-oauth', ok })`), espelhando o Tiny.

### 2. Import em background

Idêntico ao Tiny: o worker pagina `GET /produtos?pagina=&limite=100` (+ filtro de
data em modo `update`), faz `GET /produtos/{id}` de cada item respeitando `BLING_PACE_MS`,
e chama `upsertProduct`. Lease/tick/budget/cron/autosync copiados de `tinyImportWorker.ts`.
`upsertProduct`: campos-fonte sempre atualizam; enriquecidos (descrição/SEO) só
preenchem quando vazios, preservando trabalho local.

### 3. Webhook (recebimento)

1. Bling `POST /api/bling/webhook` (corpo cru).
2. Valida `X-Bling-Signature-256 = sha256=HMAC_SHA256(rawBody, client_secret)` com
   comparação em tempo constante (`crypto.timingSafeEqual`). Falha → `401`.
3. Parseia o envelope; resolve `uid` via `bling_companies/{companyId}`. Sem mapa → `2xx`
   (ignora silenciosamente; empresa não conectada aqui) e loga.
4. **Dedup:** se `bling_webhook_events/{eventId}` já existe → `2xx` e encerra.
   Senão, cria o marcador.
5. **Responde `2xx` imediatamente** (janela de 5s).
6. Processamento em background (não aguardado na resposta):
   - `product.created` / `product.updated` → `GET /produtos/{id}` → `upsertProduct`.
   - `product.deleted` → marca `_blingDeleted: true` no produto correspondente
     (busca por `_blingProductId == id`).
   - Atualiza `settings/bling.webhookStats`.

### 4. Push (envio)

Espelha o Tiny: `POST /api/bling/push` recebe `{ produtos: BlingPushProduct[] }`;
para cada produto com `blingId`, faz `GET /produtos/{id}`, monta o corpo do `PUT`
via `buildProductPutBody` (preserva os campos atuais e sobrescreve só os grupos
selecionados: `descricao`/`seo`/`fiscal`/`imagens`), e chama `PUT /produtos/{id}`.
Retorna `BlingPushResult[]` com o status por grupo, igual ao Tiny.

## Mapeamento de campos (a confirmar na implementação via OpenAPI)

Chaves de coluna do Firestore (as mesmas do Tiny — ver `upsertProduct` em
`tinyImportWorker.ts`) ↔ campos do produto Bling v3. Mapeamento provável:

| Coluna Firestore | Campo Bling v3 (provável) |
|---|---|
| `Código (SKU)` | `codigo` |
| `Descrição` | `nome` |
| `Descrição complementar` | `descricaoComplementar` |
| `Preço` | `preco` |
| `GTIN/EAN` | `gtin` |
| `NCM (Classificação fiscal)` | `tributacao.ncm` |
| `CEST` | `tributacao.cest` |
| `Peso líquido (Kg)` | `pesoLiquido` |
| `Peso bruto (Kg)` | `pesoBruto` |
| `Largura embalagem` | `dimensoes.largura` |
| `Altura Embalagem` | `dimensoes.altura` |
| `Comprimento embalagem` | `dimensoes.profundidade` |
| `Marca` | `marca` |
| `Categoria` | `categoria` (nome/caminho) |
| `URL imagem N` | `midia.imagens.externas[].link` |

**Pendências a fechar lendo a spec OpenAPI antes/durante a implementação:**

- **SEO:** o Bling v3 não expõe um bloco SEO tão rico quanto o Tiny. Confirmar quais
  campos de SEO (título/descrição/keywords/slug/link de vídeo) existem no produto v3
  e mapear apenas os disponíveis — os inexistentes ficam de fora do push (sem regressão).
- Endpoint/claim exato para o `companyId` no connect.
- Formato exato de paginação (`pagina`/`limite`) e do filtro de data em modo `update`.

## Variáveis de ambiente novas

- `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI`
- `BLING_CRON_SECRET` (fallback para `CONTENT_CRON_SECRET`)
- `BLING_PACE_MS` (default respeitando ~3 req/s)

Documentar em `.env.example` e no `CLAUDE.md` (seção de endpoints/integrações).

## Validação (não há testes automatizados)

- `npm run lint` (tsc `--noEmit`) limpo.
- Dev server: conectar via OAuth; iniciar import e ver produtos no Firestore;
  disparar um webhook de teste **assinado** (created/updated/deleted) e verificar
  upsert/flag; executar um push e verificar o `PUT` no Bling.

## Fora de escopo

- API v2 do Bling (legada) e qualquer camada `provider`/dispatch.
- Sincronização de pedidos, estoque em tempo real fora de produtos, ou outros recursos
  além de `produto`.
