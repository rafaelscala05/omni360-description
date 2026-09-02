# Agrupamento de variantes e geração em grupo/individual

Data: 2026-09-02

## Contexto e problema

Produtos com variação (cor, tamanho etc.) são representados como linhas
flat em `products`, ligadas por `'Código do pai'` (SKU do filho aponta
pro SKU do pai) e `'Variações'` (string `"Atributo: Valor||Atributo:
Valor"` por filho). O runtime field `Product._children` é a única forma
hoje de "agrupar" essas linhas para a UI (expandir/recolher no
catálogo) e para a geração em massa (copy-down de descrição do pai para
os filhos).

Dois problemas confirmados por exploração do código:

1. **`_children` só é populado no import de Excel** (`App.tsx`, trecho
   de merge pós-upload) e **nunca é reconstruído ao carregar da nuvem**
   (`loadFromCloud` empurra os docs do Firestore pro array `products`
   sem recompor a relação pai/filho). Resultado: depois de um reload —
   ou de um import Tiny (que grava cada SKU como doc separado, sem
   `_children`) — os grupos de variantes ficam "soltos": a UI não
   mostra expand, e o copy-down de geração não acontece.
2. **As linhas de filho, quando aparecem (só durante a mesma sessão de
   import Excel), não têm nenhuma ação disponível** — a célula de Ações
   é renderizada vazia. Não há como visualizar, editar atributos/imagens
   ou gerar descrição para uma variante isoladamente hoje.

Não existe hoje nenhuma ação de "gerar para o grupo todo" ou "gerar
individualmente por variante" como ação deliberada do usuário — o que
existe é um efeito colateral automático (gerar no pai copia a descrição
pros filhos), sem UI, sem controle do usuário sobre o modo, sem
funcionar de forma confiável após reload.

## Escopo

Vale para **qualquer produto do catálogo com variantes** (`'Código do
pai'` presente), não só os originados do Tiny — o Tiny é o gatilho da
demanda, mas o bug de agrupamento e a UI de edição/geração em grupo são
do catálogo como um todo.

## Design

### 1. Agrupamento derivado (substitui `_children` como fonte de verdade)

```ts
const childrenByParentSku = useMemo(() => {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const parentSku = p['Código do pai'];
    if (parentSku) {
      if (!map.has(parentSku)) map.set(parentSku, []);
      map.get(parentSku)!.push(p);
    }
  }
  return map;
}, [products]);
```

Todo lugar que hoje lê `product._children` passa a consultar esse mapa
por `product['Código (SKU)']`:

- Tabela desktop e card mobile (`hasChildren`, render das linhas de
  filho, badge de contagem de variantes).
- `startGenerateMass` / `startEnrichMass` / `applyGenerationToProductAndChildren`
  (copy-down pai→filhos).
- `handleSaveImages` (propagação de imagem pro grupo).

`_children` deixa de ser gravado no estado do produto. Ele sobrevive só
como parâmetro transitório passado pra `generateDescriptionText` (que já
sabe ler `product._children` pra montar o placeholder `{Variações
agrupadas das filhas}`) — construído on-the-fly a partir do mapa
derivado no momento da chamada, nunca persistido.

A importação de Excel para de popular `_children` diretamente no objeto
do produto (isso passa a ser puramente derivado); o merge de
parent/child continua gravando `'Código do pai'`/`'Variações'` como já
faz.

### 2. Paridade de ações nas linhas de variante

As linhas de filho (desktop e mobile) ganham os mesmos botões de ação
que a linha pai tem hoje — Visualizar, Atributos, Imagens, Gerar
(individual) — operando sobre aquele SKU específico. Reaproveita os
mesmos handlers já usados pela linha pai (`openPreview`,
`handleGenerateMass`-equivalente para item único via
`startGenerateSingle`, etc.), sem handler novo.

### 3. Barra de ações do grupo

Ao expandir as variantes de um produto pai (`isExpanded &&
hasChildren`), uma mini barra aparece acima das linhas de filho com:

- **"Gerar para o grupo"** — monta `{ ...pai, _children: filhosDoGrupo
  }`, chama `generateDescriptionText` uma vez, aplica o resultado ao pai
  e a cada filho via `buildGeneratedParentPatch`/`buildGeneratedChildPatch`
  (mesma lógica do copy-down atual, hoje automático — agora disparada
  deliberadamente). Debita **1 crédito** (`consumeCredit` uma vez,
  mesma action key `generateSeoMass`/`generateSeoSingle` já usada hoje —
  sem criar uma nova entrada em `CREDIT_ACTIONS`).
- **"Gerar individualmente"** — itera pai + cada filho; para cada SKU,
  chama `generateDescriptionText(sku, categorias, template,
  variantContext)`, onde `variantContext` é um novo parâmetro opcional
  de `generateDescriptionText` populado com `sku['Variações']` daquele
  SKU específico. Quando presente, o texto final do prompt recebe uma
  instrução adicional pedindo pra IA contextualizar aquela variação
  (ex: mencionar "na cor azul"). Sem esse parâmetro, nada muda no
  comportamento hoje existente (compatível com todos os call sites
  atuais). Debita 1 crédito por SKU gerado (mesma action key da geração
  em massa hoje, chamada N vezes — mesmo padrão do loop de
  `startGenerateMass`).

### 4. Erros

- Créditos insuficientes: checagem prévia (`quantidade × custo`) antes
  de iniciar, mesmo padrão de `startGenerateMass`/`startEnrichMass`;
  para no meio se `consumeCredit` retornar `false`.
- Falha de geração num SKU específico no modo individual: não aborta o
  grupo — grava `_generationError` naquele SKU e segue os demais (mesmo
  padrão do loop de massa atual).
- Filho sem `'Variações'` preenchida: entra no grupo normalmente, gera
  sem contexto de variação (comportamento equivalente a hoje).

## Fora de escopo

- Mudar o modelo de dados de variantes (os campos `isParent`/`parentId`/
  `variantAttributes`/`variantValues` já existentes em `Product` mas não
  usados em lugar nenhum do código continuam não usados — não fazem
  parte deste trabalho).
- Editor dedicado de "grupo" fora da tabela do catálogo (decidido:
  barra de ações inline ao expandir, não um modal separado).
- Mudança de preço/custo de créditos por produto — reaproveita as
  action keys e valores já existentes.

## Validação

Sem suíte automatizada (projeto usa validação manual via dev server).
Roteiro: reload da página confirmando grupos continuam expansíveis;
geração de grupo aplica a mesma descrição a pai+filhos com 1 débito;
geração individual gera textos distintos por variação com N débitos;
edição individual de uma variante via os novos botões na linha de
filho; `npm run lint` (tsc --noEmit) sem novos erros.
