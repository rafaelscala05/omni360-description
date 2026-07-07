# Tutorial Tab v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `src/components/tutorial/TutorialView.tsx` so the tutorial recreates the real catalog table and the real `ProductEditModal` chrome (header, sidebar tabs Geral/Atributos/Conteúdo/Imagens/Vídeo) instead of a generic wizard, per `docs/superpowers/specs/2026-07-07-tutorial-tab-design-v2.md`.

**Architecture:** Same file, same isolated local-state component, same `TutorialViewProps { onFinish }`. Internal navigation changes from a linear step index to a `screen: 'welcome' | 'catalog' | 'modal' | 'done'` state, with a nested `activeTab: 'geral' | 'atributos' | 'conteudo' | 'imagens' | 'video'` state while `screen === 'modal'`. All visual chrome (table columns, action button styles, modal header, sidebar tab styles, per-tab hero headers) is copied verbatim (classes) from `src/App.tsx` (table, lines ~2876-2891 header / ~2934-3113 row) and `src/components/modals/ProductEditModal.tsx` (header ~505-550, sidebar ~552-597, tabs content ~647-1178).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react icons.

## Global Constraints

- No automated test suite; verification is `npm run lint` (tsc --noEmit) plus manual `npm run dev` check in the browser.
- Zero real API calls, zero Firebase/Firestore access, zero credit spend — pure local state + `setTimeout`, same as v1.
- Portuguese (Brazilian) UI text throughout.
- Reuse the existing `#FF5B03` accent and the exact class patterns from the real table/modal so the tutorial is visually indistinguishable from the real screens it mimics.
- Video asset path stays `/tutorial/demo-video.mp4` with the same `onError` fallback behavior already implemented — this task does not change that.
- Do not replicate `WYSIWYGEditor` or the full `VideoGenerationTab` script/shot-selection flow — out of scope per spec v2.

---

### Task 1: Rewrite the shell — screen state machine, Welcome/Done screens, Catalog screen, Modal chrome with placeholder tabs

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx` (full rewrite)

**Interfaces:**
- Consumes: nothing beyond `onFinish: () => void`.
- Produces:
  - `type Screen = 'welcome' | 'catalog' | 'modal' | 'done';`
  - `type ModalTab = 'geral' | 'atributos' | 'conteudo' | 'imagens' | 'video';`
  - State: `screen`, `activeTab`, plus all per-tab state (`descriptionLoading/Generated`, `attributesLoading/Generated`, `confirmedAttrs: Set<string>`, `imagesLoading/Generated`, `videoStatus/videoStepLabel/videoError`) — declared in this task, consumed by Tasks 2-5 which fill in the tab bodies.
  - `openModal(tab: ModalTab)` — sets `activeTab` and `screen = 'modal'`. Used by the catalog row's action buttons.
  - `restart()` — resets every piece of state back to initial and `screen = 'welcome'`.
  - `attributesDone: boolean` — `confirmedAttrs.size === MOCK_ATTRIBUTES.length && MOCK_ATTRIBUTES.length > 0`, used by both the catalog status chips and the modal sidebar checkmark.

- [ ] **Step 1: Replace the entire file**

```tsx
// src/components/tutorial/TutorialView.tsx
import React, { useState } from 'react';
import {
  GraduationCap, ArrowRight, ArrowLeft, CheckCircle2, Image as ImageIcon,
  Sparkles, Loader2, Play, Eye, Tag, Layout, Video, Wand2, Save,
} from 'lucide-react';

interface TutorialViewProps {
  onFinish: () => void;
}

type Screen = 'welcome' | 'catalog' | 'modal' | 'done';
type ModalTab = 'geral' | 'atributos' | 'conteudo' | 'imagens' | 'video';

const MOCK_PRODUCT = {
  sku: 'TENIS-AZUL-42',
  rawName: 'TENIS ESPORTIVO MASC AZUL 42',
};

