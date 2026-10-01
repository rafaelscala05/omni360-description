import type express from 'express';
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
  STORAGE_BUCKET, GCP_PROJECT, TEXT_MODEL, VIDEO_ASPECT_RATIO,
  getGeminiClient, getVeoClient, now, sendError, fetchImageAsBase64,
  runFfmpeg, formatAttributes, debitCreditsAdmin, refundCreditsAdmin, assertNoActiveVideoJob,
  getDefaultVideoProvider, PRODUCT_REFERENCE_PROMPT_LINE, PRODUCT_REFERENCE_NEGATIVE, CAMERA_VARIETY_RULE,
  PRODUCT_COVERAGE_RULE, PRODUCT_COVERAGE_CLIP_LINE, PRODUCT_COVERAGE_NEGATIVE,
  PHOTO_PANEL_PROMPT_LINE, PHOTO_PANEL_NEGATIVE, sanitizePhotoUrls,
  prepareReferenceImages, stageReferenceImages, deleteStagedReferences, buildPhotoPanel, fitSegmentDuration,
  type ClipReferenceImage, type PreparedImage, type VideoProvider,
} from './videoShared';
import {
  runClipGeneration, getOpenRouterApiKey, SEEDANCE_MAX_DURATION_SECONDS, SEEDANCE_MAX_REFERENCE_IMAGES,
} from './videoProviders';

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

// In reference_to_video mode the Veo 3.1 API only accepts 8s clips, so on Veo
// all four shots are 8s (total ~32s), generated separately and joined by hard
// cuts. On Seedance the same four acts go into ONE clip of
// SEEDANCE_MAX_DURATION_SECONDS (one generation keeps the product consistent
// across the whole video instead of re-inventing it per shot). The shots follow an e-commerce 3-act structure:
// Início (hook) → Meio (uso + benefícios) → Fim (CTA). Every shot is anchored to
// the same product reference image, so there is no frame-to-frame seeding.
const SHOTS = [
  { key: 'inicio', seconds: 8, ato: 'INÍCIO — Hook (chama atenção e apresenta o produto)' },
  { key: 'meioDemonstracao', seconds: 8, ato: 'MEIO — Demonstração do produto em uso/funcionamento' },
  { key: 'meioBeneficios', seconds: 8, ato: 'MEIO — Close-ups destacando atributos e benefícios' },
  { key: 'fim', seconds: 8, ato: 'FIM — Fechamento e chamada para ação' },
] as const;

export interface VideoScriptShot {
  acao: string;
  narracao: string;
}

