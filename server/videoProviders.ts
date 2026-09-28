// server/videoProviders.ts
//
// Tudo que é específico da geração de vídeo via Seedance 2.5 (ByteDance, pela
// API de vídeo da OpenRouter) + o dispatcher que escolhe entre Veo e Seedance.
// Substituiu a Kling (kwaivgi/kling-v3.0-std) no mesmo lugar — o transporte
// (POST /videos → polling_url → unsigned_urls) é o mesmo para qualquer modelo
// de vídeo da OpenRouter; ver
// docs/superpowers/specs/2026-09-28-video-provider-kling-design.md.
// server/videoShared.ts continua dono de tudo que é genérico entre os dois
// providers.
import type { GoogleGenAI } from '@google/genai';
import {
  buildVeoRequest,
  runVeoOperation,
  type ClipGenerationRequest,
  type VideoProvider,
} from './videoShared';

export const SEEDANCE_MODEL = 'bytedance/seedance-2.5';
export const SEEDANCE_RESOLUTION = '720p';
// Limites do bytedance/seedance-2.5 na OpenRouter (GET /api/v1/videos/models):
// duração de 4 a 30s. O teto de imagens é o da família Seedance 2.x no
// reference-to-video (9 imagens); a 2.5 anuncia mais, mas 9 é o que a
// documentação dos providers confirma.
export const SEEDANCE_MAX_DURATION_SECONDS = 30;
export const SEEDANCE_MAX_REFERENCE_IMAGES = 9;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw Object.assign(new Error('OPENROUTER_API_KEY não configurada'), { status: 500 });
  return key;
}

// O Seedance só distingue as referências pela ordem do array e pelas menções
// @Image1, @Image2… no prompt (convenção do reference-to-video da família 2.x).
// Sem esse mapa, "a imagem de referência de pessoa" no prompt não aponta para
// nenhuma imagem específica — e o modelo pode trocar avatar e produto.
export function buildSeedancePrompt(request: ClipGenerationRequest): string {
  const refs = request.referenceImages.map((img, i) => `@Image${i + 1} = ${img.papel}`);
  return [
    ...(refs.length ? ['REFERÊNCIAS (imagens anexadas, na ordem):', ...refs, ''] : []),
    request.prompt,
    ...(request.negativePrompt ? ['', `EVITE: ${request.negativePrompt}`] : []),
  ].join('\n');
}

export function buildSeedanceRequestBody(request: ClipGenerationRequest): Record<string, unknown> {
  return {
    model: SEEDANCE_MODEL,
    prompt: buildSeedancePrompt(request),
    duration: request.durationSeconds,
    aspect_ratio: request.aspectRatio,
    // Sem isto o provider pode cair em 480p — detalhe de logo/texto do produto
    // é o primeiro a se perder em resolução baixa.
    resolution: SEEDANCE_RESOLUTION,
    generate_audio: request.generateAudio,
    input_references: request.referenceImages.map((img) => {
      if (!img.url) throw new Error(`referência "${img.papel}" sem URL — obrigatória para o provider Seedance`);
      return { type: 'image_url', image_url: { url: img.url } };
    }),
  };
}

const SEEDANCE_RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SEEDANCE_MAX_RETRIES = 3;
const SEEDANCE_DEFAULT_RETRY_DELAYS = [30_000, 60_000, 120_000];
const SEEDANCE_DEFAULT_POLL_INTERVAL = 15_000;
// Abaixo do VIDEO_JOB_STALE_MS (30min) de videoShared.ts — se o Seedance nunca
// termina, o job falha por aqui bem antes de qualquer outro código precisar
// tratar um job "processing" zumbi.
const SEEDANCE_DEFAULT_MAX_POLL_MS = 20 * 60_000;
// Únicos status "em andamento" documentados — qualquer outra coisa (cancelled,
// expired, um nome novo que o Seedance passe a usar) é tratado como falha
// terminal não-retentável, nunca como "continue esperando pra sempre".
const SEEDANCE_IN_PROGRESS_STATUSES = new Set(['pending', 'queued', 'in_progress', 'processing']);

function isRetryableSeedanceError(err: unknown, attempt: number): boolean {
  const httpStatus = (err as { httpStatus?: number }).httpStatus;
  const nonRetryable = (err as { nonRetryable?: boolean }).nonRetryable === true;
  return !nonRetryable && attempt < SEEDANCE_MAX_RETRIES && (httpStatus === undefined || SEEDANCE_RETRYABLE_HTTP_STATUS.has(httpStatus));
}

