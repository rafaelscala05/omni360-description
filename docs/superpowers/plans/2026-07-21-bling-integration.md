# Integração Bling ERP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bling ERP (API v3) integration with full parity to the existing Tiny integration — OAuth2 connect, background catalog import, app-level HMAC-signed webhooks, and push of enriched fields (description / SEO / fiscal / images) back to Bling.

**Architecture:** Three new server modules mirror `server/tinyAgent.ts` / `server/tinyImportWorker.ts` / `server/tinyWebhook.ts`, but with Bling-specific deltas: OAuth token exchange uses HTTP Basic auth (client_id/secret in the `Authorization` header, not the body); there is **no** `provider`/v2 layer (Bling is v3-only), so `blingAgent.ts` talks to v3 directly and hosts the push route; the webhook is a **single app-level URL** shared by all merchants, resolving the user via a `companyId → uid` reverse map and validating an `X-Bling-Signature-256` HMAC-SHA256 over the raw body, responding `2xx` within 5s and processing in background with per-`eventId` dedup. A frontend service + connector component mirror `tinyService.ts` / `TinyConnector.tsx`.

**Tech Stack:** TypeScript, Express (via `tsx`), Firebase Admin SDK (Firestore), React 19 + Tailwind v4, `lucide-react`. No automated test framework — verification per task is `npm run lint` (tsc `--noEmit`) plus a final manual dev-server pass.

## Global Constraints

- **No automated tests exist.** Every code task's gate is `npm run lint` returning clean (exit 0, no errors), then a commit. TDD steps are replaced by lint + the stated manual check.
- **All UI text, comments, prompts, and product field keys are pt-BR.** Match the surrounding Tiny code exactly.
- **Tokens never reach the browser.** OAuth runs server-side; access/refresh tokens live only in `users/{uid}/integration_secrets/bling` via the Admin SDK.
- **Bling API base:** `https://api.bling.com.br/Api/v3`. **OAuth authorize:** `https://www.bling.com.br/Api/v3/oauth/authorize`. **OAuth token:** `https://www.bling.com.br/Api/v3/oauth/token` with header `Authorization: Basic base64(client_id:client_secret)` and body `application/x-www-form-urlencoded` (credentials **not** in the body).
- **Rate limit** ~3 req/s; spacing controlled by `BLING_PACE_MS` (default 350).
- **Firestore product column keys are identical to Tiny's** (see `upsertProduct` in `tinyImportWorker.ts`). Bling products are tagged with `_blingProductId`; deletions set `_blingDeleted: true`.
- **Webhook signature:** `X-Bling-Signature-256: sha256=<hex>` = HMAC-SHA256(rawBody, client_secret); compare with `crypto.timingSafeEqual`.
- Reuse the existing `oauth_states` collection (shared with Tiny) for the OAuth `state` handshake.

---

### Task 1: `server/blingAgent.ts` — OAuth2 (Basic auth), HTTP client, normalize, push body, routes

**Files:**
- Create: `server/blingAgent.ts`
- Reference (read, do not edit): `server/tinyAgent.ts`

**Interfaces:**
- Produces (imported by later tasks):
  - `PACE_MS: number`, `sleep(ms: number): Promise<void>`, `publicBaseUrl(req): string`
  - `SECRET_REF(uid)`, `STATUS_REF(uid)`, `COMPANY_REF(companyId)` (Firestore refs)
  - `getValidAccessToken(uid, forceRefresh?): Promise<string>`
  - `blingFetch<T>(uid, method, path, body?, attempt?, didRefresh?): Promise<T>`
  - `interface BlingNormalizedProduct` (same shape as `TinyNormalizedProduct` but `blingId` instead of `tinyId`)
  - `normalizeProduct(data: any): BlingNormalizedProduct`
  - `interface BlingPushProduct` / `interface BlingPushResult` (`blingId` instead of `tinyId`; `campos: { descricao; seo; fiscal; imagens }`)
  - `buildProductPutBody(current: any, prod: BlingPushProduct): Record<string, unknown>`
  - `registerBlingRoutes(app, { verifyFirebaseToken }): void` — registers OAuth `start`/`callback`/`status`/`disconnect` **and** `POST /api/bling/push`.

- [ ] **Step 1: Create `server/blingAgent.ts` with the full content below.**

```ts
// Bling ERP (API v3) integration. All calls to api.bling.com.br happen here,
// never in the browser. Auth is OAuth2 (authorization-code): omni360 is a single
// published app (global client_id/secret in env) and each merchant authorizes it.
// The token exchange uses HTTP Basic auth (client_id:client_secret in the header),
// unlike Tiny which sends them in the body. There is no v2/provider layer — Bling
// is v3-only — so this module also hosts the push route. Per-user access/refresh
// tokens are persisted server-side via the Admin SDK and never returned to the client.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const BLING_BASE = 'https://api.bling.com.br/Api/v3';
const OAUTH_AUTH = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const OAUTH_TOKEN = 'https://www.bling.com.br/Api/v3/oauth/token';

const CLIENT_ID = process.env.BLING_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.BLING_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.BLING_REDIRECT_URI ?? '';
// Product scopes; the exact scope string is configured on the Bling app. Left
// empty by default so Bling applies the app's default scopes.
const SCOPES = process.env.BLING_SCOPES ?? '';

// Bling allows ~3 req/s. Space product-detail calls during import to stay under it.
export const PACE_MS = Math.max(0, Number(process.env.BLING_PACE_MS ?? 350));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolves the public base URL (proto://host) behind the reverse proxy. Mirrors
// server/tinyAgent.ts.publicBaseUrl.
export function publicBaseUrl(req: express.Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || '';
  return `${proto}://${host}`;
}

export const SECRET_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('bling');
export const STATUS_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('settings').doc('bling');
// Reverse map for the shared app-level webhook: companyId -> uid.
export const COMPANY_REF = (companyId: string) =>
  adminDb.collection('bling_companies').doc(String(companyId));
const STATE_REF = (state: string) => adminDb.collection('oauth_states').doc(state);

interface BlingSecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// --- OAuth token lifecycle -------------------------------------------------

// Bling requires the client credentials in an HTTP Basic header (NOT the body).
async function exchangeToken(params: Record<string, string>): Promise<BlingSecret> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(params),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) {
    const msg = json?.error_description || json?.error || `Falha OAuth (${res.status})`;
    throw Object.assign(new Error(msg), { status: 401 });
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Renew a little early; expires_in is in seconds.
    expiresAt: Date.now() + Math.max(0, (Number(json.expires_in) || 3600) - 60) * 1000,
  };
}

async function persistSecret(uid: string, secret: BlingSecret): Promise<void> {
  await SECRET_REF(uid).set({ ...secret, version: 'v3', updatedAt: FieldValue.serverTimestamp() });
}

// Best-effort decode of a companyId claim from the access token JWT payload.
// Bling access tokens are JWTs; the exact claim name may vary, so we scan a few
// likely keys. Returns '' when nothing is found (the user can still set it
// manually via the webhook config route).
function companyIdFromToken(accessToken: string): string {
  try {
    const seg = accessToken.split('.')[1];
    if (!seg) return '';
    const json = JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const raw = json.companyId ?? json.company_id ?? json.cnpj ?? json.sub ?? '';
    return raw ? String(raw) : '';
  } catch {
    return '';
  }
}

export async function getValidAccessToken(uid: string, forceRefresh = false): Promise<string> {
  const snap = await SECRET_REF(uid).get();
  if (!snap.exists) throw Object.assign(new Error('Bling não conectado.'), { status: 401 });
  const secret = snap.data() as BlingSecret;

  if (!forceRefresh && secret.expiresAt > Date.now()) return secret.accessToken;

  try {
    const refreshed = await exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
    });
    await persistSecret(uid, refreshed);
    return refreshed.accessToken;
  } catch {
    await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
    throw Object.assign(new Error('Sessão Bling expirada. Reconecte a conta.'), { status: 401 });
  }
}

// --- HTTP client -----------------------------------------------------------