export interface VideoScript {
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

let parsedFont: opentype.Font | null = null;
async function loadFont(): Promise<opentype.Font> {
  if (!parsedFont) {
    const buf = await fs.readFile(FONT_PATH);
    parsedFont = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return parsedFont;
}

// Renderiza a legenda (ou CTA) como PNG transparente 720x1280, com o texto
// vetorizado (glyphs -> <path>) via opentype.js. 'caption' = terço inferior,
// branco com contorno preto; 'cta' = faixa âmbar centralizada com texto branco.
// Vetorizar evita depender de fonte de sistema/@font-face no librsvg (Linux/Cloud Run).
async function renderCaptionPng(text: string, kind: 'caption' | 'cta', outPath: string): Promise<void> {
  const font = await loadFont();
  const lines = wrapCaption(text).split('\n');

  // Converte uma linha de texto num <path> centralizado horizontalmente na baseline dada.
  const lineToPath = (ln: string, fontSize: number, baselineY: number): string => {
    const w = font.getAdvanceWidth(ln, fontSize);
    const x = (CANVAS_W - w) / 2;
    return font.getPath(ln, x, baselineY, fontSize).toPathData(2);
  };

  let inner: string;
  if (kind === 'caption') {
    const fontSize = 48;
    const lineH = fontSize * 1.2;
    const blockH = lines.length * lineH;
    const firstBaseline = Math.round(CANVAS_H * 0.72 - blockH / 2 + fontSize);
    inner = lines
      .map((ln, i) => `<path d="${lineToPath(ln, fontSize, firstBaseline + i * lineH)}" fill="#fff" stroke="#000" stroke-width="6" paint-order="stroke" stroke-linejoin="round"/>`)
      .join('');
  } else {
    const fontSize = 64;
    const lineH = fontSize * 1.15;
    const blockH = lines.length * lineH;
    const boxPadY = 28;
    const boxH = Math.round(blockH + boxPadY * 2);
    const boxY = Math.round(CANVAS_H / 2 - boxH / 2);
    const boxX = 40;
    const boxW = CANVAS_W - 80;
    const firstBaseline = boxY + boxPadY + fontSize;
    const paths = lines
      .map((ln, i) => `<path d="${lineToPath(ln, fontSize, firstBaseline + i * lineH)}" fill="#fff"/>`)
      .join('');
    inner = `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="20" fill="#F59E0B" fill-opacity="0.92"/>${paths}`;
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
  // Duração de cada ato (a legenda i fica de i*shotSeconds até (i+1)*shotSeconds):
  // 8s no Veo (um segmento por ato), SEEDANCE_MAX_DURATION_SECONDS/4 no Seedance
  // (um segmento só com os quatro atos).
  shotSeconds: number,
): Promise<void> {
  const listPath = path.join(workDir, 'concat.txt');
  const list = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list, 'utf8');

  const SHOT_SECONDS = shotSeconds;
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
  const totalSeconds = captions.length * SHOT_SECONDS + 5;
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

async function generateScript(
  params: {
    description: string;
    brand: string;
    productName: string;
    category: string;
    attributes: Record<string, string>;
  },
  // [folha de referência, ...fotos reais escolhidas] — o roteirista precisa
  // ver as fotos para saber quais lados/estados do produto existem.
  images: Array<{ base64: string; mimeType: string }>,
): Promise<VideoScript> {
  const ai = getGeminiClient();
  const { description, brand, productName, category, attributes } = params;

  const prompt = `Você é um diretor de vídeos de e-commerce especialista em conteúdo para PÁGINAS DE PRODUTO em marketplaces (Mercado Livre, Amazon, Shopee) e lojas virtuais.

Crie um roteiro de VÍDEO COMERCIAL E EXPLICATIVO, VERTICAL (9:16), com cerca de 32 segundos, estruturado em INÍCIO, MEIO e FIM, seguindo as melhores práticas de vídeo para e-commerce.

Analise CUIDADOSAMENTE as imagens anexadas antes de escrever. A PRIMEIRA é a folha de referência do produto (vários ângulos e detalhes); as DEMAIS são FOTOS REAIS do produto. Os lados, partes e estados do produto que aparecem nessas imagens são os ÚNICOS que o vídeo pode mostrar.

**Informações do produto:**
${productName ? `Nome: ${productName}\n` : ''}${category ? `Categoria: ${category}\n` : ''}${brand ? `Marca: ${brand}\n` : ''}Descrição: ${description}

**Atributos do produto (use de 2 a 3 dos mais relevantes ao longo do roteiro):**
${formatAttributes(attributes)}

**BOAS PRÁTICAS OBRIGATÓRIAS:**
- Formato VERTICAL (9:16): produto grande e centralizado, pensado para tela de celular.
- Tom COMERCIAL e EXPLICATIVO: mostre o que o produto é, do que é feito e por que vale a pena.
- Cite naturalmente de 2 a 3 ATRIBUTOS REAIS (da lista acima ou visíveis na imagem). Nunca invente características.
- As mãos devem MANIPULAR o produto de forma realista: pegar, aproximar da câmera, apontar detalhes, posicionar em cena, demonstrar o uso. Abrir/fechar, acionar botões/zíperes/tampas ou mostrar o produto em funcionamento SÓ se as fotos mostram esse estado. Evite gestos passivos.
- A NARRAÇÃO é uma locução em OFF (voice-over): ninguém aparece falando para a câmera, não há diálogo, não há lip sync. Há música de fundo.
- Estrutura de 4 shots INDEPENDENTES unidos por CORTES SECOS (padrão de shorts/TikTok): cada shot deve abrir já com o produto em quadro e funcionar sozinho, sem depender visualmente do shot anterior. A "cena" compartilhada garante a coerência de ambientação entre eles:
  1) INÍCIO (~8s): gancho que prende a atenção nos 3 primeiros segundos + apresentação do produto.
  2) MEIO/uso (~8s): produto em uso real, funcionamento, manipulação rica.
  3) MEIO/benefícios (~8s): close-ups destacando 2–3 atributos/benefícios.
  4) FIM (~8s): fechamento com chamada para ação (ex.: "Garanta o seu agora").
${CAMERA_VARIETY_RULE}
${PRODUCT_COVERAGE_RULE}
- Sem texto na tela. Sem efeitos artificiais. Realista, luz natural ou de estúdio.
- NARRAÇÃO CURTA: cada "narracao" deve ter no máximo ~16 palavras (o total será lido em ~32s).

**CAMPOS (responda em pt-BR):**
- cena: ambientação/visual geral, coerente em todos os shots, baseada na imagem (máx. 120 caracteres).
- trilha: mood da música de fundo (ex.: "moderna, leve e otimista") (máx. 60 caracteres).
- inicio, meioDemonstracao, meioBeneficios, fim: cada um com:
   - acao: "Câmera: <ângulo> + <movimento>." seguido do que acontece visualmente (manipulação) (máx. 260 caracteres).
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
          ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
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

const CLASSIC_STYLE_LINE = 'Formato: vertical 9:16, comercial e explicativo para página de produto, luz natural ou de estúdio, câmera fluida, realista, alta qualidade.';
const CLASSIC_RULES_LINE = 'As mãos MANIPULAM o produto de forma realista (pegar, aproximar, apontar detalhes, demonstrar o uso). Nenhuma pessoa falando para a câmera. Sem texto na tela. Sem efeitos artificiais.';
const CLASSIC_FIDELITY_LINE = 'FIDELIDADE OBRIGATÓRIA: o produto no vídeo deve ser IDÊNTICO às fotos reais de referência — mesmas cores, proporções, logotipos, materiais e acabamento. Nunca redesenhe, recolore ou altere o produto.';
const CLASSIC_BASE_NEGATIVE = 'produto diferente da referência, cores alteradas, logotipo modificado, proporções distorcidas, texto na tela, legendas, marca d\'água, pessoa falando para a câmera, lip sync, distorções, baixa qualidade';
const SHEET_PAPEL = 'FOLHA DE REFERÊNCIA do mesmo produto em vários ângulos — só para fidelidade, nunca aparece no vídeo';

export function buildClassicNegativePrompt(opts: { hasSheet: boolean; hasPhotoPanel: boolean }): string {
  return [
    CLASSIC_BASE_NEGATIVE,
    PRODUCT_COVERAGE_NEGATIVE,
    ...(opts.hasSheet ? [PRODUCT_REFERENCE_NEGATIVE] : []),
    ...(opts.hasPhotoPanel ? [PHOTO_PANEL_NEGATIVE] : []),
  ].join(', ');
}

// Veo: um prompt por shot (cada shot é uma geração separada de 8s).
export function buildClassicShotPrompt(script: VideoScript, shotIndex: number, opts: { hasSheet: boolean; hasPhotoPanel: boolean }): string {
  const shot = SHOTS[shotIndex];
  return [
    `Cena: ${script.cena}`,
    `Ato (${shot.ato}, ~${shot.seconds}s): ${script[shot.key].acao}`,
    'Siga EXATAMENTE o ângulo e o movimento de câmera descritos no ato.',
    CLASSIC_STYLE_LINE,
    CLASSIC_RULES_LINE,
    CLASSIC_FIDELITY_LINE,
    PRODUCT_COVERAGE_CLIP_LINE,
    ...(opts.hasSheet ? [PRODUCT_REFERENCE_PROMPT_LINE] : []),
    ...(opts.hasPhotoPanel ? [PHOTO_PANEL_PROMPT_LINE] : []),
  ].join('\n');
}

const formatSeconds = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// Seedance: os quatro atos num clipe só, como uma linha do tempo com cortes
// secos. O mapa @ImageN (buildSeedancePrompt) diz qual referência é a cena de
// cada ato, qual é foto real e qual é a folha.
export function buildClassicSeedancePrompt(script: VideoScript, totalSeconds: number, opts: { hasSheet: boolean }): string {
  const actSeconds = totalSeconds / SHOTS.length;
  const timeline = SHOTS.map((shot, i) => {
    const start = formatSeconds(i * actSeconds);
    const end = formatSeconds((i + 1) * actSeconds);
    return `[${start}s–${end}s] ${shot.ato}: ${script[shot.key].acao}`;
  });
  return [
    `Vídeo ÚNICO e contínuo de ${totalSeconds}s em ${SHOTS.length} atos, com CORTE SECO entre um ato e o próximo. O mesmo produto, idêntico, em todos os atos.`,
    `Cena: ${script.cena}`,
    'Linha do tempo (siga EXATAMENTE o ângulo e o movimento de câmera de cada ato):',
    ...timeline,
    CLASSIC_STYLE_LINE,
    CLASSIC_RULES_LINE,
    CLASSIC_FIDELITY_LINE,
    PRODUCT_COVERAGE_CLIP_LINE,
    ...(opts.hasSheet ? [PRODUCT_REFERENCE_PROMPT_LINE] : []),
  ].join('\n');
}

// Referências do clipe único do Seedance, dentro do teto de imagens: a folha e
// as cenas (deduplicadas, rotuladas com os atos que as usam) têm prioridade;
// as fotos reais ocupam o que sobra, na ordem escolhida pelo usuário.
export function buildClassicSeedanceReferences(
  shotScenes: PreparedImage[],
  photos: PreparedImage[],
  sheet: PreparedImage | null,
  maxImages: number,
): ClipReferenceImage[] {
  const scenes: Array<{ img: PreparedImage; atos: number[] }> = [];
  shotScenes.forEach((img, i) => {
    const existing = scenes.find((s) => s.img.url === img.url);
    if (existing) existing.atos.push(i + 1);
    else scenes.push({ img, atos: [i + 1] });
  });
  const sceneRefs: ClipReferenceImage[] = scenes.map(({ img, atos }) => ({
    url: img.url, base64: img.base64, mimeType: img.mimeType,
    papel: `a CENA ${atos.length > 1 ? 'dos atos' : 'do ato'} ${atos.join(' e ')} com o PRODUTO (ambiente e luz)`,
  }));
  const sceneUrls = new Set(scenes.map((s) => s.img.url));
  const photoSlots = Math.max(0, maxImages - sceneRefs.length - (sheet ? 1 : 0));
  const photoRefs: ClipReferenceImage[] = photos
    .filter((p) => !sceneUrls.has(p.url))
    .slice(0, photoSlots)
    .map((p, i) => ({ url: p.url, base64: p.base64, mimeType: p.mimeType, papel: `FOTO REAL ${i + 1} do PRODUTO (aparência verdadeira — cores, materiais, logotipo, proporções)` }));
  return [
    ...photoRefs,
    ...sceneRefs,
    ...(sheet ? [{ url: sheet.url, base64: sheet.base64, mimeType: sheet.mimeType, papel: SHEET_PAPEL }] : []),
  ];
}

async function runVideoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: VideoScript,
  refs: {
    shotScenes: PreparedImage[]; // uma por shot, na ordem de SHOTS
    photos: PreparedImage[];     // fotos reais escolhidas no wizard
    sheet: PreparedImage | null; // folha de referência
  },
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
  provider: VideoProvider,
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('videoJobs').doc(jobId);
  const { shotScenes, photos, sheet } = refs;
  const singleClip = provider === 'seedance';
  const totalShots = singleClip ? 1 : SHOTS.length;
  console.log(`[video] runVideoJob start uid=${uid} jobId=${jobId} productId=${productId} provider=${provider} photos=${photos.length} sheet=${sheet ? 'yes' : 'no'}`);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `video-${jobId}-`));

  try {
    await jobRef.update({ status: 'processing', shotsDone: 0, totalShots, step: 'shot', updatedAt: now() });

    const ai = getVeoClient();
    const hasSheet = !!sheet;
    let shotSeconds: number;
    let generateSegments: () => Promise<string[]>;

    if (singleClip) {
      const totalSeconds = SEEDANCE_MAX_DURATION_SECONDS;
      shotSeconds = totalSeconds / SHOTS.length;
      generateSegments = async () => {
        const referenceImages = buildClassicSeedanceReferences(shotScenes, photos, sheet, SEEDANCE_MAX_REFERENCE_IMAGES);
        console.log(`[video] single clip ${totalSeconds}s generate jobId=${jobId} provider=${provider} refs=${referenceImages.length}`);
        const videoBytes = await runClipGeneration(provider, ai, jobId, 'clip#1', {
          prompt: buildClassicSeedancePrompt(script, totalSeconds, { hasSheet }),
          negativePrompt: buildClassicNegativePrompt({ hasSheet, hasPhotoPanel: false }),
          durationSeconds: totalSeconds,
          aspectRatio: VIDEO_ASPECT_RATIO,
          generateAudio: false,
          referenceImages,
        });
        const segPath = path.join(workDir, 'seg0.mp4');
        await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
        await jobRef.update({ shotsDone: FieldValue.increment(1), updatedAt: now() });
        return [segPath];
      };
    } else {
      shotSeconds = SHOTS[0].seconds;
      // Veo aceita 3 referências: cena do shot + folha + um painel com todas
      // as fotos reais escolhidas (montado uma vez, vai em todos os shots).
      const panel = photos.length ? await buildPhotoPanel(photos) : null;
      const hasPhotoPanel = !!panel;
      const negativePrompt = buildClassicNegativePrompt({ hasSheet, hasPhotoPanel });
      // All four shots run in PARALLEL — each uses its own scene image,
      // mapped to the most cohesive scene for that shot's role in the narrative.
      // Transitions between shots are hard cuts (the shorts/TikTok standard).
      const generateShot = async (i: number): Promise<string> => {
        const scene = shotScenes[i];
        const referenceImages: ClipReferenceImage[] = [
          { url: scene.url, base64: scene.base64, mimeType: scene.mimeType, papel: 'a CENA deste shot com o PRODUTO' },
          ...(sheet ? [{ url: sheet.url, base64: sheet.base64, mimeType: sheet.mimeType, papel: SHEET_PAPEL }] : []),
          ...(panel ? [{ base64: panel.base64, mimeType: panel.mimeType, papel: 'PAINEL com as fotos reais do produto' }] : []),
        ];
        console.log(`[video] shot ${i + 1}/${SHOTS.length} (${SHOTS[i].key}) generate jobId=${jobId} provider=${provider}`);
        const videoBytes = await runClipGeneration(provider, ai, jobId, `shot#${i + 1}`, {
          prompt: buildClassicShotPrompt(script, i, { hasSheet, hasPhotoPanel }),
          negativePrompt,
          durationSeconds: SHOTS[i].seconds,
          aspectRatio: VIDEO_ASPECT_RATIO,
          generateAudio: false,
          referenceImages,
        });
        const segPath = path.join(workDir, `seg${i}.mp4`);
        await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
        if (provider === 'omni') await fitSegmentDuration(segPath, SHOTS[i].seconds);
        await jobRef.update({ shotsDone: FieldValue.increment(1), updatedAt: now() });
        return segPath;
      };
      generateSegments = () => Promise.all(SHOTS.map((_, i) => generateShot(i)));
    }

    // Narration only depends on the script, so TTS runs alongside the shots.
    const narrationText = SHOTS.map((s) => script[s.key].narracao.trim())
      .filter(Boolean)
      .join(' ');

    const [segmentPaths, narrationBuffer] = await Promise.all([
      generateSegments(),
      synthesizeNarration(narrationText),
    ]);
    const narrationPath = path.join(workDir, 'narration.mp3');
    await fs.writeFile(narrationPath, narrationBuffer);
    console.log(`[video] ${segmentPaths.length} segment(s) + narration ready jobId=${jobId} chars=${narrationText.length}`);

    // Single-pass post-production: concat + narration + music in one encode.
    await jobRef.update({ step: 'post', updatedAt: now() });
    const finalPath = path.join(workDir, 'final.mp4');
    const captions = SHOTS.map((s) => script[s.key].narracao);
    await assembleFinalVideo(segmentPaths, narrationPath, MUSIC_PATH, workDir, finalPath, captions, shotSeconds);
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
    await deleteStagedReferences(uid, jobId);
  }
}

