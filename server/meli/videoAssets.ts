import { adminDb } from '../firebaseAdmin';
import { jsonSafe } from './utils';

// Referência do produto e vídeo gerados para um anúncio. Ficam fora de
// meli_listings porque a sincronização regrava aquele documento inteiro.
// O vídeo não é publicado por API: o envio de vídeo por integração foi
// descontinuado pelo Mercado Livre para vendedores locais, então o vendedor
// baixa o arquivo e sobe como Clip no painel.
const MEDIA_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_media');

export interface MeliListingMedia {
  itemId: string;
  productReference: {
    imageUrl: string;
    sourceImages: string[];
    caracteristicas?: string;
    ajustes?: string[];
    createdAt: string;
  } | null;
  videoUrl: string | null;
  videoJobId: string | null;
  updatedAt: string;
}

const httpsUrl = (value: unknown): string | null => {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\/\S{1,2000}$/i.test(url) ? url : null;
};

export function normalizeMediaPatch(input: unknown): Partial<Omit<MeliListingMedia, 'itemId' | 'updatedAt'>> {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const patch: Partial<Omit<MeliListingMedia, 'itemId' | 'updatedAt'>> = {};
  if ('productReference' in body) {
    const reference = body.productReference as Record<string, unknown> | null;
    if (reference == null) patch.productReference = null;
    else {
      const imageUrl = httpsUrl(reference.imageUrl);
      if (!imageUrl) throw Object.assign(new Error('A referência do produto precisa de uma imagem HTTPS.'), { status: 422 });
      patch.productReference = {
        imageUrl,
        sourceImages: (Array.isArray(reference.sourceImages) ? reference.sourceImages : []).map(httpsUrl).filter((url): url is string => Boolean(url)).slice(0, 20),
        ...(typeof reference.caracteristicas === 'string' ? { caracteristicas: reference.caracteristicas.slice(0, 2000) } : {}),
        ...(Array.isArray(reference.ajustes) ? { ajustes: reference.ajustes.map((entry) => String(entry).slice(0, 500)).slice(0, 20) } : {}),
        createdAt: typeof reference.createdAt === 'string' ? reference.createdAt : new Date().toISOString(),
      };
    }
  }
  if ('videoUrl' in body) {
    patch.videoUrl = body.videoUrl == null ? null : httpsUrl(body.videoUrl);
    if (body.videoUrl != null && !patch.videoUrl) throw Object.assign(new Error('videoUrl precisa ser HTTPS.'), { status: 422 });
  }
  if ('videoJobId' in body) {
    patch.videoJobId = typeof body.videoJobId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.videoJobId) ? body.videoJobId : null;
  }
  return patch;
}

export async function getListingMedia(uid: string, itemId: string): Promise<MeliListingMedia> {
  const normalizedId = itemId.toUpperCase();
  const snap = await MEDIA_REF(uid).doc(normalizedId).get();
  return snap.exists
    ? snap.data() as MeliListingMedia
    : { itemId: normalizedId, productReference: null, videoUrl: null, videoJobId: null, updatedAt: '' };
}

export async function saveListingMedia(uid: string, itemId: string, input: unknown): Promise<MeliListingMedia> {
  const normalizedId = itemId.toUpperCase();
  const patch = normalizeMediaPatch(input);
  await MEDIA_REF(uid).doc(normalizedId).set(jsonSafe({ itemId: normalizedId, ...patch, updatedAt: new Date().toISOString() }), { merge: true });
  return getListingMedia(uid, normalizedId);
}