// Bling API client: exponential backoff on 429/5xx and one automatic token
// refresh on 401. Import/push loops call this sequentially.
export async function blingFetch<T = any>(
  uid: string,
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
  didRefresh = false,
): Promise<T> {
  const token = await getValidAccessToken(uid, didRefresh);
  const res = await fetch(`${BLING_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if ((res.status === 401 || res.status === 403) && !didRefresh) {
    return blingFetch<T>(uid, method, path, body, attempt, true);
  }

  const maxAttempts = res.status === 429 ? 6 : 3;
  if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
    const retryAfter = Number(res.headers.get('retry-after'));
    let wait: number;
    if (Number.isFinite(retryAfter) && retryAfter > 0) wait = retryAfter * 1000;
    else if (res.status === 429) wait = Math.min(30000, 2000 * 2 ** attempt);
    else wait = 2 ** attempt * 700;
    if (res.status === 429) {
      console.warn(`[bling] 429 em ${method} ${path} — aguardando ${wait}ms (tentativa ${attempt + 1}/${maxAttempts})`);
    }
    await sleep(wait);
    return blingFetch<T>(uid, method, path, body, attempt + 1, didRefresh);
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }

  if (!res.ok) {
    const err = json?.error;
    const msg = err?.description || err?.message
      || (Array.isArray(err?.fields) ? err.fields.map((f: any) => f?.msg || f).join('; ') : undefined)
      || json?.message
      || `Bling respondeu ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

// --- Import normalization --------------------------------------------------

export interface BlingNormalizedProduct {
  blingId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  precoPor?: number;
  precoDe?: number;
  marca?: string;
  categorias: string[];
  imagens: string[];
  raw: unknown;
}

// Accepts a Bling v3 product object (the `data` payload of GET /produtos/{id}).
export function normalizeProduct(p: any): BlingNormalizedProduct {
  const dim = p?.dimensoes ?? {};
  const trib = p?.tributacao ?? {};
  const externas: any[] = p?.midia?.imagens?.externas ?? [];
  const internas: any[] = p?.midia?.imagens?.internas ?? [];
  const imagens = [...externas, ...internas]
    .map((i) => i?.link ?? i?.url)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
  const catNome = p?.categoria?.descricao ?? p?.categoria?.nome;
  return {
    blingId: String(p?.id),
    sku: p?.codigo ?? '',
    nome: p?.nome ?? '',
    descricaoHtml: p?.descricaoComplementar || undefined,
    ncm: trib?.ncm || undefined,
    cest: trib?.cest || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: typeof p?.pesoLiquido === 'number' ? p.pesoLiquido : undefined,
    pesoBruto: typeof p?.pesoBruto === 'number' ? p.pesoBruto : undefined,
    largura: dim?.largura || undefined,
    altura: dim?.altura || undefined,
    comprimento: dim?.profundidade || undefined,
    precoPor: typeof p?.preco === 'number' ? p.preco : undefined,
    precoDe: typeof p?.precoCusto === 'number' ? p.precoCusto : undefined,
    marca: p?.marca || undefined,
    categorias: catNome ? [String(catNome)] : [],
    imagens: Array.from(new Set(imagens)),
    raw: p,
  };
}

// --- Push ------------------------------------------------------------------

export interface BlingPushProduct {
  blingId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: { descricao: boolean; seo: boolean; fiscal: boolean; imagens: boolean };
}

export interface BlingPushResult {
  blingId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
}

// Builds a valid PUT /produtos/{id} body from the current product, echoing the
// fields Bling expects and overriding only the selected groups. Bling PUT is a
// full update, so existing values are preserved. NOTE: Bling v3 has no rich SEO
// block on the product, so the `seo` group is a no-op here (reported separately
// in the push route) — no regression.
export function buildProductPutBody(current: any, prod: BlingPushProduct): Record<string, unknown> {
  const dim = current?.dimensoes ?? {};
  const trib = current?.tributacao ?? {};

  const body: Record<string, any> = {
    nome: current?.nome,
    codigo: current?.codigo,
    tipo: current?.tipo,
    situacao: current?.situacao,
    formato: current?.formato,
    unidade: current?.unidade,
    preco: current?.preco,
    descricaoCurta: current?.descricaoCurta,
    descricaoComplementar: current?.descricaoComplementar,
    gtin: current?.gtin,
    pesoLiquido: current?.pesoLiquido,
    pesoBruto: current?.pesoBruto,
    marca: current?.marca,
    categoria: current?.categoria?.id ? { id: current.categoria.id } : undefined,
    dimensoes: {
      largura: dim.largura,
      altura: dim.altura,
      profundidade: dim.profundidade,
      unidadeMedida: dim.unidadeMedida,
    },
    tributacao: {
      ncm: trib.ncm,
      cest: trib.cest,
      origem: trib.origem,
    },
  };

  if (prod.campos.descricao && prod.descricaoHtml) {
    body.descricaoComplementar = prod.descricaoHtml;
  }
  if (prod.campos.fiscal) {
    if (prod.ncm) body.tributacao.ncm = prod.ncm;
    if (prod.cest) body.tributacao.cest = prod.cest;
    if (prod.gtin) body.gtin = prod.gtin;
    if (prod.pesoLiquido != null) body.pesoLiquido = prod.pesoLiquido;
    if (prod.pesoBruto != null) body.pesoBruto = prod.pesoBruto;
    if (prod.largura != null) body.dimensoes.largura = prod.largura;
    if (prod.altura != null) body.dimensoes.altura = prod.altura;
    if (prod.comprimento != null) body.dimensoes.profundidade = prod.comprimento;
  }
  if (prod.campos.imagens && prod.imagens?.length) {
    // Merge with the current external images (dedup by link) so existing photos
    // aren't lost.
    const currentExternas: any[] = current?.midia?.imagens?.externas ?? [];
    const byLink = new Map<string, { link: string }>();
    for (const a of currentExternas) {
      const link = a?.link ?? a?.url;
      if (link) byLink.set(link, { link });
    }
    for (const link of prod.imagens) {
      if (link && !byLink.has(link)) byLink.set(link, { link });
    }
    body.midia = { ...(current?.midia ?? {}), imagens: { ...(current?.midia?.imagens ?? {}), externas: Array.from(byLink.values()) } };
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
  return body;
}

// --- Routes ----------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

function closePopupHtml(message: string, ok: boolean): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Bling</title></head>
<body style="font-family:system-ui;padding:2rem;text-align:center;color:#334155">
<p>${message}</p>
<script>
  try { window.opener && window.opener.postMessage({ source: 'bling-oauth', ok: ${ok} }, '*'); } catch (e) {}
  setTimeout(function(){ window.close(); }, 1500);
</script>
</body></html>`;
}

export function registerBlingRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.get('/api/bling/oauth/start', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      if (!CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).json({ message: 'Integração Bling não configurada no servidor.' });
      }
      const state = `${uid.slice(0, 6)}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      await STATE_REF(state).set({
        uid,
        provider: 'bling',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const params: Record<string, string> = {
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        state,
      };
      if (SCOPES) params.scope = SCOPES;
      const url = `${OAUTH_AUTH}?${new URLSearchParams(params)}`;
      return res.json({ url });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao iniciar OAuth.' });
    }
  });

  app.get('/api/bling/oauth/callback', async (req, res) => {
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    const oauthErr = req.query.error ? String(req.query.error_description || req.query.error) : '';
    try {
      if (oauthErr) throw new Error(oauthErr);
      if (!state || !code) throw new Error('Parâmetros OAuth ausentes.');

      const stateSnap = await STATE_REF(state).get();
      if (!stateSnap.exists) throw new Error('Sessão de autorização inválida ou expirada.');
      const stateData = stateSnap.data() ?? {};
      const uid = stateData.uid as string;
      await STATE_REF(state).delete().catch(() => {});
      if (typeof stateData.expiresAt === 'number' && stateData.expiresAt < Date.now()) {
        throw new Error('Sessão de autorização expirada. Tente novamente.');
      }

      const secret = await exchangeToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      });
      await persistSecret(uid, secret);

      // Capture companyId (best-effort) and register the reverse map so the
      // shared app-level webhook can resolve this user.
      const companyId = companyIdFromToken(secret.accessToken);
      if (companyId) {
        await COMPANY_REF(companyId).set({ uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      await STATUS_REF(uid).set({
        connected: true,
        validated: true,
        apiVersion: 'v3',
        companyId: companyId || FieldValue.delete(),
        connectedAt: FieldValue.serverTimestamp(),
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.status(200).send(closePopupHtml('Conta Bling conectada com sucesso. Pode fechar esta janela.', true));
    } catch (e: any) {
      return res.status(400).send(closePopupHtml(`Falha ao conectar: ${e?.message ?? 'erro'}`, false));
    }
  });

  app.get('/api/bling/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const [statusSnap, secretSnap] = await Promise.all([STATUS_REF(uid).get(), SECRET_REF(uid).get()]);
      const hasToken = secretSnap.exists;
      const d = statusSnap.data() ?? {};
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        version: 'v3',
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
        companyId: d.companyId ?? '',
        syncMode: d.syncMode === 'webhook' ? 'webhook' : 'polling',
        webhookUrl: `${publicBaseUrl(req)}/api/bling/webhook`,
        webhookStats: {
          lastReceivedAt: d.webhookStats?.lastReceivedAt ?? null,
          totalReceived: d.webhookStats?.totalReceived ?? 0,
        },
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });

  app.delete('/api/bling/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const statusSnap = await STATUS_REF(uid).get();
      const companyId = statusSnap.data()?.companyId as string | undefined;
      if (companyId) await COMPANY_REF(companyId).delete().catch(() => {});
      await SECRET_REF(uid).delete().catch(() => {});
      await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  // Push enriched fields back to Bling.
  app.post('/api/bling/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const secretSnap = await SECRET_REF(uid).get();
      if (!secretSnap.exists) return res.status(400).json({ message: 'Bling não conectado.' });

      const produtos: BlingPushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      const resultados: BlingPushResult[] = [];

      for (const prod of produtos) {
        const steps: BlingPushResult['steps'] = { descricao: 'skip', seo: 'skip', fiscal: 'skip', imagens: 'skip' };
        if (!prod.blingId) {
          resultados.push({ blingId: prod.blingId, sku: prod.sku, ok: false, steps: {
            descricao: 'Sem ID Bling', seo: 'Sem ID Bling', fiscal: 'Sem ID Bling', imagens: 'Sem ID Bling',
          } });
          continue;
        }
        try {
          const current = (await blingFetch<any>(uid, 'GET', `/produtos/${prod.blingId}`))?.data ?? {};
          await blingFetch(uid, 'PUT', `/produtos/${prod.blingId}`, buildProductPutBody(current, prod));
          if (prod.campos.descricao) steps.descricao = prod.descricaoHtml ? 'ok' : 'sem descrição';
          // Bling v3 has no rich SEO block on the product — nothing is pushed.
          if (prod.campos.seo) steps.seo = 'não suportado no Bling v3';
          if (prod.campos.fiscal) steps.fiscal = 'ok';
          if (prod.campos.imagens) steps.imagens = prod.imagens?.length ? 'ok' : 'sem imagens';
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          if (prod.campos.descricao) steps.descricao = msg;
          if (prod.campos.seo) steps.seo = msg;
          if (prod.campos.fiscal) steps.fiscal = msg;
          if (prod.campos.imagens) steps.imagens = msg;
        }
        const ok = (['descricao', 'seo', 'fiscal', 'imagens'] as const)
          .every((k) => steps[k] === 'ok' || steps[k] === 'skip' || steps[k].startsWith('sem ') || steps[k].startsWith('não suportado'));
        resultados.push({ blingId: prod.blingId, sku: prod.sku, ok, steps });
      }
      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
```

- [ ] **Step 2: Run lint to verify the module type-checks.**

Run: `npm run lint`
Expected: exit 0, no errors. (`blingImportWorker`/`blingWebhook` don't exist yet, but nothing imports them, and `server.ts` isn't wired until Task 4 — so this file compiles standalone.)

- [ ] **Step 3: Commit.**

```bash
git add server/blingAgent.ts
git commit -m "feat(bling): OAuth2 (Basic auth), API client, push route"
```

---

### Task 2: `server/blingImportWorker.ts` — scheduler, upsert, list/get, cron, autosync

**Files:**
- Create: `server/blingImportWorker.ts`
- Reference (read, do not edit): `server/tinyImportWorker.ts`

**Interfaces:**
- Consumes: `PACE_MS`, `sleep`, `blingFetch`, `normalizeProduct`, `BlingNormalizedProduct` from `./blingAgent`.
- Produces:
  - `upsertProduct(uid, p: BlingNormalizedProduct, source?): Promise<string>` — used by the webhook task.
  - `tick(): Promise<void>`, `startBlingScheduler(): void`
  - `registerBlingImportRoutes(app, { verifyFirebaseToken }): void`

- [ ] **Step 1: Create `server/blingImportWorker.ts` with the full content below.**

```ts
// Background import/sync for Bling ERP (API v3). A server-side worker paginates
// the Bling catalog in slices, writing products straight to Firestore, so the
// import survives the browser tab closing and can run on a recurring schedule.
// Mirrors server/tinyImportWorker.ts (in-process setInterval scheduler + a
// secret-gated /api/bling/cron/tick backstop for Cloud Scheduler). Unlike Tiny,
// there is no version/provider layer — it lists/gets straight from the v3 client.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { PACE_MS, sleep, blingFetch, normalizeProduct, type BlingNormalizedProduct } from './blingAgent';

const JOB_COL = 'bling_import_jobs';
const JOB_REF = (uid: string) => adminDb.collection(JOB_COL).doc(uid);
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

const PAGE_LIMIT = 100;         // Bling max page size
const LEASE_MS = 120_000;
const MAX_PRODUCTS_PER_JOB = 200_000;
const TICK_MS = 20_000;
const BUDGET_MS = 90_000;
const AUTOSYNC_SWEEP_MS = 60 * 60 * 1000;
// Optional Bling query param name for the "update" date filter. Left empty by
// default (update paginates the full catalog and relies on idempotent upsert);
// set BLING_UPDATE_DATE_PARAM once the exact filter is confirmed via OpenAPI.
const UPDATE_DATE_PARAM = process.env.BLING_UPDATE_DATE_PARAM ?? '';

type JobStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';
interface Job {
  status: JobStatus;
  mode: 'full' | 'update';
  offset: number;
  total: number;
  imported: number;
  lease: number | null;
  lastSyncAt: string | null;
  startedAt?: string;
  autoSync?: { enabled: boolean; everyHours: number };
}

const iso = () => new Date().toISOString();

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

// Writes one normalized product to Firestore. Source fields always update;
// enriched fields (description/SEO) only fill when empty, preserving local work.
// Uses the SAME column keys as the Tiny importer. Returns the Firestore doc id.
export async function upsertProduct(uid: string, b: BlingNormalizedProduct, source = 'bling-bg-import'): Promise<string> {
  const existingSnap = await PRODUCTS(uid).where('_blingProductId', '==', b.blingId).limit(1).get();
  const existing = existingSnap.docs[0];
  const ref = existing ? existing.ref : PRODUCTS(uid).doc(`bling_${b.blingId}`);
  const cur: Record<string, any> = existing?.data() ?? {};

  const data: Record<string, any> = {
    'Código (SKU)': b.sku || undefined,
    'Descrição': b.nome || undefined,
    'Categoria': b.categorias[0] || undefined,
    'Preço': b.precoPor,
    'Preço promocional': b.precoDe,
    'GTIN/EAN': b.gtin || undefined,
    'NCM (Classificação fiscal)': b.ncm || undefined,
    'CEST': b.cest || undefined,
    'Peso líquido (Kg)': b.pesoLiquido,
    'Peso bruto (Kg)': b.pesoBruto,
    'Largura embalagem': b.largura,
    'Altura Embalagem': b.altura,
    'Comprimento embalagem': b.comprimento,
    'Marca': b.marca || undefined,
    _blingProductId: b.blingId,
    _blingDeleted: false,
    ownerId: uid,
    createdAt: cur.createdAt || iso(),
    updatedAt: iso(),
  };
  b.imagens.slice(0, 6).forEach((url, i) => { data[`URL imagem ${i + 1}`] = url; });

  const fillIfEmpty = (key: string, val?: string) => {
    if (val && !cur[key]) data[key] = val;
  };
  fillIfEmpty('Descrição complementar', b.descricaoHtml);
  fillIfEmpty('Título SEO', b.seoTitle);
  fillIfEmpty('Descrição SEO', b.seoDescription);
  fillIfEmpty('Palavras chave SEO', b.seoKeywords);

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('bling_versions').add({
    source,
    raw: b.raw && typeof b.raw === 'object' ? stripUndefined(b.raw as any) : null,
    importedAt: iso(),
  }).catch(() => { /* backup is best-effort */ });

  return ref.id;
}

// Lists one page of product ids from Bling v3.
async function blingListPage(
  uid: string,
  opts: { offset: number; mode: 'full' | 'update'; sinceISO?: string | null },
): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  const pagina = Math.floor(opts.offset / PAGE_LIMIT) + 1;
  const params = new URLSearchParams({ pagina: String(pagina), limite: String(PAGE_LIMIT) });
  if (opts.mode === 'update' && opts.sinceISO && UPDATE_DATE_PARAM) {
    params.set(UPDATE_DATE_PARAM, opts.sinceISO.slice(0, 10));
  }
  const page = await blingFetch<any>(uid, 'GET', `/produtos?${params.toString()}`);
  const arr: any[] = Array.isArray(page?.data) ? page.data : [];
  const items = arr.map((i) => ({ id: String(i.id) }));
  return { items, total: 0, done: items.length < PAGE_LIMIT };
}

async function processSlice(uid: string, job: Job): Promise<{ total: number; imported: number; newOffset: number; done: boolean }> {
  const { items, done } = await blingListPage(uid, { offset: job.offset, mode: job.mode, sinceISO: job.lastSyncAt });
  for (let i = 0; i < items.length; i++) {
    const detail = await blingFetch<any>(uid, 'GET', `/produtos/${items[i].id}`).catch(() => null);
    if (detail?.data) await upsertProduct(uid, normalizeProduct(detail.data));
    if (PACE_MS && i < items.length - 1) await sleep(PACE_MS);
  }
  const newOffset = job.offset + items.length;
  return { total: job.total || 0, imported: items.length, newOffset, done };
}

async function claimJob(uid: string): Promise<Job | null> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(JOB_REF(uid));
    const j = snap.data() as Job | undefined;
    if (!j || (j.status !== 'queued' && j.status !== 'running')) return null;
    const now = Date.now();
    if (j.lease && j.lease > now) return null;
    tx.update(JOB_REF(uid), {
      status: 'running',
      lease: now + LEASE_MS,
      startedAt: j.startedAt ?? iso(),
      updatedAt: iso(),
    });
    return { ...j, status: 'running', offset: j.offset ?? 0, imported: j.imported ?? 0 };
  });
}

async function processJob(uid: string): Promise<void> {
  const claimed = await claimJob(uid);
  if (!claimed) return;

  const secretSnap = await adminDb.collection('users').doc(uid).collection('integration_secrets').doc('bling').get();
  if (!secretSnap.exists) {
    await JOB_REF(uid).update({ status: 'error', error: 'Bling não conectado.', lease: null, updatedAt: iso() }).catch(() => {});
    return;
  }

  let job = claimed;
  const start = Date.now();
  try {
    while (true) {
      const { total, imported, newOffset, done } = await processSlice(uid, job);
      const nextImported = (job.imported ?? 0) + imported;

      const capped = newOffset >= MAX_PRODUCTS_PER_JOB;
      if (capped) console.warn(`[bling] job ${uid} atingiu o limite de ${MAX_PRODUCTS_PER_JOB} produtos; encerrando.`);

      if (done || capped) {
        await JOB_REF(uid).update({
          status: 'done', offset: newOffset, total, imported: nextImported,
          finishedAt: iso(), lastSyncAt: iso(), lease: null, updatedAt: iso(), error: null,
        });
        return;
      }

      const fresh = (await JOB_REF(uid).get()).data() as Job | undefined;
      if (fresh?.status === 'canceled') {
        await JOB_REF(uid).update({ lease: null, updatedAt: iso() });
        return;
      }

      job = { ...job, offset: newOffset, imported: nextImported, total };

      if (Date.now() - start > BUDGET_MS) {
        await JOB_REF(uid).update({ offset: newOffset, total, imported: nextImported, lease: null, updatedAt: iso() });
        return;
      }
      await JOB_REF(uid).update({ offset: newOffset, total, imported: nextImported, lease: Date.now() + LEASE_MS, updatedAt: iso() });
    }
  } catch (e: any) {
    await JOB_REF(uid).update({
      status: 'error', error: e?.message ?? 'Falha na importação em background.', lease: null, updatedAt: iso(),
    }).catch(() => {});
  }
}

let nextSweepAt = 0;

async function sweepAutoSync(): Promise<void> {
  const snap = await adminDb.collection(JOB_COL).where('autoSync.enabled', '==', true).get();
  const now = Date.now();
  for (const doc of snap.docs) {
    const j = doc.data() as Job;
    if (j.status === 'running' || j.status === 'queued') continue;
    const everyMs = Math.max(1, j.autoSync?.everyHours ?? 24) * 60 * 60 * 1000;
    const last = j.lastSyncAt ? Date.parse(j.lastSyncAt) : 0;
    if (now - last >= everyMs) {
      await doc.ref.update({
        status: 'queued', mode: 'update', offset: 0, imported: 0, total: 0,
        lease: null, error: null, updatedAt: iso(),
      });
    }
  }
}

let isTicking = false;

export async function tick(): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    if (Date.now() >= nextSweepAt) {
      nextSweepAt = Date.now() + AUTOSYNC_SWEEP_MS;
      await sweepAutoSync().catch((e) => console.warn('[bling] sweepAutoSync falhou:', e?.message));
    }
    const snap = await adminDb.collection(JOB_COL).where('status', 'in', ['queued', 'running']).get();
    for (const doc of snap.docs) {
      await processJob(doc.id).catch((e) => console.warn(`[bling] processJob ${doc.id} falhou:`, e?.message));
    }
  } finally {
    isTicking = false;
  }
}

