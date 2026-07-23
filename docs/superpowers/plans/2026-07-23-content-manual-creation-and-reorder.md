# Content App: Manual Article/Cluster Creation + Priority Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create a `CalendarArticle` without a cluster, create a `ContentCluster` without AI, and manually reorder the Produção de Artigos list by dragging, persisting a `priority` field.

**Architecture:** Three additive, independent client-side features on top of the existing `src/modules/content/` module. No new server routes — clusters/calendar already permit full client Firestore read/write (`firestore.rules:190-228`). New CRUD helpers land in `src/services/contentService.ts` next to the existing ones (`createClusterManual`, `createArticleManual`, `updateArticlesPriority`); UI additions land in `ClustersView.tsx` (manual cluster form) and `ArticlesProductionView.tsx` (manual article modal + drag reorder), following patterns already established by `BlogCategories.tsx` (inline creation form) and the existing reschedule modal.

**Tech Stack:** React 19 + TypeScript, Firebase Firestore (client SDK), `motion` (already a dependency) for drag-and-drop via `Reorder.Group`/`Reorder.Item`, Tailwind CSS.

## Global Constraints

- This project has no automated test suite (`CLAUDE.md`: "There are no automated tests. The app is validated manually by running the dev server."). Every task below replaces the usual "write failing test" step with `npm run lint` (type-check) plus explicit manual steps to verify in the running app (`npm run dev`).
- Follow existing brand tokens verbatim: primary `#FF5B03` / hover `#E14E00` / tint `#FFF3EC`, `rounded-lg`/`rounded-xl`/`rounded-2xl` cards with `border-slate-200 shadow-sm`, `RefreshCw` icon swapped in for a spinner on any button mid-save (`animate-spin`).
- Firestore rejects fields with value `undefined` in `setDoc`/`addDoc`/`updateDoc` (`db` is `getFirestore()` without `ignoreUndefinedProperties`) — never write an `undefined` field; use `''`/`[]`/omit the key instead.
- No new npm dependencies — drag-and-drop uses `motion` (`^12.23.24`, already in `package.json`), not `@dnd-kit` or `react-beautiful-dnd`.
- Design doc: `docs/superpowers/specs/2026-07-23-content-manual-creation-and-reorder-design.md`.

---

### Task 1: Data model + service-layer CRUD (types + contentService)

**Files:**
- Modify: `src/modules/content/types.ts:189-214` (`CalendarArticle`)
- Modify: `src/services/contentService.ts:1-27` (imports), and append new functions after line 214 (`moveArticle`)

**Interfaces:**
- Produces (used by Tasks 2–4):
  - `CalendarArticle.clusterId?: string` (now optional)
  - `CalendarArticle.priority?: number` (new)
  - `createClusterManual(uid: string, projectId: string, data: { nome: string; estrategia: string }): Promise<string>`
  - `createArticleManual(uid: string, projectId: string, data: ManualArticleInput): Promise<string>` where
    `interface ManualArticleInput { titulo: string; kwPrincipal: string; tamanho: ArticleSize; scheduledDate: string; clusterId: string; produtosVinculados: string[]; priority: number; }`
  - `updateArticlesPriority(uid: string, projectId: string, updates: { id: string; priority: number }[]): Promise<void>`

- [ ] **Step 1: Update the `CalendarArticle` type**

In `src/modules/content/types.ts`, replace lines 189-197:

```ts
export interface CalendarArticle {
  id: string;
  titulo: string;
  kwPrincipal: string;
  clusterId: string;
  scheduledDate: string; // ISO date (YYYY-MM-DD)
  scheduledTime?: string;        // "HH:MM" — hora de publicação
  produtosVinculados?: string[]; // IDs de Product._id vinculados (artigos antigos podem ter texto livre até serem re-vinculados)
  tamanho?: ArticleSize;
```

with:

