# Meu Mapa de Conteúdo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive nodemap ("Meu Mapa de Conteúdo") to the Painel de Operações showing Site → Clusters → Artigos with node size proportional to keyword search volumes, and enable manual editing/adding of keyword volumes in ClusterDetailView.

**Architecture:** A new `ContentMapView` component uses React Flow to render a radial nodemap. Node positions are computed in a `useMemo` using trigonometry (no external layout library). `DashboardPanel` subscribes to clusters (already subscribes to articles) and renders the map below the three existing cards. Keyword editing is added inline to `ClusterDetailView` using a single new `updateClusterKeywords` Firestore helper.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Firebase Firestore, `@xyflow/react` (React Flow v12)

## Global Constraints

- UI text is in pt-BR
- No automated tests — validate manually with `npm run dev` on port 3000
- Brand blue: `#004ac6`
- No new state management libraries — local React state only
- Firestore path for clusters: `users/{uid}/contentProjects/{projectId}/clusters/{clusterId}`
- `ClusterKeyword.volume` is already `number | undefined` in `types.ts` — no type changes needed

---

### Task 1: Install @xyflow/react and add updateClusterKeywords

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/services/contentService.ts` — add `updateClusterKeywords` after line 124

**Interfaces:**
- Produces: `updateClusterKeywords(uid: string, projectId: string, clusterId: string, keywords: ClusterKeyword[]): Promise<void>`

- [ ] **Step 1: Install React Flow**

```bash
npm install @xyflow/react
```

Expected: resolves successfully, no peer-dep conflicts.

- [ ] **Step 2: Add updateClusterKeywords to contentService.ts**

Open `src/services/contentService.ts`. After the `updateClusterName` function (around line 124), add:

```ts
export async function updateClusterKeywords(
  uid: string,
  projectId: string,
  clusterId: string,
  keywords: import('../modules/content/types').ClusterKeyword[],
): Promise<void> {
  await updateDoc(
    doc(db, `users/${uid}/contentProjects/${projectId}/clusters/${clusterId}`),
    { palavrasChave: keywords },
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/services/contentService.ts
git commit -m "feat(content): install @xyflow/react and add updateClusterKeywords"
```

---

### Task 2: Create ContentMapView.tsx

**Files:**
- Create: `src/modules/content/ContentMapView.tsx`

**Interfaces:**
- Consumes: `clusters: ContentCluster[]`, `articles: CalendarArticle[]`, `onSelectCluster: (clusterId: string) => void`
- Produces: `<ContentMapView>` — full-width 520px-height React Flow canvas

**Node sizing:**
- Site: fixed radius 40px
- Cluster: `clamp(22, 52, sumVolumes > 0 ? sumVolumes / 500 : 26)` where `sumVolumes` = sum of all `volume` on `cluster.palavrasChave` (undefined counts as 0)
- Article: `clamp(8, 22, kwVol > 0 ? kwVol / 500 : 10)` where `kwVol` = volume of the keyword in its cluster whose `termo === article.kwPrincipal`

**Radial layout:**
- Site at origin `(0, 0)`
- Clusters at radius 220 from origin, angle `(2π / n) * i - π/2`
- Articles at radius 110 from their cluster center, angle `(2π / m) * j + clusterAngle`
- React Flow `position` is top-left corner, so subtract radius from each center: `position = { x: cx - r, y: cy - r }`
- `fitView` with `padding: 0.15` auto-scales to fill the container

- [ ] **Step 1: Create the file**

```tsx
import React, { useMemo } from 'react';
import {
  ReactFlow, Background, Controls,
  type Node, type Edge, type NodeProps,
  Handle, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ContentCluster, CalendarArticle } from './types';

const CLUSTER_COLORS = [
  '#f97316', '#10b981', '#8b5cf6', '#f59e0b',
  '#14b8a6', '#f43f5e', '#6366f1', '#06b6d4',
];

function clamp(min: number, max: number, val: number) {
  return Math.max(min, Math.min(max, val));
}

function radialPos(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

type CircleData = {
  bg: string;
  size: number;
  label: string;
  tooltip: string;
  isCluster: boolean;
  clusterId?: string;
};

const CircleNode = ({ data }: NodeProps) => {
  const d = data as CircleData;
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden', pointerEvents: 'none' }} />
      <div
        title={d.tooltip}
        style={{
          width: d.size,
          height: d.size,
          borderRadius: '50%',
          background: d.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: d.size >= 60 ? 12 : d.size >= 40 ? 10 : 0,
          fontWeight: 600,
          fontFamily: 'inherit',
          overflow: 'hidden',
          padding: '0 4px',
          textAlign: 'center',
          lineHeight: 1.2,
          cursor: d.isCluster ? 'pointer' : 'default',
          boxSizing: 'border-box',
          userSelect: 'none',
        }}
      >
        {d.size >= 40 ? (d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label) : ''}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden', pointerEvents: 'none' }} />
    </>
  );
};

const nodeTypes = { circle: CircleNode };

interface Props {
  clusters: ContentCluster[];
  articles: CalendarArticle[];
  onSelectCluster: (clusterId: string) => void;
}

const ContentMapView: React.FC<Props> = ({ clusters, articles, onSelectCluster }) => {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const SITE_R = 40;
    const R1 = 220;
    const R2 = 110;

    nodes.push({
      id: 'site',
      type: 'circle',
      position: { x: -SITE_R, y: -SITE_R },
      data: {
        bg: '#004ac6',
        size: SITE_R * 2,
        label: 'Site',
        tooltip: 'Site principal',
        isCluster: false,
      } satisfies CircleData,
    });

    const active = clusters.filter((c) => !c.excluido);
    const angleStep = active.length ? (2 * Math.PI) / active.length : 0;

    active.forEach((cluster, ci) => {
      const color = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
      const kws = cluster.palavrasChave ?? [];
      const sumVol = kws.reduce((s, k) => s + (k.volume ?? 0), 0);
      const r = clamp(22, 52, sumVol > 0 ? sumVol / 500 : 26);
      const angle = angleStep * ci - Math.PI / 2;
      const center = radialPos(0, 0, R1, angle);
      const volStr = sumVol > 0
        ? `${sumVol.toLocaleString('pt-BR')}/mês`
        : `${kws.length} palavras-chave`;

      nodes.push({
        id: cluster.id,
        type: 'circle',
        position: { x: center.x - r, y: center.y - r },
        data: {
          bg: color,
          size: r * 2,
          label: cluster.nome,
          tooltip: `${cluster.nome}\nVolume total: ${volStr}`,
          isCluster: true,
          clusterId: cluster.id,
        } satisfies CircleData,
      });

      edges.push({
        id: `s-${cluster.id}`,
        source: 'site',
        target: cluster.id,
        style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
        type: 'straight',
      });

      const clusterArts = articles.filter((a) => a.clusterId === cluster.id);
      const artStep = clusterArts.length ? (2 * Math.PI) / clusterArts.length : 0;

      clusterArts.forEach((art, ai) => {
        const kwVol = kws.find((k) => k.termo === art.kwPrincipal)?.volume;
        const ar = clamp(8, 22, kwVol != null && kwVol > 0 ? kwVol / 500 : 10);
        const artAngle = artStep * ai + angle;
        const artCenter = radialPos(center.x, center.y, R2, artAngle);
        const volLine = kwVol != null ? `\nVolume: ${kwVol.toLocaleString('pt-BR')}/mês` : '';

        nodes.push({
          id: art.id,
          type: 'circle',
          position: { x: artCenter.x - ar, y: artCenter.y - ar },
          data: {
            bg: color + 'cc',
            size: ar * 2,
            label: art.titulo,
            tooltip: `${art.titulo}\nKW: ${art.kwPrincipal}${volLine}`,
            isCluster: false,
          } satisfies CircleData,
        });

        edges.push({
          id: `${cluster.id}-${art.id}`,
          source: cluster.id,
          target: art.id,
          style: { stroke: '#cbd5e1', strokeWidth: 1 },
          type: 'straight',
        });
      });
    });

    return { nodes, edges };
  }, [clusters, articles]);

  const handleNodeClick = (_evt: React.MouseEvent, node: Node) => {
    const d = node.data as CircleData;
    if (d.isCluster && d.clusterId) onSelectCluster(d.clusterId);
  };

  const active = clusters.filter((c) => !c.excluido);
  if (!active.length) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Nenhum cluster ativo. Gere clusters para visualizar o mapa.
      </div>
    );
  }

  return (
    <div style={{ height: 520, width: '100%', borderRadius: 12, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export default ContentMapView;
```

Save to `src/modules/content/ContentMapView.tsx`.

- [ ] **Step 2: Verify TypeScript**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/content/ContentMapView.tsx
git commit -m "feat(content): add ContentMapView radial nodemap with React Flow"
```

---

### Task 3: Wire ContentMapView into DashboardPanel + add cluster navigation from map

**Files:**
- Modify: `src/modules/content/DashboardPanel.tsx` — subscribe to clusters, render map, add `onSelectCluster` prop
- Modify: `src/modules/content/ContentApp.tsx` — pass `onSelectCluster` to DashboardPanel, add `pendingClusterId` state, pass `initialSelectedId` to ClustersView
- Modify: `src/modules/content/ClustersView.tsx` — accept `initialSelectedId` and `onInitialClusterHandled` props

**Interfaces:**
- `DashboardPanel` new prop: `onSelectCluster?: (clusterId: string) => void`
- `ClustersView` new props: `initialSelectedId?: string | null`, `onInitialClusterHandled?: () => void`

- [ ] **Step 1: Replace DashboardPanel.tsx**

Full replacement of `src/modules/content/DashboardPanel.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, CalendarClock, Network } from 'lucide-react';
import type { CalendarArticle, ContentCluster } from './types';
import { listenCalendar, listenClusters } from '../../services/contentService';
import ContentMapView from './ContentMapView';

interface Props {
  uid: string;
  projectId: string;
  empresa: string;
  onSelectCluster?: (clusterId: string) => void;
}

const DashboardPanel: React.FC<Props> = ({ uid, projectId, empresa, onSelectCluster }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [clusters, setClusters] = useState<ContentCluster[]>([]);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);
  useEffect(() => listenClusters(uid, projectId, setClusters), [uid, projectId]);

  const emProducao = articles.filter((a) => a.status === 'em_producao');
  const publicados = articles
    .filter((a) => a.status === 'publicado')
    .sort((a, b) => (b.dataPublicacao ?? '').localeCompare(a.dataPublicacao ?? ''))
    .slice(0, 5);
  const proximos = articles.filter((a) => a.status === 'agendado').slice(0, 5);

  const card = (title: string, icon: React.ReactNode, body: React.ReactNode) => (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3 text-slate-700">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {body}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-900">Painel de Operações</h1>
        <p className="text-sm text-slate-500 mt-0.5">{empresa}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {card(
          'Em produção agora',
          <Activity className="w-4 h-4 text-amber-500" />,
          emProducao.length ? (
            <ul className="space-y-2">
              {emProducao.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-amber-600">Etapa {a.stage}/5</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nada em produção.</p>
          ),
        )}

        {card(
          'Concluídos recentemente',
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
          publicados.length ? (
            <ul className="space-y-2">
              {publicados.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">{(a.dataPublicacao ?? '').split('T')[0]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nenhum artigo publicado.</p>
          ),
        )}

        {card(
          'Próximas publicações',
          <CalendarClock className="w-4 h-4 text-[#004ac6]" />,
          proximos.length ? (
            <ul className="space-y-2">
              {proximos.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">{a.scheduledDate}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nada agendado.</p>
          ),
        )}
      </div>

      {/* Meu Mapa de Conteúdo */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Network className="w-4 h-4 text-[#004ac6]" />
          <h3 className="text-sm font-semibold text-slate-700">Meu Mapa de Conteúdo</h3>
          <span className="ml-auto text-[11px] text-slate-400">Tamanho dos nós ∝ volume de pesquisa · Clique num cluster para abrir</span>
        </div>
        <ContentMapView
          clusters={clusters}
          articles={articles}
          onSelectCluster={onSelectCluster ?? (() => {})}
        />
      </div>
    </div>
  );
};

export default DashboardPanel;
```

- [ ] **Step 2: Add pendingClusterId state + props in ContentApp.tsx**

In `src/modules/content/ContentApp.tsx`:

2a. Add `pendingClusterId` to state. After the existing `useState` declarations (around line 33), add:

```tsx
const [pendingClusterId, setPendingClusterId] = useState<string | null>(null);
```

2b. Find the `ContentView` type (line 24) and note `'clusters'` is already in it — no change needed.

2c. Find the `<DashboardPanel>` render block (around line 171) and replace with:

```tsx
<DashboardPanel
  uid={uid}
  projectId={selected.id}
  empresa={selected.config.nomeEmpresa}
  onSelectCluster={(clusterId) => {
    setPendingClusterId(clusterId);
    setView('clusters');
  }}
/>
```

2d. Find the `<ClustersView>` render block (around line 173) and replace with:

```tsx
<ClustersView
  uid={uid}
  projectId={selected.id}
  initialSelectedId={pendingClusterId}
  onInitialClusterHandled={() => setPendingClusterId(null)}
/>
```

- [ ] **Step 3: Add initialSelectedId prop to ClustersView.tsx**

In `src/modules/content/ClustersView.tsx`:

3a. Update the `Props` interface (around line 11):

```tsx
interface Props {
  uid: string;
  projectId: string;
  initialSelectedId?: string | null;
  onInitialClusterHandled?: () => void;
}
```

3b. Update the component signature (line 19):

```tsx
const ClustersView: React.FC<Props> = ({ uid, projectId, initialSelectedId, onInitialClusterHandled }) => {
```

3c. Add a `useEffect` after the existing `useEffect` calls (after line 30) to handle the initial selection:

```tsx
useEffect(() => {
  if (initialSelectedId) {
    setSelectedId(initialSelectedId);
    onInitialClusterHandled?.();
  }
}, [initialSelectedId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Verify TypeScript**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

Open http://localhost:3000, navigate to Alfred → Painel. Verify:
- "Meu Mapa de Conteúdo" section appears below the 3 cards
- If clusters exist: nodemap renders with colored circles and lines
- If no clusters: "Nenhum cluster ativo" placeholder shows
- Clicking a cluster node switches to the Clusters view and opens that cluster's detail

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/DashboardPanel.tsx src/modules/content/ContentApp.tsx src/modules/content/ClustersView.tsx
git commit -m "feat(content): wire ContentMapView into DashboardPanel with cluster navigation"
```

---

### Task 4: Add keyword volume editing and add-keyword form to ClusterDetailView

**Files:**
- Modify: `src/modules/content/ClusterDetailView.tsx`

**New state (add to component body):**
```
editingKwIndex: number | null   — index of keyword being edited (-1 = none)
editDraft: ClusterKeyword       — mutable copy of the keyword being edited
addingKw: boolean               — whether the add-keyword form is open
newKw: ClusterKeyword           — draft for the new keyword
kwSaving: boolean               — debounce / disable save while request is in flight
```

**Behavior:**
- Each keyword chip gets a pencil (✏️) and trash (🗑️) button
- Clicking pencil: sets `editingKwIndex` + copies the keyword into `editDraft`
- Pencil row becomes inline form: text input for `termo`, select for `intencao`, number input for `volume`
- Saving: calls `updateClusterKeywords(uid, projectId, cluster.id, updatedArray)` then clears editing state
- Deleting: filters keyword out and calls `updateClusterKeywords` immediately
- "Adicionar" button at bottom of KW section opens inline form with blank fields
- Saving new KW: appends to array and saves; cancelling resets form

- [ ] **Step 1: Full replacement of ClusterDetailView.tsx**

```tsx
import React, { useState } from 'react';
import { ArrowLeft, FileText, TrendingUp, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import type { ContentCluster, CalendarArticle, SearchIntent, ArticleStatus, ClusterKeyword } from './types';
import { updateClusterKeywords } from '../../services/contentService';
import ArticleView from './ArticleView';

export const INTENT_META: Record<SearchIntent, { label: string; chip: string; dot: string }> = {
  informacional: { label: 'Informacional', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  comercial:     { label: 'Comercial',     chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  transacional:  { label: 'Transacional',  chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  navegacional:  { label: 'Navegacional',  chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
};

const STATUS_STYLE: Record<ArticleStatus, string> = {
  agendado:    'bg-slate-100 text-slate-600',
  em_producao: 'bg-amber-100 text-amber-700',
  revisao:     'bg-indigo-100 text-indigo-700',
  aprovado:    'bg-emerald-100 text-emerald-700',
  publicado:   'bg-[#004ac6] text-white',
  erro:        'bg-red-100 text-red-700',
};

const INTENTS: SearchIntent[] = ['informacional', 'comercial', 'transacional', 'navegacional'];

const BLANK_KW: ClusterKeyword = { termo: '', intencao: 'informacional' };

interface Props {
  uid: string;
  projectId: string;
  cluster: ContentCluster;
  articles: CalendarArticle[];
  onBack: () => void;
}

const ClusterDetailView: React.FC<Props> = ({ uid, projectId, cluster, articles, onBack }) => {
  const [openArticle, setOpenArticle] = useState<string | null>(null);
  const [editingKwIndex, setEditingKwIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ClusterKeyword>(BLANK_KW);
  const [addingKw, setAddingKw] = useState(false);
  const [newKw, setNewKw] = useState<ClusterKeyword>(BLANK_KW);
  const [kwSaving, setKwSaving] = useState(false);

  const kws = cluster.palavrasChave ?? [];

  const saveKwEdit = async () => {
    if (!editDraft.termo.trim() || editingKwIndex === null) return;
    const updated = kws.map((k, i) =>
      i === editingKwIndex ? { ...editDraft, termo: editDraft.termo.trim() } : k,
    );
    setKwSaving(true);
    try {
      await updateClusterKeywords(uid, projectId, cluster.id, updated);
      setEditingKwIndex(null);
    } finally {
      setKwSaving(false);
    }
  };

  const deleteKw = async (index: number) => {
    const updated = kws.filter((_, i) => i !== index);
    await updateClusterKeywords(uid, projectId, cluster.id, updated);
  };

  const saveNewKw = async () => {
    if (!newKw.termo.trim()) return;
    const kw: ClusterKeyword = {
      termo: newKw.termo.trim(),
      intencao: newKw.intencao,
      ...(newKw.volume != null && newKw.volume > 0 ? { volume: newKw.volume } : {}),
    };
    const updated = [...kws, kw];
    setKwSaving(true);
    try {
      await updateClusterKeywords(uid, projectId, cluster.id, updated);
      setAddingKw(false);
      setNewKw(BLANK_KW);
    } finally {
      setKwSaving(false);
    }
  };

  const startEdit = (kw: ClusterKeyword, index: number) => {
    setEditingKwIndex(index);
    setEditDraft({ ...kw });
    setAddingKw(false);
  };

  const cancelEdit = () => { setEditingKwIndex(null); setEditDraft(BLANK_KW); };

  const openAdd = () => { setAddingKw(true); setEditingKwIndex(null); setNewKw(BLANK_KW); };

  const selectedArticle = articles.find((a) => a.id === openArticle) ?? null;

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar aos clusters
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-2xl font-bold text-slate-900">{cluster.nome}</h1>
        {cluster.aprovado && <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Aprovado</span>}
      </div>
      <p className="text-sm text-slate-500 mb-6">{cluster.estrategia}</p>

      {/* Keywords by intent */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-slate-400" /> Palavras-chave por intenção
          </h2>
        </div>

        {/* Keyword rows, grouped by intent */}
        <div className="space-y-4">
          {INTENTS.map((intent) => {
            const intentKws = kws
              .map((k, i) => ({ k, i }))
              .filter(({ k }) => k.intencao === intent);
            if (!intentKws.length) return null;
            return (
              <div key={intent}>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border mb-2 ${INTENT_META[intent].chip}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${INTENT_META[intent].dot}`} />
                  {INTENT_META[intent].label}
                </span>
                <div className="space-y-1.5 ml-1">
                  {intentKws.map(({ k, i }) =>
                    editingKwIndex === i ? (
                      // ── Inline edit form ──────────────────────────────────
                      <div key={i} className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                        <input
                          autoFocus
                          value={editDraft.termo}
                          onChange={(e) => setEditDraft((d) => ({ ...d, termo: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveKwEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          placeholder="Palavra-chave"
                          className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] w-44"
                        />
                        <select
                          value={editDraft.intencao}
                          onChange={(e) => setEditDraft((d) => ({ ...d, intencao: e.target.value as SearchIntent }))}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                        >
                          {INTENTS.map((int) => (
                            <option key={int} value={int}>{INTENT_META[int].label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={editDraft.volume ?? ''}
                            onChange={(e) => setEditDraft((d) => ({
                              ...d,
                              volume: e.target.value ? Number(e.target.value) : undefined,
                            }))}
                            placeholder="Volume/mês"
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] w-32"
                          />
                          <span className="text-[11px] text-slate-400">/mês</span>
                        </div>
                        <button
                          onClick={saveKwEdit}
                          disabled={kwSaving || !editDraft.termo.trim()}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-40"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      // ── Read mode chip ────────────────────────────────────
                      <div key={i} className="flex items-center gap-2 group">
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                          {k.termo}
                          <span className="text-[10px] text-slate-400 ml-1">
                            {k.volume != null ? `${k.volume.toLocaleString('pt-BR')}/mês` : '—'}
                          </span>
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(k, i)}
                            title="Editar"
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteKw(i)}
                            title="Excluir"
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            );
          })}

          {!kws.length && !addingKw && (
            <p className="text-sm text-slate-400">Nenhuma palavra-chave.</p>
          )}
        </div>

        {/* Add keyword form */}
        {addingKw ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-xl border border-dashed border-slate-300">
            <input
              autoFocus
              value={newKw.termo}
              onChange={(e) => setNewKw((d) => ({ ...d, termo: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') saveNewKw(); if (e.key === 'Escape') { setAddingKw(false); setNewKw(BLANK_KW); } }}
              placeholder="Palavra-chave"
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] w-44"
            />
            <select
              value={newKw.intencao}
              onChange={(e) => setNewKw((d) => ({ ...d, intencao: e.target.value as SearchIntent }))}
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
            >
              {INTENTS.map((int) => (
                <option key={int} value={int}>{INTENT_META[int].label}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={newKw.volume ?? ''}
                onChange={(e) => setNewKw((d) => ({
                  ...d,
                  volume: e.target.value ? Number(e.target.value) : undefined,
                }))}
                placeholder="Volume/mês"
                className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] w-32"
              />
              <span className="text-[11px] text-slate-400">/mês</span>
            </div>
            <button
              onClick={saveNewKw}
              disabled={kwSaving || !newKw.termo.trim()}
              className="px-3 py-1 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-40 rounded-lg transition-colors"
            >
              Salvar
            </button>
            <button
              onClick={() => { setAddingKw(false); setNewKw(BLANK_KW); }}
              className="px-3 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={openAdd}
            className="mt-4 flex items-center gap-1.5 text-[12px] font-medium text-[#004ac6] hover:text-[#003ea8] hover:bg-[#eef3ff] px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar palavra-chave
          </button>
        )}
      </div>

      {/* Linked articles */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" /> Artigos vinculados ({articles.length})
          </h2>
        </div>
        {articles.length ? (
          <div className="divide-y divide-slate-100">
            {articles.map((a) => (
              <button key={a.id} onClick={() => setOpenArticle(a.id)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-900 truncate block">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal} · {a.scheduledDate}</span>
                </div>
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>{a.status}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 px-5 py-8 text-center">Nenhum artigo vinculado ainda. Gere o calendário para criar artigos deste tema.</p>
        )}
      </div>

      {selectedArticle && (
        <ArticleView uid={uid} projectId={projectId} article={selectedArticle} onClose={() => setOpenArticle(null)} />
      )}
    </div>
  );
};

export default ClusterDetailView;
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

Open http://localhost:3000, navigate to Alfred → Clusters → click "Ver mais" on any cluster. Verify:

- Each keyword chip shows its volume (or `—`) and reveals ✏️ / 🗑️ buttons on hover
- Clicking ✏️ opens inline edit form pre-filled with termo, intenção, volume
- Editing and saving updates the keyword in Firestore and the chip refreshes
- Clicking 🗑️ removes the keyword immediately
- Clicking "Adicionar palavra-chave" opens the add form; saving adds the new keyword
- Cancelling the forms discards changes
- If the cluster has volumes set, go back to Painel and verify the nodemap node sizes changed

- [ ] **Step 4: Commit**

```bash
git add src/modules/content/ClusterDetailView.tsx
git commit -m "feat(content): add keyword volume editing and add-keyword form in ClusterDetailView"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| Nodemap "Meu Mapa de Conteúdo" section in DashboardPanel | Task 2 (component) + Task 3 (wiring) |
| Site principal node at center | Task 2 |
| Clusters as branches, articles as sub-branches | Task 2 |
| Node size proportional to keyword search volume | Task 2 (sizing formula) |
| Click cluster node → navigate to ClustersView + open cluster detail | Task 3 |
| Pan/zoom via React Flow | Task 2 (native) |
| Add volume field to keywords in ClusterDetailView | Task 4 |
| Edit existing keywords inline (termo, intenção, volume) | Task 4 |
| Add new keyword with intenção + volume | Task 4 |
| Delete keyword | Task 4 |
| `updateClusterKeywords` service helper | Task 1 |
| Install `@xyflow/react` | Task 1 |

All requirements covered. No gaps.

### Placeholder scan

No TBDs, no "similar to Task N" references, no steps without code.

### Type consistency

- `updateClusterKeywords` defined in Task 1, consumed in Task 4 — signature matches
- `ContentMapView` props defined in Task 2, passed in Task 3 — `clusters`, `articles`, `onSelectCluster` match
- `initialSelectedId` / `onInitialClusterHandled` defined and consumed in Task 3 — match
- `CircleData` type defined in Task 2, used only within `ContentMapView` — no cross-task leakage
- `BLANK_KW` constant typed as `ClusterKeyword` — matches `{ termo: '', intencao: 'informacional' }`
