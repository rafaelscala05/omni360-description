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
import type { InicioVideoUgc, PedidoRoteiroUgc } from '../ugcVideoAgent';
import type { ProdutoDoc } from './produtosRules';

/** Mesmo teto do ProductPhotoPicker (videoWizardShared.tsx). */
export const MAX_FOTOS_VIDEO = 8;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export interface PedidoVideoClassico {
  /** Ausente nos pedidos aprovados antes do UGC existir. */
  tipo?: 'classico';
  roteiro: PedidoRoteiro;
  inicio: Omit<InicioVideo, 'script'>;
  /** Vídeo de um anúncio do Mercado Livre (meli.video.gerar): no fim, o link vai para a mídia dele. */
  destinoMeli?: string;
}

/** UGC: um avatar salvo fala para a câmera e usa o produto (server/ugcVideoAgent.ts). */
export interface PedidoVideoUgc {
  tipo: 'ugc';
  avatarId: string;
  avatarNome: string;
  roteiro: PedidoRoteiroUgc;
  inicio: Omit<InicioVideoUgc, 'script'>;
}

export type PedidoVideo = PedidoVideoClassico | PedidoVideoUgc;

export interface AvatarSalvo {
  id: string;
  nome: string;
  descricao: string;
  referenceImageUrl: string;
  createdAt?: string;
}

/**
 * Qual avatar fala no vídeo: o que o usuário nomeou; sem nome, o último usado
 * neste produto; senão o mais recente. A prévia mostra o escolhido — trocar é
 * pedir de novo com o nome.
 */
export function escolherAvatar(
  avatares: AvatarSalvo[],
  opts: { nome?: string; ultimoId?: string } = {},
): { avatar: AvatarSalvo | null; erro?: string } {
  const validos = avatares.filter((a) => str(a.referenceImageUrl) && str(a.descricao));
  if (!validos.length) {
    return { avatar: null, erro: 'Esta conta ainda não tem avatar. Crie um na aba Vídeo de qualquer produto (UGC com avatar) e peça de novo.' };
  }
  const nome = str(opts.nome).toLowerCase();
  if (nome) {
    const exato = validos.find((a) => str(a.nome).toLowerCase() === nome);
    const parecido = exato ?? validos.find((a) => str(a.nome).toLowerCase().includes(nome));
    if (parecido) return { avatar: parecido };
    return { avatar: null, erro: `Nenhum avatar chamado "${opts.nome}". Os avatares salvos são: ${validos.map((a) => a.nome).join(', ')}.` };
  }
  const ultimo = opts.ultimoId ? validos.find((a) => a.id === opts.ultimoId) : undefined;
  if (ultimo) return { avatar: ultimo };
  const recente = [...validos].sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))[0];
  return { avatar: recente };
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

export function montarPedidoVideo(p: ProdutoDoc): PedidoVideoClassico {
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

/** O pedido UGC do wizard (UgcVideoGenerationTab.tsx): mesmas fotos e referência do clássico, mais o avatar. */
export function montarPedidoVideoUgc(p: ProdutoDoc, avatar: AvatarSalvo): PedidoVideoUgc {
  const base = montarPedidoVideo(p);
  const referencia = base.inicio.productReferenceUrl;
  const fotos = base.inicio.productPhotoUrls ?? [];
  return {
    tipo: 'ugc',
    avatarId: avatar.id,
    avatarNome: avatar.nome,
    roteiro: {
      description: base.roteiro.description,
      brand: base.roteiro.brand,
      // O roteirista lê a folha: ela mostra todos os ângulos e detalhes.
      productImageUrl: referencia || fotos[0] || '',
      photoUrls: fotos,
      avatarImageUrl: avatar.referenceImageUrl,
      avatarDescricao: avatar.descricao,
      productName: base.roteiro.productName,
      category: base.roteiro.category,
      attributes: base.roteiro.attributes,
    },
    inicio: {
      productId: base.inicio.productId,
      productName: base.inicio.productName,
      avatarImageUrl: avatar.referenceImageUrl,
      productPhotoUrls: fotos,
      productReferenceUrl: referencia,
    },
  };
}

/**
 * Vídeo de um anúncio do Mercado Livre — o mesmo produto sintético que o
 * MeliVideoStudio monta (id "meli-<MLB>", fotos do anúncio como "URL imagem
 * externa N", referência salva na mídia do anúncio). O produto não existe no
 * catálogo; o link do vídeo vai para users/{uid}/meli_listing_media.
 */
export function produtoDoAnuncio(anuncio: {
  itemId: string;
  title?: string;
  descricao?: string;
  marca?: string;
  fotos: string[];
  referencia?: { imageUrl?: string; sourceImages?: string[] } | null;
}): ProdutoDoc {
  const p: Record<string, unknown> = {
    _docId: `meli-${anuncio.itemId}`,
    'Código (SKU)': anuncio.itemId,
    'Descrição': anuncio.title ?? anuncio.itemId,
    'Título SEO': anuncio.title ?? '',
    'Descrição complementar': anuncio.descricao ?? '',
    'Marca': anuncio.marca ?? '',
    _productReference: anuncio.referencia ?? undefined,
  };
  anuncio.fotos.slice(0, 10).forEach((url, i) => { p[`URL imagem externa ${i + 1}`] = url; });
  return p as ProdutoDoc;
}

export function montarPedidoVideoMeli(anuncio: Parameters<typeof produtoDoAnuncio>[0]): PedidoVideoClassico {
  return { ...montarPedidoVideo(produtoDoAnuncio(anuncio)), destinoMeli: anuncio.itemId };
}
