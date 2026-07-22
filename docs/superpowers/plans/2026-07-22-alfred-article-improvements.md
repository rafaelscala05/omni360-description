# Alfred Article Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Alfred's article generator to stop opening with a persona greeting, let users regenerate the article's cover image (with an improvement prompt or from a linked product's photo), and replace the free-text "produtos vinculados" field with a real product autocomplete.

**Architecture:** All changes live in the existing Alfred/Content module (`server/contentAgent.ts`, `src/services/contentService.ts`, `src/modules/content/`). No new module boundaries — this extends the existing 5-stage article pipeline and `ArticleView.tsx` modal. Product data flows from Firestore straight into the Content module via a new client-side read (no new server endpoint), since the module currently has zero visibility into the Product domain.

**Tech Stack:** Express + `@google/genai` (Vertex AI mode) on the server, React 19 + Firestore client SDK on the front end, TypeScript throughout.

## Global Constraints

- This project has **no automated test suite** (confirmed in `CLAUDE.md`: "There are no automated tests. The app is validated manually by running the dev server."). Every task below replaces "write/run automated test" steps with **`npm run lint`** (type-check) plus a **manual verification** procedure using `npm run dev`. Do not introduce a new test framework.
- All UI text, prompts, and field labels are in pt-BR, matching the rest of the app.
- Reuse `CREDIT_ACTIONS.contentImage` for image regeneration — do not add a new credit action.
- `produtosVinculados` becomes an array of real `Product._id` values going forward; existing free-text entries are left as-is (displayed as plain text, no thumbnail) until the user re-links them. No migration script.
- Feature 3 (product linking) must land before Feature 2's "generate from product" button, since that button consumes the resolved product image. This plan orders tasks accordingly.

---

### Task 1: Stop Alfred's persona greeting in generated articles

**Files:**
- Modify: `server/contentAgent.ts:595-604` (Stage 3 — draft prompt)
- Modify: `server/contentAgent.ts:606-614` (Stage 4 — review/humanization prompt)

**Interfaces:** None — pure prompt text change, no signature changes.

- [ ] **Step 1: Add an explicit anti-greeting instruction to the Stage 3 (draft) prompt**

In `server/contentAgent.ts`, find:

```ts
    // ETAPA 3 — Draft
    const articleDraft = await generateText(
      [
        `Escreva o artigo completo em Markdown seguindo o outline abaixo, com 1.200 a 2.500 palavras.`,
        'Parágrafos curtos, subtítulos escaneáveis, KW principal no H1 e primeiro parágrafo, CTA ao final.',
        `OUTLINE:\n${articleOutline}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.7 },
    );
