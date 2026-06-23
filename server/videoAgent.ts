import type express from 'express';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
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
// The input image is pre-cropped to the same 9:16 ratio to match.
const VIDEO_ASPECT_RATIO = '9:16';
const INPUT_IMAGE_W = 720;
const INPUT_IMAGE_H = 1280; // 9:16 portrait crop

// Veo 3.1 generates at most 8s per call (and exactly 8s when given an input
// image). To reach the requested ~15s we generate the first 8s beat and then
// extend it by ~7s — yielding a single ~15s vertical clip.
const SEGMENT_1_SECONDS = 8;
const SEGMENT_2_SECONDS = 7;

interface VideoScript {
  cena: string;
  acaoInicio: string;
  narracaoInicio: string;
  acaoFinal: string;
  narracaoFinal: string;
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

// Crops the image to 9:16 portrait (centered) so Veo receives a vertical frame
// matching the 9:16 output video used on marketplace product pages.
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

Seu objetivo é criar um roteiro de VÍDEO COMERCIAL E EXPLICATIVO, na VERTICAL (9:16), com aproximadamente 15 segundos, que faça o cliente entender o produto e querer comprá-lo.

Analise CUIDADOSAMENTE a imagem fornecida antes de escrever.

**Informações do produto:**
${productName ? `Nome: ${productName}\n` : ''}${category ? `Categoria: ${category}\n` : ''}${brand ? `Marca: ${brand}\n` : ''}Descrição: ${description}

**Atributos do produto (use de 2 a 3 dos mais relevantes ao longo do roteiro):**
${formatAttributes(attributes)}

**REGRAS OBRIGATÓRIAS:**
- O vídeo é VERTICAL (9:16) — pense em enquadramento de celular, produto grande no centro.
- Tom COMERCIAL e EXPLICATIVO: mostre o que o produto é, do que é feito e por que vale a pena.
- Cite naturalmente de 2 a 3 ATRIBUTOS REAIS do produto (da lista acima ou visíveis na imagem). Nada de inventar características.
- As mãos devem MANIPULAR o produto de forma rica e realista: pegar, girar para mostrar ângulos/detalhes, abrir/fechar, acionar botões/zíperes/tampas, demonstrar o uso real, apontar para partes específicas. Evite gestos passivos (apenas segurar parado).
- O vídeo tem DOIS MOMENTOS encadeados:
  • ABERTURA (0–8s): gancho visual + apresentação do produto e início da manipulação.
  • DEMONSTRAÇÃO (8–15s): manipulação mais complexa mostrando funcionamento/benefício + fechamento.
- Sem texto na tela. Sem efeitos artificiais. Realista, luz natural ou de estúdio.

**CAMPOS DO ROTEIRO (responda em pt-BR):**

1. cena — Ambiente e enquadramento vertical inicial, baseado NO QUE VOCÊ VÊ na imagem (superfície, iluminação, clima). Máx. 120 caracteres.

2. acaoInicio — Ação dos primeiros ~8s: movimento de câmera + como as mãos começam a manipular o produto, destacando 1 atributo visível. Gestos concretos. Máx. 200 caracteres.

3. narracaoInicio — Narração de abertura, comercial e direta, citando 1 atributo/benefício. Frase curta e falada. Máx. 110 caracteres.

4. acaoFinal — Ação dos ~7s finais: manipulação MAIS COMPLEXA demonstrando o funcionamento/uso real do produto (abrir, acionar, montar, vestir, etc.), revelando mais 1–2 atributos. Máx. 200 caracteres.

5. narracaoFinal — Narração explicativa de fechamento citando 2–3 atributos/benefícios e convidando à compra, sem soar exagerado. Máx. 120 caracteres.

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem texto extra):
{
  "cena": "...",
  "acaoInicio": "...",
  "narracaoInicio": "...",
  "acaoFinal": "...",
  "narracaoFinal": "..."
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
  if (!parsed.cena || !parsed.acaoInicio || !parsed.narracaoInicio || !parsed.acaoFinal || !parsed.narracaoFinal) {
    throw new Error('Roteiro gerado inválido — campos obrigatórios ausentes');
  }
  return parsed;
}

// Runs a Veo generateVideos operation and polls until it completes, returning
// the produced video. Used for both the initial 8s beat and the extension.
async function runVeoOperation(
  ai: GoogleGenAI,
  jobId: string,
  label: string,
  request: Parameters<GoogleGenAI['models']['generateVideos']>[0],
): Promise<{ videoBytes?: string; mimeType?: string }> {
  let operation = await ai.models.generateVideos(request);

  // Poll until done — each Veo beat typically takes 2–5 minutes
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

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video?.videoBytes) throw new Error(`Veo não retornou bytes de vídeo (${label})`);
  console.log(`[video] ${label} done jobId=${jobId} polls=${pollCount}`);
  return video;
}