// ---------------------------------------------------------------------------
// Roteiro e início do job como funções — a rota do wizard e o Alfred
// (server/agent/videoAlfred.ts) passam pelas mesmas, então débito, estorno,
// preparo das referências e "um vídeo por vez" não divergem.
// ---------------------------------------------------------------------------

export interface PedidoRoteiro {
  description: string;
  brand?: string;
  imageUrl: string;
  // Fotos reais escolhidas no wizard — o roteiro só usa os lados/estados que elas mostram.
  photoUrls?: string[];
  productName?: string;
  category?: string;
  attributes?: Record<string, string>;
}

export async function gerarRoteiro(p: PedidoRoteiro): Promise<VideoScript> {
  const photos = sanitizePhotoUrls(p.photoUrls).filter((u) => u !== p.imageUrl);
  const images = await Promise.all([p.imageUrl, ...photos].map((u) => fetchImageAsBase64(u)));
  return generateScript(
    {
      description: p.description,
      brand: p.brand ?? '',
      productName: p.productName ?? '',
      category: p.category ?? '',
      attributes: p.attributes ?? {},
    },
    images,
  );
}

export interface InicioVideo {
  productId: string;
  productName: string;
  script: VideoScript;
  shotImageUrls: string[];
  // Optional so older clients keep working; the current UI always sends it.
  productReferenceUrl?: string;
  // Fotos reais escolhidas no wizard (todas marcadas por padrão).
  productPhotoUrls?: string[];
}

