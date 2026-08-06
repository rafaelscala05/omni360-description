# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Express + Vite on port 3000)
npm run build        # Build frontend with Vite
npm run lint         # Type-check with tsc --noEmit
```

There are no automated tests. The app is validated manually by running the dev server.

## Environment

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to a valid Google Gemini API key. The app will fail to call any AI endpoint without it.

## Architecture

This is a full-stack TypeScript app with two runtimes:

**Backend** (`server.ts`): Express server started via `tsx`. Serves as both the API layer and the Vite dev server proxy.

Note: product AI generation (description, attributes, ambient images, enrichment, category hierarchy) **no longer runs on the server** — it migrated to the client via Firebase AI Logic. `server.ts` itself only hosts `/api/upload` and the Asaas payment routes; everything else lives in the `server/*.ts` modules registered from it. Anything that needs to observe a generation must hook the client (see the CRM below), not a server endpoint.

- `POST /api/upload` — saves uploaded images to `./uploads/` and returns a URL
- Bling ERP (API v3, OAuth2) — mirrors Tiny: `POST/GET /api/bling/oauth/*`, `/api/bling/status`, `/api/bling/disconnect`, `/api/bling/import/*`, `/api/bling/push`, and a single app-level HMAC webhook `POST /api/bling/webhook` (+ `/api/bling/webhook/config`). Server modules: `server/blingAgent.ts`, `server/blingImportWorker.ts`, `server/blingWebhook.ts`; client: `src/services/blingService.ts`, `src/components/integrations/BlingConnector.tsx`. Products tagged `_blingProductId`; deletions set `_blingDeleted: true`.

**Frontend** (`src/`): React 19 SPA with Tailwind CSS v4. All state lives in `App.tsx` (very large file). The app is Portuguese (Brazilian) — all UI text, AI prompts, and product field names are in pt-BR.

**Firebase** (`src/firebase.ts`): Used for Google Auth and Firestore persistence. Data is stored under `users/{uid}/products`, `users/{uid}/settings/excel`, and `users/{uid}/categories`. Credits are tracked in `users/{uid}` and debited transactionally per AI operation via `users/{uid}/credit_logs`.

**CRM admin** (`/admin`): internal CRM over the user base. Access is a Firebase Auth custom claim `admin: true`, granted by `npx tsx scripts/set-admin-claim.mjs <email>` (needs a **service account** — user ADC is rejected by the Auth Admin API) and verified server-side on every `/api/admin/*` call. All CRM collections are denied to the client in `firestore.rules`, so the Admin SDK is the only way in.

Three sources feed it, in precedence order: server-emitted events (`recordEvent` from ERP/onboarding/payment paths), a client beacon (`POST /api/events`, allowlisted names — this is where generation events come from, since generation is client-side), and `server/crmReconcile.ts`, which derives the journey from existing `products` / `credit_logs` / `settings` state. That third one is what backfills users who predate the event store, and `credit_logs` is the authoritative signal for the "generated content" milestone.

State lives denormalized in `users/{uid}.crm` (stage, milestones, counters, health), plus `users/{uid}/events`, `users/{uid}/crm_notes`, `crm_tasks`, `crm_audit`. All business rules (stage resolution, health score, stagnation) live in the pure, I/O-free `server/crmStage.ts` — verify with `npx tsx scripts/verify-crm-stage.mjs`. Server: `server/crm{Stage,Events,Reconcile,Admin}.ts`; client: `src/modules/admin/*`, `src/services/adminService.ts`, `src/types/crm.ts`.

## Key Data Model

`Product` (`src/types/models.ts`) uses Brazilian e-commerce spreadsheet column names as field keys (e.g., `'Código (SKU)'`, `'Descrição complementar'`). Internal runtime fields are prefixed with `_` (`_id`, `_isDirty`, `_isGenerating`, etc.). Products are stored flat in Firestore; parent/child (variation) relationships use `'Código do pai'` referencing the parent's `'Código (SKU)'`.

`Category` supports hierarchical nesting with `parentId`/`pathIds` and carries `AttributeDefinition[]` that cascade to child categories via `inheritParentAttributes`.

## Frontend Structure

- `src/App.tsx` — monolithic root component (~2700 lines); handles all product CRUD, AI generation flows, cloud sync, auth, export, and most UI
- `src/services/productService.ts` — `generateDescriptionText`, `generateProductAttributes`, `generateAttributesFromImage`, and the `defaultTemplate`
- `src/services/categoryService.ts` — `fetchCategories`, `generateCategoryHierarchy`, `flattenHierarchy`, `getEffectiveAttributes`
- `src/components/categories/CategoryManager.tsx` — full category tree editor
- `src/components/modals/` — `ProductEditModal.tsx` (inline product editing), `CategoryImportModal.tsx` (post-upload category matching)
- `src/components/ImageSearchModal.tsx` — image search and ambient image generation UI

## Export Models

The app exports to two spreadsheet formats:
- **Standard** — preserves the original upload headers, adds/updates generated columns
- **TinyERP** — maps fields to the fixed TinyERP column schema (`TINY_ERP_HEADERS` in `App.tsx`)

Dynamic product attributes (from categories) are appended as extra columns in both formats.
