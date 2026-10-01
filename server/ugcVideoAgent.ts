// server/ugcVideoAgent.ts
//
// UGC ("user-generated content") video pipeline: a user-created avatar speaks
// to camera and interacts with the product, instead of the classic pipeline's
// muted hands + voice-over. Mirrors server/videoAgent.ts's shape, reusing the
// generic Veo/ffmpeg/credit helpers from server/videoShared.ts.
// See docs/superpowers/specs/2026-09-23-ugc-avatar-video-design.md.
import type express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS } from '../src/credits';
import {
  getGeminiClient, TEXT_MODEL, fetchImageAsBase64, formatAttributes, sendError,
  VIDEO_ASPECT_RATIO,
  getVeoClient, runFfmpeg,
  debitCreditsAdmin, refundCreditsAdmin, assertNoActiveVideoJob, now, STORAGE_BUCKET,
  getDefaultVideoProvider, PRODUCT_REFERENCE_PROMPT_LINE, PRODUCT_REFERENCE_NEGATIVE, CAMERA_VARIETY_RULE,
  PRODUCT_COVERAGE_RULE, PRODUCT_COVERAGE_CLIP_LINE, PRODUCT_COVERAGE_NEGATIVE,
  PHOTO_PANEL_PROMPT_LINE, PHOTO_PANEL_NEGATIVE, sanitizePhotoUrls,
  prepareReferenceImages, stageReferenceImages, deleteStagedReferences, buildPhotoPanel,
  type ClipReferenceImage, type PreparedImage, type VideoProvider,
} from './videoShared';
import { runClipGeneration, getOpenRouterApiKey, SEEDANCE_MAX_REFERENCE_IMAGES } from './videoProviders';
import type { GoogleGenAI } from '@google/genai';

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

**Imagens anexadas:** a PRIMEIRA é o avatar; a SEGUNDA é a folha de referência do produto (vários ângulos e detalhes); as DEMAIS são FOTOS REAIS do produto. Os lados, partes e estados do produto que aparecem nessas imagens são os ÚNICOS que o vídeo pode mostrar.

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
- "acaoVisual": começa por "Câmera: <ângulo> + <movimento>." e depois descreve o que acontece na cena além da fala (gestos, manipulação do produto).
${CAMERA_VARIETY_RULE}
- Como o avatar FALA em todos os clipes, o rosto dele precisa ficar visível em todos: varie o enquadramento sem tirar o rosto de quadro (ex.: selfie em close no gancho; plano médio com o produto em primeiro plano ou câmera por cima do ombro mostrando produto e rosto na demonstração; ângulo lateral/3/4 com leve aproximação no fechamento).
${PRODUCT_COVERAGE_RULE}
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
  avatarImage: { base64: string; mimeType: string },
  // [folha de referência, ...fotos reais escolhidas]
  productImages: Array<{ base64: string; mimeType: string }>,
): Promise<UgcVideoScript> {
  const ai = getGeminiClient();
  const prompt = buildUgcScriptPrompt(params);

  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: avatarImage.mimeType, data: avatarImage.base64 } },
          ...productImages.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
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

const UGC_REFUND = { label: 'Estorno — Geração de Vídeo UGC', actionKey: 'video_ugc_generation_refund' };

const UGC_STYLE_LINE = 'Formato: vertical 9:16, estilo UGC autêntico (câmera na mão ou tripé caseiro, iluminação natural, estética espontânea-realista, não é produção de estúdio comercial).';
const UGC_FIDELITY_LINE = 'FIDELIDADE OBRIGATÓRIA: o avatar deve ser IDÊNTICO à imagem de referência de pessoa (mesmo rosto, cabelo, tom de pele, roupa). O produto deve ser IDÊNTICO às fotos reais do produto (mesmas cores, proporções, logotipo, materiais). Nunca redesenhe nenhum dos dois.';
const UGC_BASE_NEGATIVE = "avatar diferente da referência, rosto diferente, produto diferente da referência, cores alteradas, logotipo modificado, voz robótica, fala fora de sincronia, texto na tela, legendas, marca d'água, distorções, baixa qualidade";
const AVATAR_PAPEL = 'o AVATAR — a pessoa que aparece e fala (rosto, cabelo, tom de pele e roupa idênticos)';
const SHEET_PAPEL = 'FOLHA DE REFERÊNCIA do mesmo produto em vários ângulos — só para fidelidade, nunca aparece no vídeo';
// Veo só gera clipes de 8s em reference-to-video; o roteiro é escrito para isso.
export const UGC_CLIP_SECONDS = 8;

