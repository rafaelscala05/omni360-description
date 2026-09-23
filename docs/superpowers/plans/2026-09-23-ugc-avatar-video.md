# Vídeo UGC com avatar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, opt-in video generation mode where a user-created, reusable avatar (a person) appears on screen speaking to camera and interacting with the product, alongside the existing muted/voice-over classic mode.

**Architecture:** Client-side avatar creation (text → portrait image via Firebase AI Logic, persisted per-user in Firestore) feeds a new server-side pipeline (`server/ugcVideoAgent.ts`, mirroring the existing `server/videoAgent.ts`) that generates a 2-3 clip script via Gemini, then calls Veo per clip with **two** reference images (avatar + product) and native audio instead of one muted reference image. A new sibling wizard component (`UgcVideoGenerationTab.tsx`) drives the UI; the classic wizard and its data are untouched.

**Tech Stack:** React 19 + TypeScript (client), Express + `tsx` (server), Firebase (Firestore, Storage, AI Logic/Vertex AI), `@google/genai` (Gemini + Veo), `ffmpeg-static`.

**Spec:** `docs/superpowers/specs/2026-09-23-ugc-avatar-video-design.md`

## Global Constraints

- This is an **additional** mode. The classic pipeline (`server/videoAgent.ts`, `VideoGenerationTab.tsx`, `_video*` product fields) must keep working unmodified in behavior — only touched for the shared-helper extraction in Task 3 and Task 8, both explicitly regression-checked.
- Avatars are a **per-user library**, created and selected entirely inside the video wizard (no admin screen, no separate page).
- UGC script is **2 to 3 clips** with roles `gancho` / `demonstracao` / `cta`, each carrying a `fala` (dialogue) instead of the classic `narracao` (voice-over).
- Veo call per clip uses **two** `ASSET` reference images (avatar + product) and `generateAudio: true`. This is **unvalidated** — Task 1 is a go/no-go spike gate that must pass before any later task is started.
- Credits: `avatar_creation` is debited **client-side**, after success, via `consumeCredit` (same pattern as `ambient_image`). `video_ugc_generation` is debited **server-side** via `debitCreditsAdmin`, refunded on failure via `refundCreditsAdmin` (same pattern as `video_generation`).
- No automated test framework exists in this repo (`CLAUDE.md`: "There are no automated tests. The app is validated manually by running the dev server."). Pure logic (prompt builders, validators, path helpers) gets a `scripts/verify-*.mjs` script, following the existing convention (see `scripts/verify-crm-stage.mjs`). Everything else is validated by running `npm run dev` and using the feature by hand. Every task ends with `npm run lint` (`tsc --noEmit`) passing clean.
- Music mixing and burned-in captions are explicitly **out of scope** for this v1 (native Veo audio carries the dialogue).

## Review Focus