/**
 * Debita, cria o job e roda o vídeo até o fim. `onJobId` é chamado assim que o
 * job existe (o wizard manda o id ao navegador nesse momento); a promessa só
 * resolve quando o vídeo termina — quem chama segura a requisição aberta, que é
 * o que mantém a instância do Cloud Run viva.
 */
export async function iniciarVideo(
  decoded: { uid: string; name?: string; email?: string },
  params: InicioVideo,
  onJobId: (jobId: string) => void | Promise<void>,
): Promise<void> {
  const { productId, productName, script, shotImageUrls, productReferenceUrl, productPhotoUrls } = params;
  await assertNoActiveVideoJob(decoded.uid);

  // Resolvido e validado ANTES de debitar crédito: sem isso, um
  // OPENROUTER_API_KEY ausente só era detectado depois do débito (dentro do
  // runSeedanceOperation), gerando um par débito+estorno em credit_logs (fonte
  // de verdade do CRM pra "gerou conteúdo") por nada — achado do code
  // review de 2026-09-28.
  const provider = await getDefaultVideoProvider();
  if (provider === 'seedance') getOpenRouterApiKey();

  const creditMeta = { productName, userName: decoded.name ?? decoded.email ?? '' };
  const creditCost = await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.videoGeneration, creditMeta);

  const jobRef = adminDb.collection('users').doc(decoded.uid).collection('videoJobs').doc();
  const jobId = jobRef.id;

  const photoUrls = sanitizePhotoUrls(productPhotoUrls);
  let refs: { shotScenes: PreparedImage[]; photos: PreparedImage[]; sheet: PreparedImage | null };
  try {
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

    // Each URL is downloaded once even when it drives two shots or is both
    // a scene and a photo.
    const prepared = await prepareReferenceImages([...shotImageUrls, ...photoUrls, ...(productReferenceUrl ? [productReferenceUrl] : [])]);
    // O Seedance lê as referências por URL: vão cópias no nosso Storage,
    // nunca a URL original (CDN de ERP, http://, anti-bot…).
    if (provider === 'seedance') await stageReferenceImages(decoded.uid, jobId, prepared);
    refs = {
      shotScenes: shotImageUrls.map((url) => prepared.get(url)!),
      photos: photoUrls.map((url) => prepared.get(url)!),
      sheet: productReferenceUrl ? prepared.get(productReferenceUrl)! : null,
    };
  } catch (prepErr) {
    // Refund + mark the job errored so credits aren't lost and it isn't orphaned in 'queued'.
    if (creditCost > 0) {
      await refundCreditsAdmin(decoded.uid, creditCost, creditMeta).catch(() => {});
    }
    await jobRef.update({
      status: 'error',
      error: prepErr instanceof Error ? prepErr.message : String(prepErr),
      updatedAt: now(),
    }).catch(() => {});
    await deleteStagedReferences(decoded.uid, jobId);
    throw prepErr;
  }

  await onJobId(jobId);
  await runVideoJob(decoded.uid, jobId, productId, script, refs, creditCost, creditMeta, provider);
}