const MOCK_DESCRIPTION_HTML = `<p><strong>Tênis Esportivo Masculino Azul</strong> desenvolvido para quem busca conforto e desempenho no dia a dia. Cabedal em mesh respirável, entressola com amortecimento em EVA e solado antiderrapante.</p><ul><li>Material: mesh + sintético</li><li>Solado: borracha antiderrapante</li><li>Indicado para caminhada e uso casual</li></ul>`;

const MOCK_SEO = {
  title: 'Tênis Esportivo Masculino Azul 42 | Conforto no Dia a Dia',
  metaDescription: 'Tênis esportivo masculino azul, tam. 42, com cabedal em mesh respirável e solado antiderrapante. Confira agora.',
};

const MOCK_ATTRIBUTES: { key: string; label: string; value: string }[] = [
  { key: 'cor', label: 'Cor', value: 'Azul' },
  { key: 'material', label: 'Material', value: 'Mesh' },
  { key: 'tamanho', label: 'Tamanho', value: '42' },
  { key: 'genero', label: 'Gênero', value: 'Masculino' },
];

const MOCK_CATEGORY_PATH = ['Calçados', 'Esportivo', 'Tênis'];

const MODAL_TABS: { id: ModalTab; label: string; icon: React.ElementType }[] = [
  { id: 'geral', label: 'Geral', icon: Layout },
  { id: 'atributos', label: 'Atributos', icon: Tag },
  { id: 'conteudo', label: 'Conteúdo', icon: Sparkles },
  { id: 'imagens', label: 'Imagens', icon: ImageIcon },
  { id: 'video', label: 'Vídeo', icon: Video },
];

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [activeTab, setActiveTab] = useState<ModalTab>('geral');

  const [descriptionLoading, setDescriptionLoading] = useState(false);
  const [descriptionGenerated, setDescriptionGenerated] = useState(false);
  const simulateDescription = () => {
    setDescriptionLoading(true);
    setTimeout(() => {
      setDescriptionLoading(false);
      setDescriptionGenerated(true);
    }, 1200);
  };

  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesGenerated, setAttributesGenerated] = useState(false);
  const [confirmedAttrs, setConfirmedAttrs] = useState<Set<string>>(new Set());
  const simulateAttributes = () => {
    setAttributesLoading(true);
    setTimeout(() => {
      setAttributesLoading(false);
      setAttributesGenerated(true);
    }, 1200);
  };
  const confirmAttribute = (key: string) => {
    setConfirmedAttrs((prev) => new Set(prev).add(key));
  };
  const attributesDone = confirmedAttrs.size === MOCK_ATTRIBUTES.length && MOCK_ATTRIBUTES.length > 0;

  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesGenerated, setImagesGenerated] = useState(false);
  const simulateImages = () => {
    setImagesLoading(true);
    setTimeout(() => {
      setImagesLoading(false);
      setImagesGenerated(true);
    }, 1500);
  };

  const [videoStatus, setVideoStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [videoStepLabel, setVideoStepLabel] = useState('');
  const [videoError, setVideoError] = useState(false);
  const simulateVideo = () => {
    setVideoStatus('processing');
    const stages: [string, number][] = [
      ['Gerando roteiro...', 800],
      ['Renderizando cenas...', 1200],
      ['Gerando narração...', 800],
      ['Mixando áudio...', 600],
      ['Finalizando vídeo...', 600],
    ];
    let elapsed = 0;
    stages.forEach(([label, duration]) => {
      elapsed += duration;
      setTimeout(() => setVideoStepLabel(label), elapsed - duration);
    });
    setTimeout(() => setVideoStatus('done'), elapsed);
  };

  const openModal = (tab: ModalTab) => {
    setActiveTab(tab);
    setScreen('modal');
  };

  const restart = () => {
    setScreen('welcome');
    setActiveTab('geral');
    setDescriptionLoading(false);
    setDescriptionGenerated(false);
    setAttributesLoading(false);
    setAttributesGenerated(false);
    setConfirmedAttrs(new Set());
    setImagesLoading(false);
    setImagesGenerated(false);
    setVideoStatus('idle');
    setVideoStepLabel('');
    setVideoError(false);
  };

  if (screen === 'welcome') {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-10 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FF5B03]/10 flex items-center justify-center mb-4">
            <GraduationCap className="w-7 h-7 text-[#FF5B03]" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Bem-vindo ao tutorial</h2>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Vamos simular, com um produto fictício, a tela de catálogo e o
            editor de produto reais — gerando descrição, atributos, imagens
            ambientadas e vídeo. Nenhum crédito é gasto e nenhum dado real é
            alterado.
          </p>
          <button
            onClick={() => setScreen('catalog')}
            className="mt-6 flex items-center gap-1.5 mx-auto px-5 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Começar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'done') {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-10 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900">Tutorial concluído!</h2>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Você viu as telas reais de catálogo e edição de produto: descrição,
            atributos, imagens ambientadas e vídeo. Agora é só aplicar isso nos
            seus produtos de verdade.
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={restart}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Reiniciar tutorial
            </button>
            <button
              onClick={onFinish}
              className="px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
            >
              Ir para meus produtos
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'catalog') {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Catálogo de Produtos</h2>
            <p className="text-xs text-slate-500 mt-0.5">Assim é a tela onde você gerencia seus produtos de verdade.</p>
          </div>
          <button
            onClick={() => setScreen('done')}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Concluir tutorial
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#f7f9fb] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">IMG</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">SKU</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">Título</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">Categoria</th>
                <th className="px-4 py-3 font-bold text-slate-600 text-xs tracking-wider uppercase">Status</th>
                <th className="px-4 py-3 text-right font-bold text-slate-600 text-xs tracking-wider uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-[#f1f5f9]/60 transition-colors">
                <td className="px-4 py-3">
                  <div className="w-10 h-10 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">
                    <ImageIcon className="w-4 h-4 opacity-70" />
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600 font-medium">{MOCK_PRODUCT.sku}</td>
                <td className="px-4 py-3 text-slate-900">{MOCK_PRODUCT.rawName}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{attributesDone ? MOCK_CATEGORY_PATH.join(' > ') : '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {([
                      { on: descriptionGenerated, Icon: Sparkles, onClass: 'bg-orange-50 text-orange-700 border-orange-200/60' },
                      { on: attributesDone, Icon: Tag, onClass: 'bg-amber-50 text-amber-700 border-amber-200/60' },
                      { on: imagesGenerated, Icon: ImageIcon, onClass: 'bg-orange-50 text-orange-700 border-orange-200/60' },
                    ] as const).map(({ on, Icon, onClass }, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${on ? onClass : 'bg-slate-50 text-slate-300 border-slate-200/60'}`}
                      >
                        <Icon className="w-3 h-3" />
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => openModal('geral')}
                      className="text-[#FF5B03] hover:bg-orange-600 hover:text-white bg-orange-50 border border-orange-100 p-1.5 rounded-lg transition-all shadow-sm flex items-center justify-center w-8 h-8"
                      title="Visualizar Detalhes"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openModal('atributos')}
                      className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${attributesDone ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-white text-slate-400 border border-slate-200 hover:border-amber-300 hover:bg-amber-50'}`}
                      title="Gerar Atributos"
                    >
                      <Tag className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openModal('imagens')}
                      className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${imagesGenerated ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-white text-slate-400 border border-slate-200 hover:border-orange-300 hover:bg-orange-50'}`}
                      title="Gerar Imagens"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => openModal('conteudo')}
                        className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${descriptionGenerated ? 'bg-[#FF5B03]/10 text-[#FF5B03] border border-[#FF5B03]/20' : 'bg-white text-slate-400 border border-slate-200 hover:border-orange-300 hover:bg-orange-50'}`}
                        title="Gerar Descrição"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                      </button>
                      {!descriptionGenerated && !attributesDone && !imagesGenerated && (
                        <div className="absolute -top-9 right-0 px-2.5 py-1.5 bg-slate-900 text-white text-[10px] font-medium rounded-lg whitespace-nowrap shadow-lg">
                          Clique para abrir o produto
                          <div className="absolute top-full right-3 border-4 border-transparent border-t-slate-900" />
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setScreen('catalog')}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="h-8 w-px bg-slate-200 shrink-0" />
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-md bg-slate-100 flex items-center justify-center border border-slate-200 shrink-0">
                <ImageIcon className="w-5 h-5 text-slate-400" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm md:text-base font-bold text-slate-900 truncate">{MOCK_PRODUCT.rawName}</h1>
                <p className="text-[10px] text-slate-500 font-mono">SKU: {MOCK_PRODUCT.sku}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setScreen('done')}
              className="px-2.5 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors whitespace-nowrap"
            >
              Concluir tutorial
            </button>
            <button
              onClick={() => setScreen('catalog')}
              className="px-3 md:px-6 py-2 bg-[#FF5B03] text-white text-xs md:text-sm font-bold rounded-xl shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">Salvar e Fechar</span>
            </button>
          </div>
        </header>

        <div className="flex flex-col md:flex-row">
          <aside className="w-full md:w-56 bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-row md:flex-col p-2 md:p-4 gap-1.5 md:gap-2 shrink-0 overflow-x-auto">
            {MODAL_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const done =
                tab.id === 'atributos' ? attributesDone :
                tab.id === 'conteudo' ? descriptionGenerated :
                tab.id === 'imagens' ? imagesGenerated :
                tab.id === 'video' ? videoStatus === 'done' :
                false;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all shrink-0 ${isActive ? 'bg-orange-50 text-[#FF5B03] shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-[#FF5B03]' : 'text-slate-400'}`} />
                  {tab.label}
                  {done && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto shrink-0" />}
                </button>
              );
            })}
          </aside>

          <main className="flex-1 p-6 md:p-8 min-h-[420px]">
            {activeTab === 'geral' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Geral" ainda não implementada.</div>
            )}
            {activeTab === 'atributos' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Atributos" ainda não implementada.</div>
            )}
            {activeTab === 'conteudo' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Conteúdo" ainda não implementada.</div>
            )}
            {activeTab === 'imagens' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Imagens" ainda não implementada.</div>
            )}
            {activeTab === 'video' && (
              <div className="text-center py-12 text-slate-400 text-sm">Aba "Vídeo" ainda não implementada.</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default TutorialView;
```

Note: `Play`, `Wand2`, `Loader2`, `simulateDescription`, `simulateAttributes`, `confirmAttribute`, `simulateImages`, `simulateVideo`, `videoStepLabel`, `videoError` are declared but not yet referenced in JSX at the end of this task — this is expected and Tasks 2-5 wire them in. TypeScript's `noUnusedLocals` is not enabled in this repo's `tsconfig.json` (verify in Step 2), so this does not fail `npm run lint`.

- [ ] **Step 2: Confirm `noUnusedLocals` is not enabled (so unused handlers don't fail the build)**

Run: `grep -n "noUnusedLocals\|noUnusedParameters" tsconfig.json`
Expected: no matches (or `false`). If it finds `true`, prefix the unused ones temporarily isn't an option mid-task — instead reorder so Step 1 already wires every declared handler into at least a disabled/hidden placeholder button in its tab's placeholder `<div>` (e.g. `<button onClick={simulateDescription} className="hidden" />`). Only do this if the grep finds `true`.

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: same pre-existing errors as before (`App.tsx:653`, `App.tsx:1373`, `ProductEditModal.tsx:313/425/462`), no new errors from `TutorialView.tsx`.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open the Tutorial tab: confirm Welcome → "Começar" → Catálogo mockup with one row and a callout bubble pointing at the Sparkles button → clicking any of the 4 action buttons opens the Modal mockup on the matching tab → clicking each sidebar tab switches `activeTab` (highlighted in orange) → "Voltar" (ArrowLeft) returns to Catálogo → "Concluir tutorial" (both in catalog and modal headers) jumps to the Concluído screen → "Reiniciar tutorial" returns to Welcome.

- [ ] **Step 5: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): rewrite as catalog+modal mockup shell (v2)"
```

---

### Task 2: Implement the "Geral" and "Atributos" tab contents

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: `MOCK_CATEGORY_PATH`, `attributesDone`, `attributesLoading`, `attributesGenerated`, `simulateAttributes`, `confirmedAttrs`, `confirmAttribute`, `MOCK_ATTRIBUTES` from Task 1.

- [ ] **Step 1: Replace the `'geral'` placeholder**

```tsx
            {activeTab === 'geral' && (
              <div className="space-y-6 max-w-xl">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Layout className="w-5 h-5 text-orange-600" /> Informações Básicas
                </h2>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Título do Produto</label>
                  <input
                    type="text"
                    readOnly
                    value={MOCK_PRODUCT.rawName}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 ml-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                    {attributesDone && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                        <Sparkles className="w-2.5 h-2.5" /> Sugerido por IA
                      </span>
                    )}
                  </div>
                  <select disabled value="mock" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none appearance-none">
                    <option value="mock">{MOCK_CATEGORY_PATH.join(' > ')}</option>
                  </select>
                </div>
              </div>
            )}
```

- [ ] **Step 2: Replace the `'atributos'` placeholder**

```tsx
            {activeTab === 'atributos' && (
              <div className="space-y-8">
                <header className="bg-gradient-to-br from-orange-600 via-purple-600 to-pink-600 p-8 rounded-3xl shadow-xl flex items-center justify-between gap-8 overflow-hidden relative">
                  <div className="relative z-10 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                        <Sparkles className="w-6 h-6 text-white" />
                      </div>
                      <h2 className="text-xl font-bold text-white tracking-tight">Atributos Inteligentes</h2>
                    </div>
                    <p className="text-purple-100 text-sm max-w-lg leading-relaxed">
                      O Gemini analisa a descrição e a categoria do produto para detectar automaticamente cor, material e tamanho.
                    </p>
                  </div>
                  {!attributesGenerated && (
                    <button
                      onClick={simulateAttributes}
                      disabled={attributesLoading}
                      className="relative z-10 flex items-center gap-3 px-6 py-3.5 bg-white text-purple-700 rounded-2xl font-bold transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 whitespace-nowrap"
                    >
                      {attributesLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                      {attributesLoading ? 'Analisando...' : 'Preencher com IA'}
                    </button>
                  )}
                </header>

                {attributesGenerated && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {MOCK_ATTRIBUTES.map((attr) => {
                      const isConfirmed = confirmedAttrs.has(attr.key);
                      return (
                        <div
                          key={attr.key}
                          className={`p-6 rounded-2xl border transition-all ${!isConfirmed ? 'bg-purple-50/50 border-purple-200 shadow-sm' : 'bg-white border-slate-200'}`}
                        >
                          <div className="flex items-center gap-2 mb-4">
                            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{attr.label}</label>
                            {!isConfirmed && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                                <Sparkles className="w-2.5 h-2.5" /> SUGESTÃO
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            readOnly
                            value={attr.value}
                            className={`w-full px-4 py-2.5 rounded-xl border outline-none font-medium text-slate-900 ${!isConfirmed ? 'bg-white border-purple-200' : 'bg-slate-50 border-slate-200'}`}
                          />
                          {!isConfirmed && (
                            <div className="mt-4 flex items-center justify-end pt-4 border-t border-purple-100">
                              <button
                                onClick={() => confirmAttribute(attr.key)}
                                className="flex items-center gap-1.5 text-xs font-bold text-purple-600 bg-white px-3 py-1.5 rounded-lg border border-purple-200 shadow-sm hover:bg-purple-600 hover:text-white transition-all"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

`npm run dev` → Tutorial → open modal on "Geral" tab: title read-only, category shown. Switch to "Atributos": click "Preencher com IA", wait ~1.2s, confirm 4 attribute cards appear with "SUGESTÃO" badges; click "Confirmar" on all 4; confirm the sidebar "Atributos" tab gets the green checkmark, and going back to the catalog row shows the Tag chip lit and the Categoria column now shows "Calçados > Esportivo > Tênis".

- [ ] **Step 5: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement Geral and Atributos tab content"
```

---

### Task 3: Implement the "Conteúdo" tab content

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: `descriptionLoading`, `descriptionGenerated`, `simulateDescription`, `MOCK_DESCRIPTION_HTML`, `MOCK_SEO` from Task 1.

- [ ] **Step 1: Replace the `'conteudo'` placeholder**

```tsx
            {activeTab === 'conteudo' && (
              <div className="space-y-8">
                <header className="bg-slate-900 p-8 rounded-3xl shadow-xl flex items-center justify-between gap-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-orange-500 rounded-xl">
                        <Wand2 className="w-5 h-5 text-white" />
                      </div>
                      <h2 className="text-xl font-bold text-white tracking-tight">Escritor Criativo IA</h2>
                    </div>
                    <p className="text-slate-400 text-sm max-w-lg leading-relaxed">
                      Gere descrições ricas, otimizadas para conversão e SEO com um clique.
                    </p>
                  </div>
                  {!descriptionGenerated && (
                    <button
                      onClick={simulateDescription}
                      disabled={descriptionLoading}
                      className="px-8 py-4 bg-orange-600 text-white rounded-2xl font-bold hover:bg-orange-700 shadow-lg shadow-orange-900/20 text-sm transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 whitespace-nowrap"
                    >
                      {descriptionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {descriptionLoading ? 'Gerando...' : 'Gerar Conteúdo Premium'}
                    </button>
                  )}
                </header>

                {descriptionGenerated && (
                  <div className="grid grid-cols-1 gap-8">
                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                      <label className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-4">
                        <Layout className="w-4 h-4 text-orange-600" /> Descrição Comercial (HTML)
                      </label>
                      <div
                        className="border border-slate-200 rounded-2xl p-4 bg-slate-50 prose prose-sm max-w-none text-slate-700"
                        dangerouslySetInnerHTML={{ __html: MOCK_DESCRIPTION_HTML }}
                      />
                    </div>
                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                      <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-4">Configurações de SEO</h3>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Meta Title</label>
                        <input type="text" readOnly value={MOCK_SEO.title} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Meta Description</label>
                        <textarea readOnly rows={3} value={MOCK_SEO.metaDescription} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none resize-none" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

`npm run dev` → Tutorial → modal → "Conteúdo" tab: click "Gerar Conteúdo Premium", wait ~1.2s, confirm the description HTML preview and SEO fields render; confirm the sidebar "Conteúdo" tab gets the green checkmark, and the catalog row's Sparkles chip lights up when going back.

- [ ] **Step 4: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement Conteúdo tab content"
```

---

### Task 4: Implement the "Imagens" tab content

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: `imagesLoading`, `imagesGenerated`, `simulateImages` from Task 1.

- [ ] **Step 1: Replace the `'imagens'` placeholder**

```tsx
            {activeTab === 'imagens' && (
              <div className="space-y-8">
                <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-orange-600" /> Imagens & Ambientação (IA)
                  </h2>
                  <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                    <div className="w-48 h-48 rounded-2xl border border-slate-200 bg-slate-50 shrink-0 flex flex-col items-center justify-center text-slate-400">
                      <ImageIcon className="w-12 h-12 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-wider">Foto do produto</span>
                    </div>
                    <div className="flex-1 space-y-4">
                      <div className="space-y-2">
                        <h3 className="text-base font-bold text-slate-800">Visual Mídia & Geração de Cenários</h3>
                        <p className="text-sm text-slate-500 leading-relaxed">A IA gera 3 variações realistas a partir da imagem original.</p>
                      </div>
                      {!imagesGenerated && (
                        <button
                          onClick={simulateImages}
                          disabled={imagesLoading}
                          className="px-6 py-3 bg-gradient-to-r from-orange-600 to-orange-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 active:scale-95 disabled:opacity-50"
                        >
                          {imagesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          {imagesLoading ? 'Gerando...' : 'Gerar Imagens com IA'}
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                {imagesGenerated && (
                  <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-600" /> Ambientações Geradas
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                      {[1, 2, 3].map((n) => (
                        <div key={n} className="aspect-square rounded-xl border border-slate-200 bg-slate-100 flex flex-col items-center justify-center gap-2">
                          <ImageIcon className="w-6 h-6 text-slate-400" />
                          <span className="text-[11px] font-medium text-slate-400">Ambientação {n}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

`npm run dev` → Tutorial → modal → "Imagens" tab: click "Gerar Imagens com IA", wait ~1.5s, confirm the 3-tile grid appears; confirm the sidebar "Imagens" checkmark and the catalog row's ImageIcon chip light up.

- [ ] **Step 4: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement Imagens tab content"
```

---

### Task 5: Implement the "Vídeo" tab content

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: `videoStatus`, `videoStepLabel`, `videoError`, `setVideoError`, `simulateVideo` from Task 1.

- [ ] **Step 1: Replace the `'video'` placeholder**

```tsx
            {activeTab === 'video' && (
              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-1">Gerar Vídeo</h2>
                <p className="text-sm text-slate-500 mb-6">
                  A partir das imagens e da descrição, a IA monta um vídeo curto de apresentação do produto.
                </p>
                {videoStatus === 'idle' && (
                  <button
                    onClick={simulateVideo}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
                  >
                    <Sparkles className="w-4 h-4" /> Gerar Vídeo com IA
                  </button>
                )}
                {videoStatus === 'processing' && (
                  <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 max-w-md">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                      <span className="text-xs font-medium text-slate-600">{videoStepLabel || 'Iniciando...'}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-violet-500 animate-pulse" style={{ width: '70%' }} />
                    </div>
                  </div>
                )}
                {videoStatus === 'done' && (
                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-black max-w-xl">
                    {!videoError ? (
                      <video
                        controls
                        className="w-full aspect-video"
                        src="/tutorial/demo-video.mp4"
                        onError={() => setVideoError(true)}
                      />
                    ) : (
                      <div className="aspect-video flex flex-col items-center justify-center gap-2 text-slate-400 bg-slate-900">
                        <Play className="w-8 h-8" />
                        <span className="text-xs font-medium">Vídeo de exemplo em breve</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no new errors, and no unused-variable errors now that every Task 1 handler/state is referenced somewhere.

- [ ] **Step 3: Manual verification**

`npm run dev` → Tutorial → modal → "Vídeo" tab: click "Gerar Vídeo com IA", confirm the staged progress labels cycle (~4s total), then either the video plays or the "Vídeo de exemplo em breve" fallback shows; confirm the sidebar "Vídeo" checkmark lights up. Do a full run-through of all 5 tabs in one session, then open DevTools → Network and confirm zero requests fired by any "Simular"/"Gerar" button (the `/tutorial/demo-video.mp4` request is expected and pre-existing, not new).

- [ ] **Step 4: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement Vídeo tab content"
```

---

## Self-Review Notes

- Spec coverage: all 4 macro screens from `2026-07-07-tutorial-tab-design-v2.md` (Boas-vindas, Catálogo, Modal com 5 abas, Concluído) map to tasks. Catalog status chips and category column reflect live tutorial state (tied to `attributesDone`/`descriptionGenerated`/`imagesGenerated`), matching the "faithful recreation" goal.
- No automated tests exist; verification is `npm run lint` + manual `npm run dev` browser walkthroughs, consistent with `CLAUDE.md` and the v1 plan.
- Type consistency: `ModalTab` literals (`'geral' | 'atributos' | 'conteudo' | 'imagens' | 'video'`) are used identically in `MODAL_TABS`, `activeTab` state, `openModal()` calls, and every `activeTab === '...'` check across tasks.
- The `public/tutorial/demo-video.mp4` fallback behavior from v1 is preserved unchanged in Task 5 — this plan does not touch `public/tutorial/`.
