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

// Output video is always 9:16 (vertical/portrait).
// The input image is pre-cropped to the same 9:16 ratio to match.
const VIDEO_ASPECT_RATIO = '9:16';
const INPUT_IMAGE_W = 720;
const INPUT_IMAGE_H = 1280; // 9:16 portrait crop

interface VideoScript {
  cena: string;
  acao: string;
  audio: string;
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

// Crops the image to 9:16 portrait (centered) so that Veo receives a vertical
// frame and AI-extends the scene horizontally when generating the 16:9 video.
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

async function generateScript(
  description: string,
  brand: string,
  imageBase64: string,
  mimeType: string,
): Promise<VideoScript> {
  const ai = getGeminiClient();

  const prompt = `Você é um diretor de cinema especialista em vídeos de e-commerce.

Analise CUIDADOSAMENTE a imagem do produto fornecida e crie um roteiro cinematográfico para um vídeo VERTICAL (9:16) de 8 segundos.

**Informações do produto:**
Descrição: ${description}${brand ? `\nMarca: ${brand}` : ''}

**INSTRUÇÕES DE ANÁLISE DA IMAGEM (obrigatório antes de escrever o roteiro):**
Observe na imagem:
- Tipo de produto: formato, tamanho, cores dominantes, materiais visíveis
- Contexto/ambiente da foto (se houver): superfície, iluminação, elementos ao redor
- Ponto focal e composição: onde o produto está posicionado

**CAMPOS DO ROTEIRO:**

1. CENA — Ambiente e enquadramento inicial do vídeo horizontal.
   - Descreva o local específico baseado NO QUE VOCÊ VÊ na imagem (não invente cenário genérico)
   - Inclua: tipo de iluminação (natural/estúdio/exterior), superfície, clima da cena
   - Exemplo bom: "Bancada de cozinha em mármore, luz natural lateral, produto centralizado em close frontal"
   - Máximo 100 caracteres

2. AÇÃO — Movimento de câmera + interação humana com o produto.
   - Descreva um movimento específico de câmera coerente com o produto (close-up → afastamento, travelling, pan)
   - Inclua o que a pessoa faz: como pega, usa ou interage com o produto de forma natural
   - Seja detalhado: "Mãos femininas pegam o produto; câmera recua em dolly suave revelando mesa posta ao fundo"
   - O movimento deve fazer sentido visual para ESTE produto específico
   - Máximo 150 caracteres

3. ÁUDIO — Narração falada baseada nos benefícios reais do produto.
   - Escreva uma frase de narração curta que destaque o PRINCIPAL benefício extraído da descrição acima
   - Tom: natural, confiante, não publicitário — como uma pessoa recomendando para um amigo
   - Exemplo: "Resistente, leve e pronto para o seu dia a dia"
   - Máximo 100 caracteres

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem texto extra):
{
  "cena": "...",
  "acao": "...",
  "audio": "..."
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
  if (!parsed.cena || !parsed.acao || !parsed.audio) {
    throw new Error('Roteiro gerado inválido — campos obrigatórios ausentes');
  }
  return parsed;
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

    // Pre-process image to 9:16 portrait so Veo AI-extends horizontally
    // when generating the 16:9 landscape video, creating a cinematic reveal.
    const inputBuffer = Buffer.from(imageBase64, 'base64');
    const { base64: portraitBase64, mimeType: portraitMime } = await cropToPortrait(inputBuffer);
    console.log(`[video] image cropped to ${INPUT_IMAGE_W}x${INPUT_IMAGE_H} portrait jobId=${jobId}`);

    const fullPrompt = [
      `Cena: ${script.cena}`,
      `Ação: ${script.acao}`,
      `Narração: ${script.audio}`,
      'Formato: vertical 9:16, cinematográfico, luz natural, câmera lenta suave, realista, alta qualidade',
      'IMPORTANTE: A pessoa deve interagir naturalmente com o produto. Sem texto na tela. Sem efeitos artificiais.',
    ].join('\n');

    console.log(`[video] calling Veo model=${VEO_MODEL} aspectRatio=${VIDEO_ASPECT_RATIO} jobId=${jobId}`);
    const ai = getVeoClient();
    let operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: fullPrompt,
      image: { imageBytes: portraitBase64, mimeType: portraitMime },
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: VIDEO_ASPECT_RATIO,
        personGeneration: 'allow_adult',
        generateAudio: true,
      },
    });

    // Poll until done — Veo typically takes 2–5 minutes
    let pollCount = 0;
    while (!operation.done) {
      await new Promise((r) => setTimeout(r, 15000));
      operation = await ai.operations.getVideosOperation({ operation });
      pollCount++;
      console.log(`[video] polling jobId=${jobId} attempt=${pollCount} done=${operation.done}`);
    }

    if (operation.error) {
      throw new Error(String((operation.error as any).message ?? operation.error));
    }

    const videoBytes = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
    if (!videoBytes) throw new Error('Veo não retornou bytes de vídeo');
    console.log(`[video] Veo done jobId=${jobId} polls=${pollCount}`);

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
      const { description, brand, imageUrl } = req.body as {
        description: string;
        brand?: string;
        imageUrl: string;
      };
      if (!description || !imageUrl) {
        return res.status(400).json({ error: 'description e imageUrl são obrigatórios' });
      }
      const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
      const script = await generateScript(description, brand ?? '', base64, mimeType);
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