export function startBlingScheduler(): void {
  setInterval(() => { tick().catch((e) => console.warn('[bling] tick falhou:', e?.message)); }, TICK_MS);
  console.log('[bling] scheduler de importação iniciado');
}

// --- Routes ----------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const CRON_SECRET = process.env.BLING_CRON_SECRET || process.env.CONTENT_CRON_SECRET || '';

function publicJob(j: Job | undefined) {
  if (!j) return { status: 'idle', mode: 'full', offset: 0, total: 0, imported: 0, lastSyncAt: null, autoSync: { enabled: false, everyHours: 24 } };
  return {
    status: j.status, mode: j.mode, offset: j.offset ?? 0, total: j.total ?? 0,
    imported: j.imported ?? 0, lastSyncAt: j.lastSyncAt ?? null,
    error: (j as any).error ?? null,
    autoSync: j.autoSync ?? { enabled: false, everyHours: 24 },
  };
}

export function registerBlingImportRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/bling/import/start', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const mode = req.body?.mode === 'update' ? 'update' : 'full';
      const snap = await JOB_REF(uid).get();
      const cur = snap.data() as Job | undefined;
      if (cur?.status === 'running' || cur?.status === 'queued') {
        return res.status(409).json({ message: 'Já existe uma importação em andamento.', job: publicJob(cur) });
      }
      const job: Partial<Job> = {
        status: 'queued', mode, offset: 0, imported: 0, total: 0, lease: null,
        startedAt: iso(),
        lastSyncAt: cur?.lastSyncAt ?? null,
        autoSync: cur?.autoSync ?? { enabled: false, everyHours: 24 },
      };
      await JOB_REF(uid).set({ ...job, error: null, updatedAt: iso() }, { merge: true });
      tick().catch(() => {});
      return res.json({ job: publicJob({ ...(cur ?? {} as Job), ...job } as Job) });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao iniciar importação.' });
    }
  });

  app.get('/api/bling/import/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await JOB_REF(uid).get();
      return res.json({ job: publicJob(snap.data() as Job | undefined) });
    } catch (e: any) {
      return res.status(401).json({ message: e?.message });
    }
  });

  app.post('/api/bling/import/cancel', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await JOB_REF(uid).set({ status: 'canceled', lease: null, updatedAt: iso() }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  app.post('/api/bling/import/autosync', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const enabled = !!req.body?.enabled;
      const everyHours = Math.min(Math.max(Number(req.body?.everyHours ?? 24), 1), 168);
      await JOB_REF(uid).set({ autoSync: { enabled, everyHours }, updatedAt: iso() }, { merge: true });
      return res.json({ ok: true, autoSync: { enabled, everyHours } });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  app.post('/api/bling/cron/tick', async (req, res) => {
    if (!CRON_SECRET || req.headers['x-bling-cron-secret'] !== CRON_SECRET) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await tick().catch((e) => console.warn('[bling] cron tick falhou:', e?.message));
    return res.json({ ok: true });
  });
}
```

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit.**

```bash
git add server/blingImportWorker.ts
git commit -m "feat(bling): background import worker + scheduler + autosync"
```

---

### Task 3: `server/blingWebhook.ts` — app-level HMAC webhook + config route

**Files:**
- Create: `server/blingWebhook.ts`
- Reference (read, do not edit): `server/tinyWebhook.ts`

**Interfaces:**
- Consumes: `blingFetch`, `normalizeProduct`, `STATUS_REF`, `COMPANY_REF`, `publicBaseUrl` from `./blingAgent`; `upsertProduct` from `./blingImportWorker`.
- Produces: `registerBlingWebhookRoutes(app, { verifyFirebaseToken }): void`.

**Note on raw body:** the HMAC must be computed over the exact bytes Bling sent. This route mounts its own `express.raw({ type: '*/*' })` so the global `express.json()` (registered in `server.ts` before the routes) does not consume the body first. Express applies a route-level body parser only to that route; the raw buffer is available as `req.body` (a `Buffer`).

- [ ] **Step 1: Create `server/blingWebhook.ts` with the full content below.**

```ts
// Bling ERP app-level product webhook (API v3). Unlike Tiny (one secret URL per
// user), Bling has a SINGLE callback URL per application, shared by every merchant
// that authorized the app. Each event carries a companyId; the user is resolved
// via the bling_companies reverse map. Every request is HMAC-SHA256 signed
// (X-Bling-Signature-256: sha256=<hex>, over the raw body, keyed with the app
// client_secret). We answer 2xx within 5s and process (fetch detail + upsert) in
// the background, deduped per eventId. Docs: https://developer.bling.com.br/webhooks
import express from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { blingFetch, normalizeProduct, STATUS_REF, COMPANY_REF } from './blingAgent';
import { upsertProduct } from './blingImportWorker';

const CLIENT_SECRET = process.env.BLING_CLIENT_SECRET ?? '';
const EVENT_REF = (eventId: string) => adminDb.collection('bling_webhook_events').doc(String(eventId));
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

// Constant-time compare of the received signature against the expected HMAC.
function validSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !CLIENT_SECRET) return false;
  const received = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = crypto.createHmac('sha256', CLIENT_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Runs after the 2xx response. Fetches the product detail (created/updated) or
// flags the local doc as deleted, then updates webhook stats.
async function processEvent(uid: string, event: string, productId: string): Promise<void> {
  try {
    if (event.endsWith('.deleted') || event.endsWith('.excluir') || event === 'produto.deleted') {
      const snap = await PRODUCTS(uid).where('_blingProductId', '==', String(productId)).limit(1).get();
      const doc = snap.docs[0];
      if (doc) await doc.ref.set({ _blingDeleted: true, updatedAt: new Date().toISOString() }, { merge: true });
    } else {
      const detail = await blingFetch<any>(uid, 'GET', `/produtos/${productId}`).catch(() => null);
      if (detail?.data) await upsertProduct(uid, normalizeProduct(detail.data), 'bling-webhook');
    }
    await STATUS_REF(uid).set({
      webhookStats: {
        lastReceivedAt: new Date().toISOString(),
        totalReceived: FieldValue.increment(1),
      },
    }, { merge: true });
  } catch (e: any) {
    console.error(`[bling-webhook] falha ao processar uid=${uid} produto=${productId}: ${e?.message}`);
  }
}

export function registerBlingWebhookRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Authenticated: enable/disable webhook mode; returns the fixed callback URL and
  // lets the user set the companyId manually (from the Bling panel / first event)
  // in case it couldn't be captured from the token at connect time.
  app.post('/api/bling/webhook/config', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const body = req.body ?? {};
      const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (body.syncMode === 'polling' || body.syncMode === 'webhook') update.syncMode = body.syncMode;

      const statusSnap = await STATUS_REF(uid).get();
      const cur = statusSnap.data() ?? {};

      if (typeof body.companyId === 'string' && body.companyId.trim()) {
        const companyId = body.companyId.trim();
        update.companyId = companyId;
        // Repoint the reverse map (drop an old companyId if it changed).
        if (cur.companyId && cur.companyId !== companyId) {
          await COMPANY_REF(cur.companyId).delete().catch(() => {});
        }
        await COMPANY_REF(companyId).set({ uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      await STATUS_REF(uid).set(update, { merge: true });

      const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
      const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || '';
      return res.json({
        webhookUrl: `${proto}://${host}/api/bling/webhook`,
        companyId: update.companyId ?? cur.companyId ?? '',
        syncMode: update.syncMode ?? cur.syncMode ?? 'polling',
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao salvar configuração do webhook.' });
    }
  });

  // Public single callback for all merchants. Raw body for the HMAC check.
  app.post('/api/bling/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!validSignature(raw, req.headers['x-bling-signature-256'] as string | undefined)) {
      console.warn('[bling-webhook] assinatura inválida');
      return res.status(401).json({ message: 'Assinatura inválida.' });
    }

    let payload: any;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { payload = null; }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ message: 'Payload inválido.' });
    }

    const eventId = String(payload.eventId ?? payload.id ?? '');
    const event = String(payload.event ?? '');
    const companyId = String(payload.companyId ?? '');
    // The `data` envelope usually carries just the product id.
    const productId = String(payload?.data?.id ?? payload?.data?.produto?.id ?? '');

    // Resolve the user; unknown company -> 2xx (ignore silently, not our merchant).
    const companySnap = companyId ? await COMPANY_REF(companyId).get() : null;
    const uid = companySnap?.exists ? (companySnap.data()?.uid as string) : '';
    if (!uid) {
      console.warn(`[bling-webhook] companyId sem mapa: ${companyId || '(vazio)'}`);
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Dedup by eventId (Bling retries for up to 3 days, unordered).
    if (eventId) {
      const evRef = EVENT_REF(eventId);
      const created = await adminDb.runTransaction(async (tx) => {
        const s = await tx.get(evRef);
        if (s.exists) return false;
        tx.set(evRef, { uid, event, companyId, receivedAt: FieldValue.serverTimestamp() });
        return true;
      }).catch(() => true);
      if (!created) return res.status(200).json({ ok: true, duplicate: true });
    }

    // Answer within the 5s window; process in background.
    res.status(200).json({ ok: true });

    if (productId) {
      processEvent(uid, event, productId).catch((e) => console.error('[bling-webhook] processEvent:', e?.message));
    }
  });
}
```

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit.**

```bash
git add server/blingWebhook.ts
git commit -m "feat(bling): app-level HMAC webhook + config route"
```

---

### Task 4: Wire Bling into `server.ts`

**Files:**
- Modify: `server.ts` (imports near lines 19-23; route registration near lines 177-180; scheduler near line 506)

**Interfaces:**
- Consumes: `registerBlingRoutes`, `registerBlingImportRoutes`, `startBlingScheduler`, `registerBlingWebhookRoutes`.

- [ ] **Step 1: Add imports.** After the existing `registerTinyWebhookRoutes` import line (`server.ts:22`), add:

```ts
import { registerBlingRoutes } from "./server/blingAgent";
import { registerBlingImportRoutes, startBlingScheduler } from "./server/blingImportWorker";
import { registerBlingWebhookRoutes } from "./server/blingWebhook";
```

- [ ] **Step 2: Register routes.** After the existing `registerTinyWebhookRoutes(app, { verifyFirebaseToken });` line (`server.ts:180`), add:

```ts
  registerBlingRoutes(app, { verifyFirebaseToken });
  registerBlingImportRoutes(app, { verifyFirebaseToken });
  registerBlingWebhookRoutes(app, { verifyFirebaseToken });
