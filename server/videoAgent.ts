import type express from 'express';
import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
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
// The product photo is passed WHOLE (no crop) as a Veo reference image; the
// aspect ratio of the output is controlled by VIDEO_ASPECT_RATIO alone.
const VIDEO_ASPECT_RATIO = '9:16';
const REFERENCE_MAX_DIM = 1024;

// Background music + TTS voice for the final mix. The audio is added AFTER the
// video is generated (segments are generated MUTE), so there is never any lip
// sync — the narration is always a voice-over on top of the footage.
const MUSIC_PATH = path.join(process.cwd(), 'server', 'assets', 'background-music.mp3');
const TTS_VOICE = 'pt-BR-Neural2-B';
const TTS_LANGUAGE = 'pt-BR';

const FONT_PATH = path.join(process.cwd(), 'server', 'assets', 'fonts', 'Anton-Regular.ttf');
// Canvas fixo das legendas; o vídeo base é normalizado para este tamanho antes do overlay.
const CANVAS_W = 720;
const CANVAS_H = 1280;

// In reference_to_video mode the Veo 3.1 API only accepts 8s clips, so all four
// shots are 8s (total ~32s). The shots follow an e-commerce 3-act structure:
// Início (hook) → Meio (uso + benefícios) → Fim (CTA). Every shot is anchored to
// the same product reference image, so there is no frame-to-frame seeding.
const SHOTS = [
  { key: 'inicio', seconds: 8, ato: 'INÍCIO — Hook (chama atenção e apresenta o produto)' },
  { key: 'meioDemonstracao', seconds: 8, ato: 'MEIO — Demonstração do produto em uso/funcionamento' },
  { key: 'meioBeneficios', seconds: 8, ato: 'MEIO — Close-ups destacando atributos e benefícios' },
  { key: 'fim', seconds: 8, ato: 'FIM — Fechamento e chamada para ação' },
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

// Downscales the product photo keeping its original aspect ratio — nothing is
// cropped — so the whole product stays visible in the Veo reference image.
async function resizeForReference(inputBuffer: Buffer): Promise<{ base64: string; mimeType: string }> {
  const resized = await sharp(inputBuffer)
    .resize({
      width: REFERENCE_MAX_DIM,
      height: REFERENCE_MAX_DIM,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
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

// Quebra uma legenda em linhas curtas (para caber no quadro 9:16).
function wrapCaption(text: string, maxCharsPerLine = 24): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if ((current + ' ' + word).length <= maxCharsPerLine) current += ' ' + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let fontDataUriCache: string | null = null;
async function fontDataUri(): Promise<string> {
  if (!fontDataUriCache) {
    const b = await fs.readFile(FONT_PATH);
    fontDataUriCache = `data:font/ttf;base64,${b.toString('base64')}`;
  }
  return fontDataUriCache;
}

// Renderiza a legenda (ou CTA) como PNG transparente 720x1280 com a fonte Anton
// embutida. 'caption' = terço inferior, branco com contorno preto; 'cta' = faixa
// âmbar centralizada com texto branco.
async function renderCaptionPng(text: string, kind: 'caption' | 'cta', outPath: string): Promise<void> {
  const font = await fontDataUri();
  const lines = wrapCaption(text).split('\n').map(escapeXml);
  let inner: string;
  if (kind === 'caption') {
    const fontSize = 48;
    const lineH = fontSize * 1.2;
    const blockH = lines.length * lineH;
    const startY = Math.round(CANVAS_H * 0.72 - blockH / 2 + fontSize);
    const texts = lines
      .map((ln, i) => `<text x="${CANVAS_W / 2}" y="${startY + i * lineH}" text-anchor="middle" class="cap">${ln}</text>`)
      .join('');
    inner = `<style>@font-face{font-family:'A';src:url('${font}');}` +
      `.cap{font-family:'A';font-size:${fontSize}px;fill:#fff;stroke:#000;stroke-width:6px;paint-order:stroke;stroke-linejoin:round;}</style>${texts}`;
  } else {
    const fontSize = 64;
    const lineH = fontSize * 1.15;
    const blockH = lines.length * lineH;
    const boxPadY = 28;
    const boxH = Math.round(blockH + boxPadY * 2);
    const boxY = Math.round(CANVAS_H / 2 - boxH / 2);
    const boxX = 40;
    const boxW = CANVAS_W - 80;
    const startY = boxY + boxPadY + fontSize;
    const texts = lines
      .map((ln, i) => `<text x="${CANVAS_W / 2}" y="${startY + i * lineH}" text-anchor="middle" class="cta">${ln}</text>`)
      .join('');
    inner = `<style>@font-face{font-family:'A';src:url('${font}');}.cta{font-family:'A';font-size:${fontSize}px;fill:#fff;}</style>` +
      `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="20" fill="#F59E0B" fill-opacity="0.92"/>${texts}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}">${inner}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(outPath, png);
}

// Concatenates the silent shots, renders per-shot caption PNGs (sharp) and
// overlays them timed to each 8s shot, then mixes narration + looped
// background music in a SINGLE ffmpeg pass. Re-encodes video because shots
// are generated independently and may differ in timebase/SAR. Output length
// is bounded by the video (-shortest).
async function assembleFinalVideo(
  segmentPaths: string[],
  narrationPath: string,
  musicPath: string,
  workDir: string,
  outPath: string,
  captions: string[],
): Promise<void> {
  const listPath = path.join(workDir, 'concat.txt');
  const list = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list, 'utf8');

  const SHOT_SECONDS = 8;
  const lastIndex = captions.length - 1;

  // Renderiza cada legenda não vazia como PNG (ordem = ordem de input no ffmpeg).
  const overlays: Array<{ file: string; start: number; end: number }> = [];
  for (let i = 0; i < captions.length; i++) {
    const text = (captions[i] ?? '').trim();
    if (!text) continue;
    const pngPath = path.join(workDir, `cap${i}.png`);
    await renderCaptionPng(text, i === lastIndex ? 'cta' : 'caption', pngPath);
    overlays.push({ file: pngPath, start: i * SHOT_SECONDS, end: i * SHOT_SECONDS + SHOT_SECONDS });
  }

  const inputs: string[] = ['-f', 'concat', '-safe', '0', '-i', listPath];
  for (const o of overlays) inputs.push('-i', o.file);
  const musicIdx = 1 + overlays.length;
  const narrationIdx = musicIdx + 1;
  // -stream_loop -1 alone is unbounded: combined with the overlay chain above,
  // the infinite music stream overruns the filtergraph's internal frame queue
  // and ffmpeg aborts mid-filter with "No space left on device" (an ENOSPC
  // from the framesync FIFO, not an actual disk issue — reproduced and
  // confirmed empirically with this vendorized binary). Bounding the looped
  // input's read duration to the total video length (+ margin) keeps it
  // finite and lets -shortest do the final trim as before.
  const totalSeconds = segmentPaths.length * SHOT_SECONDS + 5;
  inputs.push('-stream_loop', '-1', '-t', String(totalSeconds), '-i', musicPath);
  inputs.push('-i', narrationPath);

  // Vídeo: normaliza base p/ 720x1280, depois encadeia os overlays temporizados.
  const parts: string[] = [
    `[0:v]scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2,setsar=1[base]`,
  ];
  let vlabel = '[base]';
  overlays.forEach((o, k) => {
    const outLabel = k === overlays.length - 1 ? '[v]' : `[v${k}]`;
    parts.push(`${vlabel}[${k + 1}:v]overlay=0:0:enable='between(t\\,${o.start}\\,${o.end})'${outLabel}`);
    vlabel = outLabel;
  });
  const videoOut = overlays.length > 0 ? '[v]' : '[base]';

  parts.push(`[${musicIdx}:a]volume=0.14[mus]`);
  parts.push(`[${narrationIdx}:a]volume=1.6[nar]`);
  parts.push(`[mus][nar]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`);

  await runFfmpeg([
    '-y',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', videoOut, '-map', '[mix]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
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

Crie um roteiro de VÍDEO COMERCIAL E EXPLICATIVO, VERTICAL (9:16), com cerca de 32 segundos, estruturado em INÍCIO, MEIO e FIM, seguindo as melhores práticas de vídeo para e-commerce.

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
- Estrutura de 4 shots INDEPENDENTES unidos por CORTES SECOS (padrão de shorts/TikTok): cada shot deve abrir já com o produto em quadro e funcionar sozinho, sem depender visualmente do shot anterior. A "cena" compartilhada garante a coerência de ambientação entre eles:
  1) INÍCIO (~8s): gancho que prende a atenção nos 3 primeiros segundos + apresentação do produto.
  2) MEIO/uso (~8s): produto em uso real, funcionamento, manipulação rica.
  3) MEIO/benefícios (~8s): close-ups destacando 2–3 atributos/benefícios.
  4) FIM (~8s): fechamento com chamada para ação (ex.: "Garanta o seu agora").
- Sem texto na tela. Sem efeitos artificiais. Realista, luz natural ou de estúdio.
- NARRAÇÃO CURTA: cada "narracao" deve ter no máximo ~16 palavras (o total será lido em ~32s).

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
  shotImages: Array<{ base64: string; mimeType: string }>,
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('videoJobs').doc(jobId);
  console.log(`[video] runVideoJob start uid=${uid} jobId=${jobId} productId=${productId}`);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `video-${jobId}-`));

  try {
    await jobRef.update({ status: 'processing', shotsDone: 0, totalShots: SHOTS.length, step: 'shot', updatedAt: now() });

    const ai = getVeoClient();
    const styleLine = 'Formato: vertical 9:16, comercial e explicativo para página de produto, luz natural ou de estúdio, câmera fluida, realista, alta qualidade.';
    const rulesLine = 'As mãos devem MANIPULAR o produto de forma rica (girar, abrir, acionar, demonstrar o uso). Nenhuma pessoa falando para a câmera. Sem texto na tela. Sem efeitos artificiais.';
    const fidelityLine = 'FIDELIDADE OBRIGATÓRIA: o produto no vídeo deve ser IDÊNTICO à imagem de referência — mesmas cores, proporções, logotipos, materiais e acabamento. Nunca redesenhe, recolora ou altere o produto.';
    const negativePrompt = 'produto diferente da referência, cores alteradas, logotipo modificado, proporções distorcidas, texto na tela, legendas, marca d\'água, pessoa falando para a câmera, lip sync, distorções, baixa qualidade';

    // All four shots run in PARALLEL — each uses its own reference image,
    // mapped to the most cohesive scene for that shot's role in the narrative.
    // Transitions between shots are hard cuts (the shorts/TikTok standard).
    const generateShot = async (i: number): Promise<string> => {
      const shot = SHOTS[i];
      const shotScript = script[shot.key];
      const src = shotImages[i];
      const referenceImage = await resizeForReference(Buffer.from(src.base64, 'base64'));
      const prompt = [
        `Cena: ${script.cena}`,
        `Ato (${shot.ato}, ~${shot.seconds}s): ${shotScript.acao}`,
        styleLine,
        rulesLine,
        fidelityLine,
      ].join('\n');

      console.log(`[video] shot ${i + 1}/${SHOTS.length} (${shot.key}) generate jobId=${jobId}`);
      const videoBytes = await runVeoOperation(ai, jobId, `shot#${i + 1}`, {
        model: VEO_MODEL,
        prompt,
        config: {
          numberOfVideos: 1,
          durationSeconds: shot.seconds,
          aspectRatio: VIDEO_ASPECT_RATIO,
          personGeneration: 'allow_adult',
          generateAudio: false,
          negativePrompt,
          referenceImages: [
            {
              image: { imageBytes: referenceImage.base64, mimeType: referenceImage.mimeType },
              referenceType: VideoGenerationReferenceType.ASSET,
            },
          ],
        },
      });

      const segPath = path.join(workDir, `seg${i}.mp4`);
      await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
      await jobRef.update({ shotsDone: FieldValue.increment(1), updatedAt: now() });
      return segPath;
    };

    // Narration only depends on the script, so TTS runs alongside the shots.
    const narrationText = SHOTS.map((s) => script[s.key].narracao.trim())
      .filter(Boolean)
      .join(' ');

    const [segmentPaths, narrationBuffer] = await Promise.all([
      Promise.all(SHOTS.map((_, i) => generateShot(i))),
      synthesizeNarration(narrationText),
    ]);
    const narrationPath = path.join(workDir, 'narration.mp3');
    await fs.writeFile(narrationPath, narrationBuffer);
    console.log(`[video] ${segmentPaths.length} shots + narration ready jobId=${jobId} chars=${narrationText.length}`);

    // Single-pass post-production: concat + narration + music in one encode.
    await jobRef.update({ step: 'post', updatedAt: now() });
    const finalPath = path.join(workDir, 'final.mp4');
    const captions = SHOTS.map((s) => script[s.key].narracao);
    await assembleFinalVideo(segmentPaths, narrationPath, MUSIC_PATH, workDir, finalPath, captions);
    console.log(`[video] post-production done jobId=${jobId}`);

    await jobRef.update({ step: 'uploading', updatedAt: now() });

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
      const { productId, productName, script, shotImageUrls } = req.body as {
        productId: string;
        productName: string;
        script: VideoScript;
        shotImageUrls: string[];
      };
      if (!productId || !script || !Array.isArray(shotImageUrls) || shotImageUrls.length !== SHOTS.length) {
        return res.status(400).json({ error: `productId, script e shotImageUrls (${SHOTS.length} imagens) são obrigatórios` });
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

      // Fetch each shot's reference image, deduplicating repeated URLs so the
      // same scene driving two shots is only downloaded once.
      const uniqueUrls = Array.from(new Set(shotImageUrls));
      const fetched = new Map<string, { base64: string; mimeType: string }>();
      await Promise.all(uniqueUrls.map(async (url) => {
        fetched.set(url, await fetchImageAsBase64(url));
      }));
      const shotImages = shotImageUrls.map((url) => fetched.get(url)!);

      // Send the jobId immediately in the first chunk so the client can
      // start listening on Firestore without waiting for the full job.
      // Keeping the HTTP connection open (not calling res.end() here) is
      // intentional: Cloud Run will not scale down or kill an instance that
      // has an active request. The connection closes when the job finishes.
      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ jobId }));

      try {
        await runVideoJob(decoded.uid, jobId, productId, script, shotImages, creditCost, creditMeta);
      } finally {
        res.end();
      }
    } catch (err) {
      sendError(res, err);
    }
  });
}
