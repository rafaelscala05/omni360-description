# Content App — Criação manual de artigos/clusters + reordenação por prioridade

Data: 2026-07-23

## Contexto

O módulo `src/modules/content/` (Content App) hoje só permite criar **clusters** e
**artigos** via geração por IA:

- Clusters: `ClustersView.tsx` → `generateClusters` (`contentService.ts`) → POST
  `/api/content/projects/:id/generate-clusters` → `server/contentAgent.ts` (usa
  keyword pool do SE Ranking + Gemini).
- Artigos: `ArticlesProductionView.tsx` → `generateCalendar` (`contentService.ts`) →
  POST `/api/content/projects/:id/generate-calendar` → `server/contentAgent.ts`
  (requer ao menos um cluster existente).

A listagem de produção (`ArticlesProductionView.tsx`) ordena artigos apenas por
`scheduledDate` (via `orderBy` no Firestore), sem suporte a priorização manual.

Este spec cobre três funcionalidades novas, todas puramente client-side (sem
custo de crédito/IA):

1. Criar um artigo do zero, sem exigir cluster.
2. Criar um cluster manualmente (sem IA).
3. Reordenar artigos na tela de Produção por drag-and-drop, definindo uma
   prioridade que passa a ditar a ordem da lista.

## Modelo de dados (`src/modules/content/types.ts`)

- `CalendarArticle.clusterId`: passa de `string` (obrigatório) para `string`
  opcional (`clusterId?: string`). Já era tratado como opcional na prática —
  `ClustersView.tsx` já tem uma aba "Sem cluster" para artigos cujo `clusterId`
  não bate com nenhum cluster ativo. Nenhuma outra parte do pipeline de IA lê
  `clusterId` (confirmado em `server/contentAgent.ts` — `runArticlePipeline` só
  usa `titulo`, `kwPrincipal`, `tamanho`).
- `CalendarArticle.priority`: novo campo `number`. Usado para ordenação
  manual/drag-and-drop na tela de Produção. Independente de `scheduledDate`
  (que continua regendo a tela de Calendário).

Nenhuma mudança nas regras do Firestore (`firestore.rules:190-228`) — `clusters`
e `calendar` já permitem `read, write` completo para o dono do projeto.

## Feature 1 — Criar artigo do zero

**UI:** botão "Criar artigo" no header de `ArticlesProductionView.tsx`. Abre um
modal no mesmo estilo do modal de reagendamento já existente no arquivo
(overlay `bg-slate-900/40 backdrop-blur-sm`, card `bg-white rounded-2xl
shadow-xl p-6 w-full max-w-sm`, footer com botão cancelar (slate) + confirmar
(`bg-[#FF5B03]`)).

**Campos:**
- Título (texto)
- Palavra-chave principal (texto)
- Tamanho (reaproveita `ArticleSizePicker.tsx`)
- Data agendada (date input)
- Cluster (select: "Nenhum" + clusters aprovados do projeto)
- Produtos vinculados (reaproveita `ProductLinkPicker.tsx`)

**Persistência:** nova função `createArticleManual(uid, projectId, data)` em
`src/services/contentService.ts`, fazendo `addDoc` direto na coleção
`.../contentProjects/{projectId}/calendar` (mesmo padrão de `updateArticle`/
`moveArticle`, já existentes nesse arquivo). Sem chamada a `/api/content/...` —
não é gerado conteúdo nenhum nesse momento, só a "ficha" do artigo.

Valores gravados:
- `clusterId`: `''` se "Nenhum" foi selecionado.
- `status`/`stage`: mesmo estado inicial (idle) de um artigo recém-criado pelo
  `generateCalendar`, para que as ações existentes na tela de produção/`ArticleView`
  funcionem sem diferenciação de origem.
- `priority`: `min(priority de todos os artigos do projeto) - 1` — o artigo
  criado manualmente entra no topo da lista de produção.
- `createdAt`/`updatedAt`: timestamp atual.

Depois de criado, o artigo se comporta como qualquer outro: aparece na aba
"Sem cluster" (se sem cluster) ou vinculado ao cluster escolhido, e o usuário
aciona normalmente as ações de pipeline (gerar pesquisa, outline, rascunho,
etc.) que já existem em `ArticleView.tsx`.

