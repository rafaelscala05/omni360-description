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
  VEO_MODEL, VIDEO_ASPECT_RATIO, VideoGenerationReferenceType,
  getVeoClient, resizeForReference, runVeoOperation, runFfmpeg,
  debitCreditsAdmin, refundCreditsAdmin, assertNoActiveVideoJob, now, STORAGE_BUCKET,
} from './videoShared';
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
- "acaoVisual": o que acontece na cena além da fala (gestos, ângulo de câmera, manipulação do produto).
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
  productImageBase64: string,
  productImageMimeType: string,
  avatarImageBase64: string,
  avatarImageMimeType: string,
): Promise<UgcVideoScript> {
  const ai = getGeminiClient();
  const prompt = buildUgcScriptPrompt(params);

  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: avatarImageMimeType, data: avatarImageBase64 } },
          { inlineData: { mimeType: productImageMimeType, data: productImageBase64 } },
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

// Each clip is an independent Veo generation, so the avatar's description
// (appearance AND voice) must be in every clip's prompt — the reference image
// only anchors the face, nothing else keeps the voice consistent across cuts.
export function buildUgcClipPrompt(params: {
  cena: string;
  avatarDescricao: string;
  clip: UgcVideoClip;
}): { prompt: string; negativePrompt: string } {
  const { cena, avatarDescricao, clip } = params;
  const styleLine = 'Formato: vertical 9:16, estilo UGC autêntico (câmera na mão ou tripé caseiro, iluminação natural, estética espontânea-realista, não é produção de estúdio comercial).';
  const rulesLine = 'O AVATAR aparece em quadro, olha diretamente para a câmera e FALA a fala abaixo em português do Brasil, com sincronia labial. Interage naturalmente com o produto enquanto fala.';
  const fidelityLine = 'FIDELIDADE OBRIGATÓRIA: o avatar deve ser IDÊNTICO à imagem de referência de pessoa (mesmo rosto, cabelo, tom de pele, roupa). O produto deve ser IDÊNTICO à imagem de referência de produto (mesmas cores, proporções, logotipo, materiais). Nunca redesenhe nenhum dos dois.';
  const negativePrompt = "avatar diferente da referência, rosto diferente, produto diferente da referência, cores alteradas, logotipo modificado, voz robótica, fala fora de sincronia, texto na tela, legendas, marca d'água, distorções, baixa qualidade";

  const prompt = [
    `Cena: ${cena}`,
    `Avatar (aparência e voz — a MESMA em todos os clipes): ${avatarDescricao}`,
    'Mantenha exatamente a mesma voz (timbre, tom, energia e sotaque) em todos os clipes deste vídeo.',
    `Papel do clipe: ${clip.papel} (~8s)`,
    `Ação visual: ${clip.acaoVisual}`,
    `Fala do avatar (dita olhando para a câmera): "${clip.fala}"`,
    styleLine,
    rulesLine,
    fidelityLine,
  ].join('\n');

  return { prompt, negativePrompt };
}

