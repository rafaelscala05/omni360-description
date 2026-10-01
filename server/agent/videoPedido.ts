// Pedido de vídeo de produto pelo Alfred — o que o wizard da aba "Vídeo"
// (VideoGenerationTab.tsx) monta, aqui a partir do documento do produto.
// Puro; verificar com `npx tsx scripts/verify-agent-produtos.mjs`.
//
// Por que o vídeo não roda no serviço do grafo: o job leva minutos, debita
// crédito e não é retomável, e o Cloud Run só garante CPU enquanto há uma
// requisição aberta (o wizard segura a dele até o fim). A ferramenta só monta
// e aprova o pedido; quem roda é POST /api/agent/video/:actionId/iniciar
// (videoAlfred.ts), chamado pelo app aberto logo depois da aprovação — a mesma
// garantia do wizard.

import { collectProductPhotos } from '../../src/services/productReferencePrompt';
import type { InicioVideo, PedidoRoteiro } from '../videoAgent';
import type { ProdutoDoc } from './produtosRules';

/** Mesmo teto do ProductPhotoPicker (videoWizardShared.tsx). */
export const MAX_FOTOS_VIDEO = 8;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export interface PedidoVideo {
  roteiro: PedidoRoteiro;
  inicio: Omit<InicioVideo, 'script'>;
}

/**
 * Uma imagem por cena, na ordem do roteiro — a mesma escolha de
 * buildShotImageUrls: ambientada quando há, senão a foto real.
 */
export function imagensDasCenas(ambientadas: string[], fotos: string[]): string[] {
  const original = fotos[0] ?? '';
  const primeira = [original, ...ambientadas].find(Boolean) ?? '';
  const pick = (preferida?: string) => preferida || original || primeira;
  return [pick(ambientadas[0]), pick(ambientadas[1]), pick(ambientadas[2]), pick(ambientadas[0])];
}

/** O que falta para o vídeo, na voz do lojista — os pré-requisitos do wizard. */
export function faltaParaVideo(p: Record<string, unknown>): string[] {
  const falta: string[] = [];
  if (!str(p['Descrição complementar'])) falta.push('descrição');
  if (!str(p['Título SEO'])) falta.push('título SEO');
  const ref = p._productReference as { imageUrl?: string } | undefined;
  if (!str(ref?.imageUrl)) falta.push('referência do produto (aba Vídeo do produto, a partir de 2 fotos reais)');
  return falta;
}

export function montarPedidoVideo(p: ProdutoDoc): PedidoVideo {
  const ref = (p._productReference ?? {}) as { imageUrl?: string; sourceImages?: string[] };
  const galeria = collectProductPhotos(p as never);
  const fotos = [...new Set([...galeria, ...(ref.sourceImages ?? [])].filter(Boolean))].slice(0, MAX_FOTOS_VIDEO);
  const atributos: Record<string, string> = {};
  for (const [k, a] of Object.entries((p.attributes ?? {}) as Record<string, { value?: unknown }>)) {
    const v = Array.isArray(a?.value) ? a.value.join(', ') : str(a?.value);
    if (v) atributos[k] = v;
  }
  for (const campo of ['Tipo do produto', 'Garantia']) {
    if (str(p[campo]) && !(campo in atributos)) atributos[campo] = str(p[campo]);
  }
  const nome = str(p['Descrição']) || p._docId;
  return {
    roteiro: {
      description: str(p['Descrição complementar']) || str(p['Descrição']),
      brand: str(p['Marca']),
      imageUrl: str(ref.imageUrl) || fotos[0],
      photoUrls: fotos,
      productName: str(p['Título SEO']) || nome,
      category: str(p['Categoria']) || (Array.isArray(p.categoryPath) ? (p.categoryPath as string[]).join(' > ') : ''),
      attributes: atributos,
    },
    inicio: {
      productId: p._docId,
      productName: nome,
      shotImageUrls: imagensDasCenas((p._ambientImages as string[] | undefined) ?? [], galeria),
      productReferenceUrl: str(ref.imageUrl) || undefined,
      productPhotoUrls: fotos,
    },
  };
}
