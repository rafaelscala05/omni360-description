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

**Backend** (`server.ts`): Express server started via `tsx`. Serves as both the API layer and the Vite dev server proxy. All Gemini API calls happen here (never in the browser) using `@google/genai`. The server exposes these endpoints:
- `POST /api/gemini/generate-description` — generates HTML product description + SEO fields using a user-defined template and optional product image
- `POST /api/gemini/generate-attributes` — extracts category attributes from product text
- `POST /api/gemini/generate-attributes-from-image` — extracts attributes from a product image
- `POST /api/gemini/generate-category-hierarchy` — restructures a flat category list into a tree
- `POST /api/gemini/generate-ambient-images` — generates lifestyle/ambient images via `gemini-2.5-flash-image`
- `POST /api/gemini/enrich-product-data` — looks up GTIN/EAN, NCM, weights/dimensions via Google Search grounding
- `POST /api/upload` — saves uploaded images to `./uploads/` and returns a URL
- Bling ERP (API v3, OAuth2) — mirrors Tiny: `POST/GET /api/bling/oauth/*`, `/api/bling/status`, `/api/bling/disconnect`, `/api/bling/import/*`, `/api/bling/push`, and a single app-level HMAC webhook `POST /api/bling/webhook` (+ `/api/bling/webhook/config`). Server modules: `server/blingAgent.ts`, `server/blingImportWorker.ts`, `server/blingWebhook.ts`; client: `src/services/blingService.ts`, `src/components/integrations/BlingConnector.tsx`. Products tagged `_blingProductId`; deletions set `_blingDeleted: true`.

**Frontend** (`src/`): React 19 SPA with Tailwind CSS v4. All state lives in `App.tsx` (very large file). The app is Portuguese (Brazilian) — all UI text, AI prompts, and product field names are in pt-BR.

**Firebase** (`src/firebase.ts`): Used for Google Auth and Firestore persistence. Data is stored under `users/{uid}/products`, `users/{uid}/settings/excel`, and `users/{uid}/categories`. Credits are tracked in `users/{uid}` and debited transactionally per AI operation via `users/{uid}/credit_logs`.

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