```

- [ ] **Step 3: Start the scheduler.** After the existing `startTinyScheduler();` line (`server.ts:506`), add:

```ts
  // Bling background import/sync worker (production also backed by Cloud Scheduler
  // hitting /api/bling/cron/tick).
  startBlingScheduler();
```

- [ ] **Step 4: Run lint.**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit.**

```bash
git add server.ts
git commit -m "feat(bling): wire routes + scheduler in server.ts"
```

---

### Task 5: `src/services/blingService.ts` — client wrappers + product types

**Files:**
- Create: `src/services/blingService.ts`
- Reference (read, do not edit): `src/services/tinyService.ts`

**Interfaces:**
- Produces (imported by Tasks 6-7):
  - `BlingStatus`, `BlingImportJob`, `BlingPushProduct`, `BlingPushResult`, `BlingWebhookConfig` types.
  - `blingStatus()`, `blingConnect()`, `blingDisconnect()`, `blingImportStart(mode?)`, `blingImportStatus()`, `blingImportCancel()`, `blingImportSetAutosync(enabled, everyHours)`, `blingPush(produtos)`, `blingWebhookConfig(params)`.

- [ ] **Step 1: Create `src/services/blingService.ts` with the full content below.**

```ts
import { auth } from '../firebase';

// Client wrappers for the server-side Bling ERP proxy (/api/bling/*). Tokens never
// live in the browser — OAuth runs server-side and per-user access/refresh tokens
// are persisted there. These types mirror server/blingAgent.ts.

