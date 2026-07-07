# Tutorial Tab v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mandatory spotlight/highlight overlay to the v2 tutorial (`src/components/tutorial/TutorialView.tsx`) so the user is guided, one click at a time, through the exact sequence: Começar → abrir produto → gerar descrição → aba Atributos → gerar atributos → confirmar cada atributo → aba Imagens → gerar imagens → aba Vídeo → gerar vídeo → Concluir tutorial. Per `docs/superpowers/specs/2026-07-07-tutorial-tab-design-v3.md`.

**Architecture:** New standalone component `src/components/tutorial/TutorialSpotlight.tsx` that measures a target DOM node (found via `document.querySelector('[data-tour="..."]')`) and renders a 4-band blocking overlay + pulsing ring + instruction tooltip. `TutorialView.tsx` gains: `data-tour` attributes on existing buttons (no new buttons), a pure derived function `getGuideTarget()` computed from existing state, and one `<TutorialSpotlight target={...} />` render per screen (welcome/catalog/modal) right before that screen's closing `</div>`. The old static callout bubble in the catalog row is removed (superseded by the new generic overlay).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (arbitrary values for dynamic positioning via inline `style`).

## Global Constraints

- No automated test suite; verification is `npm run lint` plus manual `npm run dev` browser walkthrough.
- Zero new interactive elements — every spotlight target is a button that already exists in `TutorialView.tsx`.
- No `ResizeObserver`/`MutationObserver` — recompute via `useLayoutEffect` keyed on the target id plus a `resize` window listener, per spec v3's stated non-goal.
- Portuguese UI text.

---

### Task 1: Create the `TutorialSpotlight` overlay component

**Files:**
- Create: `src/components/tutorial/TutorialSpotlight.tsx`

**Interfaces:**
- Produces: `TutorialSpotlight` component, props `{ targetId: string; message: string }`. `targetId` is the value to look up via `document.querySelector(\`[data-tour="${targetId}"]\`)` (no leading `#`, just the raw id string). Consumed by Task 2, which renders `<TutorialSpotlight targetId={guideTarget.id} message={guideTarget.message} />` conditionally.

- [ ] **Step 1: Write the component**

```tsx
// src/components/tutorial/TutorialSpotlight.tsx
import React, { useEffect, useLayoutEffect, useState } from 'react';

interface TutorialSpotlightProps {
  targetId: string;
  message: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TutorialSpotlight: React.FC<TutorialSpotlightProps> = ({ targetId, message }) => {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(`[data-tour="${targetId}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const domRect = el.getBoundingClientRect();
      setRect({ top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [targetId]);

  if (!rect) return null;

  const padding = 4;
  const holeTop = rect.top - padding;
  const holeLeft = rect.left - padding;
  const holeWidth = rect.width + padding * 2;
  const holeHeight = rect.height + padding * 2;
  const holeBottom = holeTop + holeHeight;
  const holeRight = holeLeft + holeWidth;

  const spaceBelow = window.innerHeight - holeBottom;
  const tooltipBelow = spaceBelow > 90;

  return (
    <div className="fixed inset-0 z-50" aria-hidden="true">
      <div className="fixed bg-black/60" style={{ top: 0, left: 0, right: 0, height: Math.max(holeTop, 0) }} />
      <div className="fixed bg-black/60" style={{ top: holeBottom, left: 0, right: 0, bottom: 0 }} />
      <div className="fixed bg-black/60" style={{ top: holeTop, left: 0, width: Math.max(holeLeft, 0), height: holeHeight }} />
      <div className="fixed bg-black/60" style={{ top: holeTop, left: holeRight, right: 0, height: holeHeight }} />

      <div
        className="fixed border-2 border-[#FF5B03] rounded-lg animate-pulse pointer-events-none"
        style={{ top: holeTop, left: holeLeft, width: holeWidth, height: holeHeight }}
      />

      <div
        className="fixed bg-slate-900 text-white text-sm font-medium rounded-lg px-4 py-2.5 shadow-xl pointer-events-none max-w-xs"
        style={
          tooltipBelow
            ? { top: holeBottom + 12, left: holeLeft }
            : { top: holeTop - 12, left: holeLeft, transform: 'translateY(-100%)' }
        }
      >
        {message}
      </div>
    </div>
  );
};

export default TutorialSpotlight;
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/tutorial/TutorialSpotlight.tsx
git commit -m "feat(tutorial): add TutorialSpotlight guided-highlight overlay component"
```

---

### Task 2: Wire the spotlight into `TutorialView.tsx`

**Files:**
- Modify: `src/components/tutorial/TutorialView.tsx`

**Interfaces:**
- Consumes: `TutorialSpotlight` from Task 1.
- Produces: `getGuideTarget(): { id: string; message: string } | null` — pure function computed inline in the component body (not exported), used only by this file.

- [ ] **Step 1: Import `TutorialSpotlight`**

```tsx
import TutorialSpotlight from './TutorialSpotlight';
```

Add this import line right after the existing `lucide-react` import block (top of the file).

- [ ] **Step 2: Add `getGuideTarget()` right before the `if (screen === 'welcome')` block**

```tsx
  const guideTarget: { id: string; message: string } | null = (() => {
    if (screen === 'welcome') return { id: 'welcome-start', message: 'Clique em "Começar" para iniciar a simulação.' };
    if (screen === 'catalog') return { id: 'catalog-open', message: 'Clique aqui para abrir o produto e gerar a descrição.' };
    if (screen === 'done') return null;
    if (activeTab === 'conteudo') {
      if (descriptionLoading) return null;
      if (!descriptionGenerated) return { id: 'gerar-conteudo', message: 'Clique para gerar a descrição com IA.' };
      return { id: 'tab-atributos', message: 'Agora clique na aba "Atributos".' };
    }
    if (activeTab === 'atributos') {
      if (attributesLoading) return null;
      if (!attributesGenerated) return { id: 'gerar-atributos', message: 'Clique para preencher os atributos com IA.' };
      const pending = MOCK_ATTRIBUTES.find((a) => !confirmedAttrs.has(a.key));
      if (pending) return { id: `confirm-${pending.key}`, message: `Confirme a sugestão de "${pending.label}".` };
      return { id: 'tab-imagens', message: 'Agora clique na aba "Imagens".' };
    }
    if (activeTab === 'imagens') {
      if (imagesLoading) return null;
      if (!imagesGenerated) return { id: 'gerar-imagens', message: 'Clique para gerar as imagens ambientadas com IA.' };
      return { id: 'tab-video', message: 'Agora clique na aba "Vídeo".' };
    }
    if (activeTab === 'video') {
      if (videoStatus === 'processing') return null;
      if (videoStatus === 'idle') return { id: 'gerar-video', message: 'Clique para gerar o vídeo com IA.' };
      return { id: 'finish', message: 'Tudo pronto! Clique em "Concluir tutorial".' };
    }
    return null;
  })();
```

- [ ] **Step 3: Add `data-tour="welcome-start"` to the Welcome screen's "Começar" button**

```tsx
          <button
            onClick={() => setScreen('catalog')}
            data-tour="welcome-start"
            className="mt-6 flex items-center gap-1.5 mx-auto px-5 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
          >
            Começar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }
