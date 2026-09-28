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
