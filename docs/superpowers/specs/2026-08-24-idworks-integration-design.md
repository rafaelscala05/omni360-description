# Integração IdWorks — Design

**Data:** 2026-08-24
**Status:** Aprovado para plano de implementação (autônomo — sessão com goal ativo)
**Autor:** Rafael + Claude

## Objetivo

Criar uma integração com a **IdWorks** (plataforma de gestão, API REST documentada em
<https://help.idworks.com.br>) no mesmo formato da integração existente com o **Tiny
ERP**: conectar a conta do lojista, importar o catálogo de produtos em background,
**receber produtos via webhook**, e **enviar campos enriquecidos** (descrição / SEO /
fiscal / imagens) de volta à IdWorks via API.

Escopo desta entrega: **paridade com o Tiny** no fluxo de produto (connect + import em
background + webhook + push). Preço, estoque em tempo real, pedidos e clientes ficam
fora do escopo — nenhuma das integrações existentes (Tiny/Bling) escreve preço de volta,
e a IdWorks trata isso como um recurso separado (política comercial), não como campo do
SKU.

## Contexto / referências

- Base da API: `https://{AccountName}.api-idworks.com.br/1.0/` (conta = subdomínio;
  `teste` é a conta de demonstração pública).
- Auth: JWT Bearer obtido via `POST /auth/token`, enviado no header
  `Authorization: Bearer <token>`. **O corpo exato dessa requisição não está
  documentado** nem no OpenAPI nem no Postman collection nem nos artigos de ajuda
  verificados — ver Pendências.
- Rate limit: **5 req/s por endpoint por conta**; `429` com `Retry-After`.
- **"Produto" na IdWorks é "SKU".** Listagem: `GET /sku` (paginação `Page × 500`,
  filtro incremental `SinceDateLastRecordModification`, `IDTypeSku` para filtrar por
  tipo). Detalhe: `GET /sku/{idsku}` → schema `SkuDetail` (96 campos, inclui o bloco
  `Ecommerce*` de SEO/descrição). Atualização: `PUT /sku/{idsku}` com `SkuUpdateBody`
  (66 campos aceitos — **já é nativamente parcial**, só os campos enviados mudam).
  Imagem: `POST /sku/image/{idsku}` com `{ "Url": "..." }` — a IdWorks baixa e
  republica no próprio domínio.
- **Webhook é 100% manual, configurado só na UI da IdWorks** (Configurações →
  Parametrizações → Webhook): uma única URL de callback + um header de autenticação
  (nome e valor livres, escolhidos pelo usuário) por conta. **Não existe endpoint de
  API para configurar isso.** Payload é um envelope fino (tópico + referência do
  recurso, não o produto completo) — timeout de 10s, exige `2xx`, sem HMAC. Tópicos de
  produto citados na doc: `SkuPost` e afins (criação/edição/exclusão de SKU, preço,
  fornecedor, código de barras, variação).
- Spec OpenAPI baixada e analisada offline: `https://help.idworks.com.br/openapi/idworks.json`
  (512 paths, título "idworks API", versão 2026-05-29).
- Integração-espelho existente: `server/tinyAgent.ts`, `server/tinyV2.ts`,
  `server/tinyProvider.ts`, `server/tinyImportWorker.ts`, `server/tinyWebhook.ts`,
  `src/services/tinyService.ts`, `src/components/integrations/TinyConnector.tsx`.

## Diferenças-chave em relação ao Tiny

1. **Sem OAuth e sem v2/v3.** Só existe um modelo de autenticação (JWT via login) —
   portanto **nenhuma camada `provider`/dispatch**: um único `idworksAgent.ts` fala
   direto com a API, como o Tiny v2 sozinho (sem o `tinyProvider.ts`).
2. **Entidade "Produto" = SKU.** `IDTypeSku` distingue: `3` Sku (produto normal), `4`
   Produto (produto-pai com variação), `2` Kit, `1` Clube, `5` Serviço, `6` Matéria-prima,
   `7` Uso e consumo, `8` Caixa. Import cobre `3` e `4` (mesmo recorte que o Tiny faz
   implicitamente). Para uma variação, `SkuDetail.IDProduct`/`ProductName` apontam pro
   SKU pai — equivalente ao `Código do pai` do modelo local.
3. **Webhook é push manual e único por conta**, não OAuth nem HMAC: o lojista cola a
   URL + configura um header de auth no painel IdWorks. O payload não traz o produto
   completo — só `Topic`, `AccountName`, `ModificationTimestamp` e uma referência do
   recurso — então o handler **sempre** busca `GET /sku/{idsku}` depois de receber o
   evento (mesma ideia do envelope fino do Bling, mas sem HMAC).
4. **Autenticidade via secret na URL + header custom**, não HMAC: como a IdWorks só
   garante "eu envio o header que você configurou", replicamos o padrão do Tiny (secret
   embutido na própria URL, `/api/idworks/webhook/:uid/:secret`) como camada primária, e
   oferecemos o header custom como camada opcional adicional.
5. **Sem resposta estruturada obrigatória.** A IdWorks só exige `2xx` em até 10s — não
   espera um array de mapeamento como o Tiny.
6. **`PUT /sku/{idsku}` já é parcial nativamente** — não precisa do padrão do Tiny v2 de
   reenviar campos obrigatórios (unidade/preço/situação) a cada alteração; só os campos
   presentes no corpo são alterados.

## Decisões de produto

- SKU com `IDStatusSku = 0` (Deletado, só aparece se filtrado explicitamente) ou evento
  de exclusão via webhook → marcar `_idworksDeleted: true` no Firestore, preservando o
  enriquecimento local. Nunca excluir o documento (mesma decisão do Bling).
- Import cobre `IDTypeSku` `3` e `4` (produtos e produtos com variação); kits, clube,
  serviço, matéria-prima e uso-e-consumo ficam fora — não são "produto vendável"
  individual no sentido do resto do app.
- Conexão por credenciais coladas manualmente (AccountName + credencial), como o
  formulário estático do Tiny v2 — não um popup OAuth como o Bling, porque a IdWorks
  não tem OAuth.

## Arquitetura

### Server (novos arquivos)

| Arquivo | Espelha | Responsabilidade |
|---|---|---|
| `server/idworksAgent.ts` | `tinyV2.ts` + `tinyAgent.ts` (fundidos, sem dispatch) | Login (`POST /auth/token`, cache do JWT, reautenticação em `401`), `idworksFetch` (Bearer, backoff em `429`/5xx, pace `IDWORKS_PACE_MS`), tipo `IdworksNormalizedProduct`, `normalizeProduct` (de `SkuDetail`), `IdworksPushProduct`/`IdworksPushResult`/`IdworksPushSteps`, `buildSkuUpdateBody`, rota de push, rotas `connect` (valida credenciais)/`status`/`disconnect`. |
| `server/idworksImportWorker.ts` | `tinyImportWorker.ts` | Scheduler em processo (`setInterval(tick)`) + jobs em `idworks_import_jobs`, `upsertProduct` (grava no Firestore com as **mesmas chaves de coluna** do Tiny/Bling), autosync (varredura horária via `SinceDateLastRecordModification`) e cron backstop `POST /api/idworks/cron/tick` (gated por `IDWORKS_CRON_SECRET`). |
| `server/idworksWebhook.ts` | `tinyWebhook.ts` | Rota pública `POST /api/idworks/webhook/:uid/:secret`: valida o secret da URL (+ header custom opcional), parseia o envelope fino, busca `GET /sku/{idsku}`, chama `upsertProduct`, responde `2xx` simples (sem array de mapeamento). Rota autenticada `POST /api/idworks/webhook/config` (gera/rotaciona secret, devolve a URL de callback e um par nome/valor de header sugerido para colar no painel IdWorks). |

Não haverá `idworksProvider.ts` (só um modelo de auth). A rota de push fica em
`idworksAgent.ts`, como no Tiny v2 dentro do provider.

### Frontend (novos arquivos)

- `src/services/idworksService.ts` — wrappers do proxy `/api/idworks/*`, espelhando
  `tinyService.ts`: `idworksStatus`, `idworksConnect(credenciais)`, `idworksDisconnect`,
  `idworksImportStart/Status/Cancel/SetAutosync`, `idworksPush`, `idworksWebhookConfig`.
- `src/components/integrations/IdworksConnector.tsx` — UI espelhando
  `TinyConnector.tsx`: formulário de conexão (AccountName + credencial, sem popup),
  controles de importação + autosync, painel de push (descrição/SEO/fiscal/imagens), e
  bloco de webhook (URL a colar + header sugerido no painel da IdWorks, estatísticas
  `lastReceivedAt`/`totalReceived`).
- Registro em `src/components/integrations/IntegrationsView.tsx` e no card de
  marketing `src/marketing/components/IntegrationsGrid.tsx`.
- `src/assets/integrations/idworks.svg` — logo (placeholder textual simples se não
  houver SVG oficial disponível para uso).

### Wiring em `server.ts`

```ts
import { registerIdworksRoutes } from "./server/idworksAgent";
import { registerIdworksImportRoutes, startIdworksScheduler } from "./server/idworksImportWorker";
import { registerIdworksWebhookRoutes } from "./server/idworksWebhook";
// ...
registerIdworksRoutes(app, { verifyFirebaseToken });
registerIdworksImportRoutes(app, { verifyFirebaseToken });
registerIdworksWebhookRoutes(app, { verifyFirebaseToken });
// ...
startIdworksScheduler();
```

## Modelo de dados (Firestore)

- `users/{uid}/integration_secrets/idworks` — `{ accountName, credentials (forma
  exata a confirmar — ver Pendências), jwt, jwtExpiresAt, updatedAt }`.
- `users/{uid}/settings/idworks` — `{ connected, validated, accountName,
  syncMode: 'polling'|'webhook', webhookSecret, webhookStats: { lastReceivedAt,
  totalReceived }, lastValidatedAt }`.
- `idworks_import_jobs/{uid}` — mesma forma de `tiny_import_jobs`/`bling_import_jobs`
  (`status, mode, offset, total, imported, lease, lastSyncAt, autoSync`).
- `idworks_webhook_events/{key}` — marcador de dedup. Como o envelope do webhook não
  documenta um `eventId` explícito, a chave é um hash de
  `Topic + referência do recurso + ModificationTimestamp` (confirmar formato exato do
  envelope na implementação — ver Pendências).
- Backup por versão: subcoleção `idworks_versions` no doc do produto (espelha
  `tiny_versions`/`bling_versions`).

## Fluxos

### 1. Connect

1. Usuário informa `AccountName` + credencial(is) na UI.
2. Server chama `POST /auth/token` (forma exata do corpo — ver Pendências, item 1),
   obtém o JWT.
3. Valida com uma chamada leve: `GET /sku?Page=0&Simple=1`.
4. Persiste em `integration_secrets/idworks` e marca `connected`/`validated` em
   `settings/idworks`.

### 2. Import em background

Idêntico ao Tiny: o worker pagina `GET /sku` (`Page × 500`, com
`SinceDateLastRecordModification` em modo `update`, filtrando `IDTypeSku=3,4`), busca
o detalhe via `GET /sku/{idsku}` respeitando `IDWORKS_PACE_MS`, e chama
`upsertProduct`. Lease/tick/budget/cron/autosync copiados de `tinyImportWorker.ts`.
`upsertProduct`: campos-fonte sempre atualizam; enriquecidos (descrição/SEO) só
preenchem quando vazios, preservando trabalho local.

### 3. Webhook (recebimento)

1. Usuário cola a URL gerada (`/api/idworks/webhook/{uid}/{secret}`) e o header de
   auth sugerido no painel IdWorks (Configurações → Webhook).
2. IdWorks `POST` no evento (ex.: `SkuPost`).
3. Handler valida o `secret` da URL (+ header custom, se configurado) → `403` se não
   bater.
4. Parseia o envelope fino, extrai a referência do SKU, chama `GET /sku/{idsku}`.
5. **Dedup:** se a chave de evento já existe em `idworks_webhook_events` → `2xx` e
   encerra; senão cria o marcador.
6. Chama `upsertProduct`, atualiza `settings/idworks.webhookStats`, responde `2xx`
   simples (dentro dos 10s de timeout — sem processamento pesado bloqueante, seguindo
   o mesmo cuidado do Bling).

### 4. Push (envio)

Espelha o Tiny: `POST /api/idworks/push` recebe `{ produtos: IdworksPushProduct[] }`;
para cada produto com `idworksId`, faz `GET /sku/{idsku}`, monta o corpo parcial via
`buildSkuUpdateBody` (só os campos dos grupos selecionados que realmente mudaram) e
chama `PUT /sku/{idsku}`; imagens novas vão via `POST /sku/image/{idsku}` com
`{ Url }`. Retorna `IdworksPushResult[]` com o status por grupo, igual ao Tiny.

## Mapeamento de campos

Baseado no `SkuDetail`/`SkuUpdateBody` reais (confirmado via OpenAPI, não é suposição):

| Coluna Firestore | Campo IdWorks |
|---|---|
| `Código (SKU)` | `IDSkuCompany` |
| `Descrição` | `SkuName` |
| `Descrição complementar` | `EcommerceDescription` (+ `EcommerceDescriptionShort` como resumo, sem equivalente direto no Tiny — usado se houver dado local de resumo) |
| `GTIN/EAN` | `BarCode` |
| `NCM (Classificação fiscal)` | `SkuNCM` (+ `SkuNCMExTipi`) |
| `CEST` | `SkuCest` |
| `Peso líquido (Kg)` | `SkuWeightNet` |
| `Peso bruto (Kg)` | `SkuWeight` |
| `Largura embalagem` | `SkuWidth` |
| `Altura Embalagem` | `SkuHeight` |
| `Comprimento embalagem` | `SkuLength` |
| `Marca` | `Brand`/`IDBrand` |
| `Categoria` | `Category`/`CategoryTree`/`IDCategory` |
| SEO título | `EcommerceTitle` |
| SEO descrição | `EcommerceMetaTagDescription` |
| SEO palavras-chave | `EcommerceKeyWords` |
| SEO slug | `EcommerceLinkId` |
| Vídeo | `EcommerceVideoUrl` |
| `URL imagem N` | leitura: `MainImageURL`; escrita: `POST /sku/image/{idsku}` `{ Url }` |

**Preço não é escrito de volta** — `PriceSell`/`PriceList` não fazem parte de
`SkuUpdateBody` (a IdWorks trata preço como recurso de política comercial separado,
fora do escopo de descrição/SEO/fiscal/imagens). Consistente com Tiny/Bling, que também
não escrevem preço.

## Pendências a fechar durante a implementação

Estas três dependem de acesso a uma conta IdWorks real (não temos credenciais nem
suporte da IdWorks disponíveis nesta sessão). A estratégia é **não bloquear o resto da
integração por causa delas**: construir tudo o que já está 100% confirmado via OpenAPI
(`/sku`, `/sku/{id}`, `/sku/image/{id}`) e isolar os pontos incertos atrás de funções
pequenas, fáceis de ajustar assim que houver uma conta de teste real.

1. **Contrato de autenticação — RESOLVIDO (confirmado via OpenAPI + probe empírico).**
   A doc do help-site diz "POST /auth/token", mas esse não é o caminho real (probe
   retorna o erro genérico de API Gateway "Missing Authentication Token"). O contrato
   real está na spec OpenAPI: **`POST /user/signin/local`** é público (sem JWT), corpo
   `{ email, password }` (email = login/e-mail ou CPF/CNPJ, formato auto-detectado; há
   `mfacode`/`expireinhour` opcionais) e retorna `{ success: true, token: JWT, body }`.
   Validado empiricamente contra a conta demo `teste`: corpo vazio → 400
   `[object has missing required properties (["email","password"])]`; credenciais erradas
   → 403 `[Forbidden] - Verificar usuário, senha e subdomínio (url)`. Implementado em
   `obtainToken` (`server/idworksAgent.ts`) com `credentials = { email, password }`.
2. **Formato do payload do webhook — RESOLVIDO via schema `WebhookLogListItem.PostData`.**
   A spec OpenAPI documenta o corpo que a IdWorks envia: `PostData` (JSON serializado)
   inclui **no mínimo `Topic`, `AccountName` e o identificador do recurso (`IDSku`,
   `IDOrder`, etc.), além de uma URL relativa para detalhe**. Isso confirma os campos
   que `parseWebhookEnvelope` (`server/idworksWebhook.ts`) tenta ler (`Topic`, `IDSku`);
   `ModificationTimestamp` aparece na prosa da doc de UI. O dedup usa
   `hash(topic:idSku:modifiedAt)`. Fica a confirmar, se necessário, a URL relativa de
   detalhe (hoje o handler busca `GET /sku/{idsku}` diretamente).
3. **Nomes técnicos completos dos tópicos de produto** — só `SkuPost` é citado
   explicitamente; a lista completa (criação/edição/exclusão/preço/fornecedor/código de
   barras/variação) precisa ser confirmada olhando `GET /webhook` (histórico de
   tentativas) de uma conta real, ou com o suporte da IdWorks.

Como essas três pendências dependem de acesso a uma conta IdWorks real (não temos
credenciais), a implementação vai: (a) construir toda a camada agnóstica a esses
detalhes (import worker, push, Firestore, UI) contra os endpoints já 100% confirmados
via OpenAPI (`/sku`, `/sku/{id}`, `/sku/image`), e (b) isolar os pontos incertos (auth
exchange, parsing do envelope do webhook) atrás de funções pequenas e testáveis, fáceis
de ajustar assim que tivermos uma conta de teste real.

## Variáveis de ambiente novas

- `IDWORKS_PACE_MS` (default respeitando ~5 req/s, ex. 200ms)
- `IDWORKS_CRON_SECRET` (fallback para `CONTENT_CRON_SECRET`)

Documentar em `.env.example` e no `CLAUDE.md` (seção de endpoints/integrações).

## Validação (não há testes automatizados)

- `npm run lint` (tsc `--noEmit`) limpo.
- Dev server: sem uma conta IdWorks real disponível nesta sessão, validar a camada de
  import/push com chamadas construídas manualmente contra os endpoints já confirmados
  (`/sku`, `/sku/{id}`) e um payload de webhook sintético batendo com a prosa da
  documentação. Registrar claramente no `CLAUDE.md`/PR que o fluxo de connect e o
  parsing do webhook precisam de validação final com uma conta real antes de ir para
  produção.

## Fora de escopo

- `/hub/*` — é o hub de marketplace da própria IdWorks (como ela se conecta a
  marketplaces como Mercado Livre/Shopee), não o alvo desta integração.
- Preço, estoque em tempo real fora de produto, pedidos, clientes.
- Agente Operacional (ferramentas do chat) — pode ser expandido depois espelhando
  `server/agent/tools/tiny.ts`, mas não faz parte desta entrega.
