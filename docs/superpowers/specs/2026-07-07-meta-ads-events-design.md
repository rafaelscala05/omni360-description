# Eventos do Meta Ads (Pixel + Conversions API)

## Contexto e objetivo

Hoje o app tracka eventos de produto via Firebase Analytics/GA4 (`src/analytics.ts`), chamado a partir de `App.tsx` e alguns modais (login, sign_up, geração de descrição, compra de créditos, etc.).

O objetivo desta feature é otimizar campanhas de Meta Ads (Facebook/Instagram) usadas para captar usuários/assinantes. Para isso, cada evento hoje enviado ao GA4 deve também ser enviado ao Meta, por dois canais em paralelo:

1. **Meta Pixel** (client-side, via `fbq`) — captura sinais do navegador.
2. **Conversions API — CAPI** (server-side) — mais resiliente a ad blockers/ITP/iOS14 e permite enriquecer o evento com dados do usuário logado (email hasheado) para melhorar o match quality.

Os dois disparos usam o mesmo `event_id` gerado no client, para o Meta deduplicar o evento (não contar 2x).

## Estado atual das credenciais

- Já existe o Pixel ID no Meta Events Manager.
- Ainda **não existe** o Access Token da Conversions API — precisa ser gerado em Events Manager → (Pixel) → Configurações → Conversions API → "Gerar token de acesso". Passo manual do usuário, fora do escopo de código.

## Mapeamento de eventos GA4 → Meta

| Função em `analytics.ts` | Evento GA4 (inalterado) | Evento Meta | Tipo Meta |
|---|---|---|---|
| `trackSignUp` | `sign_up` | `CompleteRegistration` | standard |
| `trackLogin` | `login` | `Login` | custom |
| `trackCreditPurchaseOpen` | `credit_purchase_open` | `InitiateCheckout` | standard |
| `trackCreditPurchased` | `purchase` | `Purchase` (com `value`/`currency`) | standard |
| `trackSpreadsheetImport` | `spreadsheet_import` | `spreadsheet_import` | custom |
| `trackDescriptionGenerated` | `description_generated` | `description_generated` | custom |
| `trackImageGenerated` | `image_generated` | `image_generated` | custom |
| `trackAttributesGenerated` | `attributes_generated` | `attributes_generated` | custom |
| `trackSpreadsheetExport` | `spreadsheet_export` | `spreadsheet_export` | custom |
| `trackTemplateSaved` | `seo_template_saved` | `seo_template_saved` | custom |
| `trackProductEnriched` | `product_enriched` | `product_enriched` | custom |
| `trackCategoryHierarchyGenerated` | `category_hierarchy_generated` | `category_hierarchy_generated` | custom |
| `trackTemplateDownloaded` | `template_downloaded` | `template_downloaded` | custom |

Eventos "standard" usam `fbq('track', nome, params)`; eventos "custom" usam `fbq('trackCustom', nome, params)`. O backend usa o mesmo critério para decidir o campo `event_name` enviado à Graph API (não há diferença estrutural no payload da CAPI entre standard/custom, só a convenção de nome).

## Arquitetura

`src/analytics.ts` permanece o único ponto de chamada nos componentes (`App.tsx`, `CreditPurchaseModal.tsx`, `ImageSearchModal.tsx`, `ProductEditModal.tsx`) — **nenhum call site muda**. Cada função `trackX` existente passa a, internamente, também disparar o evento equivalente no Meta.

### Novo módulo: `src/meta.ts`

```
metaTrack(eventName: string, params?: Record<string, unknown>, isStandard: boolean): void
```

Responsabilidades:
- Gera um `event_id` único (`crypto.randomUUID()`) para essa ocorrência do evento.
- Dispara `window.fbq('track' | 'trackCustom', eventName, params, { eventID })` se `window.fbq` existir (guard, como o `getAnalyticsInstance` atual faz para GA4).
- Lê os cookies `_fbp` e `_fbc` (setados automaticamente pelo Pixel) via `document.cookie`.
- Monta o payload da CAPI: `{ event_name, event_id, custom_data: params, fbp, fbc, user_data: { email? } }`, incluindo o email do usuário logado (Firebase Auth `currentUser.email`) em texto puro — o **hash SHA-256 acontece no backend**, nunca no client, para manter uma única implementação de hashing.
- Faz `fetch('/api/meta/events', { method: 'POST', body: JSON.stringify(payload) })` **fire-and-forget**: não usa `await` no call site, e absorve erros de rede internamente (analytics nunca deve quebrar o fluxo de produto).

