# Tiny Push Auto-Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "which fields to send" checkboxes in the Tiny ERP push flow with automatic, per-field diffing against Tiny's live current data, so nothing is ever pushed unless it actually changed.

**Architecture:** Move the "should this field be sent?" decision from the client (checkbox selection + sticky `_enrichmentLog`/`_statusDescricao` flags + a locally cached "last pushed" signature) to the server, at the exact point it already fetches the product's current Tiny state before building the update payload (`updateV2Product` in `server/tinyV2.ts`, `buildProductPutBody` in `server/tinyAgent.ts`). Each field is compared against Tiny's live value; only fields that differ (and have local content) are included in the outgoing request. The client stops selecting field groups entirely — it just sends every locally-known value for the selected products, and the server decides what's actually worth writing.

**Tech Stack:** TypeScript, Express (`server/`), React 19 (`src/`), no test framework — verified via `npm run lint` (`tsc --noEmit`) and manual exercise via `npm run dev`.

## Global Constraints

- No automated tests exist in this repo. Every "verify" step below means: `npm run lint` passes, and/or manually exercising the flow via `npm run dev`.
- Do not touch the Bling integration (`server/blingAgent.ts`, `src/components/integrations/BlingConnector.tsx`, etc.) — it has its own separate types and is out of scope.
- Preserve the existing v2/v3 dispatch shape in `server/tinyProvider.ts` (`tinyUpdateProduct`) — only its return type and internals change.
- UI copy is pt-BR, matching the rest of the app.

---

### Task 1: Server — diff-based push logic (v2 + v3)

**Files:**
- Modify: `server/tinyAgent.ts:235-354` (`TinyPushProduct`, `TinyPushResult`, `buildProductPutBody`)
- Modify: `server/tinyV2.ts:177-230` (`updateV2Product`)
- Modify: `server/tinyProvider.ts:57-62` (`tinyUpdateProduct`), `server/tinyProvider.ts:93-131` (push route)

**Interfaces:**
- Produces: `TinyPushSteps = Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>` (exported from `server/tinyAgent.ts`), where each value is one of `'ok'` (field(s) differed from Tiny and were sent), `'sem alteração'` (local data present but identical to what Tiny already has — nothing sent), or `'sem dado local'` (nothing locally to compare/send for that group).
- Produces: `TinyPushProduct` (in `server/tinyAgent.ts`) with the `campos` field **removed**.
- Produces: `buildProductPutBody(current, prod): { body: Record<string, unknown>; steps: TinyPushSteps }` (return type changed from a bare body to `{ body, steps }`).
- Produces: `updateV2Product(uid, id, prod): Promise<TinyPushSteps>` (return type changed from `Promise<void>`).
- Produces: `tinyUpdateProduct(uid, id, prod, version?): Promise<TinyPushSteps>` (return type changed from `Promise<void>`).
- Consumes (unchanged): `TinyNormalizedProduct`, `normalizeProduct`, `normalizeV2Product`, `tinyFetch`, `tinyV2Call`, `collectV2Images`.

- [ ] **Step 1: Update the shared types in `server/tinyAgent.ts`**

Replace the `TinyPushProduct`/`TinyPushResult` block (lines 235-259) with:

```ts
export interface TinyPushProduct {
  tinyId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  // Public image URLs to attach as product anexos.
  imagens?: string[];
}

// Per-group outcome of a push attempt: 'ok' (sent — differed from Tiny's current
// value), 'sem alteração' (local data matches Tiny already, nothing sent), or
// 'sem dado local' (nothing locally to compare/send for this group). Field errors
// use the exception message in place of one of these three.
export type TinyPushSteps = Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;

export interface TinyPushResult {
  tinyId: string;
  sku?: string;
  ok: boolean;
  steps: TinyPushSteps;
}
```

- [ ] **Step 2: Rewrite `buildProductPutBody` to diff against live Tiny data**

Replace the whole function (lines 261-354, from the `// Builds a valid AtualizarProdutoRequestModel...` comment through the closing `return body;` / `}`) with:

