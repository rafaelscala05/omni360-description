import type express from 'express';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost } from '../src/credits';
import type { CreditAction } from '../src/credits';
import { FieldValue } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';

const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
const GCP_PROJECT = firebaseAppletConfig.projectId;
const VEO_MODEL = 'veo-3.1-fast-generate-001';
const TEXT_MODEL = 'gemini-2.5-flash';

// Output video is always 9:16 (vertical/portrait) for marketplace product pages.
// The product image is pre-cropped to the same 9:16 ratio to match.
const VIDEO_ASPECT_RATIO = '9:16';
const INPUT_IMAGE_W = 720;
const INPUT_IMAGE_H = 1280; // 9:16 portrait crop

// Background music + TTS voice for the final mix. The audio is added AFTER the
// video is generated (segments are generated MUTE), so there is never any lip
// sync — the narration is always a voice-over on top of the footage.
const MUSIC_PATH = path.join(process.cwd(), 'server', 'assets', 'background-music.mp3');
const TTS_VOICE = 'pt-BR-Neural2-B';
const TTS_LANGUAGE = 'pt-BR';

// Veo 3.1 generates at most 8s per call. To reach ~30s we generate four shots
// and concatenate them with ffmpeg. The shots follow an e-commerce 3-act
// structure: Início (hook) → Meio (uso + benefícios) → Fim (CTA). Each shot's
// last frame seeds the next shot so the footage stays visually continuous.
const SHOTS = [
  { key: 'inicio', seconds: 8, ato: 'INÍCIO — Hook (chama atenção e apresenta o produto)' },
  { key: 'meioDemonstracao', seconds: 8, ato: 'MEIO — Demonstração do produto em uso/funcionamento' },
  { key: 'meioBeneficios', seconds: 8, ato: 'MEIO — Close-ups destacando atributos e benefícios' },
  { key: 'fim', seconds: 6, ato: 'FIM — Fechamento e chamada para ação' },
] as const;

interface VideoScriptShot {
  acao: string;
  narracao: string;
}

interface VideoScript {
  cena: string;
  trilha: string;
  inicio: VideoScriptShot;
  meioDemonstracao: VideoScriptShot;
  meioBeneficios: VideoScriptShot;
  fim: VideoScriptShot;
}

interface VideoDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<import('firebase-admin/auth').DecodedIdToken>;
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY não configurada'), { status: 500 });
  return new GoogleGenAI({ apiKey });
}

function getVeoClient() {
  return new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location: 'us-central1',
  });
}

function now() {
  return new Date().toISOString();
}

function sendError(res: express.Response, err: unknown) {
  const status = (err as any)?.status ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao buscar imagem: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return { base64, mimeType };
}

// Crops the image to 9:16 portrait (centered) so it matches the vertical output video.
async function cropToPortrait(inputBuffer: Buffer): Promise<{ base64: string; mimeType: string }> {
  const portrait = await sharp(inputBuffer)
    .resize({
      width: INPUT_IMAGE_W,
      height: INPUT_IMAGE_H,
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { base64: portrait.toString('base64'), mimeType: 'image/jpeg' };
}

// ---------------------------------------------------------------------------
// ffmpeg helpers (uses the bundled ffmpeg-static binary, no system install)
// ---------------------------------------------------------------------------

function runFfmpeg(args: string[]): Promise<void> {
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

// Grabs the last frame of a clip as a JPEG — used to seed the next shot so the
// generated footage stays visually continuous across segments.
async function extractLastFrame(videoPath: string, outJpgPath: string): Promise<{ base64: string; mimeType: string }> {
  await runFfmpeg(['-y', '-sseof', '-0.2', '-i', videoPath, '-update', '1', '-frames:v', '1', '-q:v', '2', outJpgPath]);
  const buf = await fs.readFile(outJpgPath);
  return { base64: buf.toString('base64'), mimeType: 'image/jpeg' };
}

// Concatenates the silent shots into one continuous clip. Re-encodes (instead
// of stream copy) because the shots are generated independently and may differ
// slightly in timebase/SAR, which would break a `-c copy` concat. Output is
// muted — the narration + music are mixed in afterwards.
async function concatVideos(segmentPaths: string[], workDir: string, outPath: string): Promise<void> {
  const listPath = path.join(workDir, 'concat.txt');
  const list = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list, 'utf8');
  await runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-an', outPath,
  ]);
}

// Mixes the muted video with a continuous TTS voice-over and a looped, low
// background-music bed. Output length is bounded by the video (-shortest),
// music loops forever (-stream_loop -1) and narration is padded with silence.
async function mixAudio(videoPath: string, narrationPath: string, musicPath: string, outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i', videoPath,
    '-stream_loop', '-1', '-i', musicPath,
    '-i', narrationPath,
    '-filter_complex',
    '[1:a]volume=0.14[mus];[2:a]volume=1.6[nar];[mus][nar]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]',
    '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    outPath,
  ]);
}

