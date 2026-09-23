// src/services/avatarPrompt.ts
//
// Pure avatar-related logic with NO Firebase imports — split out of
// avatarService.ts so it can be unit-verified under plain Node/tsx without
// pulling in src/firebase.ts, which performs browser-only side effects
// (Firebase App Check + reCAPTCHA Enterprise DOM setup) at module load time
// and therefore cannot be imported outside a real browser/Vite runtime.
// Re-exported from avatarService.ts so callers keep a single import surface.
import type { Avatar } from '../types/models';

export const getAvatarsPath = (uid: string) => `users/${uid}/avatars`;

// Builds the Firestore document for an avatar, stripping `undefined` values
// (Firestore's setDoc rejects them — this db isn't configured with
// ignoreUndefinedProperties) and preserving createdAt across updates.
export function buildAvatarDoc(
  input: { nome: string; descricao: string; referenceImageUrl?: string },
  id: string,
  existingCreatedAt?: string,
): Avatar {
  const data: any = {
    ...input,
    id,
    createdAt: existingCreatedAt ?? new Date().toISOString(),
  };
  Object.keys(data).forEach((key) => {
    if (data[key] === undefined) delete data[key];
  });
  return data as Avatar;
}

export function buildAvatarPortraitPrompt(descricao: string): string {
  return `Retrato fotográfico realista de uma pessoa para uso como avatar em vídeos de UGC (conteúdo gerado por usuário).

Características da pessoa: ${descricao}

Enquadramento: plano americano (da cintura para cima), olhando diretamente para a câmera, expressão natural e simpática.
Fundo neutro e desfocado, iluminação suave de estúdio. Foto realista, alta qualidade, sem texto, sem marca d'água, sem elementos artificiais.`;
}
