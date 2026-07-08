# Eventos do Meta Ads (Pixel + Conversions API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror every product event currently sent to GA4 (`src/analytics.ts`) to the Meta Pixel (client-side) and Meta Conversions API (server-side), deduplicated via a shared `event_id`, without changing any existing call site.

**Architecture:** A new `src/meta.ts` module owns Pixel init, `event_id` generation, `fbq` dispatch, and a fire-and-forget `fetch('/api/meta/events')` call. `src/analytics.ts` internally calls `metaTrack(...)` from every existing `trackX` function, so `App.tsx` and the modals never change their `analytics.ts` imports. A new `server/metaEvents.ts` receives that POST, hashes PII (SHA-256), attaches IP/user-agent, and forwards to the Meta Graph API Conversions API endpoint using a server-only access token.

**Tech Stack:** React 19 + TypeScript (Vite) frontend, Express + `tsx` backend, Node's built-in `crypto` and `fetch`, Meta Pixel (`fbevents.js`) + Meta Conversions API (Graph API `v21.0`).

## Global Constraints

- No automated test suite exists in this repo (per `CLAUDE.md`) — every "verify" step below is a manual check (dev server + browser + Meta Events Manager "Test Events" tool), not an automated test run.
- All UI text/comments follow existing repo convention: code comments in this codebase are written in pt-BR where the surrounding file already uses pt-BR (e.g. `server.ts`, `analytics.ts`); keep new comments consistent with the file they're added to.
- Analytics must never break the product flow: every new call (client fetch, server Graph API call) must fail silently (catch + log), never throw into a caller or return a non-200 to the client.
- Never expose `META_CONVERSIONS_API_TOKEN` to the client bundle — only `VITE_`-prefixed vars are safe to reference from `src/`.
- Run `npm run lint` (tsc --noEmit) after each task that touches `.ts`/`.tsx` files — this is the only automated gate in this project.

---

### Task 1: Environment variables and type declarations

**Files:**
- Modify: `/Users/rafaelscala/omni360-description/.env.example`
- Modify: `/Users/rafaelscala/omni360-description/src/vite-env.d.ts`

**Interfaces:**
- Produces: env vars `VITE_META_PIXEL_ID`, `META_CONVERSIONS_API_TOKEN`, `META_TEST_EVENT_CODE`, readable via `import.meta.env.VITE_META_PIXEL_ID` (client) and `process.env.VITE_META_PIXEL_ID` / `process.env.META_CONVERSIONS_API_TOKEN` / `process.env.META_TEST_EVENT_CODE` (server, since `dotenv.config()` in `server.ts` loads the whole `.env` file into `process.env` regardless of prefix).

- [ ] **Step 1: Add the new env vars to `.env.example`**

Append this block at the end of `.env.example`:

```
# Meta Ads (Pixel + Conversions API)
# VITE_META_PIXEL_ID: Pixel ID do Meta Events Manager (público, vai no bundle do client).
VITE_META_PIXEL_ID=
# META_CONVERSIONS_API_TOKEN: Access Token da Conversions API, gerado em
# Events Manager → (Pixel) → Configurações → Conversions API → "Gerar token de acesso".
# Secreto — nunca prefixar com VITE_ (não pode ir ao client).
META_CONVERSIONS_API_TOKEN=
# META_TEST_EVENT_CODE: opcional. Código do Events Manager → aba "Test Events",
# usado para validar eventos em tempo real durante o desenvolvimento.
META_TEST_EVENT_CODE=
```

- [ ] **Step 2: Declare the client-side env var type in `vite-env.d.ts`**

Replace the file contents with:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly VITE_META_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: no new errors (this task only adds declarations/env values, no code references them yet).

- [ ] **Step 4: Commit**

```bash
git add .env.example src/vite-env.d.ts
git commit -m "chore(meta): add Meta Pixel/Conversions API env vars"
```

---

### Task 2: `src/meta.ts` — Pixel init + tracking client

**Files:**
- Create: `/Users/rafaelscala/omni360-description/src/meta.ts`

