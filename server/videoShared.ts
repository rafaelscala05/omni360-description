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
import { assertSafeImageUrl } from './safeUrl';

export { VideoGenerationReferenceType };

export const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
export const GCP_PROJECT = firebaseAppletConfig.projectId;
export const VEO_MODEL = 'veo-3.1-fast-generate-001';
export const TEXT_MODEL = 'gemini-2.5-flash';
export const VIDEO_ASPECT_RATIO = '9:16';
export const REFERENCE_MAX_DIM = 1024;

// Product Reference sheet (src/services/productReferenceService.ts): a grid of the
// product from several angles + labelled detail close-ups, sent to Veo as an extra
// ASSET reference by both pipelines. It is a map, not a shot — without these lines
// Veo tends to reproduce the grid/labels on screen.
export const PRODUCT_REFERENCE_PROMPT_LINE =
  'REFERÊNCIA DO PRODUTO: uma das imagens de referência é uma folha técnica com o produto em vários ângulos e close-ups dos detalhes. Use-a só para reproduzir o produto com fidelidade total em qualquer ângulo (formato, cores, logotipos, textos, materiais, cada detalhe). Nunca mostre a folha, a grade, os rótulos nem o fundo branco dela no vídeo.';
export const PRODUCT_REFERENCE_NEGATIVE = 'colagem, grade de imagens, folha de referência na tela, rótulos de texto, fundo branco de estúdio';

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

// Same Storage cap as the client upload rule (15 MB) — a larger body is never a real photo.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// The video routes fetch image URLs sent by the client, so this refuses internal
// destinations (SSRF) and redirects — a safe host must not bounce us to an internal one
// after the DNS check — and caps the body size.
export async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  await assertSafeImageUrl(url);
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`Falha ao buscar imagem: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('Imagem muito grande (máximo 15 MB).'), { status: 400 });
  }
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

// A queued/processing job whose doc hasn't been touched for this long is treated as
// dead (the server instance that ran it was killed): jobs write to their doc on every
// clip/step, so a healthy one never goes this quiet. Keeps a crashed job from locking
// the user out of video generation forever.
export const VIDEO_JOB_STALE_MS = 30 * 60 * 1000;

export function isVideoJobActive(
  job: { status?: string; updatedAt?: string },
  nowMs: number = Date.now(),
): boolean {
  if (job.status !== 'queued' && job.status !== 'processing') return false;
  const updated = Date.parse(job.updatedAt ?? '');
  if (Number.isNaN(updated)) return false;
  return nowMs - updated < VIDEO_JOB_STALE_MS;
}

// Classic and UGC video both hit the same Veo quota: only one job (of either kind) may
// run per user at a time. Decided from the JOB docs, which the server owns and always
// finishes as done/error — unlike the product-level flags the client persists, which
// the classic pipeline never clears.
export async function assertNoActiveVideoJob(uid: string): Promise<void> {
  const userRef = adminDb.collection('users').doc(uid);
  const snaps = await Promise.all(
    ['videoJobs', 'ugcVideoJobs'].map((col) =>
      userRef.collection(col).where('status', 'in', ['queued', 'processing']).get(),
    ),
  );
  const active = snaps.some((snap) => snap.docs.some((d) => isVideoJobActive(d.data() as any)));
  if (active) {
    throw Object.assign(
      new Error('Já existe um vídeo em produção. Aguarde a conclusão para iniciar outro.'),
      { status: 409 },
    );
  }
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
