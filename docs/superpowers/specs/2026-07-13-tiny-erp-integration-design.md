# Integração Omni360 ↔ Tiny ERP (API v3) — Produtos

**Data:** 2026-07-13
**Objetivo:** Puxar produtos do Tiny e enviar de volta os campos enriquecidos pela IA (descrição, SEO, dados fiscais/dimensões), espelhando a integração Wake existente.

## Contexto e padrão de referência

A integração espelha a Wake (`server/wakeAgent.ts` + `src/services/wakeService.ts` +
`src/components/integrations/WakeConnector.tsx`): **cliente fino no browser → proxy
server-side**. Tokens nunca vivem no browser; ficam em `users/{uid}/integration_secrets/tiny`
via Admin SDK e nunca retornam ao cliente. Status não-sensível em `users/{uid}/settings/tiny`.

## API do Tiny v3 (confirmado no swagger)

- Base: `https://api.tiny.com.br/public-api/v3`. Auth: `Authorization: Bearer <access_token>`.
- OAuth2 (Keycloak, realm `tiny`):
  - Authorize: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`
  - Token/Refresh: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`
- Rate limit **por conta** (60–240 req/min; ~metade para escrita) → chamadas sequenciais + backoff.
- Endpoints de produto usados:
  - `GET /produtos?limit=&offset=&situacao=A` → `{ itens: ListagemProdutosResponseModel[], paginacao: {limit, offset, total} }`
  - `GET /produtos/{id}` → `ObterProdutoModelResponse`
  - `PUT /produtos/{id}` ← `AtualizarProdutoRequestModel`

### Campos do produto (GET `/produtos/{id}`)
`id`, `sku`, `descricao` (=nome), `descricaoComplementar` (HTML), `ncm`, `gtin`, `situacao`,
`categoria{id,nome,caminhoCompleto}`, `marca{id,nome}`,
`dimensoes{largura,altura,comprimento,diametro,pesoLiquido,pesoBruto}`,
`seo{titulo,descricao,keywords[],slug,linkVideo}`, `precos{preco,precoPromocional,precoCusto}`,
`anexos[{url,externo}]` (imagens — **somente leitura**), `variacoes[]`.

### Campos gravável (PUT `/produtos/{id}` — `AtualizarProdutoRequestModel`)
`sku`, `descricao`, `descricaoComplementar`, `ncm`, `gtin`, `unidade`, `origem`, `garantia`,
`observacoes`, `marca{id}`, `categoria{id}`, `precos{...}`, `dimensoes{...pesoLiquido,pesoBruto...}`,
`seo{titulo,descricao,keywords[],slug,linkVideo}`, `estoque{...}`, `tributacao{...}`, `fornecedores[]`.

> **Restrição de imagens:** a API v3 **não** grava imagens de produto — `AtualizarProdutoRequestModel`
> não tem campo de anexos e não existe endpoint `/produtos/{id}/imagens`. Portanto imagens são
> **import-only**; o envio de imagens fica de fora, com nota explícita na UI.

## Arquitetura

| Camada | Arquivo (novo) | Espelha |
|---|---|---|
| Proxy + OAuth + client HTTP + import/push | `server/tinyAgent.ts` → `registerTinyRoutes(app, deps)` | `server/wakeAgent.ts` |
| Cliente browser | `src/services/tinyService.ts` | `src/services/wakeService.ts` |
| UI de conexão | `src/components/integrations/TinyConnector.tsx` | `WakeConnector.tsx` |
| Fiação server | `server.ts` (`registerTinyRoutes`) + env vars | — |
| Fiação UI | `IntegrationsView.tsx` (substitui placeholder) + `App.tsx` (`handleTinyImport`, `buildTinyPushPayload`) | — |
| Modelo | `src/types/models.ts` (`_tinyProductId`) | `_wakeProductId` |

### OAuth2 (app único publicado)

Credenciais globais em env: `TINY_CLIENT_ID`, `TINY_CLIENT_SECRET`, `TINY_REDIRECT_URI`.

1. `GET /api/tiny/oauth/start` (autenticado Firebase) → gera `state` aleatório, grava
   `oauth_states/{state} = { uid, createdAt }` (TTL curto), devolve a authorize URL
   (`response_type=code`, `scope=openid`, `state`, `redirect_uri`). Browser redireciona.
2. `GET /api/tiny/oauth/callback?code&state` (**não** autenticado; validado pelo `state`→uid):
   troca `code` no token endpoint (grant `authorization_code`), persiste
   `{ accessToken, refreshToken, expiresAt }` em `integration_secrets/tiny`, apaga o `state`,
   e responde com uma página que fecha o popup / redireciona de volta ao app.
3. Refresh automático no `tinyFetch`: se `expiresAt` está a <60s, renova via grant
   `refresh_token` antes da chamada; em resposta 401, renova uma vez e re-tenta;
   se o refresh falhar, marca desconectado.

### Cliente HTTP `tinyFetch(uid, method, path, body?)`
- Resolve/renova token, injeta `Bearer`, backoff exponencial em 429/5xx (respeita `Retry-After`).
- Chamadas sequenciais nos loops de import/push (rate limit por conta).

### Rotas
- `GET  /api/tiny/oauth/start` → `{ url }`
- `GET  /api/tiny/oauth/callback` → HTML de fechamento
- `GET  /api/tiny/status` → `{ connected, validated, lastValidatedAt }`
- `DELETE /api/tiny/disconnect`
- `POST /api/tiny/import` `{ offset, limit }` → `{ offset, limit, total, count, hasMore, produtos: TinyNormalizedProduct[] }`
- `POST /api/tiny/push` `{ produtos: TinyPushProduct[] }` → `{ resultados: TinyPushResult[] }`

### Normalização (import)
`TinyNormalizedProduct`: `tinyId, sku, nome, descricaoHtml, seoTitle, seoDescription,
seoKeywords, ncm, gtin, pesoLiquido, pesoBruto, largura, altura, comprimento, precoPor,
precoDe, categorias[], imagens[], raw`. O `App.tsx` mapeia para as chaves do `Product`
(`'Código (SKU)'`, `'Descrição complementar'`, `'Título SEO'`, `'GTIN/EAN'`, `'NCM'`,
`'Peso líquido (Kg)'`/dimensões conforme existirem, `URL imagem N`) e usa `_tinyProductId`
como chave de merge. Backup append-only em `users/{uid}/products/{id}/tiny_versions`.

### Envio (push)
Por produto, `PUT /produtos/{id}` **atômico**: `GET /produtos/{id}` → ecoa os campos
obrigatórios do atual e sobrescreve os selecionados:
- `descricao` → `descricaoComplementar` (HTML)
- `seo` → `seo{titulo, descricao, keywords[]}`
- `fiscal` → `ncm`, `gtin`, `dimensoes{pesoLiquido, pesoBruto, largura, altura, comprimento}`

Campos possíveis no push: `descricao`, `seo`, `fiscal`. **Sem `imagens`** (limitação da API).
Tratamento de erro por produto com `steps`, igual Wake.

## Segurança
- `client_secret` só no servidor (env). Tokens por-usuário só server-side. `state` anti-CSRF no OAuth.
- `oauth_states` com TTL/limpeza; callback valida `state` antes de qualquer escrita.

## Validação
Sem testes automatizados no repo → validação manual via `npm run dev`. `npm run lint`
(tsc) deve passar. "Testar conexão" faz `GET /produtos?limit=1`.

## Itens a confirmar na implementação
- String exata de `scope` aceita pela authorize URL do Tiny (usar `openid` como base).
- Nome exato do campo de peso/dimensões no export/Product para o mapeamento de import.
