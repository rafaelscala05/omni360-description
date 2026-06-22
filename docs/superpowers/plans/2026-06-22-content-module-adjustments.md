# Ajustes no Módulo de Conteúdo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refinar o módulo Alfred com: nova navegação (Produção de Artigos + Calendário mensal), pipeline reordenado (imagem por último), campo de horário agendado, produtos vinculados, estilo de imagem, e melhorias no ClusterDetailView.

**Architecture:** Mudanças puras de UI/lógica cliente-server; sem novos endpoints. Cada task é independente e compilável. A ordem garante que tipos sejam definidos antes de serem consumidos.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Firebase Firestore, Lucide React, Express (server/contentAgent.ts), @google/genai.

## Global Constraints

- Todo texto de UI em português do Brasil (pt-BR).
- Sem criar novos endpoints Express — apenas lógica interna de funções existentes.
- `npm run lint` (tsc --noEmit) deve passar ao final de cada task.
- Campos novos em tipos Firestore são opcionais (`?`) para retrocompatibilidade.
- Não alterar lógica de auth, créditos, DashboardPanel, IntegrationsView, TagInput.

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `src/modules/content/types.ts` | Modificar — + `scheduledTime`, `produtosVinculados`, `estiloImagem` |
| `src/services/contentService.ts` | Modificar — + `moveArticle` |
| `src/modules/content/OnboardingWizard.tsx` | Modificar — + seleção de `estiloImagem` no passo 1 |
| `src/modules/content/ProfileSummary.tsx` | Modificar — + exibe `estiloImagem` |
| `src/modules/content/ArticleView.tsx` | Modificar — reordem STAGES, + produtos, + editar título |
| `src/modules/content/ArticlesProductionView.tsx` | Criar — lista com cluster badge, reagendar, editar título |
| `src/modules/content/CalendarView.tsx` | Substituir — grid mensal (a atual lógica de lista vai para ArticlesProductionView) |
| `src/modules/content/ClusterDetailView.tsx` | Modificar — + botões Mover/Visualizar, novas props |
| `src/modules/content/ClustersView.tsx` | Modificar — + prop `onGoArticle`, passa `allClusters` |
| `src/modules/content/ContentApp.tsx` | Modificar — + view `producao`, callbacks de navegação, sidebar renomeado |
| `server/contentAgent.ts` | Modificar — respeita `scheduledTime`; `estiloImagem` no prompt; reordena pipeline |

---

## Task 1: Atualizar tipos (`types.ts`)

**Files:**
- Modify: `src/modules/content/types.ts`

**Interfaces:**
- Produces: `CalendarArticle.scheduledTime`, `CalendarArticle.produtosVinculados`, `ContentProjectConfig.estiloImagem` — usados por todas as tasks seguintes.

- [ ] **Step 1: Adicionar campos em `CalendarArticle`**

Em `src/modules/content/types.ts`, logo após `scheduledDate: string;` (linha 88), adicionar:

```ts
scheduledTime?: string;        // "HH:MM" — hora de publicação
produtosVinculados?: string[]; // nomes/IDs de produtos vinculados
```

- [ ] **Step 2: Adicionar `estiloImagem` em `ContentProjectConfig`**

Após `wordpressUser: string;` (linha 24), adicionar:

```ts
estiloImagem?: 'Realista' | 'Ilustracao' | '3D' | 'Cartoon';
```

- [ ] **Step 3: Verificar compilação**

```bash
npm run lint
```