- **Avatar generation is blocked/returns no image** (Vertex safety filter on the text-to-image call) — the "Criar avatar" form must surface a readable error and let the user retry, not crash or silently leave the form stuck (Task 4, Task 5).
- **Gemini doesn't follow the clip-count/role instructions** (returns 1, 4, or 5 clips, or an invalid `papel`) — `validateUgcScript` must reject it so the route returns a clean 400 instead of the pipeline generating clips from a malformed script (Task 6).
- **User changes the selected avatar after already generating a script** — the stale script (built from the previous avatar's description) must not be silently submitted to the video job; going back to `select-avatar` and picking a different avatar must clear the generated script (Task 9).
- **Two video jobs race** (user starts a classic job, then immediately opens the UGC tab and tries to start one too, or vice versa) — the "only one active video job" gate must block the second one regardless of which mode started first (Task 10).
- **Insufficient credits when starting the UGC job** — `debitCreditsAdmin`'s 402 must surface as a readable pt-BR message in the wizard's `script` stage, not a generic crash (Task 9, checked manually in Task 11).

---

### Task 1: Spike — validate Veo with 2 reference images + native audio (go/no-go gate)

**Files:**
- Create: `scripts/spike-ugc-veo.mjs`

**Interfaces:**
- Consumes: nothing from this plan (standalone script against the live Veo API).
- Produces: a go/no-go decision that gates every other task. Nothing else in this plan imports from this file.

This is **not** a TDD step — it's a manual-inspection spike the spec explicitly requires before building the real pipeline, because nothing in this codebase has ever sent Veo two `ASSET` reference images at once or asked it for `generateAudio: true`.

- [ ] **Step 1: Write the spike script**

```js
// scripts/spike-ugc-veo.mjs
//
// Spike: valida se o Veo 3.1 aceita 2 reference images (ASSET) simultâneas —
// uma pessoa (avatar) + um produto — e se `generateAudio: true` produz fala
// sincronizada em pt-BR. Gera UM clipe de ~8s e salva localmente para
// inspeção manual. NÃO é um teste automatizado — é um gate manual: o humano
// assiste o vídeo e decide se o design da spec se sustenta.
//
// Uso: npx tsx scripts/spike-ugc-veo.mjs <foto-pessoa.jpg> <foto-produto.jpg>
// Requer: `gcloud auth application-default login` já configurado (mesmas
// credenciais que o pipeline de vídeo clássico usa) e um
// firebase-applet-config.json com projectId válido.

import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
import { promises as fs } from 'node:fs';
import firebaseAppletConfig from '../firebase-applet-config.json';

const [, , avatarPath, productPath] = process.argv;
if (!avatarPath || !productPath) {
  console.error('Uso: npx tsx scripts/spike-ugc-veo.mjs <foto-pessoa> <foto-produto>');
  process.exit(1);
}

async function toBase64(filePath) {
  const buf = await fs.readFile(filePath);
  const mimeType = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { base64: buf.toString('base64'), mimeType };
}

async function main() {
  const [avatarImage, productImage] = await Promise.all([toBase64(avatarPath), toBase64(productPath)]);

  const ai = new GoogleGenAI({
    vertexai: true,
    project: firebaseAppletConfig.projectId,
    location: 'us-central1',
  });

  console.log('Chamando ai.models.generateVideos com 2 reference images (ASSET) + generateAudio: true...');
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-001',
    prompt: [
      'Cena: cozinha iluminada por luz natural.',
      'A pessoa da imagem de referência olha diretamente para a câmera e diz, em português do Brasil, com sincronia labial:',
      '"Gente, olha que produto incrível eu encontrei!"',
      'Formato vertical 9:16, estilo UGC autêntico (câmera na mão), iluminação natural.',
      'FIDELIDADE OBRIGATÓRIA: a pessoa deve ser idêntica à imagem de referência de pessoa; o produto deve ser idêntico à imagem de referência de produto.',
    ].join('\n'),
    config: {
      numberOfVideos: 1,
      durationSeconds: 8,
      aspectRatio: '9:16',
      personGeneration: 'allow_adult',
      generateAudio: true,
      referenceImages: [
        { image: { imageBytes: avatarImage.base64, mimeType: avatarImage.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
        { image: { imageBytes: productImage.base64, mimeType: productImage.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
      ],
    },
  });

  console.log('Operação iniciada, aguardando conclusão (2-5 min)...');
  while (!operation.done) {
    await new Promise((r) => setTimeout(r, 15000));
    operation = await ai.operations.getVideosOperation({ operation });
    console.log('  ainda processando...');
  }

  if (operation.error) {
    console.error('FALHA — Veo retornou erro:', operation.error);
    process.exit(1);
  }

  const videoBytes = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
  if (!videoBytes) {
    console.error('FALHA — Veo não retornou bytes de vídeo. Resposta completa:', JSON.stringify(operation.response, null, 2));
    process.exit(1);
  }

  const outPath = 'scripts/.spike-ugc-output.mp4';
  await fs.writeFile(outPath, Buffer.from(videoBytes, 'base64'));
  console.log(`\nOK — vídeo salvo em ${outPath}.`);
  console.log('Assista o arquivo e responda manualmente:');
  console.log('  1. O avatar (pessoa) está reconhecível/fiel à foto de referência?');
  console.log('  2. O produto está reconhecível/fiel à foto de referência?');
  console.log('  3. Há áudio no vídeo?');
  console.log('  4. A fala está em português e os lábios acompanham o áudio (lip sync)?');
}

main().catch((err) => {
  console.error('FALHA —', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against two real photos**

Get any product photo already in the app's uploads (or any product photo on disk) and any photo of a person (a stock/team photo is fine for this spike — it is never persisted or shipped). Run:

```bash
npx tsx scripts/spike-ugc-veo.mjs /path/to/person.jpg /path/to/product.jpg
```

Wait for it to finish (2-5 min) and watch `scripts/.spike-ugc-output.mp4`.

- [ ] **Step 3: Record the go/no-go decision**

Answer the 4 questions the script prints, by watching the output video:

- **All 4 pass** → the design in the spec holds. Continue to Task 2.
- **Any fail** → **STOP.** Do not proceed to Task 2. Re-open brainstorming with the spec's "Riscos e mitigação" section (fallback: prioritize the avatar reference over the product reference, or drop `generateAudio: true` and fall back to TTS + closed-mouth avatar) and get a revised design approved before writing any more code.

- [ ] **Step 4: Delete the spike output, keep the script**

```bash
rm -f scripts/.spike-ugc-output.mp4
git add scripts/spike-ugc-veo.mjs
git commit -m "chore(video): spike script validating Veo dual-reference + native audio"
```

---

### Task 2: Data model — Product fields, Avatar type, credit actions

**Files:**
- Modify: `src/types/models.ts`
- Modify: `src/credits.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Product._ugcVideoScript/_ugcVideoJobId/_ugcVideoStatus/_ugcVideoUrl/_ugcAvatarId/_ugcVideoError`; `Avatar` interface; `CREDIT_ACTIONS.avatarCreation` (`avatar_creation`), `CREDIT_ACTIONS.ugcVideoGeneration` (`video_ugc_generation`); `DEFAULT_CREDIT_COSTS.avatar_creation = 1`, `DEFAULT_CREDIT_COSTS.video_ugc_generation = 8`. All later tasks reference these exact names.

- [ ] **Step 1: Add the `Avatar` type and `Product` fields**

In `src/types/models.ts`, add near the other standalone interfaces (e.g. next to `Category`):

```ts
export interface Avatar {
  id: string;
  nome: string;
  descricao: string;
  referenceImageUrl: string;
  createdAt: string;
}
```

Then, in the `Product` interface, right after the existing `_videoError?: string;` line (currently `src/types/models.ts:145`), add:

```ts
  _ugcVideoScript?: import('../services/ugcVideoService').UgcVideoScript;
  _ugcVideoJobId?: string;
  _ugcVideoStatus?: 'idle' | 'generating_script' | 'script_ready' | 'queued' | 'processing' | 'done' | 'error';
  _ugcVideoUrl?: string;
  _ugcAvatarId?: string;
  _ugcVideoError?: string;
```

(This import path won't resolve until Task 6 creates `src/services/ugcVideoService.ts` — that's fine, TypeScript resolves `import(...)` types lazily and `tsc --noEmit` in this task will still pass since the file doesn't exist yet only as a *type-only* reference used nowhere until Task 6. If `npm run lint` complains at this step, replace the import-type line temporarily with `_ugcVideoScript?: unknown;` and revisit it in Task 6 — see Task 6 Step 1.)

- [ ] **Step 2: Add the two new credit actions**

In `src/credits.ts`, inside `CREDIT_ACTIONS` (after the existing `videoGeneration` entry):

```ts
  videoGeneration: { key: 'video_generation', label: 'Geração de Vídeo de Produto' },
  avatarCreation: { key: 'avatar_creation', label: 'Criação de Avatar' },
  ugcVideoGeneration: { key: 'video_ugc_generation', label: 'Geração de Vídeo UGC com Avatar' },
```

And inside `DEFAULT_CREDIT_COSTS` (after `video_generation: 5,`):

```ts
  video_generation: 5,
  avatar_creation: 1,
  video_ugc_generation: 8,
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors. If the `_ugcVideoScript` import-type line fails because the module truly doesn't exist yet, use the `unknown` fallback noted in Step 1 and continue — Task 6 will replace it with the real import once `ugcVideoService.ts` exists.

- [ ] **Step 4: Commit**

```bash
git add src/types/models.ts src/credits.ts
git commit -m "feat(video): add UGC avatar data model and credit actions"
```

---

### Task 3: Extract shared server video helpers (`server/videoShared.ts`)

**Files:**
- Create: `server/videoShared.ts`
- Modify: `server/videoAgent.ts` (remove now-duplicated code, import from the new file)

**Interfaces:**
- Consumes: nothing new (pure refactor of existing `videoAgent.ts` internals).
- Produces (all named exports of `server/videoShared.ts`, used by Task 7's `ugcVideoAgent.ts`): `STORAGE_BUCKET`, `GCP_PROJECT`, `VEO_MODEL`, `TEXT_MODEL`, `VIDEO_ASPECT_RATIO`, `REFERENCE_MAX_DIM`, `VideoGenerationReferenceType`, `getGeminiClient()`, `getVeoClient()`, `now()`, `sendError(res, err)`, `fetchImageAsBase64(url)`, `resizeForReference(buf)`, `runFfmpeg(args)`, `runVeoOperation(ai, jobId, label, request)`, `formatAttributes(attributes)`, `debitCreditsAdmin(uid, action, meta)`, `refundCreditsAdmin(uid, cost, meta, refund?)`.

This is a **mechanical, behavior-preserving** extraction — no logic changes, just moving code and updating imports. The risk is purely "did I break the classic video flow," checked explicitly in Step 4.

- [ ] **Step 1: Create `server/videoShared.ts`**

```ts
// server/videoShared.ts
//
// Generic server-side video helpers shared between the classic video
// pipeline (server/videoAgent.ts) and the UGC pipeline (server/ugcVideoAgent.ts):
// Veo/Gemini clients, retry/polling, ffmpeg spawning, reference-image prep,
// and the credit debit/refund transactions. Extracted from videoAgent.ts —
// no behavior change, see docs/superpowers/plans/2026-09-23-ugc-avatar-video.md Task 3.
import type express from 'express';
import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { adminDb } from './firebaseAdmin';
import { resolveCreditCost } from '../src/credits';
import type { CreditAction } from '../src/credits';
import { FieldValue } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';

export { VideoGenerationReferenceType };

export const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
export const GCP_PROJECT = firebaseAppletConfig.projectId;
export const VEO_MODEL = 'veo-3.1-fast-generate-001';
export const TEXT_MODEL = 'gemini-2.5-flash';
export const VIDEO_ASPECT_RATIO = '9:16';
export const REFERENCE_MAX_DIM = 1024;

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY não configurada'), { status: 500 });
  return new GoogleGenAI({ apiKey });
}

export function getVeoClient() {
  return new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location: 'us-central1',
  });
}

export function now() {
  return new Date().toISOString();
}

export function sendError(res: express.Response, err: unknown) {
  const status = (err as any)?.status ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

export async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao buscar imagem: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return { base64, mimeType };
}

export async function resizeForReference(inputBuffer: Buffer): Promise<{ base64: string; mimeType: string }> {
  const resized = await sharp(inputBuffer)
    .resize({ width: REFERENCE_MAX_DIM, height: REFERENCE_MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

export function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegPath) throw new Error('ffmpeg-static não encontrado');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export function formatAttributes(attributes: Record<string, string>): string {
  const entries = Object.entries(attributes ?? {}).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return '(nenhum atributo estruturado informado — extraia da descrição e da imagem)';
  return entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

const VEO_RETRYABLE_PATTERNS = /high load|high demand|try again|overload|quota/i;
const VEO_MAX_RETRIES = 3;
const VEO_RETRY_DELAYS = [30_000, 60_000, 120_000];

function isVeoRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return VEO_RETRYABLE_PATTERNS.test(msg);
}

export async function runVeoOperation(
  ai: GoogleGenAI,
  jobId: string,
  label: string,
  request: Parameters<GoogleGenAI['models']['generateVideos']>[0],
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= VEO_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = VEO_RETRY_DELAYS[attempt - 1];
      console.log(`[video] ${label} retry attempt=${attempt} after=${delay / 1000}s jobId=${jobId}`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      let operation = await ai.models.generateVideos(request);

      let pollCount = 0;
      while (!operation.done) {
        await new Promise((r) => setTimeout(r, 15000));
        operation = await ai.operations.getVideosOperation({ operation });
        pollCount++;
        console.log(`[video] polling jobId=${jobId} ${label} attempt=${pollCount} done=${operation.done}`);
      }

      if (operation.error) {
        throw new Error(String((operation.error as any).message ?? operation.error));
      }

      const videoBytes = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
      if (!videoBytes) throw new Error(`Veo não retornou bytes de vídeo (${label})`);
      console.log(`[video] ${label} done jobId=${jobId} polls=${pollCount}`);
      return videoBytes;
    } catch (err) {
      lastError = err;
      if (attempt < VEO_MAX_RETRIES && isVeoRetryable(err)) {
        console.warn(`[video] ${label} transient error, will retry (${attempt + 1}/${VEO_MAX_RETRIES}) jobId=${jobId}:`, (err as Error).message);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function debitCreditsAdmin(
  uid: string,
  action: CreditAction,
  meta: { productName?: string; userName?: string } = {},
): Promise<number> {
  const configSnap = await adminDb.collection('config').doc('credits').get();
  const costs: Record<string, number> = configSnap.exists ? (configSnap.data() as any) : {};
  const cost = resolveCreditCost(costs, action.key);

  const userRef = adminDb.collection('users').doc(uid);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current: number = snap.exists ? (snap.data()?.credits ?? 0) : 0;
    if (current < cost) throw Object.assign(new Error('Créditos insuficientes'), { status: 402 });
    const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();
    tx.update(userRef, { credits: FieldValue.increment(-cost) });
    tx.set(logRef, {
      actionType: action.label,
      actionKey: action.key,
      productName: meta.productName || 'N/A',
      sku: 'N/A',
      userName: meta.userName ?? '',
      creditsConsumed: cost,
      timestamp: new Date().toISOString(),
    });
    return cost;
  });
}

export async function refundCreditsAdmin(
  uid: string,
  cost: number,
  meta: { productName?: string; userName?: string } = {},
  refund: { label: string; actionKey: string } = { label: 'Estorno — Geração de Vídeo', actionKey: 'video_generation_refund' },
): Promise<void> {
  const userRef = adminDb.collection('users').doc(uid);
  const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();
  await adminDb.runTransaction(async (tx) => {
    tx.update(userRef, { credits: FieldValue.increment(cost) });
    tx.set(logRef, {
      type: 'bonus',
      actionType: refund.label,
      actionKey: refund.actionKey,
      productName: meta.productName || 'N/A',
      sku: 'N/A',
      userName: meta.userName ?? '',
      creditsConsumed: 0,
      creditsAdded: cost,
      timestamp: new Date().toISOString(),
    });
  });
}
```

- [ ] **Step 2: Trim `server/videoAgent.ts` down to its classic-only logic**

Remove from `server/videoAgent.ts`: the `STORAGE_BUCKET`/`GCP_PROJECT`/`VEO_MODEL`/`TEXT_MODEL` constants (lines 16-19), `REFERENCE_MAX_DIM` (line 25), `getGeminiClient`/`getVeoClient` (lines 68-80), `now` (lines 82-84), `sendError` (lines 86-90), `fetchImageAsBase64` (lines 92-99), `resizeForReference` (lines 101-114), `runFfmpeg` (lines 120-132), `formatAttributes` (lines 351-355), the `VEO_RETRYABLE_PATTERNS`/`VEO_MAX_RETRIES`/`VEO_RETRY_DELAYS`/`isVeoRetryable`/`runVeoOperation` block (lines 438-497), `debitCreditsAdmin` (lines 299-326) and `refundCreditsAdmin` (lines 328-349).

Keep everything else (`VIDEO_ASPECT_RATIO` stays — re-export it from `videoShared` instead of redefining; `SHOTS`, `VideoScript`/`VideoScriptShot`/`VideoDeps` types, `assembleFinalVideo`, caption rendering, `synthesizeNarration`, `generateScript`, `runVideoJob`, `registerVideoRoutes`).

Replace the top of the file's imports (lines 1-14) with:

```ts
import type express from 'express';
import { VideoGenerationReferenceType } from '@google/genai';
import sharp from 'sharp';
import opentype from 'opentype.js';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS } from '../src/credits';
import { FieldValue } from 'firebase-admin/firestore';
import {
  STORAGE_BUCKET, GCP_PROJECT, VEO_MODEL, TEXT_MODEL, VIDEO_ASPECT_RATIO, REFERENCE_MAX_DIM,
  getGeminiClient, getVeoClient, now, sendError, fetchImageAsBase64, resizeForReference,
  runFfmpeg, runVeoOperation, formatAttributes, debitCreditsAdmin, refundCreditsAdmin,
} from './videoShared';
```

(`sharp` and `spawn` are still used by `renderCaptionPng`/`assembleFinalVideo` in this file, so they stay imported here too, alongside the shared module.)

At every call site in `videoAgent.ts` that referenced `VideoGenerationReferenceType` directly (the `referenceImages` array inside `generateShot`), the import above already covers it. `refundCreditsAdmin(uid, creditCost, meta)` call sites need no change — the new default 4th parameter reproduces today's exact labels.

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors, no unused-import warnings.

- [ ] **Step 4: Manual regression check on the classic flow (no paid Veo call needed)**

```bash
npm run dev
```

Open the app, edit a product that already has a description, an SEO title, and at least one ambient image. Open its "Vídeo" tab. Confirm:
- The prerequisites stage still renders with the 3 checkmarks.
- Clicking "Próximo: Escolher Imagem" still shows the 4 shot thumbnails.
- Clicking "Gerar Roteiro com IA" still calls `/api/video/generate-script` and returns a script (this only hits the Gemini text call, not Veo — cheap and fast, and enough to prove `videoShared.ts`'s `getGeminiClient`/`fetchImageAsBase64`/`formatAttributes` still work through the new import path).

Do **not** click "Aprovar e Gerar Vídeo" in this step — a full Veo run is unnecessary to prove this refactor is behavior-preserving and costs real credits/time.

- [ ] **Step 5: Commit**

```bash
git add server/videoShared.ts server/videoAgent.ts
git commit -m "refactor(video): extract shared Veo/ffmpeg/credit helpers into videoShared.ts"
```

---

### Task 4: Avatar generation & persistence (client-side)

**Files:**
- Modify: `src/services/aiService.ts` (add `generateImageFromText`)
- Create: `src/services/avatarService.ts`
- Modify: `firestore.rules` (add `avatars/{avatarId}` collection rule)
- Test: `scripts/verify-avatar-service.mjs`

**Interfaces:**
- Consumes: `Avatar` type from `src/types/models.ts` (Task 2).
- Produces: `generateImageFromText(prompt, aspectRatio?)` in `aiService.ts`; `getAvatarsPath(uid)`, `buildAvatarDoc(input, id, existingCreatedAt?)`, `buildAvatarPortraitPrompt(descricao)`, `generateAvatarPortrait(descricao)`, `uploadAvatarImage(uid, dataUrl, avatarId)`, `saveAvatar(uid, input, id?)`, `listAvatars(uid)`, `deleteAvatar(uid, avatarId)` in `avatarService.ts`. Task 5's `AvatarLibrary.tsx` consumes all of `avatarService.ts`'s exports.

- [ ] **Step 1: Write the failing verify script**

```js
// scripts/verify-avatar-service.mjs
//
// Verificação da lógica pura de persistência de avatar
// (src/services/avatarService.ts). Não toca o Firestore.
// Rodar com: npx tsx scripts/verify-avatar-service.mjs
import { getAvatarsPath, buildAvatarDoc, buildAvatarPortraitPrompt } from '../src/services/avatarService.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('path da coleção é por uid', getAvatarsPath('abc123'), 'users/abc123/avatars');

const doc1 = buildAvatarDoc({ nome: 'Ana', descricao: 'jovem casual', referenceImageUrl: 'https://x/y.jpg' }, 'id1');
check('doc novo tem id', doc1.id, 'id1');
check('doc novo tem createdAt string', typeof doc1.createdAt, 'string');
check('doc novo não tem chaves undefined', Object.values(doc1).some((v) => v === undefined), false);

const doc2 = buildAvatarDoc({ nome: 'Ana', descricao: 'jovem casual', referenceImageUrl: undefined }, 'id1', '2026-01-01T00:00:00.000Z');
check('createdAt existente é preservado (update, não create)', doc2.createdAt, '2026-01-01T00:00:00.000Z');
check('chave undefined é removida antes de gravar', 'referenceImageUrl' in doc2, false);

const prompt = buildAvatarPortraitPrompt('mulher jovem, 25 anos, estilo casual');
check('prompt de retrato inclui a descrição fornecida', prompt.includes('mulher jovem, 25 anos, estilo casual'), true);
check('prompt pede fundo neutro', prompt.includes('Fundo neutro'), true);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-avatar-service.mjs`
Expected: FAIL — `Cannot find module '../src/services/avatarService.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Add `generateImageFromText` to `aiService.ts`**

In `src/services/aiService.ts`, right after the existing `generateImage` function (after line 244), add:

```ts
// Generates an image purely from a text prompt (no input image) — used for avatar
// portraits. Mirrors generateImage() but omits the inlineData part: gemini-2.5-flash-image
// also supports text-to-image generation, not just image editing.
export async function generateImageFromText(prompt: string, aspectRatio: string = '3:4'): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: IMAGE_MODEL,
    generationConfig: {
      responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE],
    },
    safetySettings: IMAGE_SAFETY_SETTINGS,
  });

  const result = await withRetry(() => model.generateContent([{ text: prompt }] as any));

  const imageData = extractImage(result);
  if (!imageData) throw new Error('O modelo não retornou uma imagem. Tente novamente.');
  const raw = `data:image/png;base64,${imageData}`;

  if (aspectRatio === '1:1') return reencodeAsJpeg(raw);
  return cropToAspectRatio(raw, aspectRatio);
}
```

- [ ] **Step 4: Create `src/services/avatarService.ts`**

```ts
// src/services/avatarService.ts
//
// Per-user avatar library: text description → generated portrait (client-side,
// Firebase AI Logic) → persisted in users/{uid}/avatars for reuse across UGC
// videos. Follows the same collection-access pattern as categoryService.ts
// (path helper + getDocs/setDoc, not the looser addDoc used in App.tsx).
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Avatar } from '../types/models';
import { generateImageFromText } from './aiService';

