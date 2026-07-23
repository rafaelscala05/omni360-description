# Alfred Content — Tamanho do artigo + melhorias na Revisão/Humanização

Data: 2026-07-23

## Contexto

O pipeline de geração de artigos do Alfred (`server/contentAgent.ts`, `runArticlePipeline`, 5 estágios) tem dois problemas identificados pelo usuário:

1. Vários artigos saem muito longos. Hoje o Stage 3 (Draft) usa uma faixa fixa de 1.200–2.500 palavras para qualquer tema, sem distinção de escopo/profundidade, e o usuário não tem como indicar ou visualizar a intenção de tamanho antes da produção.
2. O Stage 4 (Revisão/Humanização) já remove "construções típicas de IA" de forma genérica, mas na prática deixam passar cabeçalhos genéricos ("Introdução", "Conclusão") e maneirismos característicos de texto gerado por IA (ex.: "não é sobre X, é sobre Y").

Este spec cobre as duas melhorias. As Features 1–3 do spec anterior (`2026-07-22-alfred-article-improvements-design.md` — anti-saudação, regeneração de imagem, autocomplete de produtos) já foram implementadas e não são tocadas aqui.

## Feature A — Tamanho do artigo (Curto / Médio / Longo)

### Modelo de dados

`src/modules/content/types.ts`:

```ts
export type ArticleSize = 'curto' | 'medio' | 'longo';
```

`CalendarArticle.tamanho?: ArticleSize`. Artigos existentes sem o campo são tratados como `'medio'` em toda a aplicação (geração, exibição, pipeline) — sem migração/backfill de dados.

Faixas de palavras associadas (constante nova em `server/contentAgent.ts`, ex. `ARTICLE_SIZE_WORD_RANGES`):

```ts
const ARTICLE_SIZE_WORD_RANGES: Record<ArticleSize, [number, number]> = {
  curto: [600, 900],
  medio: [1200, 1800],
  longo: [2200, 3000],
};
```

### Geração da sugestão de tamanho (Stage "ideias" / `generateCalendar`)

Em `generateCalendar` (`server/contentAgent.ts:481-551`), o prompt que gera os tópicos de artigo por cluster passa a pedir também um campo `tamanho` por tópico:

```
[{"titulo":"...","kwPrincipal":"...","clusterId":"<id do cluster>","tamanho":"curto"|"medio"|"longo"}]
```

Critério a incluir no prompt para a IA decidir o tamanho por tópico:
- **curto**: tema pontual, resposta direta, dica rápida — pouco material a cobrir.
- **medio**: conteúdo explicativo padrão, a maioria dos temas.
- **longo**: guia completo, comparativo, pilar de cluster — temas com muito material/subtemas a cobrir.

`topics` (interface local) ganha o campo `tamanho?: ArticleSize`. Validação: se o valor retornado não for um dos três válidos, usa `'medio'`. No fallback (quando o JSON da IA falha e o código gera um tópico por palavra-chave do cluster, linhas ~515-518), todos os tópicos de fallback recebem `tamanho: 'medio'`.

O `CalendarArticle` criado em `generateCalendar` (linha ~533) grava `tamanho: topic.tamanho ?? 'medio'`.

### Uso no Stage 3 (Draft)

Em `runArticlePipeline` (Stage 3, `server/contentAgent.ts:596-604`), a instrução fixa "1.200 a 2.500 palavras" é substituída pela faixa de `ARTICLE_SIZE_WORD_RANGES[article.tamanho ?? 'medio']`, interpolada no prompt (ex.: `"Escreva o artigo completo em Markdown seguindo o outline abaixo, com {min} a {max} palavras."`).

Nenhuma outra etapa do pipeline (research, outline, revisão, imagem) muda em função do tamanho.

## Feature B — Edição do tamanho pelo usuário

### `ArticlesProductionView.tsx`

Na linha de cada artigo, ao lado do texto `KW: ... · etapa X/5` (linha ~178-179), um seletor segmentado compacto de 3 opções (C / M / L) com tooltip mostrando nome completo + faixa de palavras (ex.: "Longo (2.200–3.000 palavras)"). Ao clicar, chama `updateArticle(uid, projectId, a.id, { tamanho })`, mesmo padrão já usado para reagendamento/título. Disponível em qualquer status do artigo.

### `ArticleView.tsx`

Mesmo seletor segmentado, posicionado junto da linha `KW: ... · data · hora` (linha ~110). Mesma chamada a `updateArticle`.

Quando o artigo já passou do Stage 3 (`article.stage >= 3` ou `articleDraft` já existe), exibir uma nota discreta abaixo do seletor: *"Alterar o tamanho não reprocessa o artigo já gerado — use 'Produzir novamente' para aplicar."* Não há reprocessamento automático: trocar o campo é apenas atualização de metadado; para aplicar em um artigo já produzido, o usuário usa o fluxo existente de reprodução manual.

### `CalendarView.tsx`

Sem mudanças. A grade mensal continua mostrando só título truncado por célula — sem espaço para o seletor.

## Feature C — Revisão/Humanização: remover cabeçalhos genéricos e maneirismos de IA

Mudança restrita a prompts (Stages 2 e 4 de `runArticlePipeline`); sem alteração de schema, endpoint ou UI.

### Stage 2 — Outline (`server/contentAgent.ts:585-593`), defesa primária

Adicionar instrução: os H2/H3 do outline devem ser sempre específicos do conteúdo da seção — proibido usar títulos genéricos como "Introdução", "Conclusão", "Considerações finais" ou "Resumo".

### Stage 4 — Revisão/Humanização (`server/contentAgent.ts:606-619`), rede de segurança

Reforçar a instrução existente ("elimine construções típicas de IA") com uma lista explícita de padrões a detectar e remover/reescrever no texto revisado:

- Cabeçalhos genéricos residuais que tenham escapado do outline: "Introdução", "Conclusão", "Considerações finais", "Resumo" → renomear para algo específico do conteúdo daquela seção (sem remover a seção em si).
- Construções de falso contraste: "Não é sobre X, é sobre Y", "Não se trata apenas de X, mas de Y" (e variações).
- Frases de efeito/clichês de abertura ou transição: "Em um mundo cada vez mais [adjetivo]...", "É importante ressaltar/destacar que...", "Vale a pena mencionar que...", "Em suma/Em resumo" usados como muleta de transição.

Este ajuste é aditivo ao prompt atual do Stage 4 (que já trata da remoção de saudação/auto-apresentação, feature já implementada) — não substitui nada existente.

## Fora de escopo

- Migração automática do campo `tamanho` para artigos já existentes (tratados como `'medio'` implicitamente).
- Reprocessamento automático do rascunho ao trocar o tamanho de um artigo já produzido.
- Seletor de tamanho na grade mensal (`CalendarView.tsx`).
- Qualquer mudança nos Stages 1 (pesquisa) e 5 (imagem) do pipeline.
- Novas categorias de maneirismos além das listadas — a lista pode crescer depois, mas o escopo inicial é o conjunto acima.