```ts
// Builds a valid AtualizarProdutoRequestModel body from the current product,
// echoing every field the API expects (Tiny's PUT is a full-record update) and
// overriding only the fields whose local value actually differs from what Tiny
// already has — never previously-selected groups, never blank local data.
export function buildProductPutBody(current: any, prod: TinyPushProduct): { body: Record<string, unknown>; steps: TinyPushSteps } {
  const dim = current?.dimensoes ?? {};
  const seo = current?.seo ?? {};
  const precos = current?.precos ?? {};
  const estoque = current?.estoque ?? {};
  const cur = normalizeProduct(current);
  const steps: TinyPushSteps = {
    descricao: 'sem dado local', seo: 'sem dado local', fiscal: 'sem dado local', imagens: 'sem dado local',
  };
  const strDiffers = (a?: string, b?: string) => (a ?? '').trim() !== (b ?? '').trim();

  const body: Record<string, any> = {
    sku: current?.sku,
    descricao: current?.descricao,
    descricaoComplementar: current?.descricaoComplementar,
    unidade: current?.unidade,
    ncm: current?.ncm,
    gtin: current?.gtin,
    marca: current?.marca?.id ? { id: current.marca.id } : undefined,
    categoria: current?.categoria?.id ? { id: current.categoria.id } : undefined,
    precos: (precos.preco != null || precos.precoPromocional != null || precos.precoCusto != null)
      ? { preco: precos.preco, precoPromocional: precos.precoPromocional, precoCusto: precos.precoCusto }
      : undefined,
    // Echo the current stock config so an atomic PUT can't reset it. quantidade is
    // read-only on the response and not part of the request model, so it's omitted.
    estoque: {
      controlar: estoque.controlar,
      sobEncomenda: estoque.sobEncomenda,
      minimo: estoque.minimo,
      maximo: estoque.maximo,
      diasPreparacao: estoque.diasPreparacao,
      localizacao: estoque.localizacao,
    },
    dimensoes: {
      largura: dim.largura,
      altura: dim.altura,
      comprimento: dim.comprimento,
      diametro: dim.diametro,
      pesoLiquido: dim.pesoLiquido,
      pesoBruto: dim.pesoBruto,
    },
    seo: {
      titulo: seo.titulo,
      descricao: seo.descricao,
      keywords: Array.isArray(seo.keywords) ? seo.keywords : undefined,
      slug: seo.slug,
      linkVideo: seo.linkVideo,
    },
  };

  if (prod.descricaoHtml) {
    steps.descricao = strDiffers(prod.descricaoHtml, cur.descricaoHtml) ? 'ok' : 'sem alteração';
    if (steps.descricao === 'ok') body.descricaoComplementar = prod.descricaoHtml;
  }

  let seoChanged = false;
  if (prod.seoTitle && strDiffers(prod.seoTitle, cur.seoTitle)) { body.seo.titulo = prod.seoTitle; seoChanged = true; }
  if (prod.seoDescription && strDiffers(prod.seoDescription, cur.seoDescription)) { body.seo.descricao = prod.seoDescription; seoChanged = true; }
  if (prod.seoKeywords && strDiffers(prod.seoKeywords, cur.seoKeywords)) {
    body.seo.keywords = prod.seoKeywords.split(',').map((k) => k.trim()).filter(Boolean);
    seoChanged = true;
  }
  if (prod.seoTitle || prod.seoDescription || prod.seoKeywords) {
    steps.seo = seoChanged ? 'ok' : 'sem alteração';
  }

  let fiscalChanged = false;
  const hasFiscalLocal = !!prod.ncm || !!prod.gtin || prod.pesoLiquido != null
    || prod.pesoBruto != null || prod.largura != null || prod.altura != null || prod.comprimento != null;
  if (prod.ncm && strDiffers(prod.ncm, cur.ncm)) { body.ncm = prod.ncm; fiscalChanged = true; }
  if (prod.gtin && strDiffers(prod.gtin, cur.gtin)) { body.gtin = prod.gtin; fiscalChanged = true; }
  if (prod.pesoLiquido != null && prod.pesoLiquido !== cur.pesoLiquido) { body.dimensoes.pesoLiquido = prod.pesoLiquido; fiscalChanged = true; }
  if (prod.pesoBruto != null && prod.pesoBruto !== cur.pesoBruto) { body.dimensoes.pesoBruto = prod.pesoBruto; fiscalChanged = true; }
  if (prod.largura != null && prod.largura !== cur.largura) { body.dimensoes.largura = prod.largura; fiscalChanged = true; }
  if (prod.altura != null && prod.altura !== cur.altura) { body.dimensoes.altura = prod.altura; fiscalChanged = true; }
  if (prod.comprimento != null && prod.comprimento !== cur.comprimento) { body.dimensoes.comprimento = prod.comprimento; fiscalChanged = true; }
  if (hasFiscalLocal) steps.fiscal = fiscalChanged ? 'ok' : 'sem alteração';

  if (prod.imagens?.length) {
    // anexos is documented on product creation; PUT appears to accept it too.
    // Merge with the current anexos (dedup by url) so existing photos aren't lost —
    // and only touch the field at all when there's a genuinely new URL to add.
    const current_anexos: any[] = Array.isArray(current?.anexos) ? current.anexos : [];
    const byUrl = new Map<string, { url: string; externo: boolean }>();
    for (const a of current_anexos) {
      if (a?.url) byUrl.set(a.url, { url: a.url, externo: a.externo ?? true });
    }
    let imagensChanged = false;
    for (const url of prod.imagens) {
      if (url && !byUrl.has(url)) { byUrl.set(url, { url, externo: true }); imagensChanged = true; }
    }
    steps.imagens = imagensChanged ? 'ok' : 'sem alteração';
    if (imagensChanged) body.anexos = Array.from(byUrl.values());
  }

  // Drop empty nested objects and undefined keys so we never send nulls the API rejects.
  const prune = (obj: Record<string, any>) => {
    Object.keys(obj).forEach((k) => {
      if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        prune(obj[k]);
        if (Object.keys(obj[k]).length === 0) delete obj[k];
      }
      if (obj[k] === undefined) delete obj[k];
    });
  };
  prune(body);
  return { body, steps };
}
```

