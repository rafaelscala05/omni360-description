# Meta Conversions API — parâmetros completos por evento

## Contexto e objetivo

A integração com o Meta Pixel + Conversions API (CAPI) já existe e está em produção (`src/meta.ts`, `server/metaEvents.ts`, disparada a partir de `src/analytics.ts`): todo evento de produto vai em paralelo pro Pixel (client) e pra CAPI (server), com o mesmo `event_id` para dedup. Isso foi construído e documentado em `docs/superpowers/specs/2026-07-07-meta-ads-events-design.md`.

O parceiro de marketing do usuário revisou a configuração no Events Manager e pediu parâmetros adicionais por evento, para melhorar a qualidade de match (EMQ) — hoje só enviamos `em` (email), `client_ip_address`, `client_user_agent`, `fbp`, `fbc`. Faltam: `event_source_url`, `fn`/`ln` (nome), `ph` (telefone), `ct` (cidade), `country`, `external_id`, e `content_ids` nos eventos de geração de conteúdo. Este spec cobre só o fechamento desse gap — não a criação da integração, que já existe.

## Dados disponíveis no app

Levantamento feito antes deste design:

- **Nome** — `auth.currentUser.displayName`, populado pelo login Google, disponível em `App.tsx:350` (onde `analyticsSetUser` já é chamado) mas não é repassado hoje.
- **Telefone e cidade** — só existem depois do onboarding (`companyData.telefone`, `companyData.endereco.cidade`), lido em `App.tsx:385`. Não existem antes disso.
- **País** — não existe nenhum campo no app. Decisão: fixar `'br'` sempre (app é 100% Brasil, CNPJ-based), sem depender de coleta.
- **`external_id`** — o `uid` do Firebase Auth já é guardado em `meta.ts` (`currentUid`) mas nunca é enviado.
- **Data de nascimento (`db`)** — não existe em nenhum lugar do app. Fora de escopo: não vamos inventar coleta de um dado sensível só pra preencher esse parâmetro do `CompleteRegistration`.
- **`sku`** — já é passado como parâmetro para `description_generated`, `image_generated` e `attributes_generated` em `src/analytics.ts`, mas nunca vira `content_ids` no payload da CAPI.

Todos os campos de perfil (nome, telefone, cidade) são **best-effort**: se ainda não existirem no momento do evento (ex. evento disparado antes de completar o onboarding), o campo é simplesmente omitido. Isso é consistente com o princípio já estabelecido: analytics nunca derruba o fluxo do produto, e os parâmetros do Meta são "recomendados para melhor match", não obrigatórios.

## Mudanças

### 1. `src/meta.ts` — capturar mais perfil de usuário

- `metaSetUser(uid, email, displayName?)`: novo parâmetro opcional `displayName`. Internamente faz split simples no primeiro espaço → `currentFirstName` / `currentLastName` (module state, ao lado do já existente `currentUid`/`currentEmail`).
  - Chamado a partir de `App.tsx:350`, que já tem `currentUser.displayName` disponível no escopo do `onAuthStateChanged` — só precisa repassar o argumento.
- Nova função exportada `metaSetProfile({ phone, city }: { phone?: string; city?: string })`: guarda `currentPhone`/`currentCity` em module state. Fire-and-forget, sem side effects, sem validação — só armazena o que vier.
  - Chamada a partir de `App.tsx:385`, no ponto onde `companyData` é lido/atualizado, toda vez que essa leitura acontecer (login inicial e qualquer refetch depois de editar o perfil da empresa).
- `country` fixo `'br'`: constante no módulo, sempre incluída em `user_data` de todo evento (não depende de estado nenhum).
- `external_id`: sempre `currentUid` quando houver usuário logado; omitido em eventos disparados sem login (ex. `marketing_cta_click`, `ViewContent` da página de preços — que já rodam sem `metaSetUser` ter sido chamado nessa sessão).

### 2. `src/meta.ts` — payload de `metaTrack`

```ts
interface MetaEventPayload {
  event_name: string;
  event_id: string;
  event_source_url: string; // novo — window.location.href no momento do disparo
  custom_data?: Record<string, unknown>;
  user_data?: {
    email?: string;
    first_name?: string;    // novo
    last_name?: string;     // novo
    phone?: string;         // novo
    city?: string;          // novo
    country?: string;       // novo — sempre 'br'
    external_id?: string;   // novo — uid quando logado
  };
  fbp?: string;
  fbc?: string;
}
```

