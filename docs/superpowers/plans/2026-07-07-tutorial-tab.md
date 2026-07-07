# Tutorial Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, mock-data "Tutorial" wizard tab (sidebar entry above "Integrações") that walks a new user through the full product flow — description, attributes, category, ambient images, video — with zero real API calls or credit spend.

**Architecture:** A single self-contained component `src/components/tutorial/TutorialView.tsx` owns all wizard state locally (current step, per-step "generated" flags, fake timers). `App.tsx` gains a `'tutorial'` member on its `mainView` union, a sidebar button above the existing "Integrações" button, and a render branch that mounts `<TutorialView onFinish={...} />`. No new services, no Firestore/Gemini calls, no props carrying real product data.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react icons, `motion/react` (already a dependency) for step transitions.

## Global Constraints

- No automated test suite exists in this repo (per `CLAUDE.md`); verification is `npm run lint` (tsc --noEmit) plus manual check via `npm run dev`.
- All UI text is Portuguese (Brazilian), matching the rest of the app.
- The tutorial must never call `fetch`, any `services/*` function, or any Firebase API. It is pure local state + `setTimeout`.
- Reuse existing Tailwind patterns already in the codebase (`#FF5B03` accent, `rounded-2xl border border-slate-200 shadow-sm` cards) — no new design system.
- Video asset path is `/tutorial/demo-video.mp4`, served from `public/tutorial/`. The actual `.mp4` file is out of scope for this plan (added later by the user); the `<video>` element must degrade gracefully via `onError` if the file is missing.

---

### Task 1: Wire up the `tutorial` mainView and sidebar entry with a stub component

**Files:**
- Create: `src/components/tutorial/TutorialView.tsx`
- Modify: `src/App.tsx:2` (lucide-react import line)
- Modify: `src/App.tsx:163` (mainView union type)
- Modify: `src/App.tsx:2455-2461` (sidebar bottom block)
- Modify: `src/App.tsx:2556-2560` (mainView render branch)

**Interfaces:**
- Produces: `TutorialView` React component, props `{ onFinish: () => void }`. Later tasks replace its internals but keep this exact prop signature.

- [ ] **Step 1: Create the stub `TutorialView` component**

```tsx
// src/components/tutorial/TutorialView.tsx
import React from 'react';

interface TutorialViewProps {
  onFinish: () => void;
}

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <h2 className="text-lg font-bold text-slate-800">Tutorial</h2>
        <p className="text-sm text-slate-500 mt-2">Em construção.</p>
        <button
          onClick={onFinish}
          className="mt-4 text-sm font-medium text-[#FF5B03] hover:underline"
        >
          Voltar para produtos
        </button>
      </div>
    </div>
  );
};

export default TutorialView;
```

- [ ] **Step 2: Add the `GraduationCap` icon to the lucide-react import in `App.tsx`**

Find this line (`src/App.tsx:2`):

```tsx
import { Upload, Download, Search, Filter, Play, Eye, Copy, RefreshCw, Save, Check, AlertCircle, X, Sparkles, FileSpreadsheet, Settings, Plus, Trash2, Image as ImageIcon, LogIn, LogOut, Coins, Layout, ChevronLeft, ChevronRight, ChevronDown, DownloadCloud, Edit, Globe, FileText, Database, Folder, Bell, HelpCircle, Menu, Cloud, CloudUpload, Tag, Columns3, Plug } from 'lucide-react';
```

Replace with (adds `GraduationCap` at the end):

```tsx
import { Upload, Download, Search, Filter, Play, Eye, Copy, RefreshCw, Save, Check, AlertCircle, X, Sparkles, FileSpreadsheet, Settings, Plus, Trash2, Image as ImageIcon, LogIn, LogOut, Coins, Layout, ChevronLeft, ChevronRight, ChevronDown, DownloadCloud, Edit, Globe, FileText, Database, Folder, Bell, HelpCircle, Menu, Cloud, CloudUpload, Tag, Columns3, Plug, GraduationCap } from 'lucide-react';
```

- [ ] **Step 3: Import `TutorialView` next to the `IntegrationsView` import**

Find (`src/App.tsx`, near line 30):

```tsx
import IntegrationsView from './components/integrations/IntegrationsView';
```

Add immediately after it:

```tsx
import TutorialView from './components/tutorial/TutorialView';
```

- [ ] **Step 4: Add `'tutorial'` to the `mainView` union**

Find (`src/App.tsx:163`):

