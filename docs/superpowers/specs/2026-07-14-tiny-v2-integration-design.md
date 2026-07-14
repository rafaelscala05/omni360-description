# Integração Tiny ERP — API v2 (token) + seletor de versão v2/v3

**Data:** 2026-07-14
**Objetivo:** Adicionar a integração com a **API v2 do Tiny** (autenticada por **token de
integração estático**, sem OAuth) como alternativa à v3 já existente, deixando o usuário
**escolher qual versão usar** (uma ativa por vez), com **paridade total** (conectar,
importar/sincronizar em background, enviar — incluindo imagens), reaproveitando o worker atual.

## Decisões (aprovadas)

1. **Uma versão ativa por vez.** A versão é definida pelo fluxo de conexão; conectar sobrescreve.
2. **Paridade total** reaproveitando o worker de background via uma camada de provider.
3. **Webhooks depois.** Sincronização por polling: v2 usa `lista.atualizacoes.produtos`, v3 usa `dataAlteracao`.

## API v2 (confirmado nos docs)

- Base `https://api.tiny.com.br/api2/`, **POST** `application/x-www-form-urlencoded` com
  `token`, `formato=json` e params. Resposta `{ retorno: { status: 'OK'|'Erro', codigo_erro,
  erros:[{erro}], pagina, numero_paginas, produtos:[...] } }`.
- Auth: **token estático** gerado pelo usuário na conta Tiny (modelo Wake).
- Endpoints usados:
  - `produtos.pesquisa.php` — lista (params `pesquisa`, `situacao`, `pagina` [100/reg], `gtin`, `dataCriacao`).
  - `produto.obter.php` — detalhe completo por `id` (descrição, seo, imagens externas, ncm, gtin, pesos, dimensões, categoria, preços).
  - `produto.alterar.php` — update. `produto = { produtos:[ { produto: { sequencia, id, nome*,
    descricao_complementar, ncm, gtin, peso_liquido, peso_bruto, altura_embalagem,
    largura_embalagem, comprimento_embalagem, seo:{seo_title, seo_keywords, seo_description,
    slug, link_video}, imagens_externas:[{url}] } } ] }`. **`nome` é obrigatório** → ecoar o atual.
  - `lista.atualizacoes.produtos` — fila de alterados desde `dataAlteracao` (dd/mm/yyyy hh:mm:ss),
    `pagina` 100/reg; registros retornados são marcados como processados.

## Arquitetura — camada de provider

`server/tinyProvider.ts` (novo) despacha por versão ativa do usuário, para worker e rotas
ficarem agnósticos:
- `getActiveVersion(uid): 'v2'|'v3'|null` — lê `settings/tiny.apiVersion`.
- `tinyListPage(uid, { offset, mode, sinceISO }): { items: {id:string}[], total, done }`.
- `tinyGetProduct(uid, id): TinyNormalizedProduct` (mesma forma de hoje).
- `tinyUpdateProduct(uid, id, campos: TinyPushProduct): void`.
- `tinyValidate(uid): boolean` (teste de credencial).

Implementações:
- **v3** — reusa `tinyAgent.ts` (`tinyFetch`, `normalizeProduct`, `buildProductPutBody`, `getValidAccessToken`).
  `buildProductPutBody` passa a ser exportado. Paginação por `offset`/`limit=50`.
- **v2** — `server/tinyV2.ts` (novo):
  - `tinyV2Call(uid, endpoint, params)` — resolve o token (secret v2), POST form, parseia
    `retorno`, lança em `status='Erro'` com `erros`. Backoff em rate limit (mesma ideia do v3).
  - `normalizeV2Product(p)` — mapeia `produto.obter` → `TinyNormalizedProduct`.
  - `updateV2Product(uid, id, campos)` — `produto.obter` p/ pegar `nome`/anexos atuais, monta o
    array `produtos[0].produto` com os campos escolhidos (merge de `imagens_externas` por URL,
    igual v3), POST `produto.alterar.php`.
  - Paginação por `pagina`: o provider converte `offset ↔ pagina` (pageSize 100); modo `update`
    usa `lista.atualizacoes.produtos` com `dataAlteracao` = `sinceISO` formatado dd/mm/yyyy hh:mm:ss.

`TinyNormalizedProduct` e `TinyPushProduct` continuam os tipos comuns (já existem).

## Estado / credenciais

- `users/{uid}/settings/tiny`: `+ apiVersion: 'v2'|'v3'`, `connected`, `validated`, `lastValidatedAt`.
- `users/{uid}/integration_secrets/tiny`: `{ version, ...creds }` — v3 `{accessToken,refreshToken,expiresAt}`;
  v2 `{token}`. Conectar em uma versão sobrescreve a outra (uma ativa).

## Rotas (`registerTinyRoutes` estendido)

- **v2:** `POST /api/tiny/v2/validate` `{token}` → valida via `produtos.pesquisa.php` (1 registro) →
  grava secret `{version:'v2', token}` + `settings.apiVersion='v2'`, `validated=true`.
- **v3:** fluxo OAuth atual (define `apiVersion='v3'` no callback) — inalterado, salvo gravar a versão.
- `GET /api/tiny/status` → passa a retornar `version`.
- `DELETE /api/tiny/disconnect` → limpa secret + status (qualquer versão).
- `POST /api/tiny/push` → passa a chamar `tinyUpdateProduct` (provider) — funciona nas duas versões.
- Worker (`tinyImportWorker.processSlice`) → passa a usar `tinyListPage` + `tinyGetProduct` (provider).
  Import/sync/auto-sync já existentes ficam version-agnostic.

## UI (`TinyConnector.tsx`)

- **Desconectado:** seletor de versão (abas **"v2 — Token"** / **"v3 — OAuth"**).
  - v2 → input de token + "Conectar e validar" (estilo Wake) → `tinyV2Validate(token)`.
  - v3 → botão "Conectar conta Tiny (OAuth)" (atual).
- **Conectado:** badge com a versão ativa + desconectar. Importar (background), auto-sync e envio
  ficam **iguais** (worker/provider resolvem a versão). `status` traz `version` para exibir.

## Imagens no envio

Na v2, `produto.alterar.php` aceita `imagens_externas:[{url}]` → o envio de imagens deve
persistir de fato (validar no teste). Merge com as imagens atuais por URL, como na v3.

## Limpeza / compatibilidade

- Sem quebrar a v3 já em produção: o provider mantém o caminho v3 idêntico.
- O `_tinyProductId` (id do produto no Tiny) é o mesmo conceito nas duas versões — o merge por
  `_tinyProductId` no worker continua valendo.

## Validação

`npm run lint` limpo + boot do servidor + teste manual: conectar v2 por token → importar em
background → enviar (com imagens) → conferir no Tiny. Logs `[tiny]` já instrumentados.

## Itens a confirmar na implementação

- Semântica de fila do `lista.atualizacoes.produtos` (registros marcados como processados) vs.
  re-execução do worker — no modo update, tratar como drenagem de fila (não re-paginar do zero).
- Se `produto.alterar.php` faz merge ou replace dos campos não enviados (ecoar `nome` sempre;
  para imagens, mesclar com as atuais).