export function registerVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/generate-script', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const body = req.body as Parameters<typeof gerarRoteiro>[0];
      if (!body?.description || !body?.imageUrl) {
        return res.status(400).json({ error: 'description e imageUrl são obrigatórios' });
      }
      res.json({ script: await gerarRoteiro(body) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/video/start-job', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const params = req.body as InicioVideo;
      if (!params?.productId || !params.script || !Array.isArray(params.shotImageUrls) || params.shotImageUrls.length !== SHOTS.length) {
        return res.status(400).json({ error: `productId, script e shotImageUrls (${SHOTS.length} imagens) são obrigatórios` });
      }
      // Send the jobId immediately in the first chunk so the client can
      // start listening on Firestore without waiting for the full job.
      // Keeping the HTTP connection open (not calling res.end() here) is
      // intentional: Cloud Run will not scale down or kill an instance that
      // has an active request. The connection closes when the job finishes.
      let iniciou = false;
      try {
        await iniciarVideo(decoded, params, (jobId) => {
          iniciou = true;
          res.setHeader('Content-Type', 'application/json');
          res.write(JSON.stringify({ jobId }));
        });
      } finally {
        if (iniciou) res.end();
      }
    } catch (err) {
      if (!res.headersSent) sendError(res, err);
      else res.end();
    }
  });
}