export const getAvatarsPath = (uid: string) => `users/${uid}/avatars`;

// Builds the Firestore document for an avatar, stripping `undefined` values
// (Firestore's setDoc rejects them — this db isn't configured with
// ignoreUndefinedProperties) and preserving createdAt across updates.
export function buildAvatarDoc(
  input: { nome: string; descricao: string; referenceImageUrl?: string },
  id: string,
  existingCreatedAt?: string,
): Avatar {
  const data: any = {
    ...input,
    id,
    createdAt: existingCreatedAt ?? new Date().toISOString(),
  };
  Object.keys(data).forEach((key) => {
    if (data[key] === undefined) delete data[key];
  });
  return data as Avatar;
}

export function buildAvatarPortraitPrompt(descricao: string): string {
  return `Retrato fotográfico realista de uma pessoa para uso como avatar em vídeos de UGC (conteúdo gerado por usuário).

Características da pessoa: ${descricao}

Enquadramento: plano americano (da cintura para cima), olhando diretamente para a câmera, expressão natural e simpática.
Fundo neutro e desfocado, iluminação suave de estúdio. Foto realista, alta qualidade, sem texto, sem marca d'água, sem elementos artificiais.`;
}

// Returns a data URL — nothing is persisted yet. Mirrors generateImage()/
// runGenerateAmbient() in ImageSearchModal.tsx, which only upload on save.
export async function generateAvatarPortrait(descricao: string): Promise<string> {
  return generateImageFromText(buildAvatarPortraitPrompt(descricao), '3:4');
}

// Uploads the generated data URL to Firebase Storage. Same pattern as
// uploadImage() in ImageSearchModal.tsx:270.
export async function uploadAvatarImage(uid: string, dataUrl: string, avatarId: string): Promise<string> {
  const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  const path = `users/${uid}/avatar-images/${avatarId}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadString(storageRef, dataUrl, 'data_url');
  return `https://storage.googleapis.com/${storageRef.bucket}/${storageRef.fullPath}`;
}

export async function saveAvatar(
  uid: string,
  input: { nome: string; descricao: string; referenceImageUrl: string },
  id?: string,
  existingCreatedAt?: string,
): Promise<Avatar> {
  const avatarRef = id ? doc(db, getAvatarsPath(uid), id) : doc(collection(db, getAvatarsPath(uid)));
  const data = buildAvatarDoc(input, avatarRef.id, existingCreatedAt);
  await setDoc(avatarRef, data, { merge: true });
  return data;
}

export async function listAvatars(uid: string): Promise<Avatar[]> {
  if (!uid) return [];
  const snapshot = await getDocs(collection(db, getAvatarsPath(uid)));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Avatar));
}

export async function deleteAvatar(uid: string, avatarId: string): Promise<void> {
  await deleteDoc(doc(db, getAvatarsPath(uid), avatarId));
}
```

- [ ] **Step 5: Run the verify script again**

Run: `npx tsx scripts/verify-avatar-service.mjs`
Expected: PASS — `Todas as verificações passaram.`

- [ ] **Step 6: Add the `avatars` collection rule to `firestore.rules`**

Add a new helper function near `isValidCategory()` (after line 104):

```
    function isValidAvatar() {
      let data = request.resource.data;
      return (!('id' in data) || data.id is string) &&
             (!('nome' in data) || data.nome is string) &&
             (!('descricao' in data) || data.descricao is string) &&
             (!('referenceImageUrl' in data) || data.referenceImageUrl is string) &&
             (!('createdAt' in data) || data.createdAt is string);
    }
