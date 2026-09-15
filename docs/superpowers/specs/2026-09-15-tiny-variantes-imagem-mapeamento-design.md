# Tiny v2: variantes com título próprio e imagem pelo mapeamento

Data: 2026-09-15

## Contexto e problema

Produtos com variação chegam do Tiny pelo webhook de envio de produtos
(`server/tinyWebhook.ts`) e são gravados como docs flat ligados por
`'Código do pai'` (ver `2026-09-02-variant-grouping-design.md`). Três
problemas confirmados:

1. **A variante fica com a imagem do pai no Tiny.** O único lugar em que a
   API v2 aceita a imagem de uma variação é o mapeamento dela com o
   e-commerce: `produtos[].produto.variacoes[].variacao.mapeamentos[].mapeamento.urlImagem`
   (layout do `produto.alterar.php`). O omni360 nunca envia esse campo:
   - a resposta do webhook devolve só `{ idMapeamento, skuMapeamento }`
     (confirmado nos logs de produção de 2026-09-14);
   - o push manda imagens como `imagens_externas` no `id` da variação, e
     nenhuma chamada leva o cabeçalho `Developer-Id`, sem o qual
     `mapeamentos` é ignorado.

   Além disso, a imagem local da variante costuma ser a do pai:
   `handleSaveImages` (`App.tsx`) copia `_selectedImage`/`_ambientImages` do
   pai para todas as variantes — propagação decidida no spec de 2026-09-02.
2. **O título da variante é o código.** O payload do webhook não traz
   `nome` nas variações (confirmado no exemplo oficial
   `api-docs/files/webhook-produto.json`), e o normalizador preenche
   `nome: v.codigo`.
3. **O push manda texto para o `id` da variação.** Nome, descrição
   complementar e SEO vão num `produto.alterar` com o `id` da variação,
   embora o layout de variação do `alterar` só tenha `id`, `codigo`,
   `preco`, `preco_promocional`, `grade` e `mapeamentos` — esses campos
   pertencem ao pai no Tiny.

Agravante menor: `'Variações'` é gravado pelo webhook como
`"Cor: Azul, Tamanho: P"`, mas a UI e o spec de 2026-09-02 usam `||` como
separador, então a lista mostra um chip só.

## Decisões

- O título da variante é `{nome do pai} - {valores da grade}`, com os
  valores separados por `" / "`, e vale **só no omni360**.
- No envio, a variante leva **só a imagem**, gravada no `urlImagem` do
  mapeamento, sempre pelo payload do **pai**. Título, descrição e SEO de
  variante não são enviados.
- Variante sem imagem própria **fica sem imagem** — não herda a do pai.
- Um único `produto.alterar` por pai, agrupando as variantes do envio
  (abordagem escolhida entre três; as rejeitadas eram uma chamada separada
  só de mapeamento e uma chamada no pai por variante).
- Escopo: API v2 (a única exposta na UI). O caminho v3 não muda.

## Design

### 1. Importação pelo webhook (`server/tinyWebhook.ts`)

- `normalizeWebhookVariacao(v, parent)` recebe o pai normalizado inteiro:
  - `nome`: `${parent.nome} - ${valores}`, com `valores` = `grade[].valor`
    na ordem recebida, unidos por `" / "`. Grade vazia → só `parent.nome`.
    Recalculado a cada webhook (`Descrição` é campo de origem no
    `upsertProduct`, sempre sobrescrito), então acompanha renomeações do
    pai.
  - `variacaoGrade`: `grade[]` como `"Chave: Valor"` unidos por `"||"`.
  - Imagens continuam vindo só de `v.anexos`.

Exemplos: `Cobertor Manta Bebê Colibri Jolitex - Rosa`;
`Cobertor Manta Bebê Colibri Jolitex - Azul / P`.

### 2. Imagens no cliente (`src/App.tsx`, `src/services/tinyVariantImage.ts`)

- `handleSaveImages` deixa de propagar `_selectedImage`/`_ambientImages` do
  pai para as variantes. **Isto reverte a propagação de imagem do spec de
  2026-09-02**: com a imagem da variante indo para o mapeamento no Tiny,
  herdar a do pai grava a imagem errada na variação.
- Nova função pura `urlImagemPropria(produto, pai?)` em
  `src/services/tinyVariantImage.ts`:
  - candidata = `_selectedImage`, senão `'URL imagem 1'`; só vale URL
    `http(s)`;
  - se o produto tem `'Código do pai'` e a candidata é igual à imagem
    principal do pai (mesma regra de candidata), retorna `undefined` —
    trata como herdada. Isso cobre, sem migração, as variantes que já
    receberam a imagem do pai pela propagação antiga.
- `tinyPushPayloadOf` passa a mandar `urlImagem: urlImagemPropria(p, pai)`,
  com o pai achado por `'Código do pai'` → `'Código (SKU)'`. Para produtos
  normais e pais o servidor ignora `urlImagem` (quem decide se é variante é
  o `tipoVariacao` do Tiny, não o campo local).
- `TinyPushProduct` ganha `urlImagem?: string` em `server/tinyAgent.ts` e
  `src/services/tinyService.ts`.

### 3. Envio no servidor (`server/tinyProvider.ts`, `server/tinyV2.ts`)

`POST /api/tiny/push` (v2):

1. `produto.obter` em cada item do lote.
   - `tipoVariacao !== 'V'` (normal ou pai): entra como "texto do pai" no
     grupo do próprio `id`.
   - `tipoVariacao === 'V'`: entra como variante no grupo de
     `idProdutoPai`. `steps.titulo`/`descricao`/`seo` =
     `no Tiny este campo pertence ao produto pai`.
