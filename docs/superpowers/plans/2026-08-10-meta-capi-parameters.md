# Meta Conversions API — parâmetros completos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich every existing Meta Pixel/Conversions API event with the parameters requested by the marketing partner (`event_source_url`, name, phone, city, country, `external_id`, `content_ids`) without changing any `analytics.ts` call site signature.

**Architecture:** `src/meta.ts` gains more module-level user state (name, phone, city) and builds a richer payload; `server/metaEvents.ts` hashes the new PII fields and forwards them to the Graph API. `App.tsx` gets two one-line call-site additions to feed the new state. No new events, no new files.

**Tech Stack:** TypeScript, Express, Node `crypto` (already used for `sha256` in `server/metaEvents.ts`), `fetch` (native).

## Global Constraints

- Hash with SHA-256 (lowercase + trim) exactly these Graph API fields: `em`, `fn`, `ln`, `ph`, `ct`, `country`, `external_id`. Never hash: `client_ip_address`, `client_user_agent`, `fbc`, `fbp`, `event_source_url`.
- `country` is always the literal `'br'` — no data collection needed.
- Every new field is best-effort: if the underlying data isn't available yet (e.g. no onboarding completed), omit the field — never block or throw.
- No call site in `src/analytics.ts` changes its function signature or call arguments.
- Analytics failures must never throw into product code — preserve existing try/catch and fire-and-forget patterns.
- This project has no automated test suite (per `CLAUDE.md`); verification is `npm run lint` (`tsc --noEmit`) plus manual check of the built payload shape.

---

### Task 1: Extend `src/meta.ts` — user profile state, `event_source_url`, `content_ids`, PageView on CAPI

**Files:**
- Modify: `src/meta.ts`

**Interfaces:**
- Produces: `metaSetUser(uid: string, email?: string | null, displayName?: string | null): void` (extends existing 2-arg signature with a 3rd optional param)
- Produces: `metaSetProfile(profile: { phone?: string | null; city?: string | null }): void` (new export)
- Produces (payload sent to `POST /api/meta/events`, consumed by Task 2): 
  ```ts
  {
    event_name: string;
    event_id: string;
    event_source_url: string;
    custom_data?: Record<string, unknown>;
    user_data?: {
      email?: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
      city?: string;
      country?: string;
      external_id?: string;
    };
    fbp?: string;
    fbc?: string;
  }
  ```

- [ ] **Step 1: Read the current file to confirm line numbers before editing**

Run: `sed -n '1,90p' src/meta.ts` — confirm it still matches the version quoted below (module state at lines 16-18, `metaSetUser` at 20-23, `metaInit` at 25-34, `MetaEventPayload`/`metaTrack` at 41-84).

- [ ] **Step 2: Replace module state and `metaSetUser`/add `metaSetProfile`**

Replace:
```ts
let pixelInitialized = false;
let currentUid: string | null = null;
let currentEmail: string | null = null;

export function metaSetUser(uid: string, email?: string | null): void {
  currentUid = uid;
  currentEmail = email ?? null;
}
```
with:
```ts
let pixelInitialized = false;
let currentUid: string | null = null;
let currentEmail: string | null = null;
let currentFirstName: string | null = null;
let currentLastName: string | null = null;
let currentPhone: string | null = null;
let currentCity: string | null = null;

const COUNTRY = 'br';

export function metaSetUser(uid: string, email?: string | null, displayName?: string | null): void {
  currentUid = uid;
  currentEmail = email ?? null;
  if (displayName) {
    const [first, ...rest] = displayName.trim().split(/\s+/);
    currentFirstName = first || null;
    currentLastName = rest.length > 0 ? rest.join(' ') : null;
  } else {
    currentFirstName = null;
    currentLastName = null;
  }
}

export function metaSetProfile(profile: { phone?: string | null; city?: string | null }): void {
  if (profile.phone !== undefined) currentPhone = profile.phone || null;
  if (profile.city !== undefined) currentCity = profile.city || null;
}
```

- [ ] **Step 3: Build shared `user_data` in one place**