```ts
export interface CalendarArticle {
  id: string;
  titulo: string;
  kwPrincipal: string;
  clusterId?: string; // opcional: artigos criados sem cluster ficam na aba "Sem cluster"
  scheduledDate: string; // ISO date (YYYY-MM-DD)
  scheduledTime?: string;        // "HH:MM" — hora de publicação
  produtosVinculados?: string[]; // IDs de Product._id vinculados (artigos antigos podem ter texto livre até serem re-vinculados)
  tamanho?: ArticleSize;
  // Ordem manual (drag-and-drop) na tela de Produção. Independente de
  // scheduledDate (que segue regendo a tela de Calendário). Artigos
  // anteriores a esta feature não têm o campo até serem migrados (ver
  // ArticlesProductionView.tsx).
  priority?: number;
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: same 5 pre-existing errors as before this change (`src/App.tsx:657`, `src/App.tsx:1404`, `ProductEditModal.tsx:313,425,462`), and no new error about `clusterId` — because every read site already treats it as possibly falsy (`ClustersView.tsx`'s `activeIds.has(a.clusterId)`, `ArticlesProductionView.tsx`'s `clusterName(a.clusterId)`) or is a plain string comparison that TypeScript accepts against `string | undefined`.

- [ ] **Step 3: Add `writeBatch` to the Firestore import in contentService.ts**

In `src/services/contentService.ts`, replace lines 7-19:

```ts
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
} from 'firebase/firestore';
```

with:

```ts
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
```

- [ ] **Step 4: Add `ArticleSize` to the type-only import**

In `src/services/contentService.ts`, replace lines 21-27:

```ts
import type {
  ContentProject,
  ContentProjectConfig,
  ContentCluster,
  CalendarArticle,
  SeoAudit,
} from '../modules/content/types';
```

with:

```ts
import type {
  ContentProject,
  ContentProjectConfig,
  ContentCluster,
  CalendarArticle,
  ArticleSize,
  SeoAudit,
} from '../modules/content/types';
```

- [ ] **Step 5: Add `createClusterManual`, `createArticleManual`, `updateArticlesPriority`**

In `src/services/contentService.ts`, insert immediately after `moveArticle` (currently ends at line 214, right before the `// ---... Product linking ...` comment block):

```ts
// Manual (non-AI) cluster creation. Entra pronto para uso (aprovado=true) já
// que o próprio usuário definiu o tema — sem etapa de aprovação como os
// clusters gerados por IA. Palavras-chave podem ser adicionadas depois em
// ClusterDetailView.
export async function createClusterManual(
  uid: string,
  projectId: string,
  data: { nome: string; estrategia: string },
): Promise<string> {
  const ref = await addDoc(collection(db, `users/${uid}/contentProjects/${projectId}/clusters`), {
    nome: data.nome,
    estrategia: data.estrategia,
    palavrasChave: [],
    aprovado: true,
    excluido: false,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export interface ManualArticleInput {
  titulo: string;
  kwPrincipal: string;
  tamanho: ArticleSize;
  scheduledDate: string;
  clusterId: string; // '' quando criado sem cluster
  produtosVinculados: string[];
  priority: number;
}

// Cria só a "ficha" do artigo (sem disparar o pipeline de IA) — status/stage
// iniciais idênticos a um artigo recém-gerado pelo calendário, para que as
// ações já existentes em ArticleView (gerar pesquisa, outline, etc.)
// funcionem sem diferenciação de origem.
export async function createArticleManual(
  uid: string,
  projectId: string,
  data: ManualArticleInput,
): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, `users/${uid}/contentProjects/${projectId}/calendar`), {
    titulo: data.titulo,
    kwPrincipal: data.kwPrincipal,
    clusterId: data.clusterId,
    scheduledDate: data.scheduledDate,
    tamanho: data.tamanho,
    produtosVinculados: data.produtosVinculados,
    status: 'agendado',
    stage: 0,
    priority: data.priority,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

// Persists new priority values after a drag-and-drop reorder (or the
// one-time migration that backfills missing priorities). Chunked at 20
// writes per batch, same convention as App.tsx's saveToCloud.
export async function updateArticlesPriority(
  uid: string,
  projectId: string,
  updates: { id: string; priority: number }[],
): Promise<void> {
  let batch = writeBatch(db);
  let opCount = 0;
  for (const { id, priority } of updates) {
    batch.update(doc(db, `users/${uid}/contentProjects/${projectId}/calendar/${id}`), {
      priority,
      updatedAt: new Date().toISOString(),
    });
    opCount++;
    if (opCount >= 20) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
}
```

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: same 5 pre-existing errors only, no new ones.

- [ ] **Step 7: Commit**

```bash
git add src/modules/content/types.ts src/services/contentService.ts
git commit -m "$(cat <<'EOF'
feat(content): campos e CRUD para criação manual de artigo/cluster e prioridade

Adiciona clusterId opcional e priority a CalendarArticle, e as funções
createClusterManual/createArticleManual/updateArticlesPriority em
contentService.ts — base para as próximas features de UI.
EOF
)"
```

