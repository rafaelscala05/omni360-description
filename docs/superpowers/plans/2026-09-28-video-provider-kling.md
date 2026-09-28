# Kling como provider alternativo de geração de vídeo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin da plataforma escolha, num painel central, se a geração de vídeo de produto (clássico e UGC) usa o Veo 3 (como hoje) ou a Kling (via OpenRouter), sem exigir deploy para trocar.

**Architecture:** Um dispatcher `runClipGeneration(provider, ...)` decide entre `runVeoOperation` (existente, Vertex AI/ADC) e um novo `runKlingOperation` (OpenRouter, chave Bearer única) — ambos devolvem o mesmo `base64` de vídeo, então a montagem por ffmpeg em `videoAgent.ts`/`ugcVideoAgent.ts` não muda. O provider padrão é um doc Firestore (`platform_settings/video`) editável por uma tela nova no CRM admin, lido uma vez por job e gravado no próprio doc do job.

**Tech Stack:** Node/TypeScript (`tsx`), Express, Firestore (Admin SDK), OpenRouter Video Generation API (`fetch` nativo, sem SDK novo), React (painel admin).

**Spec:** `docs/superpowers/specs/2026-09-28-video-provider-kling-design.md`

## Global Constraints

- O pipeline Veo (`runVeoOperation`, `VEO_MODEL`, autenticação Vertex/ADC) não muda de comportamento — continua sendo o default até um admin trocar.
- Kling é acessada só via OpenRouter (`https://openrouter.ai/api/v1/videos`), nunca pela API direta da Kling (JWT HS256) — decisão explícita do usuário nesta feature.
- Modelo fixo: `kwaivgi/kling-v3.0-std` — sem seleção de variante nesta v1.
- `negativePrompt` não é enviado à Kling — a API do OpenRouter não documenta um campo equivalente para este modelo.
- Provider é escolhido uma vez por job (no `start-job`) e gravado no doc do job — nunca recalculado depois, mesmo se o admin trocar o default enquanto o job está `processing`.
- Sem `OPENROUTER_API_KEY` configurada, iniciar um job com Kling selecionada deve falhar com erro claro — nunca cair silenciosamente para o Veo.
- Projeto não tem framework de testes automatizados — lógica pura é validada por scripts `npx tsx scripts/verify-*.mjs` (padrão `check(label, actual, expected)`), chamadas de rede não são mockadas em massa; o resto é validação manual via `npm run dev`.

## Review Focus

- Status `failed` retornado pela Kling no polling deve virar um erro claro e **não** deve ser retentado (é uma falha de geração determinística, não uma falha transitória de rede) — diferente de um 5xx/timeout, que deve retentar. → Task 2.
- `OPENROUTER_API_KEY` ausente no ambiente deve falhar com uma mensagem clara na hora de gerar (mesmo padrão de `GEMINI_API_KEY` ausente), não travar silenciosamente ou cair pro Veo. → Task 2.
- `platform_settings/video` inexistente (instalação nova, doc nunca criado) deve resolver para `'veo'`, não lançar exceção nem quebrar o `start-job`. → Task 3.
- `PUT /api/admin/video-settings` com um `defaultProvider` inválido (string vazia, outro nome de modelo) deve responder 422 e não gravar nada — sem script de verificação automatizado dedicado (mesmo estado hoje do resto de `crmAdmin.ts`, que não tem `verify-*.mjs` próprio); coberto por QA manual na Task 7.
- Um job já `processing` com `provider: 'veo'` (ou `'kling'`) gravado no doc deve terminar com esse mesmo provider mesmo que o admin troque o default no meio da execução — garantido estruturalmente (o provider só é lido uma vez, no `start-job`, nunca de novo dentro do job), verificado manualmente na Task 7.

---

## File Structure

- **Modificar `server/videoShared.ts`** — tipos compartilhados de provider (`VideoProvider` reexportado de `src/types/crm.ts`, `ClipReferenceImage`, `ClipGenerationRequest`), `buildVeoRequest` (pura), `resolveVideoProvider` (pura) e `getDefaultVideoProvider` (I/O). `runVeoOperation` não muda.
- **Criar `server/videoProviders.ts`** — tudo que é específico da Kling/OpenRouter: `KLING_MODEL`, `getOpenRouterApiKey`, `buildKlingRequestBody` (pura), `runKlingOperation` (I/O), e o dispatcher `runClipGeneration`.
- **Modificar `src/types/crm.ts`** — `VideoProvider`, `VideoPlatformSettings` (únicas definições — servidor importa de cá, mesmo padrão já usado por `CrmStage` etc.).
- **Modificar `server/crmAdmin.ts`** — duas rotas novas (`GET`/`PUT /api/admin/video-settings`) dentro de `registerCrmAdminRoutes`, reaproveitando `requireAdmin`/`auditLog` locais.
- **Modificar `src/services/adminService.ts`** — `getVideoSettings`/`setVideoSettings`.
- **Criar `src/modules/admin/VideoSettingsView.tsx`** — painel de escolha do provider.
- **Modificar `src/modules/admin/AdminApp.tsx`** — rota + item de nav para o painel novo.
- **Modificar `server/videoAgent.ts`** — pipeline clássico passa a resolver o provider no `start-job`, gravá-lo no job, carregar URL+base64 das imagens de referência, e chamar `runClipGeneration` em vez de `runVeoOperation` direto.
- **Modificar `server/ugcVideoAgent.ts`** — mesma mudança, pipeline UGC.
- **Modificar `src/services/videoService.ts` / `src/services/ugcVideoService.ts`** — campo `provider` no tipo do job.
- **Modificar `src/components/modals/VideoGenerationTab.tsx` / `UgcVideoGenerationTab.tsx`** — badge discreto do provider na tela de sucesso.
- **Modificar `.env.example`** — `OPENROUTER_API_KEY`.
- **Criar `scripts/verify-video-providers.mjs`** — cobre `buildVeoRequest`, `buildKlingRequestBody`, `resolveVideoProvider`, `getOpenRouterApiKey`, e o comportamento de retry/falha de `runKlingOperation` (fetch dublado, sem rede real).

`firestore.rules` **não muda** — `platform_settings/**` já é negado ao client por padrão (não há nenhum `match` cobrindo essa coleção nas rules atuais, e o projeto nega por default o que não é explicitamente liberado).

---

### Task 1: Tipos de provider + `buildVeoRequest` puro (`videoShared.ts`)

**Files:**
- Modify: `src/types/crm.ts` (fim do arquivo)
- Modify: `server/videoShared.ts`
- Test: `scripts/verify-video-providers.mjs` (novo)