export interface BlingStatus {
  connected: boolean;
  validated: boolean;
  version?: 'v3' | null;
  lastValidatedAt: string | null;
  companyId?: string;
  syncMode?: 'polling' | 'webhook';
  webhookUrl?: string | null;
  webhookStats?: { lastReceivedAt: string | null; totalReceived: number };
}

export interface BlingPushProduct {
  blingId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: { descricao: boolean; seo: boolean; fiscal: boolean; imagens: boolean };
}

export interface BlingPushResult {
  blingId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function handle<T>(resp: Response): Promise<T> {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any)?.message ?? `Erro ${resp.status}`);
  return data as T;
}

export async function blingStatus(): Promise<BlingStatus> {
  const resp = await fetch('/api/bling/status', { headers: await authHeaders() });
  return handle(resp);
}

// Opens the Bling consent screen in a popup and resolves once it posts back the
// OAuth result (or the popup is closed).
export async function blingConnect(): Promise<{ ok: boolean }> {
  const { url } = await handle<{ url: string }>(
    await fetch('/api/bling/oauth/start', { headers: await authHeaders() }),
  );
  const popup = window.open(url, 'bling-oauth', 'width=560,height=720');
  if (!popup) throw new Error('Bloqueio de popup. Permita popups para conectar o Bling.');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      resolve({ ok });
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.source === 'bling-oauth') finish(!!ev.data.ok);
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => { if (popup.closed) finish(false); }, 800);
  });
}

export async function blingDisconnect(): Promise<void> {
  await fetch('/api/bling/disconnect', { method: 'DELETE', headers: await authHeaders() });
}

export interface BlingImportJob {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';
  mode: 'full' | 'update';
  offset: number;
  total: number;
  imported: number;
  lastSyncAt: string | null;
  error?: string | null;
  autoSync: { enabled: boolean; everyHours: number };
}

export async function blingImportStart(mode: 'full' | 'update' = 'full'): Promise<{ job: BlingImportJob }> {
  const resp = await fetch('/api/bling/import/start', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ mode }),
  });
  return handle(resp);
}

export async function blingImportStatus(): Promise<{ job: BlingImportJob }> {
  const resp = await fetch('/api/bling/import/status', { headers: await authHeaders() });
  return handle(resp);
}

export async function blingImportCancel(): Promise<void> {
  await fetch('/api/bling/import/cancel', { method: 'POST', headers: await authHeaders() });
}

export async function blingImportSetAutosync(enabled: boolean, everyHours: number): Promise<void> {
  await fetch('/api/bling/import/autosync', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ enabled, everyHours }),
  });
}

export async function blingPush(produtos: BlingPushProduct[]): Promise<{ resultados: BlingPushResult[] }> {
  const resp = await fetch('/api/bling/push', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos }),
  });
  return handle(resp);
}

export interface BlingWebhookConfig {
  webhookUrl: string;
  companyId: string;
  syncMode: 'polling' | 'webhook';
}

export async function blingWebhookConfig(params: {
  companyId?: string; syncMode?: 'polling' | 'webhook';
}): Promise<BlingWebhookConfig> {
  const resp = await fetch('/api/bling/webhook/config', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(params),
  });
  return handle(resp);
}
```

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/services/blingService.ts
git commit -m "feat(bling): client service wrappers"
```

---

### Task 6: `src/components/integrations/BlingConnector.tsx`

Bling is v3-only, so this drops the v2/token UI and the v3-disabled flag. The webhook block shows a **read-only fixed callback URL** (no per-user secret, no "regenerate"), a **companyId** field the user can set from the Bling panel, and the received-stats line. Import + push blocks are identical to Tiny except types/labels/brand color and the "SEO não é enviado ao Bling" note.

**Files:**
- Create: `src/components/integrations/BlingConnector.tsx`
- Reference (read): `src/components/integrations/TinyConnector.tsx`

**Interfaces:**
- Consumes: everything from `../../services/blingService`.
- Produces: default export `BlingConnector`; named exports `type BlingPushFields = BlingPushProduct['campos']`, `type BlingPushCandidate = { id: string; sku: string; nome: string; changed: Record<'descricao'|'seo'|'fiscal'|'imagens', boolean> }`.
- Props: `{ onImported: () => void; getPushPayload: (campos: BlingPushFields) => Promise<BlingPushProduct[]>; getPushCandidates: (campos: BlingPushFields) => BlingPushCandidate[]; onPushed: (results: BlingPushResult[]) => void }`.

