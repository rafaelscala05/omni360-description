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