async function generateUgcClip(
  ai: GoogleGenAI,
  jobId: string,
  index: number,
  clip: UgcVideoClip,
  cena: string,
  avatarDescricao: string,
  avatarImage: { base64: string; mimeType: string },
  productImage: { base64: string; mimeType: string },
  workDir: string,
): Promise<string> {
  const [avatarResized, productResized] = await Promise.all([
    resizeForReference(Buffer.from(avatarImage.base64, 'base64')),
    resizeForReference(Buffer.from(productImage.base64, 'base64')),
  ]);
  const { prompt, negativePrompt } = buildUgcClipPrompt({ cena, avatarDescricao, clip });

  console.log(`[ugc-video] clip ${index + 1} (${clip.papel}) generate jobId=${jobId}`);
  const videoBytes = await runVeoOperation(ai, jobId, `clip#${index + 1}`, {
    model: VEO_MODEL,
    prompt,
    config: {
      numberOfVideos: 1,
      durationSeconds: 8,
      aspectRatio: VIDEO_ASPECT_RATIO,
      personGeneration: 'allow_adult',
      generateAudio: true,
      negativePrompt,
      referenceImages: [
        { image: { imageBytes: avatarResized.base64, mimeType: avatarResized.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
        { image: { imageBytes: productResized.base64, mimeType: productResized.mimeType }, referenceType: VideoGenerationReferenceType.ASSET },
      ],
    },
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
  avatarImage: { base64: string; mimeType: string },
  productImage: { base64: string; mimeType: string },
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('ugcVideoJobs').doc(jobId);
  console.log(`[ugc-video] runUgcVideoJob start uid=${uid} jobId=${jobId} productId=${productId}`);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `ugc-video-${jobId}-`));

  try {
    await jobRef.update({ status: 'processing', clipsDone: 0, totalClips: script.clipes.length, step: 'clip', updatedAt: now() });

    const ai = getVeoClient();
    let clipsDone = 0;
    const segmentPaths = await Promise.all(
      script.clipes.map(async (clip, i) => {
        const segPath = await generateUgcClip(ai, jobId, i, clip, script.cena, script.avatarDescricao, avatarImage, productImage, workDir);
        clipsDone += 1;
        await jobRef.update({ clipsDone, updatedAt: now() });
        return segPath;
      }),
    );

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
  }
}

export function registerUgcVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/ugc/generate-script', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const {
        description, brand, productImageUrl, avatarImageUrl, avatarDescricao, productName, category, attributes,
      } = req.body as {
        description: string;
        brand?: string;
        productImageUrl: string;
        avatarImageUrl: string;
        avatarDescricao: string;
        productName?: string;
        category?: string;
        attributes?: Record<string, string>;
      };
      if (!description || !productImageUrl || !avatarImageUrl || !avatarDescricao) {
        return res.status(400).json({ error: 'description, productImageUrl, avatarImageUrl e avatarDescricao são obrigatórios' });
      }
      const [productImage, avatarImage] = await Promise.all([
        fetchImageAsBase64(productImageUrl),
        fetchImageAsBase64(avatarImageUrl),
      ]);
      const script = await generateUgcScript(
        {
          description,
          brand: brand ?? '',
          productName: productName ?? '',
          category: category ?? '',
          attributes: attributes ?? {},
          avatarDescricao,
        },
        productImage.base64,
        productImage.mimeType,
        avatarImage.base64,
        avatarImage.mimeType,
      );
      res.json({ script });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/video/ugc/start-job', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { productId, productName, script, avatarImageUrl, productImageUrl } = req.body as {
        productId: string;
        productName: string;
        script: UgcVideoScript;
        avatarImageUrl: string;
        productImageUrl: string;
      };
      if (!productId || !script || !avatarImageUrl || !productImageUrl) {
        return res.status(400).json({ error: 'productId, script, avatarImageUrl e productImageUrl são obrigatórios' });
      }
      if (!validateUgcScript(script)) {
        return res.status(400).json({ error: 'script inválido' });
      }

      await assertNoActiveVideoJob(decoded.uid);

      const creditMeta = { productName, userName: decoded.name ?? decoded.email ?? '' };
      const creditCost = await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.ugcVideoGeneration, creditMeta);

      const jobRef = adminDb.collection('users').doc(decoded.uid).collection('ugcVideoJobs').doc();
      const jobId = jobRef.id;

      let avatarImage: { base64: string; mimeType: string };
      let productImage: { base64: string; mimeType: string };
      try {
        await jobRef.set({
          jobId, productId, status: 'queued', videoUrl: null, error: null, createdAt: now(), updatedAt: now(),
        });
        [avatarImage, productImage] = await Promise.all([
          fetchImageAsBase64(avatarImageUrl),
          fetchImageAsBase64(productImageUrl),
        ]);
      } catch (prepErr) {
        if (creditCost > 0) {
          await refundCreditsAdmin(decoded.uid, creditCost, creditMeta, UGC_REFUND).catch(() => {});
        }
        await jobRef.update({
          status: 'error',
          error: prepErr instanceof Error ? prepErr.message : String(prepErr),
          updatedAt: now(),
        }).catch(() => {});
        throw prepErr;
      }

      // The server owns the persisted product status for the whole job lifecycle
      // (queued here, done/error in runUgcVideoJob). If the client wrote 'queued'
      // itself after receiving the jobId, a fast server-side 'error' could land
      // first and then be overwritten back to 'queued'.
      await adminDb.collection('users').doc(decoded.uid).collection('products').doc(productId)
        .update({ _ugcVideoJobId: jobId, _ugcVideoStatus: 'queued', updatedAt: now() })
        .catch(() => {});

      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ jobId }));

      try {
        await runUgcVideoJob(decoded.uid, jobId, productId, script, avatarImage, productImage, creditCost, creditMeta);
      } finally {
        res.end();
      }
    } catch (err) {
      sendError(res, err);
    }
  });
}
