# Integração Tiny v2 — recebimento de produtos via Webhook

**Data:** 2026-07-17
**Objetivo:** Além do polling já existente (v2/v3), permitir que a v2 receba produtos via
**Webhook de envio de produtos** do Tiny (o cliente escolhe, no painel do Tiny, quais produtos
enviar), cadastrando-os no Firestore e respondendo no formato exigido pela API do Tiny.

Docs de referência:
- https://tiny.com.br/api-docs/api2-webhooks-envio-produtos
- Payload: https://tiny.com.br/api-docs/files/webhook-produto.json
- Retorno: https://tiny.com.br/api-docs/files/webhook-produto-retorno.json

## Como o webhook do Tiny funciona (confirmado nos docs)

- Configurado no painel do Tiny (Configurações → E-commerce → Integrações → aba Webhook), o
  usuário cola lá a URL que queremos gerar.
- Disparo: quando o vendedor manda "enviar produtos para o e-commerce" no Tiny. Um POST por
  produto (produto pai já inclui as variações aninhadas em `variacoes[]`).
- Envio é **síncrono**: o Tiny espera a resposta de mapeamento na mesma requisição. Se não vier
  HTTP 200, tenta reenviar — **no máximo 2 tentativas**.
- **Sem autenticação documentada** (sem header/assinatura/IP allowlist) — a proteção do endpoint
  fica por nossa conta.
- Envelope: `{ cnpj, idEcommerce, tipo: 'produto', versao, dados: {...produto...} }`. O arquivo de
  exemplo baixado é só o `dados` (produto completo, com `variacoes`, `arvoreCategoria`, `anexos`,
  `seo`, `kit`).
- Resposta esperada: array **plano** (confirmado no arquivo de exemplo, não um objeto com chave
  `mapeamentos`) de `{ idMapeamento, skuMapeamento, urlProduto?, urlImagem?, error? }`, um item por
  produto/variação recebido, HTTP 200.

## Decisões (aprovadas)

1. **Só v2.** Webhook é um novo modo de sincronização dentro da v2 (`syncMode: 'polling' | 'webhook'`),
   substituindo o polling quando ativado — não se aplica à v3.
2. **Segurança:** endpoint público protegido por **secret na URL** (`/api/tiny/webhook/:uid/:secret`,
   secret aleatório de alta entropia) **+ validação do `cnpj`** do envelope contra o CNPJ cadastrado
   pelo usuário em `settings/tiny`.
3. **idMapeamento = ID do documento Firestore** do produto (criado/atualizado antes de responder),
   não o ID do Tiny — mapeamento real de "nosso registro" por produto/variação.
4. **Reuso do upsert** já usado pelo worker de polling (`server/tinyImportWorker.ts`), exportado para
   ser chamado tanto pelo tick de polling quanto pelo handler do webhook.
5. **`kit[]` fora de escopo** — não há conceito de kit no modelo `Product` hoje.

## Arquitetura

### `server/tinyWebhook.ts` (novo)

- `POST /api/tiny/webhook/:uid/:secret` — **público**, sem `verifyFirebaseToken` (Tiny não manda
  bearer token).
  1. Carrega `settings/tiny` do `uid`; se não existir, `syncMode !== 'webhook'`, ou `secret` não
     bater com `webhookSecret` → **403** (sem tentar seguir o contrato de resposta do Tiny; é erro
     de configuração/tentativa indevida, não erro de dado).
  2. Parseia `{ cnpj, dados }`. Se `cnpj` (apenas dígitos, comparado ao `settings/tiny.cnpj` também
     só dígitos) não bater → **403** também (mesma lógica: proteção, não erro de payload).
  3. Normaliza `dados` → `TinyNormalizedProduct` (pai) e cada `dados.variacoes[]` → um
     `TinyNormalizedProduct` filho (`normalizeWebhookProduct`, novo, em `tinyWebhook.ts`).
  4. Para cada um (pai + filhos), chama `upsertProduct(uid, normalized)` (exportado de
     `tinyImportWorker.ts`); em caso de erro no upsert de um item específico, não aborta os demais —
     registra esse item como `{ idMapeamento: <tinyId>, skuMapeamento, error: msg }` na resposta
     (fallback pro ID do Tiny já que não temos doc Firestore pra esse item).
  5. Atualiza `settings/tiny.webhookStats = { lastReceivedAt: iso(), totalReceived: increment }`.
  6. Responde **200** com o array de mapeamento (pai primeiro, depois cada variação, na ordem
     recebida).
- `POST /api/tiny/webhook/config` — **autenticado**. Body `{ cnpj?, syncMode?, regenerateSecret? }`.
  - Grava `cnpj` (normalizado, só dígitos) e/ou `syncMode` em `settings/tiny`.
  - Se `webhookSecret` ainda não existir, ou `regenerateSecret: true`, gera um novo
    (`crypto.randomBytes(24).toString('hex')`).
  - Retorna `{ webhookUrl, cnpj, syncMode }` — `webhookUrl` montada a partir de
    `req.protocol`/`req.get('host')` + `/api/tiny/webhook/{uid}/{secret}`.
- `GET /api/tiny/status` (rota existente, em `tinyProvider.ts`) passa a incluir, quando v2:
  `syncMode`, `cnpj`, `webhookUrl`, `webhookStats`.