// Cada fase (submit/poll/download) retenta só a SI MESMA. Antes, um poll ou
// download transitório caía no mesmo retry que o submit e comprava uma nova
// geração paga do zero a cada tentativa — até 3x por chamada, x4 shots em
// paralelo. Ver docs/superpowers/plans/2026-09-28-video-provider-kling.md
// (achado do code review de 2026-09-28).
async function withSeedanceRetry<T>(jobId: string, label: string, phase: string, retryDelaysMs: number[], fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SEEDANCE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = retryDelaysMs[attempt - 1];
      console.log(`[video] ${label} seedance ${phase} retry attempt=${attempt} after=${delay / 1000}s jobId=${jobId}`);
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isRetryableSeedanceError(err, attempt)) {
        console.warn(`[video] ${label} seedance ${phase} transient error, will retry (${attempt + 1}/${SEEDANCE_MAX_RETRIES}) jobId=${jobId}:`, (err as Error).message);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function submitSeedanceJob(apiKey: string, request: ClipGenerationRequest): Promise<{ pollingUrl: string; status: string }> {
  const submitRes = await fetch(`${OPENROUTER_BASE_URL}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSeedanceRequestBody(request)),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => '');
    throw Object.assign(new Error(`Seedance submit falhou (${submitRes.status}): ${text.slice(0, 300)}`), { httpStatus: submitRes.status });
  }
  const submitData = (await submitRes.json()) as { id?: string; polling_url?: string; status?: string };
  if (!submitData.polling_url || !submitData.status) {
    throw Object.assign(new Error('Seedance retornou resposta de submit sem polling_url/status'), { nonRetryable: true });
  }
  const pollingUrl = submitData.polling_url.startsWith('http')
    ? submitData.polling_url
    : `https://openrouter.ai${submitData.polling_url}`;
  return { pollingUrl, status: submitData.status };
}

async function pollSeedanceOnce(apiKey: string, pollingUrl: string): Promise<{ status: string; unsignedUrls?: string[] }> {
  const pollRes = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!pollRes.ok) {
    throw Object.assign(new Error(`Seedance poll falhou (${pollRes.status})`), { httpStatus: pollRes.status });
  }
  const pollData = (await pollRes.json()) as { status: string; unsigned_urls?: string[] };
  return { status: pollData.status, unsignedUrls: pollData.unsigned_urls };
}

async function pollSeedanceUntilTerminal(
  apiKey: string,
  jobId: string,
  label: string,
  pollingUrl: string,
  initialStatus: string,
  pollIntervalMs: number,
  retryDelaysMs: number[],
  maxPollMs: number,
): Promise<string> {
  let status = initialStatus;
  let unsignedUrls: string[] | undefined;
  const deadline = Date.now() + maxPollMs;
  let pollCount = 0;
  while (status !== 'completed' && status !== 'failed') {
    if (!SEEDANCE_IN_PROGRESS_STATUSES.has(status)) {
      throw Object.assign(new Error(`Seedance retornou status desconhecido "${status}" (${label})`), { nonRetryable: true });
    }
    if (Date.now() > deadline) {
      throw Object.assign(new Error(`Seedance excedeu o tempo máximo de espera (${label})`), { nonRetryable: true });
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const pollData = await withSeedanceRetry(jobId, label, 'poll', retryDelaysMs, () => pollSeedanceOnce(apiKey, pollingUrl));
    status = pollData.status;
    unsignedUrls = pollData.unsignedUrls;
    pollCount++;
    console.log(`[video] polling jobId=${jobId} ${label} seedance attempt=${pollCount} status=${status}`);
  }
  // Falha de geração (ex.: política de conteúdo) é determinística — retentar
  // gastaria mais 3x créditos/tempo pro mesmo resultado.
  if (status === 'failed') {
    throw Object.assign(new Error(`Seedance não conseguiu gerar o vídeo (${label})`), { nonRetryable: true });
  }
  const unsignedUrl = unsignedUrls?.[0];
  if (!unsignedUrl) {
    throw Object.assign(new Error(`Seedance não retornou unsigned_urls (${label})`), { nonRetryable: true });
  }
  return unsignedUrl;
}

async function downloadSeedanceVideo(apiKey: string, jobId: string, label: string, unsignedUrl: string, retryDelaysMs: number[]): Promise<string> {
  return withSeedanceRetry(jobId, label, 'download', retryDelaysMs, async () => {
    // unsigned_urls pode apontar pra um CDN fora do controle da OpenRouter — a
    // chave da plataforma só vai junto quando o host é mesmo a própria OpenRouter.
    let isOpenRouterHost = false;
    try {
      isOpenRouterHost = new URL(unsignedUrl).origin === new URL(OPENROUTER_BASE_URL).origin;
    } catch {
      isOpenRouterHost = false;
    }
    const videoRes = await fetch(unsignedUrl, isOpenRouterHost ? { headers: { Authorization: `Bearer ${apiKey}` } } : {});
    if (!videoRes.ok) {
      throw Object.assign(new Error(`Download do vídeo Seedance falhou (${videoRes.status})`), { httpStatus: videoRes.status });
    }
    const buffer = await videoRes.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  });
}

export async function runSeedanceOperation(
  jobId: string,
  label: string,
  request: ClipGenerationRequest,
  opts: { pollIntervalMs?: number; retryDelaysMs?: number[]; maxPollMs?: number } = {},
): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  const pollIntervalMs = opts.pollIntervalMs ?? SEEDANCE_DEFAULT_POLL_INTERVAL;
  const retryDelaysMs = opts.retryDelaysMs ?? SEEDANCE_DEFAULT_RETRY_DELAYS;
  const maxPollMs = opts.maxPollMs ?? SEEDANCE_DEFAULT_MAX_POLL_MS;

  const { pollingUrl, status } = await withSeedanceRetry(jobId, label, 'submit', retryDelaysMs, () => submitSeedanceJob(apiKey, request));
  const unsignedUrl = await pollSeedanceUntilTerminal(apiKey, jobId, label, pollingUrl, status, pollIntervalMs, retryDelaysMs, maxPollMs);
  const videoBytes = await downloadSeedanceVideo(apiKey, jobId, label, unsignedUrl, retryDelaysMs);
  console.log(`[video] ${label} seedance done jobId=${jobId}`);
  return videoBytes;
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
  if (provider === 'seedance') return runSeedanceOperation(jobId, label, request);
  return runVeoOperation(ai, jobId, label, buildVeoRequest(request));
}
