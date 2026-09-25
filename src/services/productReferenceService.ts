// src/services/productReferenceService.ts
//
// Product Reference: real product photos (+ optional merchant notes) → one
// multi-angle reference sheet (client-side, Firebase AI Logic) → uploaded to
// Storage and saved on the product as `_productReference`. Both video
// pipelines send this sheet to Veo as an ASSET reference.
//
// Pure logic lives in productReferencePrompt.ts and is re-exported here.
import { ref, uploadString } from 'firebase/storage';
import { storage } from '../firebase';
import { generateImageFromImages } from './aiService';
import { fetchAndProcessImage } from '../utils/imageUtils';
import { buildProductReferencePrompt, buildProductReferenceAdjustPrompt } from './productReferencePrompt';

export {
  MIN_REFERENCE_PHOTOS, MAX_REFERENCE_PHOTOS, collectProductPhotos, buildProductReferencePrompt,
  buildProductReferenceAdjustPrompt, buildProductReferenceDoc,
} from './productReferencePrompt';

// Returns a data URL — nothing is persisted until the user saves (same rule as
// avatars and ambient images).
export async function generateProductReference(params: {
  photoUrls: string[];
  productName: string;
  caracteristicas?: string;
}): Promise<string> {
  const images = await Promise.all(params.photoUrls.map((url) => fetchAndProcessImage(url)));
  const prompt = buildProductReferencePrompt({
    productName: params.productName,
    caracteristicas: params.caracteristicas,
    photoCount: images.length,
  });
  return generateImageFromImages(images, prompt);
}

// Edits the current sheet with a free-text request. The real photos go along
// again so the edit is anchored to the product, not only to the previous sheet
// (otherwise successive edits drift away from the real product).
export async function adjustProductReference(params: {
  currentImage: string;
  photoUrls: string[];
  ajuste: string;
}): Promise<string> {
  const [current, ...photos] = await Promise.all(
    [params.currentImage, ...params.photoUrls].map((url) => fetchAndProcessImage(url)),
  );
  return generateImageFromImages([current, ...photos], buildProductReferenceAdjustPrompt(params.ajuste));
}

// Uploads a data URL (the sheet, or a photo the user added in this step) to
// Firebase Storage. Same URL format as uploadAvatarImage().
export async function uploadProductReferenceImage(uid: string, productId: string, dataUrl: string, name: string): Promise<string> {
  const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  const path = `users/${uid}/product-references/${productId}/${name}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadString(storageRef, dataUrl, 'data_url');
  return `https://storage.googleapis.com/${storageRef.bucket}/${storageRef.fullPath}`;
}
