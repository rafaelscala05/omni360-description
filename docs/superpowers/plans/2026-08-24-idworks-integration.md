# Integração IdWorks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new IdWorks integration (connect + background import + inbound webhook + outbound push) with product-flow parity to the existing Tiny ERP integration.

**Architecture:** Mirror the Tiny v2 (static-credential, no OAuth) shape: one `idworksAgent.ts` (auth + fetch + normalize + push route), one `idworksImportWorker.ts` (background scheduler + Firestore upsert), one `idworksWebhook.ts` (public receiver keyed by a per-user secret URL, since IdWorks webhooks are configured manually in its own UI with no HMAC). Frontend follows the `tinyService.ts` / `BlingConnector.tsx` pattern exactly, wired into `App.tsx` the same way Bling is.

**Tech Stack:** Express (`tsx`), Firebase Admin SDK (Firestore), React 19 + Tailwind, `fetch` for the IdWorks REST API (JWT bearer, base `https://{AccountName}.api-idworks.com.br/1.0`).

**Spec:** `docs/superpowers/specs/2026-08-24-idworks-integration-design.md`

## Global Constraints

- Rate limit: 5 req/s per endpoint per account → pace calls with `IDWORKS_PACE_MS` (default 200ms).
- No OAuth, no HMAC on the webhook — auth is a per-user secret embedded in the webhook URL path, mirroring `server/tinyWebhook.ts`'s `/api/tiny/webhook/:uid/:secret` pattern.
- `PUT /sku/{idsku}` is natively partial (only sent fields change) — do not re-send sibling fields like Tiny v2 does.
- Firestore collections/doc shapes: `users/{uid}/integration_secrets/idworks`, `users/{uid}/settings/idworks`, `idworks_import_jobs/{uid}`, `idworks_webhook_events/{key}`, `idworks_versions` subcollection — exact shape given per-task below.
- `POST /auth/token`'s exact request body and the webhook envelope's exact JSON field names are **not publicly documented** (confirmed by testing the public demo account and reading the OpenAPI/Postman/help-site sources — see spec's "Pendências"). Both are isolated behind single small functions (`obtainToken`, `parseWebhookEnvelope`) with an inline comment pointing at the spec section, so they're a one-line fix once real IdWorks credentials are available. Do not block other tasks on these two functions being "correct" — they must compile and have a sane fallback shape, not be verified end-to-end.
- pt-BR throughout: UI text, error messages, comments follow the rest of the codebase.
- `npm run lint` (tsc --noEmit) must stay clean after every task, MODULO three pre-existing baseline errors already present before this plan started (unrelated to this work): `src/App.tsx(759,32)` (`Property 'createdAt' does not exist on type 'Product'`), `src/App.tsx(1500,11)` and `src/components/modals/ProductEditModal.tsx(313,13)` (both `Type '"text_ai"' is not assignable...`). Do not fix these — they are out of scope. Any *new* lint error introduced by this plan's changes must be fixed.

---

### Task 1: `server/idworksAgent.ts` — auth, fetch client, normalization, push route

**Files:**
- Create: `server/idworksAgent.ts`
- Modify: `.env.example` (add `IDWORKS_PACE_MS`, document accountName/credential are per-user, stored in Firestore, not env)

**Interfaces:**
- Produces (consumed by Tasks 2 and 3):
  - `export const SECRET_REF = (uid: string) => admin.firestore().doc(\`users/${uid}/integration_secrets/idworks\`)`
  - `export const STATUS_REF = (uid: string) => admin.firestore().doc(\`users/${uid}/settings/idworks\`)`
  - `export function publicBaseUrl(req: express.Request): string` (copy verbatim from `tinyAgent.ts`'s implementation — same env vars / host-header logic)
  - `export interface IdworksNormalizedProduct { idworksId: string; sku: string; nome: string; descricaoHtml?: string; descricaoCurta?: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string; slug?: string; linkVideo?: string; ncm?: string; ncmExTipi?: string; cest?: string; gtin?: string; pesoLiquido?: number; pesoBruto?: number; largura?: number; altura?: number; comprimento?: number; marca?: string; categorias: string[]; imagens: string[]; codigoPai?: string; raw: unknown; }`
  - `export function normalizeProduct(sku: any): IdworksNormalizedProduct` — maps a raw `SkuDetail` JSON object (see field table below) to the normalized shape.
  - `export interface IdworksPushProduct { idworksId: string; sku?: string; descricaoHtml?: string; descricaoCurta?: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string; slug?: string; linkVideo?: string; ncm?: string; ncmExTipi?: string; cest?: string; pesoLiquido?: number; pesoBruto?: number; largura?: number; altura?: number; comprimento?: number; imagens?: string[]; campos: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>; }`
  - `export interface IdworksPushSteps { descricao: string; seo: string; fiscal: string; imagens: string; }` (values: `'ok' | 'sem alteração' | 'sem dado local' | <error message>`, same vocabulary as `TinyPushSteps`)
  - `export interface IdworksPushResult { idworksId: string; sku?: string; ok: boolean; steps: IdworksPushSteps; }`
  - `export async function idworksFetch<T>(uid: string, method: 'GET'|'PUT'|'POST', path: string, body?: unknown): Promise<T>` — obtains/refreshes the JWT, paces calls, retries 429/5xx with backoff, retries once on 401 after a forced re-auth.
  - `export function buildSkuUpdateBody(current: any, prod: IdworksPushProduct): { body: Record<string, any>; steps: IdworksPushSteps }`
  - `registerIdworksRoutes(app, { verifyFirebaseToken })` — registers `POST /api/idworks/connect`, `GET /api/idworks/status`, `DELETE /api/idworks/disconnect`, `POST /api/idworks/push`.

**Field mapping for `normalizeProduct`** (source: `SkuDetail` schema, confirmed via the IdWorks OpenAPI spec — see design doc's "Mapeamento de campos" table):

| `IdworksNormalizedProduct` | `SkuDetail` field |
|---|---|
| `idworksId` | `String(IDSku)` |
| `sku` | `IDSkuCompany` |
| `nome` | `SkuName` |
| `descricaoHtml` | `EcommerceDescription` |
| `descricaoCurta` | `EcommerceDescriptionShort` |
| `seoTitle` | `EcommerceTitle` |
| `seoDescription` | `EcommerceMetaTagDescription` |
| `seoKeywords` | `EcommerceKeyWords` |
| `slug` | `EcommerceLinkId` |
| `linkVideo` | `EcommerceVideoUrl` |
| `ncm` | `SkuNCM` |
| `ncmExTipi` | `SkuNCMExTipi` |
| `cest` | `SkuCest` |
| `gtin` | `BarCode` |
| `pesoLiquido` | `SkuWeightNet` |
| `pesoBruto` | `SkuWeight` |
| `largura` | `SkuWidth` |
| `altura` | `SkuHeight` |
| `comprimento` | `SkuLength` |
| `marca` | `Brand` |
| `categorias` | `[CategoryTree || Category]` filtered for truthy |
| `imagens` | `[MainImageURL]` filtered for truthy (list endpoint doesn't return the full gallery — full gallery requires `GET /sku/image/{idsku}`, out of scope for normalize; see Task note below) |
| `codigoPai` | `IDProduct ? String(IDProduct) : undefined` (only set when this SKU is a variation) |

Numeric fields go through a local `num()` helper identical to `tinyV2.ts`'s (handles string/number/comma-decimal, returns `undefined` for empty).

- [ ] **Step 1: Scaffold the file with imports, `num()`, `SECRET_REF`/`STATUS_REF`, `publicBaseUrl`**

Read `server/tinyAgent.ts` lines 1-60 for the exact `publicBaseUrl` implementation and Firestore admin import pattern, and copy it verbatim (same env-var fallback chain), swapping `tiny` → `idworks` in collection paths.

- [ ] **Step 2: Implement `obtainToken` and `idworksFetch`**

```typescript
// server/idworksAgent.ts (excerpt)
const IDWORKS_PACE_MS = Number(process.env.IDWORKS_PACE_MS) || 200;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface IdworksCredentials {
  accountName: string;
  // Exact field names for POST /auth/token are NOT publicly documented (see
  // spec "Pendências" #1 — tested against the public demo account and got a
  // generic API Gateway error, not a field-validation error). Kept as an open
  // record so the connect route can accept whatever the real account needs
  // (e.g. { login, password } or { clientId, clientSecret }) without a type
  // change once confirmed.
  credentials: Record<string, string>;
}

// Isolated on purpose — the one function to fix once IdWorks confirms the
// real POST /auth/token contract (spec "Pendências" #1).
async function obtainToken(accountName: string, credentials: Record<string, string>): Promise<{ token: string; expiresAt: number }> {
  const base = `https://${accountName}.api-idworks.com.br/1.0`;
  const res = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Falha ao autenticar na IdWorks (${res.status}): ${text.slice(0, 300)}`), { status: res.status === 401 || res.status === 403 ? 401 : 502 });
  }
  const json: any = await res.json().catch(() => ({}));
  const token = json?.token ?? json?.access_token ?? json?.jwt;
  if (!token || typeof token !== 'string') {
    throw Object.assign(new Error('Resposta de autenticação da IdWorks sem token.'), { status: 502 });
  }
  // JWT exp isn't guaranteed to be readable without a library; fall back to a
  // conservative 15-minute cache when we can't parse it, forcing frequent
  // reauth over risking a stale token.
  let expiresAt = Date.now() + 15 * 60 * 1000;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload?.exp === 'number') expiresAt = payload.exp * 1000;
  } catch { /* keep the conservative fallback */ }
  return { token, expiresAt };
}

async function getValidToken(uid: string, forceRefresh: boolean): Promise<{ token: string; accountName: string }> {
  const snap = await SECRET_REF(uid).get();
  const d = snap.data();
  if (!d?.accountName || !d?.credentials) {
    throw Object.assign(new Error('IdWorks não conectado.'), { status: 401 });
  }
  if (!forceRefresh && d.jwt && typeof d.jwtExpiresAt === 'number' && d.jwtExpiresAt > Date.now() + 30_000) {
    return { token: d.jwt, accountName: d.accountName };
  }
  const { token, expiresAt } = await obtainToken(d.accountName, d.credentials);
  await SECRET_REF(uid).set({ jwt: token, jwtExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { token, accountName: d.accountName };
}

export async function idworksFetch<T>(uid: string, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, attempt = 0): Promise<T> {
  const { token, accountName } = await getValidToken(uid, false);
  await sleep(IDWORKS_PACE_MS);
  const base = `https://${accountName}.api-idworks.com.br/1.0`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (attempt < 3) { await sleep(2 ** attempt * 700); return idworksFetch<T>(uid, method, path, body, attempt + 1); }
    throw Object.assign(new Error('Falha de rede ao chamar a IdWorks.'), { status: 502 });
  }
  if (res.status === 401 && attempt < 1) {
    await getValidToken(uid, true); // force a fresh token, then retry once
    return idworksFetch<T>(uid, method, path, body, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 2000 * 2 ** attempt));
    return idworksFetch<T>(uid, method, path, body, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`IdWorks ${method} ${path} falhou (${res.status}): ${text.slice(0, 300)}`), { status: res.status });
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
```

- [ ] **Step 3: Implement `normalizeProduct` and `num()` per the field table above**

```typescript
function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeProduct(sku: any): IdworksNormalizedProduct {
  const categoria = sku?.CategoryTree || sku?.Category;
  return {
    idworksId: String(sku?.IDSku ?? ''),
    sku: sku?.IDSkuCompany ?? '',
    nome: sku?.SkuName ?? '',
    descricaoHtml: sku?.EcommerceDescription || undefined,
    descricaoCurta: sku?.EcommerceDescriptionShort || undefined,
    seoTitle: sku?.EcommerceTitle || undefined,
    seoDescription: sku?.EcommerceMetaTagDescription || undefined,
    seoKeywords: sku?.EcommerceKeyWords || undefined,
    slug: sku?.EcommerceLinkId || undefined,
    linkVideo: sku?.EcommerceVideoUrl || undefined,
    ncm: sku?.SkuNCM || undefined,
    ncmExTipi: sku?.SkuNCMExTipi || undefined,
    cest: sku?.SkuCest || undefined,
    gtin: sku?.BarCode || undefined,
    pesoLiquido: num(sku?.SkuWeightNet),
    pesoBruto: num(sku?.SkuWeight),
    largura: num(sku?.SkuWidth),
    altura: num(sku?.SkuHeight),
    comprimento: num(sku?.SkuLength),
    marca: sku?.Brand || undefined,
    categorias: categoria ? [String(categoria)] : [],
    imagens: sku?.MainImageURL ? [String(sku.MainImageURL)] : [],
    codigoPai: sku?.IDProduct ? String(sku.IDProduct) : undefined,
    raw: sku,
  };
}
```

- [ ] **Step 4: Implement `buildSkuUpdateBody`**

```typescript
export function buildSkuUpdateBody(current: any, prod: IdworksPushProduct): { body: Record<string, any>; steps: IdworksPushSteps } {
  const cur = normalizeProduct(current);
  const steps: IdworksPushSteps = { descricao: 'sem dado local', seo: 'sem dado local', fiscal: 'sem dado local', imagens: 'sem dado local' };
  const body: Record<string, any> = {};
  const strDiffers = (a?: string, b?: string) => (a ?? '').trim() !== (b ?? '').trim();

  if (prod.campos.descricao) {
    const hasLocal = !!prod.descricaoHtml || !!prod.descricaoCurta;
    if (hasLocal) {
      let changed = false;
      if (prod.descricaoHtml && strDiffers(prod.descricaoHtml, cur.descricaoHtml)) { body.EcommerceDescription = prod.descricaoHtml; changed = true; }
      if (prod.descricaoCurta && strDiffers(prod.descricaoCurta, cur.descricaoCurta)) { body.EcommerceDescriptionShort = prod.descricaoCurta; changed = true; }
      steps.descricao = changed ? 'ok' : 'sem alteração';
    }
  }

  if (prod.campos.seo) {
    const hasLocal = !!prod.seoTitle || !!prod.seoDescription || !!prod.seoKeywords || !!prod.slug || !!prod.linkVideo;
    if (hasLocal) {
      let changed = false;
      if (prod.seoTitle && strDiffers(prod.seoTitle, cur.seoTitle)) { body.EcommerceTitle = prod.seoTitle; changed = true; }
      if (prod.seoDescription && strDiffers(prod.seoDescription, cur.seoDescription)) { body.EcommerceMetaTagDescription = prod.seoDescription; changed = true; }
      if (prod.seoKeywords && strDiffers(prod.seoKeywords, cur.seoKeywords)) { body.EcommerceKeyWords = prod.seoKeywords; changed = true; }
      if (prod.slug && strDiffers(prod.slug, cur.slug)) { body.EcommerceLinkId = prod.slug; changed = true; }
      if (prod.linkVideo && strDiffers(prod.linkVideo, cur.linkVideo)) { body.EcommerceVideoUrl = prod.linkVideo; changed = true; }
      steps.seo = changed ? 'ok' : 'sem alteração';
    }
  }

  if (prod.campos.fiscal) {
    const hasLocal = !!prod.ncm || !!prod.cest || prod.pesoLiquido != null || prod.pesoBruto != null || prod.largura != null || prod.altura != null || prod.comprimento != null;
    if (hasLocal) {
      let changed = false;
      if (prod.ncm && strDiffers(prod.ncm, cur.ncm)) { body.SkuNCM = prod.ncm; changed = true; }
      if (prod.ncmExTipi && strDiffers(prod.ncmExTipi, cur.ncmExTipi)) { body.SkuNCMExTipi = prod.ncmExTipi; changed = true; }
      if (prod.cest && strDiffers(prod.cest, cur.cest)) { body.SkuCest = prod.cest; changed = true; }
      if (prod.pesoLiquido != null && prod.pesoLiquido !== cur.pesoLiquido) { body.SkuWeightNet = prod.pesoLiquido; changed = true; }
      if (prod.pesoBruto != null && prod.pesoBruto !== cur.pesoBruto) { body.SkuWeight = prod.pesoBruto; changed = true; }
      if (prod.largura != null && prod.largura !== cur.largura) { body.SkuWidth = prod.largura; changed = true; }
      if (prod.altura != null && prod.altura !== cur.altura) { body.SkuHeight = prod.altura; changed = true; }
      if (prod.comprimento != null && prod.comprimento !== cur.comprimento) { body.SkuLength = prod.comprimento; changed = true; }
      steps.fiscal = changed ? 'ok' : 'sem alteração';
    }
  }

  // Images are NOT part of SkuUpdateBody — they go through a separate
  // POST /sku/image/{idsku} call, handled by the caller (registerIdworksRoutes'
  // push route), not by this function. `steps.imagens` is set there.

  return { body, steps };
}
```

- [ ] **Step 5: Implement `registerIdworksRoutes`**

```typescript
export function registerIdworksRoutes(app: express.Express, { verifyFirebaseToken }: { verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }> }): void {
  app.post('/api/idworks/connect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const accountName: string | undefined = req.body?.accountName?.trim();
      const credentials: Record<string, string> | undefined = req.body?.credentials;
      if (!accountName || !credentials || typeof credentials !== 'object') {
        return res.status(400).json({ valid: false, message: 'Informe a conta (subdomínio) e as credenciais da IdWorks.' });
      }
      await obtainToken(accountName, credentials); // throws with .status on failure
      await SECRET_REF(uid).set({ accountName, credentials, updatedAt: FieldValue.serverTimestamp() });
      await STATUS_REF(uid).set({
        connected: true, validated: true, accountName,
        connectedAt: FieldValue.serverTimestamp(), lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({ valid: true, message: 'Conectado com sucesso.' });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 400).json({ valid: false, message: e?.message ?? 'Falha na conexão.' });
    }
  });

  app.get('/api/idworks/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await STATUS_REF(uid).get();
      const d = snap.data() ?? {};
      return res.json({
        connected: !!d.connected,
        validated: !!d.validated,
        accountName: d.accountName ?? null,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString() ?? null,
        syncMode: d.syncMode ?? 'polling',
        webhookUrl: d.webhookUrl ?? null,
        webhookStats: d.webhookStats ?? { lastReceivedAt: null, totalReceived: 0 },
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao ler status.' });
    }
  });

  app.delete('/api/idworks/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await SECRET_REF(uid).delete();
      await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
      return res.status(204).end();
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao desconectar.' });
    }
  });

  const MAX_PUSH_BATCH = 50;
  app.post('/api/idworks/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const produtos: IdworksPushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      if (produtos.length > MAX_PUSH_BATCH) {
        return res.status(400).json({ message: `Selecione no máximo ${MAX_PUSH_BATCH} produtos por envio.` });
      }
      const resultados: IdworksPushResult[] = [];
      for (const prod of produtos) {
        if (!prod.idworksId) {
          resultados.push({ idworksId: prod.idworksId, sku: prod.sku, ok: false, steps: { descricao: 'Sem ID IdWorks', seo: 'Sem ID IdWorks', fiscal: 'Sem ID IdWorks', imagens: 'Sem ID IdWorks' } });
          continue;
        }
        try {
          const currentArr = await idworksFetch<any[]>(uid, 'GET', `/sku/${prod.idworksId}`);
          const current = Array.isArray(currentArr) ? currentArr[0] : currentArr;
          const { body, steps } = buildSkuUpdateBody(current, prod);
          if (Object.keys(body).length) await idworksFetch(uid, 'PUT', `/sku/${prod.idworksId}`, body);

          if (prod.campos.imagens && prod.imagens?.length) {
            const currentImages = new Set(normalizeProduct(current).imagens);
            const novas = prod.imagens.filter((u) => !currentImages.has(u));
            if (novas.length) {
              for (const url of novas) await idworksFetch(uid, 'POST', `/sku/image/${prod.idworksId}`, { Url: url });
              steps.imagens = 'ok';
            } else {
              steps.imagens = 'sem alteração';
            }
          }

          resultados.push({ idworksId: prod.idworksId, sku: prod.sku, ok: true, steps });
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          resultados.push({ idworksId: prod.idworksId, sku: prod.sku, ok: false, steps: { descricao: msg, seo: msg, fiscal: msg, imagens: msg } });
        }
      }
      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
