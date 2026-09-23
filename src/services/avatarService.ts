// src/services/avatarService.ts
//
// Per-user avatar library: text description → generated portrait (client-side,
// Firebase AI Logic) → persisted in users/{uid}/avatars for reuse across UGC
// videos. Follows the same collection-access pattern as categoryService.ts
// (path helper + getDocs/setDoc, not the looser addDoc used in App.tsx).
//
// Pure logic (path helper, doc builder, prompt builder) lives in
// avatarPrompt.ts and is re-exported here — see that file for why.
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Avatar } from '../types/models';
import { generateImageFromText } from './aiService';
import { getAvatarsPath, buildAvatarDoc, buildAvatarPortraitPrompt } from './avatarPrompt';

export { getAvatarsPath, buildAvatarDoc, buildAvatarPortraitPrompt, buildAvatarDescription } from './avatarPrompt';

// Returns a data URL — nothing is persisted yet. Mirrors generateImage()/
// runGenerateAmbient() in ImageSearchModal.tsx, which only upload on save.
export async function generateAvatarPortrait(descricao: string): Promise<string> {
  return generateImageFromText(buildAvatarPortraitPrompt(descricao), '3:4');
}

// Uploads the generated data URL to Firebase Storage. Same pattern as
// uploadImage() in ImageSearchModal.tsx:270.
export async function uploadAvatarImage(uid: string, dataUrl: string, avatarId: string): Promise<string> {
  const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  const path = `users/${uid}/avatar-images/${avatarId}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadString(storageRef, dataUrl, 'data_url');
  return `https://storage.googleapis.com/${storageRef.bucket}/${storageRef.fullPath}`;
}

export async function saveAvatar(
  uid: string,
  input: { nome: string; descricao: string; referenceImageUrl: string },
  id?: string,
  existingCreatedAt?: string,
): Promise<Avatar> {
  const avatarRef = id ? doc(db, getAvatarsPath(uid), id) : doc(collection(db, getAvatarsPath(uid)));
  const data = buildAvatarDoc(input, avatarRef.id, existingCreatedAt);
  await setDoc(avatarRef, data, { merge: true });
  return data;
}

export async function listAvatars(uid: string): Promise<Avatar[]> {
  if (!uid) return [];
  const snapshot = await getDocs(collection(db, getAvatarsPath(uid)));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Avatar));
}

export async function deleteAvatar(uid: string, avatarId: string): Promise<void> {
  await deleteDoc(doc(db, getAvatarsPath(uid), avatarId));
}