```

Then add the collection rule right after the `categories` block (after line 245, before `match /products/{productId} {`):

```
      // Biblioteca de avatares por usuário para o vídeo UGC. 100% client-owned,
      // sem gestão de admin — mesmo padrão de categories.
      match /avatars/{avatarId} {
        allow read: if isOwner(userId);
        allow create: if isOwner(userId) && isValidAvatar();
        allow update: if isOwner(userId) && isValidAvatar();
        allow delete: if isOwner(userId);
      }
```

- [ ] **Step 7: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Deploy the updated Firestore rules**

```bash
firebase deploy --only firestore:rules
```

(If you don't have deploy access in this environment, flag this step for whoever does — `AvatarLibrary.tsx` in Task 5 cannot read/write avatars until the rules are live.)

- [ ] **Step 9: Commit**

```bash
git add src/services/aiService.ts src/services/avatarService.ts firestore.rules scripts/verify-avatar-service.mjs
git commit -m "feat(video): avatar portrait generation and Firestore persistence"
```

---

### Task 5: Avatar library UI (`AvatarLibrary.tsx`)

**Files:**
- Create: `src/components/modals/AvatarLibrary.tsx`

**Interfaces:**
- Consumes: `avatarService.{listAvatars, generateAvatarPortrait, uploadAvatarImage, saveAvatar}` (Task 4), `Avatar` type (Task 2).
- Produces: `AvatarLibrary` component with props `{ uid: string; selectedAvatarId?: string; onSelect: (avatar: Avatar) => void }`. Task 9's `UgcVideoGenerationTab.tsx` mounts this directly.

- [ ] **Step 1: Write the component**

```tsx
// src/components/modals/AvatarLibrary.tsx
import React, { useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, CheckCircle2, User, RefreshCw } from 'lucide-react';
import type { Avatar } from '../../types/models';
import { listAvatars, generateAvatarPortrait, uploadAvatarImage, saveAvatar } from '../../services/avatarService';

export interface AvatarLibraryProps {
  uid: string;
  selectedAvatarId?: string;
  onSelect: (avatar: Avatar) => void;
}

type FormState = { nome: string; descricao: string; previewDataUrl: string | null };

export default function AvatarLibrary({ uid, selectedAvatarId, onSelect }: AvatarLibraryProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>({ nome: '', descricao: '', previewDataUrl: null });
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAvatars(uid)
      .then((list) => { if (!cancelled) setAvatars(list); })
      .catch((err) => { if (!cancelled) setListError(err instanceof Error ? err.message : 'Erro ao carregar avatares'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  async function handleGeneratePreview() {
    if (!form.descricao.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const dataUrl = await generateAvatarPortrait(form.descricao);
      setForm((f) => ({ ...f, previewDataUrl: dataUrl }));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao gerar retrato do avatar');
    } finally {
      setGenerating(false);
    }
  }

  async function handleConfirmAvatar() {
    if (!form.previewDataUrl || !form.nome.trim()) return;
    setSaving(true);
    try {
      const tempId = crypto.randomUUID();
      const referenceImageUrl = await uploadAvatarImage(uid, form.previewDataUrl, tempId);
      const avatar = await saveAvatar(uid, { nome: form.nome.trim(), descricao: form.descricao.trim(), referenceImageUrl }, tempId);
      setAvatars((prev) => [...prev, avatar]);
      onSelect(avatar);
      setCreating(false);
      setForm({ nome: '', descricao: '', previewDataUrl: null });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao salvar avatar');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando avatares...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {listError && (
        <p className="text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {listError}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {avatars.map((avatar) => {
          const selected = avatar.id === selectedAvatarId;
          return (
            <button
              key={avatar.id}
              type="button"
              onClick={() => onSelect(avatar)}
              className={`rounded-xl border-2 overflow-hidden text-left transition-all ${selected ? 'border-violet-600 ring-2 ring-violet-200' : 'border-slate-200 hover:border-violet-300'}`}
            >
              <div className="relative aspect-[3/4] bg-slate-100">
                <img src={avatar.referenceImageUrl} alt={avatar.nome} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                {selected && (
                  <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </span>
                )}
              </div>
              <div className="px-2 py-2">
                <p className="text-xs font-bold text-slate-700 truncate">{avatar.nome}</p>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-xl border-2 border-dashed border-slate-300 hover:border-violet-400 aspect-[3/4] flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-violet-600 transition-all"
        >
          <Plus className="w-6 h-6" />
          <span className="text-xs font-bold">Criar avatar</span>
        </button>
      </div>

      {avatars.length === 0 && !creating && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <User className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Você ainda não tem nenhum avatar. Clique em "Criar avatar" para gerar o primeiro.</span>
        </div>
      )}

      {creating && (
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Novo avatar</h3>

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-800">Nome</label>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="Ex.: Ana — Jovem Casual"
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-800">Características</label>
            <p className="text-xs text-slate-400">Idade, gênero, etnia, estilo, tom — quanto mais específico, mais consistente o avatar fica entre vídeos.</p>
            <textarea
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value, previewDataUrl: null }))}
              rows={3}
              placeholder="Ex.: mulher, 28 anos, cabelo cacheado castanho, estilo casual descontraído, tom de voz animado"
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 resize-none outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            />
          </div>

          {genError && (
            <p className="text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {genError}
            </p>
          )}

          {form.previewDataUrl && (
            <div className="w-40 rounded-xl overflow-hidden border border-slate-200">
              <img src={form.previewDataUrl} alt="Preview do avatar" className="w-full aspect-[3/4] object-cover" />
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setCreating(false); setForm({ nome: '', descricao: '', previewDataUrl: null }); setGenError(null); }}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGeneratePreview}
              disabled={!form.descricao.trim() || generating}
              className="px-4 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 disabled:opacity-40 flex items-center gap-2"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {form.previewDataUrl ? 'Gerar novamente' : 'Gerar retrato'}
            </button>
            <button
              type="button"
              onClick={handleConfirmAvatar}
              disabled={!form.previewDataUrl || !form.nome.trim() || saving}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md disabled:opacity-40 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Confirmar avatar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

This directly covers this plan's first Review Focus item: `genError` is shown inline in the create form (both a blocked/no-image generation and a failed save surface here), and the form stays open and usable for retry — nothing crashes or gets stuck.

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual QA**

```bash
npm run dev
```

Since `AvatarLibrary` isn't mounted anywhere yet (that's Task 9), do a quick standalone smoke check: temporarily render `<AvatarLibrary uid={uid} onSelect={(a) => console.log(a)} />` inside any already-open modal in the running app (e.g. paste it at the top of `VideoGenerationTab.tsx`'s `prereqs` stage return JSX), confirm:
- Empty state renders ("Você ainda não tem nenhum avatar").
- "Criar avatar" opens the form; typing a description and clicking "Gerar retrato" shows a preview image after the call completes.
- "Confirmar avatar" saves it, the form closes, and the new avatar appears selected in the grid.
- Reloading the page and reopening still lists the saved avatar (proves the Firestore rule from Task 4 works).

Remove the temporary test render afterwards — do not commit it.

- [ ] **Step 4: Commit**

```bash
git add src/components/modals/AvatarLibrary.tsx
git commit -m "feat(video): avatar library UI (gallery + create form)"
```

---

### Task 6: UGC script generation (server prompt + route, client service)

**Files:**
- Create: `server/ugcVideoAgent.ts`
- Create: `src/services/ugcVideoService.ts`
- Test: `scripts/verify-ugc-video-script.mjs`
- Modify: `src/types/models.ts` (replace the `unknown` fallback from Task 2, if used, with the real import)

**Interfaces:**
- Consumes: `videoShared.{getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError}` (Task 3).
- Produces: server-side `UgcVideoClip`, `UgcVideoScript`, `buildUgcScriptPrompt(params)`, `validateUgcScript(parsed)`, `generateUgcScript(params, productImageBase64, productImageMimeType, avatarImageBase64, avatarImageMimeType)`, `registerUgcVideoRoutes(app, deps)` (with only `/api/video/ugc/generate-script` registered so far — Task 7 adds the second route to the same function). Client-side `UgcVideoClip`, `UgcVideoScript`, `UgcVideoJobStatus`, `UgcVideoJobStep`, `UgcVideoJob`, `generateUgcVideoScript(idToken, params)`, `startUgcVideoJob(idToken, params)` (implemented now, has no live backend until Task 7 — that's fine, it only needs to typecheck), `listenUgcVideoJob(uid, jobId, cb)`, `computeUgcVideoProgress(job)`. Task 9's UI consumes all of the client service's exports.

- [ ] **Step 1: Write the failing verify script**

```js
// scripts/verify-ugc-video-script.mjs
//
// Verificação da lógica pura de roteiro UGC (server/ugcVideoAgent.ts).
// Não chama Gemini nem sobe servidor.
// Rodar com: npx tsx scripts/verify-ugc-video-script.mjs
import { buildUgcScriptPrompt, validateUgcScript } from '../server/ugcVideoAgent.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const prompt = buildUgcScriptPrompt({
  description: 'Fone de ouvido bluetooth com cancelamento de ruído',
  brand: 'Acme',
  productName: 'Fone XPTO',
  category: 'Eletrônicos',
  attributes: { Cor: 'Preto', Bateria: '20h' },
  avatarDescricao: 'Mulher jovem, 25 anos, estilo casual',
});
check('prompt inclui a descrição do avatar', prompt.includes('Mulher jovem, 25 anos, estilo casual'), true);
check('prompt inclui o nome do produto', prompt.includes('Fone XPTO'), true);
check('prompt pede de 2 a 3 clipes', prompt.includes('2 a 3 clipes'), true);

check('script válido com 2 clipes', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'Olha isso', acaoVisual: 'segura o produto' },
    { papel: 'demonstracao', fala: 'Muito bom', acaoVisual: 'usa o produto' },
  ],
}), true);

check('script válido com 3 clipes', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
    { papel: 'cta', fala: 'a', acaoVisual: 'b' },
  ],
}), true);

check('rejeita com 1 clipe só', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [{ papel: 'gancho', fala: 'a', acaoVisual: 'b' }],
}), false);

check('rejeita com 4 clipes', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
    { papel: 'cta', fala: 'a', acaoVisual: 'b' },
    { papel: 'cta', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

check('rejeita papel inválido', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'introducao', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

check('rejeita fala vazia', validateUgcScript({
  cena: 'sala',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: '', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

check('rejeita sem cena', validateUgcScript({
  cena: '',
  avatarDescricao: 'x',
  clipes: [
    { papel: 'gancho', fala: 'a', acaoVisual: 'b' },
    { papel: 'demonstracao', fala: 'a', acaoVisual: 'b' },
  ],
}), false);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-ugc-video-script.mjs`
Expected: FAIL — `Cannot find module '../server/ugcVideoAgent.ts'`.

- [ ] **Step 3: Create `server/ugcVideoAgent.ts` with the script-generation slice**

```ts
// server/ugcVideoAgent.ts
//
// UGC ("user-generated content") video pipeline: a user-created avatar speaks
// to camera and interacts with the product, instead of the classic pipeline's
// muted hands + voice-over. Mirrors server/videoAgent.ts's shape, reusing the
// generic Veo/ffmpeg/credit helpers from server/videoShared.ts.
// See docs/superpowers/specs/2026-09-23-ugc-avatar-video-design.md.
import type express from 'express';
import {
  getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError,
} from './videoShared';

export interface UgcVideoClip {
  papel: 'gancho' | 'demonstracao' | 'cta';
  fala: string;
  acaoVisual: string;
}

export interface UgcVideoScript {
  cena: string;
  avatarDescricao: string;
  clipes: UgcVideoClip[];
}

interface VideoDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<import('firebase-admin/auth').DecodedIdToken>;
}

const UGC_ROLES = ['gancho', 'demonstracao', 'cta'] as const;

export function validateUgcScript(parsed: any): parsed is UgcVideoScript {
  if (!parsed || typeof parsed.cena !== 'string' || !parsed.cena.trim()) return false;
  if (typeof parsed.avatarDescricao !== 'string') return false;
  if (!Array.isArray(parsed.clipes) || parsed.clipes.length < 2 || parsed.clipes.length > 3) return false;
  return parsed.clipes.every((c: any) =>
    c &&
    (UGC_ROLES as readonly string[]).includes(c.papel) &&
    typeof c.fala === 'string' && c.fala.trim() &&
    typeof c.acaoVisual === 'string' && c.acaoVisual.trim());
}

export function buildUgcScriptPrompt(params: {
  description: string;
  brand: string;
  productName: string;
  category: string;
  attributes: Record<string, string>;
  avatarDescricao: string;
}): string {
  const { description, brand, productName, category, attributes, avatarDescricao } = params;

  return `Você é um roteirista de vídeos UGC (User Generated Content) para redes sociais e páginas de produto.

Crie um roteiro de vídeo VERTICAL (9:16) em que um AVATAR (uma pessoa) aparece falando diretamente para a câmera, interagindo com o produto — no estilo de um vídeo de influenciador real, não uma peça publicitária de estúdio.

**Avatar (a pessoa que vai aparecer no vídeo):**
${avatarDescricao}

**Informações do produto:**
${productName ? `Nome: ${productName}\n` : ''}${category ? `Categoria: ${category}\n` : ''}${brand ? `Marca: ${brand}\n` : ''}Descrição: ${description}

**Atributos do produto (use no máximo 1 a 2 dos mais relevantes):**
${formatAttributes(attributes)}

**REGRAS OBRIGATÓRIAS:**
- Formato VERTICAL (9:16), estilo UGC autêntico (câmera na mão ou tripé caseiro, iluminação natural, estética espontânea — não é produção de estúdio comercial).
- O AVATAR aparece em quadro, olha e fala DIRETAMENTE para a câmera, segurando/usando o produto.
- Gere de 2 a 3 clipes de ~8s cada, nos papéis, NESTA ORDEM:
  1) "gancho": primeiros segundos, prende atenção — o avatar reage ao produto ou faz uma pergunta/afirmação chamativa.
  2) "demonstracao": o avatar usa/mostra o produto, citando 1 a 2 atributos reais (nunca invente características).
  3) "cta" (opcional, só inclua se o roteiro tiver 3 clipes): fechamento com chamada para ação.
- "fala": o que o avatar diz, em português do Brasil, tom espontâneo e conversacional (nunca comercial engessado), no máximo ~20 palavras (cabe em ~8s falado).
- "acaoVisual": o que acontece na cena além da fala (gestos, ângulo de câmera, manipulação do produto).
- Nunca invente atributos que não estejam na lista de atributos ou na descrição.

**CAMPOS (responda em pt-BR):**
- cena: ambientação coerente entre os clipes (ex.: "quarto iluminado, luz natural de janela") (máx. 120 caracteres).
- avatarDescricao: repita a descrição do avatar fornecida acima, sem alterações.
- clipes: array de 2 a 3 objetos, cada um com "papel", "fala" e "acaoVisual".

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem texto extra):
{
  "cena": "...",
  "avatarDescricao": "...",
  "clipes": [
    { "papel": "gancho", "fala": "...", "acaoVisual": "..." },
    { "papel": "demonstracao", "fala": "...", "acaoVisual": "..." }
  ]
}`;
}

export async function generateUgcScript(
  params: {
    description: string;
    brand: string;
    productName: string;
    category: string;
    attributes: Record<string, string>;
    avatarDescricao: string;
  },
  productImageBase64: string,
  productImageMimeType: string,
  avatarImageBase64: string,
  avatarImageMimeType: string,
): Promise<UgcVideoScript> {
  const ai = getGeminiClient();
  const prompt = buildUgcScriptPrompt(params);

  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: avatarImageMimeType, data: avatarImageBase64 } },
          { inlineData: { mimeType: productImageMimeType, data: productImageBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const text = result.text?.trim() ?? '{}';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!validateUgcScript(parsed)) {
    throw new Error('Roteiro UGC gerado inválido — campos obrigatórios ausentes');
  }
  return parsed;
}

export function registerUgcVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/ugc/generate-script', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const {
        description, brand, productImageUrl, avatarImageUrl, avatarDescricao, productName, category, attributes,
      } = req.body as {
        description: string;
        brand?: string;
        productImageUrl: string;
        avatarImageUrl: string;
        avatarDescricao: string;
        productName?: string;
        category?: string;
        attributes?: Record<string, string>;
      };
      if (!description || !productImageUrl || !avatarImageUrl || !avatarDescricao) {
        return res.status(400).json({ error: 'description, productImageUrl, avatarImageUrl e avatarDescricao são obrigatórios' });
      }
      const [productImage, avatarImage] = await Promise.all([
        fetchImageAsBase64(productImageUrl),
        fetchImageAsBase64(avatarImageUrl),
      ]);
      const script = await generateUgcScript(
        {
          description,
          brand: brand ?? '',
          productName: productName ?? '',
          category: category ?? '',
          attributes: attributes ?? {},
          avatarDescricao,
        },
        productImage.base64,
        productImage.mimeType,
        avatarImage.base64,
        avatarImage.mimeType,
      );
      res.json({ script });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Task 7 adds `app.post('/api/video/ugc/start-job', ...)` to this same function.
}
```

- [ ] **Step 4: Run the verify script again**

Run: `npx tsx scripts/verify-ugc-video-script.mjs`
Expected: PASS — `Todas as verificações passaram.`

- [ ] **Step 5: Create `src/services/ugcVideoService.ts`**

```ts
// src/services/ugcVideoService.ts
//
// Client contract for the UGC video pipeline — mirrors src/services/videoService.ts.
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';

export interface UgcVideoClip {
  papel: 'gancho' | 'demonstracao' | 'cta';
  fala: string;
  acaoVisual: string;
}

export interface UgcVideoScript {
  cena: string;
  avatarDescricao: string;
  clipes: UgcVideoClip[]; // 2 a 3 itens
}

export type UgcVideoJobStatus = 'queued' | 'processing' | 'done' | 'error';
export type UgcVideoJobStep = 'clip' | 'post' | 'uploading';

export interface UgcVideoJob {
  jobId: string;
  productId: string;
  status: UgcVideoJobStatus;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  clipsDone?: number;
  totalClips?: number;
  step?: UgcVideoJobStep;
}

export async function generateUgcVideoScript(
  idToken: string,
  params: {
    description: string;
    brand?: string;
    productImageUrl: string;
    avatarImageUrl: string;
    avatarDescricao: string;
    productName?: string;
    category?: string;
    attributes?: Record<string, string>;
  },
): Promise<UgcVideoScript> {
  const res = await fetch('/api/video/ugc/generate-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return (data as any).script as UgcVideoScript;
}

export async function startUgcVideoJob(
  idToken: string,
  params: { productId: string; productName: string; script: UgcVideoScript; avatarImageUrl: string; productImageUrl: string },
): Promise<string> {
  const res = await fetch('/api/video/ugc/start-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Erro ${res.status}`);
  }
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const data = JSON.parse(new TextDecoder().decode(value ?? new Uint8Array()));
  return (data as any).jobId as string;
}

