import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { adminDb, adminStorage } from '../firebaseAdmin';
import { assertSafeImageUrl } from '../safeUrl';
import { debitCreditsAdmin } from '../contentAgent';
import { CREDIT_ACTIONS, resolveCreditCost } from '../../src/credits';
import type { MeliListingRecord } from './types';
import { sanitizeError } from './utils';
import { ZOOM_MIN_SIDE } from './media';

const IMAGE_MODEL = process.env.MELI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const GENERATED_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_generated_pictures');

export type MeliGeneratedPictureKind = 'lifestyle' | 'white_background';

export interface MeliGeneratedPicture {
  id: string;
  itemId: string;
  kind: MeliGeneratedPictureKind;
  url: string;
  storagePath: string;
  sourcePictureId: string;
  instructions: string | null;
  createdAt: string;
}

// Capa na posição 1 (é a foto da busca); ambientada logo depois dela.
export const TARGET_ORDER: Record<MeliGeneratedPictureKind, number> = { white_background: 1, lifestyle: 2 };

function asObjects(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object')) : [];
}

export function buildPicturePrompt(kind: MeliGeneratedPictureKind, title: string, instructions: string | null): string {
  const product = `O produto é: "${title}".`;
  const fidelity = 'Mantenha o produto IDÊNTICO ao da foto enviada: mesmo formato, proporções, cores, rótulos, textos impressos e acabamento. Não adicione, remova nem invente peças, acessórios ou variações.';
  const clean = 'Sem nenhum texto, preço, selo, logotipo adicional, borda ou marca d’água na imagem.';
  const extra = instructions ? `Pedido do vendedor: ${instructions}` : '';
  if (kind === 'white_background') {
    return [
      'Crie a foto de capa de um anúncio do Mercado Livre.', product, fidelity,
      'Coloque o produto isolado sobre fundo branco puro (#FFFFFF), centralizado, ocupando cerca de 85% do quadro, com iluminação de estúdio e sombra suave sob ele. Formato quadrado.',
      clean, extra,
    ].filter(Boolean).join(' ');
  }
  return [
    'Crie uma foto ambientada realista para um anúncio do Mercado Livre.', product, fidelity,
    'Mostre o produto em uso ou no ambiente onde ele é usado, coerente com a sua finalidade, com iluminação natural, composição limpa e o produto em foco e em destaque. Formato quadrado, qualidade fotográfica.',
    clean, extra,
  ].filter(Boolean).join(' ');
}

async function fetchSource(url: string): Promise<Buffer> {
  await assertSafeImageUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar a foto de origem.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error('A foto de origem passa de 8 MB.');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureCredits(uid: string): Promise<void> {
  const [config, user] = await Promise.all([
    adminDb.collection('config').doc('credits').get().catch(() => null),
    adminDb.collection('users').doc(uid).get(),
  ]);
  const cost = resolveCreditCost((config?.data()?.costs as Record<string, number>) ?? {}, CREDIT_ACTIONS.ambientImage.key);
  if (Number(user.data()?.credits ?? 0) < cost) {
    throw Object.assign(new Error('Créditos insuficientes para gerar a foto.'), { status: 402 });
  }
}

// Saída padronizada: quadrada e com 1200 px, o mínimo para o zoom do Mercado
// Livre. Fundo branco usa "contain" sobre branco para não cortar o produto.
export async function normalizeGeneratedPicture(buffer: Buffer, kind: MeliGeneratedPictureKind): Promise<Buffer> {
  const image = sharp(buffer).rotate();
  const resized = kind === 'white_background'
    ? image.resize(ZOOM_MIN_SIDE, ZOOM_MIN_SIDE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).flatten({ background: '#ffffff' })
    : image.resize(ZOOM_MIN_SIDE, ZOOM_MIN_SIDE, { fit: 'cover', position: 'attention' });
  return resized.jpeg({ quality: 90 }).toBuffer();
}

export async function generateListingPicture(
  uid: string,
  itemId: string,
  options: { kind: MeliGeneratedPictureKind; sourcePictureId?: string | null; instructions?: string | null },
): Promise<MeliGeneratedPicture> {
  const normalizedId = itemId.toUpperCase();
  const listingSnap = await LISTINGS_REF(uid).doc(normalizedId).get();
  if (!listingSnap.exists) throw Object.assign(new Error('Anúncio não encontrado.'), { status: 404 });
  const listing = listingSnap.data() as MeliListingRecord;
  const pictures = asObjects(listing.pictures);
  const source = (options.sourcePictureId && pictures.find((picture) => String(picture.id) === options.sourcePictureId)) || pictures[0];
  const sourceUrl = String(source?.secure_url || source?.url || '');
  if (!sourceUrl) throw Object.assign(new Error('O anúncio não tem foto para servir de base.'), { status: 422 });
  const instructions = options.instructions?.trim().slice(0, 400) || null;
  if (instructions && /https?:\/\/|www\./i.test(instructions)) throw Object.assign(new Error('As instruções não podem conter links.'), { status: 422 });

  await ensureCredits(uid);
  const original = await fetchSource(sourceUrl);
  const reference = await sharp(original).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();

  // Modelo de imagem só responde na região global do Vertex.
  const ai = new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: 'global' });
  let imageBase64: string | null = null;
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: 'image/jpeg', data: reference.toString('base64') } },
        { text: buildPicturePrompt(options.kind, listing.title, instructions) },
      ] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    imageBase64 = parts.find((part) => part.inlineData?.data)?.inlineData?.data || null;
  } catch (error) {
    throw Object.assign(new Error(`A geração da foto falhou: ${sanitizeError(error)}`), { status: 502 });
  }
  if (!imageBase64) throw Object.assign(new Error('O modelo não devolveu uma imagem. Tente de novo.'), { status: 502 });

  const output = await normalizeGeneratedPicture(Buffer.from(imageBase64, 'base64'), options.kind);
  const ref = GENERATED_REF(uid).doc();
  const storagePath = `meli-pictures/${uid}/${normalizedId}/${ref.id}.jpg`;
  const token = crypto.randomUUID();
  await adminStorage.bucket(STORAGE_BUCKET).file(storagePath).save(output, {
    contentType: 'image/jpeg',
    resumable: false,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  // URL HTTPS pública com token: é o que o Mercado Livre baixa como `source`.
  const url = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  // Cobra só depois de a foto existir: falha de geração não consome crédito.
  await debitCreditsAdmin(uid, CREDIT_ACTIONS.ambientImage, { productName: listing.title, sku: normalizedId });
  const record: MeliGeneratedPicture = {
    id: ref.id, itemId: normalizedId, kind: options.kind, url, storagePath,
    sourcePictureId: String(source?.id || ''), instructions, createdAt: new Date().toISOString(),
  };
  await ref.set(record);
  return record;
}