**Interfaces:**
- Consumes: `import.meta.env.VITE_META_PIXEL_ID` (Task 1).
- Produces: `metaInit(): void`, `metaSetUser(uid: string, email?: string | null): void`, `metaTrack(eventName: string, params?: Record<string, unknown>, isStandard?: boolean): void` — all three imported by `src/analytics.ts` (Task 3) and `metaInit` imported by `src/main.tsx` (Task 5).

- [ ] **Step 1: Write `src/meta.ts`**

```ts
// Dispara eventos no Meta Pixel (client) e na Conversions API (server), com o
// mesmo event_id nos dois canais para o Meta deduplicar. Nunca deve derrubar
// o fluxo do produto: qualquer falha aqui é só logada.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID;

let pixelInitialized = false;
let currentUid: string | null = null;
let currentEmail: string | null = null;

export function metaSetUser(uid: string, email?: string | null): void {
  currentUid = uid;
  currentEmail = email ?? null;
}

export function metaInit(): void {
  if (pixelInitialized || !PIXEL_ID || typeof window === 'undefined' || !window.fbq) return;
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');
  pixelInitialized = true;
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

interface MetaEventPayload {
  event_name: string;
  event_id: string;
  custom_data?: Record<string, unknown>;
  user_data?: { email?: string };
  fbp?: string;
  fbc?: string;
}

export function metaTrack(
  eventName: string,
  params: Record<string, unknown> = {},
  isStandard = false,
): void {
  if (typeof window === 'undefined') return;
  metaInit();

  const eventId = crypto.randomUUID();

  if (window.fbq) {
    window.fbq(isStandard ? 'track' : 'trackCustom', eventName, params, { eventID: eventId });
  }

  const payload: MetaEventPayload = {
    event_name: eventName,
    event_id: eventId,
    custom_data: params,
    user_data: currentEmail ? { email: currentEmail } : undefined,
    fbp: readCookie('_fbp'),
    fbc: readCookie('_fbc'),
  };

  fetch('/api/meta/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn('meta CAPI request failed', err);
  });
}
```

`currentUid` is unused by `metaTrack` — only `currentEmail` feeds `user_data`, per the approved spec, which scoped CAPI matching to email only. Since TypeScript's `noUnusedLocals`/lint may flag an assigned-but-unread module variable, prefix the parameter name in `metaSetUser` is fine as-is (it IS read, just not consumed downstream yet) — no suppression needed.

- [ ] **Step 2: Verify with lint**

Run: `npm run lint`
Expected: no errors. If TypeScript complains about `Window.fbq` redeclaration conflicts, confirm no other file declares `window.fbq` (search: `grep -rn "fbq" src/`); this is the first declaration, so it should pass.

- [ ] **Step 3: Commit**

```bash
git add src/meta.ts
git commit -m "feat(meta): add Meta Pixel + Conversions API client module"
```

---

### Task 3: Wire `metaTrack`/`metaSetUser` into `src/analytics.ts`

**Files:**
- Modify: `/Users/rafaelscala/omni360-description/src/analytics.ts`

**Interfaces:**
- Consumes: `metaTrack(eventName, params?, isStandard?)`, `metaSetUser(uid, email?)` from `src/meta.ts` (Task 2).
- Produces: `analyticsSetUser(uid: string, email?: string | null): void` (signature change — was `analyticsSetUser(uid: string)`; the one call site is updated in Task 4). All other exported function signatures (`trackLogin`, `trackSignUp`, etc.) are unchanged.

- [ ] **Step 1: Replace the full contents of `src/analytics.ts`**