---

### Task 2: Manual cluster creation UI (`ClustersView.tsx`)

**Files:**
- Modify: `src/modules/content/ClustersView.tsx`

**Interfaces:**
- Consumes: `createClusterManual(uid, projectId, { nome, estrategia }): Promise<string>` (Task 1)
- Produces: nothing new consumed by later tasks (self-contained UI feature)

- [ ] **Step 1: Add the `Plus` icon and `createClusterManual` import**

In `src/modules/content/ClustersView.tsx`, replace lines 3 and 6-7:

```ts
import { Sparkles, Check, RefreshCw, Layers, Eye, Pencil, Trash2, X, FileText, TrendingUp } from 'lucide-react';
import type { ContentCluster, CalendarArticle } from './types';
import {
  listenClusters, listenCalendar, generateClusters, approveCluster, updateClusterName, excludeCluster,
} from '../../services/contentService';
```

with:

```ts
import { Sparkles, Check, RefreshCw, Layers, Eye, Pencil, Trash2, X, FileText, TrendingUp, Plus } from 'lucide-react';
import type { ContentCluster, CalendarArticle } from './types';
import {
  listenClusters, listenCalendar, generateClusters, approveCluster, updateClusterName, excludeCluster, createClusterManual,
} from '../../services/contentService';
```

- [ ] **Step 2: Add manual-form state**

In `src/modules/content/ClustersView.tsx`, right after line 30 (`const [selectedId, setSelectedId] = useState<string | null>(null);`), add:

```ts
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualNome, setManualNome] = useState('');
  const [manualEstrategia, setManualEstrategia] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the create handler**

Right after the existing `saveEdit` function (ends at line 67, `};`), add:

```ts
  const handleCreateManual = async () => {
    if (!manualNome.trim()) {
      setManualError('Nome é obrigatório.');
      return;
    }
    setManualSaving(true);
    setManualError(null);
    try {
      await createClusterManual(uid, projectId, { nome: manualNome.trim(), estrategia: manualEstrategia.trim() });
      setManualNome('');
      setManualEstrategia('');
      setShowManualForm(false);
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Erro ao criar cluster');
    } finally {
      setManualSaving(false);
    }
  };