export function buildUgcNegativePrompt(opts: { hasProductReference?: boolean; hasPhotoPanel?: boolean }): string {
  return [
    UGC_BASE_NEGATIVE,
    PRODUCT_COVERAGE_NEGATIVE,
    ...(opts.hasProductReference ? [PRODUCT_REFERENCE_NEGATIVE] : []),
    ...(opts.hasPhotoPanel ? [PHOTO_PANEL_NEGATIVE] : []),
  ].join(', ');
}

// Veo: each clip is an independent generation, so the avatar's description
// (appearance AND voice) must be in every clip's prompt — the reference image
// only anchors the face, nothing else keeps the voice consistent across cuts.
export function buildUgcClipPrompt(params: {
  cena: string;
  avatarDescricao: string;
  clip: UgcVideoClip;
  hasProductReference?: boolean;
  hasPhotoPanel?: boolean;
}): { prompt: string; negativePrompt: string } {
  const { cena, avatarDescricao, clip, hasProductReference, hasPhotoPanel } = params;
  const rulesLine = 'O AVATAR aparece em quadro, olha diretamente para a câmera e FALA a fala abaixo em português do Brasil, com sincronia labial. Interage naturalmente com o produto enquanto fala.';

  const prompt = [
    `Cena: ${cena}`,
    `Avatar (aparência e voz — a MESMA em todos os clipes): ${avatarDescricao}`,
    'Mantenha exatamente a mesma voz (timbre, tom, energia e sotaque) em todos os clipes deste vídeo.',
    `Papel do clipe: ${clip.papel} (~${UGC_CLIP_SECONDS}s)`,
    `Ação visual: ${clip.acaoVisual}`,
    'Siga EXATAMENTE o ângulo e o movimento de câmera descritos na ação visual.',
    `Fala do avatar (dita olhando para a câmera): "${clip.fala}"`,
    UGC_STYLE_LINE,
    rulesLine,
    UGC_FIDELITY_LINE,
    PRODUCT_COVERAGE_CLIP_LINE,
    ...(hasProductReference ? [PRODUCT_REFERENCE_PROMPT_LINE] : []),
    ...(hasPhotoPanel ? [PHOTO_PANEL_PROMPT_LINE] : []),
  ].join('\n');

  return { prompt, negativePrompt: buildUgcNegativePrompt({ hasProductReference, hasPhotoPanel }) };
}

