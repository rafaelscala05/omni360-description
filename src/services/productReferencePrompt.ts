// src/services/productReferencePrompt.ts
//
// Pure Product Reference logic with NO Firebase imports — same split as
// avatarPrompt.ts, so it can be verified under plain Node/tsx
// (scripts/verify-product-reference.mjs) without the browser-only side effects
// of src/firebase.ts. Re-exported from productReferenceService.ts.
import type { Product, ProductReference } from '../types/models';

// Minimum distinct real photos before the reference (and therefore any video)
// can be generated: one photo only shows one side, and the model would invent
// the rest of the product.
export const MIN_REFERENCE_PHOTOS = 2;
// gemini-2.5-flash-image degrades with many input images; 4 covers front/back/
// side/detail without diluting any of them.
export const MAX_REFERENCE_PHOTOS = 4;

const PHOTO_FIELDS = [
  'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5', 'URL imagem 6',
  'URL imagem externa 1', 'URL imagem externa 2', 'URL imagem externa 3', 'URL imagem externa 4',
  'URL imagem externa 5', 'URL imagem externa 6', 'URL imagem externa 7', 'URL imagem externa 8',
  'URL imagem externa 9', 'URL imagem externa 10',
] as const satisfies ReadonlyArray<keyof Product>;

// Real photos of the product, deduplicated, in gallery order. Ambient images are
// deliberately left out: they are AI-generated scenes, and a reference built from
// them would inherit whatever the ambient generation already got wrong.
export function collectProductPhotos(product: Product): string[] {
  const candidates = [product._selectedImage, ...PHOTO_FIELDS.map((f) => product[f])];
  const out: string[] = [];
  for (const raw of candidates) {
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

export function buildProductReferencePrompt(params: {
  productName: string;
  caracteristicas?: string;
  photoCount: number;
}): string {
  const { productName, caracteristicas, photoCount } = params;
  const details = caracteristicas?.trim()
    ? `\nCaracterísticas informadas pelo lojista (devem aparecer e ser respeitadas):\n${caracteristicas.trim()}\n`
    : '';

  return `Crie uma FOLHA DE REFERÊNCIA DE PRODUTO (product reference sheet) a partir das ${photoCount} fotos reais anexadas, que mostram o MESMO produto em posições diferentes.

Produto: ${productName || 'produto das fotos'}
${details}
Objetivo: esta folha será usada como mapa de referência para gerar vídeos, então a fidelidade ao produto real é o requisito número 1.

Layout:
- Fundo branco liso, iluminação neutra de estúdio, sem sombras fortes.
- Uma grade organizada com o produto em vários ângulos: frente, costas, lateral(is), vista superior e 3/4 — use as fotos como fonte de verdade para cada lado.
- Uma faixa de close-ups dos detalhes importantes (logotipo, textura/material, botões, costuras, encaixes, etiquetas, acabamentos).
- Rótulos curtos em português identificando cada vista e cada detalhe.

Regras de fidelidade (obrigatórias):
- O produto deve ser IDÊNTICO às fotos: mesmas cores, proporções, formato, materiais, logotipos, textos impressos e acabamento.
- Não invente partes, acessórios, cores ou variações que não aparecem nas fotos. Se um lado não aparece em nenhuma foto, deduza de forma conservadora a partir dos lados visíveis.
- Não adicione pessoas, mãos, cenários ou outros objetos.
- Sem marca d'água.`;
}

export function buildProductReferenceAdjustPrompt(ajuste: string): string {
  return `A primeira imagem anexada é a folha de referência atual do produto. As demais são as fotos reais do produto, que continuam sendo a fonte de verdade.

Aplique SOMENTE este ajuste à folha de referência, mantendo todo o resto exatamente igual (layout, vistas, rótulos e fidelidade ao produto real):
${ajuste.trim()}

Nunca altere o produto de forma que ele deixe de corresponder às fotos reais. Fundo branco, sem marca d'água.`;
}

// Builds the persisted document, dropping empty optionals — Firestore's setDoc/
// updateDoc reject `undefined` (this db isn't configured with ignoreUndefinedProperties).
export function buildProductReferenceDoc(input: {
  imageUrl: string;
  sourceImages: string[];
  caracteristicas?: string;
  ajustes?: string[];
}): ProductReference {
  const doc: ProductReference = {
    imageUrl: input.imageUrl,
    sourceImages: input.sourceImages,
    createdAt: new Date().toISOString(),
  };
  const caracteristicas = input.caracteristicas?.trim();
  if (caracteristicas) doc.caracteristicas = caracteristicas;
  const ajustes = (input.ajustes ?? []).map((a) => a.trim()).filter(Boolean);
  if (ajustes.length) doc.ajustes = ajustes;
  return doc;
}