- [ ] **Step 3: Rewrite `updateV2Product` in `server/tinyV2.ts` to diff against live Tiny data**

First, update the top-of-file import (line 4) to bring in the new `TinyPushSteps` type:

```ts
import { SECRET_REF, sleep, type TinyNormalizedProduct, type TinyPushProduct, type TinyPushSteps } from './tinyAgent';
```

Then replace the whole function (lines 175-230, from the `// Updates a product via produto.alterar.php...` comment through the closing `}`) with:

```ts
// Updates a product via produto.alterar.php, sending only the fields whose local
// value actually differs from what Tiny currently has. produto.alterar is NOT a
// partial update — it validates the whole record — so required fields
// (unidade/preco/origem/situacao/tipo) are always echoed from the current product;
// only descricao_complementar/seo/fiscal/imagens are conditionally overridden.
// Skips the API call entirely when nothing differs.
export async function updateV2Product(uid: string, id: string, prod: TinyPushProduct): Promise<TinyPushSteps> {
  const current = (await tinyV2Call(uid, 'produto.obter.php', { id }))?.produto ?? {};
  const cur = normalizeV2Product(current);
  const steps: TinyPushSteps = {
    descricao: 'sem dado local', seo: 'sem dado local', fiscal: 'sem dado local', imagens: 'sem dado local',
  };
  const strDiffers = (a?: string, b?: string) => (a ?? '').trim() !== (b ?? '').trim();

  const produto: Record<string, any> = {
    sequencia: 1,
    id,
    codigo: current?.codigo,
    nome: current?.nome,
    unidade: current?.unidade,
    preco: current?.preco,
    origem: current?.origem,
    situacao: current?.situacao,
    tipo: current?.tipo,
  };

  if (prod.descricaoHtml) {
    steps.descricao = strDiffers(prod.descricaoHtml, cur.descricaoHtml) ? 'ok' : 'sem alteração';
    if (steps.descricao === 'ok') produto.descricao_complementar = prod.descricaoHtml;
  }

  const seo: Record<string, any> = {};
  let seoChanged = false;
  if (prod.seoTitle && strDiffers(prod.seoTitle, cur.seoTitle)) { seo.seo_title = prod.seoTitle; seoChanged = true; }
  if (prod.seoDescription && strDiffers(prod.seoDescription, cur.seoDescription)) { seo.seo_description = prod.seoDescription; seoChanged = true; }
  if (prod.seoKeywords && strDiffers(prod.seoKeywords, cur.seoKeywords)) { seo.seo_keywords = prod.seoKeywords; seoChanged = true; }
  if (prod.seoTitle || prod.seoDescription || prod.seoKeywords) steps.seo = seoChanged ? 'ok' : 'sem alteração';
  if (seoChanged) produto.seo = seo;

  const hasFiscalLocal = !!prod.ncm || !!prod.gtin || prod.pesoLiquido != null
    || prod.pesoBruto != null || prod.largura != null || prod.altura != null || prod.comprimento != null;
  let fiscalChanged = false;
  if (prod.ncm && strDiffers(prod.ncm, cur.ncm)) { produto.ncm = prod.ncm; fiscalChanged = true; }
  if (prod.gtin && strDiffers(prod.gtin, cur.gtin)) { produto.gtin = prod.gtin; fiscalChanged = true; }
  if (prod.pesoLiquido != null && prod.pesoLiquido !== cur.pesoLiquido) { produto.peso_liquido = prod.pesoLiquido; fiscalChanged = true; }
  if (prod.pesoBruto != null && prod.pesoBruto !== cur.pesoBruto) { produto.peso_bruto = prod.pesoBruto; fiscalChanged = true; }
  if (prod.largura != null && prod.largura !== cur.largura) { produto.largura_embalagem = prod.largura; fiscalChanged = true; }
  if (prod.altura != null && prod.altura !== cur.altura) { produto.altura_embalagem = prod.altura; fiscalChanged = true; }
  if (prod.comprimento != null && prod.comprimento !== cur.comprimento) { produto.comprimento_embalagem = prod.comprimento; fiscalChanged = true; }
  if (hasFiscalLocal) steps.fiscal = fiscalChanged ? 'ok' : 'sem alteração';

  let imagensChanged = false;
  if (prod.imagens?.length) {
    // Send ONLY images the product doesn't already have. Re-sending Tiny's own
    // hosted images (e.g. s3 tiny-anexos URLs, imported earlier) as "external"
    // makes produto.alterar fail with an internal error (cod 35).
    const currentUrls = new Set(collectV2Images(current));
    const novas = prod.imagens.filter((u) => !currentUrls.has(u));
    imagensChanged = novas.length > 0;
    steps.imagens = imagensChanged ? 'ok' : 'sem alteração';
    // Tiny's structure is imagens_externas[].imagem_externa.url — each URL must be
    // wrapped in an `imagem_externa` object, or produto.alterar fails with cod 35.
    if (imagensChanged) produto.imagens_externas = novas.map((url) => ({ imagem_externa: { url } }));
  }

  const hasAnyChange = steps.descricao === 'ok' || steps.seo === 'ok' || steps.fiscal === 'ok' || steps.imagens === 'ok';
  if (!hasAnyChange) return steps;

  Object.keys(produto).forEach((k) => { if (produto[k] === undefined || produto[k] === null) delete produto[k]; });

  const payload = JSON.stringify({ produtos: [{ produto }] });
  console.log(`[tiny-v2] produto.alterar id=${id} payload=${payload.slice(0, 1500)}`);
  await tinyV2Call(uid, 'produto.alterar.php', { produto: payload });
  return steps;
}
```