// ---------------------------------------------------------------------------
// Text-to-speech (Google Cloud TTS, shares the server's ADC credentials)
// ---------------------------------------------------------------------------

async function synthesizeNarration(text: string): Promise<Buffer> {
  const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
  // Set a quota/billing project explicitly. Application Default Credentials
  // (especially user creds from `gcloud auth application-default login`) have no
  // quota project by default, which makes texttospeech.googleapis.com return
  // "7 PERMISSION_DENIED ... requires a quota project". This sends the
  // x-goog-user-project header so the call is billed to GCP_PROJECT.
  const client = new TextToSpeechClient({
    projectId: GCP_PROJECT,
    clientOptions: { quotaProjectId: GCP_PROJECT },
  });
  const [resp] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: TTS_LANGUAGE, name: TTS_VOICE },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 1.02, pitch: 0 },
  });
  if (!resp.audioContent) throw new Error('TTS não retornou áudio');
  return Buffer.from(resp.audioContent as Uint8Array);
}

async function debitCreditsAdmin(
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
      action: action.key,
      label: action.label,
      cost: -cost,
      productName: meta.productName ?? '',
      userName: meta.userName ?? '',
      createdAt: now(),
    });
    return cost;
  });
}

async function refundCreditsAdmin(
  uid: string,
  cost: number,
  meta: { productName?: string; userName?: string } = {},
): Promise<void> {
  const userRef = adminDb.collection('users').doc(uid);
  const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();
  await adminDb.runTransaction(async (tx) => {
    tx.update(userRef, { credits: FieldValue.increment(cost) });
    tx.set(logRef, {
      action: 'video_generation_refund',
      label: 'Estorno — Geração de Vídeo',
      cost: +cost,
      productName: meta.productName ?? '',
      userName: meta.userName ?? '',
      createdAt: now(),
    });
  });
}

function formatAttributes(attributes: Record<string, string>): string {
  const entries = Object.entries(attributes ?? {}).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return '(nenhum atributo estruturado informado — extraia da descrição e da imagem)';
  return entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

async function generateScript(
  params: {
    description: string;
    brand: string;
    productName: string;
    category: string;
    attributes: Record<string, string>;
  },
  imageBase64: string,
  mimeType: string,
): Promise<VideoScript> {
  const ai = getGeminiClient();
  const { description, brand, productName, category, attributes } = params;

  const prompt = `Você é um diretor de vídeos de e-commerce especialista em conteúdo para PÁGINAS DE PRODUTO em marketplaces (Mercado Livre, Amazon, Shopee) e lojas virtuais.

Crie um roteiro de VÍDEO COMERCIAL E EXPLICATIVO, VERTICAL (9:16), com cerca de 30 segundos, estruturado em INÍCIO, MEIO e FIM, seguindo as melhores práticas de vídeo para e-commerce.

Analise CUIDADOSAMENTE a imagem fornecida antes de escrever.

**Informações do produto:**
${productName ? `Nome: ${productName}\n` : ''}${category ? `Categoria: ${category}\n` : ''}${brand ? `Marca: ${brand}\n` : ''}Descrição: ${description}

**Atributos do produto (use de 2 a 3 dos mais relevantes ao longo do roteiro):**
${formatAttributes(attributes)}

**BOAS PRÁTICAS OBRIGATÓRIAS:**
- Formato VERTICAL (9:16): produto grande e centralizado, pensado para tela de celular.
- Tom COMERCIAL e EXPLICATIVO: mostre o que o produto é, do que é feito e por que vale a pena.
- Cite naturalmente de 2 a 3 ATRIBUTOS REAIS (da lista acima ou visíveis na imagem). Nunca invente características.
- As mãos devem MANIPULAR o produto de forma rica e realista: pegar, girar para mostrar ângulos/detalhes, abrir/fechar, acionar botões/zíperes/tampas, demonstrar o uso real, apontar partes específicas. Evite gestos passivos.
- A NARRAÇÃO é uma locução em OFF (voice-over): ninguém aparece falando para a câmera, não há diálogo, não há lip sync. Há música de fundo.
- Estrutura de 4 shots encadeados (continuidade visual entre eles):
  1) INÍCIO (~8s): gancho que prende a atenção nos 3 primeiros segundos + apresentação do produto.
  2) MEIO/uso (~8s): produto em uso real, funcionamento, manipulação rica.
  3) MEIO/benefícios (~8s): close-ups destacando 2–3 atributos/benefícios.
  4) FIM (~6s): fechamento com chamada para ação (ex.: "Garanta o seu agora").
- Sem texto na tela. Sem efeitos artificiais. Realista, luz natural ou de estúdio.
- NARRAÇÃO CURTA: cada "narracao" deve ter no máximo ~16 palavras (o total será lido em ~30s).

**CAMPOS (responda em pt-BR):**
- cena: ambientação/visual geral, coerente em todos os shots, baseada na imagem (máx. 120 caracteres).
- trilha: mood da música de fundo (ex.: "moderna, leve e otimista") (máx. 60 caracteres).
- inicio, meioDemonstracao, meioBeneficios, fim: cada um com:
   - acao: o que acontece visualmente (câmera + manipulação) (máx. 200 caracteres).
   - narracao: a locução em off desse trecho (frase curta, máx. ~16 palavras).

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem texto extra):
{
  "cena": "...",
  "trilha": "...",
  "inicio": { "acao": "...", "narracao": "..." },
  "meioDemonstracao": { "acao": "...", "narracao": "..." },
  "meioBeneficios": { "acao": "...", "narracao": "..." },
  "fim": { "acao": "...", "narracao": "..." }
}`;

  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const text = result.text?.trim() ?? '{}';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned) as VideoScript;
  const shotsOk = SHOTS.every((s) => parsed[s.key]?.acao && parsed[s.key]?.narracao);
  if (!parsed.cena || !shotsOk) {
    throw new Error('Roteiro gerado inválido — campos obrigatórios ausentes');
  }
  return parsed;
}