```ts
import { getAnalytics, logEvent, setUserId, Analytics } from 'firebase/analytics';
import { app } from './firebase';
import { metaTrack, metaSetUser } from './meta';

let analytics: Analytics | null = null;

function getAnalyticsInstance(): Analytics | null {
  if (analytics) return analytics;
  try {
    analytics = getAnalytics(app);
    return analytics;
  } catch {
    return null;
  }
}

export function analyticsSetUser(uid: string, email?: string | null) {
  const a = getAnalyticsInstance();
  if (a) setUserId(a, uid);
  metaSetUser(uid, email);
}

// 1. Registro / Login
export function trackLogin(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'login', { method });
  metaTrack('Login', { method }, false);
}

export function trackSignUp(method: string = 'google') {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'sign_up', { method });
  metaTrack('CompleteRegistration', { method }, true);
}

// 2. Importação de Planilha
export function trackSpreadsheetImport(params: { product_count: number; category_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'spreadsheet_import', params);
  metaTrack('spreadsheet_import', params, false);
}

// 3. Geração de Descrição
export function trackDescriptionGenerated(params: { mode: 'single' | 'mass'; product_count?: number; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'description_generated', params);
  metaTrack('description_generated', params, false);
}

// 4. Geração de Imagem Ambientada
export function trackImageGenerated(params: { type: 'ambient' | 'regenerate'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'image_generated', params);
  metaTrack('image_generated', params, false);
}

// 5. Geração de Atributos
export function trackAttributesGenerated(params: { source: 'text' | 'image'; sku?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'attributes_generated', params);
  metaTrack('attributes_generated', params, false);
}

// 6. Exportar Planilha
export function trackSpreadsheetExport(params: { model: 'standard' | 'tinyerp'; product_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'spreadsheet_export', params);
  metaTrack('spreadsheet_export', params, false);
}

// 7. Adicionar Créditos (abertura do modal de compra)
export function trackCreditPurchaseOpen() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'credit_purchase_open');
  metaTrack('InitiateCheckout', {}, true);
}

// 7b. Crédito comprado com sucesso
export function trackCreditPurchased(params: { amount: number; coupon?: string }) {
  const a = getAnalyticsInstance();
  if (a) {
    logEvent(a, 'purchase', {
      currency: 'BRL' as string,
      value: params.amount,
      coupon: params.coupon ?? '',
      transaction_id: `credits_${Date.now()}`,
      items: [],
    });
  }
  metaTrack('Purchase', { value: params.amount, currency: 'BRL', coupon: params.coupon ?? '' }, true);
}

// 8. Salvar Template de SEO
export function trackTemplateSaved(params: { is_new: boolean; template_name?: string }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'seo_template_saved', params);
  metaTrack('seo_template_saved', params, false);
}

// Extra: Enriquecimento de produto (GTIN/NCM)
export function trackProductEnriched(params: { mode: 'single' | 'mass'; product_count?: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_enriched', params);
  metaTrack('product_enriched', params, false);
}

// Extra: Hierarquia de categorias gerada
export function trackCategoryHierarchyGenerated(params: { category_count: number }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'category_hierarchy_generated', params);
  metaTrack('category_hierarchy_generated', params, false);
}

// Extra: Download da planilha padrão
export function trackTemplateDownloaded() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'template_downloaded');
  metaTrack('template_downloaded', {}, false);
}
```

- [ ] **Step 2: Verify with lint**

Run: `npm run lint`
Expected: no errors. This will also surface the one call site (`App.tsx`) still passing a single argument to `analyticsSetUser` — TypeScript allows this since `email` is optional, so it should still compile; Task 4 updates it anyway for correctness.

- [ ] **Step 3: Commit**

```bash
git add src/analytics.ts
git commit -m "feat(meta): mirror all analytics events to the Meta Pixel/CAPI"
```

---

### Task 4: Pass the user's email into `analyticsSetUser`

**Files:**
- Modify: `/Users/rafaelscala/omni360-description/src/App.tsx:318`

**Interfaces:**
- Consumes: `analyticsSetUser(uid: string, email?: string | null)` (Task 3).

- [ ] **Step 1: Update the call site**

In `src/App.tsx`, find:

```ts
      if (currentUser) {
        analyticsSetUser(currentUser.uid);
```

Replace with:

```ts
      if (currentUser) {
        analyticsSetUser(currentUser.uid, currentUser.email);
```

- [ ] **Step 2: Verify with lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(meta): forward logged-in user's email for CAPI match quality"
```

---

### Task 5: Meta Pixel base snippet + init on app boot

**Files:**
- Modify: `/Users/rafaelscala/omni360-description/index.html`
- Modify: `/Users/rafaelscala/omni360-description/src/main.tsx`

**Interfaces:**
- Consumes: `metaInit()` from `src/meta.ts` (Task 2).
- Produces: `window.fbq` available globally before React mounts.

- [ ] **Step 1: Add the Meta Pixel base snippet to `index.html`**

In `index.html`, add this script tag inside `<head>`, right after the existing `<meta property="og:type" ...>` line and before `<title>`:

```html
    <script>
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
    </script>