```

- [ ] **Step 4: Add the "Criar manualmente" button next to "Gerar clusters"**

Replace lines 86-99:

```tsx
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Clusters de Conteúdo</h1>
          <p className="text-sm text-slate-500 mt-0.5">Temas estratégicos e palavras-chave por intenção de busca.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {active.length ? 'Gerar novamente' : 'Gerar clusters'}
        </button>
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Clusters de Conteúdo</h1>
          <p className="text-sm text-slate-500 mt-0.5">Temas estratégicos e palavras-chave por intenção de busca.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualForm((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" /> Criar manualmente
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {active.length ? 'Gerar novamente' : 'Gerar clusters'}
          </button>
        </div>
      </div>
```

- [ ] **Step 5: Add the inline manual-creation form**

Right after the tabs `<div>` block (ends at line 112, `</div>`), and before `{error && ...}` (line 114), add:

```tsx
      {showManualForm && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-5">
          <h3 className="font-semibold text-slate-900 mb-3 text-sm">Novo cluster manual</h3>
          {manualError && (
            <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{manualError}</div>
          )}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nome</label>
              <input
                value={manualNome}
                onChange={(e) => setManualNome(e.target.value)}
                placeholder="Ex.: Cuidados com o couro"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Estratégia</label>
              <textarea
                value={manualEstrategia}
                onChange={(e) => setManualEstrategia(e.target.value)}
                rows={2}
                placeholder="Descreva o tema e o objetivo deste cluster"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setShowManualForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateManual}
              disabled={manualSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg transition-colors"
            >
              {manualSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar cluster
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: same 5 pre-existing errors only.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open the Content App → a project → "Clusters". Click "Criar manualmente", leave "Nome" empty and click "Criar cluster" → expect the red inline error "Nome é obrigatório." Fill "Nome" (e.g. "Teste manual") and "Estratégia", click "Criar cluster" → expect the form to close and a new card to appear immediately in the clusters grid with an orange left/top accent (already-approved styling, same as `cluster.aprovado ? 'border-[#FF5B03]' : ...'`), 0 artigos, no keyword chips.

- [ ] **Step 8: Commit**

```bash
git add src/modules/content/ClustersView.tsx
git commit -m "$(cat <<'EOF'
feat(content): criação manual de cluster (sem IA)

Adiciona botão "Criar manualmente" em ClustersView, abrindo um formulário
inline (nome + estratégia) que grava direto no Firestore via
createClusterManual, já aprovado e pronto para vincular artigos.
EOF
)"
```

---

### Task 3: Manual article creation UI (`ArticlesProductionView.tsx`)

**Files:**
- Modify: `src/modules/content/ArticlesProductionView.tsx`

**Interfaces:**
- Consumes: `createArticleManual(uid, projectId, ManualArticleInput): Promise<string>` (Task 1), `listProductsForLinking(uid): Promise<LinkableProduct[]>` and `ProductLinkPicker` (already existing, used by `ArticleView.tsx`), `ArticleSizePicker` (already imported in this file)
- Produces: nothing new consumed by Task 4 besides the already-existing `articles` state

- [ ] **Step 1: Add new imports**

Replace lines 1-8:

```ts
import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock,
} from 'lucide-react';
import type { CalendarArticle, ArticleStatus, ArticleSize, ContentCluster } from './types';
import { listenCalendar, generateCalendar, produceArticle, updateArticle } from '../../services/contentService';
import ArticleView from './ArticleView';
import ArticleSizePicker from './ArticleSizePicker';
```

with:

```ts
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock, Plus,
} from 'lucide-react';
import type { CalendarArticle, ArticleStatus, ArticleSize, ContentCluster } from './types';
import {
  listenCalendar, generateCalendar, produceArticle, updateArticle,
  createArticleManual, listProductsForLinking, type LinkableProduct,
} from '../../services/contentService';
import ArticleView from './ArticleView';
import ArticleSizePicker from './ArticleSizePicker';
import ProductLinkPicker from './ProductLinkPicker';
```

- [ ] **Step 2: Add state for the create-article modal**

Right after line 55 (`const [titleDraft, setTitleDraft] = useState('');`), add:

```ts
  const [creatingArticle, setCreatingArticle] = useState(false);
  const [newTitulo, setNewTitulo] = useState('');
  const [newKw, setNewKw] = useState('');
  const [newTamanho, setNewTamanho] = useState<ArticleSize>('medio');
  const [newScheduledDate, setNewScheduledDate] = useState('');
  const [newClusterId, setNewClusterId] = useState('');
  const [newProdutoIds, setNewProdutoIds] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState<LinkableProduct[]>([]);
  const [creatingSaving, setCreatingSaving] = useState(false);
  const [creatingError, setCreatingError] = useState<string | null>(null);
```

- [ ] **Step 3: Load linkable products when the modal opens**

Right after the existing `useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);` (line 59), add:

```ts
  useEffect(() => {
    if (creatingArticle) {
      listProductsForLinking(uid).then(setAllProducts).catch(() => setAllProducts([]));
    }
  }, [creatingArticle, uid]);
```

- [ ] **Step 4: Add the approved-clusters memo and open/confirm handlers**

Right after `changeSize` (ends at line 120, `};`), add:

```ts
  const approvedClusters = useMemo(() => clusters.filter((c) => c.aprovado && !c.excluido), [clusters]);

  const openCreateArticle = () => {
    setNewTitulo('');
    setNewKw('');
    setNewTamanho('medio');
    setNewScheduledDate(new Date().toISOString().slice(0, 10));
    setNewClusterId('');
    setNewProdutoIds([]);
    setCreatingError(null);
    setCreatingArticle(true);
  };

  const confirmCreateArticle = async () => {
    if (!newTitulo.trim() || !newKw.trim() || !newScheduledDate) {
      setCreatingError('Preencha título, palavra-chave e data.');
      return;
    }
    setCreatingSaving(true);
    setCreatingError(null);
    try {
      const priorities = articles.map((a) => a.priority ?? 0);
      const minPriority = priorities.length ? Math.min(...priorities) : 0;
      await createArticleManual(uid, projectId, {
        titulo: newTitulo.trim(),
        kwPrincipal: newKw.trim(),
        tamanho: newTamanho,
        scheduledDate: newScheduledDate,
        clusterId: newClusterId,
        produtosVinculados: newProdutoIds,
        priority: minPriority - 1,
      });
      setCreatingArticle(false);
    } catch (e) {
      setCreatingError(e instanceof Error ? e.message : 'Erro ao criar artigo');
    } finally {
      setCreatingSaving(false);
    }
  };
```

- [ ] **Step 5: Add the "Criar artigo" button next to "Gerar calendário"**

Replace lines 127-140:

```tsx
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Produção de Artigos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Artigos agendados. Produza manualmente ou aguarde a automação na data.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg shadow-sm transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {articles.length ? 'Regerar calendário' : 'Gerar calendário'}
        </button>
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Produção de Artigos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Artigos agendados. Produza manualmente ou aguarde a automação na data.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreateArticle}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Criar artigo
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg shadow-sm transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {articles.length ? 'Regerar calendário' : 'Gerar calendário'}
          </button>
        </div>
      </div>
```

- [ ] **Step 6: Add the create-article modal**

Right after the reschedule modal block (ends at line 264, `)}`), and before `{selectedArticle && (` (line 266), add:

```tsx
      {creatingArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setCreatingArticle(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-slate-900 mb-4">Criar artigo</h3>
            {creatingError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{creatingError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
                <input
                  autoFocus
                  value={newTitulo}
                  onChange={(e) => setNewTitulo(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Palavra-chave principal</label>
                <input
                  value={newKw}
                  onChange={(e) => setNewKw(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                />
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tamanho</label>
                  <ArticleSizePicker value={newTamanho} onChange={setNewTamanho} />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Data agendada</label>
                  <input
                    type="date"
                    value={newScheduledDate}
                    onChange={(e) => setNewScheduledDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cluster</label>
                <select
                  value={newClusterId}
                  onChange={(e) => setNewClusterId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                >
                  <option value="">Nenhum</option>
                  {approvedClusters.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Produtos vinculados</label>
                <ProductLinkPicker products={allProducts} selectedIds={newProdutoIds} onChange={setNewProdutoIds} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCreatingArticle(false)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">
                Cancelar
              </button>
              <button
                onClick={confirmCreateArticle}
                disabled={creatingSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg"
              >
                {creatingSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null} Criar artigo
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: same 5 pre-existing errors only.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, go to Content App → a project → "Produção de Artigos". Click "Criar artigo", leave título/KW/data empty and confirm → expect the red inline error. Fill título, palavra-chave, deixe "Cluster" em "Nenhum", clique em "Criar artigo" → expect modal to close and a new row to appear in the list with status "Agendado" and no cluster pill; go to "Clusters" → "Sem cluster" tab and confirm the new article shows up there. Repeat selecting a cluster and a linked product, confirm the row shows the cluster pill.

- [ ] **Step 9: Commit**

```bash
git add src/modules/content/ArticlesProductionView.tsx
git commit -m "$(cat <<'EOF'
feat(content): criação manual de artigo, sem exigir cluster

Adiciona botão "Criar artigo" em ArticlesProductionView, abrindo um modal
(título, palavra-chave, tamanho, data, cluster opcional, produtos
vinculados) que grava a ficha do artigo direto no Firestore via
createArticleManual — sem disparar o pipeline de IA. O artigo criado usa
as ações de produção já existentes normalmente.
EOF
)"
```

---

### Task 4: Drag-and-drop priority reorder + migration (`ArticlesProductionView.tsx`)

**Files:**
- Modify: `src/modules/content/ArticlesProductionView.tsx` (same file as Task 3 — do this task after Task 3 is committed)

**Interfaces:**
- Consumes: `updateArticlesPriority(uid, projectId, updates)` (Task 1), `CalendarArticle.priority?: number` (Task 1)
- Produces: nothing consumed elsewhere — this is the last task

- [ ] **Step 1: Import `Reorder` and `GripVertical`**

Replace line 1-9 (post-Task-3 state) header imports:

```ts
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock, Plus,
} from 'lucide-react';
```

with:

```ts
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'motion/react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock, Plus, GripVertical,
} from 'lucide-react';
```

- [ ] **Step 2: Add the priority migration effect and sorted-articles memo**

Right after the `useEffect` that loads `listProductsForLinking` (added in Task 3, Step 3), add:

```ts
  // Migração automática (uma vez por projeto): artigos anteriores a esta
  // feature não têm `priority`. Como `articles` já chega ordenado por
  // scheduledDate (query de listenCalendar), atribuímos sequencialmente
  // após o maior priority já existente, preservando a ordem relativa atual.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || !articles.length) return;
    const missing = articles.filter((a) => a.priority === undefined);
    if (missing.length === 0) {
      migratedRef.current = true;
      return;
    }
    migratedRef.current = true;
    const existingPriorities = articles
      .map((a) => a.priority)
      .filter((p): p is number => p !== undefined);
    let next = existingPriorities.length ? Math.max(...existingPriorities) + 1 : 0;
    const updates = missing.map((a) => ({ id: a.id, priority: next++ }));
    updateArticlesPriority(uid, projectId, updates).catch((e) =>
      console.error('Falha ao migrar prioridade dos artigos:', e),
    );
  }, [articles, uid, projectId]);

  const sortedArticles = useMemo(
    () => [...articles].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [articles],
  );