async function runVeoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: VideoScript,
  imageBase64: string,
  mimeType: string,
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('videoJobs').doc(jobId);
  console.log(`[video] runVeoJob start uid=${uid} jobId=${jobId} productId=${productId}`);

  try {
    await jobRef.update({ status: 'processing', updatedAt: now() });

    // Pre-process image to 9:16 portrait so it matches the vertical output video.
    const inputBuffer = Buffer.from(imageBase64, 'base64');
    const { base64: portraitBase64, mimeType: portraitMime } = await cropToPortrait(inputBuffer);
    console.log(`[video] image cropped to ${INPUT_IMAGE_W}x${INPUT_IMAGE_H} portrait jobId=${jobId}`);

    const ai = getVeoClient();

    const styleLine = 'Formato: vertical 9:16, comercial e explicativo para página de produto, luz natural ou de estúdio, câmera fluida, realista, alta qualidade.';
    const rulesLine = 'IMPORTANTE: As mãos devem MANIPULAR o produto de forma rica (girar, abrir, acionar, demonstrar o uso). Sem texto na tela. Sem efeitos artificiais.';

    // Beat 1 (0–8s): hook + start of manipulation, generated from the image.
    const promptInicio = [
      `Cena: ${script.cena}`,
      `Ação (abertura, ${SEGMENT_1_SECONDS}s): ${script.acaoInicio}`,
      `Narração: ${script.narracaoInicio}`,
      styleLine,
      rulesLine,
    ].join('\n');

    // Beat 2 (8–15s): more complex manipulation + demo, continues the first clip.
    const promptFinal = [
      `Continuação da mesma cena: ${script.cena}`,
      `Ação (demonstração, ${SEGMENT_2_SECONDS}s): ${script.acaoFinal}`,
      `Narração: ${script.narracaoFinal}`,
      styleLine,
      rulesLine,
    ].join('\n');

    console.log(`[video] beat#1 generate model=${VEO_MODEL} aspectRatio=${VIDEO_ASPECT_RATIO} jobId=${jobId}`);
    const firstVideo = await runVeoOperation(ai, jobId, 'beat#1', {
      model: VEO_MODEL,
      prompt: promptInicio,
      image: { imageBytes: portraitBase64, mimeType: portraitMime },
      config: {
        numberOfVideos: 1,
        durationSeconds: SEGMENT_1_SECONDS,
        aspectRatio: VIDEO_ASPECT_RATIO,
        personGeneration: 'allow_adult',
        generateAudio: true,
      },
    });

    // Extend the first beat by ~7s → ~15s total. Best-effort: if the extend
    // call fails (e.g. model/feature unavailable), fall back to the 8s clip so
    // the user still gets a video instead of losing the job and the credits.
    let finalVideo = firstVideo;
    try {
      console.log(`[video] beat#2 extend +${SEGMENT_2_SECONDS}s jobId=${jobId}`);
      finalVideo = await runVeoOperation(ai, jobId, 'beat#2', {
        model: VEO_MODEL,
        prompt: promptFinal,
        video: { videoBytes: firstVideo.videoBytes, mimeType: firstVideo.mimeType ?? 'video/mp4' },
        config: {
          numberOfVideos: 1,
          durationSeconds: SEGMENT_2_SECONDS,
          personGeneration: 'allow_adult',
          generateAudio: true,
        },
      });
    } catch (extendErr) {
      console.error(`[video] extend failed jobId=${jobId}, falling back to 8s clip:`, extendErr);
      finalVideo = firstVideo;
    }

    const videoBytes = finalVideo.videoBytes;
    if (!videoBytes) throw new Error('Veo não retornou bytes de vídeo');
    console.log(`[video] Veo done jobId=${jobId}`);

    // Upload to Firebase Storage.
    // Uniform bucket-level access is enabled, so object ACLs are not allowed.
    // We embed a Firebase download token in the object metadata —
    // this produces the same permanent URL format the client SDK uses.
    const bucket = adminStorage.bucket(STORAGE_BUCKET);
    const filePath = `product-videos/${uid}/${productId}/${jobId}.mp4`;
    const file = bucket.file(filePath);
    const downloadToken = crypto.randomUUID();
    await file.save(Buffer.from(videoBytes, 'base64'), {
      contentType: 'video/mp4',
      metadata: {
        cacheControl: 'public, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    const videoUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;

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
    console.error(`[video] runVeoJob failed jobId=${jobId}:`, err);
    await jobRef.update({ status: 'error', error: message, updatedAt: now() }).catch(() => {});
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

      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.videoGeneration, {
        productName,
        userName: decoded.name ?? decoded.email,
      });

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
      runVeoJob(decoded.uid, jobId, productId, script, base64, mimeType);

      res.json({ jobId });
    } catch (err) {
      sendError(res, err);
    }
  });
}