- [ ] **Step 1: Create `src/components/integrations/BlingConnector.tsx` with the full content below.** (Brand color: `#1668E3` — Bling blue; hover `#0f4fac`.)

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info } from 'lucide-react';
import {
  blingStatus, blingConnect, blingDisconnect, blingPush,
  blingImportStart, blingImportStatus, blingImportCancel, blingImportSetAutosync, blingWebhookConfig,
  type BlingStatus, type BlingImportJob, type BlingPushProduct, type BlingPushResult,
} from '../../services/blingService';

export type BlingPushFields = BlingPushProduct['campos'];
export type BlingPushCandidate = {
  id: string;
  sku: string;
  nome: string;
  changed: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
};

interface Props {
  onImported: () => void;
  getPushPayload: (campos: BlingPushFields) => Promise<BlingPushProduct[]>;
  getPushCandidates: (campos: BlingPushFields) => BlingPushCandidate[];
  onPushed: (results: BlingPushResult[]) => void;
}

const FIELD_LABELS: { key: keyof BlingPushFields; label: string }[] = [
  { key: 'descricao', label: 'Descrição complementar' },
  { key: 'seo', label: 'SEO (não enviado ao Bling v3)' },
  { key: 'fiscal', label: 'Fiscais (NCM, CEST, GTIN, peso, dimensões)' },
  { key: 'imagens', label: 'Imagens (mídia externa por URL)' },
];

const CHANGED_TAGS: { key: keyof BlingPushFields; label: string }[] = [
  { key: 'descricao', label: 'Desc' },
  { key: 'seo', label: 'SEO' },
  { key: 'fiscal', label: 'Fiscal' },
  { key: 'imagens', label: 'Img' },
];

const JOB_ACTIVE = (s?: string) => s === 'running' || s === 'queued';

