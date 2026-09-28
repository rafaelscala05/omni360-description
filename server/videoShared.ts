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
import { adminDb, adminStorage } from './firebaseAdmin';
import { resolveCreditCost } from '../src/credits';
import type { CreditAction } from '../src/credits';
import { FieldValue } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';
import { assertSafeImageUrl } from './safeUrl';

export { VideoGenerationReferenceType };

import type { VideoProvider } from '../src/types/crm';
export type { VideoProvider };

// Formato de entrada comum aos dois providers (Veo, Seedance) — cada agente
// (videoAgent.ts, ugcVideoAgent.ts) monta isto uma vez por shot/clipe; o
// dispatcher runClipGeneration (server/videoProviders.ts) decide o que
// repassar pra Veo ou pra Seedance.
export interface ClipReferenceImage {
  // É o que o Seedance usa (image_url, HTTPS público — a cópia feita por
  // stageReferenceImages). Ausente só em imagens montadas no servidor que vão
  // apenas para o Veo (o painel de fotos de buildPhotoPanel).
  url?: string;
  base64?: string;   // presente quando o provider é 'veo' (fetch/resize já feito)
  mimeType?: string;
  // O que a imagem é ("avatar", "foto real do produto"…). O Seedance só vê a
  // ordem do array; buildSeedanceRequestBody transforma isto em "@Image1 = …"
  // no prompt para o modelo saber qual referência é a pessoa e qual o produto.
  papel: string;
}

export interface ClipGenerationRequest {
  prompt: string;
  negativePrompt?: string; // Seedance não tem campo — vira uma linha "EVITE:" no prompt
  durationSeconds: number;
  aspectRatio: string;
  generateAudio: boolean;
  referenceImages: ClipReferenceImage[];
}

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
// Shared by both script prompts: each shot/clip is joined by hard cuts, so the
// only thing that makes the cut feel dynamic is a different camera angle per
// shot — and the video model only sees the angle if the script's action text
// states it. The variety is bounded by PRODUCT_COVERAGE_RULE: an angle no real
// photo shows (top, back, underside) forces the model to invent that side of
// the product, which is exactly the failure this whole flow exists to avoid.
export const CAMERA_VARIETY_RULE = `- DINÂMICA DE CÂMERA (obrigatório): cada shot/clipe usa um ENQUADRAMENTO e um MOVIMENTO de câmera DIFERENTES dos outros — nunca repita o mesmo em dois cortes seguidos. Varie a DISTÂNCIA (close-up/plano detalhe, plano médio, plano aberto) e o MOVIMENTO (dolly-in, dolly-out, travelling lateral curto, pan, tilt, câmera na mão), mas o LADO do produto voltado para a câmera só pode ser um dos lados que aparecem nas FOTOS REAIS anexadas (frente, lateral, 3/4, cima… apenas se houver foto desse lado). Nunca use órbita/giro completo, vista de cima, de baixo ou de trás se nenhuma foto mostra o produto por esse lado.
- O texto da ação de cada shot/clipe COMEÇA pelo enquadramento, no formato "Câmera: <ângulo> + <movimento>. <o que acontece>" (ex.: "Câmera: close-up frontal, dolly-in lento. A mão aponta o detalhe do logotipo.").`;

// O produto só pode aparecer como as fotos reais o mostram: tudo que não foi
// fotografado (verso, fundo, interior, o produto aberto/ligado/montado) o
// modelo de vídeo precisa inventar — e inventa errado.
export const PRODUCT_COVERAGE_RULE = `- SÓ O QUE FOI FOTOGRAFADO (obrigatório): mostre o produto apenas nos lados, partes e estados que aparecem nas FOTOS REAIS anexadas. Nunca revele o verso, o fundo, a parte de baixo ou o interior se nenhuma foto os mostra. Nunca peça para abrir, destampar, desmontar, dobrar, desdobrar, montar, vestir, encaixar, ligar ou acionar o produto se as fotos não mostram esse estado — nesse caso a interação é segurar, aproximar, apontar detalhes visíveis e posicionar o produto em cena.`;

// Versão de uma linha para o prompt de cada clipe (o modelo de vídeo, não o roteirista).
export const PRODUCT_COVERAGE_CLIP_LINE =
  'LIMITE DO PRODUTO: mostre o produto somente pelos lados e nos estados que aparecem nas fotos reais de referência. Nunca revele partes não fotografadas (verso, fundo, interior) nem mude o estado do produto (abrir, desmontar, ligar, dobrar) se isso não aparece nas fotos.';
export const PRODUCT_COVERAGE_NEGATIVE =
  'lado do produto não mostrado nas fotos, verso inventado, interior inventado, produto aberto ou desmontado sem referência';

// Veo 3.1 aceita no máximo 3 referências ASSET por geração; o painel junta
// todas as fotos reais escolhidas numa vaga só.
export const VEO_MAX_REFERENCE_IMAGES = 3;
export const PHOTO_PANEL_PROMPT_LINE =
  'FOTOS REAIS: uma das imagens de referência é um painel com fotos reais do produto lado a lado. Use-o como a verdade sobre a aparência do produto (cores, materiais, logotipos, proporções). Nunca mostre o painel, a grade nem as bordas dele no vídeo.';
export const PHOTO_PANEL_NEGATIVE = 'painel de fotos na tela, grade de fotos, mosaico';