Add this helper right after the `metaSetProfile` function (still in `src/meta.ts`):
```ts
function buildUserData(): MetaEventPayload['user_data'] {
  const userData: NonNullable<MetaEventPayload['user_data']> = { country: COUNTRY };
  if (currentEmail) userData.email = currentEmail;
  if (currentFirstName) userData.first_name = currentFirstName;
  if (currentLastName) userData.last_name = currentLastName;
  if (currentPhone) userData.phone = currentPhone;
  if (currentCity) userData.city = currentCity;
  if (currentUid) userData.external_id = currentUid;
  return userData;
}
```
This must be declared after the `MetaEventPayload` interface is defined (see Step 5) — place it just above `metaTrack`, not immediately after `metaSetProfile`. Note this order dependency when editing: do Step 5 (interface) first if your editor complains about `MetaEventPayload` being undefined.

- [ ] **Step 4: Extract a shared send function and rewrite `metaInit` to mirror PageView to CAPI**

Replace:
```ts
export function metaInit(): void {
  try {
    if (pixelInitialized || !PIXEL_ID || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
    pixelInitialized = true;
  } catch (err) {
    console.warn('meta pixel init failed', err);
  }
}
```
with:
```ts
export function metaInit(): void {
  try {
    if (pixelInitialized || !PIXEL_ID || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('init', PIXEL_ID);
    const eventId = crypto.randomUUID();
    window.fbq('track', 'PageView', {}, { eventID: eventId });
    pixelInitialized = true;
    sendToCapi('PageView', eventId);
  } catch (err) {
    console.warn('meta pixel init failed', err);
  }
}
```

- [ ] **Step 5: Replace `MetaEventPayload` interface and `metaTrack`, adding `sendToCapi`**

Replace the whole block from `interface MetaEventPayload` to the end of the file with:
```ts
interface MetaEventPayload {
  event_name: string;
  event_id: string;
  event_source_url: string;
  custom_data?: Record<string, unknown>;
  user_data?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    city?: string;
    country?: string;
    external_id?: string;
  };
  fbp?: string;
  fbc?: string;
}

function buildUserData(): MetaEventPayload['user_data'] {
  const userData: NonNullable<MetaEventPayload['user_data']> = { country: COUNTRY };
  if (currentEmail) userData.email = currentEmail;
  if (currentFirstName) userData.first_name = currentFirstName;
  if (currentLastName) userData.last_name = currentLastName;
  if (currentPhone) userData.phone = currentPhone;
  if (currentCity) userData.city = currentCity;
  if (currentUid) userData.external_id = currentUid;
  return userData;
}

function sendToCapi(eventName: string, eventId: string, customData?: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;
    const payload: MetaEventPayload = {
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      custom_data: customData,
      user_data: buildUserData(),
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
  } catch (err) {
    console.warn('meta CAPI send failed', err);
  }
}

export function metaTrack(
  eventName: string,
  params: Record<string, unknown> = {},
  isStandard = false,
): void {
  try {
    if (typeof window === 'undefined') return;
    metaInit();

    const eventId = crypto.randomUUID();

    if (window.fbq) {
      window.fbq(isStandard ? 'track' : 'trackCustom', eventName, params, { eventID: eventId });
    }

    const customData: Record<string, unknown> = { ...params };
    if (typeof params.sku === 'string' && params.sku) {
      customData.content_ids = [params.sku];
      customData.content_type = 'product';
    }

    sendToCapi(eventName, eventId, customData);
  } catch (err) {
    console.warn('meta track failed', err);
  }
}
```

Remove the now-duplicate old `metaTrack` body/interface below this block if your edit left the original tail in place — the file should end right after this new `metaTrack` function, with no leftover code.

- [ ] **Step 6: Verify final file structure**

Run: `sed -n '1,140p' src/meta.ts` and confirm, top to bottom: `Window.fbq` declaration → `PIXEL_ID` → module state (including `COUNTRY`) → `metaSetUser` → `metaSetProfile` → `metaInit` (calls `sendToCapi`) → `readCookie` → `MetaEventPayload` → `buildUserData` → `sendToCapi` → `metaTrack`. No duplicate function names, no orphaned code after the final closing brace.

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: no new TypeScript errors from `src/meta.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/meta.ts
git commit -m "feat(meta): send name/phone/city/country/external_id/content_ids/event_source_url"
```