```

Replace with:

```ts
    // ETAPA 3 — Draft
    const articleDraft = await generateText(
      [
        `Escreva o artigo completo em Markdown seguindo o outline abaixo, com 1.200 a 2.500 palavras.`,
        'Parágrafos curtos, subtítulos escaneáveis, KW principal no H1 e primeiro parágrafo, CTA ao final.',
        'Comece direto pelo conteúdo do artigo: NUNCA inclua saudação, auto-apresentação ou menção ao autor/persona (por exemplo "Olá! [nome] aqui", "Prepare-se para uma leitura que...", "Sou [nome] e vou te contar"). O primeiro parágrafo deve ir direto ao assunto do H1, sem repetir o título.',
        `OUTLINE:\n${articleOutline}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.7 },
    );
```

- [ ] **Step 2: Add a safety-net instruction to the Stage 4 (review/humanization) prompt**

Find:

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
```

Replace with:

```ts
    // ETAPA 4 — Review + humanization
    const articleFinal = await generateText(
      [
        'Revise e humanize o artigo abaixo: elimine construções típicas de IA, adicione opiniões assertivas e exemplos concretos, mantenha o tom de voz.',
        'Se o texto abaixo começar com qualquer saudação, auto-apresentação ou menção à persona/autor (por exemplo "Olá! [nome] aqui", "Prepare-se para..."), REMOVA essa abertura por completo e reescreva o início para começar direto no conteúdo do primeiro parágrafo.',
        'Ao final, em uma linha separada, forneça: SLUG: <slug-amigavel> e META: <meta description>.',
        `ARTIGO:\n${articleDraft}`,
      ].join('\n\n'),
      { systemInstruction: sys, temperature: 0.6 },
    );
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no errors (this task only changes string literals inside existing calls).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open the app, go to the Content workspace, open an existing project with an approved cluster, and produce a new article (button "Produzir agora" on a scheduled article, or trigger via the calendar). Open the produced article and confirm:
- The rendered content (Visualizar tab) starts directly with the first paragraph — no "Olá, [algo] aqui" or similar opening line.
- `SLUG:`/`META:` still populate correctly (unaffected by this change).

If a greeting still slips through occasionally, that's expected to be rare (LLM output isn't 100% deterministic) — the fix is judged on whether it disappears in normal runs, not on a hard guarantee.

- [ ] **Step 5: Commit**

```bash
git add server/contentAgent.ts
git commit -m "fix(content): impede saudação/auto-apresentação da persona no texto do artigo"
```

---

### Task 2: Add product lookup for the Content module (client-side)

**Files:**
- Modify: `src/services/contentService.ts`

**Interfaces:**
- Produces: `export interface LinkableProduct { id: string; nome: string; sku: string; imagemPrincipal?: string }` and `export async function listProductsForLinking(uid: string): Promise<LinkableProduct[]>` — consumed by Task 3.

- [ ] **Step 1: Add the `getDocs` import**

In `src/services/contentService.ts`, find the firestore import block:

```ts
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
} from 'firebase/firestore';
```

Replace with:

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

- [ ] **Step 2: Add `listProductsForLinking`**

Add this near the bottom of the "Firestore CRUD" section (after `moveArticle`, before "Realtime listeners"):

```ts
// ---------------------------------------------------------------------------
// Product linking (Content module has no other visibility into the Product
// domain — this reads users/{uid}/products directly, same path App.tsx uses,
// no new server endpoint needed).
// ---------------------------------------------------------------------------

export interface LinkableProduct {
  id: string;
  nome: string;
  sku: string;
  imagemPrincipal?: string;
}

export async function listProductsForLinking(uid: string): Promise<LinkableProduct[]> {
  const snap = await getDocs(collection(db, `users/${uid}/products`));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const selectedImage = typeof data._selectedImage === 'string' ? data._selectedImage : undefined;
    const firstImage = typeof data['URL imagem 1'] === 'string' ? (data['URL imagem 1'] as string) : undefined;
    const id = (typeof data._id === 'string' && data._id) || d.id;
    const nome = (typeof data['Descrição'] === 'string' && data['Descrição']) || '(sem nome)';
    const sku = (typeof data['Código (SKU)'] === 'string' && data['Código (SKU)']) || '';
    return { id, nome, sku, imagemPrincipal: selectedImage || firstImage };
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Temporarily add `console.log(await listProductsForLinking(uid))` in a component that already has `uid` in scope (e.g. inside `ArticlesProductionView`'s existing `useEffect`), run `npm run dev`, open the Content workspace with a real logged-in account that has products, and confirm the console prints an array of `{ id, nome, sku, imagemPrincipal }` matching real products. Remove the temporary log afterward.

- [ ] **Step 5: Commit**

```bash
git add src/services/contentService.ts
git commit -m "feat(content): adiciona leitura de produtos para vinculação em artigos"
```

---

### Task 3: Replace free-text "Produtos vinculados" with a real autocomplete

**Files:**
- Create: `src/modules/content/ProductLinkPicker.tsx`
- Modify: `src/modules/content/ArticleView.tsx`
- Modify: `src/modules/content/types.ts:192` (comment only)

**Interfaces:**
- Consumes: `LinkableProduct`, `listProductsForLinking` from Task 2.
- Produces: `ProductLinkPicker` component with props `{ products: LinkableProduct[]; selectedIds: string[]; onChange: (ids: string[]) => void }`, and (in `ArticleView.tsx`) local state `selectedProductIds: string[]` and `allProducts: LinkableProduct[]` — consumed by Task 5 (image-from-product button).

- [ ] **Step 1: Update the field comment in `types.ts`**

In `src/modules/content/types.ts:192`, find:

```ts
  produtosVinculados?: string[]; // nomes/IDs de produtos vinculados
```

Replace with:

```ts
  produtosVinculados?: string[]; // IDs de Product._id vinculados (artigos antigos podem ter texto livre até serem re-vinculados)
```

- [ ] **Step 2: Create `ProductLinkPicker.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { LinkableProduct } from '../../services/contentService';

interface Props {
  products: LinkableProduct[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const ProductLinkPicker: React.FC<Props> = ({ products, selectedIds, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () =>
      selectedIds.map(
        (id) => products.find((p) => p.id === id) ?? { id, nome: id, sku: '', imagemPrincipal: undefined },
      ),
    [selectedIds, products],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => !selectedIds.includes(p.id))
      .filter((p) => p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products, query, selectedIds]);

  const addProduct = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery('');
    setOpen(false);
  };

  const removeProduct = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-700"
            >
              {p.imagemPrincipal ? (
                <img src={p.imagemPrincipal} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <span className="w-5 h-5 rounded-full bg-slate-300" />
              )}
              {p.nome}
              <button
                type="button"
                onClick={() => removeProduct(p.id)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center border border-slate-300 rounded-lg px-3 py-2 focus-within:ring-1 focus-within:ring-[#FF5B03] focus-within:border-[#FF5B03]">
          <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Buscar produto por nome ou SKU..."
            className="flex-1 text-sm focus:outline-none"
          />
        </div>
        {open && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addProduct(p.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
              >
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-6 h-6 rounded object-cover" />
                ) : (
                  <span className="w-6 h-6 rounded bg-slate-200" />
                )}
                <span className="flex-1 truncate">{p.nome}</span>
                <span className="text-slate-400 text-xs">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductLinkPicker;
```

- [ ] **Step 3: Wire it into `ArticleView.tsx`**

In `src/modules/content/ArticleView.tsx`, update the imports:

```ts
import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, RefreshCw, Globe, ExternalLink, Play, Pencil, Eye, Code } from 'lucide-react';
import type { CalendarArticle } from './types';
import { updateArticle, publishArticle, produceArticle, listProductsForLinking, type LinkableProduct } from '../../services/contentService';
import { markdownToHtml } from './markdown';
import ProductLinkPicker from './ProductLinkPicker';
```

Replace the `produtos` state:

```ts
  const [produtos, setProdutos] = useState(
    (article.produtosVinculados ?? []).join(', '),
  );
```

with:

```ts
  const [allProducts, setAllProducts] = useState<LinkableProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(article.produtosVinculados ?? []);

  useEffect(() => {
    listProductsForLinking(uid).then(setAllProducts).catch(() => setAllProducts([]));
  }, [uid]);

  const linkedProducts = useMemo(
    () =>
      selectedProductIds.map(
        (id) => allProducts.find((p) => p.id === id) ?? { id, nome: id, sku: '', imagemPrincipal: undefined },
      ),
    [selectedProductIds, allProducts],
  );

  const saveProdutos = (ids: string[]) => {
    setSelectedProductIds(ids);
    run('produtos', () => updateArticle(uid, projectId, article.id, { produtosVinculados: ids }));
  };
```

Replace the "Produtos vinculados" block:

```tsx
          {/* Produtos vinculados */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Produtos vinculados</label>
            <input
              value={produtos}
              onChange={(e) => setProdutos(e.target.value)}
              onBlur={() => run('produtos', () => updateArticle(uid, projectId, article.id, {
                produtosVinculados: produtos.split(',').map((s) => s.trim()).filter(Boolean),
              }))}
              placeholder="Nome ou ID dos produtos, separados por vírgula"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
            />
          </div>
```

with:

```tsx
          {/* Produtos vinculados */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Produtos vinculados</label>
            <ProductLinkPicker products={allProducts} selectedIds={selectedProductIds} onChange={saveProdutos} />
          </div>
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no errors. (`linkedProducts` is unused until Task 5 wires it into the image buttons — if `tsc --noEmit` flags it as unused, that's fine since Task 5 lands in the same file next; if you're executing tasks independently and lint fails on the unused variable, prefix it `_linkedProducts` temporarily and rename back in Task 5.)

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open an article in the Content workspace, and confirm:
- Typing in the "Produtos vinculados" field shows a dropdown of real products filtered by name/SKU.
- Selecting a product adds a removable chip with its thumbnail (or a gray placeholder if it has no image).
- Removing a chip and reloading the article (close/reopen the modal) persists the change — the chip stays removed.
- An article that still has legacy free-text products (if any exist in your test data) shows those as chips with the raw text as the name and no thumbnail, without crashing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/ProductLinkPicker.tsx src/modules/content/ArticleView.tsx src/modules/content/types.ts
git commit -m "feat(content): autocomplete real de produtos vinculados ao artigo"
```

---

### Task 4: Server-side image regeneration endpoint

**Files:**
- Modify: `server/contentAgent.ts`

**Interfaces:**
- Produces: `POST /api/content/projects/:projectId/articles/:articleId/regenerate-image` accepting body `{ mode: 'improve'; improvementPrompt: string } | { mode: 'fromProduct'; baseProductImageUrl: string }`, responding `{ imageUrl: string }` — consumed by Task 5.

- [ ] **Step 1: Make `generateImageBase64` accept an optional reference image**

Find (`server/contentAgent.ts:127-144`):

```ts
// Generates a cover image, returns raw base64 (no data: prefix).
async function generateImageBase64(prompt: string): Promise<string> {
  const ai = getClient();
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  );
  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = (part as { inlineData?: { data?: string } }).inlineData?.data;
      if (data) return data;
    }
  }
  throw new Error('O modelo não retornou uma imagem.');
}
```

Replace with:

```ts
// Generates a cover image, returns raw base64 (no data: prefix). When
// referenceImage is given, sends it as an inlineData part alongside the
// prompt so the model anchors the new image on it (image-to-image), same
// multi-part pattern as generateImage() in src/services/aiService.ts.
async function generateImageBase64(
  prompt: string,
  referenceImage?: { mimeType: string; data: string },
): Promise<string> {
  const ai = getClient();
  const contents = referenceImage
    ? [{ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.data } }, { text: prompt }]
    : prompt;
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: contents as never,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  );
  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = (part as { inlineData?: { data?: string } }).inlineData?.data;
      if (data) return data;
    }
  }
  throw new Error('O modelo não retornou uma imagem.');
}
```

- [ ] **Step 2: Add `fetchImageAsBase64` and `regenerateArticleImage`**

Add this after `runArticlePipeline` (right before the `// Fase 5 — WordPress publishing` comment at `server/contentAgent.ts:658`):