2. Para cada grupo que tem variantes: `produto.obter` do pai **com
   `Developer-Id`**, para receber `variacoes[].variacao.mapeamentos[]`.
   Grupos sem variantes seguem exatamente o caminho de hoje
   (`updateV2Product`), sem `variacoes[]` no payload.
3. Payload do grupo com variantes, montado por funções puras:
   - `buildV2AlterarPayload(paiAtual, textoDoPai)` como hoje. Se o pai não
     foi selecionado, `textoDoPai` é vazio e nada do texto do pai muda.
   - `buildV2VariacoesPayload(paiAtual, variantes)` devolve
     `{ variacoes, stepsPorVariante, enviadoPorVariante }`:
     - `variacoes` lista **todas** as variações de `paiAtual`, cada uma com
       `id`, `codigo`, `preco` e `grade` como o `obter` devolveu;
     - numa variante do lote com `urlImagem` e com mapeamentos existentes,
       `mapeamentos` = cada mapeamento existente com `idEcommerce`,
       `skuMapeamento`, `skuMapeamentoPai` copiados e `urlImagem`
       definido; o log recebe `URL da imagem (mapeamento)` no mesmo ponto;
     - `mapeamentos` nunca é enviado vazio (um array vazio apaga os
       mapeamentos da variação); variante sem o que gravar não leva a
       chave.
4. `produto.alterar` do pai **com `Developer-Id`**, só se houver texto do
   pai alterado ou ao menos um mapeamento a gravar.
5. Um `TinyPushResult` por item de entrada, na ordem recebida. O resultado
   das variantes deriva da chamada do pai.

`steps.imagens` da variante:

| Situação | Step | Escrita |
|---|---|---|
| mapeamento gravado | `ok` | sim |
| sem `urlImagem` | `sem imagem própria` | não |
| variação sem mapeamento no `obter` | `variação ainda não mapeada no Tiny — envie o produto pela integração primeiro` | não |
| `tipoVariacao === 'V'` sem `idProdutoPai` | `o Tiny não informou o produto pai desta variação` (`ok: false`) | não |
| pai com `classe_produto !== 'V'` | `o produto pai não está como "com variações" no Tiny` (`ok: false`) | não |
| `TINY_DEVELOPER_ID` ausente | `Developer-Id do Tiny não configurado` | não |
| `alterar` do pai falhou | mensagem de erro real (`ok: false`) | — |

Sem `TINY_DEVELOPER_ID`, nenhuma variante é escrita — funciona também como
chave para desligar a função. O caminho de texto de produtos normais e pais
não depende dele.

Limitações assumidas:
- O `obter` não devolve o `urlImagem` atual, então não há diff: toda
  variante com imagem própria reenvia o `urlImagem` a cada push.
- Custo por envio: N `obter` + 1 `obter` e 1 `alterar` por pai com
  variantes, dentro do teto atual de 50 itens.

### 4. Configuração

- `tinyV2CallRaw(token, endpoint, params, attempt?, headers?)` aceita
  cabeçalhos extras; `tinyV2Call` repassa.
- `TINY_DEVELOPER_ID` no `.env` local (já ignorado pelo git) e, em
  produção, no Secret Manager como `tiny-developer-id`, declarado em
  `apphosting.yaml` no mesmo padrão de `tiny-client-secret`. O valor nunca
  entra no repositório.
- `.env.example` documenta a variável sem valor.
- `CLAUDE.md` ganha a regra: para variante, o push só grava o `urlImagem`
  do mapeamento, sempre pelo pai com `Developer-Id`, e nunca manda texto
  para o `id` da variação.

## Fora de escopo

- Importação por polling (`produtos.pesquisa` + `produto.obter`), que hoje
  ignora variações e não cria variantes.
- Limpar do Firestore as imagens herdadas já gravadas em variantes (a regra
  de imagem igual à do pai cobre o envio).
- `urlProduto` no mapeamento.
- API v3.
- Enviar `urlImagem` também na resposta do webhook.

## Validação

1. `scripts/verify-tiny-push.mjs`, casos novos sem rede:
   - payload do pai com todas as variações e `mapeamentos` só nas
     variantes do lote;
   - campos do mapeamento existente copiados, `urlImagem` definido;
   - variante sem imagem própria e variante sem mapeamento: sem chave
     `mapeamentos`, step correto;
   - nenhum `mapeamentos: []` em nenhum cenário;
   - texto de variante nunca entra no payload;
   - pai não selecionado: `nome`/`descricao_complementar`/`seo` do pai são
     os do Tiny;
   - sem `Developer-Id`: nenhuma escrita de variante;
   - log e payload concordam (padrão já existente no script);
   - webhook: título com 1 atributo, 2 atributos e grade vazia;
     `Variações` com `||`;
   - `urlImagemPropria`: imagem própria, imagem igual à do pai, URL não
     http(s).
2. `npm run lint` sem erros novos.
3. Teste real no Tiny antes de liberar em produção, com OK explícito do
   usuário (é escrita no ERP). Produto: Cobertor Manta Bebê Colibri Jolitex
   (pai `911205510`), cujas variações já têm mapeamento.
   - Antes e depois do push, leitura com `produto.obter` (com
     `Developer-Id`) do pai e das variações: `codigo`, `preco`, `grade` e
     `mapeamentos` de cada variação; texto, pesos, dimensões e SEO do pai.
   - Responde os dois pontos não documentados: se mandar `variacoes[]`
     completo altera algo nas variações (ex.: preço promocional, que o
     `obter` não devolve) e se `urlProduto` sobrevive quando fica de fora
     do mapeamento.
   - A imagem do mapeamento é conferida visualmente na tela de mapeamentos
     da integração no Tiny, já que o `obter` não devolve `urlImagem`.