Esperado: sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/modules/content/types.ts
git commit -m "feat(content): add scheduledTime, produtosVinculados, estiloImagem to types"
```

---

## Task 2: Adicionar `moveArticle` ao contentService

**Files:**
- Modify: `src/services/contentService.ts`

**Interfaces:**
- Produces: `moveArticle(uid, projectId, articleId, novoClusterId): Promise<void>` — usado em Task 7.

- [ ] **Step 1: Adicionar função após `updateArticle`**

Em `src/services/contentService.ts`, após a função `updateArticle` (após linha 151), inserir:

```ts
export async function moveArticle(
  uid: string,
  projectId: string,
  articleId: string,
  novoClusterId: string,
): Promise<void> {
  await updateDoc(doc(db, `users/${uid}/contentProjects/${projectId}/calendar/${articleId}`), {
    clusterId: novoClusterId,
    updatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/services/contentService.ts
git commit -m "feat(content): add moveArticle service function"
```

---

## Task 3: Estilo de imagem no Wizard e ProfileSummary

**Files:**
- Modify: `src/modules/content/OnboardingWizard.tsx`
- Modify: `src/modules/content/ProfileSummary.tsx`

**Interfaces:**
- Consumes: `ContentProjectConfig.estiloImagem` (Task 1)

- [ ] **Step 1: Adicionar constante de estilos e campo no wizard**

Em `src/modules/content/OnboardingWizard.tsx`:

1. Adicionar constante após `FREQUENCIAS` (linha ~27):

```ts
const ESTILOS_IMAGEM = ['Realista', 'Ilustracao', '3D', 'Cartoon'] as const;
type EstiloImagem = typeof ESTILOS_IMAGEM[number];
```

2. Adicionar estado após `frequenciaPostagens` (linha ~54):

```ts
const [estiloImagem, setEstiloImagem] = useState<EstiloImagem | undefined>(c?.estiloImagem);
```

3. Em `buildConfig()`, adicionar o campo:

```ts
estiloImagem,
```

4. No step 1 (bloco `step === 0`), após o campo "Principal produto ou serviço", adicionar:

```tsx
<div>
  <label className="block text-sm font-semibold text-slate-700 mb-2">Estilo de imagem</label>
  <div className="flex flex-wrap gap-2">
    {ESTILOS_IMAGEM.map((e) => (
      <button
        key={e}
        type="button"
        onClick={() => setEstiloImagem(e)}
        className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-all ${estiloImagem === e ? 'border-[#004ac6] bg-[#004ac6] text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-[#004ac6] hover:text-[#004ac6]'}`}
      >
        {e === 'Ilustracao' ? 'Ilustração' : e}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 2: Exibir `estiloImagem` no ProfileSummary**

Em `src/modules/content/ProfileSummary.tsx`:

1. Adicionar import de `ImageIcon` ao import de lucide-react existente (linha 2):

```ts
import { Building2, Users, Megaphone, Target, KeyRound, LinkIcon, CalendarClock, ImageIcon } from 'lucide-react';
```

2. Antes do `</div>` final do componente `ProfileSummary` (após a Row de frequência), adicionar:

```tsx
{config.estiloImagem && (
  <Row icon={<ImageIcon className="w-4 h-4" />} label="Estilo de imagem">
    <Chips items={[config.estiloImagem === 'Ilustracao' ? 'Ilustração' : config.estiloImagem]} />
  </Row>
)}
```

- [ ] **Step 3: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/content/OnboardingWizard.tsx src/modules/content/ProfileSummary.tsx
git commit -m "feat(content): add estiloImagem field in wizard and profile summary"
```

---

## Task 4: Atualizar `ArticleView.tsx` — pipeline reordenado + produtos + editar título

**Files:**
- Modify: `src/modules/content/ArticleView.tsx`

**Interfaces:**
- Consumes: `CalendarArticle.produtosVinculados` (Task 1), `updateArticle` (contentService existente)

- [ ] **Step 1: Reordenar STAGES**

Substituir a linha 13 de `ArticleView.tsx`:

```ts
const STAGES = ['Pesquisa', 'Outline', 'Rascunho', 'Imagem', 'Revisão'];
```

por:

```ts
const STAGES = ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem'];
```

- [ ] **Step 2: Adicionar estado para edição de título e produtos**

Adicionar após `const [error, setError] = useState<string | null>(null);` (linha ~19):

```ts
const [editingTitle, setEditingTitle] = useState(false);
const [titleDraft, setTitleDraft] = useState(article.titulo);
const [produtos, setProdutos] = useState<string>(
  (article.produtosVinculados ?? []).join(', '),
);
```

- [ ] **Step 3: Adicionar edição inline de título no header**

Substituir o bloco de título no header (linha ~39):

```tsx
<h2 className="font-display text-lg font-bold text-slate-900 truncate">{article.titulo}</h2>
```

por:

```tsx
{editingTitle ? (
  <div className="flex items-center gap-1.5 flex-1 min-w-0">
    <input
      autoFocus
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          run('title', () => updateArticle(uid, projectId, article.id, { titulo: titleDraft }));
          setEditingTitle(false);
        }
        if (e.key === 'Escape') { setTitleDraft(article.titulo); setEditingTitle(false); }
      }}
      className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
    />
    <button
      onClick={() => { run('title', () => updateArticle(uid, projectId, article.id, { titulo: titleDraft })); setEditingTitle(false); }}
      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
    >
      <Check className="w-4 h-4" />
    </button>
    <button onClick={() => { setTitleDraft(article.titulo); setEditingTitle(false); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
      <X className="w-4 h-4" />
    </button>
  </div>
) : (
  <div className="flex items-center gap-1.5 min-w-0">
    <h2 className="font-display text-lg font-bold text-slate-900 truncate">{article.titulo}</h2>
    <button onClick={() => setEditingTitle(true)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded shrink-0">
      <Pencil className="w-3.5 h-3.5" />
    </button>
  </div>
)}
```

Adicionar `Pencil` ao import de lucide-react (já tem `X`, `Check` — só adicionar `Pencil` se não existir).

- [ ] **Step 4: Adicionar campo de produtos vinculados**

No body do modal (antes do campo "Conteúdo final"), adicionar:

```tsx
<div>
  <label className="block text-sm font-medium text-slate-700 mb-1.5">Produtos vinculados</label>
  <input
    value={produtos}
    onChange={(e) => setProdutos(e.target.value)}
    onBlur={() => run('produtos', () => updateArticle(uid, projectId, article.id, {
      produtosVinculados: produtos.split(',').map((s) => s.trim()).filter(Boolean),
    }))}
    placeholder="Nome ou ID dos produtos, separados por vírgula"
    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
  />
</div>
```

- [ ] **Step 5: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/ArticleView.tsx
git commit -m "feat(content): reorder pipeline stages, add title edit and linked products"
```

---

## Task 5: Criar `ArticlesProductionView.tsx` (lista de artigos com melhorias)

**Files:**
- Create: `src/modules/content/ArticlesProductionView.tsx`

**Interfaces:**
- Consumes: `CalendarArticle`, `listenCalendar`, `generateCalendar`, `produceArticle`, `updateArticle` — todos já existentes.
- Consumes: `ContentCluster` — para exibir nome do cluster.
- Props recebidas do ContentApp: `uid`, `projectId`, `clusters: ContentCluster[]`, `initialOpenId?: string`, `onGoCluster(clusterId: string): void`.

- [ ] **Step 1: Criar o arquivo**

Criar `src/modules/content/ArticlesProductionView.tsx` com o seguinte conteúdo:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock,
} from 'lucide-react';
import type { CalendarArticle, ArticleStatus, ContentCluster } from './types';
import { listenCalendar, generateCalendar, produceArticle, updateArticle } from '../../services/contentService';
import ArticleView from './ArticleView';

interface Props {
  uid: string;
  projectId: string;
  clusters: ContentCluster[];
  initialOpenId?: string;
  onGoCluster: (clusterId: string) => void;
}

const STATUS_LABEL: Record<ArticleStatus, string> = {
  agendado: 'Agendado',
  em_producao: 'Em produção',
  revisao: 'Revisão',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  erro: 'Erro',
};

const STATUS_STYLE: Record<ArticleStatus, string> = {
  agendado: 'bg-slate-100 text-slate-600',
  em_producao: 'bg-amber-100 text-amber-700',
  revisao: 'bg-indigo-100 text-indigo-700',
  aprovado: 'bg-emerald-100 text-emerald-700',
  publicado: 'bg-[#004ac6] text-white',
  erro: 'bg-red-100 text-red-700',
};

function formatDateTime(date: string, time?: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return time ? `${day} · ${time}` : day;
}

const ArticlesProductionView: React.FC<Props> = ({ uid, projectId, clusters, initialOpenId, onGoCluster }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producing, setProducing] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(initialOpenId ?? null);

  // Reschedule modal state
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedTime, setReschedTime] = useState('');

  // Inline title edit state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  const didOpenInitial = useRef(false);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  useEffect(() => {
    if (initialOpenId && !didOpenInitial.current && articles.length) {
      didOpenInitial.current = true;
      setSelected(initialOpenId);
    }
  }, [initialOpenId, articles]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      await generateCalendar(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar calendário');
    } finally {
      setLoading(false);
    }
  };

  const handleProduce = async (articleId: string) => {
    setProducing((p) => ({ ...p, [articleId]: true }));
    setError(null);
    try {
      await produceArticle(projectId, articleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao produzir artigo');
    } finally {
      setProducing((p) => ({ ...p, [articleId]: false }));
    }
  };

  const openReschedule = (a: CalendarArticle) => {
    setReschedulingId(a.id);
    setReschedDate(a.scheduledDate);
    setReschedTime(a.scheduledTime ?? '');
  };

  const confirmReschedule = async () => {
    if (!reschedulingId || !reschedDate) return;
    await updateArticle(uid, projectId, reschedulingId, {
      scheduledDate: reschedDate,
      scheduledTime: reschedTime || undefined,
    });
    setReschedulingId(null);
  };

  const startTitleEdit = (a: CalendarArticle) => {
    setEditingTitleId(a.id);
    setTitleDraft(a.titulo);
  };

  const saveTitleEdit = async () => {
    if (!editingTitleId || !titleDraft.trim()) return;
    await updateArticle(uid, projectId, editingTitleId, { titulo: titleDraft.trim() });
    setEditingTitleId(null);
  };

  const selectedArticle = articles.find((a) => a.id === selected) ?? null;
  const clusterName = (clusterId: string) => clusters.find((c) => c.id === clusterId)?.nome ?? null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Produção de Artigos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Artigos agendados. Produza manualmente ou aguarde a automação na data.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-lg shadow-sm transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {articles.length ? 'Regerar calendário' : 'Gerar calendário'}
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {!articles.length && !loading && (
        <div className="text-center py-16 text-slate-400">
          <CalendarDays className="w-10 h-10 mx-auto mb-3" />
          <p className="text-sm">Nenhum artigo agendado. Aprove clusters e gere o calendário.</p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">
        {articles.map((a) => {
          const cName = clusterName(a.clusterId);
          return (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
              {/* Date + time */}
              <div className="text-xs font-medium text-slate-500 w-24 shrink-0">
                {formatDateTime(a.scheduledDate, a.scheduledTime)}
              </div>

              {/* Title (inline edit) + cluster badge */}
              <div className="flex-1 min-w-0">
                {editingTitleId === a.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setEditingTitleId(null); }}
                      className="flex-1 border border-slate-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                    />
                    <button onClick={saveTitleEdit} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingTitleId(null)} className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => setSelected(a.id)} className="text-sm font-medium text-slate-900 hover:text-[#004ac6] truncate text-left">
                      {a.titulo}
                    </button>
                    <button onClick={() => startTitleEdit(a)} className="p-0.5 text-slate-300 hover:text-slate-600 rounded shrink-0">
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal}{a.status === 'em_producao' ? ` · etapa ${a.stage}/5` : ''}</span>
                  {cName && (
                    <button
                      onClick={() => onGoCluster(a.clusterId)}
                      className="text-[11px] font-medium text-[#004ac6] bg-[#eef3ff] px-1.5 py-0.5 rounded hover:bg-[#cdddff] transition-colors"
                    >
                      {cName}
                    </button>
                  )}
                </div>
              </div>

              {/* Status */}
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>
                {STATUS_LABEL[a.status]}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openReschedule(a)}
                  title="Reagendar"
                  className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                </button>
                {(a.status === 'agendado' || a.status === 'erro') && (
                  <button
                    onClick={() => handleProduce(a.id)}
                    disabled={producing[a.id]}
                    title="Produzir agora"
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60 transition-colors"
                  >
                    {producing[a.id] ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Produzir
                  </button>
                )}
                {(a.status === 'revisao' || a.status === 'aprovado' || a.status === 'publicado') && (
                  <button
                    onClick={() => setSelected(a.id)}
                    title="Ver artigo"
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" /> Ver
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reschedule modal */}
      {reschedulingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setReschedulingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-slate-900 mb-4">Reagendar artigo</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
                <input
                  type="date"
                  value={reschedDate}
                  onChange={(e) => setReschedDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Horário</label>
                <input
                  type="time"
                  value={reschedTime}
                  onChange={(e) => setReschedTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setReschedulingId(null)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancelar</button>
              <button onClick={confirmReschedule} className="px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] rounded-lg">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {selectedArticle && (
        <ArticleView uid={uid} projectId={projectId} article={selectedArticle} onClose={() => setSelected(null)} />
      )}
    </div>
  );
};

export default ArticlesProductionView;
```

- [ ] **Step 2: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/content/ArticlesProductionView.tsx
git commit -m "feat(content): create ArticlesProductionView with cluster badge, reschedule, title edit"
```

---

## Task 6: Refatorar `CalendarView.tsx` → grid mensal

**Files:**
- Modify: `src/modules/content/CalendarView.tsx` (substituição completa)

**Interfaces:**
- Consumes: `CalendarArticle`, `listenCalendar`.
- Props: `uid`, `projectId`, `onOpenArticle(articleId: string): void`.

- [ ] **Step 1: Substituir CalendarView.tsx**

Substituir todo o conteúdo de `src/modules/content/CalendarView.tsx` por:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { CalendarArticle, ArticleStatus } from './types';
import { listenCalendar } from '../../services/contentService';

interface Props {
  uid: string;
  projectId: string;
  onOpenArticle: (articleId: string) => void;
}

const STATUS_DOT: Record<ArticleStatus, string> = {
  agendado: 'bg-slate-400',
  em_producao: 'bg-amber-400',
  revisao: 'bg-indigo-400',
  aprovado: 'bg-emerald-400',
  publicado: 'bg-[#004ac6]',
  erro: 'bg-red-400',
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const CalendarView: React.FC<Props> = ({ uid, projectId, onOpenArticle }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarArticle[]>();
    for (const a of articles) {
      const key = a.scheduledDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [articles]);

  const prev = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const next = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const totalDays = daysInMonth(year, month);
  const startOffset = firstDayOfWeek(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Calendário</h1>
          <p className="text-sm text-slate-500 mt-0.5">Visualize quando cada artigo será publicado.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <button onClick={prev} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-800 capitalize">{monthLabel}</span>
          <button onClick={next} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-slate-100">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[11px] font-bold text-slate-400 uppercase tracking-wider">{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-slate-100 bg-slate-50/50" />
          ))}
          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const iso = toIso(year, month, day);
            const dayArticles = byDate.get(iso) ?? [];
            const isToday = iso === toIso(now.getFullYear(), now.getMonth(), now.getDate());
            return (
              <div key={day} className={`min-h-[80px] p-1.5 border-b border-r border-slate-100 ${isToday ? 'bg-[#eef3ff]' : ''}`}>
                <span className={`inline-block text-xs font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-[#004ac6] text-white' : 'text-slate-500'}`}>{day}</span>
                <div className="space-y-0.5">
                  {dayArticles.slice(0, 3).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onOpenArticle(a.id)}
                      className="w-full flex items-center gap-1 text-left px-1 py-0.5 rounded hover:bg-white/80 transition-colors group"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
                      <span className="text-[10px] text-slate-700 truncate group-hover:text-[#004ac6]">{a.titulo}</span>
                    </button>
                  ))}
                  {dayArticles.length > 3 && (
                    <span className="text-[10px] text-slate-400 pl-1">+{dayArticles.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!articles.length && (
        <div className="text-center py-12 text-slate-400 mt-4">
          <CalendarDays className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">Nenhum artigo agendado ainda.</p>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
```

- [ ] **Step 2: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/content/CalendarView.tsx
git commit -m "feat(content): refactor CalendarView into monthly grid"
```

---

## Task 7: Atualizar `ClusterDetailView.tsx` — botões Mover e Visualizar

**Files:**
- Modify: `src/modules/content/ClusterDetailView.tsx`

**Interfaces:**
- Consumes: `moveArticle(uid, projectId, articleId, novoClusterId)` (Task 2), `ContentCluster` (tipo existente).
- New props: `allClusters: ContentCluster[]`, `onGoArticle: (id: string) => void`.

- [ ] **Step 1: Adicionar novas props à interface**

Substituir a interface `Props` (linhas 23–29):

```ts
interface Props {
  uid: string;
  projectId: string;
  cluster: ContentCluster;
  articles: CalendarArticle[]; // already filtered to this cluster
  allClusters: ContentCluster[];
  onBack: () => void;
  onGoArticle: (id: string) => void;
}
```

- [ ] **Step 2: Adicionar imports necessários**

No topo de `ClusterDetailView.tsx`, substituir o import de lucide-react:

```ts
import { ArrowLeft, ExternalLink, FileText, MoveRight, TrendingUp } from 'lucide-react';
```

Adicionar import de `moveArticle`:

```ts
import { moveArticle } from '../../services/contentService';
```

- [ ] **Step 3: Adicionar estado do modal "Mover"**

Logo após as declarações de estado existentes em `ClusterDetailView` (após linha ~32):

```ts
const [movingArticleId, setMovingArticleId] = useState<string | null>(null);
const [movingTargetClusterId, setMovingTargetClusterId] = useState('');
const [movingBusy, setMovingBusy] = useState(false);

const confirmMove = async () => {
  if (!movingArticleId || !movingTargetClusterId) return;
  setMovingBusy(true);
  try {
    await moveArticle(uid, projectId, movingArticleId, movingTargetClusterId);
  } finally {
    setMovingBusy(false);
    setMovingArticleId(null);
    setMovingTargetClusterId('');
  }
};

const availableClusters = allClusters.filter((c) => c.id !== cluster.id && !c.excluido);
```

- [ ] **Step 4: Atualizar signature do componente para receber as novas props**

Substituir:

```ts
const ClusterDetailView: React.FC<Props> = ({ uid, projectId, cluster, articles, onBack }) => {
```

por:

```ts
const ClusterDetailView: React.FC<Props> = ({ uid, projectId, cluster, articles, allClusters, onBack, onGoArticle }) => {
```

- [ ] **Step 5: Adicionar botões nos artigos vinculados**

Substituir o botão de cada artigo na seção "Artigos vinculados" (o `<button key={a.id} ...>` atual):

```tsx
<div key={a.id} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
  <div className="flex-1 min-w-0">
    <span className="text-sm font-medium text-slate-900 truncate block">{a.titulo}</span>
    <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal} · {a.scheduledDate}</span>
  </div>
  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>{a.status}</span>
  <div className="flex items-center gap-1 shrink-0">
    <button
      onClick={() => onGoArticle(a.id)}
      title="Visualizar artigo"
      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
    >
      <ExternalLink className="w-3.5 h-3.5" /> Ver
    </button>
    {availableClusters.length > 0 && (
      <button
        onClick={() => { setMovingArticleId(a.id); setMovingTargetClusterId(''); }}
        title="Mover para outro cluster"
        className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
      >
        <MoveRight className="w-3.5 h-3.5" /> Mover
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 6: Adicionar modal "Mover artigo" antes do `{selectedArticle && ...}` no return**

```tsx
{movingArticleId && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMovingArticleId(null)}>
    <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-display text-lg font-bold text-slate-900 mb-4">Mover artigo para outro cluster</h3>
      <select
        value={movingTargetClusterId}
        onChange={(e) => setMovingTargetClusterId(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] mb-4"
      >
        <option value="">Selecionar cluster…</option>
        {availableClusters.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button onClick={() => setMovingArticleId(null)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancelar</button>
        <button
          onClick={confirmMove}
          disabled={!movingTargetClusterId || movingBusy}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-lg"
        >
          {movingBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoveRight className="w-4 h-4" />} Mover
        </button>
      </div>
    </div>
  </div>
)}
```

Adicionar `RefreshCw` ao import de lucide-react.

- [ ] **Step 7: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/content/ClusterDetailView.tsx
git commit -m "feat(content): add Move and View buttons to linked articles in ClusterDetailView"
```

---

## Task 8: Atualizar `ClustersView.tsx` — propagar `onGoArticle` e `allClusters`

**Files:**
- Modify: `src/modules/content/ClustersView.tsx`

**Interfaces:**
- Consumes: `onGoArticle: (id: string) => void` — vem de ContentApp via prop.
- Passes to: `ClusterDetailView` as `allClusters` + `onGoArticle`.

- [ ] **Step 1: Adicionar `onGoArticle` às props de ClustersView**

Substituir a interface Props (linhas 12–15):

```ts
interface Props {
  uid: string;
  projectId: string;
  onGoArticle: (id: string) => void;
}
```

- [ ] **Step 2: Destruturar a nova prop no componente**

Substituir:

```ts
const ClustersView: React.FC<Props> = ({ uid, projectId }) => {
```

por:

```ts
const ClustersView: React.FC<Props> = ({ uid, projectId, onGoArticle }) => {
```

- [ ] **Step 3: Passar `allClusters` e `onGoArticle` para ClusterDetailView**

Substituir o bloco que renderiza `<ClusterDetailView` (linhas ~58–65):

```tsx
return (
  <ClusterDetailView
    uid={uid}
    projectId={projectId}
    cluster={selectedCluster}
    articles={articles.filter((a) => a.clusterId === selectedCluster.id)}
    allClusters={active}
    onBack={() => setSelectedId(null)}
    onGoArticle={onGoArticle}
  />
);
```

- [ ] **Step 4: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/ClustersView.tsx
git commit -m "feat(content): pass onGoArticle and allClusters to ClusterDetailView"
```

---

## Task 9: Atualizar `ContentApp.tsx` — nova navegação e callbacks

**Files:**
- Modify: `src/modules/content/ContentApp.tsx`

**Interfaces:**
- Consumes: `ArticlesProductionView` (Task 5), `CalendarView` com nova prop `onOpenArticle` (Task 6), `ClustersView` com nova prop `onGoArticle` (Task 8).

- [ ] **Step 1: Adicionar imports e atualizar tipo ContentView**

Substituir os imports de views no topo do arquivo. Adicionar:

```ts
import ArticlesProductionView from './ArticlesProductionView';
```

Atualizar o tipo:

```ts
type ContentView = 'dashboard' | 'clusters' | 'producao' | 'calendar' | 'integrations' | 'settings';
```

- [ ] **Step 2: Adicionar estado `openArticleId`**

Após `const [view, setView] = useState<ContentView>('dashboard');` adicionar:

```ts
const [openArticleId, setOpenArticleId] = useState<string | null>(null);
```

Criar a função de navegação para artigos:

```ts
const goToArticle = (articleId: string) => {
  setOpenArticleId(articleId);
  setView('producao');
};

const goToCluster = (clusterId: string) => {
  setView('clusters');
  // ClustersView gerencia selectedId internamente; passamos via URL state não é necessário aqui
  // O usuário navega para a aba de clusters e o ClusterDetailView já está visível via selectedId interno
};
```

- [ ] **Step 3: Atualizar navegação do sidebar**

Substituir o bloco `<nav>` (linhas ~122–130):

```tsx
<nav className="mt-2 px-3 flex flex-col gap-1 flex-1">
  {navItem('dashboard', 'Painel', LayoutDashboard)}
  {navItem('clusters', 'Clusters', Layers)}
  {navItem('producao', 'Produção de Artigos', FileText)}
  {navItem('calendar', 'Calendário', CalendarDays)}
  <div className="my-2 border-t border-white/5 mx-4" />
  {navItem('integrations', 'Integrações', Plug)}
  {navItem('settings', 'Configurações', Settings)}
</nav>
```

Adicionar `FileText` ao import de lucide-react no topo do arquivo.

- [ ] **Step 4: Atualizar o bloco de renderização de views**

Substituir o bloco `view === 'calendar'` e demais views no `<main>`:

```tsx
) : view === 'dashboard' ? (
  <DashboardPanel uid={uid} projectId={selected.id} empresa={selected.config.nomeEmpresa} />
) : view === 'clusters' ? (
  <ClustersView uid={uid} projectId={selected.id} onGoArticle={goToArticle} />
) : view === 'producao' ? (
  <ArticlesProductionView
    uid={uid}
    projectId={selected.id}
    clusters={[]}
    initialOpenId={openArticleId ?? undefined}
    onGoCluster={goToCluster}
  />
) : view === 'calendar' ? (
  <CalendarView uid={uid} projectId={selected.id} onOpenArticle={goToArticle} />
) : view === 'integrations' ? (
  <IntegrationsView uid={uid} project={selected} />
) : (
  <CompanyProfile uid={uid} project={selected} onGoClusters={() => setView('clusters')} />
)
```

**Nota:** `ArticlesProductionView` precisa da lista de clusters para mostrar o badge. Precisamos carregar os clusters no `ContentApp`. Adicionar:

```ts
const [clusters, setClusters] = useState<import('./types').ContentCluster[]>([]);

useEffect(() => {
  if (!selectedId) return;
  return listenClusters(uid, selectedId, setClusters);
}, [uid, selectedId]);
```

E importar `listenClusters` do contentService:

```ts
import { listenProjects, listenClusters } from '../../services/contentService';
import type { ContentCluster } from './types';
```

Então passar `clusters={clusters}` para `ArticlesProductionView`.

Também resetar `openArticleId` quando a view muda:

```ts
const navItem = (key: ContentView, label: string, Icon: React.ElementType) => (
  <button
    onClick={() => { setView(key); setIsSidebarOpen(false); if (key !== 'producao') setOpenArticleId(null); }}
    ...
  >
```

- [ ] **Step 5: Verificar compilação**

```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/ContentApp.tsx
git commit -m "feat(content): add Producao de Artigos view, calendar nav, goToArticle callbacks"
```

---

## Task 10: Atualizar `server/contentAgent.ts` — pipeline reordenado + scheduledTime + estiloImagem

**Files:**
- Modify: `server/contentAgent.ts`

**Interfaces:**
- Consumes: `CalendarArticle.scheduledTime` (Task 1), `ContentProjectConfig.estiloImagem` (Task 1).

- [ ] **Step 1: Respeitar `scheduledTime` em `generateCalendar`**

Em `generateCalendar`, ao criar cada artigo (bloco `topics.map`, linha ~475), substituir:

```ts
const article: CalendarArticle = {
  id: ref.id,
  titulo: topic.titulo,
  kwPrincipal: topic.kwPrincipal,
  clusterId: topic.clusterId,
  scheduledDate: toIsoDate(date),
  status: 'agendado',
  stage: 0,
  createdAt: now,
  updatedAt: now,
};
```

por:

```ts
const defaultTime = project.config.frequenciaPostagens?.includes('diár') ? '08:00' : '09:00';
const article: CalendarArticle = {
  id: ref.id,
  titulo: topic.titulo,
  kwPrincipal: topic.kwPrincipal,
  clusterId: topic.clusterId,
  scheduledDate: toIsoDate(date),
  scheduledTime: defaultTime,
  status: 'agendado',
  stage: 0,
  createdAt: now,
  updatedAt: now,
};
```

- [ ] **Step 2: Reordenar pipeline em `runArticlePipeline` — trocar Imagem e Revisão**

Em `runArticlePipeline`, substituir as etapas 4 e 5 (linhas ~554–596). O bloco atual:

```
ETAPA 4 — Cover image (stage 4)
ETAPA 5 — Review + humanization (stage 5 → status 'revisao')
```

Deve ser substituído por:

```ts
// ETAPA 4 — Review + humanization
const articleFinal = await generateText(
  [
    'Revise e humanize o artigo abaixo: elimine construções típicas de IA, adicione opiniões assertivas e exemplos concretos, mantenha o tom de voz.',
    'Ao final, em uma linha separada, forneça: SLUG: <slug-amigavel> e META: <meta description>.',
    `ARTIGO:\n${articleDraft}`,
  ].join('\n\n'),
  { systemInstruction: sys, temperature: 0.6 },
);

const slug = articleFinal.match(/SLUG:\s*([a-z0-9-]+)/i)?.[1];
const metaDescription = articleFinal.match(/META:\s*(.+)/i)?.[1]?.trim();

await setStage(4, { articleFinal, slug: slug ?? undefined, metaDescription: metaDescription ?? undefined });

// ETAPA 5 — Cover image
const estiloLabel = project.config.estiloImagem
  ? project.config.estiloImagem === 'Ilustracao' ? 'Ilustração' : project.config.estiloImagem
  : 'fotorrealista';

let imageUrl: string | undefined;
try {
  const imgPrompt = [
    `Imagem de capa para um artigo de blog sobre "${article.titulo}".`,
    `Contexto do artigo: ${articleFinal.slice(0, 500)}.`,
    `Estilo visual: ${estiloLabel}. Composição limpa, elementos simbólicos do tema, sem texto e sem rostos hiperrealistas.`,
    `Marca: ${project.config.nomeEmpresa}. Formato 16:9, alta resolução.`,
  ].join(' ');
  const base64 = await generateImageBase64(imgPrompt);
  imageUrl = saveImage(base64, uploadsDir, baseUrl);
  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentImage, { productName: article.titulo });
} catch (e) {
  console.error('content image generation failed:', e);
}

await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentArticle, { productName: article.titulo });
await artRef.update({
  stage: 5,
  status: 'revisao',
  imageUrl: imageUrl ?? null,
  lastError: null,
  updatedAt: new Date().toISOString(),
});
```

Remover o bloco original de crédito `contentArticle` que ficava no final da etapa 5, pois foi incluído acima.

- [ ] **Step 3: Verificar compilação TypeScript do servidor**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add server/contentAgent.ts
git commit -m "feat(content): reorder pipeline (review before image), add scheduledTime and estiloImagem to AI"
```

---

## Verificação final

- [ ] Executar `npm run lint` e confirmar zero erros.
- [ ] Executar `npm run dev` e verificar:
  - Sidebar mostra "Produção de Artigos" e "Calendário" (separados).
  - "Produção de Artigos" exibe badge do cluster clicável e botão Reagendar.
  - "Calendário" exibe grid mensal; clicar em artigo abre ArticleView.
  - Wizard de configuração mostra seleção de estilo de imagem.
  - ClusterDetailView mostra botões "Ver" e "Mover" nos artigos.
  - ArticleView mostra STAGES na ordem: Pesquisa, Outline, Rascunho, Revisão, Imagem.
