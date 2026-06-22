# Design — Ajustes no Módulo de Conteúdo (Alfred)

**Data:** 2026-06-22  
**Branch:** feat/content-agency-module

---

## Escopo

Refinamentos na UI/UX e no modelo de dados do módulo de conteúdo (Alfred). Nenhum endpoint novo de servidor é necessário além de: a IA do `generateCalendar` deve respeitar o campo `scheduledTime` ao distribuir artigos.

---

## 1. Renomeação e nova estrutura de navegação

### Sidebar (`ContentApp.tsx`)

| Entrada atual | Entrada nova | View key |
|---|---|---|
| `Calendário` (ícone CalendarDays) | `Produção de Artigos` (ícone FileText) | `producao` |
| *(novo)* | `Calendário` (ícone CalendarDays) | `calendar` |

O tipo `ContentView` passa a ser:
```ts
type ContentView = 'dashboard' | 'clusters' | 'producao' | 'calendar' | 'integrations' | 'settings';
```

---

## 2. Mudanças no modelo de dados (`types.ts`)

### `CalendarArticle`

Adicionar dois campos opcionais:
```ts
scheduledTime?: string;          // "HH:MM" — hora de publicação (complementa scheduledDate)
produtosVinculados?: string[];   // nomes/IDs de produtos linkados ao artigo
```

O campo `scheduledTime` deve ser respeitado pelo servidor ao gerar/reagendar artigos, e exibido junto à data em toda a UI.

### `ContentProjectConfig`

```ts
estiloImagem?: 'Realista' | 'Ilustracao' | '3D' | 'Cartoon';
```

---

## 3. Página de Produção de Artigos (nova `ArticlesProductionView.tsx`)

A atual `CalendarView.tsx` é renomeada/refatorada para `ArticlesProductionView.tsx`. Responsabilidades:

### Lista de artigos

Cada linha exibe:
- **Data + Hora** — `scheduledDate` + `scheduledTime` (ex.: `24/06 · 09:00`)
- **Título** — editável inline (clique no ícone de lápis → input inline → salva `titulo`)
- **Badge do Cluster** — nome do cluster, clicável → navega para ClusterDetailView
- **Badge de status**
- **Ações:**
  - `Reagendar` (ícone de calendário) → mini-modal com date input + time input → chama `updateArticle(uid, projectId, id, { scheduledDate, scheduledTime })`
  - `Produzir` / `Ver` (já existente)

### Modal "Reagendar"

Componente inline (não nova rota). Campos: data (type="date") + horário (type="time"). Botão confirmar salva ambos.

---

## 4. Nova página de Calendário (`CalendarView.tsx` — refatorada)

Grid mensal simples:
- Cabeçalho com mês/ano + navegação prev/next
- 7 colunas (dom–sáb), células com os artigos do dia como badges clicáveis
- Ao clicar em um artigo → navega para `producao` abrindo `ArticleView` para aquele artigo (via callback `onOpenArticle(articleId)` subindo até `ContentApp`)

Usa apenas os artigos já carregados via `listenCalendar` — sem nova query.

---

## 5. Reordenação do pipeline no `ArticleView.tsx`

**Antes:** Pesquisa → Outline → Rascunho → Imagem → Revisão  
**Depois:** Pesquisa → Outline → Rascunho → Revisão → Imagem

```ts
const STAGES = ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem'];
```

O tipo `ArticleStage = 0 | 1 | 2 | 3 | 4 | 5` não muda (5 etapas + 0 para não iniciado).

A exibição do `imageUrl` e a lógica de aprovação/publicação **não mudam** — apenas a ordem no stepper visual e a ordem de execução no servidor.

**Nota para o servidor (`contentAgent.ts`):** A etapa de imagem (stage 4, agora a última antes do review final) deve receber o `articleDraft`/`articleFinal` como contexto para a geração. O campo `estiloImagem` do `ContentProjectConfig` deve ser incluído no prompt de geração de imagem.

### Campos adicionados em `ArticleView`

- **Produtos vinculados** — TagInput simples, salva `produtosVinculados` via `updateArticle`
- **Editar título** — input inline no header do modal

---

## 6. ClusterDetailView — Artigos Vinculados

Cada artigo na seção "Artigos vinculados" ganha dois botões adicionais:

### Botão Visualizar
- Navega para a view `producao` e abre `ArticleView` para o artigo
- Requer novo callback `onGoArticle(articleId: string)` propagado:
  `ContentApp → ClustersView (prop) → ClusterDetailView (prop)`

### Botão Mover
- Abre mini-modal com lista de clusters ativos do projeto (exceto o atual)
- Ao confirmar → chama `updateArticle(uid, projectId, articleId, { clusterId: novoClusterId })`
- Lista de clusters disponíveis já vem da prop `clusters` ou nova prop `allClusters` passada de `ClustersView`

Props adicionais em `ClusterDetailView`:
```ts
allClusters: ContentCluster[];   // todos os clusters ativos (para modal de mover)
onGoArticle: (id: string) => void;
```

Props adicionais em `ClustersView`:
```ts
onGoArticle: (id: string) => void;
```

---

## 7. Configurações — Estilo de Imagem (`OnboardingWizard.tsx` + `CompanyProfile.tsx`)

No **passo 1 (Identidade)** do wizard, adicionar seleção de estilo visual:

```
Estilo de imagem
[ Realista ] [ Ilustração ] [ 3D ] [ Cartoon ]
```

Persiste em `config.estiloImagem`. Exibido em leitura em `ProfileSummary`.

---

## Fluxo de callbacks de navegação

```
ContentApp
  ├─ onGoArticle(id) → setView('producao') + setOpenArticleId(id)
  │   ↓ passa para ClustersView
  │       ↓ passa para ClusterDetailView
  └─ CalendarView (grid)
      └─ onOpenArticle(id) → mesmo callback acima
```

`ArticlesProductionView` recebe `initialOpenId?: string` e, se presente, abre `ArticleView` para aquele id na montagem.

---

## Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `src/modules/content/types.ts` | + `scheduledTime`, `produtosVinculados`, `estiloImagem` |
| `src/modules/content/ContentApp.tsx` | + view `producao`; + callback `onGoArticle`; sidebar renomeado |
| `src/modules/content/CalendarView.tsx` | Refatorar para grid mensal |
| `src/modules/content/ArticlesProductionView.tsx` | Novo (lógica da antiga CalendarView + melhorias) |
| `src/modules/content/ArticleView.tsx` | Reordem pipeline; + reagendar; + editar título; + produtos vinculados |
| `src/modules/content/ClusterDetailView.tsx` | + botões Mover/Visualizar; novas props |
| `src/modules/content/ClustersView.tsx` | + prop `onGoArticle`; passa `allClusters` para ClusterDetailView |
| `src/modules/content/OnboardingWizard.tsx` | + campo `estiloImagem` no passo 1 |
| `src/modules/content/CompanyProfile.tsx` / `ProfileSummary.tsx` | + exibe `estiloImagem` |
| `server/contentAgent.ts` | Respeita `scheduledTime` no calendário; usa `estiloImagem` no prompt de imagem |

---

## O que NÃO muda

- Lógica de autenticação, créditos e Firebase
- Estrutura do Firestore (campos são opcionais — retrocompatível)
- Endpoints do servidor (exceto lógica interna de `generateCalendar` e geração de imagem)
- `DashboardPanel`, `IntegrationsView`, `TagInput`