```tsx
  const [mainView, setMainView] = useState<'products' | 'categories' | 'history' | 'integrations'>('products');
```

Replace with:

```tsx
  const [mainView, setMainView] = useState<'products' | 'categories' | 'history' | 'integrations' | 'tutorial'>('products');
```

- [ ] **Step 5: Add the sidebar button above "Integrações"**

Find (`src/App.tsx:2455-2461`):

```tsx
        <div className="p-4 mt-auto mb-2 border-t border-white/5 mx-3 flex flex-col gap-1">
          <button
            onClick={() => { setMainView('integrations'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mainView === 'integrations' ? 'bg-[#1e293b] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            <Plug className="w-4 h-4" /> Integrações
          </button>
```

Replace with (new button inserted before the Integrações button):

```tsx
        <div className="p-4 mt-auto mb-2 border-t border-white/5 mx-3 flex flex-col gap-1">
          <button
            onClick={() => { setMainView('tutorial'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mainView === 'tutorial' ? 'bg-[#1e293b] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            <GraduationCap className="w-4 h-4" /> Tutorial
          </button>
          <button
            onClick={() => { setMainView('integrations'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${mainView === 'integrations' ? 'bg-[#1e293b] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            <Plug className="w-4 h-4" /> Integrações
          </button>
```

- [ ] **Step 6: Add the render branch for `mainView === 'tutorial'`**

Find (`src/App.tsx:2556-2560`):

```tsx
          ) : mainView === 'history' ? (
            renderHistoryView()
          ) : mainView === 'integrations' ? (
            <IntegrationsView onImport={handleWakeImport} getPushPayload={buildWakePushPayload} />
          ) : (
```

Replace with:

```tsx
          ) : mainView === 'history' ? (
            renderHistoryView()
          ) : mainView === 'integrations' ? (
            <IntegrationsView onImport={handleWakeImport} getPushPayload={buildWakePushPayload} />
          ) : mainView === 'tutorial' ? (
            <TutorialView onFinish={() => setMainView('products')} />
          ) : (
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open the app, click "Tutorial" in the sidebar. Confirm the stub card renders and "Voltar para produtos" returns to the product catalog.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): add Tutorial tab entry with stub view"
```

---

### Task 2: Build the wizard shell — stepper, navigation, Welcome and Conclusion screens

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx` (full rewrite of the stub)

**Interfaces:**
- Consumes: nothing beyond `onFinish: () => void` from Task 1.
- Produces:
  - `type StepId = 'welcome' | 'product' | 'description' | 'attributes' | 'category' | 'images' | 'video' | 'done';`
  - `const STEPS: { id: StepId; label: string }[]` — ordered list, consumed by later tasks to render the stepper dots.
  - Internal `renderStepContent(step: StepId)` — a `switch` that Tasks 3-6 add cases to. Tasks 3-6 each add one `case` block returning JSX for their steps; Task 2 provides the `case 'welcome'` and `case 'done'` (and a temporary placeholder `default` for steps not yet implemented, which later tasks remove one case at a time).

- [ ] **Step 1: Replace `TutorialView.tsx` with the wizard shell**

```tsx
// src/components/tutorial/TutorialView.tsx
import React, { useState } from 'react';
import { GraduationCap, ArrowRight, ArrowLeft, X, CheckCircle2 } from 'lucide-react';

interface TutorialViewProps {
  onFinish: () => void;
}

type StepId = 'welcome' | 'product' | 'description' | 'attributes' | 'category' | 'images' | 'video' | 'done';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Início' },
  { id: 'product', label: 'Produto' },
  { id: 'description', label: 'Descrição' },
  { id: 'attributes', label: 'Atributos' },
  { id: 'category', label: 'Categoria' },
  { id: 'images', label: 'Imagens' },
  { id: 'video', label: 'Vídeo' },
  { id: 'done', label: 'Concluído' },
];