**Interfaces:**
- Produces: `VideoProvider` (`'veo' | 'kling'`), `VideoPlatformSettings { defaultProvider: VideoProvider; updatedAt: string | null; updatedBy: string | null }` (em `src/types/crm.ts`); `ClipReferenceImage { url: string; base64?: string; mimeType?: string }`, `ClipGenerationRequest { prompt: string; negativePrompt?: string; durationSeconds: number; aspectRatio: string; generateAudio: boolean; referenceImages: ClipReferenceImage[] }`, `buildVeoRequest(request: ClipGenerationRequest): Parameters<GoogleGenAI['models']['generateVideos']>[0]` (em `server/videoShared.ts`).

- [ ] **Step 1: Adicionar os tipos compartilhados em `src/types/crm.ts`**

No fim do arquivo, depois de `defaultAutomation`:

```ts
// Provider de geração de vídeo de produto (server/videoAgent.ts,
// server/ugcVideoAgent.ts). Escolhido centralmente pelo admin, nunca por
// usuário/produto — ver docs/superpowers/specs/2026-09-28-video-provider-kling-design.md.
export type VideoProvider = 'veo' | 'kling';

export interface VideoPlatformSettings {
  defaultProvider: VideoProvider;
  updatedAt: string | null;
  updatedBy: string | null;
}
```

- [ ] **Step 2: Escrever o teste (falhando) para `buildVeoRequest`**

Criar `scripts/verify-video-providers.mjs`:

```js
// Verificação da lógica pura de seleção/montagem de provider de vídeo
// (server/videoShared.ts, server/videoProviders.ts). Não sobe servidor, não
// toca o Firestore; chamadas de rede da Kling são dubladas via globalThis.fetch.
// Rodar com: npx tsx scripts/verify-video-providers.mjs
import { buildVeoRequest, VideoGenerationReferenceType } from '../server/videoShared.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// --- buildVeoRequest ---
const baseRequest = {
  prompt: 'um produto girando lentamente',
  negativePrompt: 'baixa qualidade',
  durationSeconds: 8,
  aspectRatio: '9:16',
  generateAudio: false,
  referenceImages: [
    { url: 'https://cdn.exemplo/produto.jpg', base64: 'AAAA', mimeType: 'image/jpeg' },
    { url: 'https://cdn.exemplo/folha.jpg', base64: 'BBBB', mimeType: 'image/jpeg' },
  ],
};

const veoReq = buildVeoRequest(baseRequest);
check('buildVeoRequest usa o modelo Veo', veoReq.model, 'veo-3.1-fast-generate-001');
check('buildVeoRequest propaga prompt/negativePrompt', [veoReq.prompt, veoReq.config.negativePrompt], [baseRequest.prompt, baseRequest.negativePrompt]);
check('buildVeoRequest propaga duração/aspecto/áudio', [veoReq.config.durationSeconds, veoReq.config.aspectRatio, veoReq.config.generateAudio], [8, '9:16', false]);
check('buildVeoRequest converte referenceImages em ASSET com base64', veoReq.config.referenceImages, [
  { image: { imageBytes: 'AAAA', mimeType: 'image/jpeg' }, referenceType: VideoGenerationReferenceType.ASSET },
  { image: { imageBytes: 'BBBB', mimeType: 'image/jpeg' }, referenceType: VideoGenerationReferenceType.ASSET },
]);

let threw = false;
try {
  buildVeoRequest({ ...baseRequest, referenceImages: [{ url: 'https://cdn.exemplo/sem-base64.jpg' }] });
} catch {
  threw = true;
}
check('buildVeoRequest exige base64 por imagem (Veo não aceita URL crua)', threw, true);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Rodar e confirmar que falha (função ainda não existe)**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: erro de import — `buildVeoRequest` não é exportado por `server/videoShared.ts`.

- [ ] **Step 4: Implementar os tipos e `buildVeoRequest` em `server/videoShared.ts`**

Logo abaixo de `export { VideoGenerationReferenceType };` (linha 20):

```ts
import type { VideoProvider } from '../src/types/crm';
export type { VideoProvider };

// Formato de entrada comum aos dois providers (Veo, Kling) — cada agente
// (videoAgent.ts, ugcVideoAgent.ts) monta isto uma vez por shot/clipe; o
// dispatcher runClipGeneration (server/videoProviders.ts) decide o que
// repassar pra Veo ou pra Kling.
export interface ClipReferenceImage {
  url: string;       // sempre presente — é o que a Kling usa (image_url)
  base64?: string;   // presente quando o provider é 'veo' (fetch/resize já feito)
  mimeType?: string;
}