- [ ] **Step 4: Update `tinyUpdateProduct` in `server/tinyProvider.ts`**

Replace lines 57-62:

```ts
export async function tinyUpdateProduct(uid: string, id: string, prod: TinyPushProduct, version?: TinyVersion): Promise<void> {
  const v = version ?? await getActiveVersion(uid);
  if (v === 'v2') { await updateV2Product(uid, id, prod); return; }
  const current = await tinyFetch<any>(uid, 'GET', `/produtos/${id}`);
  await tinyFetch(uid, 'PUT', `/produtos/${id}`, buildProductPutBody(current, prod));
}
```

with:

```ts
export async function tinyUpdateProduct(uid: string, id: string, prod: TinyPushProduct, version?: TinyVersion): Promise<TinyPushSteps> {
  const v = version ?? await getActiveVersion(uid);
  if (v === 'v2') return updateV2Product(uid, id, prod);
  const current = await tinyFetch<any>(uid, 'GET', `/produtos/${id}`);
  const { body, steps } = buildProductPutBody(current, prod);
  const hasAnyChange = steps.descricao === 'ok' || steps.seo === 'ok' || steps.fiscal === 'ok' || steps.imagens === 'ok';
  if (hasAnyChange) await tinyFetch(uid, 'PUT', `/produtos/${id}`, body);
  return steps;
}
```

Update the import at the top of the file (around line 6-9) to include `TinyPushSteps`:

