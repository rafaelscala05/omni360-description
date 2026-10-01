// Regras da tela "Agente Produtos" (F2) — a porta Ferramentas do catálogo.
//
// Puro e sem I/O: recebe os produtos que o App já tem em memória. Verificar
// com `npx tsx scripts/verify-produtos-agente.mjs`.
//
// Duas regras que não são óbvias:
// - Só o produto principal aparece (variação herda descrição e foto do pai),
//   a mesma regra da semana (semana.ts) e das ferramentas do agente
//   (server/agent/produtosRules.ts). Assim "Incompletos · 12" aqui, na semana e
//   no que o Alfred lista é o mesmo número.
// - "Incompleto" é só o que as três telas contam: sem descrição ou sem foto.
//   Atributos e imagem ambientada aparecem como pílula, mas em tom neutro —
//   dependem de categoria e de crédito, e pintá-los de laranja faria quase todo
//   o catálogo parecer quebrado.

import type { WorkspaceContext } from '../../types/agent';
import { getProductStatusFlags, type Product, type ProductModalTab } from '../../types/models';
import { semImagem } from './semana';

export type SegmentoProdutos = 'catalogo' | 'imagens' | 'videos';
export type FiltroProdutos = 'incompletos' | 'todos' | 'foraDoErp' | 'semFoto' | 'semAmbientada' | 'semVideo';

/** `alerta` = conta como incompleto (laranja); `opcional` = falta, mas não pesa (cinza). */
export type EstadoPilula = 'ok' | 'alerta' | 'opcional' | 'rodando';
export interface Pilula { rotulo: string; estado: EstadoPilula }

/** Até onde a seleção vai ao Alfred — acima disso o contexto do prompt vira ruído. */
export const MAX_SKUS_CONTEXTO = 50;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export const ehPai = (p: Product) => !str(p['Código do pai']);
const excluido = (p: Product) => !!(p._blingDeleted || p._idworksDeleted);
export const semDescricao = (p: Product) => !str(p['Descrição complementar']);
export const temFoto = (p: Product) => !semImagem(p as unknown as Record<string, unknown>);
export const incompleto = (p: Product) => semDescricao(p) || !temFoto(p);
export const noErp = (p: Product) => !!(p._tinyProductId || p._blingProductId || p._idworksProductId || p._wakeProductId);
export const temAmbientada = (p: Product) => getProductStatusFlags(p).imagensGeradas;
export const temVideo = (p: Product) => !!(str(p._videoUrl) || str(p._ugcVideoUrl));
const videoRodando = (p: Product) =>
  ['queued', 'processing', 'generating_script'].includes(String(p._videoStatus ?? ''))
  || ['queued', 'processing', 'generating_script'].includes(String(p._ugcVideoStatus ?? ''));

export const skuDe = (p: Product) => str(p['Código (SKU)']);
export const nomeDe = (p: Product) => str(p['Descrição']) || skuDe(p) || '(sem nome)';

/** Produtos que a tela lista: principais e não excluídos no ERP. */
export const principais = (produtos: Product[]) => produtos.filter((p) => ehPai(p) && !excluido(p));

export function pilulasDe(p: Product, segmento: SegmentoProdutos): Pilula[] {
  const flags = getProductStatusFlags(p);
  if (segmento === 'videos') {
    return [
      { rotulo: 'foto', estado: temFoto(p) ? 'ok' : 'alerta' },
      { rotulo: 'vídeo', estado: videoRodando(p) ? 'rodando' : temVideo(p) ? 'ok' : 'opcional' },
    ];
  }
  if (segmento === 'imagens') {
    return [
      { rotulo: 'foto', estado: temFoto(p) ? 'ok' : 'alerta' },
      { rotulo: 'ambientada', estado: flags.imagensGeradas ? 'ok' : 'opcional' },
    ];
  }
  return [
    { rotulo: 'descrição', estado: semDescricao(p) ? 'alerta' : 'ok' },
    { rotulo: 'atributos', estado: flags.atributosGerados ? 'ok' : 'opcional' },
    { rotulo: 'foto', estado: temFoto(p) ? 'ok' : 'alerta' },
    { rotulo: 'ambientada', estado: flags.imagensGeradas ? 'ok' : 'opcional' },
  ];
}

const PREDICADO: Record<FiltroProdutos, (p: Product) => boolean> = {
  incompletos: incompleto,
  todos: () => true,
  foraDoErp: (p) => !noErp(p),
  semFoto: (p) => !temFoto(p),
  semAmbientada: (p) => temFoto(p) && !temAmbientada(p),
  semVideo: (p) => temFoto(p) && !temVideo(p) && !videoRodando(p),
};

export const ROTULO_FILTRO: Record<FiltroProdutos, string> = {
  incompletos: 'Incompletos',
  todos: 'Todos',
  foraDoErp: 'Fora do ERP',
  semFoto: 'Sem foto',
  semAmbientada: 'Sem ambientada',
  semVideo: 'Sem vídeo',
};

/** Filtros oferecidos em cada segmento — o primeiro é o padrão. */
export const FILTROS_DO_SEGMENTO: Record<SegmentoProdutos, FiltroProdutos[]> = {
  catalogo: ['incompletos', 'todos', 'foraDoErp'],
  imagens: ['semFoto', 'semAmbientada', 'todos'],
  videos: ['semVideo', 'todos'],
};

/** Aba do modal do produto que cada segmento abre ao tocar na linha. */
export const ABA_DO_SEGMENTO: Record<SegmentoProdutos, ProductModalTab> = {
  catalogo: 'geral',
  imagens: 'imagem',
  videos: 'video',
};

export function contarFiltros(lista: Product[], filtros: FiltroProdutos[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filtros) out[f] = lista.filter(PREDICADO[f]).length;
  return out;
}

export function filtrarProdutos(lista: Product[], filtro: FiltroProdutos, busca = ''): Product[] {
  const q = busca.trim().toLowerCase();
  return lista.filter((p) => PREDICADO[filtro](p) && (!q || nomeDe(p).toLowerCase().includes(q) || skuDe(p).toLowerCase().includes(q)));
}

/**
 * O pedido que "Pedir ao Alfred" manda com a seleção. A mensagem é curta e
 * legível na conversa; os SKUs vão no contexto (WorkspaceContext), que o grafo
 * põe no system prompt — e continuam lá nas mensagens seguintes.
 */
export function pedidoDaSelecao(selecionados: Product[]): { texto: string; contexto: WorkspaceContext } {
  const skus = selecionados.map(skuDe).filter(Boolean);
  const n = skus.length;
  const semDesc = selecionados.filter(semDescricao).length;
  const texto = n === 0
    ? 'Estou no catálogo de produtos. O que você sugere fazer primeiro?'
    : n === 1
      ? `Sobre o produto selecionado (${nomeDe(selecionados[0])}): o que falta nele e o que você sugere fazer?`
      : `Selecionei ${n} produtos no catálogo${semDesc ? ` (${semDesc} sem descrição)` : ''}. O que falta neles e o que você sugere fazer primeiro?`;
  return {
    texto,
    contexto: {
      tela: 'produtos',
      ...(n ? { skus: skus.slice(0, MAX_SKUS_CONTEXTO), totalSelecionados: n } : {}),
    },
  };
}