---

### Task 2: Extend `server/metaEvents.ts` — hash and forward the new fields

**Files:**
- Modify: `server/metaEvents.ts`

**Interfaces:**
- Consumes: the `MetaEventPayload` JSON body produced by Task 1's `sendToCapi` (fields: `event_name`, `event_id`, `event_source_url`, `custom_data`, `user_data.{email,first_name,last_name,phone,city,country,external_id}`, `fbp`, `fbc`).
- Produces: Graph API request body with `event_source_url` at the top level of each event object, and `user_data` containing `em`, `fn`, `ln`, `ph`, `ct`, `country`, `external_id` (all hashed) alongside the existing unhashed `client_ip_address`/`client_user_agent`/`fbp`/`fbc`.

- [ ] **Step 1: Read the current file to confirm line numbers**

Run: `sed -n '1,82p' server/metaEvents.ts` — confirm it matches the version already shown in this conversation (interface `MetaEventBody` at lines 10-17, `sha256` at 19-21, `forwardToMeta` at 32-81).

- [ ] **Step 2: Extend `MetaEventBody` and normalize-phone helper**

Replace:
```ts
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
```
with:
```ts
interface MetaEventBody {
  event_name?: string;
  event_id?: string;
  event_source_url?: string;
  custom_data?: Record<string, unknown>;
  user_data?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    city?: string;
    country?: string;
    external_id?: string;
  };
  fbp?: string;
  fbc?: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}
```

- [ ] **Step 3: Hash and attach the new `user_data` fields in `forwardToMeta`**

Replace:
```ts
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
```
with:
```ts
  const userData: Record<string, unknown> = {};
  if (body.user_data?.email) userData.em = [sha256(body.user_data.email)];
  if (body.user_data?.first_name) userData.fn = [sha256(body.user_data.first_name)];
  if (body.user_data?.last_name) userData.ln = [sha256(body.user_data.last_name)];
  if (body.user_data?.phone) userData.ph = [sha256(normalizePhone(body.user_data.phone))];
  if (body.user_data?.city) userData.ct = [sha256(body.user_data.city)];
  if (body.user_data?.country) userData.country = [sha256(body.user_data.country)];
  if (body.user_data?.external_id) userData.external_id = [sha256(body.user_data.external_id)];

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
  if (body.event_source_url) eventPayload.event_source_url = body.event_source_url;
  if (body.custom_data && Object.keys(body.custom_data).length > 0) {
    eventPayload.custom_data = body.custom_data;
  }
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no new TypeScript errors from `server/metaEvents.ts`.

- [ ] **Step 5: Manual smoke test against the real endpoint shape**

Run:
```bash
node -e "
const crypto = require('crypto');
const sha256 = v => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
console.log(sha256('teste@example.com'));
console.log(sha256('11999998888'.replace(/\D/g, '')));
"
```
Expected: two distinct 64-char hex hashes print with no errors — confirms the hashing logic used in the new code paths behaves as expected before it's wired to a live token.

- [ ] **Step 6: Commit**

```bash
git add server/metaEvents.ts
git commit -m "feat(meta): hash and forward name/phone/city/country/external_id to Graph API"
```

---

### Task 3: Wire `App.tsx` call sites to feed name, phone, and city into `meta.ts`

**Files:**
- Modify: `src/App.tsx:350` (inside the `onAuthStateChanged` callback)
- Modify: `src/App.tsx:385` (inside the credits/company `onSnapshot` listener)

**Interfaces:**
- Consumes: `metaSetUser(uid, email, displayName?)` and `metaSetProfile({ phone?, city? })` from Task 1.
- Consumes existing types: `CompanyData` (`src/types/onboarding.ts`) — `telefone: string`, `endereco: { cidade: string; ... }`.

- [ ] **Step 1: Confirm current call sites**

Run: `sed -n '344,388p' src/App.tsx` — confirm line 350 is `analyticsSetUser(currentUser.uid, currentUser.email);` and line 385 is `setCompanyData(snap.data().company ?? null);`, both inside `onAuthStateChanged(auth, async (currentUser) => { ... })`.

- [ ] **Step 2: Pass `displayName` into `analyticsSetUser`**

In `src/analytics.ts`, update the `analyticsSetUser` signature and forward the new arg. Replace:
```ts
export function analyticsSetUser(uid: string, email?: string | null) {
  const a = getAnalyticsInstance();
  if (a) setUserId(a, uid);
  metaSetUser(uid, email);
  tiktokSetUser(uid, email);
}
```
with:
```ts
export function analyticsSetUser(uid: string, email?: string | null, displayName?: string | null) {
  const a = getAnalyticsInstance();
  if (a) setUserId(a, uid);
  metaSetUser(uid, email, displayName);
  tiktokSetUser(uid, email);
}
```
(`tiktokSetUser` keeps its existing 2-arg call — do not add `displayName` there, it's out of scope for this plan.)

- [ ] **Step 3: Update the `App.tsx:350` call site**

Replace:
```ts
        analyticsSetUser(currentUser.uid, currentUser.email);