```

This is Meta's standard Pixel bootstrap: it defines `window.fbq` as a queueing stub and lazy-loads `fbevents.js`. It does **not** call `fbq('init', ...)` — that happens in `metaInit()` (Task 2), which reads `VITE_META_PIXEL_ID` at runtime instead of hardcoding it into static HTML.

- [ ] **Step 2: Call `metaInit()` on app boot in `src/main.tsx`**

Replace the full contents of `src/main.tsx` with:

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { metaInit } from './meta';

metaInit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: Verify with lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verify in the browser**

Run: `npm run dev`, open `http://localhost:3000` in the browser, open DevTools console, and run `typeof window.fbq`.
Expected: `"function"`. (Full end-to-end Pixel firing is verified in Task 8, once `VITE_META_PIXEL_ID` is set.)

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.tsx
git commit -m "feat(meta): bootstrap Meta Pixel base snippet and init on app load"
```

---

### Task 6: `server/metaEvents.ts` — Conversions API endpoint

**Files:**
- Create: `/Users/rafaelscala/omni360-description/server/metaEvents.ts`

**Interfaces:**
- Consumes: `process.env.VITE_META_PIXEL_ID`, `process.env.META_CONVERSIONS_API_TOKEN`, `process.env.META_TEST_EVENT_CODE` (Task 1).
- Produces: `registerMetaEventsRoutes(app: express.Express): void`, imported by `server.ts` (Task 7). Registers `POST /api/meta/events`.

- [ ] **Step 1: Write `server/metaEvents.ts`**

```ts
// Recebe eventos do client (src/meta.ts) e repassa para a Conversions API do
// Meta, hasheando PII e anexando IP/user-agent para melhorar o match quality.
// Nunca deve derrubar o fluxo do produto: sempre responde 200 ao client, e
// qualquer falha na chamada ao Meta é só logada.
import type express from 'express';
import crypto from 'crypto';

const GRAPH_API_VERSION = 'v21.0';

interface MetaEventBody {
  event_name?: string;
  event_id?: string;
  custom_data?: Record<string, unknown>;
  user_data?: { email?: string };
  fbp?: string;
  fbc?: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export function registerMetaEventsRoutes(app: express.Express): void {
  app.post('/api/meta/events', (req, res) => {
    res.status(200).json({ received: true });
    void forwardToMeta(req).catch((err) => {
      console.error('Meta CAPI request failed:', err);
    });
  });
}

async function forwardToMeta(req: express.Request): Promise<void> {
  const pixelId = process.env.VITE_META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN;
  if (!pixelId || !accessToken) return;

  const body = req.body as MetaEventBody;
  if (!body?.event_name || !body?.event_id) return;

  const userData: Record<string, unknown> = {};
  if (body.user_data?.email) userData.em = [sha256(body.user_data.email)];

  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
  if (clientIp) userData.client_ip_address = clientIp;

  const userAgent = req.headers['user-agent'];
  if (userAgent) userData.client_user_agent = userAgent;

  if (body.fbp) userData.fbp = body.fbp;
  if (body.fbc) userData.fbc = body.fbc;

  const eventPayload: Record<string, unknown> = {
    event_name: body.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id,
    action_source: 'website',
    user_data: userData,
  };
  if (body.custom_data && Object.keys(body.custom_data).length > 0) {
    eventPayload.custom_data = body.custom_data;
  }

  const requestBody: Record<string, unknown> = { data: [eventPayload] };
  if (process.env.META_TEST_EVENT_CODE) {
    requestBody.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const resp = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
  );
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Meta CAPI error:', resp.status, errText);
  }
}
```

- [ ] **Step 2: Verify with lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/metaEvents.ts
git commit -m "feat(meta): add server-side Conversions API forwarding endpoint"
```

---

### Task 7: Register the route in `server.ts`

**Files:**
- Modify: `/Users/rafaelscala/omni360-description/server.ts:12-16` (imports), `:172-180` (route registration)

