# Integração Wake Commerce — Design

**Data:** 2026-06-23
**Workspace:** Agente de Ecommerce (Alfreds)
**Status:** Aprovado para planejamento

## 1. Objetivo

Criar uma seção **Integrações** no Agente de Ecommerce que permita ao usuário:

1. Conectar a loja Wake Commerce informando **apenas um token**, com validação automática.
2. **Importar** os produtos da loja (dados, informações, categorias, imagens, SEO e metatags).
3. Manter um **backup/versionamento** do estado cru de cada produto vindo da Wake, antes de qualquer enriquecimento — permitindo reverter.
4. **Enviar para a Wake** os dados enriquecidos/editados (descrição, SEO+metatags, atributos e imagens ambientadas) via PUT/POST — disponível **somente após** o token estar validado.

Nesta entrega o foco é **Wake**. O conector **ERP Tiny** aparece apenas como card "Em breve" (desabilitado, sem funcionalidade).

## 2. Contexto da Wake API (api.fbits.net)

- **Base URL:** `https://api.fbits.net`
- **Auth:** header `Authorization` (Basic / API key — valor é o token do usuário). O formato exato (`Basic <token>` vs token puro) é confirmado pelo endpoint de validação.
- **Identificador de produto:** usamos `tipoIdentificador=ProdutoId` (merge por ProductID).
- **Limite de paginação:** `quantidadeRegistros` máx. 50 por página; `pagina` incremental.

### Endpoints de leitura (GET)
| Caminho | Uso |
|---|---|
| `/produtos?pagina&quantidadeRegistros&camposAdicionais` | Lista paginada de produtos |
| `/produtos/{id}` | Produto por identificador |
| `/produtos/{id}/informacoes` | Bloco(s) de informação/descrição (`informacaoId`, `titulo`, `texto`, `tipoInformacao`) |
| `/produtos/{id}/categorias` | Categorias do produto |
| `/produtos/{id}/imagens` | Imagens do produto |
| `/produtos/{id}/seo` | SEO (`title`, `tagCanonical`, `metaTags[]`) |
| `/produtos/{id}/seo/metaTag` | Metatags (`metatagId`, `content`, `name`, `httpEquiv`, `scheme`) |

### Endpoints de escrita (PUT/POST)
| Método | Caminho | Uso |
|---|---|---|
| PUT | `/produtos/{id}` | Atualiza produto (inclui `listaAtributos`) |
| PUT | `/produtos/{id}/informacoes/{informacaoId}` | Atualiza informação (`texto`, `titulo`, `exibirSite`, `tipoInformacao`) |
| POST | `/produtos/{id}/seo` | Insere SEO (`title`, `tagCanonical`, `metaTags[]`) |
| PUT | `/produtos/{id}/seo/...` | Atualiza SEO existente |
| POST | `/produtos/{id}/imagens` | Adiciona imagem (`base64`, `formato` JPG/PNG, `exibirMiniatura`, `estampa`, `ordem`) |

## 3. Arquitetura

### 3.1 Token por usuário + proxy server-side

- O token é **per-usuário** e **sensível**. Salvo write-only em Firestore: `users/{uid}/settings/wake`, campo `token` (cliente escreve, nunca lê de volta — mesmo padrão de `saveWordpressSecret`/`saveSanitySecret`). O documento guarda também metadados não-sensíveis: `validated: boolean`, `connectedAt`, `lastValidatedAt`, `storeLabel?`.
- **Nenhuma chamada à Wake parte do browser.** Todas passam por endpoints `/api/wake/*` no `server.ts`, que:
  1. `verifyFirebaseToken(req)` → `uid` (padrão já usado em `server.ts:22`).
  2. Lê o token do usuário via `adminDb.collection('users').doc(uid).collection('settings').doc('wake')`.
  3. Chama a Wake com o `Authorization` apropriado.

  Isso resolve token-por-usuário, evita CORS e mantém o segredo fora do navegador.

### 3.2 Novo módulo `server/wakeAgent.ts`

Espelha `server/videoAgent.ts`/`server/contentAgent.ts`. Exporta uma função de registro de rotas e um cliente HTTP:

```
fbitsFetch(token, method, path, body?) -> json
```

com:
- timeout, retentativa com backoff exponencial para 429/5xx,
- tratamento de 401/403 (token inválido → marca `validated: false`),
- normalização de erros Wake (`{ resultadoOperacao, codigo, mensagem }`).

### 3.3 Endpoints do proxy

| Rota | Descrição |
|---|---|
| `POST /api/wake/validate` | Recebe `{ token }` do cliente, salva em Firestore, valida via `GET /produtos?quantidadeRegistros=1`. 200 → `validated: true` + `lastValidatedAt`. Retorna `{ valid, message, sample? }`. |
| `GET /api/wake/status` | Retorna estado não-sensível: `{ connected, validated, lastValidatedAt }` (nunca o token). |
| `POST /api/wake/import` | Pagina `GET /produtos`; para cada produto agrega `informacoes`, `categorias`, `imagens`, `seo`, `seo/metaTag`. Retorna lote normalizado (ver §4). Suporta `{ pagina?, quantidadeRegistros? }` para importação incremental/streaming. |
| `POST /api/wake/push` | Recebe `{ produtoIds: string[], fields: { descricao, seo, atributos, imagens } }`. Para cada produto, envia os campos enriquecidos. Retorna relatório por produto. |
| `DELETE /api/wake/disconnect` | Remove token e zera `validated`. |

## 4. Importação, mapeamento e backup