```
with:
```ts
        analyticsSetUser(currentUser.uid, currentUser.email, currentUser.displayName);
```

- [ ] **Step 4: Feed phone/city from company data at `App.tsx:385`**

Replace:
```ts
              setCompanyData(snap.data().company ?? null);
```
with:
```ts
              const company = snap.data().company ?? null;
              setCompanyData(company);
              metaSetProfile({ phone: company?.telefone, city: company?.endereco?.cidade });
```

- [ ] **Step 5: Add the `metaSetProfile` import**

Find the existing import of `metaTrack`/`analyticsSetUser`-adjacent analytics functions in `src/App.tsx` (search `grep -n "from './analytics'" src/App.tsx` and `grep -n "from './meta'" src/App.tsx`). If `App.tsx` imports `meta.ts` functions directly, add `metaSetProfile` to that import. If it only imports from `./analytics`, instead add a small passthrough export to `src/analytics.ts`:
```ts
export { metaSetProfile } from './meta';
```
and import `metaSetProfile` from `./analytics` in `App.tsx` alongside the other analytics imports. Use whichever matches the existing import style found by the grep — do not introduce a new import path convention.

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: no new TypeScript errors.

- [ ] **Step 7: Manual verification in the dev server**

Run: `npm run dev`, then in a browser: log in with Google, open DevTools → Network, filter for `/api/meta/events`, confirm the `Login`/`PageView` request bodies include `event_source_url`, `user_data.first_name`, `user_data.country: 'br'` (raw, unhashed — hashing happens server-side, so the client payload will show plain values, which is expected and matches the existing `email` behavior). Complete/open the onboarding company profile if not already done, then trigger another event (e.g. generate a description) and confirm `user_data.phone`/`user_data.city` now appear in that request.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/analytics.ts
git commit -m "feat(meta): feed displayName and company phone/city into Meta user_data"
```

---

## Self-Review Notes

- **Spec coverage:** `event_source_url` (Task 1 Step 5 + Task 2 Step 3), name/phone/city/country/external_id (Task 1 Steps 2-3, Task 2 Steps 2-3, Task 3), `content_ids` (Task 1 Step 5), PageView on CAPI (Task 1 Step 4), hashing rules table (Task 2 Step 3), phone normalization (Task 2 Step 2). All covered.
- **Out of scope confirmed unchanged:** no new events added, `marketing_cta_click`/public-site events untouched (they simply won't have `phone`/`city`/`external_id` since `metaSetUser`/`metaSetProfile` were never called in that session — no code change needed for that omission, it's a natural consequence of the module state being empty).
- **Type consistency:** `metaSetProfile({ phone, city })` signature in Task 1 matches the call in Task 3 Step 4 exactly. `MetaEventPayload.user_data` shape in Task 1 Step 5 matches the fields read in Task 2 Step 3 (`first_name`/`last_name`/`phone`/`city`/`country`/`external_id`).