```ts
import {
  tinyFetch, normalizeProduct, buildProductPutBody, SECRET_REF, STATUS_REF,
  type TinyNormalizedProduct, type TinyPushProduct, type TinyPushResult, type TinyPushSteps,
} from './tinyAgent';
```

- [ ] **Step 5: Update the push route in `server/tinyProvider.ts`**

Replace the `for (const prod of produtos)` loop body (lines 102-126) with:

```ts
      for (const prod of produtos) {
        if (!prod.tinyId) {
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: false, steps: {
            descricao: 'Sem ID Tiny', seo: 'Sem ID Tiny', fiscal: 'Sem ID Tiny', imagens: 'Sem ID Tiny',
          } });
          continue;
        }
        try {
          const steps = await tinyUpdateProduct(uid, prod.tinyId, prod, version);
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: true, steps });
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: false, steps: {
            descricao: msg, seo: msg, fiscal: msg, imagens: msg,
          } });
        }
      }
```

- [ ] **Step 6: Verify the server compiles**

Run: `npm run lint`
Expected: no TypeScript errors in `server/tinyAgent.ts`, `server/tinyV2.ts`, or `server/tinyProvider.ts`. (Client files will still fail at this point — that's Task 2. If any *server* file errors, fix before continuing.)

- [ ] **Step 7: Commit**

```bash
git add server/tinyAgent.ts server/tinyV2.ts server/tinyProvider.ts
git commit -m "fix(tiny): decide push fields by diffing against live Tiny data, not sticky flags"
```

---

### Task 2: Client — remove manual field-selection UI

**Files:**
- Modify: `src/services/tinyService.ts:40-56` (`TinyPushProduct`)
- Modify: `src/App.tsx:1660-1796` (Tiny push helpers block)
- Modify: `src/App.tsx:2986` (JSX wiring to `IntegrationsView`)
- Modify: `src/types/models.ts:157` (`_tinyPushed` field)
- Modify: `src/components/integrations/TinyConnector.tsx` (whole push section)
- Modify: `src/components/integrations/IntegrationsView.tsx` (Tiny prop types/wiring)

**Interfaces:**
- Consumes: `TinyPushProduct`, `TinyPushResult` from Task 1 (server shape, mirrored client-side).
- Produces: `buildTinyPushPayload(): Promise<TinyPushProduct[]>` (no `campos` argument) in `src/App.tsx`, passed to `IntegrationsView` as `getTinyPushPayload`.
- Produces: `TinyConnector` `Props` reduced to `{ onImported: () => void; getPushPayload: () => Promise<TinyPushProduct[]>; pushCandidateCount: number }`.

- [ ] **Step 1: Update the client `TinyPushProduct` type in `src/services/tinyService.ts`**

Replace lines 40-56:

```ts
export interface TinyPushProduct {
  tinyId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: { descricao: boolean; seo: boolean; fiscal: boolean; imagens: boolean };
}

export interface TinyPushResult {
  tinyId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
}
```

with:

```ts
export interface TinyPushProduct {
  tinyId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
}

// Per-group outcome: 'ok' (sent — differed from Tiny), 'sem alteração' (local data
// matches Tiny already), 'sem dado local' (nothing local to send), or an error message.
export interface TinyPushResult {
  tinyId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
}
```

- [ ] **Step 2: Remove the Tiny push field-selection helpers in `src/App.tsx`**

Replace the entire block from `// --- Tiny push: send only the field groups that changed since the last send ---` (line 1660) through the end of `handleTinyPushed` (line 1796) with:

```ts
  // --- Tiny push: send every locally-known value; the server decides what to
  // write by diffing against Tiny's live current data (server/tinyProvider.ts,
  // server/tinyV2.ts, server/tinyAgent.ts). No local "already sent" cache needed.

  const tinyToNum = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  };
  // Public image URLs to send as anexos: generated ambient images + imported
  // "URL imagem N" fields. Only http(s) URLs (Tiny downloads them).
  const collectTinyImages = (p: Product): string[] => {
    const urls: string[] = [...(p._ambientImages ?? [])];
    for (let i = 1; i <= 6; i++) {
      const u = (p as any)[`URL imagem ${i}`];
      if (typeof u === 'string' && u) urls.push(u);
    }
    return Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u))));
  };
  const tinySelectedProducts = (source: Product[]): Product[] => {
    const fromTiny = source.filter((p) => p._tinyProductId);
    return selectedIds.size > 0 ? fromTiny.filter((p) => selectedIds.has(p._id)) : fromTiny;
  };

  // Builds the push payload for every selected Tiny-linked product. No field
  // filtering here — the server compares each value against Tiny's live data and
  // only writes what actually differs.
  const buildTinyPushPayload = async (): Promise<TinyPushProduct[]> => {
    return tinySelectedProducts(productsRef.current).map((p) => ({
      tinyId: p._tinyProductId!,
      sku: p['Código (SKU)'],
      descricaoHtml: p['Descrição complementar'],
      seoTitle: p['Título SEO'],
      seoDescription: p['Descrição SEO'],
      seoKeywords: p['Palavras chave SEO'],
      ncm: p['NCM (Classificação fiscal)'],
      gtin: p['GTIN/EAN'],
      pesoLiquido: tinyToNum(p['Peso líquido (Kg)']),
      pesoBruto: tinyToNum(p['Peso bruto (Kg)']),
      largura: tinyToNum(p['Largura embalagem']),
      altura: tinyToNum(p['Altura Embalagem']),
      comprimento: tinyToNum(p['Comprimento embalagem']),
      imagens: collectTinyImages(p),
    }));
  };
```

- [ ] **Step 3: Update the `IntegrationsView` wiring in `src/App.tsx`**

Find the JSX call (around line 2986):

```tsx
            <IntegrationsView onImport={handleWakeImport} getPushPayload={buildWakePushPayload} onTinyImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getTinyPushPayload={buildTinyPushPayload} getTinyPushCandidates={getTinyPushCandidates} onTinyPushed={handleTinyPushed} onBlingImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getBlingPushPayload={buildBlingPushPayload} getBlingPushCandidates={getBlingPushCandidates} onBlingPushed={handleBlingPushed} />
```

Replace with (only the Tiny-related props change — `getTinyPushCandidates` and `onTinyPushed` are dropped, `tinyPushCandidateCount` is added; Bling props are untouched):

```tsx
            <IntegrationsView onImport={handleWakeImport} getPushPayload={buildWakePushPayload} onTinyImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getTinyPushPayload={buildTinyPushPayload} tinyPushCandidateCount={tinySelectedProducts(products).length} onBlingImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getBlingPushPayload={buildBlingPushPayload} getBlingPushCandidates={getBlingPushCandidates} onBlingPushed={handleBlingPushed} />
```

- [ ] **Step 4: Remove `_tinyPushed` from `src/types/models.ts`**

Delete this line (157):

```ts
  _tinyPushed?: { descricao?: string; seo?: string; fiscal?: string; imagens?: string };
```

- [ ] **Step 5: Rewrite the push section of `src/components/integrations/TinyConnector.tsx`**

Replace the exported types at the top (lines 9-15):

```ts
export type TinyPushFields = TinyPushProduct['campos'];
export type TinyPushCandidate = {
  id: string;
  sku: string;
  nome: string;
  changed: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
};
```

with: (delete these two type exports entirely — nothing replaces them)

Replace the `Props` interface (lines 17-26):

```ts
interface Props {
  // Called when a background import finishes, so the app can reload products.
  onImported: () => void;
  // Builds the push payload from the currently selected products and chosen fields.
  getPushPayload: (campos: TinyPushFields) => Promise<TinyPushProduct[]>;
  // Products that will be sent for a field selection (only the modified ones).
  getPushCandidates: (campos: TinyPushFields) => TinyPushCandidate[];
  // Called after a send so the app can record what was sent (avoid resending).
  onPushed: (results: TinyPushResult[]) => void;
}
```

with:

```ts
interface Props {
  // Called when a background import finishes, so the app can reload products.
  onImported: () => void;
  // Builds the push payload for every selected Tiny-linked product. The server
  // diffs each field against Tiny's live data and only writes what changed.
  getPushPayload: () => Promise<TinyPushProduct[]>;
  // How many Tiny-linked products are currently selected — powers the button's count.
  pushCandidateCount: number;
}
```

Delete the `FIELD_LABELS` and `CHANGED_TAGS` consts (lines 28-40).

Update the component signature (line 54):

```tsx
const TinyConnector: React.FC<Props> = ({ onImported, getPushPayload, getPushCandidates, onPushed }) => {
```

with:

```tsx
const TinyConnector: React.FC<Props> = ({ onImported, getPushPayload, pushCandidateCount }) => {
```

Remove the `campos` and `showCandidates` state (part of lines 72-76):

```ts
  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<TinyPushFields>({ descricao: true, seo: true, fiscal: true, imagens: true });
  const [pushResults, setPushResults] = useState<TinyPushResult[] | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
```

with:

```ts
  const [pushing, setPushing] = useState(false);
  const [pushResults, setPushResults] = useState<TinyPushResult[] | null>(null);
```

Replace `handlePush` (lines 237-255):

```ts
  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload(campos);
      if (!payload.length) {
        setError('Selecione produtos importados do Tiny (com ID Tiny) para enviar.');
        return;
      }
      const res = await tinyPush(payload);
      setPushResults(res.resultados);
      onPushed(res.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setPushing(false);
    }
  };
```

with:

```ts
  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload();
      if (!payload.length) {
        setError('Selecione produtos importados do Tiny (com ID Tiny) para enviar.');
        return;
      }
      const res = await tinyPush(payload);
      setPushResults(res.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setPushing(false);
    }
  };
```

Remove the `pushCandidates` computed line (part of lines 265-269):

```ts
  const active = JOB_ACTIVE(job?.status);
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.imported / job.total) * 100)) : 0;
  const autoSync = job?.autoSync ?? { enabled: false, everyHours: 24 };
  // Only modified products (for the chosen field groups) are sent — this is that set.
  const pushCandidates: TinyPushCandidate[] = connected ? getPushCandidates(campos) : [];
```

with:

```ts
  const active = JOB_ACTIVE(job?.status);
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.imported / job.total) * 100)) : 0;
  const autoSync = job?.autoSync ?? { enabled: false, everyHours: 24 };
```

Replace the whole "Push" block (lines 533-597, from `{/* Push */}` through the Push card's own closing `</div>` — NOT the outer wrapper `</div>` that follows on the next line) with:

```tsx
          {/* Push */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Enviar para Tiny</h4>
              <p className="text-xs text-slate-500">
                Compara cada produto selecionado com o que está salvo no Tiny agora e envia
                {' '}<strong>só os campos que realmente mudaram</strong> — nada é reenviado sem necessidade.
              </p>
            </div>
            <p className="text-xs text-slate-400 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Imagens são enviadas como anexos por URL (mescladas com as já existentes no produto).
              As URLs precisam ser públicas para o Tiny conseguir baixá-las.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePush}
                disabled={pushing || pushCandidateCount === 0}
                className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                Enviar selecionados para Tiny
              </button>
              <span className="text-sm text-slate-500">
                {pushCandidateCount} {pushCandidateCount === 1 ? 'produto será verificado' : 'produtos serão verificados'}
              </span>
            </div>

            {pushResults && (
              <div className="mt-2 border-t border-slate-100 pt-3 space-y-1.5 max-h-64 overflow-auto">
                {pushResults.map((r) => (
                  <div key={r.tinyId} className="flex items-start gap-2 text-xs">
                    {r.ok
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className="font-medium text-slate-700">{r.sku || r.tinyId}</span>
                    <span className="text-slate-500">
                      {(['descricao', 'seo', 'fiscal', 'imagens'] as const)
                        .filter((k) => r.steps[k] !== 'sem dado local')
                        .map((k) => `${k}: ${r.steps[k]}`)
                        .join(' · ') || 'nada a enviar'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
```

Delete the whole "Preview of the products that will be sent to Tiny" modal block (from `{/* Preview of the products that will be sent to Tiny */}` through its closing `)}`, right before the component's final closing `</div>` / `);`) — it depended on `showCandidates`/`pushCandidates`/`CHANGED_TAGS`, all removed.

- [ ] **Step 6: Update `src/components/integrations/IntegrationsView.tsx`**

Update the import (line 4):

```ts
import TinyConnector, { type TinyPushFields, type TinyPushCandidate } from './TinyConnector';
```

with:

```ts
import TinyConnector from './TinyConnector';
```

Update the `Props` interface (lines 14-16):

```ts
  getTinyPushPayload: (campos: TinyPushFields) => Promise<TinyPushProduct[]>;
  getTinyPushCandidates: (campos: TinyPushFields) => TinyPushCandidate[];
  onTinyPushed: (results: TinyPushResult[]) => void;
```

with:

```ts
  getTinyPushPayload: () => Promise<TinyPushProduct[]>;
  tinyPushCandidateCount: number;
```

Update the component's destructured props (line 23) — remove `getTinyPushCandidates` and `onTinyPushed`, add `tinyPushCandidateCount`:

```ts
const IntegrationsView: React.FC<Props> = ({ onImport, getPushPayload, onTinyImported, getTinyPushPayload, getTinyPushCandidates, onTinyPushed, onBlingImported, getBlingPushPayload, getBlingPushCandidates, onBlingPushed }) => {
```

with:

```ts
const IntegrationsView: React.FC<Props> = ({ onImport, getPushPayload, onTinyImported, getTinyPushPayload, tinyPushCandidateCount, onBlingImported, getBlingPushPayload, getBlingPushCandidates, onBlingPushed }) => {
```

Update the `<TinyConnector>` JSX call (line 64):

```tsx
          <TinyConnector onImported={onTinyImported} getPushPayload={getTinyPushPayload} getPushCandidates={getTinyPushCandidates} onPushed={onTinyPushed} />
```

with:

```tsx
          <TinyConnector onImported={onTinyImported} getPushPayload={getTinyPushPayload} pushCandidateCount={tinyPushCandidateCount} />
```

Check whether `TinyPushResult` is still used elsewhere in this file (e.g. only in the now-removed `onTinyPushed` prop type) — if the `import type { TinyPushProduct, TinyPushResult } from '../../services/tinyService';` line (line 6) has `TinyPushResult` now unused, drop it from the import:

```ts
import type { TinyPushProduct, TinyPushResult } from '../../services/tinyService';
```

with:

```ts
import type { TinyPushProduct } from '../../services/tinyService';
```

(Only make this last edit if `npm run lint` — Step 7 below — actually flags `TinyPushResult` as unused; TypeScript's `noUnusedLocals` setting in this project determines whether it's a hard error or just dead code. Check `tsc --noEmit` output before deciding.)

- [ ] **Step 7: Verify the client compiles**

Run: `npm run lint`
Expected: no TypeScript errors anywhere in `src/`. Fix any unused-import or type-mismatch errors surfaced (e.g. leftover references to `TinyPushFields`, `TinyPushCandidate`, `campos`, `getTinyPushCandidates`, `onTinyPushed`, `_tinyPushed`, `handleTinyPushed`, `getTinyPushCandidates`, `tinyGroup`, `tinyGenerated`, `changedTinyGroups`, `djb2` — grep for each name across `src/` if lint doesn't catch it, since some may only be unused-but-still-valid-JS).

- [ ] **Step 8: Commit**

```bash
git add src/services/tinyService.ts src/App.tsx src/types/models.ts src/components/integrations/TinyConnector.tsx src/components/integrations/IntegrationsView.tsx
git commit -m "feat(tiny): remove manual field checkboxes, push is now fully auto-diffed"
```

---

### Task 3: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on port 3000 without errors.

- [ ] **Step 2: Visual check — push panel has no checkboxes**

In the browser, go to Integrations → ERP Tiny (must be connected via v2 token to a real or sandbox Tiny account with at least one product that has NCM/peso/dimensões and a "Descrição complementar" already enriched by omni360). Confirm the "Enviar para Tiny" card no longer shows the four field checkboxes, and shows "N produtos serão verificados" instead of a clickable candidate-count button.

- [ ] **Step 3: No-op push does not touch Tiny**

Select a product that was already pushed successfully before (or one whose local fiscal/descrição fields exactly match what's in the Tiny panel) and click "Enviar selecionados para Tiny". Confirm the result line shows `sem alteração` (or `sem dado local`) for every group, `ok: true` overall, and that reloading the product in the Tiny web panel shows its dimensions/description **unchanged**.

- [ ] **Step 4: Real change is still pushed**

Edit one field locally that actually differs from Tiny (e.g. change "Peso líquido (Kg)" in the product edit modal to a new value) and push again. Confirm the result line shows `fiscal: ok` (only), and the Tiny panel now reflects the new weight — while NCM/GTIN/dimensions/description that didn't change remain exactly as they were in Tiny.

- [ ] **Step 5: Report results back to the user**

Summarize what was verified (or any issues hit) — no code changes in this task, just confirmation the fix behaves as intended for the reported bug (dimensions/description silently overwritten on Tiny even without new enrichment).
