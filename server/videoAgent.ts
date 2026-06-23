import type express from 'express';
import { GoogleGenAI } from '@google/genai';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost } from '../src/credits';
import type { CreditAction } from '../src/credits';
import { FieldValue } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';

const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
const GCP_PROJECT = firebaseAppletConfig.projectId;
const VEO_MODEL = 'veo-3.1-fast-generate-001';
const TEXT_MODEL = 'gemini-2.5-flash';

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
  const prompt = `Você é um diretor de vídeo especialista em e-commerce. Crie um roteiro curto e cinematográfico para um vídeo de 8 segundos que apresenta o produto abaixo de forma envolvente, com interação humana natural.

Produto: ${description}${brand ? `\nMarca: ${brand}` : ''}

O vídeo deve ter:
- UMA pessoa interagindo naturalmente com o produto no seu contexto de uso real
- Movimento de câmera suave (close → plano médio ou vice-versa)
- Ambiente realista e específico para este produto (não estúdio genérico)
- Sensação de vida real, não propaganda

Retorne APENAS um JSON válido neste formato exato:
{
  "cena": "Descrição do ambiente e enquadramento inicial em português (max 80 chars)",
  "acao": "O que a pessoa faz com o produto, como interage (max 120 chars)",
  "audio": "Sons ambiente, trilha, ou fala breve da pessoa (max 80 chars)"
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

  try {
    await jobRef.update({ status: 'processing', updatedAt: now() });

    const fullPrompt = [
      `Cena: ${script.cena}`,
      `Ação: ${script.acao}`,
      `Áudio: ${script.audio}`,
      'Estilo: cinematográfico, luz natural, câmera lenta suave, realista, alta qualidade, 4K',
      'IMPORTANTE: A pessoa deve interagir naturalmente com o produto. Sem texto na tela. Sem efeitos artificiais.',
    ].join('\n');

    const ai = getVeoClient();
    let operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: fullPrompt,
      image: { imageBytes: imageBase64, mimeType },
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: '9:16',
        personGeneration: 'allow_adult',
        generateAudio: false,
      },
    });

    // Poll until done — Veo typically takes 2–5 minutes
    while (!operation.done) {
      await new Promise((r) => setTimeout(r, 15000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(String((operation.error as any).message ?? operation.error));
    }

    const videoBytes = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
    if (!videoBytes) throw new Error('Veo não retornou bytes de vídeo');

    // Upload to Firebase Storage
    const bucket = adminStorage.bucket(STORAGE_BUCKET);
    const filePath = `product-videos/${uid}/${productId}/${jobId}.mp4`;
    const file = bucket.file(filePath);
    await file.save(Buffer.from(videoBytes, 'base64'), {
      contentType: 'video/mp4',
      metadata: { cacheControl: 'public, max-age=31536000' },
    });
    await file.makePublic();
    const videoUrl = file.publicUrl();

    await jobRef.update({ status: 'done', videoUrl, updatedAt: now() });

    // Also write video URL to the product document for convenience
    const productRef = adminDb.collection('users').doc(uid).collection('products').doc(productId);
    const prodSnap = await productRef.get();
    if (prodSnap.exists) {
      await productRef.update({ _videoUrl: videoUrl, _videoJobId: jobId, updatedAt: now() });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobRef.update({ status: 'error', error: message, updatedAt: now() }).catch(() => {});
  }
}

export function registerVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/video/generate-script', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
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