export interface ClipGenerationRequest {
  prompt: string;
  negativePrompt?: string; // ignorado pela Kling — sem campo equivalente na API do OpenRouter
  durationSeconds: number;
  aspectRatio: string;
  generateAudio: boolean;
  referenceImages: ClipReferenceImage[];
}
```

Depois de `getVeoClient()` (por volta da linha 56):

```ts
export function buildVeoRequest(
  request: ClipGenerationRequest,
): Parameters<GoogleGenAI['models']['generateVideos']>[0] {
  return {
    model: VEO_MODEL,
    prompt: request.prompt,
    config: {
      numberOfVideos: 1,
      durationSeconds: request.durationSeconds,
      aspectRatio: request.aspectRatio,
      personGeneration: 'allow_adult',
      generateAudio: request.generateAudio,
      negativePrompt: request.negativePrompt,
      referenceImages: request.referenceImages.map((img) => {
        if (!img.base64 || !img.mimeType) {
          throw new Error('imagem de referência sem base64/mimeType — obrigatório para o provider Veo');
        }
        return {
          image: { imageBytes: img.base64, mimeType: img.mimeType },
          referenceType: VideoGenerationReferenceType.ASSET,
        };
      }),
    },
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: `Todas as verificações passaram.`, exit code 0.

- [ ] **Step 6: Lint e commit**

Run: `npm run lint`

```bash
git add src/types/crm.ts server/videoShared.ts scripts/verify-video-providers.mjs
git commit -m "$(cat <<'EOF'
feat(video): tipos de provider e buildVeoRequest puro

Introduz VideoProvider/ClipGenerationRequest como formato de entrada
comum a Veo e Kling, sem mudar o comportamento do Veo — primeiro passo
para trocar o provider de geração de vídeo por configuração de admin.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Cliente Kling/OpenRouter (`server/videoProviders.ts`)

**Files:**
- Create: `server/videoProviders.ts`
- Modify: `scripts/verify-video-providers.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ClipGenerationRequest`, `buildVeoRequest`, `runVeoOperation`, `VideoProvider` (de `server/videoShared.ts`).
- Produces: `KLING_MODEL` (`'kwaivgi/kling-v3.0-std'`), `getOpenRouterApiKey(): string`, `buildKlingRequestBody(request: ClipGenerationRequest): Record<string, unknown>`, `runKlingOperation(jobId: string, label: string, request: ClipGenerationRequest, opts?: { pollIntervalMs?: number; retryDelaysMs?: number[] }): Promise<string>`, `runClipGeneration(provider: VideoProvider, ai: GoogleGenAI, jobId: string, label: string, request: ClipGenerationRequest): Promise<string>`.

- [ ] **Step 1: Escrever os testes (falhando) para `buildKlingRequestBody`, `getOpenRouterApiKey` e `runKlingOperation`**

Acrescentar ao fim de `scripts/verify-video-providers.mjs` (import novo no topo):

```js
import { buildKlingRequestBody, getOpenRouterApiKey, runKlingOperation, KLING_MODEL } from '../server/videoProviders.ts';
```

E, antes do `console.log(failures === 0 ...)` final:

```js
// --- buildKlingRequestBody ---
const klingBody = buildKlingRequestBody(baseRequest);
check('buildKlingRequestBody usa o modelo Kling', klingBody.model, KLING_MODEL);
check('buildKlingRequestBody mapeia duration/aspect_ratio/generate_audio', [klingBody.duration, klingBody.aspect_ratio, klingBody.generate_audio], [8, '9:16', false]);
check('buildKlingRequestBody NÃO envia negative_prompt', 'negative_prompt' in klingBody, false);
check('buildKlingRequestBody mapeia referenceImages em input_references por url', klingBody.input_references, [
  { type: 'image_url', image_url: { url: 'https://cdn.exemplo/produto.jpg' } },
  { type: 'image_url', image_url: { url: 'https://cdn.exemplo/folha.jpg' } },
]);

// --- getOpenRouterApiKey ---
const originalKey = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
let keyThrew = false;
try {
  getOpenRouterApiKey();
} catch (err) {
  keyThrew = err.status === 500;
}
check('getOpenRouterApiKey lança 500 sem OPENROUTER_API_KEY', keyThrew, true);
process.env.OPENROUTER_API_KEY = 'sk-or-v1-teste';
check('getOpenRouterApiKey retorna a chave quando configurada', getOpenRouterApiKey(), 'sk-or-v1-teste');

// --- runKlingOperation: rede dublada, status 'failed' não retenta ---
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async (url) => {
  fetchCalls++;
  if (String(url).endsWith('/videos')) {
    return { ok: true, json: async () => ({ id: 'job1', polling_url: '/api/v1/videos/job1', status: 'pending' }) };
  }
  return { ok: true, json: async () => ({ status: 'failed' }) };
};
let failedThrew = false;
try {
  await runKlingOperation('jobId1', 'shot#1', baseRequest, { pollIntervalMs: 1 });
} catch (err) {
  failedThrew = /não conseguiu gerar/i.test(err.message);
}
check('runKlingOperation lança quando a task volta failed', failedThrew, true);
check('runKlingOperation não retenta em status failed (1 submit + 1 poll)', fetchCalls, 2);

// --- runKlingOperation: 500 transitório retenta e depois funciona ---
fetchCalls = 0;
let pollAfterRetry = 0;
globalThis.fetch = async (url) => {
  fetchCalls++;
  if (String(url).endsWith('/videos')) {
    if (fetchCalls === 1) return { ok: false, status: 500, text: async () => 'erro temporário' };
    return { ok: true, json: async () => ({ id: 'job2', polling_url: '/api/v1/videos/job2', status: 'pending' }) };
  }
  if (String(url).includes('/content') === false && String(url).includes('job2')) {
    pollAfterRetry++;
    if (pollAfterRetry === 1) return { ok: true, json: async () => ({ status: 'completed', unsigned_urls: ['https://cdn.exemplo/video.mp4'] }) };
  }
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode('video-bytes').buffer };
};
const bytes = await runKlingOperation('jobId2', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1] });
check('runKlingOperation retenta 500 transitório e completa', Buffer.from(bytes, 'base64').toString(), 'video-bytes');
globalThis.fetch = originalFetch;
process.env.OPENROUTER_API_KEY = originalKey;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: erro de import — `server/videoProviders.ts` ainda não existe.

- [ ] **Step 3: Implementar `server/videoProviders.ts`**