```

- [ ] **Step 3: Import `updateArticlesPriority`**

In the `contentService` import block (already modified in Task 3, Step 1), add `updateArticlesPriority` to the list:

```ts
import {
  listenCalendar, generateCalendar, produceArticle, updateArticle,
  createArticleManual, listProductsForLinking, type LinkableProduct,
  updateArticlesPriority,
} from '../../services/contentService';
```

- [ ] **Step 4: Add the reorder handler**

Right after the `sortedArticles` memo added in Step 2, add:

```ts
  const handleReorder = (newOrder: CalendarArticle[]) => {
    setArticles(newOrder);
    const updates = newOrder.map((a, idx) => ({ id: a.id, priority: idx }));
    updateArticlesPriority(uid, projectId, updates).catch((e) =>
      console.error('Falha ao salvar nova ordem:', e),
    );
  };
```

- [ ] **Step 5: Swap the list container and row for `Reorder.Group`/`Reorder.Item`, iterating over `sortedArticles`**

Note: line numbers below are from the file as it existed before Task 3's edits — Task 3 added lines before this block (header button, modal), so match by the exact text shown, not by line number. Replace the full list block, from `<div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">` through the `<div key={a.id} ...>` line that opens each row:

```tsx
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">
        {articles.map((a) => {
          const cName = clusterName(a.clusterId);
          return (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
```