// Fotos reais que o cliente pode mandar por job (a UI limita a seleção ao mesmo número).
export const MAX_PRODUCT_PHOTOS = 8;

// Fotos vindas do cliente: só strings não vazias, sem repetição, no máximo
// MAX_PRODUCT_PHOTOS (a UI já limita — isto é o teto do servidor).
export function sanitizePhotoUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const clean = urls.filter((u): u is string => typeof u === 'string' && !!u.trim()).map((u) => u.trim());
  return Array.from(new Set(clean)).slice(0, MAX_PRODUCT_PHOTOS);
}

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

// Imagem de referência pronta para qualquer provider: já baixada (com a
// proteção SSRF de fetchImageAsBase64), reduzida para JPEG e, quando o
// provider lê por URL, copiada para o nosso Storage.
export interface PreparedImage {
  base64: string;
  mimeType: string;
  url: string; // a cópia no Storage (Seedance) ou a URL original (Veo, que usa só os bytes)
}

// Baixa e reduz cada URL uma vez só, mesmo que apareça repetida (a mesma
// cena em dois shots), devolvendo um Map pela URL original.
export async function prepareReferenceImages(urls: string[]): Promise<Map<string, PreparedImage>> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const out = new Map<string, PreparedImage>();
  await Promise.all(unique.map(async (url) => {
    const fetched = await fetchImageAsBase64(url);
    const resized = await resizeForReference(Buffer.from(fetched.base64, 'base64'));
    out.set(url, { ...resized, url });
  }));
  return out;
}

const STAGED_REFERENCES_PREFIX = 'video-refs';

// O Seedance (via OpenRouter) baixa as referências sozinho e só aceita HTTPS
// público, direto, sem redirect/cookie/anti-bot. As fotos do produto vêm de
// qualquer lugar (CDN do ERP, da loja, http://…), então cada imagem já
// reduzida é regravada no nosso bucket e é essa URL que vai para o provider.
// A URL com token de download não depende das rules nem do IAM do bucket.
// Troca o `url` de cada imagem pela cópia, no próprio Map.
export async function stageReferenceImages(uid: string, jobId: string, images: Map<string, PreparedImage>): Promise<void> {
  const bucket = adminStorage.bucket(STORAGE_BUCKET);
  let index = 0;
  await Promise.all(Array.from(images.values()).map(async (img) => {
    const storagePath = `${STAGED_REFERENCES_PREFIX}/${uid}/${jobId}/${index++}.jpg`;
    const token = crypto.randomUUID();
    await bucket.file(storagePath).save(Buffer.from(img.base64, 'base64'), {
      contentType: img.mimeType,
      resumable: false,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    img.url = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  }));
}

// Chamado no fim do job (sucesso ou erro): depois que o vídeo foi baixado o
// provider não precisa mais das cópias.
export async function deleteStagedReferences(uid: string, jobId: string): Promise<void> {
  await adminStorage.bucket(STORAGE_BUCKET)
    .deleteFiles({ prefix: `${STAGED_REFERENCES_PREFIX}/${uid}/${jobId}/` })
    .catch((err) => console.warn(`[video] falha ao apagar referências temporárias jobId=${jobId}:`, err));
}

// Junta as fotos reais numa grade (fundo branco, cada foto inteira na sua
// célula) para caber numa única vaga de referência do Veo. Com uma foto só,
// devolve a própria foto.
export async function buildPhotoPanel(photos: PreparedImage[]): Promise<{ base64: string; mimeType: string }> {
  if (photos.length === 0) throw new Error('buildPhotoPanel precisa de ao menos uma foto');
  if (photos.length === 1) return { base64: photos[0].base64, mimeType: photos[0].mimeType };
  const cols = Math.ceil(Math.sqrt(photos.length));
  const rows = Math.ceil(photos.length / cols);
  const cell = 512;
  const gap = 16;
  const cells = await Promise.all(photos.map((p) =>
    sharp(Buffer.from(p.base64, 'base64'))
      .resize({ width: cell, height: cell, fit: 'contain', background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer()));
  const panel = await sharp({
    create: {
      width: cols * cell + (cols + 1) * gap,
      height: rows * cell + (rows + 1) * gap,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(cells.map((input, i) => ({
      input,
      left: gap + (i % cols) * (cell + gap),
      top: gap + Math.floor(i / cols) * (cell + gap),
    })))
    .jpeg({ quality: 90 })
    .toBuffer();
  return resizeForReference(panel);
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

// Lê users/platform_settings/video no client seria negado pelas rules (não há
// nenhum match cobrindo essa coleção) — só o Admin SDK acessa. Ausência do doc
// (instalação nova) ou de valor reconhecido cai em 'veo', o provider seguro.
// 'kling' é o valor legado de quando o provider alternativo era a Kling — foi
// substituída pelo Seedance no mesmo lugar, então quem escolheu Kling no admin
// passa a gerar com Seedance sem precisar reescolher.
export function resolveVideoProvider(data?: { defaultProvider?: unknown }): VideoProvider {
  const value = data?.defaultProvider;
  return value === 'seedance' || value === 'kling' ? 'seedance' : 'veo';
}

export async function getDefaultVideoProvider(): Promise<VideoProvider> {
  const snap = await adminDb.collection('platform_settings').doc('video').get();
  return resolveVideoProvider(snap.exists ? (snap.data() as { defaultProvider?: unknown }) : undefined);
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