const TutorialView: React.FC<TutorialViewProps> = ({ onFinish }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex].id;

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const restart = () => setStepIndex(0);

  const renderStepContent = (currentStep: StepId): React.ReactNode => {
    switch (currentStep) {
      case 'welcome':
        return (
          <div className="text-center py-6">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FF5B03]/10 flex items-center justify-center mb-4">
              <GraduationCap className="w-7 h-7 text-[#FF5B03]" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Bem-vindo ao tutorial</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Vamos simular, com um produto fictício, todo o fluxo de geração
              de descrição, atributos, categoria, imagens ambientadas e vídeo.
              Nenhum crédito é gasto e nenhum dado real é alterado.
            </p>
          </div>
        );
      case 'done':
        return (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Tutorial concluído!</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Você viu o fluxo completo: descrição, atributos, categoria,
              imagens ambientadas e vídeo. Agora é só aplicar isso nos seus
              produtos reais.
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
        );
      default:
        return (
          <div className="text-center py-12 text-slate-400 text-sm">
            Etapa "{currentStep}" ainda não implementada.
          </div>
        );
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i === stepIndex ? 'bg-[#FF5B03]' : i < stepIndex ? 'bg-[#FF5B03]/40' : 'bg-slate-200'
                }`}
                title={s.label}
              />
              {i < STEPS.length - 1 && <div className="w-4 h-px bg-slate-200" />}
            </div>
          ))}
        </div>
        {step !== 'done' && (
          <button
            onClick={() => setStepIndex(STEPS.length - 1)}
            className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Pular tutorial
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-6 min-h-[320px] flex flex-col justify-center">
        {renderStepContent(step)}
      </div>

      {step !== 'welcome' && step !== 'done' && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Avançar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 'welcome' && (
        <div className="flex justify-end mt-4">
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Começar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default TutorialView;
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Open Tutorial tab. Confirm: "Começar" advances from welcome to the "product" placeholder screen; Voltar/Avançar navigate between placeholder screens; "Pular tutorial" jumps straight to the "done" screen; "Reiniciar tutorial" returns to welcome; "Ir para meus produtos" calls `onFinish` (returns to product catalog).

- [ ] **Step 4: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): add wizard shell with stepper and navigation"
```

---

### Task 3: Implement "Produto de exemplo" and "Gerar Descrição" screens

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: `StepId`, `renderStepContent` switch from Task 2.
- Produces: local state `descriptionGenerated: boolean` and `descriptionLoading: boolean`, and a `simulateDescription()` handler — internal to the component, not consumed elsewhere.

- [ ] **Step 1: Add mock product constant and description-step state**

Add near the top of the component, above `const TutorialView`:

```tsx
const MOCK_PRODUCT = {
  sku: 'TENIS-AZUL-42',
  rawName: 'TENIS ESPORTIVO MASC AZUL 42',
};

const MOCK_DESCRIPTION_HTML = `<p><strong>Tênis Esportivo Masculino Azul</strong> desenvolvido para quem busca conforto e desempenho no dia a dia. Cabedal em mesh respirável, entressola com amortecimento em EVA e solado antiderrapante.</p><ul><li>Material: mesh + sintético</li><li>Solado: borracha antiderrapante</li><li>Indicado para caminhada e uso casual</li></ul>`;

const MOCK_SEO = {
  title: 'Tênis Esportivo Masculino Azul 42 | Conforto no Dia a Dia',
  metaDescription: 'Tênis esportivo masculino azul, tam. 42, com cabedal em mesh respirável e solado antiderrapante. Confira agora.',
};
```

Inside the component, alongside `const [stepIndex, setStepIndex] = useState(0);`, add:

```tsx
  const [descriptionLoading, setDescriptionLoading] = useState(false);
  const [descriptionGenerated, setDescriptionGenerated] = useState(false);

  const simulateDescription = () => {
    setDescriptionLoading(true);
    setTimeout(() => {
      setDescriptionLoading(false);
      setDescriptionGenerated(true);
    }, 1200);
  };
```

- [ ] **Step 2: Clear the fake timer on unmount**

Add an effect right after the `simulateDescription` definition:

```tsx
  useEffect(() => {
    return () => {
      // no-op cleanup placeholder; real timer refs are added as more
      // simulated steps are introduced in later tasks.
    };
  }, []);
```

Add `useEffect` to the React import at the top of the file:

```tsx
import React, { useState, useEffect } from 'react';
```

*(Note: this effect is intentionally a placeholder hook wiring point — Task 4 and 6 extend it with real timer refs instead of adding parallel effects.)*

- [ ] **Step 3: Replace the `case 'product':` placeholder with the real screen**

In the `switch (currentStep)` block, replace the `default` fallthrough behavior for `'product'` by adding an explicit case just above `default`:

```tsx
      case 'product':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Produto de exemplo</h3>
            <p className="text-sm text-slate-500 mb-4">
              Este é o produto fictício que vamos usar durante o tutorial.
            </p>
            <div className="flex items-center gap-4 p-4 border border-slate-200 rounded-xl bg-slate-50">
              <div className="w-20 h-20 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <ImageIcon className="w-8 h-8 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">{MOCK_PRODUCT.sku}</p>
                <p className="text-sm font-semibold text-slate-800">{MOCK_PRODUCT.rawName}</p>
                <p className="text-xs text-slate-400 mt-1">Sem descrição, atributos ou categoria ainda.</p>
              </div>
            </div>
          </div>
        );
```