**Interfaces:**
- Consumes: `registerMetaEventsRoutes(app)` (Task 6).

- [ ] **Step 1: Add the import**

In `server.ts`, find:

```ts
import { registerBlogAdminRoutes } from "./server/blogAdmin";
```

Add right after it:

```ts
import { registerMetaEventsRoutes } from "./server/metaEvents";
```

- [ ] **Step 2: Register the route**

Find:

```ts
  registerContentRoutes(app, { verifyFirebaseToken, uploadsDir });
  registerVideoRoutes(app, { verifyFirebaseToken });
  registerWakeRoutes(app, { verifyFirebaseToken });
```

Add right after it:

```ts
  registerMetaEventsRoutes(app);
```

- [ ] **Step 3: Verify with lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verify the endpoint responds**

Run: `npm run dev` (in one terminal), then in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/meta/events \
  -H "Content-Type: application/json" \
  -d '{"event_name":"template_downloaded","event_id":"test-123"}'
```

Expected: `{"received":true}` (HTTP 200), even without `META_CONVERSIONS_API_TOKEN` set yet — the endpoint short-circuits and still returns 200.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(meta): wire the Conversions API route into the server"
```

---

### Task 8: End-to-end manual verification with real credentials

**Files:** none (configuration + manual QA only)

**Interfaces:** none — this task validates Tasks 1–7 together.

- [ ] **Step 1: Set real credentials in `.env`**

In your local `.env` (not committed), set:
- `VITE_META_PIXEL_ID` — from Meta Events Manager.
- `META_CONVERSIONS_API_TOKEN` — generate at Events Manager → (your Pixel) → Settings → Conversions API → "Generate access token".
- `META_TEST_EVENT_CODE` — from Events Manager → "Test Events" tab (shown while that tab is open).

- [ ] **Step 2: Restart the dev server**

Run: `npm run dev`

- [ ] **Step 3: Verify Login event**

In the browser, log out and log back in (Google or email). Open Meta Events Manager → your Pixel → "Test Events" tab (must be open to receive `test_event_code`-tagged events).
Expected: a `Login` event appears within a few seconds, shown as received from **both** Browser and Server, with a "Deduplicated" badge (same `event_id`).

- [ ] **Step 4: Verify CompleteRegistration event**

Log in with a brand-new Google account (or delete the test user's Firestore doc under `users/{uid}` to simulate first login) so the sign-up path (`trackSignUp`) fires.
Expected: `CompleteRegistration` appears in Test Events, deduplicated Browser + Server.

- [ ] **Step 5: Verify InitiateCheckout and Purchase events**

Open the credit purchase modal (click "Adicionar Créditos" or equivalent button in the header) — this fires `trackCreditPurchaseOpen`. Complete a real or sandbox purchase flow if available.
Expected: `InitiateCheckout` appears immediately when the modal opens; `Purchase` appears (with `value`/`currency: BRL`) after a successful purchase, both deduplicated.

- [ ] **Step 6: Verify one custom event**

Trigger any product action that calls a custom-event tracker, e.g. download the spreadsheet template (`trackTemplateDownloaded`) or generate a description for a single product (`trackDescriptionGenerated`).
Expected: the corresponding custom event (e.g. `template_downloaded`) appears in Test Events as a custom event (not one of Meta's standard icons), deduplicated Browser + Server.

- [ ] **Step 7: Verify graceful degradation without credentials**

Temporarily unset `META_CONVERSIONS_API_TOKEN` in `.env`, restart the dev server, and repeat Step 6.
Expected: the product action still completes normally (no UI error), the Pixel (Browser) event may still appear in Test Events, but no Server-side event appears — confirming the backend no-ops safely when the token is absent, per the Global Constraints.

- [ ] **Step 8: Restore credentials and do a final full regression pass**

Set `META_CONVERSIONS_API_TOKEN` back, restart the dev server, and click through: login, spreadsheet import, single description generation, image generation, attribute generation, spreadsheet export, credit purchase modal open.
Expected: no console errors in the browser or server terminal; every corresponding event appears in Meta Test Events.

No commit for this task — it's verification only, not a code change.