## Feature 2 — Criar cluster manualmente

**UI:** botão "Criar cluster manualmente" ao lado do botão "Gerar clusters"
(IA) em `ClustersView.tsx`. Abre um formulário inline (não modal), seguindo o
padrão de `src/modules/content/blog/BlogCategories.tsx` (card branco,
`grid grid-cols-1 sm:grid-cols-3 gap-3`, spinner de loading trocando o ícone do
botão de `Plus` para `RefreshCw animate-spin`).

**Campos:** Nome, Estratégia (textarea livre, mesmo propósito do campo
`estrategia` já existente no modelo). Sem palavras-chave nesse formulário —
podem ser adicionadas depois na tela de detalhe do cluster
(`ClusterDetailView.tsx`), que já suporta edição de `palavrasChave`.

**Persistência:** nova função `createClusterManual(uid, projectId, {nome,
estrategia})` em `contentService.ts`, `addDoc` direto em
`.../contentProjects/{projectId}/clusters`. Valores gravados:
- `palavrasChave: []`
- `aprovado: true` (pronto para uso imediato — sem etapa de aprovação, já que
  foi o próprio usuário que definiu o tema)
- `excluido: false`
- `createdAt`: timestamp atual

O cluster aparece imediatamente na grade de `ClustersView.tsx`, usando o mesmo
componente de card dos clusters gerados por IA (sem flag visual de origem
necessária — `aiGenerated`-like distinction não existe hoje no `ContentCluster`
e não é necessária para esta feature).

## Feature 3 — Reordenação por drag-and-drop (prioridade)

**Biblioteca:** `Reorder.Group` / `Reorder.Item`, do pacote `motion` (já é
dependência do projeto — usado em `ClustersView.tsx` via `motion/react`).
Nenhuma dependência nova.

**Mudança de query:** `listenCalendar` (`contentService.ts:274-282`) hoje usa
`orderBy('scheduledDate', 'asc')` no Firestore. Isso é removido — o listener
passa a buscar todos os documentos sem `orderBy`, e a ordenação por
`scheduledDate` (usada pela tela de Calendário) e por `priority` (usada pela
tela de Produção) passa a ser feita no cliente, após o snapshot chegar.
Motivo: o Firestore **exclui da consulta** documentos que não possuem o campo
usado em `orderBy` — como artigos antigos não têm `priority` ainda, uma query
`orderBy('priority')` no servidor os esconderia até serem migrados.

**Migração automática (silenciosa, sem ação do usuário):** em
`ArticlesProductionView.tsx`, no efeito que recebe a lista de
`listenCalendar`: se algum artigo do projeto não tiver `priority` definida,
atribuir sequencialmente (0, 1, 2...) respeitando a ordem atual por
`scheduledDate`, e persistir com um único batch write
(`updateArticlesPriority(uid, projectId, updates)`, nova função em
`contentService.ts`). Executa uma vez por projeto (idempotente — não faz nada
se todos os artigos já tiverem `priority`).

**Interação de arrastar:** cada linha da lista ganha um ícone de arrastar
(`GripVertical`, lucide-react) à esquerda. `Reorder.Group`'s `onReorder`
recebe a nova ordem completa da lista visível e recalcula `priority`
sequencialmente (0..N-1) para todos os itens reordenados, persistindo em um
único batch write via `updateArticlesPriority`.

**Escopo do reorder:** a reordenação acontece dentro da lista atualmente
visível na tela de Produção (respeitando os filtros/abas já existentes, se
houver). A tela de Calendário não é afetada — continua ordenando por
`scheduledDate`.

## Fora de escopo

- Diferenciar visualmente cluster/artigo "manual" vs "gerado por IA" (não foi
  pedido; os modelos de dados não têm esse flag hoje e não é necessário para
  as features descritas).
- Qualquer mudança no pipeline de geração de conteúdo em si
  (`runArticlePipeline`, `server/contentAgent.ts`) — os artigos criados
  manualmente usam exatamente o mesmo pipeline já existente.
- Toggle "ordenar por data vs por prioridade" na tela de Produção (avaliado e
  descartado — prioridade substitui a ordenação por data nessa tela).