const VEO_RETRYABLE_PATTERNS = /high load|high demand|try again|overload|quota/i;
const VEO_MAX_RETRIES = 3;
// Backoff delays in ms: 30s, 60s, 120s
const VEO_RETRY_DELAYS = [30_000, 60_000, 120_000];

function isVeoRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return VEO_RETRYABLE_PATTERNS.test(msg);
}

// Runs a Veo generateVideos operation and polls until it completes, returning
// the produced video bytes. Retries up to VEO_MAX_RETRIES times on transient
// errors (high load, quota) with exponential backoff.
async function runVeoOperation(
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

      // Poll until done — each Veo shot typically takes 2–5 minutes
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

async function runVideoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: VideoScript,
  imageBase64: string,
  mimeType: string,
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('videoJobs').doc(jobId);
  console.log(`[video] runVideoJob start uid=${uid} jobId=${jobId} productId=${productId}`);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `video-${jobId}-`));

  try {
    await jobRef.update({ status: 'processing', updatedAt: now() });

    // Pre-process the product image to a 9:16 portrait to seed the first shot.
    const inputBuffer = Buffer.from(imageBase64, 'base64');
    const portrait = await cropToPortrait(inputBuffer);
    console.log(`[video] image cropped to ${INPUT_IMAGE_W}x${INPUT_IMAGE_H} portrait jobId=${jobId}`);

    const ai = getVeoClient();
    const styleLine = 'Formato: vertical 9:16, comercial e explicativo para página de produto, luz natural ou de estúdio, câmera fluida, realista, alta qualidade.';
    const rulesLine = 'As mãos devem MANIPULAR o produto de forma rica (girar, abrir, acionar, demonstrar o uso). Nenhuma pessoa falando para a câmera. Sem texto na tela. Sem efeitos artificiais.';
    const negativePrompt = 'texto na tela, legendas, marca d\'água, logotipos, pessoa falando para a câmera, lip sync, distorções, baixa qualidade';

    // Generate the four shots sequentially, seeding each from the previous
    // shot's last frame. Shots are generated MUTE (generateAudio:false) so the
    // narration we add later is a clean voice-over with zero lip sync.
    let seedImage = { base64: portrait.base64, mimeType: portrait.mimeType };
    const segmentPaths: string[] = [];

    for (let i = 0; i < SHOTS.length; i++) {
      const shot = SHOTS[i];
      const shotScript = script[shot.key];
      const prompt = [
        `Cena: ${script.cena}`,
        `Ato (${shot.ato}, ~${shot.seconds}s): ${shotScript.acao}`,
        styleLine,
        rulesLine,
      ].join('\n');

      console.log(`[video] shot ${i + 1}/${SHOTS.length} (${shot.key}) generate jobId=${jobId}`);
      const videoBytes = await runVeoOperation(ai, jobId, `shot#${i + 1}`, {
        model: VEO_MODEL,
        prompt,
        image: { imageBytes: seedImage.base64, mimeType: seedImage.mimeType },
        config: {
          numberOfVideos: 1,
          durationSeconds: shot.seconds,
          aspectRatio: VIDEO_ASPECT_RATIO,
          personGeneration: 'allow_adult',
          generateAudio: false,
          negativePrompt,
        },
      });

      const segPath = path.join(workDir, `seg${i}.mp4`);
      await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
      segmentPaths.push(segPath);

      // Seed the next shot from this shot's last frame (skip after the last one)
      if (i < SHOTS.length - 1) {
        const framePath = path.join(workDir, `seg${i}_last.jpg`);
        seedImage = await extractLastFrame(segPath, framePath);
      }
    }

    // Concatenate the muted shots into one continuous clip.
    const combinedPath = path.join(workDir, 'combined.mp4');
    await concatVideos(segmentPaths, workDir, combinedPath);
    console.log(`[video] concatenated ${segmentPaths.length} shots jobId=${jobId}`);

    // Build a single continuous narration from the per-shot voice-over lines.
    const narrationText = SHOTS.map((s) => script[s.key].narracao.trim())
      .filter(Boolean)
      .join(' ');
    const narrationBuffer = await synthesizeNarration(narrationText);
    const narrationPath = path.join(workDir, 'narration.mp3');
    await fs.writeFile(narrationPath, narrationBuffer);
    console.log(`[video] narration synthesized jobId=${jobId} chars=${narrationText.length}`);

    // Mix voice-over + background music over the muted video.
    const finalPath = path.join(workDir, 'final.mp4');
    await mixAudio(combinedPath, narrationPath, MUSIC_PATH, finalPath);
    console.log(`[video] audio mixed jobId=${jobId}`);

    // Upload to Firebase Storage by streaming from disk — avoids loading the
    // entire video into a Node.js Buffer, which is the main memory spike.
    // Uniform bucket-level access is enabled, so object ACLs are not allowed.
    // We embed a Firebase download token in the object metadata —
    // this produces the same permanent URL format the client SDK uses.
    const bucket = adminStorage.bucket(STORAGE_BUCKET);
    const storagePath = `product-videos/${uid}/${productId}/${jobId}.mp4`;
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

    console.log(`[video] uploaded jobId=${jobId} url=${videoUrl}`);
    await jobRef.update({ status: 'done', videoUrl, updatedAt: now() });

    // Also write video URL to the product document for convenience
    const productRef = adminDb.collection('users').doc(uid).collection('products').doc(productId);
    const prodSnap = await productRef.get();
    if (prodSnap.exists) {
      await productRef.update({ _videoUrl: videoUrl, _videoJobId: jobId, updatedAt: now() });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[video] runVideoJob failed jobId=${jobId}:`, err);
    await jobRef.update({ status: 'error', error: message, updatedAt: now() }).catch(() => {});
    if (creditCost > 0) {
      await refundCreditsAdmin(uid, creditCost, meta).catch((refundErr) => {
        console.error(`[video] refund failed uid=${uid} jobId=${jobId}:`, refundErr);
      });
      console.log(`[video] refunded ${creditCost} credits uid=${uid} jobId=${jobId}`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/generate-script', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const { description, brand, imageUrl, productName, category, attributes } = req.body as {
        description: string;
        brand?: string;
        imageUrl: string;
        productName?: string;
        category?: string;
        attributes?: Record<string, string>;
      };
      if (!description || !imageUrl) {
        return res.status(400).json({ error: 'description e imageUrl são obrigatórios' });
      }
      const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
      const script = await generateScript(
        {
          description,
          brand: brand ?? '',
          productName: productName ?? '',
          category: category ?? '',
          attributes: attributes ?? {},
        },
        base64,
        mimeType,
      );
      res.json({ script });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/video/start-job', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { productId, productName, script, imageUrl } = req.body as {
        productId: string;
        productName: string;
        script: VideoScript;
        imageUrl: string;
      };
      if (!productId || !script || !imageUrl) {
        return res.status(400).json({ error: 'productId, script e imageUrl são obrigatórios' });
      }

      const creditMeta = { productName, userName: decoded.name ?? decoded.email ?? '' };
      const creditCost = await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.videoGeneration, creditMeta);

      const jobRef = adminDb
        .collection('users')
        .doc(decoded.uid)
        .collection('videoJobs')
        .doc();
      const jobId = jobRef.id;

      await jobRef.set({
        jobId,
        productId,
        status: 'queued',
        videoUrl: null,
        error: null,
        createdAt: now(),
        updatedAt: now(),
      });

      const { base64, mimeType } = await fetchImageAsBase64(imageUrl);

      // Fire and forget — does not block the HTTP response
      runVideoJob(decoded.uid, jobId, productId, script, base64, mimeType, creditCost, creditMeta);

      res.json({ jobId });
    } catch (err) {
      sendError(res, err);
    }
  });
}