```

Then, immediately after that closing (right before the `if (screen === 'done')` line), the Welcome screen's returned JSX must also render the spotlight. Since the button is inside a `<div className="max-w-3xl ...">` wrapper, add the spotlight as a sibling right after that wrapper's closing `</div>` but still inside the outer `return (...)`. Concretely, change:

```tsx
          </button>
        </div>
      </div>
    );
  }
```

to:

```tsx
          </button>
        </div>
        {guideTarget && <TutorialSpotlight targetId={guideTarget.id} message={guideTarget.message} />}
      </div>
    );
  }
```

- [ ] **Step 4: Same pattern for the Done screen (no spotlight needed, but confirm no regression)**

No change needed — `getGuideTarget()` already returns `null` when `screen === 'done'`, so no spotlight renders there. Skip.

- [ ] **Step 5: Add `data-tour="catalog-open"` to the catalog row's Sparkles button, and remove the old static callout**

Replace:

```tsx
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
```

with:

```tsx
                    <button
                      onClick={() => openModal('conteudo')}
                      data-tour="catalog-open"
                      className={`rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8 ${descriptionGenerated ? 'bg-[#FF5B03]/10 text-[#FF5B03] border border-[#FF5B03]/20' : 'bg-white text-slate-400 border border-slate-200 hover:border-orange-300 hover:bg-orange-50'}`}
                      title="Gerar Descrição"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
```

- [ ] **Step 6: Render the spotlight at the end of the catalog screen**

Replace the catalog screen's closing:

```tsx
          </table>
        </div>
      </div>
    );
  }
```

with:

```tsx
          </table>
        </div>
        {guideTarget && <TutorialSpotlight targetId={guideTarget.id} message={guideTarget.message} />}
      </div>
    );
  }
```

- [ ] **Step 7: Add `data-tour="finish"` to the modal header's "Concluir tutorial" button**

```tsx
            <button
              onClick={() => setScreen('done')}
              data-tour="finish"
              className="px-2.5 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors whitespace-nowrap"
            >
              Concluir tutorial
            </button>