// Seedance: o roteiro inteiro num clipe só (UGC_CLIP_SECONDS por trecho, cabe
// nos 30s do modelo) — uma geração só mantém o mesmo rosto, a mesma voz e o
// mesmo produto do começo ao fim, sem depender de cada clipe acertar sozinho.
//
// O avatar NÃO vai como imagem: o filtro do Seedance recusa qualquer rosto
// fotorrealista como "pessoa real" (InputImageSensitiveContentDetected.
// PrivacyInformation), inclusive os nossos avatares gerados por IA. A pessoa
// é recriada só pelo texto — a descrição salva do avatar mais, quando houver,
// a descrição visual lida do retrato (describeAvatarAppearance).
export function buildUgcSeedancePrompt(
  script: UgcVideoScript,
  opts: { hasProductReference?: boolean; aparenciaAvatar?: string },
): { prompt: string; negativePrompt: string; durationSeconds: number } {
  const durationSeconds = script.clipes.length * UGC_CLIP_SECONDS;
  const timeline = script.clipes.map((clip, i) => {
    const start = i * UGC_CLIP_SECONDS;
    const end = start + UGC_CLIP_SECONDS;
    return `[${start}s–${end}s] ${clip.papel}: ${clip.acaoVisual}\n  Fala do avatar (olhando para a câmera): "${clip.fala}"`;
  });
  const aparencia = opts.aparenciaAvatar?.trim();
  const prompt = [
    `Vídeo ÚNICO e contínuo de ${durationSeconds}s, com a MESMA pessoa e o MESMO produto do início ao fim. Pode haver corte seco entre um trecho e o próximo.`,
    `Cena: ${script.cena}`,
    'AVATAR (não há imagem de referência da pessoa — recrie-a seguindo esta descrição à risca e mantenha exatamente a mesma aparência em todos os trechos):',
    `- Perfil e voz: ${script.avatarDescricao}`,
    ...(aparencia ? [`- Aparência: ${aparencia}`] : []),
    'O AVATAR aparece em quadro, olha diretamente para a câmera e FALA cada fala abaixo em português do Brasil, com sincronia labial e a MESMA voz (timbre, tom, energia e sotaque) no vídeo inteiro. Interage naturalmente com o produto enquanto fala.',
    'Linha do tempo (siga EXATAMENTE o ângulo e o movimento de câmera de cada trecho):',
    ...timeline,
    UGC_STYLE_LINE,
    'FIDELIDADE OBRIGATÓRIA: o produto deve ser IDÊNTICO às fotos reais do produto (mesmas cores, proporções, logotipo, materiais) — nunca redesenhe. A pessoa segue a descrição acima e não muda de rosto, cabelo ou roupa entre os trechos.',
    PRODUCT_COVERAGE_CLIP_LINE,
    ...(opts.hasProductReference ? [PRODUCT_REFERENCE_PROMPT_LINE] : []),
  ].join('\n');
  return { prompt, negativePrompt: buildUgcNegativePrompt({ hasProductReference: opts.hasProductReference }), durationSeconds };
}

// Referências do clipe único do Seedance: só o produto (fotos reais + folha).
// O avatar fica de fora de propósito — ver buildUgcSeedancePrompt.
export function buildUgcSeedanceReferences(
  photos: PreparedImage[],
  sheet: PreparedImage | null,
  maxImages: number,
): ClipReferenceImage[] {
  const photoSlots = Math.max(0, maxImages - (sheet ? 1 : 0));
  return [
    ...photos.slice(0, photoSlots).map((p, i) => ({
      url: p.url, base64: p.base64, mimeType: p.mimeType,
      papel: `FOTO REAL ${i + 1} do PRODUTO (formato, cores, logotipo e materiais idênticos)`,
    })),
    ...(sheet ? [{ url: sheet.url, base64: sheet.base64, mimeType: sheet.mimeType, papel: SHEET_PAPEL }] : []),
  ];
}

// Como o Seedance não recebe o retrato, o Gemini lê o retrato no nosso
// servidor e escreve o que se vê (cabelo, rosto, roupa…) para ir no prompt.
// Falha aqui não derruba o job: o vídeo segue só com a descrição salva.
export async function describeAvatarAppearance(avatar: PreparedImage): Promise<string> {
  try {
    const ai = getGeminiClient();
    const result = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: avatar.mimeType, data: avatar.base64 } },
          { text: 'Descreva, em português do Brasil, a aparência física desta pessoa para que um diretor de vídeo consiga recriá-la sem ver a foto: cabelo (cor, comprimento, corte, textura), formato do rosto, sobrancelhas, pelos faciais, tom de pele, compleição, roupa (peças, cores, estampas) e acessórios. Só o que é visível na imagem, sem nome, sem suposições e sem descrever o fundo. Texto corrido, no máximo 450 caracteres.' },
        ],
      }],
    });
    return (result.text ?? '').trim().slice(0, 600);
  } catch (err) {
    console.warn('[ugc-video] describeAvatarAppearance falhou, seguindo só com a descrição salva:', (err as Error).message);
    return '';
  }
}