Add `Image as ImageIcon` to the lucide-react import at the top:

```tsx
import { GraduationCap, ArrowRight, ArrowLeft, X, CheckCircle2, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';
```

- [ ] **Step 4: Add the `case 'description':` screen**

Add right after the `case 'product':` block:

```tsx
      case 'description':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Descrição</h3>
            <p className="text-sm text-slate-500 mb-4">
              A IA transforma o nome cru do produto em uma descrição rica e
              campos de SEO, a partir do template configurado.
            </p>
            {!descriptionGenerated ? (
              <button
                onClick={simulateDescription}
                disabled={descriptionLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors disabled:opacity-60"
              >
                {descriptionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {descriptionLoading ? 'Gerando...' : 'Simular geração'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-4 border border-slate-200 rounded-xl bg-white">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Descrição gerada</p>
                  <div
                    className="prose prose-sm max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: MOCK_DESCRIPTION_HTML }}
                  />
                </div>
                <div className="p-4 border border-slate-200 rounded-xl bg-white">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">SEO</p>
                  <p className="text-sm font-semibold text-slate-800">{MOCK_SEO.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{MOCK_SEO.metaDescription}</p>
                </div>
              </div>
            )}
          </div>
        );
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, advance to "Produto de exemplo" (mock card visible), then "Gerar Descrição": click "Simular geração", confirm ~1.2s loading spinner then the HTML description + SEO fields appear.

- [ ] **Step 7: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement product and description steps"
```

---

### Task 4: Implement "Gerar Atributos" and "Categorizar" screens

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: same switch/state pattern as Task 3.
- Produces: `attributesGenerated: boolean`, `attributesLoading: boolean`, `simulateAttributes()`.

- [ ] **Step 1: Add mock attributes constant and state**

Near `MOCK_SEO`, add:

```tsx
const MOCK_ATTRIBUTES: { label: string; value: string }[] = [
  { label: 'Cor', value: 'Azul' },
  { label: 'Material', value: 'Mesh' },
  { label: 'Tamanho', value: '42' },
  { label: 'Gênero', value: 'Masculino' },
];

const MOCK_CATEGORY_PATH = ['Calçados', 'Esportivo', 'Tênis'];
```

Alongside the description state, add:

```tsx
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesGenerated, setAttributesGenerated] = useState(false);

  const simulateAttributes = () => {
    setAttributesLoading(true);
    setTimeout(() => {
      setAttributesLoading(false);
      setAttributesGenerated(true);
    }, 1200);
  };
```

- [ ] **Step 2: Add the `case 'attributes':` screen**

Add right after the `case 'description':` block:

```tsx
      case 'attributes':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Atributos</h3>
            <p className="text-sm text-slate-500 mb-4">
              A IA extrai atributos estruturados (cor, material, tamanho...)
              a partir da descrição e da categoria do produto.
            </p>
            {!attributesGenerated ? (
              <button
                onClick={simulateAttributes}
                disabled={attributesLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors disabled:opacity-60"
              >
                {attributesLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {attributesLoading ? 'Gerando...' : 'Simular geração'}
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {MOCK_ATTRIBUTES.map((attr) => (
                  <span
                    key={attr.label}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-100"
                  >
                    {attr.label}: {attr.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
```

- [ ] **Step 3: Add the `case 'category':` screen**

Add right after the `case 'attributes':` block:

```tsx
      case 'category':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Categorizar</h3>
            <p className="text-sm text-slate-500 mb-4">
              Com base na descrição, o produto é encaixado na árvore de
              categorias já cadastrada.
            </p>
            <div className="flex items-center gap-2 flex-wrap p-4 border border-slate-200 rounded-xl bg-slate-50">
              {MOCK_CATEGORY_PATH.map((part, i) => (
                <React.Fragment key={part}>
                  <span className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 shadow-sm">
                    {part}
                  </span>
                  {i < MOCK_CATEGORY_PATH.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        );
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, advance through "Gerar Atributos" (click "Simular geração", confirm chips appear after loading) and "Categorizar" (confirm the breadcrumb-style category path renders).

- [ ] **Step 6: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement attributes and category steps"
```

---