with:

```tsx
      <Reorder.Group
        as="div"
        axis="y"
        values={sortedArticles}
        onReorder={handleReorder}
        className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden"
      >
        {sortedArticles.map((a) => {
          const cName = clusterName(a.clusterId);
          return (
            <Reorder.Item
              key={a.id}
              value={a}
              as="div"
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors bg-white"
            >
              <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing shrink-0" />
```

Then, further down in that same block (the row's closing tag and the list's closing tag, immediately before the `{reschedulingId && (` block), replace:

```tsx
            </div>
          );
        })}
      </div>
```

with:

```tsx
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
```

Leave everything else inside the row (date, title, KW, size picker, cluster pill, status badge, action buttons) exactly as-is — only the outer wrapper tags and the iteration source (`articles` → `sortedArticles`) change.

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: same 5 pre-existing errors only. If TypeScript complains about `Reorder.Item`'s `value` prop type, confirm `sortedArticles` is typed `CalendarArticle[]` (it is, via the `useMemo` in Step 2) — `Reorder.Group`'s `values` and each `Reorder.Item`'s `value` must reference the same array/object identities for the library's internal reordering to work, which `sortedArticles` already guarantees since it's derived directly from `articles`.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open "Produção de Artigos" with at least 3 articles (create a couple manually via Task 3's modal if needed, using different `scheduledDate` values). Confirm the list renders in `scheduledDate` order the first time (post-migration, since none had `priority` yet). Drag the grip icon of the last row to the top, drop it → confirm it visually reorders immediately and stays in that position after a full page reload (proving `updateArticlesPriority` persisted). Click other buttons in a row (Reagendar, Produzir, título) after the drag to confirm they still work normally — a plain click should not trigger a reorder. Open the Calendário view and confirm article positions per day are unaffected (it still groups by `scheduledDate`, untouched by this change).

- [ ] **Step 8: Commit**

```bash
git add src/modules/content/ArticlesProductionView.tsx
git commit -m "$(cat <<'EOF'
feat(content): reordenação por drag-and-drop na Produção de Artigos

Lista de Produção passa a ordenar por um campo priority arrastável
(Reorder.Group/Item do pacote motion, já é dependência do projeto),
independente da scheduledDate usada pelo Calendário. Artigos sem priority
ainda (criados antes desta feature) recebem uma migração automática e
silenciosa na primeira carga, preservando a ordem atual por data.
EOF
)"
```