async function generateUgcClip(
  ai: GoogleGenAI,
  jobId: string,
  index: number,
  clip: UgcVideoClip,
  cena: string,
  avatarDescricao: string,
  avatar: PreparedImage,
  panel: { base64: string; mimeType: string },
  sheet: PreparedImage | null,
  workDir: string,
  provider: VideoProvider,
): Promise<string> {
  const { prompt, negativePrompt } = buildUgcClipPrompt({ cena, avatarDescricao, clip, hasProductReference: !!sheet, hasPhotoPanel: true });

  // Veo 3.1 takes up to 3 ASSET references: avatar + panel of real photos + reference sheet.
  const referenceImages: ClipReferenceImage[] = [
    { url: avatar.url, base64: avatar.base64, mimeType: avatar.mimeType, papel: AVATAR_PAPEL },
    { base64: panel.base64, mimeType: panel.mimeType, papel: 'PAINEL com as fotos reais do PRODUTO' },
    ...(sheet ? [{ url: sheet.url, base64: sheet.base64, mimeType: sheet.mimeType, papel: SHEET_PAPEL }] : []),
  ];

  console.log(`[ugc-video] clip ${index + 1} (${clip.papel}) generate jobId=${jobId} provider=${provider}`);
  const videoBytes = await runClipGeneration(provider, ai, jobId, `clip#${index + 1}`, {
    prompt,
    negativePrompt,
    durationSeconds: UGC_CLIP_SECONDS,
    aspectRatio: VIDEO_ASPECT_RATIO,
    generateAudio: true,
    referenceImages,
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
  refs: {
    avatar: PreparedImage;
    photos: PreparedImage[];     // fotos reais escolhidas no wizard (ao menos uma)
    sheet: PreparedImage | null; // folha de referência
  },
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
  provider: VideoProvider,
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('ugcVideoJobs').doc(jobId);
  const { avatar, photos, sheet } = refs;
  const singleClip = provider === 'seedance';
  const totalClips = singleClip ? 1 : script.clipes.length;
  console.log(`[ugc-video] runUgcVideoJob start uid=${uid} jobId=${jobId} productId=${productId} provider=${provider} photos=${photos.length} sheet=${sheet ? 'yes' : 'no'}`);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `ugc-video-${jobId}-`));

  try {
    await jobRef.update({ status: 'processing', clipsDone: 0, totalClips, step: 'clip', updatedAt: now() });

    const ai = getVeoClient();
    let segmentPaths: string[];
    if (singleClip) {
      const aparenciaAvatar = await describeAvatarAppearance(avatar);
      const { prompt, negativePrompt, durationSeconds } = buildUgcSeedancePrompt(script, { hasProductReference: !!sheet, aparenciaAvatar });
      const referenceImages = buildUgcSeedanceReferences(photos, sheet, SEEDANCE_MAX_REFERENCE_IMAGES);
      console.log(`[ugc-video] single clip ${durationSeconds}s generate jobId=${jobId} provider=${provider} refs=${referenceImages.length}`);
      const videoBytes = await runClipGeneration(provider, ai, jobId, 'clip#1', {
        prompt,
        negativePrompt,
        durationSeconds,
        aspectRatio: VIDEO_ASPECT_RATIO,
        generateAudio: true,
        referenceImages,
      });
      const segPath = path.join(workDir, 'clip0.mp4');
      await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
      await jobRef.update({ clipsDone: 1, updatedAt: now() });
      segmentPaths = [segPath];
    } else {
      // Montado uma vez: todas as fotos escolhidas numa vaga de referência só.
      const panel = await buildPhotoPanel(photos);
      let clipsDone = 0;
      segmentPaths = await Promise.all(
        script.clipes.map(async (clip, i) => {
          const segPath = await generateUgcClip(ai, jobId, i, clip, script.cena, script.avatarDescricao, avatar, panel, sheet, workDir, provider);
          clipsDone += 1;
          await jobRef.update({ clipsDone, updatedAt: now() });
          return segPath;
        }),
      );
    }

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
    // The client persisted _ugcVideoStatus: 'queued' when the job started. Without this,
    // a failed job leaves the product "queued" forever and the shared active-video gate
    // (classic + UGC) would block every other video job after a reload.
    await adminDb.collection('users').doc(uid).collection('products').doc(productId)
      .update({ _ugcVideoStatus: 'error', _ugcVideoError: message, updatedAt: now() })
      .catch(() => {});
    if (creditCost > 0) {
      await refundCreditsAdmin(uid, creditCost, meta, UGC_REFUND).catch((refundErr) => {
        console.error(`[ugc-video] refund failed uid=${uid} jobId=${jobId}:`, refundErr);
      });
      console.log(`[ugc-video] refunded ${creditCost} credits uid=${uid} jobId=${jobId}`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await deleteStagedReferences(uid, jobId);
  }
}

export interface PedidoRoteiroUgc {
  description: string;
  brand?: string;
  /** A folha de referência do produto (ou a primeira foto, sem ela). */
  productImageUrl: string;
  // Fotos reais escolhidas no wizard — o roteiro só usa os lados/estados que elas mostram.
  photoUrls?: string[];
  avatarImageUrl: string;
  avatarDescricao: string;
  productName?: string;
  category?: string;
  attributes?: Record<string, string>;
}

/** O roteiro UGC do wizard — também usado pelo Alfred (server/agent/videoAlfred.ts). */
export async function gerarRoteiroUgc(p: PedidoRoteiroUgc): Promise<UgcVideoScript> {
  const photos = sanitizePhotoUrls(p.photoUrls).filter((u) => u !== p.productImageUrl);
  const [avatarImage, ...productImages] = await Promise.all(
    [p.avatarImageUrl, p.productImageUrl, ...photos].map((u) => fetchImageAsBase64(u)),
  );
  return generateUgcScript(
    {
      description: p.description,
      brand: p.brand ?? '',
      productName: p.productName ?? '',
      category: p.category ?? '',
      attributes: p.attributes ?? {},
      avatarDescricao: p.avatarDescricao,
    },
    avatarImage,
    productImages,
  );
}

export interface InicioVideoUgc {
  productId: string;
  productName: string;
  script: UgcVideoScript;
  avatarImageUrl: string;
  // Fotos reais escolhidas no wizard (todas marcadas por padrão).
  productPhotoUrls: string[];
  // Optional so older clients keep working; the current UI always sends it.
  productReferenceUrl?: string;
}

/**
 * Debita, cria o job e roda o vídeo UGC até o fim — o mesmo contrato de
 * iniciarVideo (videoAgent.ts): `onJobId` assim que o job existe, e a promessa
 * só resolve no fim, para quem chama segurar a requisição aberta.
 */
export async function iniciarVideoUgc(
  decoded: { uid: string; name?: string; email?: string },
  params: InicioVideoUgc,
  onJobId: (jobId: string) => void | Promise<void>,
): Promise<void> {
  const { productId, productName, script, avatarImageUrl, productReferenceUrl } = params;
  const photoUrls = sanitizePhotoUrls(params.productPhotoUrls);
  if (!productId || !script || !avatarImageUrl || photoUrls.length === 0) {
    throw Object.assign(new Error('productId, script, avatarImageUrl e ao menos uma foto do produto são obrigatórios'), { status: 400 });
  }
  if (!validateUgcScript(script)) throw Object.assign(new Error('script inválido'), { status: 400 });

  await assertNoActiveVideoJob(decoded.uid);

  // Resolvido e validado ANTES de debitar crédito — mesmo raciocínio do
  // fluxo clássico (server/videoAgent.ts), achado do code review de 2026-09-28.
  const provider = await getDefaultVideoProvider();
  if (provider === 'seedance') getOpenRouterApiKey();

  const creditMeta = { productName, userName: decoded.name ?? decoded.email ?? '' };
  const creditCost = await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.ugcVideoGeneration, creditMeta);

  const jobRef = adminDb.collection('users').doc(decoded.uid).collection('ugcVideoJobs').doc();
  const jobId = jobRef.id;

  let refs: { avatar: PreparedImage; photos: PreparedImage[]; sheet: PreparedImage | null };
  try {
    await jobRef.set({
      jobId, productId, status: 'queued', provider, videoUrl: null, error: null, createdAt: now(), updatedAt: now(),
    });
    const prepared = await prepareReferenceImages([avatarImageUrl, ...photoUrls, ...(productReferenceUrl ? [productReferenceUrl] : [])]);
    // O Seedance lê as referências por URL: vão cópias no nosso Storage,
    // nunca a URL original (CDN de ERP, http://, anti-bot…). O retrato do
    // avatar não é copiado: ele nunca vai para o Seedance (só é lido pelo
    // Gemini no nosso servidor — ver buildUgcSeedancePrompt).
    if (provider === 'seedance') {
      const productOnly = new Map(prepared);
      if (!photoUrls.includes(avatarImageUrl) && avatarImageUrl !== productReferenceUrl) productOnly.delete(avatarImageUrl);
      await stageReferenceImages(decoded.uid, jobId, productOnly);
    }
    refs = {
      avatar: prepared.get(avatarImageUrl)!,
      photos: photoUrls.map((url) => prepared.get(url)!),
      sheet: productReferenceUrl ? prepared.get(productReferenceUrl)! : null,
    };
  } catch (prepErr) {
    if (creditCost > 0) {
      await refundCreditsAdmin(decoded.uid, creditCost, creditMeta, UGC_REFUND).catch(() => {});
    }
    await jobRef.update({
      status: 'error',
      error: prepErr instanceof Error ? prepErr.message : String(prepErr),
      updatedAt: now(),
    }).catch(() => {});
    await deleteStagedReferences(decoded.uid, jobId);
    throw prepErr;
  }

  // The server owns the persisted product status for the whole job lifecycle
  // (queued here, done/error in runUgcVideoJob). If the client wrote 'queued'
  // itself after receiving the jobId, a fast server-side 'error' could land
  // first and then be overwritten back to 'queued'.
  await adminDb.collection('users').doc(decoded.uid).collection('products').doc(productId)
    .update({ _ugcVideoJobId: jobId, _ugcVideoStatus: 'queued', updatedAt: now() })
    .catch(() => {});

  await onJobId(jobId);
  await runUgcVideoJob(decoded.uid, jobId, productId, script, refs, creditCost, creditMeta, provider);
}

export function registerUgcVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/ugc/generate-script', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const body = req.body as PedidoRoteiroUgc;
      if (!body.description || !body.productImageUrl || !body.avatarImageUrl || !body.avatarDescricao) {
        return res.status(400).json({ error: 'description, productImageUrl, avatarImageUrl e avatarDescricao são obrigatórios' });
      }
      res.json({ script: await gerarRoteiroUgc(body) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/video/ugc/start-job', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { productId, productName, script, avatarImageUrl, productImageUrl, productPhotoUrls, productReferenceUrl } = req.body as {
        productId: string;
        productName: string;
        script: UgcVideoScript;
        avatarImageUrl: string;
        // Legado (uma foto só) — clientes atuais mandam productPhotoUrls.
        productImageUrl?: string;
        productPhotoUrls?: string[];
        productReferenceUrl?: string;
      };
      try {
        await iniciarVideoUgc(decoded, {
          productId, productName, script, avatarImageUrl, productReferenceUrl,
          productPhotoUrls: productPhotoUrls?.length ? productPhotoUrls : [productImageUrl ?? ''],
        }, (jobId) => {
          res.setHeader('Content-Type', 'application/json');
          res.write(JSON.stringify({ jobId }));
        });
      } finally {
        if (res.headersSent) res.end();
      }
    } catch (err) {
      if (res.headersSent) return;
      sendError(res, err);
    }
  });
}