```

- [ ] **Step 8: Add `data-tour={`tab-${tab.id}`}` to each sidebar tab button**

```tsx
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-tour={`tab-${tab.id}`}
                  className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all shrink-0 ${isActive ? 'bg-orange-50 text-[#FF5B03] shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                >
```

- [ ] **Step 9: Add `data-tour="gerar-atributos"` to the Atributos "Preencher com IA" button**

```tsx
                    <button
                      onClick={simulateAttributes}
                      disabled={attributesLoading}
                      data-tour="gerar-atributos"
                      className="relative z-10 flex items-center gap-3 px-6 py-3.5 bg-white text-purple-700 rounded-2xl font-bold transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 whitespace-nowrap"
                    >
```

- [ ] **Step 10: Add `data-tour={`confirm-${attr.key}`}` to each attribute's "Confirmar" button**

```tsx
                              <button
                                onClick={() => confirmAttribute(attr.key)}
                                data-tour={`confirm-${attr.key}`}
                                className="flex items-center gap-1.5 text-xs font-bold text-purple-600 bg-white px-3 py-1.5 rounded-lg border border-purple-200 shadow-sm hover:bg-purple-600 hover:text-white transition-all"
                              >
```

- [ ] **Step 11: Add `data-tour="gerar-conteudo"` to the Conteúdo "Gerar Conteúdo Premium" button**

```tsx
                    <button
                      onClick={simulateDescription}
                      disabled={descriptionLoading}
                      data-tour="gerar-conteudo"
                      className="px-8 py-4 bg-orange-600 text-white rounded-2xl font-bold hover:bg-orange-700 shadow-lg shadow-orange-900/20 text-sm transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 whitespace-nowrap"
                    >
```

- [ ] **Step 12: Add `data-tour="gerar-imagens"` to the Imagens "Gerar Imagens com IA" button**

```tsx
                        <button
                          onClick={simulateImages}
                          disabled={imagesLoading}
                          data-tour="gerar-imagens"
                          className="px-6 py-3 bg-gradient-to-r from-orange-600 to-orange-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 active:scale-95 disabled:opacity-50"
                        >
```

- [ ] **Step 13: Add `data-tour="gerar-video"` to the Vídeo "Gerar Vídeo com IA" button**

```tsx
                  <button
                    onClick={simulateVideo}
                    data-tour="gerar-video"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#FF5B03] rounded-lg hover:bg-[#e65200] transition-colors"
                  >
                    <Sparkles className="w-4 h-4" /> Gerar Vídeo com IA
                  </button>
```

- [ ] **Step 14: Render the spotlight at the end of the modal screen**

Replace the final return's closing:

```tsx
          </main>
        </div>
      </div>
    </div>
  );
};
```

with:

```tsx
          </main>
        </div>
      </div>
      {guideTarget && <TutorialSpotlight targetId={guideTarget.id} message={guideTarget.message} />}
    </div>
  );
};
```

- [ ] **Step 15: Type-check**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 16: Manual verification**

Run `npm run dev`, open Tutorial, and confirm the entire forced sequence end-to-end:
1. Welcome: only "Começar" is highlighted and clickable (rest of the page — sidebar, header — is darkened and unresponsive to clicks).
2. Catálogo: only the Sparkles icon is highlighted; clicking anywhere else (checkbox, Eye, Tag, other icons, "Concluir tutorial") does nothing.
3. Modal opens on Conteúdo tab, "Gerar Conteúdo Premium" highlighted; after generating, the "Atributos" sidebar tab becomes the highlighted target (everything else — Voltar, Salvar e Fechar, other tabs — darkened).
4. On Atributos: "Preencher com IA" highlighted; after generating, each "Confirmar" button is highlighted one at a time in order (Cor → Material → Tamanho → Gênero); after all 4, "Imagens" tab is highlighted.
5. On Imagens: "Gerar Imagens com IA" highlighted; after generating, "Vídeo" tab highlighted.
6. On Vídeo: "Gerar Vídeo com IA" highlighted; while processing, no highlight (nothing clickable is expected, this is fine); once done, "Concluir tutorial" (header) is highlighted.
7. Clicking it goes to the Concluído screen (no spotlight there, both buttons freely clickable).

Also verify: resizing the browser window while a spotlight is showing keeps the highlight aligned with its target (tests the `resize` listener).

- [ ] **Step 17: Commit**

```bash
git add src/components/tutorial/TutorialView.tsx
git commit -m "feat(tutorial): wire mandatory spotlight guide into the flow"
```

---

## Self-Review Notes

- Spec coverage: the full forced sequence from `2026-07-07-tutorial-tab-design-v3.md` (welcome → catalog → conteúdo → atributos ×4 → imagens → vídeo → finish) is covered by `getGuideTarget()`; the "Geral" tab is correctly excluded from the sequence (never returned as a target).
- No automated tests; verification is `npm run lint` + manual browser walkthrough per the project's established pattern.
- Type consistency: `targetId`/`data-tour` string values match exactly between `getGuideTarget()`'s returned `id`s and the `data-tour` attributes added in Steps 3, 5, 7-13 (`welcome-start`, `catalog-open`, `tab-geral`/`tab-atributos`/`tab-conteudo`/`tab-imagens`/`tab-video`, `gerar-atributos`, `confirm-cor`/`confirm-material`/`confirm-tamanho`/`confirm-genero`, `gerar-conteudo`, `gerar-imagens`, `gerar-video`, `finish`).