```ts
// server/videoProviders.ts
//
// Tudo que é específico da geração de vídeo via Kling (OpenRouter, não a API
// direta da Kling — decisão explícita: ver
// docs/superpowers/specs/2026-09-28-video-provider-kling-design.md) + o
// dispatcher que escolhe entre Veo e Kling. server/videoShared.ts continua
// dono de tudo que é genérico entre os dois providers.
import type { GoogleGenAI } from '@google/genai';
import {
  buildVeoRequest,
  runVeoOperation,
  type ClipGenerationRequest,
  type VideoProvider,
} from './videoShared';

export const KLING_MODEL = 'kwaivgi/kling-v3.0-std';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw Object.assign(new Error('OPENROUTER_API_KEY não configurada'), { status: 500 });
  return key;
}

export function buildKlingRequestBody(request: ClipGenerationRequest): Record<string, unknown> {
  return {
    model: KLING_MODEL,
    prompt: request.prompt,
    duration: request.durationSeconds,
    aspect_ratio: request.aspectRatio,
    generate_audio: request.generateAudio,
    input_references: request.referenceImages.map((img) => ({
      type: 'image_url',
      image_url: { url: img.url },
    })),
  };
}

const KLING_RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const KLING_MAX_RETRIES = 3;
const KLING_DEFAULT_RETRY_DELAYS = [30_000, 60_000, 120_000];
const KLING_DEFAULT_POLL_INTERVAL = 15_000;

export async function runKlingOperation(
  jobId: string,
  label: string,
  request: ClipGenerationRequest,
  opts: { pollIntervalMs?: number; retryDelaysMs?: number[] } = {},
): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  const pollIntervalMs = opts.pollIntervalMs ?? KLING_DEFAULT_POLL_INTERVAL;
  const retryDelaysMs = opts.retryDelaysMs ?? KLING_DEFAULT_RETRY_DELAYS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= KLING_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = retryDelaysMs[attempt - 1];
      console.log(`[video] ${label} kling retry attempt=${attempt} after=${delay / 1000}s jobId=${jobId}`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const submitRes = await fetch(`${OPENROUTER_BASE_URL}/videos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildKlingRequestBody(request)),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text().catch(() => '');
        throw Object.assign(new Error(`Kling submit falhou (${submitRes.status}): ${text.slice(0, 300)}`), { httpStatus: submitRes.status });
      }
      const submitData = (await submitRes.json()) as { id: string; polling_url: string; status: string };
      const pollingUrl = submitData.polling_url.startsWith('http')
        ? submitData.polling_url
        : `https://openrouter.ai${submitData.polling_url}`;

      let status = submitData.status;
      let pollCount = 0;
      let unsignedUrl: string | undefined;
      while (status !== 'completed' && status !== 'failed') {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const pollRes = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!pollRes.ok) {
          throw Object.assign(new Error(`Kling poll falhou (${pollRes.status})`), { httpStatus: pollRes.status });
        }
        const pollData = (await pollRes.json()) as { status: string; unsigned_urls?: string[] };
        status = pollData.status;
        pollCount++;
        console.log(`[video] polling jobId=${jobId} ${label} kling attempt=${pollCount} status=${status}`);
        if (status === 'completed') unsignedUrl = pollData.unsigned_urls?.[0];
        // Falha de geração (ex.: política de conteúdo) é determinística — retentar
        // gastaria mais 3x créditos/tempo pro mesmo resultado.
        if (status === 'failed') {
          throw Object.assign(new Error(`Kling não conseguiu gerar o vídeo (${label})`), { nonRetryable: true });
        }
      }
      if (!unsignedUrl) {
        throw Object.assign(new Error(`Kling não retornou unsigned_urls (${label})`), { nonRetryable: true });
      }

      const videoRes = await fetch(unsignedUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!videoRes.ok) {
        throw Object.assign(new Error(`Download do vídeo Kling falhou (${videoRes.status})`), { httpStatus: videoRes.status });
      }
      const buffer = await videoRes.arrayBuffer();
      console.log(`[video] ${label} kling done jobId=${jobId} polls=${pollCount}`);
      return Buffer.from(buffer).toString('base64');
    } catch (err) {
      lastError = err;
      const httpStatus = (err as { httpStatus?: number }).httpStatus;
      const nonRetryable = (err as { nonRetryable?: boolean }).nonRetryable === true;
      const retryable = !nonRetryable && attempt < KLING_MAX_RETRIES && (httpStatus === undefined || KLING_RETRYABLE_HTTP_STATUS.has(httpStatus));
      if (retryable) {
        console.warn(`[video] ${label} kling transient error, will retry (${attempt + 1}/${KLING_MAX_RETRIES}) jobId=${jobId}:`, (err as Error).message);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Único ponto que videoAgent.ts/ugcVideoAgent.ts chamam — decide qual provider
// gera o clipe. `ai` só é usado no branch Veo (mantém a mesma assinatura de
// runVeoOperation, que espera um client já construído).
export async function runClipGeneration(
  provider: VideoProvider,
  ai: GoogleGenAI,
  jobId: string,
  label: string,
  request: ClipGenerationRequest,
): Promise<string> {
  if (provider === 'kling') return runKlingOperation(jobId, label, request);
  return runVeoOperation(ai, jobId, label, buildVeoRequest(request));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: `Todas as verificações passaram.`, exit code 0.

- [ ] **Step 5: Adicionar `OPENROUTER_API_KEY` ao `.env.example`**

No fim do arquivo:

```
# Kling (geração de vídeo alternativa ao Veo 3.1) — acessada via OpenRouter,
# não pela API direta da Kling. Uma chave só, sem JWT/assinatura.
# Gerar em: https://openrouter.ai/settings/keys
# Secreta — só no servidor, nunca prefixar com VITE_. Sem esta variável, o
# admin ainda pode selecionar "Kling" no painel, mas qualquer job com esse
# provider falha com erro claro na hora de gerar (sem fallback silencioso pro Veo).
OPENROUTER_API_KEY=
```

- [ ] **Step 6: Lint e commit**

Run: `npm run lint`

```bash
git add server/videoProviders.ts scripts/verify-video-providers.mjs .env.example
git commit -m "$(cat <<'EOF'
feat(video): cliente Kling via OpenRouter + dispatcher de provider

Adiciona runKlingOperation (submit/poll/download contra a API de vídeo
do OpenRouter) e runClipGeneration, que decide entre Veo e Kling sem
mudar o formato de retorno consumido pelo pipeline de ffmpeg existente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Config de admin — leitura/escrita do provider padrão

**Files:**
- Modify: `server/videoShared.ts`
- Modify: `server/crmAdmin.ts`
- Modify: `scripts/verify-video-providers.mjs`

**Interfaces:**
- Consumes: `VideoProvider`, `VideoPlatformSettings` (de `src/types/crm.ts`); `requireAdmin`, `auditLog` (locais em `registerCrmAdminRoutes`, já existentes).
- Produces: `resolveVideoProvider(data?: { defaultProvider?: unknown }): VideoProvider` e `getDefaultVideoProvider(): Promise<VideoProvider>` (em `server/videoShared.ts`) — usados pelas Tasks 5 e 6. Rotas `GET /api/admin/video-settings`, `PUT /api/admin/video-settings`.

- [ ] **Step 1: Escrever o teste (falhando) para `resolveVideoProvider`**

Acrescentar a `scripts/verify-video-providers.mjs` (import novo no topo, junto dos outros de `videoShared.ts`):

```js
import { resolveVideoProvider } from '../server/videoShared.ts';
```

E antes do `console.log(failures === 0 ...)` final:

```js
// --- resolveVideoProvider ---
check('resolveVideoProvider: doc ausente → veo', resolveVideoProvider(undefined), 'veo');
check('resolveVideoProvider: campo ausente → veo', resolveVideoProvider({}), 'veo');
check('resolveVideoProvider: valor inválido → veo', resolveVideoProvider({ defaultProvider: 'sora' }), 'veo');
check('resolveVideoProvider: kling → kling', resolveVideoProvider({ defaultProvider: 'kling' }), 'kling');
check('resolveVideoProvider: veo explícito → veo', resolveVideoProvider({ defaultProvider: 'veo' }), 'veo');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: erro de import — `resolveVideoProvider` não existe ainda.

- [ ] **Step 3: Implementar `resolveVideoProvider` e `getDefaultVideoProvider` em `server/videoShared.ts`**

Logo depois de `assertNoActiveVideoJob` (por volta da linha 205):

```ts
// Lê users/platform_settings/video no client seria negado pelas rules (não há
// nenhum match cobrindo essa coleção) — só o Admin SDK acessa. Ausência do doc
// (instalação nova) ou de valor reconhecido cai em 'veo', o provider seguro.
export function resolveVideoProvider(data?: { defaultProvider?: unknown }): VideoProvider {
  return data?.defaultProvider === 'kling' ? 'kling' : 'veo';
}

export async function getDefaultVideoProvider(): Promise<VideoProvider> {
  const snap = await adminDb.collection('platform_settings').doc('video').get();
  return resolveVideoProvider(snap.exists ? (snap.data() as { defaultProvider?: unknown }) : undefined);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: `Todas as verificações passaram.`, exit code 0.

- [ ] **Step 5: Adicionar as rotas de admin em `server/crmAdmin.ts`**

No bloco de import (linhas 14-29), acrescentar `VideoPlatformSettings` à lista de types importados de `'../src/types/crm'`.

Depois da rota `app.delete('/api/admin/automations/:id', ...)` (fim em torno da linha 726, antes de `app.get('/api/admin/customers/:uid/messages', ...)`):

```ts
  // Provider padrão de geração de vídeo (Veo/Kling) — um doc só, plataforma
  // inteira. Lido uma vez por job em videoAgent.ts/ugcVideoAgent.ts via
  // getDefaultVideoProvider(); trocar aqui não afeta jobs já em andamento.
  app.get('/api/admin/video-settings', async (req, res) => {
    try {
      await requireAdmin(req);
      const snap = await adminDb.collection('platform_settings').doc('video').get();
      const data = snap.exists ? (snap.data() as VideoPlatformSettings) : undefined;
      res.json({
        defaultProvider: data?.defaultProvider === 'kling' ? 'kling' : 'veo',
        updatedAt: data?.updatedAt ?? null,
        updatedBy: data?.updatedBy ?? null,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/admin/video-settings', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const body = req.body ?? {};
      const defaultProvider = body.defaultProvider === 'kling' ? 'kling' : body.defaultProvider === 'veo' ? 'veo' : null;
      if (!defaultProvider) {
        throw Object.assign(new Error('defaultProvider deve ser "veo" ou "kling"'), { status: 422 });
      }

      const settings: VideoPlatformSettings = {
        defaultProvider,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.uid,
      };
      await adminDb.collection('platform_settings').doc('video').set(settings);
      await auditLog(admin, 'platform', 'video-provider', `default → ${defaultProvider}`);
      res.json(settings);
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 6: Lint e commit**

Run: `npm run lint`

```bash
git add server/videoShared.ts server/crmAdmin.ts scripts/verify-video-providers.mjs
git commit -m "$(cat <<'EOF'
feat(video): config de admin do provider padrão de vídeo

Doc único platform_settings/video, lido por getDefaultVideoProvider()
e exposto via GET/PUT /api/admin/video-settings (auditado, mesmo
padrão de requireAdmin/auditLog das automações de WhatsApp).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Painel de admin — trocar o provider padrão

**Files:**
- Modify: `src/services/adminService.ts`
- Create: `src/modules/admin/VideoSettingsView.tsx`
- Modify: `src/modules/admin/AdminApp.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/video-settings` (Task 3), `VideoPlatformSettings`/`VideoProvider` (de `src/types/crm.ts`), `Card`/`ErrorBanner`/`Spinner` (de `src/modules/admin/ui.tsx`).
- Produces: `getVideoSettings(): Promise<VideoPlatformSettings>`, `setVideoSettings(defaultProvider: VideoProvider): Promise<VideoPlatformSettings>` (em `src/services/adminService.ts`); componente `VideoSettingsView`.

- [ ] **Step 1: Adicionar `getVideoSettings`/`setVideoSettings` a `src/services/adminService.ts`**

No bloco de import de tipos (linhas 8-21), acrescentar `VideoPlatformSettings`, `VideoProvider`.

Junto das outras funções de automação (perto de `listAutomations`, linha ~126):

```ts
export const getVideoSettings = () => call<VideoPlatformSettings>('/api/admin/video-settings');
export const setVideoSettings = (defaultProvider: VideoProvider) =>
  call<VideoPlatformSettings>('/api/admin/video-settings', 'PUT', { defaultProvider });
```

- [ ] **Step 2: Criar `src/modules/admin/VideoSettingsView.tsx`**

```tsx
// Escolha do provider padrão de geração de vídeo de produto (Veo/Kling) —
// plataforma inteira, sem opção por usuário. Mesmo esqueleto de
// AutomationsView.tsx (load em useEffect, Card/ErrorBanner/Spinner de ./ui).
import { useCallback, useEffect, useState } from 'react';
import { getVideoSettings, setVideoSettings } from '../../services/adminService';
import type { VideoPlatformSettings, VideoProvider } from '../../types/crm';
import { Card, ErrorBanner, Spinner, formatDateTime } from './ui';

const OPTIONS: { value: VideoProvider; label: string; hint: string }[] = [
  { value: 'veo', label: 'Veo 3', hint: 'Google, via Vertex AI. Provider atual — validado em produção.' },
  { value: 'kling', label: 'Kling', hint: 'kwaivgi/kling-v3.0-std, via OpenRouter. Trocar aqui não afeta vídeos já em geração.' },
];

export default function VideoSettingsView() {
  const [settings, setSettings] = useState<VideoPlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(await getVideoSettings());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(provider: VideoProvider) {
    if (!settings || provider === settings.defaultProvider || saving) return;
    setSaving(true);
    setError('');
    try {
      setSettings(await setVideoSettings(provider));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4 max-w-xl">
      {error && <ErrorBanner message={error} />}
      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-1">Provider de geração de vídeo</h2>
        <p className="text-xs text-slate-500 mb-4">
          Vale para os dois modos (clássico e UGC com avatar), em todos os usuários. Trocar aqui não afeta
          vídeos que já estão em geração.
        </p>
        <div className="space-y-2">
          {OPTIONS.map((opt) => {
            const active = settings?.defaultProvider === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => choose(opt.value)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 ${
                  active ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">{opt.label}</span>
                  {active && <span className="text-xs font-semibold text-violet-700">selecionado</span>}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{opt.hint}</p>
              </button>
            );
          })}
        </div>
        {settings?.updatedAt && (
          <p className="text-xs text-slate-400 mt-4">
            Última alteração: {formatDateTime(settings.updatedAt)}
          </p>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Registrar a rota/nav em `src/modules/admin/AdminApp.tsx`**

Import novo (junto de `AutomationsView`, linha 12):

```ts
import VideoSettingsView from './VideoSettingsView';
```

`NAV` (linhas 14-19) ganha uma entrada:

```ts
const NAV = [
  { to: '/admin', label: 'Atenção hoje', exact: true },
  { to: '/admin/kanban', label: 'Kanban' },
  { to: '/admin/clientes', label: 'Clientes' },
  { to: '/admin/automacoes', label: 'Automações' },
  { to: '/admin/video', label: 'Vídeo' },
];
```

`<Routes>` (linhas 144-151) ganha:

```tsx
<Route path="video" element={<VideoSettingsView />} />
```

(antes do `<Route path="*" ...>`).

- [ ] **Step 4: Checar tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Validar manualmente**

Run: `npm run dev`, abrir `/admin/video` autenticado como admin. Confirmar: o painel carrega mostrando "Veo 3" selecionado (config ainda não existe → default), clicar em "Kling" salva e o card troca de destaque, recarregar a página mantém "Kling" selecionado, "Última alteração" aparece.

- [ ] **Step 6: Commit**

```bash
git add src/services/adminService.ts src/modules/admin/VideoSettingsView.tsx src/modules/admin/AdminApp.tsx
git commit -m "$(cat <<'EOF'
feat(admin): painel para trocar o provider padrão de vídeo

Nova aba /admin/video no CRM admin — escolhe Veo ou Kling como
default da plataforma, sem precisar de deploy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pipeline clássico usa o provider (`server/videoAgent.ts`)

**Files:**
- Modify: `server/videoAgent.ts`
- Modify: `src/services/videoService.ts`
- Modify: `src/components/modals/VideoGenerationTab.tsx`

**Interfaces:**
- Consumes: `getDefaultVideoProvider`, `ClipReferenceImage` (de `server/videoShared.ts`), `runClipGeneration` (de `server/videoProviders.ts`).
- Produces: campo `provider` em `users/{uid}/videoJobs/{jobId}` e no tipo `VideoJob` do client.

- [ ] **Step 1: Import novo em `server/videoAgent.ts`**

`buildVeoRequest` (Task 1) já monta o payload do Veo internamente — `VEO_MODEL` e `VideoGenerationReferenceType` deixam de ser usados diretamente neste arquivo depois do Step 3. Remover a linha 2 (`import { VideoGenerationReferenceType } from '@google/genai';`) e trocar o bloco de import de `./videoShared` (linhas 12-16) por:

```ts
import {
  STORAGE_BUCKET, GCP_PROJECT, TEXT_MODEL, VIDEO_ASPECT_RATIO, REFERENCE_MAX_DIM,
  getGeminiClient, getVeoClient, now, sendError, fetchImageAsBase64, resizeForReference,
  runFfmpeg, formatAttributes, debitCreditsAdmin, refundCreditsAdmin, assertNoActiveVideoJob,
  getDefaultVideoProvider, PRODUCT_REFERENCE_PROMPT_LINE, PRODUCT_REFERENCE_NEGATIVE, CAMERA_VARIETY_RULE,
  type ClipReferenceImage, type VideoProvider,
} from './videoShared';
import { runClipGeneration } from './videoProviders';
```

- [ ] **Step 2: Propagar a URL original junto do base64 buscado**

Em `registerVideoRoutes`, dentro do `POST /api/video/start-job` (bloco que hoje busca `shotImages`/`productReference`, por volta das linhas 523-531): trocar o `Map` e os tipos locais para carregar a URL junto:

```ts
      let shotImages: Array<{ base64: string; mimeType: string; url: string }>;
      let productReference: { base64: string; mimeType: string; url: string } | null = null;
      let provider: VideoProvider;
      try {
        provider = await getDefaultVideoProvider();
        await jobRef.set({
          jobId,
          productId,
          status: 'queued',
          provider,
          videoUrl: null,
          error: null,
          createdAt: now(),
          updatedAt: now(),
        });

        const uniqueUrls = Array.from(new Set(shotImageUrls));
        const fetched = new Map<string, { base64: string; mimeType: string; url: string }>();
        await Promise.all(uniqueUrls.map(async (url) => {
          fetched.set(url, { ...(await fetchImageAsBase64(url)), url });
        }));
        shotImages = shotImageUrls.map((url) => fetched.get(url)!);
        if (productReferenceUrl) {
          productReference = { ...(await fetchImageAsBase64(productReferenceUrl)), url: productReferenceUrl };
        }
      } catch (prepErr) {
```

(o resto do bloco `catch`/refund não muda.)

E na chamada de `runVideoJob` (linha ~554), passar `provider`:

```ts
        await runVideoJob(decoded.uid, jobId, productId, script, shotImages, productReference, creditCost, creditMeta, provider);
```

- [ ] **Step 3: Atualizar a assinatura de `runVideoJob` e `generateShot`**

`runVideoJob` (linha 307) ganha um parâmetro `provider: VideoProvider` no fim, e os dois parâmetros de imagem passam a carregar `url`:

```ts
async function runVideoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: VideoScript,
  shotImages: Array<{ base64: string; mimeType: string; url: string }>,
  productReference: { base64: string; mimeType: string; url: string } | null,
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
  provider: VideoProvider,
): Promise<void> {
```

Dentro dela, a montagem de `referenceSheet` (linha ~332) passa a preservar a URL:

```ts
    const referenceSheet = productReference
      ? { ...(await resizeForReference(Buffer.from(productReference.base64, 'base64'))), url: productReference.url }
      : null;
```

E `generateShot` (linha 339) troca a chamada a `runVeoOperation` pelo dispatcher, montando um `ClipGenerationRequest`:

```ts
    const generateShot = async (i: number): Promise<string> => {
      const shot = SHOTS[i];
      const shotScript = script[shot.key];
      const src = shotImages[i];
      const referenceImage = await resizeForReference(Buffer.from(src.base64, 'base64'));
      const prompt = [
        `Cena: ${script.cena}`,
        `Ato (${shot.ato}, ~${shot.seconds}s): ${shotScript.acao}`,
        'Siga EXATAMENTE o ângulo e o movimento de câmera descritos no ato.',
        styleLine,
        rulesLine,
        fidelityLine,
        ...(referenceSheet ? [PRODUCT_REFERENCE_PROMPT_LINE] : []),
      ].join('\n');

      const referenceImages: ClipReferenceImage[] = [
        { url: src.url, base64: referenceImage.base64, mimeType: referenceImage.mimeType },
        ...(referenceSheet ? [{ url: referenceSheet.url, base64: referenceSheet.base64, mimeType: referenceSheet.mimeType }] : []),
      ];

      console.log(`[video] shot ${i + 1}/${SHOTS.length} (${shot.key}) generate jobId=${jobId} provider=${provider}`);
      const videoBytes = await runClipGeneration(provider, ai, jobId, `shot#${i + 1}`, {
        prompt,
        negativePrompt,
        durationSeconds: shot.seconds,
        aspectRatio: VIDEO_ASPECT_RATIO,
        generateAudio: false,
        referenceImages,
      });

      const segPath = path.join(workDir, `seg${i}.mp4`);
      await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
      await jobRef.update({ shotsDone: FieldValue.increment(1), updatedAt: now() });
      return segPath;
    };
```

(`const ai = getVeoClient();` continua sendo criado incondicionalmente antes disso — o branch Kling do dispatcher simplesmente ignora o parâmetro.)

- [ ] **Step 4: Campo `provider` no tipo do client (`src/services/videoService.ts`)**

No `interface VideoJob` (linha 25):

```ts
export interface VideoJob {
  jobId: string;
  productId: string;
  status: VideoJobStatus;
  provider?: 'veo' | 'kling';
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  shotsDone?: number;
  totalShots?: number;
  step?: VideoJobStep;
}
```

- [ ] **Step 5: Badge do provider na tela de sucesso (`VideoGenerationTab.tsx`)**

No bloco `{job?.status === 'done' && job.videoUrl && (...)}` (linha 449-454), acrescentar ao lado do texto de sucesso:

```tsx
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-3 rounded-xl text-sm font-bold border border-green-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Vídeo gerado com sucesso!
                {job.provider && (
                  <span className="ml-auto text-xs font-semibold text-green-600 bg-white/60 px-2 py-0.5 rounded-full">
                    {job.provider === 'kling' ? 'Kling' : 'Veo 3'}
                  </span>
                )}
              </div>
```

- [ ] **Step 6: Checar tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 7: Validar manualmente**

Com o admin em "Veo 3" (default): `npm run dev`, gerar um vídeo clássico de ponta a ponta num produto de teste, confirmar que sai idêntico a antes (badge "Veo 3" no card de sucesso). Depois trocar o admin para "Kling", configurar `OPENROUTER_API_KEY` real, gerar outro vídeo clássico e confirmar que completa e mostra badge "Kling". Sem `OPENROUTER_API_KEY`, confirmar que o job termina em erro claro (não trava em "processing").

- [ ] **Step 8: Commit**

```bash
git add server/videoAgent.ts src/services/videoService.ts src/components/modals/VideoGenerationTab.tsx
git commit -m "$(cat <<'EOF'
feat(video): pipeline clássico usa o provider configurado no admin

start-job lê o default (Veo/Kling), grava no doc do job e cada shot
passa a ir pelo dispatcher runClipGeneration em vez de chamar o Veo
direto — sem mudar a montagem por ffmpeg.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Pipeline UGC usa o provider (`server/ugcVideoAgent.ts`)

**Files:**
- Modify: `server/ugcVideoAgent.ts`
- Modify: `src/services/ugcVideoService.ts`
- Modify: `src/components/modals/UgcVideoGenerationTab.tsx`

**Interfaces:**
- Consumes: os mesmos de Task 5 (`getDefaultVideoProvider`, `ClipReferenceImage`, `runClipGeneration`).
- Produces: campo `provider` em `users/{uid}/ugcVideoJobs/{jobId}` e no tipo `UgcVideoJob` do client.

- [ ] **Step 1: Import novo em `server/ugcVideoAgent.ts`**

Mesma razão da Task 5, Step 1 — `VEO_MODEL` e `VideoGenerationReferenceType` deixam de ser usados diretamente. Trocar o bloco de import de `./videoShared` (linhas 13-18) por:

```ts
import {
  getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError,
  VIDEO_ASPECT_RATIO,
  getVeoClient, resizeForReference, runFfmpeg,
  debitCreditsAdmin, refundCreditsAdmin, assertNoActiveVideoJob, now, STORAGE_BUCKET,
  getDefaultVideoProvider, PRODUCT_REFERENCE_PROMPT_LINE, PRODUCT_REFERENCE_NEGATIVE, CAMERA_VARIETY_RULE,
  type ClipReferenceImage, type VideoProvider,
} from './videoShared';
import { runClipGeneration } from './videoProviders';
```

- [ ] **Step 2: Propagar a URL original junto do base64 (`start-job`)**

No `POST /api/video/ugc/start-job` (linhas 398-409), trocar os tipos locais e a resolução do provider:

```ts
      let avatarImage: { base64: string; mimeType: string; url: string };
      let productImage: { base64: string; mimeType: string; url: string };
      let productReference: { base64: string; mimeType: string; url: string } | null = null;
      let provider: VideoProvider;
      try {
        provider = await getDefaultVideoProvider();
        await jobRef.set({
          jobId, productId, status: 'queued', provider, videoUrl: null, error: null, createdAt: now(), updatedAt: now(),
        });
        const [avatarFetched, productFetched, referenceFetched] = await Promise.all([
          fetchImageAsBase64(avatarImageUrl),
          fetchImageAsBase64(productImageUrl),
          productReferenceUrl ? fetchImageAsBase64(productReferenceUrl) : Promise.resolve(null),
        ]);
        avatarImage = { ...avatarFetched, url: avatarImageUrl };
        productImage = { ...productFetched, url: productImageUrl };
        productReference = referenceFetched ? { ...referenceFetched, url: productReferenceUrl! } : null;
      } catch (prepErr) {
```

(o resto do `catch`/refund e a atualização de `_ugcVideoStatus: 'queued'` no produto não mudam.)

Na chamada de `runUgcVideoJob` (linha ~434), passar `provider`:

```ts
        await runUgcVideoJob(decoded.uid, jobId, productId, script, avatarImage, productImage, productReference, creditCost, creditMeta, provider);
```

- [ ] **Step 3: Atualizar `runUgcVideoJob` e `generateUgcClip`**

`generateUgcClip` (linha 180) recebe `provider` e troca a chamada Veo direta pelo dispatcher:

```ts
async function generateUgcClip(
  ai: GoogleGenAI,
  jobId: string,
  index: number,
  clip: UgcVideoClip,
  cena: string,
  avatarDescricao: string,
  avatarImage: { base64: string; mimeType: string; url: string },
  productImage: { base64: string; mimeType: string; url: string },
  productReference: { base64: string; mimeType: string; url: string } | null,
  workDir: string,
  provider: VideoProvider,
): Promise<string> {
  const [avatarResized, productResized, referenceResized] = await Promise.all([
    resizeForReference(Buffer.from(avatarImage.base64, 'base64')),
    resizeForReference(Buffer.from(productImage.base64, 'base64')),
    productReference ? resizeForReference(Buffer.from(productReference.base64, 'base64')) : Promise.resolve(null),
  ]);
  const { prompt, negativePrompt } = buildUgcClipPrompt({ cena, avatarDescricao, clip, hasProductReference: !!referenceResized });

  const referenceImages: ClipReferenceImage[] = [
    { url: avatarImage.url, base64: avatarResized.base64, mimeType: avatarResized.mimeType },
    { url: productImage.url, base64: productResized.base64, mimeType: productResized.mimeType },
    ...(referenceResized && productReference
      ? [{ url: productReference.url, base64: referenceResized.base64, mimeType: referenceResized.mimeType }]
      : []),
  ];

  console.log(`[ugc-video] clip ${index + 1} (${clip.papel}) generate jobId=${jobId} provider=${provider}`);
  const videoBytes = await runClipGeneration(provider, ai, jobId, `clip#${index + 1}`, {
    prompt,
    negativePrompt,
    durationSeconds: 8,
    aspectRatio: VIDEO_ASPECT_RATIO,
    generateAudio: true,
    referenceImages,
  });

  const segPath = path.join(workDir, `clip${index}.mp4`);
  await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
  return segPath;
}
```

`runUgcVideoJob` (linha 247) ganha `provider: VideoProvider` no fim da assinatura (mesmo padrão de `runVideoJob`) e repassa pra `generateUgcClip`:

```ts
async function runUgcVideoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: UgcVideoScript,
  avatarImage: { base64: string; mimeType: string; url: string },
  productImage: { base64: string; mimeType: string; url: string },
  productReference: { base64: string; mimeType: string; url: string } | null,
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
  provider: VideoProvider,
): Promise<void> {
```

E na chamada dentro do `Promise.all` (linha ~270):

```ts
        const segPath = await generateUgcClip(ai, jobId, i, clip, script.cena, script.avatarDescricao, avatarImage, productImage, productReference, workDir, provider);
```

- [ ] **Step 4: Campo `provider` no tipo do client (`src/services/ugcVideoService.ts`)**

No `interface UgcVideoJob` (linha 22):

```ts
export interface UgcVideoJob {
  jobId: string;
  productId: string;
  status: UgcVideoJobStatus;
  provider?: 'veo' | 'kling';
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  clipsDone?: number;
  totalClips?: number;
  step?: UgcVideoJobStep;
}
```

- [ ] **Step 5: Badge do provider na tela de sucesso (`UgcVideoGenerationTab.tsx`)**

No bloco de sucesso (linha 348-351), mesmo padrão da Task 5, Step 5:

```tsx
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-3 rounded-xl text-sm font-bold border border-green-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> Vídeo gerado com sucesso!
                {job.provider && (
                  <span className="ml-auto text-xs font-semibold text-green-600 bg-white/60 px-2 py-0.5 rounded-full">
                    {job.provider === 'kling' ? 'Kling' : 'Veo 3'}
                  </span>
                )}
              </div>
```

- [ ] **Step 6: Checar tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 7: Validar manualmente**

Mesmo roteiro da Task 5, Step 7, agora no fluxo UGC: gerar um vídeo com "Veo 3" selecionado (deve sair idêntico a antes), trocar pra "Kling" com `OPENROUTER_API_KEY` configurada e gerar outro — **prestar atenção especial em como a fala do avatar sai** (é o risco anotado na spec: incerto se `generate_audio: true` da Kling produz fala sincronizada de verdade). Registrar o resultado — se a qualidade for ruim, o admin já pode voltar pro Veo sem deploy.

- [ ] **Step 8: Commit**

```bash
git add server/ugcVideoAgent.ts src/services/ugcVideoService.ts src/components/modals/UgcVideoGenerationTab.tsx
git commit -m "$(cat <<'EOF'
feat(video): pipeline UGC usa o provider configurado no admin

Mesma mudança da Task 5, no fluxo com avatar: start-job resolve e
grava o provider, generateUgcClip passa pelo dispatcher
runClipGeneration.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: QA manual de ponta a ponta

**Files:** nenhum (só validação — projeto não tem suíte automatizada de integração).

- [ ] **Step 1: Rodar `npm run lint` no branch inteiro**

Run: `npm run lint`
Expected: sem erros em nenhum arquivo tocado pelas Tasks 1-6.

- [ ] **Step 2: Rodar o verify script completo**

Run: `npx tsx scripts/verify-video-providers.mjs`
Expected: `Todas as verificações passaram.`, exit code 0.

- [ ] **Step 3: Cenário — doc de config ausente (instalação nova)**

Num ambiente sem `platform_settings/video` criado ainda: abrir `/admin/video`, confirmar que mostra "Veo 3" como selecionado sem erro. Gerar um vídeo clássico normalmente (sem escolher nada no admin) e confirmar que usa Veo — `job.provider === 'veo'` no Firestore.

- [ ] **Step 4: Cenário — troca de provider no meio de um job**

Com "Veo 3" selecionado, iniciar um vídeo clássico. Enquanto o job está `processing`, ir em `/admin/video` e trocar para "Kling". Confirmar que esse job em andamento **termina como Veo** (campo `provider` gravado no doc do job não muda) e que um **novo** job iniciado depois da troca sai como `'kling'`.

- [ ] **Step 5: Cenário — `OPENROUTER_API_KEY` ausente com Kling selecionada**

Remover/comentar `OPENROUTER_API_KEY` do `.env` local, reiniciar o dev server, com "Kling" selecionada no admin. Iniciar um vídeo (clássico ou UGC) e confirmar que o job termina em `status: 'error'` com uma mensagem clara mencionando a chave ausente, os créditos são estornados, e o usuário não fica travado em "Aguardando na fila" para sempre.

- [ ] **Step 6: Cenário — `PUT /api/admin/video-settings` com valor inválido**

Via `curl` ou o painel adulterado no DevTools, mandar `{"defaultProvider": "sora"}`. Confirmar resposta `422` e que `GET /api/admin/video-settings` continua retornando o valor anterior (nada foi sobrescrito).

- [ ] **Step 7: Cenário — vídeo completo com Kling nos dois modos**

Com `OPENROUTER_API_KEY` real configurada e "Kling" selecionada: gerar um vídeo clássico completo (4 shots + narração TTS + legendas) e um vídeo UGC completo (avatar falando) de ponta a ponta, confirmar que os dois terminam com `videoUrl` funcional, tocável no player, e badge "Kling" visível. Anotar qualidade da fala/lip sync do UGC — é o item sinalizado como risco na spec.

Nenhum passo deste plano requer alterar `firestore.rules` — confirmar ao final que o arquivo permanece intocado (`git diff --stat firestore.rules` vazio).