const BlingConnector: React.FC<Props> = ({ onImported, getPushPayload, getPushCandidates, onPushed }) => {
  const [status, setStatus] = useState<BlingStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<BlingImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const prevJobStatus = useRef<string | undefined>(undefined);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const [companyIdInput, setCompanyIdInput] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<BlingPushFields>({ descricao: true, seo: false, fiscal: true, imagens: true });
  const [pushResults, setPushResults] = useState<BlingPushResult[] | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  const refreshStatus = async (): Promise<BlingStatus> => {
    let next: BlingStatus;
    try {
      next = await blingStatus();
    } catch {
      next = { connected: false, validated: false, lastValidatedAt: null };
    } finally {
      setLoadingStatus(false);
    }
    setStatus(next);
    return next;
  };

  useEffect(() => { refreshStatus(); }, []);

  const connected = status?.validated;

  useEffect(() => { setCompanyIdInput(status?.companyId ?? ''); }, [status?.companyId]);

  // Bling's webhook is app-level; enabling "webhook" mode is what makes this
  // account start reacting to events. Ensure the flag exists once connected.
  useEffect(() => {
    if (connected && status?.syncMode !== 'webhook') {
      blingWebhookConfig({ syncMode: 'webhook' }).then(() => refreshStatus()).catch(() => {});
    }
  }, [connected, status?.syncMode]);

  const handleSaveCompanyId = async () => {
    if (companyIdInput === (status?.companyId ?? '')) return;
    setSavingWebhook(true);
    setError(null);
    try {
      await blingWebhookConfig({ companyId: companyIdInput.trim() });
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o companyId.');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    if (status?.webhookUrl) navigator.clipboard.writeText(status.webhookUrl).catch(() => {});
  };

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const poll = async () => {
      const j = await blingImportStatus().then((r) => r.job).catch(() => null);
      if (cancelled || !j) return;
      const prev = prevJobStatus.current;
      prevJobStatus.current = j.status;
      setJob(j);
      if ((prev === 'running' || prev === 'queued') && j.status === 'done') onImportedRef.current();
    };
    poll();
    let sinceIdlePoll = 0;
    const id = setInterval(() => {
      if (JOB_ACTIVE(prevJobStatus.current)) { poll(); sinceIdlePoll = 0; }
      else if (++sinceIdlePoll >= 4) { poll(); sinceIdlePoll = 0; }
    }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await blingConnect();
      const s = await refreshStatus();
      if (!s.validated) setError('Conexão não concluída. Tente novamente.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar ao Bling.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await blingDisconnect();
    setPushResults(null);
    await refreshStatus();
  };

  const handleStart = async (mode: 'full' | 'update') => {
    setStarting(true);
    setError(null);
    try {
      const { job: j } = await blingImportStart(mode);
      prevJobStatus.current = j.status;
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar importação.');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    await blingImportCancel();
    const { job: j } = await blingImportStatus();
    prevJobStatus.current = j.status;
    setJob(j);
  };

  const handleToggleAutosync = async (enabled: boolean, everyHours: number) => {
    await blingImportSetAutosync(enabled, everyHours);
    setJob((prev) => (prev ? { ...prev, autoSync: { enabled, everyHours } } : prev));
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload(campos);
      if (!payload.length) {
        setError('Selecione produtos importados do Bling (com ID Bling) para enviar.');
        return;
      }
      const res = await blingPush(payload);
      setPushResults(res.resultados);
      onPushed(res.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setPushing(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando integração…
      </div>
    );
  }

  const active = JOB_ACTIVE(job?.status);
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.imported / job.total) * 100)) : 0;
  const autoSync = job?.autoSync ?? { enabled: false, everyHours: 24 };
  const pushCandidates: BlingPushCandidate[] = connected ? getPushCandidates(campos) : [];

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!connected ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            API v3 (OAuth): você será levado à tela de autorização do Bling e, ao aprovar, os tokens
            ficam guardados com segurança no servidor — nunca no navegador.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 bg-[#1668E3] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0f4fac] disabled:opacity-50 transition-colors"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Conectar conta Bling
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
              <span className="text-emerald-800 font-semibold uppercase text-[10px] bg-emerald-100 rounded px-1.5 py-0.5">v3</span>
              {status?.lastValidatedAt && (
                <span className="text-emerald-600/70 text-xs">
                  · {new Date(status.lastValidatedAt).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>

          {/* Webhook (app-level, single callback URL) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Recebimento via Webhook</h4>
              <p className="text-xs text-slate-500">
                Cadastre esta URL de callback no painel do Bling (Aplicativos → seu app → Webhooks) e
                habilite os eventos de produto. Produtos criados/atualizados/excluídos no Bling são
                refletidos aqui automaticamente.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">URL de callback (fixa)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={status?.webhookUrl ?? ''}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600"
                />
                <button
                  onClick={handleCopyWebhookUrl}
                  disabled={!status?.webhookUrl}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Copiar
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">companyId da conta Bling</label>
              <input
                type="text"
                value={companyIdInput}
                onChange={(e) => setCompanyIdInput(e.target.value)}
                onBlur={handleSaveCompanyId}
                placeholder="Detectado no connect; ajuste se necessário"
                disabled={savingWebhook}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1668E3] focus:border-[#1668E3]"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Identifica a sua conta nos webhooks (que são compartilhados por todos os lojistas do app).
              </p>
            </div>

            <p className="text-xs text-slate-500 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {status?.webhookStats && status.webhookStats.totalReceived > 0
                ? `Último recebido: ${status.webhookStats.lastReceivedAt ? new Date(status.webhookStats.lastReceivedAt).toLocaleString('pt-BR') : '—'} · Total recebido: ${status.webhookStats.totalReceived}`
                : 'Nenhum evento recebido ainda.'}
            </p>
          </div>

          {/* Import (background) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Importar produtos (em background)</h4>
              <p className="text-xs text-slate-500">
                A importação roda no servidor — você pode <strong>fechar a aba</strong> que ela continua.
                Mescla por ID Bling; campos já enriquecidos (descrição/SEO) são preservados.
              </p>
            </div>

            {active ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {job?.status === 'queued' ? 'Na fila…' : job?.mode === 'update' ? 'Sincronizando atualizações…' : 'Importando…'}
                    {' '}{job?.imported ?? 0}{job && job.total > 0 ? `/${job.total}` : ''} produtos
                  </span>
                  <button onClick={handleCancel} className="text-slate-500 hover:text-red-600 inline-flex items-center gap-1">
                    <X className="w-3.5 h-3.5" /> Cancelar
                  </button>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#1668E3] transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleStart('full')}
                    disabled={starting}
                    className="inline-flex items-center gap-2 bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
                  >
                    {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Importar tudo
                  </button>
                  <button
                    onClick={() => handleStart('update')}
                    disabled={starting}
                    className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Sincronizar atualizações
                  </button>
                </div>
                {job && job.status === 'done' && (
                  <p className="text-xs text-emerald-600 inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Última importação: {job.imported} produtos
                    {job.lastSyncAt && ` · ${new Date(job.lastSyncAt).toLocaleString('pt-BR')}`}
                  </p>
                )}
                {job && job.status === 'error' && (
                  <p className="text-xs text-red-600 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {job.error ?? 'Falha na importação.'}
                  </p>
                )}
                {job && job.status === 'canceled' && (
                  <p className="text-xs text-slate-500">Importação cancelada em {job.imported} produtos.</p>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-600 pt-1 border-t border-slate-100 mt-1">
              <input
                type="checkbox"
                checked={autoSync.enabled}
                onChange={(e) => handleToggleAutosync(e.target.checked, autoSync.everyHours)}
                className="rounded border-slate-300 text-[#1668E3] focus:ring-[#1668E3]"
              />
              Sincronizar automaticamente a cada
              <select
                value={autoSync.everyHours}
                onChange={(e) => handleToggleAutosync(autoSync.enabled, Number(e.target.value))}
                className="border border-slate-200 rounded px-1.5 py-0.5 text-xs"
              >
                <option value={6}>6h</option>
                <option value={12}>12h</option>
                <option value={24}>24h</option>
                <option value={48}>48h</option>
              </select>
              (puxa o catálogo do Bling)
            </label>
          </div>

          {/* Push */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Enviar para Bling</h4>
              <p className="text-xs text-slate-500">
                Envia de volta apenas os produtos cujos campos <strong>selecionados abaixo mudaram</strong>
                {' '}desde o último envio — nada é reenviado sem necessidade.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {FIELD_LABELS.map(({ key, label }) => (
                <label key={key} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={campos[key]}
                    onChange={(e) => setCampos((c) => ({ ...c, [key]: e.target.checked }))}
                    className="rounded border-slate-300 text-[#1668E3] focus:ring-[#1668E3]"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Imagens são enviadas como mídia externa por URL (mescladas com as já existentes). As URLs
              precisam ser públicas para o Bling conseguir baixá-las. O Bling v3 não tem bloco de SEO no
              produto, então o grupo SEO não é enviado.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePush}
                disabled={pushing || pushCandidates.length === 0}
                className="inline-flex items-center gap-2 bg-[#1668E3] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0f4fac] disabled:opacity-50 transition-colors"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                Enviar selecionados para Bling
              </button>
              <button
                type="button"
                onClick={() => setShowCandidates(true)}
                disabled={pushCandidates.length === 0}
                title="Ver os produtos que serão enviados"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                {pushCandidates.length} {pushCandidates.length === 1 ? 'produto' : 'produtos'}
              </button>
            </div>

            {pushResults && (
              <div className="mt-2 border-t border-slate-100 pt-3 space-y-1.5 max-h-64 overflow-auto">
                {pushResults.map((r) => (
                  <div key={r.blingId} className="flex items-start gap-2 text-xs">
                    {r.ok
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className="font-medium text-slate-700">{r.sku || r.blingId}</span>
                    <span className="text-slate-500">
                      {(['descricao', 'seo', 'fiscal', 'imagens'] as const)
                        .filter((k) => r.steps[k] !== 'skip')
                        .map((k) => `${k}: ${r.steps[k]}`)
                        .join(' · ') || 'nada a enviar'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview of the products that will be sent to Bling */}
      {showCandidates && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCandidates(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">
                Produtos modificados a enviar ({pushCandidates.length})
              </h3>
              <button onClick={() => setShowCandidates(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="overflow-auto divide-y divide-slate-100">
              {pushCandidates.length === 0 ? (
                <p className="text-sm text-slate-500 px-5 py-6 text-center">
                  Nenhum produto modificado para os campos selecionados.
                </p>
              ) : (
                pushCandidates.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-500 shrink-0">{p.sku || p.id}</span>
                    <span className="text-slate-700 truncate flex-1">{p.nome || <span className="text-slate-400 italic">sem nome</span>}</span>
                    <span className="flex gap-1 shrink-0">
                      {CHANGED_TAGS.filter(({ key }) => p.changed[key]).map(({ key, label }) => (
                        <span key={key} className="text-[10px] uppercase font-semibold text-[#1668E3] bg-[#1668E3]/10 rounded px-1.5 py-0.5">
                          {label}
                        </span>
                      ))}
                    </span>
                  </div>
                ))
              )}
            </div>
            <footer className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
              Só entram produtos cujos campos <strong>selecionados</strong> mudaram desde o último envio.
              Sem seleção na lista de produtos, considera todos os vindos do Bling.
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlingConnector;
```

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/integrations/BlingConnector.tsx
git commit -m "feat(bling): connector UI (OAuth + import + webhook + push)"
```

---

### Task 7: App-level push plumbing + register the connector

Add the Bling product markers to the model, the App-level push helpers (mirroring the Tiny ones), wire `BlingConnector` through `IntegrationsView`, and add the marketing grid card.

**Files:**
- Modify: `src/types/models.ts` (add `_blingProductId`, `_blingPushed`, `_blingDeleted` to `Product`)
- Modify: `src/App.tsx` (import, push helpers near lines 1550-1690, render prop near line 2706)
- Modify: `src/components/integrations/IntegrationsView.tsx` (add Bling section + props)
- Modify: `src/marketing/components/IntegrationsGrid.tsx` (add Bling card)

**Interfaces:**
- Consumes: `BlingConnector`, `BlingPushFields`, `BlingPushCandidate` from the connector; `BlingPushProduct`, `BlingPushResult` from `blingService`.
- Produces (App → IntegrationsView props): `onBlingImported`, `getBlingPushPayload`, `getBlingPushCandidates`, `onBlingPushed`.

- [ ] **Step 1: Add Bling markers to `Product`.** In `src/types/models.ts`, find the block of Tiny runtime fields (`_tinyProductId`, `_tinyPushed`). Directly after them, add:

```ts
  _blingProductId?: string;      // id do produto no Bling — chave de merge
  _blingPushed?: { descricao?: string; seo?: string; fiscal?: string; imagens?: string };
  _blingDeleted?: boolean;        // marcado true em product.deleted (doc preservado)
```

This mirrors the verified `_tinyPushed` type (`{ descricao?: string; … }` — string signatures, since `tinyGroup[g](p).sig` is a string). Keep it identical so the reused `tinyGroup`/`tinyGenerated` logic type-checks.

- [ ] **Step 2: Import Bling symbols in `src/App.tsx`.** Next to the existing Tiny imports (`src/App.tsx:34-35`), add:

```ts
import { type BlingPushFields } from './components/integrations/BlingConnector';
import type { BlingPushProduct, BlingPushResult } from './services/blingService';
```

- [ ] **Step 3: Add the Bling push helpers in `src/App.tsx`.** Read the Tiny helper block at `src/App.tsx:1553-1690` (`tinyToNum`, `collectTinyImages`, `tinyGroup`, `TinyGroupKey`, `tinyGenerated`, `changedTinyGroups`, `tinySelectedProducts`, `getTinyPushCandidates`, `buildTinyPushPayload`, `handleTinyPushed`). Immediately **after** `handleTinyPushed` finishes, insert the Bling equivalents below. They reuse `collectTinyImages`, `tinyToNum`, `tinyGroup`, `tinyGenerated`, and `TinyGroupKey` (the group signature logic is identical), keying on `_blingProductId` / `_blingPushed`:

```ts
  // --- Bling push (mirrors the Tiny helpers; same group-signature logic) ------
  const blingSelectedProducts = (source: Product[]): Product[] => {
    const fromBling = source.filter((p) => p._blingProductId);
    return selectedIds.size > 0 ? fromBling.filter((p) => selectedIds.has(p._id)) : fromBling;
  };

  const changedBlingGroups = (p: Product, campos: BlingPushFields): Record<TinyGroupKey, boolean> => {
    const gen = tinyGenerated(p);
    const out = { descricao: false, seo: false, fiscal: false, imagens: false };
    (['descricao', 'seo', 'fiscal', 'imagens'] as const).forEach((g) => {
      if (!campos[g] || !gen[g]) return;
      const { sig } = tinyGroup[g](p);
      out[g] = sig !== p._blingPushed?.[g];
    });
    return out;
  };

  const getBlingPushCandidates = (campos: BlingPushFields) => {
    const out: { id: string; sku: string; nome: string; changed: Record<TinyGroupKey, boolean> }[] = [];
    for (const p of blingSelectedProducts(products)) {
      const ch = changedBlingGroups(p, campos);
      if (ch.descricao || ch.seo || ch.fiscal || ch.imagens) {
        out.push({ id: p._blingProductId!, sku: p['Código (SKU)'] || '', nome: p['Descrição'] || p['Título SEO'] || '', changed: ch });
      }
    }
    return out;
  };

  const buildBlingPushPayload = async (campos: BlingPushFields): Promise<BlingPushProduct[]> => {
    const out: BlingPushProduct[] = [];
    for (const p of blingSelectedProducts(productsRef.current)) {
      const ch = changedBlingGroups(p, campos);
      if (!(ch.descricao || ch.seo || ch.fiscal || ch.imagens)) continue;
      out.push({
        blingId: p._blingProductId!,
        sku: p['Código (SKU)'],
        descricaoHtml: p['Descrição complementar'],
        seoTitle: p['Título SEO'],
        seoDescription: p['Descrição SEO'],
        seoKeywords: p['Palavras chave SEO'],
        ncm: p['NCM (Classificação fiscal)'],
        gtin: p['GTIN/EAN'],
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

  const handleBlingPushed = async (results: BlingPushResult[]) => {
    if (!user) return;
    const byId = new Map(results.map((r) => [r.blingId, r]));
    const touched: Product[] = [];
    const next = productsRef.current.map((p) => {
      const r = p._blingProductId ? byId.get(p._blingProductId) : undefined;
      if (!r) return p;
      const pushed = { ...(p._blingPushed ?? {}) };
      let upd = false;
      (['descricao', 'seo', 'fiscal', 'imagens'] as const).forEach((g) => {
        if (r.steps[g] === 'ok') { pushed[g] = tinyGroup[g](p).sig; upd = true; }
      });
      if (!upd) return p;
      const np = { ...p, _blingPushed: pushed };
      touched.push(np);
      return np;
    });
    if (!touched.length) return;
    productsRef.current = next;
    setProducts(next);
    const batch = writeBatch(db);
    for (const p of touched) {
      batch.set(doc(db, `users/${user.uid}/products/${p._id}`), { _blingPushed: p._blingPushed }, { merge: true });
    }
    await batch.commit().catch((e) => console.warn('Falha ao salvar _blingPushed:', e));
  };
```

> Verify the exact names `writeBatch`, `doc`, `db`, `user`, `products`, `productsRef`, `setProducts`, `selectedIds` are already in scope in `App.tsx` (they are used by the Tiny handler right above). If the Tiny handler's persistence uses a differently-named batch helper, mirror that exact code instead.

- [ ] **Step 4: Pass the Bling props to `IntegrationsView`.** At `src/App.tsx:2706`, extend the existing `<IntegrationsView … />` with:

```tsx
onBlingImported={() => { if (!hasUnsavedChanges) loadFromCloud(true); }}
getBlingPushPayload={buildBlingPushPayload}
getBlingPushCandidates={getBlingPushCandidates}
onBlingPushed={handleBlingPushed}
```

- [ ] **Step 5: Update `IntegrationsView.tsx`.** Apply three edits:

Add imports after the Tiny import (line 4-6):
```tsx
import BlingConnector, { type BlingPushFields, type BlingPushCandidate } from './BlingConnector';
import type { BlingPushProduct, BlingPushResult } from '../../services/blingService';
```

Extend `Props` (after `onTinyPushed`):
```tsx
  onBlingImported: () => void;
  getBlingPushPayload: (campos: BlingPushFields) => Promise<BlingPushProduct[]>;
  getBlingPushCandidates: (campos: BlingPushFields) => BlingPushCandidate[];
  onBlingPushed: (results: BlingPushResult[]) => void;
```

Destructure them in the component signature (add to the existing list): `onBlingImported, getBlingPushPayload, getBlingPushCandidates, onBlingPushed`.

Add a Bling `<section>` after the Tiny one (before the closing `</div>` at line 61):
```tsx
      {/* ERP Bling */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="bg-slate-900 p-2 rounded-lg">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">ERP Bling</h3>
            <p className="text-xs text-slate-500">Importe produtos e envie dados enriquecidos.</p>
          </div>
        </header>
        <div className="px-5 py-5">
          <BlingConnector onImported={onBlingImported} getPushPayload={getBlingPushPayload} getPushCandidates={getBlingPushCandidates} onPushed={onBlingPushed} />
        </div>
      </section>
```

- [ ] **Step 6: Add the Bling card to `IntegrationsGrid.tsx`.** The array items match `interface Integration { name: string; render: () => ReactNode; comingSoon?: boolean }`. Bling is live (no `comingSoon`). If a logo asset exists at `src/assets/integrations/bling.svg`, import it (`import blingLogo from '../../assets/integrations/bling.svg';`) and render it like the Tiny logo; otherwise render the name as text. Add this object to the `integrations` array, after the `ERP Tiny` entry:

```tsx
  {
    name: 'ERP Bling',
    render: () => <span className="text-porcelain font-semibold text-lg">Bling</span>,
  },
```

- [ ] **Step 7: Run lint.**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 8: Commit.**

```bash
git add src/types/models.ts src/App.tsx src/components/integrations/IntegrationsView.tsx src/marketing/components/IntegrationsGrid.tsx
git commit -m "feat(bling): app push plumbing + register connector in Integrações"
```

---

### Task 8: Env + docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append Bling vars to `.env.example`** (after the Tiny block, ~line 61):

```bash
# Bling ERP — API v3, OAuth2 (app único publicado do omni360).
# Gerados em: Bling → Preferências → Cadastro de aplicativos → novo aplicativo.
BLING_CLIENT_ID=
BLING_CLIENT_SECRET=
# BLING_REDIRECT_URI: idêntica à URL de redirecionamento cadastrada no app Bling.
# Ex.: https://SEU_DOMINIO/api/bling/oauth/callback
BLING_REDIRECT_URI=
# BLING_SCOPES (opcional): escopos separados por espaço. Vazio = usa os do app.
BLING_SCOPES=
# BLING_PACE_MS (opcional): espaçamento em ms entre chamadas de detalhe na
# importação (Bling ~3 req/s). Padrão 350.
BLING_PACE_MS=
# BLING_CRON_SECRET (opcional): protege POST /api/bling/cron/tick; fallback p/
# CONTENT_CRON_SECRET. Enviado pelo Cloud Scheduler no header x-bling-cron-secret.
BLING_CRON_SECRET=
# BLING_UPDATE_DATE_PARAM (opcional): nome do parâmetro de filtro por data no
# GET /produtos usado no modo "update". Vazio = modo update pagina o catálogo todo.
BLING_UPDATE_DATE_PARAM=
```

- [ ] **Step 2: Document endpoints in `CLAUDE.md`.** In the Architecture → Backend endpoints list (or add a short "Integrações" note), add a line noting the Bling integration mirrors Tiny with new endpoints:

```markdown
- Bling ERP (API v3, OAuth2) — mirrors Tiny: `POST/GET /api/bling/oauth/*`, `/api/bling/status`, `/api/bling/disconnect`, `/api/bling/import/*`, `/api/bling/push`, and a single app-level HMAC webhook `POST /api/bling/webhook` (+ `/api/bling/webhook/config`). Server modules: `server/blingAgent.ts`, `server/blingImportWorker.ts`, `server/blingWebhook.ts`; client: `src/services/blingService.ts`, `src/components/integrations/BlingConnector.tsx`. Products tagged `_blingProductId`; deletions set `_blingDeleted: true`.
```

- [ ] **Step 3: Run lint (docs don't affect it, but confirm nothing regressed).**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit.**

```bash
git add .env.example CLAUDE.md
git commit -m "docs(bling): env vars + endpoints in CLAUDE.md"
```

---

### Task 9: Manual dev-server validation

**Files:** none (validation only). Requires `.env` populated with real `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` / `BLING_REDIRECT_URI` and a Bling app configured in the developer panel (callback URL + product events).

- [ ] **Step 1: Start the dev server.**

Run: `npm run dev`
Expected: server boots on port 3000; console shows `[bling] scheduler de importação iniciado` alongside the Tiny line. No import/require errors.

- [ ] **Step 2: Connect.** Open the app → Integrações → ERP Bling → "Conectar conta Bling". Approve in the popup. Expected: card flips to "Conectada e validada · v3"; `users/{uid}/settings/bling` has `connected/validated: true` and (if the token exposed it) a `companyId`; `bling_companies/{companyId}` maps to the uid.

- [ ] **Step 3: Import.** Click "Importar tudo". Expected: progress advances; products appear under `users/{uid}/products` with `_blingProductId` set and the shared column keys populated; enriched fields left empty. Closing the tab does not stop the job.

- [ ] **Step 4: Webhook.** Ensure the `companyId` field is filled (paste it from the Bling panel if the connect didn't capture it). Send a signed test event (product.created/updated) from Bling. Expected: server logs the receipt, the product upserts/updates, and `webhookStats.totalReceived` increments. Send an unsigned/altered-body request → expect `401`. Send a `product.deleted` → the matching local doc gets `_blingDeleted: true` (document preserved).

- [ ] **Step 5: Push.** Select an imported product, edit its description in the app, choose the "Descrição complementar" + "Fiscais" groups, click "Enviar selecionados para Bling". Expected: the connector shows `descricao: ok`, `fiscal: ok`, `seo: não suportado no Bling v3`; the change is visible on the product in Bling; a re-send without further edits sends nothing (dedup by `_blingPushed`).

- [ ] **Step 6: Final commit (if any doc tweaks came out of validation).** Otherwise the feature is complete on the branch.

---

## Notes on spec pendências (resolve during Task 1/2 if OpenAPI access is available)

These were flagged "a confirmar via OpenAPI" in the spec and are implemented with safe defaults; tighten if you can confirm the exact API shapes:

1. **companyId source at connect** — implemented as a best-effort JWT-claim scan (`companyId`/`company_id`/`cnpj`/`sub`) plus a manual field in the webhook config. If Bling exposes a `/me`-style endpoint, add a `blingFetch(uid, 'GET', '/…')` call in the callback to set `companyId` authoritatively.
2. **Pagination** — implemented as `?pagina=&limite=100`; `done` when a page returns `< 100`. Confirm the response envelope key (`data`) and whether a total count is available (currently `total: 0`, so the UI shows count-only progress).
3. **Update-mode date filter** — gated behind `BLING_UPDATE_DATE_PARAM` (empty ⇒ update paginates the full catalog). Set it to the confirmed param name (e.g. `dataAlteracao`) once known.
4. **SEO push** — Bling v3 has no rich product SEO block, so the `seo` group is intentionally a no-op reported as "não suportado no Bling v3" (no regression). If Bling adds SEO-like fields, extend `buildProductPutBody`.