export function listenUgcVideoJob(uid: string, jobId: string, cb: (job: UgcVideoJob) => void): () => void {
  return onSnapshot(doc(db, 'users', uid, 'ugcVideoJobs', jobId), (snap) => {
    if (snap.exists()) cb(snap.data() as UgcVideoJob);
  });
}

// Pure progress-bar calculation — mirrors computeVideoProgress() in VideoGenerationTab.tsx.
export function computeUgcVideoProgress(job: UgcVideoJob | null): { pct: number; label: string } {
  if (!job || job.status === 'queued') return { pct: 2, label: 'Aguardando na fila...' };
  if (job.status === 'done') return { pct: 100, label: 'Concluído!' };

  const step = job.step;
  const total = job.totalClips ?? 3;
  const done = job.clipsDone ?? 0;

  if (!step || step === 'clip') {
    const pct = Math.min(5 + Math.round((done / total) * 80), 85);
    return { pct, label: `${done} de ${total} clipes prontos — aguarde 2 a 4 min` };
  }
  if (step === 'post') return { pct: 90, label: 'Montando vídeo final...' };
  return { pct: 96, label: 'Enviando vídeo...' };
}
```

- [ ] **Step 6: Fix the `Product._ugcVideoScript` type in `src/types/models.ts`**

If Task 2 used the `_ugcVideoScript?: unknown;` fallback, replace it now with:

```ts
  _ugcVideoScript?: import('../services/ugcVideoService').UgcVideoScript;
```

- [ ] **Step 7: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add server/ugcVideoAgent.ts src/services/ugcVideoService.ts src/types/models.ts scripts/verify-ugc-video-script.mjs
git commit -m "feat(video): UGC script generation (server prompt + route, client service)"
```

---

### Task 7: UGC video generation pipeline (Veo, ffmpeg, credits)

**Files:**
- Modify: `server/ugcVideoAgent.ts` (add `generateUgcClip`, `concatClips`, `runUgcVideoJob`, and the `/api/video/ugc/start-job` route)
- Modify: `server.ts` (register the routes)
- Modify: `firestore.rules` (add `ugcVideoJobs/{jobId}` collection rule)

**Interfaces:**
- Consumes: `videoShared.{VEO_MODEL, VIDEO_ASPECT_RATIO, VideoGenerationReferenceType, getVeoClient, resizeForReference, runVeoOperation, runFfmpeg, debitCreditsAdmin, refundCreditsAdmin, now, sendError}` (Task 3), `UgcVideoScript`/`UgcVideoClip`/`validateUgcScript` (Task 6, same file), `CREDIT_ACTIONS.ugcVideoGeneration` (Task 2).
- Produces: nothing new consumed by later tasks (this is the terminal server piece) — but from here on `/api/video/ugc/start-job` is live, which is what `ugcVideoService.startUgcVideoJob` (already written in Task 6) actually calls.

- [ ] **Step 1: Add the per-clip Veo generation and ffmpeg concat to `server/ugcVideoAgent.ts`**

Add these imports at the top of `server/ugcVideoAgent.ts` (extending the ones from Task 6):

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS } from '../src/credits';
import {
  getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError,
  VEO_MODEL, VIDEO_ASPECT_RATIO, VideoGenerationReferenceType,
  getVeoClient, resizeForReference, runVeoOperation, runFfmpeg,
  debitCreditsAdmin, refundCreditsAdmin, now, STORAGE_BUCKET,
} from './videoShared';
import type { GoogleGenAI } from '@google/genai';
```

(Replace the single `import { getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError } from './videoShared';` line from Task 6 with the combined one above.)

Append, after `registerUgcVideoRoutes`'s opening (but before the closing `}` of the file):

```ts
const UGC_REFUND = { label: 'Estorno — Geração de Vídeo UGC', actionKey: 'video_ugc_generation_refund' };