```ts
// Downloads an existing image (e.g. a product photo) and returns it as base64
// + mime type, for use as a reference image in generateImageBase64().
async function fetchImageAsBase64(url: string): Promise<{ mimeType: string; data: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Não foi possível baixar a imagem do produto.');
  const buf = Buffer.from(await resp.arrayBuffer());
  const mimeType = resp.headers.get('content-type') || 'image/jpeg';
  return { mimeType, data: buf.toString('base64') };
}

async function regenerateArticleImage(
  uid: string,
  projectId: string,
  articleId: string,
  opts: { mode: 'improve' | 'fromProduct'; improvementPrompt?: string; baseProductImageUrl?: string },
): Promise<string> {
  const project = await loadProject(uid, projectId);
  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };

  const estiloLabel = (() => {
    const e = project.config.estiloImagem;
    if (!e) return 'fotorrealista';
    return e === 'Ilustracao' ? 'Ilustração' : e;
  })();

  const promptParts = [
    `Imagem de capa para um artigo de blog sobre "${article.titulo}".`,
    `Contexto: ${(article.articleFinal ?? article.articleDraft ?? '').slice(0, 400)}.`,
    `Estilo visual: ${estiloLabel}. Composição limpa, elementos simbólicos do tema, sem texto e sem rostos hiperrealistas.`,
    `Marca: ${project.config.nomeEmpresa}. Formato 16:9, alta resolução.`,
  ];

  let referenceImage: { mimeType: string; data: string } | undefined;
  if (opts.mode === 'improve') {
    if (!opts.improvementPrompt?.trim()) {
      throw Object.assign(new Error('Descreva o ajuste desejado para a imagem.'), { status: 400 });
    }
    promptParts.push(`Ajustes solicitados pelo usuário: ${opts.improvementPrompt.trim()}.`);
  } else {
    if (!opts.baseProductImageUrl) {
      throw Object.assign(new Error('Imagem do produto não informada.'), { status: 400 });
    }
    referenceImage = await fetchImageAsBase64(opts.baseProductImageUrl);
    promptParts.push(
      'Use a imagem do produto anexada como referência visual central da composição, mantendo suas cores e formato reconhecíveis.',
    );
  }

  const base64 = await generateImageBase64(promptParts.join(' '), referenceImage);
  const imageUrl = await saveImage(base64, uid, articleId);
  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentImage, { productName: article.titulo });
  await artRef.update({ imageUrl, updatedAt: new Date().toISOString() });
  return imageUrl;
}
```

