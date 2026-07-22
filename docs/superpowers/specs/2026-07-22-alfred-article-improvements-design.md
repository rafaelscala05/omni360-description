# Alfred Content — Melhorias no gerador de artigos

Data: 2026-07-22

## Contexto

O módulo de Content (`src/modules/content/`) gera artigos via um pipeline de 5 estágios em `server/contentAgent.ts` (`runArticlePipeline`, linhas 557-656), usando a persona "Alfred" definida em `systemFor()` (linha 234-249). Três problemas/gaps foram identificados:

1. Em alguns artigos, o texto gerado abre com uma saudação de auto-apresentação (ex: "Olá! Alfred aqui, pronto para dar um toque a este artigo...") em vez de começar direto pelo conteúdo. Não há instrução explícita no pipeline pedindo isso — é vazamento da persona "Você é Alfred" do system instruction para dentro do texto do artigo.
2. A imagem de capa do artigo é gerada uma única vez, automaticamente, no Stage 5 do pipeline (`saveImage`/`generateImageBase64`, linhas 128-163, 621-641). Não há como regenerá-la depois, nem gerá-la a partir da imagem de um produto vinculado.
3. O campo "Produtos vinculados" (`ArticleView.tsx`, linhas 110-122) é um `<input>` de texto livre, sem ligação real com os produtos cadastrados do usuário (`produtosVinculados?: string[]` em `src/modules/content/types.ts:192`). Não há autocomplete nem validação.

## Feature 1 — Remover saudação/auto-apresentação do texto do artigo

**Arquivo:** `server/contentAgent.ts`

**Mudança:** reforçar os prompts do pipeline com instruções explícitas anti-saudação:

- **Stage 3 (rascunho, linhas ~595-604):** adicionar instrução proibindo qualquer saudação, auto-apresentação da persona ("Alfred aqui", "sou o Alfred", etc.) ou frase de abertura de efeito ("Prepare-se para uma leitura que..."). O texto deve começar diretamente pelo primeiro parágrafo de conteúdo do artigo, sem reintroduzir o título (que já é campo separado).
- **Stage 4 (revisão/humanização, linhas ~606-619):** que já remove "construções típicas de IA" (linha 609), adicionar checagem específica para detectar e remover qualquer saudação/auto-apresentação residual que tenha escapado do Stage 3, como camada de segurança adicional dentro do próprio prompt de revisão (não é pós-processamento por regex — é instrução ao modelo).

Nenhuma mudança de schema, endpoint ou UI é necessária para esta feature.

## Feature 2 — Regenerar imagem do artigo

**Arquivos:** `server/contentAgent.ts`, `src/modules/content/ArticleView.tsx`, `src/services/contentService.ts`

### Backend

Novo endpoint `POST /api/content/articles/:id/regenerate-image`, registrado em `registerContentRoutes` (mesmo padrão dos endpoints em `server/contentAgent.ts:991+`).

Body:
```ts
{
  mode: 'improve' | 'fromProduct';
  improvementPrompt?: string;   // usado quando mode === 'improve'
  baseProductImageUrl?: string; // usado quando mode === 'fromProduct'
}
```

Comportamento:
- `mode: 'improve'`: reaproveita `generateImageBase64` (linhas 128-144) combinando o prompt de imagem padrão do artigo (título + conteúdo + `estiloImagem`, como hoje no Stage 5) com o texto de melhoria informado pelo usuário.
- `mode: 'fromProduct'`: usa `baseProductImageUrl` (a imagem principal do produto vinculado, resolvida no client) como referência/base para a geração via `generateImageBase64`, mantendo o mesmo `estiloImagem` do projeto.
- Em ambos os casos, salva a nova imagem via `saveImage` (linhas 151-163), atualiza `imageUrl` do artigo, e debita crédito com `CREDIT_ACTIONS.contentImage` (mesma tarifa da geração original).

### Frontend

Em `ArticleView.tsx`, abaixo da imagem de capa atual (linha ~106-108), dois botões:

1. **"Gerar novamente"** — expande um campo de texto inline para o usuário digitar um prompt de melhoria; ao confirmar, chama o novo endpoint com `mode: 'improve'`.
2. **"Gerar a partir do produto vinculado"** — habilitado apenas quando há ao menos 1 produto vinculado (ver Feature 3):
   - Se houver exatamente 1 produto vinculado, usa a imagem principal dele diretamente.
   - Se houver mais de 1, mostra um seletor (dropdown simples com nome + thumbnail) para o usuário escolher qual produto usar como base.
   - Chama o endpoint com `mode: 'fromProduct'` e a imagem principal do produto escolhido.

Nova função `regenerateArticleImage(uid, projectId, articleId, payload)` em `contentService.ts`, seguindo o padrão de `produceArticle`/`publishArticle`.

Ambos os botões mostram estado de carregamento e tratam erro (ex: crédito insuficiente) reaproveitando o padrão de `run(...)` já usado no arquivo (`ArticleView.tsx`, função helper `run` usada nos outros campos).

## Feature 3 — Vincular produtos via autocomplete

**Arquivos:** `src/modules/content/types.ts`, `src/modules/content/ArticleView.tsx`, `src/services/contentService.ts`, novo componente `src/modules/content/ProductLinkPicker.tsx`

### Modelo de dados

`produtosVinculados?: string[]` passa a guardar **IDs reais de produto** (`Product._id`, ver `src/types/models.ts:122`), em vez de texto livre. Artigos antigos que já têm nomes/textos livres nesse campo continuam sendo exibidos como texto simples (sem link/thumbnail) até serem re-vinculados manualmente pelo usuário — sem migração automática de dados.

### Busca de produtos

Nova função em `contentService.ts` (ex: `listProductsForLinking(uid): Promise<{ id: string; nome: string; sku: string; imagemPrincipal?: string }[]>`) que lê `users/{uid}/products` diretamente do Firestore (mesmo caminho e padrão usado em `App.tsx:720-721`), retornando os campos mínimos necessários para exibir e linkar (id, nome/`Descrição`, SKU/`Código (SKU)`, imagem principal). Sem novo endpoint de servidor — leitura client-side direta, já que o Firestore já escopa por `uid`.

### UI

Novo componente `ProductLinkPicker.tsx`:
- Campo de busca com autocomplete, filtrando produtos carregados por nome ou SKU (lógica equivalente ao `useMemo` de `filteredProducts` em `App.tsx:822-850`).
- Permite selecionar múltiplos produtos.
- Produtos selecionados aparecem como chips removíveis (nome + pequena thumbnail).

Em `ArticleView.tsx`, o `<input>` de texto livre atual (linhas 110-122) é substituído por esse componente. Ao alterar a seleção, persiste os IDs via `updateArticle` (mesmo padrão do `onBlur` atual).

Os produtos vinculados (nome + thumbnail) também são exibidos na visualização/leitura do artigo (fora do modo de edição), tanto na tela de produção quanto na versão final/publicada, para dar contexto visual de quais produtos aquele artigo referencia.

## Ordem de implementação

Feature 3 deve ser implementada antes (ou junto) da Feature 2, pois a opção "Gerar a partir do produto vinculado" depende dos IDs estruturados e da imagem principal resolvida pela Feature 3. Feature 1 é independente e pode ser feita em qualquer ordem.

## Fora de escopo

- Migração automática de `produtosVinculados` de texto livre para IDs em artigos já existentes.
- Múltiplas imagens/galeria de imagens por artigo (mantém-se uma única `imageUrl`).
- Novo endpoint server-side para busca de produtos (decisão explícita: leitura client-side).