### 4.1 Mapeamento Wake → Product
| Wake | Product (`src/types/models.ts`) |
|---|---|
| `produtoId` | `_wakeProductId` (novo campo interno) |
| `sku` | `Código (SKU)` |
| `nome` | `Descrição` |
| `informacoes[].texto` (tipo Informacoes) | `Descrição complementar` |
| `seo.title` | `Título SEO` |
| `seo.metaTags` (name=description) | `Descrição SEO` |
| `seo.metaTags` (name=keywords) | `Palavras chave SEO` |
| `imagens[].url` | `URL imagem 1..6` |
| `categorias` | `Categoria` + atributos de categoria |
| `precoPor` / `precoDe` | `Preço` / `Preço promocional` |
| `ean` | `GTIN/EAN` |

### 4.2 Merge por ProductID
- Casa com produto existente quando `_wakeProductId === produtoId`. Atualiza o existente.
- Sem correspondência → cria novo `Product` (segue o fluxo de criação atual em `App.tsx`).

### 4.3 Backup / versionamento (antes do enriquecimento)
- A cada importação, **antes** de aplicar enriquecimento, salva snapshot do payload **cru** em subcoleção:
  `users/{uid}/products/{id}/wake_versions/{autoId}` = `{ source: 'wake-import', raw, importedAt: serverTimestamp }`.
- Cada importação adiciona uma nova versão (histórico append-only).
- UI do produto: ação **"Reverter para versão Wake"** que reaplica o snapshot mais recente sobre os campos do produto. Guarda `_wakeVersionId?` referenciando a versão atual.

## 5. Envio para a Wake (push)

Disponível **somente** quando `validated === true`. Botão "Enviar para Wake" fica desabilitado caso contrário.

Para cada produto selecionado **que tenha `_wakeProductId`**, em sequência, com tratamento de erro por-produto (uma falha não aborta o lote):

1. **Descrição** (enriquecida, HTML) → `PUT /produtos/{id}/informacoes/{informacaoId}` com `tipoInformacao=Informacoes`, `texto` = descrição enriquecida. (Se não houver `informacaoId` conhecido da importação, busca via `GET …/informacoes` antes.)
2. **SEO + metatags** → `POST /produtos/{id}/seo` com `title` = `Título SEO`, `metaTags[]` contendo `description` (`Descrição SEO`) e `keywords` (`Palavras chave SEO`).
3. **Atributos** → `PUT /produtos/{id}` com `listaAtributos` derivado dos atributos de categoria do produto.
4. **Imagens (ambientadas)** → `POST /produtos/{id}/imagens` para cada imagem em `_ambientImages` (`base64`, `formato`, `ordem`).

Todas as rotas usam `tipoIdentificador=ProdutoId`.

Retorna relatório por produto: `{ produtoId, sku, steps: { descricao, seo, atributos, imagens }, ok, errors[] }`.

## 6. Frontend

### 6.1 Navegação
- Novo `mainView === 'integrations'`. Item **Integrações** (ícone `Plug` de `lucide-react`) na sidebar **acima** do bloco "Configurações" (`App.tsx:2168-2177`), dentro/abaixo do `<nav>`.

### 6.2 Componentes (novos)
- `src/components/integrations/IntegrationsView.tsx` — layout da seção; renderiza cards Wake e Tiny (Tiny = placeholder "Em breve").
- `src/components/integrations/WakeConnector.tsx` — estados:
  - **Não conectado:** input de token + botão "Conectar e validar".
  - **Conectado/validado:** badge ✓, `lastValidatedAt`, botões "Importar produtos", "Enviar para Wake" (desabilitado se `!validated`), "Desconectar".
  - Barra de progresso em importação/envio; relatório por-produto (sucesso/falha + mensagem).

### 6.3 Serviço cliente
- `src/services/wakeService.ts` — wrappers fetch para `/api/wake/*` enviando o ID token do Firebase no header `Authorization` (padrão já usado pelos demais serviços autenticados).

## 7. Tratamento de erros & UX

- Proxy: retentativa com backoff em 429/5xx; mapeia 401/403 → "token inválido"; normaliza mensagens Wake.
- Rate-limit suave entre páginas na importação (respeita máx. 50 registros/página).
- Importação e envio reportam progresso e resultado por-produto; falhas individuais não abortam o lote.
- Token nunca é retornado ao cliente em nenhuma resposta.

## 8. Arquivos

**Novos**
- `server/wakeAgent.ts` — cliente fbits + rotas `/api/wake/*`.
- `src/services/wakeService.ts` — cliente HTTP do frontend.
- `src/components/integrations/IntegrationsView.tsx`
- `src/components/integrations/WakeConnector.tsx`

**Editar**
- `server.ts` — registrar rotas Wake (passando `verifyFirebaseToken`, `adminDb`).
- `src/App.tsx` — item de sidebar "Integrações"; render da `mainView === 'integrations'`; handlers de import/push; ação "Reverter para versão Wake" no produto.
- `src/types/models.ts` — `_wakeProductId?: string`, `_wakeVersionId?: string`, `_wakeInformacaoId?: number`.
- `firestore.rules` — `users/{uid}/settings/wake` write-only para o segredo `token` + leitura dos metadados; subcoleção `users/{uid}/products/{id}/wake_versions` (read/write do dono).

## 9. Fora de escopo (YAGNI)

- Conector ERP Tiny funcional (apenas placeholder).
- Sincronização automática/agendada (somente ações manuais de import/push nesta entrega).
- Webhooks da Wake.
- Edição de preço/estoque via push (foco em conteúdo: descrição, SEO, atributos, imagens).