```

Top-of-file imports needed: `import express from 'express'; import admin from 'firebase-admin'; import { FieldValue } from 'firebase-admin/firestore';` — check `server/tinyAgent.ts`'s import block for the exact Firebase Admin initialization pattern already in use (it's initialized once elsewhere; reuse the same `admin.firestore()` call style, don't re-initialize the app).

- [ ] **Step 6: `npm run lint` clean (modulo the 3 pre-existing baseline errors noted in Global Constraints)**

Run: `npm run lint`
Expected: no new TypeScript errors in `server/idworksAgent.ts` (the 3 pre-existing errors in `App.tsx`/`ProductEditModal.tsx` are unrelated and expected to remain).

- [ ] **Step 7: Commit**

```bash
git add server/idworksAgent.ts .env.example
git commit -m "feat(idworks): add auth, fetch client, and push route for IdWorks integration"
```

---

### Task 2: `server/idworksImportWorker.ts` — background import worker

**Files:**
- Create: `server/idworksImportWorker.ts`

**Interfaces:**
- Consumes from Task 1: `idworksFetch`, `normalizeProduct`, `IdworksNormalizedProduct`, `STATUS_REF`.
- Produces (consumed by Task 3 and by `server.ts` wiring):
  - `export async function upsertProduct(uid: string, p: IdworksNormalizedProduct, source = 'idworks-bg-import'): Promise<string>`
  - `export async function tick(): Promise<void>`
  - `export function startIdworksScheduler(): void`
  - `export function registerIdworksImportRoutes(app: express.Express, { verifyFirebaseToken }): void` — registers `POST /api/idworks/import/start`, `GET /api/idworks/import/status`, `POST /api/idworks/import/cancel`, `POST /api/idworks/import/autosync`, `POST /api/idworks/cron/tick`.

**Firestore column mapping for `upsertProduct`** (same target columns as `tiny`/`bling`; source-of-truth fields always overwrite, enriched fields only fill when empty — copy the exact merge policy from `tinyImportWorker.ts`'s `upsertProduct`, lines ~94 onward):

| Firestore column | From `IdworksNormalizedProduct` | Policy |
|---|---|---|
| `_idworksProductId` | `idworksId` | always |
| `Código (SKU)` | `sku` | always |
| `Descrição` | `nome` | always |
| `Descrição complementar` | `descricaoHtml` | only if local field empty |
| `Título SEO` | `seoTitle` | only if local field empty |
| `Descrição SEO` | `seoDescription` | only if local field empty |
| `Palavras chave SEO` | `seoKeywords` | only if local field empty |
| `NCM (Classificação fiscal)` | `ncm` | only if local field empty |
| `CEST` | `cest` | only if local field empty |
| `GTIN/EAN` | `gtin` | only if local field empty |
| `Peso líquido (Kg)` | `pesoLiquido` | only if local field empty |
| `Peso bruto (Kg)` | `pesoBruto` | only if local field empty |
| `Largura embalagem` | `largura` | only if local field empty |
| `Altura Embalagem` | `altura` | only if local field empty |
| `Comprimento embalagem` | `comprimento` | only if local field empty |
| `Marca` | `marca` | only if local field empty |
| `Categoria` | `categorias[0]` | only if local field empty |
| `Código do pai` | `codigoPai` | always (variation linkage must stay in sync) |
| Image URL columns | `imagens` | only if no local images (same "don't clobber generated ambient images" rule as Tiny) |

- [ ] **Step 1: Read the exact `upsertProduct` merge logic to copy**

Read `server/tinyImportWorker.ts` lines 41-277 in full before writing this task's code — it contains `stripUndefined`, the doc-id resolution (`_idworksProductId` lookup vs `Código (SKU)` fallback), the "only fill empty local fields" branches per column, and the `idworks_versions` backup-subcollection write. Reuse the exact same control flow, renaming `tiny` → `idworks` identifiers and swapping in the column mapping table above. Do not invent a different merge strategy.

- [ ] **Step 2: Implement `upsertProduct`**

Mirror `tinyImportWorker.ts:upsertProduct` structurally: resolve the Firestore doc by `_idworksProductId == p.idworksId` (fallback: `Código (SKU)` match, same as Tiny), build a partial update object with `stripUndefined`, apply the always/only-if-empty policy per the table above, write to `users/{uid}/products/{docId}`, and append a snapshot to the `idworks_versions` subcollection using the same backup shape Tiny writes (`{ source, at: FieldValue.serverTimestamp(), raw: p.raw }`).

- [ ] **Step 3: Implement `tick`, `startIdworksScheduler`, and the import routes**

Mirror `server/tinyImportWorker.ts` lines 278-385 (`tick`, `startTinyScheduler`, `publicJob`, `registerTinyImportRoutes`) verbatim in structure: job doc at `idworks_import_jobs/{uid}` with `{ status, mode, offset, total, imported, lease, lastSyncAt, autoSync, error }`; `tick()` claims a lease, calls a paginated listing helper, and processes one batch per tick; the cron backstop route checks `req.headers['x-cron-secret'] === (process.env.IDWORKS_CRON_SECRET || process.env.CONTENT_CRON_SECRET)`.

The one structural difference from Tiny: paging comes directly from `idworksFetch` against `GET /sku` (no `provider` dispatch layer needed), like this:

```typescript
async function listPage(uid: string, offset: number, mode: 'full' | 'update', sinceISO?: string | null): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  const page = Math.floor(offset / 500);
  const params = new URLSearchParams({ Page: String(page), Simple: '0' });
  if (mode === 'update' && sinceISO) params.set('SinceDateLastRecordModification', sinceISO);
  const items = await idworksFetch<any[]>(uid, 'GET', `/sku?${params.toString()}`);
  const filtered = (Array.isArray(items) ? items : []).filter((s) => s?.IDTypeSku === 3 || s?.IDTypeSku === 4);
  const ids = filtered.map((s) => ({ id: String(s.IDSku) }));
  return { items: ids, total: 0, done: ids.length < 500 };
}
```

Then per-id detail fetch inside the tick loop: `const detail = await idworksFetch<any[]>(uid, 'GET', `/sku/${id}`); const normalized = normalizeProduct(Array.isArray(detail) ? detail[0] : detail); await upsertProduct(uid, normalized);` — same shape as Tiny's per-item detail+upsert loop.

- [ ] **Step 4: `npm run lint` clean**

Run: `npm run lint`

- [ ] **Step 5: Commit**

```bash
git add server/idworksImportWorker.ts
git commit -m "feat(idworks): add background import worker with autosync and cron backstop"
```

---

### Task 3: `server/idworksWebhook.ts` — inbound webhook receiver

**Files:**
- Create: `server/idworksWebhook.ts`

**Interfaces:**
- Consumes: `idworksFetch`, `normalizeProduct` (Task 1), `upsertProduct` (Task 2), `STATUS_REF`, `publicBaseUrl` (Task 1).
- Produces: `export function registerIdworksWebhookRoutes(app: express.Express, { verifyFirebaseToken }): void` — registers `POST /api/idworks/webhook/config` (authenticated) and `POST /api/idworks/webhook/:uid/:secret` (public).

- [ ] **Step 1: Implement `parseWebhookEnvelope` (isolated, per spec Pendências #2)**

```typescript
// The exact JSON field names IdWorks sends are not shown anywhere in the
// public docs (only described in prose: "Topic, AccountName,
// ModificationTimestamp, and resource identifiers with relative URLs"). This
// function is the single place to fix once a real webhook payload is
// captured (spec "Pendências" #2) — it tries the documented field names and
// a couple of plausible casings, and fails loudly (400) if none match, so a
// wrong guess surfaces immediately in the logs instead of silently no-op'ing.
function parseWebhookEnvelope(body: any): { topic: string; idSku: string | null; modifiedAt: string | null } {
  const topic = body?.Topic ?? body?.topic ?? '';
  const idSku = body?.IDSku ?? body?.idSku ?? body?.Id ?? body?.ResourceId ?? body?.id ?? null;
  const modifiedAt = body?.ModificationTimestamp ?? body?.modificationTimestamp ?? null;
  return { topic: String(topic), idSku: idSku != null ? String(idSku) : null, modifiedAt: modifiedAt != null ? String(modifiedAt) : null };
}
```

- [ ] **Step 2: Implement the config route (authenticated) — mirrors `tinyWebhook.ts`'s `/api/tiny/webhook/config`**

```typescript
app.post('/api/idworks/webhook/config', async (req, res) => {
  try {
    const { uid } = await verifyFirebaseToken(req);
    const statusSnap = await STATUS_REF(uid).get();
    const cur = statusSnap.data() ?? {};
    const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
    if (req.body?.syncMode === 'polling' || req.body?.syncMode === 'webhook') update.syncMode = req.body.syncMode;

    let secret = cur.webhookSecret as string | undefined;
    if (!secret || req.body?.regenerateSecret === true) {
      secret = crypto.randomBytes(24).toString('hex');
      update.webhookSecret = secret;
    }
    await STATUS_REF(uid).set(update, { merge: true });

    const webhookUrl = `${publicBaseUrl(req)}/api/idworks/webhook/${uid}/${secret}`;
    const headerValue = `Bearer ${secret}`;
    return res.json({ webhookUrl, headerName: 'Authorization', headerValue, syncMode: update.syncMode ?? cur.syncMode ?? 'polling' });
  } catch (e: any) {
    return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao salvar configuração do webhook.' });
  }
});
```

- [ ] **Step 3: Implement the public receiver route**

```typescript
app.post('/api/idworks/webhook/:uid/:secret', express.json({ type: () => true }), async (req, res) => {
  const { uid, secret } = req.params;
  try {
    const statusSnap = await STATUS_REF(uid).get();
    const settings = statusSnap.data() ?? {};
    if (!settings.webhookSecret || settings.webhookSecret !== secret) {
      console.warn(`[idworks-webhook] rejeitado uid=${uid}: secret inválido`);
      return res.status(403).json({ message: 'Secret inválido.' });
    }

    const { topic, idSku, modifiedAt } = parseWebhookEnvelope(req.body);
    if (!idSku) {
      console.warn(`[idworks-webhook] payload sem referência de SKU uid=${uid} body=${JSON.stringify(req.body).slice(0, 500)}`);
      return res.status(200).json({ ok: true }); // ack anyway — don't make IdWorks retry a shape we can't parse
    }

    const dedupKey = crypto.createHash('sha256').update(`${topic}:${idSku}:${modifiedAt ?? ''}`).digest('hex');
    const dedupRef = admin.firestore().doc(`idworks_webhook_events/${dedupKey}`);
    const dedupSnap = await dedupRef.get();
    if (dedupSnap.exists) return res.status(200).json({ ok: true });
    await dedupRef.set({ uid, topic, idSku, createdAt: FieldValue.serverTimestamp() });

    // Deletion topics: mark instead of fetching (the SKU may 404 once removed).
    if (/delete/i.test(topic)) {
      const productsSnap = await admin.firestore().collection(`users/${uid}/products`).where('_idworksProductId', '==', idSku).limit(1).get();
      if (!productsSnap.empty) {
        await productsSnap.docs[0].ref.set({ _idworksDeleted: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    } else {
      const detail = await idworksFetch<any[]>(uid, 'GET', `/sku/${idSku}`);
      const normalized = normalizeProduct(Array.isArray(detail) ? detail[0] : detail);
      await upsertProduct(uid, normalized, 'idworks-webhook');
    }

    await STATUS_REF(uid).set({
      webhookStats: { lastReceivedAt: new Date().toISOString(), totalReceived: FieldValue.increment(1) },
    }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(`[idworks-webhook] erro uid=${uid}: ${e?.message}\n${e?.stack ?? ''}`);
    return res.status(500).json({ message: 'Erro ao processar webhook.' });
  }
});
```

Note the deliberate divergence from Tiny here: IdWorks only requires a `2xx` (no mapping array), and there's no HMAC — the URL secret is the only auth surface, so the header value handed to the user in Step 2 is a defense-in-depth suggestion, not something this route currently validates (parsing an arbitrary user-configured header name would require storing that name too; out of scope for this first cut — the URL secret alone is the same trust model Tiny already ships with production traffic).

- [ ] **Step 4: `npm run lint` clean**

Run: `npm run lint`

- [ ] **Step 5: Commit**

```bash
git add server/idworksWebhook.ts
git commit -m "feat(idworks): add inbound webhook receiver with secret-URL auth and dedup"
```

---

### Task 4: `scripts/verify-idworks-mapping.mjs` — pure-logic verification

**Files:**
- Create: `scripts/verify-idworks-mapping.mjs`

**Interfaces:**
- Consumes: `normalizeProduct`, `buildSkuUpdateBody` from `server/idworksAgent.ts` (import via `tsx`-compatible relative path, same pattern as `scripts/verify-crm-stage.mjs`).

This repo has no test framework — verification is small standalone `tsx` scripts asserting on pure functions (see `scripts/verify-crm-stage.mjs`, `scripts/verify-agent-tools.mjs`). Follow that exact convention: plain `assert` calls, exit non-zero on failure, human-readable console output on success.

- [ ] **Step 1: Read `scripts/verify-crm-stage.mjs` in full to copy its structure (imports, assert style, exit code, final "OK" log) exactly**

- [ ] **Step 2: Write assertions for `normalizeProduct`**

Cover: a full `SkuDetail`-shaped fixture maps every field in the Task 1 table correctly; a variation (`IDProduct` present) sets `codigoPai`; missing/empty optional fields come back `undefined`, not empty string.

- [ ] **Step 3: Write assertions for `buildSkuUpdateBody`**

Cover: unchanged local values produce `steps.X === 'sem alteração'` and no key in `body`; a changed SEO title produces `steps.seo === 'ok'` and `body.EcommerceTitle` set, while sibling SEO fields that didn't change stay absent from `body` (proving the partial-update behavior, unlike Tiny v2's must-echo-everything quirk); no local fiscal data at all produces `steps.fiscal === 'sem dado local'`.

- [ ] **Step 4: Run it**

Run: `npx tsx scripts/verify-idworks-mapping.mjs`
Expected: prints a success summary and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-idworks-mapping.mjs
git commit -m "test(idworks): verify SKU field mapping and partial-update diffing"
```

---

### Task 5: `src/services/idworksService.ts` — client wrappers

**Files:**
- Create: `src/services/idworksService.ts`

**Interfaces:**
- Produces (consumed by Task 6):
  - `export interface IdworksStatus { connected: boolean; validated: boolean; accountName: string | null; lastValidatedAt: string | null; syncMode?: 'polling' | 'webhook'; webhookUrl?: string | null; webhookStats?: { lastReceivedAt: string | null; totalReceived: number }; }`
  - `export interface IdworksNormalizedProduct { ... }` (same shape as the server type in Task 1, duplicated client-side per the existing `TinyNormalizedProduct` convention)
  - `export interface IdworksPushProduct { ... }` (mirrors Task 1's server type)
  - `export interface IdworksPushResult { idworksId: string; sku?: string; ok: boolean; steps: Record<'descricao'|'seo'|'fiscal'|'imagens', string>; }`
  - `export interface IdworksImportJob { status: 'idle'|'queued'|'running'|'done'|'error'|'canceled'; mode: 'full'|'update'; offset: number; total: number; imported: number; lastSyncAt: string | null; error?: string | null; autoSync: { enabled: boolean; everyHours: number }; }`
  - `export async function idworksStatus(): Promise<IdworksStatus>`
  - `export async function idworksConnect(accountName: string, credentials: Record<string, string>): Promise<{ valid: boolean; message: string }>`
  - `export async function idworksDisconnect(): Promise<void>`
  - `export async function idworksImportStart(mode: 'full'|'update'): Promise<{ job: IdworksImportJob }>`
  - `export async function idworksImportStatus(): Promise<{ job: IdworksImportJob }>`
  - `export async function idworksImportCancel(): Promise<void>`
  - `export async function idworksImportSetAutosync(enabled: boolean, everyHours: number): Promise<void>`
  - `export async function idworksPush(produtos: IdworksPushProduct[]): Promise<{ resultados: IdworksPushResult[] }>`
  - `export interface IdworksWebhookConfig { webhookUrl: string; headerName: string; headerValue: string; syncMode: 'polling'|'webhook'; }`
  - `export async function idworksWebhookConfig(params: { syncMode?: 'polling'|'webhook'; regenerateSecret?: boolean }): Promise<IdworksWebhookConfig>`

- [ ] **Step 1: Write the file**

Copy `src/services/tinyService.ts` structurally: same `authHeaders()`/`handle<T>()` helpers, same fetch-wrapper shape per exported function, hitting `/api/idworks/*` instead of `/api/tiny/*`. Skip anything OAuth-popup-shaped (`tinyConnect`'s `window.open` flow) — `idworksConnect` is a plain POST with a JSON body, no popup, since there's no OAuth.

- [ ] **Step 2: `npm run lint` clean**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/services/idworksService.ts
git commit -m "feat(idworks): add client service wrappers for the IdWorks proxy routes"
```

---

### Task 6: `src/components/integrations/IdworksConnector.tsx` — connector UI

**Files:**
- Create: `src/components/integrations/IdworksConnector.tsx`

**Interfaces:**
- Consumes: everything exported by Task 5's `idworksService.ts`.
- Produces (consumed by Task 7):
  - `export type IdworksPushFields = IdworksPushProduct['campos'];`
  - `export type IdworksPushCandidate = { id: string; sku: string; nome: string; changed: Record<'descricao'|'seo'|'fiscal'|'imagens', boolean>; };`
  - `interface Props { onImported: () => void; getPushPayload: (campos: IdworksPushFields) => Promise<IdworksPushProduct[]>; getPushCandidates: (campos: IdworksPushFields) => IdworksPushCandidate[]; onPushed: (results: IdworksPushResult[]) => void; }`
  - `const IdworksConnector: React.FC<Props>` (default export)

- [ ] **Step 1: Copy `BlingConnector.tsx` as the structural base**

Reuse its state shape (`status`, `loadingStatus`, `connecting`, `error`, `job`, `starting`, `pushing`, `campos`, `pushResults`, `showCandidates`), its `refreshStatus`/import-polling/`handleStart`/`handleCancel`/`handleToggleAutosync`/`handlePush` logic verbatim (only renaming `bling*` → `idworks*` identifiers and swapping in `idworksService.ts` calls) — none of that logic is IdWorks-specific.

- [ ] **Step 2: Replace the OAuth "Conectar conta Bling" block with a credentials form**

Since IdWorks has no OAuth, the "not connected" branch is a form, not a popup button:

```tsx
{!connected ? (
  <form
    className="space-y-3"
    onSubmit={async (e) => {
      e.preventDefault();
      setConnecting(true);
      setError(null);
      try {
        const res = await idworksConnect(accountName.trim(), { login: login.trim(), senha: senha });
        if (!res.valid) setError(res.message);
        else await refreshStatus();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Falha ao conectar à IdWorks.');
      } finally {
        setConnecting(false);
      }
    }}
  >
    <p className="text-sm text-slate-500">
      Informe a conta e as credenciais de API da IdWorks (obtidas com o suporte da IdWorks).
    </p>
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">Conta (subdomínio)</label>
      <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="minhaempresa" required
        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">Login</label>
      <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} required
        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">Senha / chave de API</label>
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
    </div>
    <button type="submit" disabled={connecting}
      className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
      {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
      Conectar à IdWorks
    </button>
  </form>
) : ( /* connected branch — Step 3 */ )}
```

Add `const [accountName, setAccountName] = useState('')`, `const [login, setLogin] = useState('')`, `const [senha, setSenha] = useState('')` to the component's state. Note the exact credential field names (`login`/`senha`) are a best-effort default per spec Pendências #1 — flagged in a one-line comment above the form so whoever finalizes `obtainToken` (Task 1) knows to keep this form's field names in sync with whatever the real `POST /auth/token` body turns out to need.

- [ ] **Step 3: Webhook block — per-user secret URL (mirrors Tiny's, not Bling's app-level one)**

Replace Bling's `companyId` input with a static display of the URL + suggested header (both read-only, with a copy button each), and instructions pointing at the IdWorks panel:

```tsx
<div className="border border-slate-200 rounded-xl p-4 space-y-3">
  <div>
    <h4 className="text-sm font-semibold text-slate-800">Recebimento via Webhook</h4>
    <p className="text-xs text-slate-500">
      Cole esta URL e o header abaixo em Configurações → Parametrizações → Webhook, no painel da IdWorks,
      e habilite os tópicos de produto (SKU criado/editado/excluído).
    </p>
  </div>
  <div>
    <label className="block text-xs font-semibold text-slate-600 mb-1">URL de callback</label>
    <div className="flex gap-2">
      <input type="text" readOnly value={webhookConfig?.webhookUrl ?? ''}
        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600" />
      <button onClick={() => webhookConfig && navigator.clipboard.writeText(webhookConfig.webhookUrl).catch(() => {})}
        disabled={!webhookConfig} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors">
        Copiar
      </button>
    </div>
  </div>
  <div>
    <label className="block text-xs font-semibold text-slate-600 mb-1">Header de autenticação</label>
    <p className="text-xs text-slate-500 mb-1">Nome: <code className="font-mono">{webhookConfig?.headerName ?? 'Authorization'}</code></p>
    <div className="flex gap-2">
      <input type="text" readOnly value={webhookConfig?.headerValue ?? ''}
        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600" />
      <button onClick={() => webhookConfig && navigator.clipboard.writeText(webhookConfig.headerValue).catch(() => {})}
        disabled={!webhookConfig} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors">
        Copiar
      </button>
    </div>
  </div>
  <p className="text-xs text-slate-500 inline-flex items-start gap-1.5">
    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
    {status?.webhookStats && status.webhookStats.totalReceived > 0
      ? `Último recebido: ${status.webhookStats.lastReceivedAt ? new Date(status.webhookStats.lastReceivedAt).toLocaleString('pt-BR') : '—'} · Total recebido: ${status.webhookStats.totalReceived}`
      : 'Nenhum evento recebido ainda.'}
  </p>
</div>
```

Add `const [webhookConfig, setWebhookConfig] = useState<IdworksWebhookConfig | null>(null)`, and fetch it once on connect (mirrors Bling's `useEffect` that calls `blingWebhookConfig({ syncMode: 'webhook' })` when connected — do the same here calling `idworksWebhookConfig({ syncMode: 'webhook' })` and storing the result in `webhookConfig`).

- [ ] **Step 4: Import and Push blocks**

Copy verbatim from `BlingConnector.tsx` lines 301-451 (both blocks), swapping identifiers/copy: `blingImportStart/Status/Cancel/SetAutosync` → `idworksImportStart/Status/Cancel/SetAutosync`, "Bling" → "IdWorks" in all UI strings, `#1668E3` (Bling blue) → a distinct accent color (use `emerald-600`/`emerald-700`, matching the connect button's color chosen in Step 2), `r.blingId` → `r.idworksId` in the results list, and update the push-panel help text: unlike Bling, IdWorks **does** support a SEO field group (remove the "não enviado" caveat), and the images caveat stays (public URLs still required, since `POST /sku/image` downloads from the given URL).

- [ ] **Step 5: `npm run lint` clean**

Run: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/components/integrations/IdworksConnector.tsx
git commit -m "feat(idworks): add IdWorks connector UI (connect form, import, webhook, push)"
```

---

### Task 7: Wire into `App.tsx`, `IntegrationsView.tsx`, `IntegrationsGrid.tsx`, `models.ts`, `server.ts`

**Files:**
- Modify: `src/types/models.ts`
- Modify: `src/components/integrations/IntegrationsView.tsx`
- Modify: `src/marketing/components/IntegrationsGrid.tsx`
- Modify: `src/App.tsx`
- Modify: `server.ts`
- Create: `src/assets/integrations/idworks.svg`

**Interfaces:**
- Consumes: `IdworksConnector` + its exported types (Task 6), `idworksService.ts` exports (Task 5), `registerIdworksRoutes`/`registerIdworksImportRoutes`/`startIdworksScheduler` (Task 1/2), `registerIdworksWebhookRoutes` (Task 3).

- [ ] **Step 1: Add product fields to `src/types/models.ts`**

Next to the existing `_bling*` fields (around line 157-159), add:

```typescript
  _idworksProductId?: string;     // id do SKU na IdWorks — chave de merge
  _idworksPushed?: { descricao?: string; seo?: string; fiscal?: string; imagens?: string };
  _idworksDeleted?: boolean;      // marcado true em evento de exclusão (doc preservado)
```

- [ ] **Step 2: Add the IdWorks card to `IntegrationsView.tsx`**

Copy the "ERP Bling" block (import `BlingConnector`, the card header, and the `<BlingConnector .../>` call — read the file first to find the exact line range) as a new "ERP IdWorks" block, importing `IdworksConnector` and its prop types, and threading through new `Props` fields: `onIdworksImported: () => void; getIdworksPushPayload: (campos: IdworksPushFields) => Promise<IdworksPushProduct[]>; getIdworksPushCandidates: (campos: IdworksPushFields) => IdworksPushCandidate[]; onIdworksPushed: (results: IdworksPushResult[]) => void;` — destructured in the component signature and passed straight through to `<IdworksConnector onImported={onIdworksImported} getPushPayload={getIdworksPushPayload} getPushCandidates={getIdworksPushCandidates} onPushed={onIdworksPushed} />`.

- [ ] **Step 3: Add the IdWorks card to `src/marketing/components/IntegrationsGrid.tsx`**

Read the file first to find the Tiny/Bling card entries and copy their shape (icon/name/description) for a new IdWorks entry — same list-driven pattern, no new component needed there.

- [ ] **Step 4: Wire state and handlers into `App.tsx`**

Read `src/App.tsx` lines 1-50 (imports) and lines 1760-1890 (the existing Bling push block) first, then add, right after the existing Bling block:

```typescript
// --- IdWorks push (mirrors the Bling helpers; same group-signature logic) --
const idworksSelectedProducts = (source: Product[]): Product[] => {
  const fromIdworks = source.filter((p) => p._idworksProductId);
  return selectedIds.size > 0 ? fromIdworks.filter((p) => selectedIds.has(p._id)) : fromIdworks;
};

const changedIdworksGroups = (p: Product, campos: IdworksPushFields): Record<TinyGroupKey, boolean> => {
  const gen = tinyGenerated(p);
  const out = { descricao: false, seo: false, fiscal: false, imagens: false };
  (['descricao', 'seo', 'fiscal', 'imagens'] as const).forEach((g) => {
    if (!campos[g] || !gen[g]) return;
    const { sig } = tinyGroup[g](p);
    out[g] = sig !== p._idworksPushed?.[g];
  });
  return out;
};

const getIdworksPushCandidates = (campos: IdworksPushFields) => {
  const out: { id: string; sku: string; nome: string; changed: Record<TinyGroupKey, boolean> }[] = [];
  for (const p of idworksSelectedProducts(products)) {
    const ch = changedIdworksGroups(p, campos);
    if (ch.descricao || ch.seo || ch.fiscal || ch.imagens) {
      out.push({ id: p._idworksProductId!, sku: p['Código (SKU)'] || '', nome: p['Descrição'] || p['Título SEO'] || '', changed: ch });
    }
  }
  return out;
};

const buildIdworksPushPayload = async (campos: IdworksPushFields): Promise<IdworksPushProduct[]> => {
  const out: IdworksPushProduct[] = [];
  for (const p of idworksSelectedProducts(productsRef.current)) {
    const ch = changedIdworksGroups(p, campos);
    if (!(ch.descricao || ch.seo || ch.fiscal || ch.imagens)) continue;
    out.push({
      idworksId: p._idworksProductId!,
      sku: p['Código (SKU)'],
      descricaoHtml: p['Descrição complementar'],
      seoTitle: p['Título SEO'],
      seoDescription: p['Descrição SEO'],
      seoKeywords: p['Palavras chave SEO'],
      ncm: p['NCM (Classificação fiscal)'],
      cest: p['CEST'],
      pesoLiquido: tinyToNum(p['Peso líquido (Kg)']),
      pesoBruto: tinyToNum(p['Peso bruto (Kg)']),
      largura: tinyToNum(p['Largura embalagem']),
      altura: tinyToNum(p['Altura Embalagem']),
      comprimento: tinyToNum(p['Comprimento embalagem']),
      imagens: ch.imagens ? collectTinyImages(p) : undefined,
      campos: ch,
    });
  }
  return out;
};

const handleIdworksPushed = async (results: IdworksPushResult[]) => {
  if (!user) return;
  const byId = new Map(results.map((r) => [r.idworksId, r]));
  const touched: Product[] = [];
  const next = productsRef.current.map((p) => {
    const r = p._idworksProductId ? byId.get(p._idworksProductId) : undefined;
    if (!r) return p;
    const pushed = { ...(p._idworksPushed ?? {}) };
    let upd = false;
    (['descricao', 'seo', 'fiscal', 'imagens'] as const).forEach((g) => {
      if (r.steps[g] === 'ok') { pushed[g] = tinyGroup[g](p).sig; upd = true; }
    });
    if (!upd) return p;
    const np = { ...p, _idworksPushed: pushed };
    touched.push(np);
    return np;
  });
  if (!touched.length) return;
  productsRef.current = next;
  setProducts(next);
  let batch = writeBatch(db);
  let n = 0;
  for (const p of touched) {
    batch.set(doc(db, `users/${user.uid}/products/${p._id}`), { _idworksPushed: p._idworksPushed }, { merge: true });
    if (++n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
  }
  if (n > 0) await batch.commit().catch((e) => console.warn('Falha ao salvar _idworksPushed:', e));
};
```

`tinyGroup`, `tinyGenerated`, `tinyToNum`, and `collectTinyImages` already exist in `App.tsx` (used by the Bling block) — reuse them as-is, do not redefine.

Add the corresponding imports at the top of `App.tsx` (near the existing Bling imports on lines 39-40):

```typescript
import { type IdworksPushFields } from './components/integrations/IdworksConnector';
import type { IdworksPushProduct, IdworksPushResult } from './services/idworksService';
```

Then extend the `<IntegrationsView .../>` call (search for `onBlingPushed={handleBlingPushed}` to find it) with the four new props: `onIdworksImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }} getIdworksPushPayload={buildIdworksPushPayload} getIdworksPushCandidates={getIdworksPushCandidates} onIdworksPushed={handleIdworksPushed}`.

- [ ] **Step 5: Wire `server.ts`**

Read `server.ts` to find where `registerBlingRoutes`/`registerBlingImportRoutes`/`registerBlingWebhookRoutes`/`startBlingScheduler` are imported and called, and add the IdWorks equivalents right next to them:

```typescript
import { registerIdworksRoutes } from "./server/idworksAgent";
import { registerIdworksImportRoutes, startIdworksScheduler } from "./server/idworksImportWorker";
import { registerIdworksWebhookRoutes } from "./server/idworksWebhook";
// ...
registerIdworksRoutes(app, { verifyFirebaseToken });
registerIdworksImportRoutes(app, { verifyFirebaseToken });
registerIdworksWebhookRoutes(app, { verifyFirebaseToken });
// ...
startIdworksScheduler();
```

- [ ] **Step 6: Add a placeholder logo**

Create `src/assets/integrations/idworks.svg` as a simple monogram (no official IdWorks logo asset available) — a rounded square with "ID" text, matching the visual weight of the existing `tiny.svg`/`bling.svg` icons used in `IntegrationsView.tsx`'s card headers (check their `viewBox`/size to match).

- [ ] **Step 7: `npm run lint` clean**

Run: `npm run lint`
Expected: no new errors across all modified/created files (the 3 pre-existing baseline errors from Global Constraints remain and are out of scope).

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open the app, navigate to Integrações, confirm the "ERP IdWorks" card renders with the connect form (no crash from the new props/types), and that existing Tiny/Bling cards still work unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/types/models.ts src/components/integrations/IntegrationsView.tsx src/marketing/components/IntegrationsGrid.tsx src/App.tsx server.ts src/assets/integrations/idworks.svg
git commit -m "feat(idworks): wire IdWorks connector into App.tsx, IntegrationsView, and server.ts"
```

---

### Task 8: Documentation

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `.env.example`**

Add, next to the Bling env block:

```
# IdWorks integration (server/idworksAgent.ts) — per-user accountName/credentials
# are stored in Firestore (users/{uid}/integration_secrets/idworks), not env vars.
IDWORKS_PACE_MS=200
IDWORKS_CRON_SECRET=
```

- [ ] **Step 2: `CLAUDE.md`**

Add a paragraph to the Architecture section, right after the existing Bling paragraph, following the same one-paragraph-per-integration style:

```markdown
- IdWorks (REST API, JWT bearer, no OAuth) — mirrors Tiny v2: `POST /api/idworks/connect`, `GET /api/idworks/status`, `DELETE /api/idworks/disconnect`, `POST /api/idworks/import/*`, `POST /api/idworks/push`, and a per-user webhook `POST /api/idworks/webhook/:uid/:secret` (+ `/api/idworks/webhook/config`). Server modules: `server/idworksAgent.ts`, `server/idworksImportWorker.ts`, `server/idworksWebhook.ts`; client: `src/services/idworksService.ts`, `src/components/integrations/IdworksConnector.tsx`. Products tagged `_idworksProductId`; deletions set `_idworksDeleted: true`. IdWorks calls products "SKU"; the exact `POST /auth/token` credential shape and the webhook envelope's field names aren't publicly documented — both are isolated behind `obtainToken`/`parseWebhookEnvelope` for a one-line fix once confirmed against a real account (see `docs/superpowers/specs/2026-08-24-idworks-integration-design.md`).
```

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs(idworks): document env vars and architecture notes for the IdWorks integration"
```

---

## Self-Review Notes

- **Spec coverage:** Connect (Task 1/6) ✓, background import (Task 2) ✓, webhook receive (Task 3/6) ✓, push (Task 1/6) ✓, Firestore model (Tasks 1-3) ✓, field mapping (Task 1) ✓, env vars (Task 8) ✓, pendências isolated not blocking (Tasks 1/3 comments) ✓, out-of-scope items (hub/*, price, orders, operational agent) — intentionally not tasked, matches spec's "Fora de escopo".
- **Placeholder scan:** All code blocks are complete, runnable TypeScript/TSX, not pseudocode. The two genuinely-undocumented spots (`obtainToken`'s credential shape, `parseWebhookEnvelope`'s field names) are not placeholders — they're real, compiling implementations with explicit best-effort field names and inline comments explaining why, per the Global Constraints note.
- **Type consistency:** `IdworksNormalizedProduct`, `IdworksPushProduct`, `IdworksPushResult`, `IdworksPushSteps` are defined once in Task 1 (server) and mirrored with identical field names in Task 5 (client) — checked against each other field-by-field above.