async function generateUgcClip(
  ai: GoogleGenAI,
  jobId: string,
  jobRef: FirebaseFirestore.DocumentReference,
  index: number,
  clip: UgcVideoClip,
  cena: string,
  avatarImage: { base64: string; mimeType: string },
  productImage: { base64: string; mimeType: string },
  workDir: string,
): Promise<string> {
  const [avatarResized, productResized] = await Promise.all([
    resizeForReference(Buffer.from(avatarImage.base64, 'base64')),
    resizeForReference(Buffer.from(productImage.base64, 'base64')),
  ]);

  const styleLine = 'Formato: vertical 9:16, estilo UGC autêntico (câmera na mão ou tripé caseiro, iluminação natural, estética espontânea-realista, não é produção de estúdio comercial).';
  const rulesLine = 'O AVATAR aparece em quadro, olha diretamente para a câmera e FALA a fala abaixo em português do Brasil, com sincronia labial. Interage naturalmente com o produto enquanto fala.';
  const fidelityLine = 'FIDELIDADE OBRIGATÓRIA: o avatar deve ser IDÊNTICO à imagem de referência de pessoa (mesmo rosto, cabelo, tom de pele, roupa). O produto deve ser IDÊNTICO à imagem de referência de produto (mesmas cores, proporções, logotipo, materiais). Nunca redesenhe nenhum dos dois.';
  const negativePrompt = "avatar diferente da referência, rosto diferente, produto diferente da referência, cores alteradas, logotipo modificado, voz robótica, fala fora de sincronia, texto na tela, legendas, marca d'água, distorções, baixa qualidade";

  const prompt = [
    `Cena: ${cena}`,
    `Papel do clipe: ${clip.papel} (~8s)`,
    `Ação visual: ${clip.acaoVisual}`,
    `Fala do avatar (dita olhando para a câmera): "${clip.fala}"`,
    styleLine,
    rulesLine,
    fidelityLine,
  ].join('\n');

  console.log(`[ugc-video] clip ${index + 1} (${clip.papel}) generate jobId=${jobId}`);
  const videoBytes = await runVeoOperation(ai, jobId, `clip#${index + 1}`, {
    model: VEO_MODEL,
    prompt,
    config: {
      numberOfVideos: 1,
      durationSeconds: 8,
      aspectRatio: VIDEO_ASPECT_RATIO,
      personGeneration: 'allow_adult',
      generateAudio: true,
      negativePrompt,
      referenceImages: [
        { image: { imageBytes: avatarResized.base64, mimeType: avatarResized.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
        { image: { imageBytes: productResized.base64, mimeType: productResized.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
      ],
    },
  });

  const segPath = path.join(workDir, `clip${index}.mp4`);
  await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
  return segPath;
}

// Concatenates the clips with a re-encode (concat filter, not stream copy) —
// each clip is an independent Veo generation and may differ in timebase/SAR,
// same reasoning as assembleFinalVideo() in videoAgent.ts. Each clip keeps
// its own native audio track (the avatar's dialogue), so both video and
// audio streams are concatenated in order — no separate narration/music mix.
async function concatClips(segmentPaths: string[], outPath: string): Promise<void> {
  const inputs: string[] = [];
  segmentPaths.forEach((p) => { inputs.push('-i', p); });
  const filterParts = segmentPaths.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('');
  const filter = `${filterParts}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

  await runFfmpeg([
    '-y', ...inputs,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    outPath,
  ]);
}

async function runUgcVideoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: UgcVideoScript,
  avatarImage: { base64: string; mimeType: string },
  productImage: { base64: string; mimeType: string },
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('ugcVideoJobs').doc(jobId);
  console.log(`[ugc-video] runUgcVideoJob start uid=${uid} jobId=${jobId} productId=${productId}`);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `ugc-video-${jobId}-`));

  try {
    await jobRef.update({ status: 'processing', clipsDone: 0, totalClips: script.clipes.length, step: 'clip', updatedAt: now() });

    const ai = getVeoClient();
    let clipsDone = 0;
    const segmentPaths = await Promise.all(
      script.clipes.map(async (clip, i) => {
        const segPath = await generateUgcClip(ai, jobId, jobRef, i, clip, script.cena, avatarImage, productImage, workDir);
        clipsDone += 1;
        await jobRef.update({ clipsDone, updatedAt: now() });
        return segPath;
      }),
    );

    await jobRef.update({ step: 'post', updatedAt: now() });
    const finalPath = path.join(workDir, 'final.mp4');
    await concatClips(segmentPaths, finalPath);
    console.log(`[ugc-video] post-production done jobId=${jobId}`);

    await jobRef.update({ step: 'uploading', updatedAt: now() });

    const bucket = adminStorage.bucket(STORAGE_BUCKET);
    const storagePath = `product-videos/${uid}/${productId}/ugc_${jobId}.mp4`;
    const downloadToken = crypto.randomUUID();
    await bucket.upload(finalPath, {
      destination: storagePath,
      contentType: 'video/mp4',
      metadata: {
        cacheControl: 'public, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    const videoUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

    console.log(`[ugc-video] uploaded jobId=${jobId} url=${videoUrl}`);
    await jobRef.update({ status: 'done', videoUrl, updatedAt: now() });

    const productRef = adminDb.collection('users').doc(uid).collection('products').doc(productId);
    const prodSnap = await productRef.get();
    if (prodSnap.exists) {
      await productRef.update({ _ugcVideoUrl: videoUrl, _ugcVideoJobId: jobId, _ugcVideoStatus: 'done', updatedAt: now() });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ugc-video] runUgcVideoJob failed jobId=${jobId}:`, err);
    await jobRef.update({ status: 'error', error: message, updatedAt: now() }).catch(() => {});
    if (creditCost > 0) {
      await refundCreditsAdmin(uid, creditCost, meta, UGC_REFUND).catch((refundErr) => {
        console.error(`[ugc-video] refund failed uid=${uid} jobId=${jobId}:`, refundErr);
      });
      console.log(`[ugc-video] refunded ${creditCost} credits uid=${uid} jobId=${jobId}`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

Note that `generateUgcClip` itself does not touch `clipsDone` — the progress increment happens in the caller, `runUgcVideoJob` (via `clipsDone += 1; await jobRef.update(...)` after each clip's promise resolves, in Step 1's `runUgcVideoJob` above), because only the caller knows how many clips have finished across the whole `Promise.all`.

- [ ] **Step 2: Add the `/api/video/ugc/start-job` route**

Inside `registerUgcVideoRoutes`, right after the `/api/video/ugc/generate-script` handler (replacing the `// Task 7 adds ...` comment from Task 6), add:

```ts
  app.post('/api/video/ugc/start-job', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { productId, productName, script, avatarImageUrl, productImageUrl } = req.body as {
        productId: string;
        productName: string;
        script: UgcVideoScript;
        avatarImageUrl: string;
        productImageUrl: string;
      };
      if (!productId || !script || !avatarImageUrl || !productImageUrl) {
        return res.status(400).json({ error: 'productId, script, avatarImageUrl e productImageUrl são obrigatórios' });
      }
      if (!validateUgcScript(script)) {
        return res.status(400).json({ error: 'script inválido' });
      }

      const creditMeta = { productName, userName: decoded.name ?? decoded.email ?? '' };
      const creditCost = await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.ugcVideoGeneration, creditMeta);

      const jobRef = adminDb.collection('users').doc(decoded.uid).collection('ugcVideoJobs').doc();
      const jobId = jobRef.id;

      let avatarImage: { base64: string; mimeType: string };
      let productImage: { base64: string; mimeType: string };
      try {
        await jobRef.set({
          jobId, productId, status: 'queued', videoUrl: null, error: null, createdAt: now(), updatedAt: now(),
        });
        [avatarImage, productImage] = await Promise.all([
          fetchImageAsBase64(avatarImageUrl),
          fetchImageAsBase64(productImageUrl),
        ]);
      } catch (prepErr) {
        if (creditCost > 0) {
          await refundCreditsAdmin(decoded.uid, creditCost, creditMeta, UGC_REFUND).catch(() => {});
        }
        await jobRef.update({
          status: 'error',
          error: prepErr instanceof Error ? prepErr.message : String(prepErr),
          updatedAt: now(),
        }).catch(() => {});
        throw prepErr;
      }

      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ jobId }));

      try {
        await runUgcVideoJob(decoded.uid, jobId, productId, script, avatarImage, productImage, creditCost, creditMeta);
      } finally {
        res.end();
      }
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 3: Register the routes in `server.ts`**

Add the import near `import { registerVideoRoutes } from "./server/videoAgent";` (line 16):

```ts
import { registerUgcVideoRoutes } from "./server/ugcVideoAgent";
```

Add the call right after `registerVideoRoutes(app, { verifyFirebaseToken });` (line 148):

```ts
  registerUgcVideoRoutes(app, { verifyFirebaseToken });
```

- [ ] **Step 4: Add the `ugcVideoJobs` collection rule to `firestore.rules`**

Add right after the `videoJobs` block (after line 283):

```
      // UGC video generation jobs. Written server-side via Admin SDK; the
      // client only reads to track progress via onSnapshot. Mirrors videoJobs.
      match /ugcVideoJobs/{jobId} {
        allow read: if isOwner(userId);
        allow write: if false;
      }
```

- [ ] **Step 5: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Deploy the updated Firestore rules**

```bash
firebase deploy --only firestore:rules
```

- [ ] **Step 7: Manual smoke test of the full server pipeline**

This is the first point where a real Veo call happens through the app's own server code (not the Task 1 spike script), so it's worth running once in isolation before wiring any UI to it in Task 9.

```bash
npm run dev
```

With a valid Firebase ID token (grab one from the browser's devtools while logged into the running app — `auth.currentUser.getIdToken()` in the console) and two already-uploaded image URLs (an avatar portrait from Task 5's manual QA, and any product's `_selectedImage`), call the routes directly:

```bash
curl -X POST http://localhost:3000/api/video/ugc/generate-script \
  -H "Content-Type: application/json" -H "Authorization: Bearer $ID_TOKEN" \
  -d '{"description":"Fone de ouvido bluetooth","productImageUrl":"<product image URL>","avatarImageUrl":"<avatar image URL>","avatarDescricao":"mulher jovem, 25 anos, estilo casual","productName":"Fone XPTO"}'
```

Expect a JSON `{ "script": { "cena": ..., "clipes": [...] } }` with 2-3 clips. Then feed that `script` into:

```bash
curl -X POST http://localhost:3000/api/video/ugc/start-job \
  -H "Content-Type: application/json" -H "Authorization: Bearer $ID_TOKEN" \
  -d '{"productId":"<a real product id for this user>","productName":"Fone XPTO","script":<the script from above>,"avatarImageUrl":"<avatar image URL>","productImageUrl":"<product image URL>"}'
```

Watch the server logs (`[ugc-video] ...`) until it reaches `uploaded jobId=...`. Confirm in the Firebase console that `users/{uid}/ugcVideoJobs/{jobId}` reached `status: 'done'` with a `videoUrl`, that the product doc got `_ugcVideoUrl`/`_ugcVideoStatus: 'done'`, and that `users/{uid}/credit_logs` shows one `video_ugc_generation` debit and no refund. Play the resulting video URL and re-check the same 4 questions from Task 1's spike (now through the real pipeline, with the real script instead of the spike's hardcoded prompt).

- [ ] **Step 8: Commit**

```bash
git add server/ugcVideoAgent.ts server.ts firestore.rules
git commit -m "feat(video): UGC video generation pipeline (Veo dual-reference, native audio, ffmpeg concat)"
```

---

### Task 8: Extract shared video wizard UI pieces

**Files:**
- Create: `src/components/modals/videoWizardShared.tsx`
- Modify: `src/components/modals/VideoGenerationTab.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `cn(...)`, `PrereqItem({ ok, label, onFix, fixLabel })` exported from `videoWizardShared.tsx`. Task 9's `UgcVideoGenerationTab.tsx` imports both.

Only `cn` and `PrereqItem` are extracted — not the progress display. The two wizards' progress shapes differ (`shotsDone/totalShots` vs `clipsDone/totalClips`), and forcing a shared generic abstraction for a two-file, ~35-line duplication would be a premature abstraction; `UgcVideoGenerationTab.tsx` gets its own small progress component in Task 9.

- [ ] **Step 1: Create `src/components/modals/videoWizardShared.tsx`**

```tsx
// src/components/modals/videoWizardShared.tsx
//
// Pieces genuinely shared between VideoGenerationTab.tsx (classic) and
// UgcVideoGenerationTab.tsx (UGC avatar) — extracted verbatim, no behavior change.
import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');

export function PrereqItem({ ok, label, onFix, fixLabel }: {
  ok: boolean; label: string; onFix: () => void; fixLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
        <span className={cn('text-sm font-medium', ok ? 'text-slate-700' : 'text-slate-600')}>
          {label}
        </span>
      </div>
      {!ok && (
        <button
          type="button"
          onClick={onFix}
          className="shrink-0 text-xs font-bold text-violet-600 hover:text-violet-800 underline underline-offset-2 transition-colors"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove the duplicated definitions from `VideoGenerationTab.tsx`**

Delete the local `const cn = ...` (line 69) and the local `function PrereqItem(...)` (lines 601-625). Add to the top imports (near line 10):

```ts
import { cn, PrereqItem } from './videoWizardShared';
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual regression check**

```bash
npm run dev
```

Open a product's classic "Vídeo" tab again. Confirm the prerequisites checklist still renders identically (icons, "Ir para IA"/"Ir para Imagens" links still work) — this is a pure import swap, so this should be indistinguishable from before Task 3/Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/videoWizardShared.tsx src/components/modals/VideoGenerationTab.tsx
git commit -m "refactor(video): extract PrereqItem/cn into videoWizardShared.tsx"
```

---

### Task 9: UGC wizard (`UgcVideoGenerationTab.tsx`) + `ProductEditModal.tsx` wiring

**Files:**
- Create: `src/components/modals/UgcVideoGenerationTab.tsx`
- Modify: `src/components/modals/ProductEditModal.tsx`

**Interfaces:**
- Consumes: `AvatarLibrary` (Task 5), `videoWizardShared.{cn, PrereqItem}` (Task 8), `ugcVideoService.{generateUgcVideoScript, startUgcVideoJob, listenUgcVideoJob, computeUgcVideoProgress, UgcVideoScript, UgcVideoJob}` (Task 6), `Avatar`/`Product` types.
- Produces: `UgcVideoGenerationTab` component with props `{ product, uid, getIdToken, onUgcVideoGenerated, onUgcVideoJobStarted?, onNavigateToTab, activeVideoProductId? }`; `onUgcVideoJobStarted` signature is `(productId: string, jobId: string, avatarId: string) => void` (carries the avatar id so `App.tsx` can persist `_ugcAvatarId`, per Task 10). `ProductEditModal` gains a `videoMode` toggle and two new optional props: `onUgcVideoGenerated?`, `onUgcVideoJobStarted?` — both consumed by Task 10's `App.tsx` wiring.

- [ ] **Step 1: Write `UgcVideoGenerationTab.tsx`**

```tsx
// src/components/modals/UgcVideoGenerationTab.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Video, Sparkles, RefreshCw, CheckCircle2, AlertCircle, Loader2, Download, Play, ChevronRight, Users,
} from 'lucide-react';
import type { Product, Avatar } from '../../types/models';
import {
  generateUgcVideoScript, startUgcVideoJob, listenUgcVideoJob, computeUgcVideoProgress,
  type UgcVideoScript, type UgcVideoJob,
} from '../../services/ugcVideoService';
import { cn, PrereqItem } from './videoWizardShared';
import AvatarLibrary from './AvatarLibrary';

export interface UgcVideoGenerationTabProps {
  product: Product;
  uid: string;
  getIdToken: () => Promise<string>;
  onUgcVideoGenerated: (productId: string, videoUrl: string, jobId: string) => void;
  onUgcVideoJobStarted?: (productId: string, jobId: string, avatarId: string) => void;
  onNavigateToTab: (tab: 'imagem' | 'ia') => void;
  activeVideoProductId?: string;
}

type Stage = 'prereqs' | 'select-avatar' | 'script' | 'generate';

const ROLE_LABELS: Record<UgcVideoScript['clipes'][number]['papel'], string> = {
  gancho: 'Gancho',
  demonstracao: 'Demonstração',
  cta: 'Fechamento (CTA)',
};

export default function UgcVideoGenerationTab({
  product, uid, getIdToken, onUgcVideoGenerated, onUgcVideoJobStarted, onNavigateToTab, activeVideoProductId,
}: UgcVideoGenerationTabProps) {
  const hasDescription = !!product['Descrição complementar']?.trim();
  const hasSeoTitle = !!product['Título SEO']?.trim();
  const hasImages = (product._ambientImages?.length ?? 0) > 0;
  const prereqsMet = hasDescription && hasSeoTitle && hasImages;

  const [stage, setStage] = useState<Stage>('prereqs');
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [script, setScript] = useState<UgcVideoScript | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(product._ugcVideoJobId ?? null);
  const [job, setJob] = useState<UgcVideoJob | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setStage('generate');
    unsubRef.current?.();
    unsubRef.current = listenUgcVideoJob(uid, jobId, (j) => {
      setJob(j);
      if (j.status === 'done' && j.videoUrl) {
        onUgcVideoGenerated(product._id, j.videoUrl, jobId);
      }
    });
    return () => { unsubRef.current?.(); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  function collectAttributes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, attr] of Object.entries(product.attributes ?? {})) {
      const raw = Array.isArray(attr?.value) ? attr.value.join(', ') : attr?.value;
      const val = (raw ?? '').toString().trim();
      if (val) out[key] = val;
    }
    return out;
  }

  // Review Focus: switching avatars after a script was already generated must
  // invalidate the stale script (it was built from the previous avatar's
  // description) instead of silently letting it be submitted.
  function handleSelectAvatar(a: Avatar) {
    setAvatar(a);
    setScript(null);
  }

  async function handleGenerateScript() {
    if (!avatar) return;
    const productImage = product._selectedImage ?? product._ambientImages?.[0] ?? null;
    if (!productImage) return;
    setScriptLoading(true);
    setScriptError(null);
    try {
      const token = await getIdToken();
      const result = await generateUgcVideoScript(token, {
        description: product['Descrição complementar'] ?? product['Descrição'] ?? '',
        brand: product['Marca'] ?? '',
        productImageUrl: productImage,
        avatarImageUrl: avatar.referenceImageUrl,
        avatarDescricao: avatar.descricao,
        productName: product['Título SEO'] ?? product['Descrição'] ?? '',
        category: product['Categoria'] ?? (product.categoryPath?.join(' > ') ?? ''),
        attributes: collectAttributes(),
      });
      setScript(result);
      setStage('script');
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Erro ao gerar roteiro');
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleStartJob() {
    if (!script || !avatar) return;
    const productImage = product._selectedImage ?? product._ambientImages?.[0] ?? null;
    if (!productImage) return;
    setJobLoading(true);
    setJobError(null);
    try {
      const token = await getIdToken();
      const id = await startUgcVideoJob(token, {
        productId: product._id,
        productName: product['Descrição'] ?? product._id,
        script,
        avatarImageUrl: avatar.referenceImageUrl,
        productImageUrl: productImage,
      });
      setJobId(id);
      onUgcVideoJobStarted?.(product._id, id, avatar.id);
      setStage('generate');
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Erro ao iniciar geração');
      setJobLoading(false);
    }
  }

  const stageLabels: Record<Stage, string> = {
    'prereqs': 'Pré-requisitos',
    'select-avatar': 'Avatar',
    'script': 'Roteiro',
    'generate': 'Gerar Vídeo',
  };
  const stageOrder: Stage[] = ['prereqs', 'select-avatar', 'script', 'generate'];

  const anotherVideoActive = activeVideoProductId && activeVideoProductId !== product._id && !product._ugcVideoJobId;

  if (anotherVideoActive) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4 animate-in fade-in duration-300">
        <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center">
          <Video className="w-7 h-7 text-violet-500" />
        </div>
        <div className="max-w-sm">
          <p className="font-bold text-slate-800 text-lg mb-2">Vídeo em produção</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Já estamos com um vídeo em produção (clássico ou UGC). Aguarde a conclusão para iniciar outro.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {stageOrder.map((s, i) => {
          const active = stage === s;
          const done = stageOrder.indexOf(stage) > i;
          return (
            <React.Fragment key={s}>
              <span className={cn(
                'px-3 py-1 rounded-full text-xs font-bold transition-all',
                active && 'bg-violet-600 text-white',
                done && 'bg-green-100 text-green-700',
                !active && !done && 'bg-slate-100 text-slate-400',
              )}>
                {done ? '✓ ' : `${i + 1}. `}{stageLabels[s]}
              </span>
              {i < stageOrder.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
            </React.Fragment>
          );
        })}
      </div>

      {stage === 'prereqs' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            Vídeo UGC com Avatar
            <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-wide">Beta</span>
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Um avatar seu (ou criado por você) fala para a câmera e interage com o produto. Precisa das mesmas informações do vídeo clássico.
          </p>

          <div className="space-y-3 mb-6">
            <PrereqItem ok={hasDescription} label="Descrição complementar gerada" onFix={() => onNavigateToTab('ia')} fixLabel="Ir para IA" />
            <PrereqItem ok={hasSeoTitle} label="Título SEO preenchido" onFix={() => onNavigateToTab('ia')} fixLabel="Ir para IA" />
            <PrereqItem ok={hasImages} label="Imagens ambientadas geradas (mínimo 1)" onFix={() => onNavigateToTab('imagem')} fixLabel="Ir para Imagens" />
          </div>

          <button
            onClick={() => setStage('select-avatar')}
            disabled={!prereqsMet}
            className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            <ChevronRight className="w-4 h-4" />
            Próximo: Escolher Avatar
          </button>
        </section>
      )}

      {stage === 'select-avatar' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            Escolha o avatar
          </h2>
          <p className="text-sm text-slate-500 mb-6">Selecione um avatar salvo ou crie um novo. Ele reaparece nos próximos vídeos.</p>

          <AvatarLibrary uid={uid} selectedAvatarId={avatar?.id} onSelect={handleSelectAvatar} />

          <div className="flex gap-3 flex-wrap mt-6">
            <button type="button" onClick={() => setStage('prereqs')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50">
              Voltar
            </button>
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={!avatar || scriptLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md disabled:opacity-40 flex items-center gap-2"
            >
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {scriptLoading ? 'Gerando roteiro...' : 'Gerar Roteiro com IA'}
            </button>
          </div>
          {scriptError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {scriptError}
            </p>
          )}
        </section>
      )}

      {stage === 'script' && script && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            Roteiro UGC gerado pela IA
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Revise e edite as falas antes de gerar o vídeo. O avatar fala olhando para a câmera — o áudio vem embutido em cada clipe.
          </p>

          <div className="space-y-6 mb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-800">Cena / Contexto visual</label>
              <textarea
                value={script.cena}
                onChange={(e) => setScript({ ...script, cena: e.target.value })}
                rows={2}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
              />
            </div>

            {script.clipes.map((clip, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-4 bg-slate-50/60">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold uppercase tracking-wide">
                    {ROLE_LABELS[clip.papel]}
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-800">Fala do avatar</label>
                    <textarea
                      value={clip.fala}
                      onChange={(e) => {
                        const clipes = [...script.clipes];
                        clipes[i] = { ...clip, fala: e.target.value };
                        setScript({ ...script, clipes });
                      }}
                      rows={2}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-800">Ação visual</label>
                    <textarea
                      value={clip.acaoVisual}
                      onChange={(e) => {
                        const clipes = [...script.clipes];
                        clipes[i] = { ...clip, acaoVisual: e.target.value };
                        setScript({ ...script, clipes });
                      }}
                      rows={2}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={handleGenerateScript} disabled={scriptLoading} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40">
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Regenerar Roteiro
            </button>
            <button type="button" onClick={handleStartJob} disabled={jobLoading} className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md flex items-center gap-2 disabled:opacity-40">
              {jobLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {jobLoading ? 'Iniciando...' : 'Aprovar e Gerar Vídeo'}
            </button>
          </div>
          {jobError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {jobError}
            </p>
          )}
        </section>
      )}

      {stage === 'generate' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Video className="w-5 h-5 text-violet-600" />
            Geração de Vídeo UGC
          </h2>

          {(!job || job.status === 'queued' || job.status === 'processing') && (
            <UgcVideoProgressDisplay job={job ?? null} />
          )}

          {job?.status === 'done' && job.videoUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-3 rounded-xl text-sm font-bold border border-green-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> Vídeo gerado com sucesso!
              </div>
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                <video src={job.videoUrl} controls className="w-full max-h-[480px] object-contain" />
              </div>
              <div className="flex gap-3 flex-wrap">
                <a href={job.videoUrl} download={`video_ugc_${product._id}.mp4`} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center gap-2">
                  <Download className="w-4 h-4" /> Baixar Vídeo
                </a>
                <button
                  type="button"
                  onClick={() => { setStage('select-avatar'); setJob(null); setJobId(null); setScript(null); setJobLoading(false); }}
                  className="px-5 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Gerar Novo Vídeo
                </button>
              </div>
            </div>
          )}

          {job?.status === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div><p className="font-bold mb-1">Falha na geração do vídeo</p><p>{job.error ?? 'Erro desconhecido'}</p></div>
              </div>
              <button type="button" onClick={() => { setStage('select-avatar'); setJob(null); setJobId(null); setJobLoading(false); }} className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Tentar Novamente
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function UgcVideoProgressDisplay({ job }: { job: UgcVideoJob | null }) {
  const { pct, label } = computeUgcVideoProgress(job);
  const total = job?.totalClips ?? 3;
  const done = job?.clipsDone ?? 0;
  const isClip = !job?.step || job?.step === 'clip';

  return (
    <div className="flex flex-col items-center py-10 gap-6 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
        <div className="absolute inset-0 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" />
        <Video className="absolute inset-0 m-auto w-6 h-6 text-violet-600" />
      </div>
      <div className="w-full max-w-sm space-y-3">
        <p className="font-bold text-slate-800 text-lg">{job?.status === 'processing' ? 'Gerando seu vídeo UGC...' : 'Na fila de processamento...'}</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500 font-medium">
            <span>{label}</span><span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {isClip && job?.status === 'processing' && (
          <div className="flex justify-center gap-2 pt-1">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={cn('w-2.5 h-2.5 rounded-full transition-all', i < done ? 'bg-violet-500' : 'bg-violet-300 animate-pulse')} />
            ))}
          </div>
        )}
        <p className="text-xs text-slate-400 leading-relaxed">
          O Veo 3.1 gera os clipes em paralelo, com o avatar falando. Esse processo geralmente leva de 2 a 4 minutos.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the mode toggle into `ProductEditModal.tsx`**

Add to the props interface (after `onVideoJobStarted?: (productId: string, jobId: string) => void;`, line 229):

```ts
  onUgcVideoGenerated?: (productId: string, videoUrl: string, jobId: string) => void;
  onUgcVideoJobStarted?: (productId: string, jobId: string, avatarId: string) => void;
```

Add to the destructured props on the component signature (line 232), after `onVideoJobStarted`:

```ts
, onUgcVideoGenerated, onUgcVideoJobStarted
```

Add local state for the mode toggle (near the component's other `useState` calls, e.g. right after `activeTab` state):

```ts
const [videoMode, setVideoMode] = useState<'classic' | 'ugc'>('classic');
```

Replace the `activeTab === 'video'` block (lines 1006-1033) with:

```tsx
              {activeTab === 'video' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300 pb-20">
                  {uid && getIdToken ? (
                    <>
                      <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                        <button
                          type="button"
                          onClick={() => setVideoMode('classic')}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${videoMode === 'classic' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}
                        >
                          Vídeo clássico
                        </button>
                        <button
                          type="button"
                          onClick={() => setVideoMode('ugc')}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${videoMode === 'ugc' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}
                        >
                          UGC com avatar
                        </button>
                      </div>

                      {videoMode === 'classic' ? (
                        <VideoGenerationTab
                          product={editedProduct}
                          uid={uid}
                          getIdToken={getIdToken}
                          activeVideoProductId={activeVideoProductId}
                          onVideoGenerated={(productId, videoUrl, jobId) => {
                            setEditedProduct((prev) => ({
                              ...prev,
                              _videoUrl: videoUrl,
                              _videoJobId: jobId,
                              _videoStatus: 'done',
                            }));
                            onVideoGenerated?.(productId, videoUrl, jobId);
                          }}
                          onVideoJobStarted={onVideoJobStarted}
                          onNavigateToTab={(tab) => setActiveTab(tab)}
                        />
                      ) : (
                        <UgcVideoGenerationTab
                          product={editedProduct}
                          uid={uid}
                          getIdToken={getIdToken}
                          activeVideoProductId={activeVideoProductId}
                          onUgcVideoGenerated={(productId, videoUrl, jobId) => {
                            setEditedProduct((prev) => ({
                              ...prev,
                              _ugcVideoUrl: videoUrl,
                              _ugcVideoJobId: jobId,
                              _ugcVideoStatus: 'done',
                            }));
                            onUgcVideoGenerated?.(productId, videoUrl, jobId);
                          }}
                          onUgcVideoJobStarted={onUgcVideoJobStarted}
                          onNavigateToTab={(tab) => setActiveTab(tab)}
                        />
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                      Autenticação necessária para gerar vídeos.
                    </div>
                  )}
                </div>
              )}
```

Add the import near the existing `import VideoGenerationTab from './VideoGenerationTab';` (or wherever `VideoGenerationTab` is imported):

```ts
import UgcVideoGenerationTab from './UgcVideoGenerationTab';
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual QA**

```bash
npm run dev
```

Open a product's "Vídeo" tab. Confirm:
- The "Vídeo clássico" / "UGC com avatar" toggle renders and switching between them swaps the wizard content without losing the classic wizard's own state issues (switching back to classic still shows its own stage correctly).
- The UGC wizard's prereqs stage shows the same 3 checks.
- Selecting an avatar, generating a script, then going back to "Escolher Avatar" and picking a **different** avatar clears the previously generated script (you're taken back to a state where "Gerar Roteiro com IA" must be pressed again, not stale text) — this directly proves the Review Focus item about stale scripts.
- Editing a `fala`/`acaoVisual` textarea in the script stage updates the state (type something, tab away, confirm it's retained).

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/UgcVideoGenerationTab.tsx src/components/modals/ProductEditModal.tsx
git commit -m "feat(video): UGC wizard UI + mode toggle in ProductEditModal"
```

---

### Task 10: Global video job gating across both modes (`App.tsx`)

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ProductEditModal`'s `onUgcVideoGenerated`/`onUgcVideoJobStarted` props (Task 9).
- Produces: nothing consumed elsewhere — this is the final wiring point.

Both video modes call the same Veo model and are capped by the same project quota, so they share **one** global "only one active video job" gate — a classic job in flight blocks starting a UGC one and vice versa. Unlike the classic flow's sidebar progress widget (`activeVideoJob`/`listenVideoJob` in `App.tsx`), this task does **not** add an equivalent live-listening sidebar widget for UGC jobs — out of scope for this v1 (the UGC wizard's own `generate` stage already listens directly via `listenUgcVideoJob` while it's open, and — like the classic pipeline — the server writes `_ugcVideoUrl`/`_ugcVideoStatus: 'done'` directly onto the product doc when the job finishes, so the product list self-heals on next load even without a live client listener).

- [ ] **Step 1: Extend the shared "active video" gate**

In `src/App.tsx`, replace line 4634:

```tsx
            activeVideoProductId={products.find(p => p._videoStatus === 'queued' || p._videoStatus === 'processing')?._id}
```

with:

```tsx
            activeVideoProductId={products.find(p =>
              p._videoStatus === 'queued' || p._videoStatus === 'processing' ||
              p._ugcVideoStatus === 'queued' || p._ugcVideoStatus === 'processing',
            )?._id}
```

- [ ] **Step 2: Add `handleUgcVideoJobStarted`**

Right after the existing `handleVideoJobStarted` function (after line 745 or wherever its closing brace is), add:

```ts
  const handleUgcVideoJobStarted = async (productId: string, jobId: string, avatarId: string) => {
    setProducts((prev) =>
      prev.map((p) =>
        p._id === productId
          ? { ...p, _ugcVideoJobId: jobId, _ugcVideoStatus: 'queued' as const, _ugcAvatarId: avatarId }
          : p,
      ),
    );
    if (user) {
      try {
        const productRef = doc(db, `users/${user.uid}/products/${productId}`);
        await updateDoc(productRef, { _ugcVideoJobId: jobId, _ugcVideoStatus: 'queued', _ugcAvatarId: avatarId });
      } catch (err) {
        console.error('Erro ao persistir jobId do vídeo UGC:', err);
      }
    }
  };
```

- [ ] **Step 3: Wire the two new props into `<ProductEditModal>`**

In the same JSX block edited in Step 1 (around line 4640), add, alongside the existing `onVideoJobStarted`/`onVideoGenerated`:

```tsx
            onUgcVideoJobStarted={handleUgcVideoJobStarted}
            onUgcVideoGenerated={(productId, videoUrl, jobId) => {
              setProducts((prev) => {
                const updated = prev.map((p) =>
                  p._id === productId
                    ? { ...p, _ugcVideoUrl: videoUrl, _ugcVideoJobId: jobId, _ugcVideoStatus: 'done' as const }
                    : p,
                );
                const prod = prev.find(p => p._id === productId);
                const name = prod?.['Descrição'] ?? prod?.['Título SEO'] ?? 'Produto';
                setVideoReadyNotification({ productId, productName: name, videoUrl });
                setTimeout(() => setVideoReadyNotification(null), 12000);
                return updated;
              });
            }}
```

(This reuses the same `videoReadyNotification` toast the classic flow already has — no new UI needed for the completion notice.)

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual QA — race between the two modes**

```bash
npm run dev
```

Open a product, start a classic video job (through to the "Aprovar e Gerar Vídeo" click so `_videoStatus` becomes `'queued'`). While it's still processing, open the UGC tab on the **same or a different** product. Confirm the "Vídeo em produção" blocking message appears in the UGC wizard too (not just the classic one) — this proves the shared gate from Step 1 works across modes, directly exercising this plan's Review Focus item about racing jobs.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(video): share the active-video-job gate across classic and UGC modes"
```

---

### Task 11: End-to-end manual QA and regression checklist

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full UGC happy path**

```bash
npm run dev
```

Pick a product with description, SEO title, and ambient images already generated. Open its "Vídeo" tab → "UGC com avatar" → create a new avatar (or reuse one from earlier QA) → generate script → edit one `fala` → "Aprovar e Gerar Vídeo". Wait for completion. Confirm:
- The player shows the finished video, and it visibly matches the spec's "Critérios de sucesso": the avatar is recognizable and holds/uses the product, speaking the scripted lines with audible dialogue.
- `users/{uid}/credit_logs` in Firebase console shows one `avatar_creation` entry (if a new avatar was created) and one `video_ugc_generation` entry, no unexpected refund.
- The product doc has `_ugcVideoUrl`, `_ugcVideoStatus: 'done'`, `_ugcAvatarId` set.

- [ ] **Step 2: Insufficient-credits path (Review Focus item)**

Using a test account, note its current credit balance, then (via the Firebase console or an existing admin script) temporarily set `users/{uid}.credits` below the `video_ugc_generation` cost. Attempt to start a UGC job from the `script` stage. Confirm the "Aprovar e Gerar Vídeo" flow shows a readable pt-BR error ("Créditos insuficientes") in `jobError`, not a raw stack trace or a stuck spinner. Restore the account's credit balance afterwards.

- [ ] **Step 3: Classic flow regression**

Run through the classic video flow once, end to end (prereqs → select image → generate script → approve → wait for completion), on a different product than the ones used above. Confirm it still behaves exactly as before this plan started — same stages, same 4-shot script, same muted-clips-plus-voice-over result.

- [ ] **Step 4: Full lint pass**

Run: `npm run lint`
Expected: clean, no errors, across every file touched by this plan.

- [ ] **Step 5: Run every verify script written by this plan**

```bash
npx tsx scripts/verify-avatar-service.mjs
npx tsx scripts/verify-ugc-video-script.mjs
```

Expected: both print `Todas as verificações passaram.` and exit 0.

- [ ] **Step 6: Final commit (if anything was fixed during QA)**

If Steps 1-5 surfaced any fix, commit it with a message describing what regressed and why; otherwise this task ends without a commit.