`analyticsSetUser(uid)` (chamado no login) passa a também guardar o `uid` em memória no módulo `meta.ts` (ex.: variável de módulo `currentUserEmail`/`currentUid`), para que `metaTrack` tenha acesso ao dado do usuário sem precisar que cada call site passe o email manualmente.

### `index.html`

Adiciona o snippet padrão do Meta Pixel (stub `fbq`) no `<head>`, carregando o Pixel ID a partir de uma variável de ambiente exposta ao client (`import.meta.env.VITE_META_PIXEL_ID`). Como `index.html` é processado pelo Vite, o Pixel ID é injetado via um pequeno script inline que lê `window.__META_PIXEL_ID__` setado no `main.tsx` antes de inicializar o Pixel — ou, mais simples, o próprio `meta.ts` inicializa o Pixel (`fbq('init', pixelId)` + `fbq('track', 'PageView')`) na primeira chamada, usando lazy-init, ao invés de inline script no HTML. Isso evita lidar com interpolação de env em HTML estático e mantém tudo em TS.

Decisão: o snippet base do `fbq` (a function stub que empilha chamadas antes do SDK carregar) vai no `index.html` como hoje se faz com o Chatwoot; a chamada de `fbq('init', ...)` e `fbq('track', 'PageView')` fica em `meta.ts`, disparada uma vez na inicialização do app (chamada a partir de `main.tsx` ou na primeira invocação de `metaTrack`).

### Backend: `POST /api/meta/events` em `server.ts`

- Body: `{ event_name: string, event_id: string, custom_data?: object, user_data?: { email?: string }, fbp?: string, fbc?: string }`.
- Hasheia `email` (lowercase + trim) com SHA-256 (Node `crypto`) antes de enviar — exigência do Meta para PII.
- Preenche `client_ip_address` (via `req.ip` / `x-forwarded-for`) e `client_user_agent` (via header `user-agent`) — exigidos pela Graph API para melhorar a qualidade de match.
- Monta o payload padrão da CAPI:
  ```json
  {
    "data": [{
      "event_name": "...",
      "event_time": <unix seconds>,
      "event_id": "...",
      "action_source": "website",
      "user_data": { "em": ["<sha256>"], "client_ip_address": "...", "client_user_agent": "...", "fbp": "...", "fbc": "..." },
      "custom_data": { ... }
    }],
    "test_event_code": "<opcional, de env>"
  }
  ```
- `POST` para `https://graph.facebook.com/v21.0/{PIXEL_ID}/events?access_token=...` usando `fetch` nativo do Node (já usado em outros pontos do server, ex. Asaas).
- Loga erro e responde `200` mesmo em caso de falha na chamada ao Meta (não propaga erro pro client) — consistente com o princípio de "analytics não derruba o fluxo".
- `PIXEL_ID` e `META_CONVERSIONS_API_TOKEN` vêm de env; se `META_CONVERSIONS_API_TOKEN` não estiver setado, o endpoint responde 200 sem chamar o Meta (permite rodar em dev sem token).

### Novas variáveis de ambiente (`.env.example`)

```
# Meta Ads (Pixel + Conversions API)
VITE_META_PIXEL_ID=            # Pixel ID do Meta Events Manager (público, vai no client)
META_CONVERSIONS_API_TOKEN=    # Access Token da Conversions API (secreto, só no server)
META_TEST_EVENT_CODE=          # Opcional: código de teste do Events Manager (Test Events tool)
```

## Fora de escopo

- Criação do Pixel/Business Manager no Meta (passo manual do usuário).
- Geração do Access Token da CAPI (passo manual do usuário, documentado como pré-requisito).
- Eventos de e-commerce avançados tipo `ViewContent`/`AddToCart` por produto — este app não é uma storefront pública, não há catálogo navegável por visitantes anônimos.
- Testes automatizados (o projeto não tem suíte de testes; validação é manual via Events Manager → Test Events).

## Validação manual

Após implementado, validar no Meta Events Manager (aba "Test Events", usando `META_TEST_EVENT_CODE`):
1. Login → evento `Login` aparece via Pixel e via servidor, com o mesmo `event_id` (badge de dedup).
2. Cadastro → `CompleteRegistration`.
3. Abrir modal de compra de créditos → `InitiateCheckout`.
4. Completar compra → `Purchase` com `value`/`currency` corretos.
5. Um evento custom qualquer (ex. `description_generated`) chega como custom event.