- [ ] **Step 3: Register the route**

In `registerContentRoutes`, find the `produce` route (`server/contentAgent.ts:1051-1059`):

```ts
  app.post('/api/content/projects/:projectId/articles/:articleId/produce', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      await runArticlePipeline(decoded.uid, req.params.projectId, req.params.articleId);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
```

Add this route right after it (still inside `registerContentRoutes`, before the `publish` route):

```ts
  app.post('/api/content/projects/:projectId/articles/:articleId/regenerate-image', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const body = req.body as {
        mode?: 'improve' | 'fromProduct';
        improvementPrompt?: string;
        baseProductImageUrl?: string;
      };
      if (body.mode !== 'improve' && body.mode !== 'fromProduct') {
        return res.status(400).json({ error: 'mode inválido' });
      }
      const imageUrl = await regenerateArticleImage(
        decoded.uid,
        req.params.projectId,
        req.params.articleId,
        body,
      );
      res.json({ imageUrl });
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`. Using a REST client (or `curl` with a real Firebase ID token from the browser's devtools/localStorage), call:

```bash
curl -X POST http://localhost:3000/api/content/projects/<projectId>/articles/<articleId>/regenerate-image \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"improve","improvementPrompt":"fundo branco, mais luminosa"}'
```

Expected: `{"imageUrl": "https://firebasestorage.googleapis.com/..."}`, and the article's `imageUrl` field updates in Firestore. Also try `mode: "fromProduct"` with a real product image URL as `baseProductImageUrl` and confirm it returns a new `imageUrl` too. (This step will be exercised again through the UI in Task 5 — this manual call just isolates the backend before wiring the button.)

- [ ] **Step 6: Commit**

```bash
git add server/contentAgent.ts
git commit -m "feat(content): endpoint para regenerar a imagem de capa do artigo"
```

---

### Task 5: Image regeneration buttons in the article view

**Files:**
- Modify: `src/services/contentService.ts`
- Modify: `src/modules/content/ArticleView.tsx`

**Interfaces:**
- Consumes: `POST .../regenerate-image` from Task 4; `allProducts`, `selectedProductIds`, `linkedProducts` from Task 3.
- Produces: none further downstream (UI leaf).

- [ ] **Step 1: Add the client call in `contentService.ts`**

Add near `produceArticle`/`publishArticle`:

```ts
export type RegenerateImagePayload =
  | { mode: 'improve'; improvementPrompt: string }
  | { mode: 'fromProduct'; baseProductImageUrl: string };

export const regenerateArticleImage = (
  projectId: string,
  articleId: string,
  payload: RegenerateImagePayload,
) =>
  callJson<{ imageUrl: string }>(
    `/api/content/projects/${projectId}/articles/${articleId}/regenerate-image`,
    'POST',
    payload,
  );
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Add the buttons to `ArticleView.tsx`**

Update the imports (adding `Wand2`, `Image as ImageIcon`, and the new service function):

```ts
import { X, Check, RefreshCw, Globe, ExternalLink, Play, Pencil, Eye, Code, Wand2, Image as ImageIcon } from 'lucide-react';
import {
  updateArticle,
  publishArticle,
  produceArticle,
  listProductsForLinking,
  regenerateArticleImage,
  type LinkableProduct,
} from '../../services/contentService';
```

Add state (alongside the other `useState` calls near the top of the component):

```ts
  const [showImprovePrompt, setShowImprovePrompt] = useState(false);
  const [improvementPrompt, setImprovementPrompt] = useState('');
  const [productImageChoice, setProductImageChoice] = useState<string>('');
```

Replace the cover image block:

```tsx
          {article.imageUrl && (
            <img src={article.imageUrl} alt="Capa" className="w-full rounded-xl border border-slate-200" />
          )}
```

with:

```tsx
          {article.imageUrl && (
            <div className="space-y-2">
              <img src={article.imageUrl} alt="Capa" className="w-full rounded-xl border border-slate-200" />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImprovePrompt((v) => !v)}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Gerar novamente
                </button>
                {linkedProducts.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      run('image-product', async () => {
                        const targetId = linkedProducts.length === 1 ? linkedProducts[0].id : productImageChoice;
                        const product = linkedProducts.find((p) => p.id === targetId);
                        if (!product?.imagemPrincipal) {
                          setError('Selecione um produto vinculado que tenha imagem principal.');
                          return;
                        }
                        const { imageUrl } = await regenerateArticleImage(projectId, article.id, {
                          mode: 'fromProduct',
                          baseProductImageUrl: product.imagemPrincipal,
                        });
                        void imageUrl; // listenCalendar no componente pai atualiza o article.imageUrl
                      })
                    }
                    disabled={!!busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
                  >
                    <ImageIcon className="w-3.5 h-3.5" /> Gerar a partir do produto
                  </button>
                )}
                {linkedProducts.length > 1 && (
                  <select
                    value={productImageChoice}
                    onChange={(e) => setProductImageChoice(e.target.value)}
                    className="text-xs border border-slate-300 rounded-lg px-2 py-1.5"
                  >
                    <option value="">Escolher produto...</option>
                    {linkedProducts
                      .filter((p) => p.imagemPrincipal)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              {showImprovePrompt && (
                <div className="flex items-center gap-2">
                  <input
                    value={improvementPrompt}
                    onChange={(e) => setImprovementPrompt(e.target.value)}
                    placeholder="Ex: fundo branco, mais luminosa, foco no produto"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      run('image-improve', async () => {
                        await regenerateArticleImage(projectId, article.id, {
                          mode: 'improve',
                          improvementPrompt,
                        });
                        setShowImprovePrompt(false);
                        setImprovementPrompt('');
                      })
                    }
                    disabled={!!busy || !improvementPrompt.trim()}
                    className="px-3 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg"
                  >
                    {busy === 'image-improve' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open a produced article (one that already has a cover image and at least one linked product with a main image):
- Click "Gerar novamente", type an improvement prompt (e.g. "fundo branco"), click "Aplicar" — a loading spinner shows on the button, then the cover image updates to a new one within a few seconds (via the article's Firestore listener in the parent view, no manual refresh needed).
- With exactly one linked product: click "Gerar a partir do produto" directly — the cover image regenerates using that product's photo as reference.
- With two or more linked products: confirm the product `<select>` appears, pick one, then click "Gerar a partir do produto" — the new cover image should visually resemble the chosen product.
- With zero linked products: confirm the "Gerar a partir do produto" button is not rendered at all.
- Confirm a credit is debited each time (check the credits counter in the app header, or `users/{uid}/credit_logs` in Firestore).

- [ ] **Step 6: Commit**

```bash
git add src/services/contentService.ts src/modules/content/ArticleView.tsx
git commit -m "feat(content): botões para regenerar a imagem de capa do artigo"
```

---

## Post-plan check

After all 5 tasks: run `npm run lint` once more from a clean working tree to confirm the whole module still type-checks end-to-end, then do one full manual pass — produce a fresh article from scratch and confirm all three features together: no greeting in the text, products can be linked via autocomplete, and both image-regeneration buttons work against that article.