`content_ids`: `metaTrack` inspeciona `params.sku` (já presente nos `custom_data` de `description_generated`/`image_generated`/`attributes_generated` hoje) e, se existir, promove para `custom_data.content_ids = [sku]` e `custom_data.content_type = 'product'`. Não muda a assinatura de `metaTrack` nem os call sites em `analytics.ts` — é derivado automaticamente a partir do parâmetro que já é passado.

### 3. `src/meta.ts` — PageView também na CAPI

Hoje `metaInit()` só dispara `fbq('track', 'PageView')` no Pixel — nunca chega na CAPI. Vou extrair o corpo de `metaTrack` (montagem do payload + `fetch('/api/meta/events')`) numa função interna reaproveitável, e `metaInit()` passa a chamá-la com o mesmo `event_id` usado na chamada do `fbq`, assim os dois canais deduplicam como qualquer outro evento. Continua disparando uma única vez por carregamento do app (é SPA, sem roteamento por URL) — sem mudança de comportamento, só passa a valer para os dois canais.

### 4. `server/metaEvents.ts` — hashing e payload da Graph API

`MetaEventBody` ganha os campos novos (`event_source_url`, `user_data.first_name/last_name/phone/city/country/external_id`). Regra de hash (SHA-256, lowercase+trim, reaproveitando a função `sha256` que já existe):

| Campo Graph API | Origem | Hash? |
|---|---|---|
| `em` | `user_data.email` | sim (já existe) |
| `fn` | `user_data.first_name` | sim (novo) |
| `ln` | `user_data.last_name` | sim (novo) |
| `ph` | `user_data.phone` (normalizado: só dígitos antes de hashear) | sim (novo) |
| `ct` | `user_data.city` | sim (novo) |
| `country` | `user_data.country` | sim (novo) |
| `external_id` | `user_data.external_id` | sim (novo) |
| `client_ip_address` | IP da request | não (já existe) |
| `client_user_agent` | header `user-agent` | não (já existe) |
| `fbc` / `fbp` | cookies do client | não (já existe) |

`event_source_url` vai direto no evento (fora de `user_data`), sem hash — não é PII.

Cada campo só é incluído no payload da Graph API se o valor correspondente existir no body (mesmo padrão que `em`/`fbp`/`fbc` já seguem hoje — `if (body.x) userData.y = ...`).

### 5. Normalização de telefone

Telefone brasileiro (`companyData.telefone`) pode vir formatado (`(11) 99999-9999`). Antes de hashear no server, remove tudo que não for dígito. Não adiciona `+55` — o Meta aceita variações; como este é um gap best-effort (não crítico) e o volume de eventos com telefone via onboarding é pequeno, formato "só dígitos" é suficiente e evita lógica de DDI mais complexa sem necessidade comprovada.

## Fora de escopo

- Coleta de data de nascimento (`db`) para `CompleteRegistration` — não existe no app, não vamos adicionar coleta só para este parâmetro.
- Qualquer novo evento — este spec só adiciona parâmetros aos eventos que já existem e já disparam hoje.
- `marketing_cta_click` e outros eventos do site público continuam sem `phone`/`city`/`name`/`external_id` quando não há usuário logado — comportamento esperado, não é regressão.
- Testes automatizados — projeto não tem suíte; validação continua manual via Events Manager → Test Events (`META_TEST_EVENT_CODE`).

## Validação manual

No Events Manager, aba "Test Events" (`META_TEST_EVENT_CODE` configurado):

1. Login com Google → evento `Login` chega com `fn`/`ln`/`external_id`/`country` preenchidos (telefone/cidade ausentes se onboarding não completo).
2. Completar onboarding → evento seguinte (ex. `description_generated`) já chega com `ph`/`ct` preenchidos.
3. Gerar descrição/imagem/atributos de um produto → `custom_data.content_ids` contém o SKU do produto.
4. Carregar o app → `PageView` aparece tanto via Pixel quanto via servidor, badge de dedup ativo, com `event_source_url` e `country=br`.
5. Clicar CTA de marketing no site público (deslogado) → evento chega sem `external_id`/`phone`/`city`, sem erro.