### `server/tinyImportWorker.ts` (ajuste)

- Exportar `upsertProduct` (hoje privada) para ser chamada pelo webhook.
- `sweepAutoSync`/`processJob` continuam existindo para quem estiver em `syncMode: 'polling'`
  (comportamento inalterado) — o worker não sabe nem precisa saber do modo webhook.

### Tipo `TinyNormalizedProduct` (em `tinyAgent.ts`) — extensão

Novos campos **opcionais**, preenchidos só pelo `normalizeWebhookProduct` (v2/v3 seguem deixando
`undefined`, sem regressão):

```
estoque?: number; estoqueMinimo?: number; estoqueMaximo?: number;
localizacao?: string; marca?: string; garantia?: string; sobEncomenda?: string;
cest?: string; diasPreparacao?: number; obs?: string; unidadePorCaixa?: string;
codigoFornecedor?: string; unidade?: string; linkVideo?: string; slug?: string;
codigoPai?: string; variacaoGrade?: string; // usados só para produtos-filho (variações)
```

`upsertProduct` passa a gravar esses campos em `data` quando presentes (mesma lógica
`stripUndefined` de hoje), mapeando para as colunas já existentes no `Product`:

| campo normalizado | coluna |
|---|---|
| `estoque/estoqueMinimo/estoqueMaximo` | `Estoque` / `Estoque mínimo` / `Estoque máximo` |
| `localizacao`, `marca`, `garantia`, `sobEncomenda`, `cest`, `diasPreparacao`, `obs`, `unidadePorCaixa`, `unidade` | colunas de mesmo nome |
| `codigoFornecedor` | `Cód do fornecedor` |
| `linkVideo`, `slug` | `Link do vídeo`, `Slug` |
| `codigoPai` | `Código do pai` (só nos filhos) |
| `variacaoGrade` | `Variações` (texto tipo `"Cor: Azul, Tamanho: P"`, só nos filhos) |

Imagens: `anexos[].url` → `imagens` (mesmo pipeline de hoje, `URL imagem 1..6`).
Categoria: `descricaoArvoreCategoria` (ou `descricaoCategoria` se a árvore vier vazia) → `categorias[0]`.
SEO: `seo.title/description/keywords` → mesmos campos já usados por v2 (`seoTitle` etc.), mas
respeitando a regra existente do worker de só preencher se estiver vazio (preserva enriquecimento
manual/IA já feito).

`kit[]` é ignorado (não mapeado).

## UI (`TinyConnector.tsx`, só quando `status.version === 'v2'` e conectado)

- Toggle **"Modo de sincronização"**: `Polling` (atual) | `Webhook` (novo), chama
  `POST /api/tiny/webhook/config { syncMode }`.
- Em modo **Webhook**:
  - Some o bloco "Importar produtos (em background)" (não faz sentido mais).
  - Mostra painel novo:
    - Campo CNPJ (input mascarado, salvo via `.../config { cnpj }` no blur).
    - URL do webhook (readonly, com botão copiar) + botão "Regenerar" (com confirmação, já que
      invalida a URL configurada no painel do Tiny).
    - Linha de status: `Último recebido: <data> · Total recebido: <N>` (de `webhookStats`), ou
      "Nenhum produto recebido ainda" se `totalReceived` for 0.
  - Bloco "Enviar para Tiny" (push) continua igual, sem mudanças — independe do modo de sync.
- Em modo **Polling**: tela igual à de hoje.

## Erros / observabilidade

- Logs `[tiny-webhook]` para: secret/cnpj inválido (403), payload sem `dados`/`codigo` (400 —
  Tiny não deveria mandar isso, mas defensivo), erro de upsert por item (log + segue pros próximos
  itens do lote), sucesso (uid, quantidade de itens, tempo de processamento).
- Uma falha de upsert em um item **não deve** derrubar a resposta 200 do lote inteiro — cada item é
  independente no array de resposta, seguindo o contrato do Tiny (`error` por item).

## Compatibilidade

- Não quebra v3 nem o fluxo de polling v2 existente — `syncMode` default `'polling'` para contas já
  conectadas (campo ausente = polling).
- `tinyProvider.ts`/`tinyV2.ts`/`tinyAgent.ts` não mudam de comportamento fora da extensão de tipo
  (novos campos opcionais).

## Validação

`npm run lint` limpo + boot do servidor + teste manual: ativar modo webhook, configurar CNPJ, copiar
URL, simular POST com o payload de exemplo (`curl` com o JSON dos docs, incluindo `variacoes`) e
conferir: (a) produto pai e variações aparecem no Firestore/lista de produtos, (b) resposta HTTP 200
no formato correto, (c) secret errado → 403, (d) cnpj errado → 403, (e) alternar de volta pra polling
mantém o worker funcionando.

## Itens a confirmar na implementação

- Se `req.get('host')` reflete corretamente o host público quando atrás de proxy (App Hosting) — se
  não, pode ser necessário `X-Forwarded-Host`/env var de base URL.
- Truncar/validar tamanho do payload recebido (proteção básica contra abuso, já que o endpoint é
  público) — usar o mesmo limite de body do Express já configurado para as outras rotas.