### Task 5: Implement "Gerar Imagens Ambientadas" screen

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: same switch/state pattern as Tasks 3-4.
- Produces: `imagesLoading: boolean`, `imagesGenerated: boolean`, `simulateImages()`.

- [ ] **Step 1: Add state**

Alongside `attributesLoading`/`attributesGenerated`, add:

```tsx
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesGenerated, setImagesGenerated] = useState(false);

  const simulateImages = () => {
    setImagesLoading(true);
    setTimeout(() => {
      setImagesLoading(false);
      setImagesGenerated(true);
    }, 1500);
  };
```

- [ ] **Step 2: Add the `case 'images':` screen**

Add right after the `case 'category':` block:

```tsx
      case 'images':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Imagens Ambientadas</h3>
            <p className="text-sm text-slate-500 mb-4">
              A IA gera fotos de estilo de vida mostrando o produto em uso,
              a partir da foto original.
            </p>
            {!imagesGenerated ? (
              <button
                onClick={simulateImages}
                disabled={imagesLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors disabled:opacity-60"
              >
                {imagesLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {imagesLoading ? 'Gerando...' : 'Simular geração'}
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="aspect-square rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center gap-2"
                  >
                    <ImageIcon className="w-6 h-6 text-slate-400" />
                    <span className="text-[11px] font-medium text-slate-400">Ambientação {n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, advance to "Gerar Imagens Ambientadas", click "Simular geração", confirm 3 placeholder tiles appear after ~1.5s.

- [ ] **Step 5: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): implement ambient images step"
```

---

### Task 6: Implement "Gerar Vídeo" screen with fake production-queue progress and video fallback

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`
- Create: `public/tutorial/.gitkeep`

**Interfaces:**
- Consumes: same switch/state pattern as Tasks 3-5.
- Produces: `videoStatus: 'idle' | 'processing' | 'done'`, `videoStepLabel: string`, `videoError: boolean`, `simulateVideo()`.

- [ ] **Step 1: Create the `public/tutorial/` directory placeholder**

```bash
mkdir -p public/tutorial
touch public/tutorial/.gitkeep
```

This directory is where the real `demo-video.mp4` will be dropped in later; `.gitkeep` ensures the empty folder is tracked by git.

- [ ] **Step 2: Add video-step state and simulated multi-stage progress**

Alongside `imagesLoading`/`imagesGenerated`, add:

```tsx
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
```

- [ ] **Step 3: Add the `case 'video':` screen**

Add right after the `case 'images':` block:

```tsx
      case 'video':
        return (
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Gerar Vídeo</h3>
            <p className="text-sm text-slate-500 mb-4">
              A partir das imagens e da descrição, a IA monta um vídeo curto
              de apresentação do produto.
            </p>
            {videoStatus === 'idle' && (
              <button
                onClick={simulateVideo}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
              >
                <Sparkles className="w-4 h-4" /> Simular geração
              </button>
            )}
            {videoStatus === 'processing' && (
              <div className="p-4 border border-slate-200 rounded-xl bg-slate-50">
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
              <div className="rounded-xl overflow-hidden border border-slate-200 bg-black">
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
        );
```

Add `Play` to the lucide-react import at the top:

```tsx
import { GraduationCap, ArrowRight, ArrowLeft, X, CheckCircle2, Image as ImageIcon, Sparkles, Loader2, Play } from 'lucide-react';
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, advance to "Gerar Vídeo", click "Simular geração", confirm the stage labels cycle over ~4s, then either the video plays (if `public/tutorial/demo-video.mp4` exists) or the "Vídeo de exemplo em breve" fallback shows. Open DevTools → Network while running through all 8 steps and confirm no request is made to any Gemini/Firestore/upload endpoint.

- [ ] **Step 6: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx public/tutorial/.gitkeep
git commit -m "feat(tutorial): implement video generation step with fallback"
```

---

## Self-Review Notes

- Spec coverage: all 8 screens from the spec (welcome, product, description, attributes, category, images, video, done) map 1:1 to tasks. Sidebar entry above Integrações, isolated state, no real API calls, and the `/tutorial/demo-video.mp4` fallback are all covered.
- No automated tests exist in this repo; verification steps use `npm run lint` + manual `npm run dev` checks, consistent with `CLAUDE.md`.
- Type consistency: `StepId`, `STEPS`, and the `switch` cases use matching literal strings throughout (`'welcome' | 'product' | 'description' | 'attributes' | 'category' | 'images' | 'video' | 'done'`); each task's new state fields are additive and don't collide with earlier ones.
