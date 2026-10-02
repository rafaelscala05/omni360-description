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
import { integracoesDe, type IntegracaoSync } from './sincronizacao';

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

// ---------------------------------------------------------------------------
// Painel de filtros (lista unificada): OU dentro do grupo, E entre grupos.
// ---------------------------------------------------------------------------

export type OpcaoIntegracao = IntegracaoSync | 'nenhuma';
export type OpcaoSync = 'emDia' | 'pendente';
export type OpcaoConteudo = 'semDescricao' | 'semFoto' | 'semAmbientada' | 'semAtributos' | 'semVideo';

export interface FiltrosProdutos {
  integracao: OpcaoIntegracao[];
  sync: OpcaoSync[];
  conteudo: OpcaoConteudo[];
  categoria: string[];
}

export const FILTROS_VAZIOS: FiltrosProdutos = { integracao: [], sync: [], conteudo: [], categoria: [] };
/** Abre em "Incompletos", como antes: sem descrição OU sem foto. */
export const FILTROS_PADRAO: FiltrosProdutos = { ...FILTROS_VAZIOS, conteudo: ['semDescricao', 'semFoto'] };

export const OPCOES_INTEGRACAO: OpcaoIntegracao[] = ['tiny', 'wake', 'bling', 'idworks', 'nenhuma'];
export const OPCOES_SYNC: OpcaoSync[] = ['emDia', 'pendente'];
export const OPCOES_CONTEUDO: OpcaoConteudo[] = ['semDescricao', 'semFoto', 'semAmbientada', 'semAtributos', 'semVideo'];

export const ROTULO_OPCAO: Record<OpcaoIntegracao | OpcaoSync | OpcaoConteudo, string> = {
  tiny: 'Tiny', wake: 'Wake', bling: 'Bling', idworks: 'IdWorks', nenhuma: 'Só no OMNI360',
  emDia: 'Em dia', pendente: 'Com alterações não enviadas',
  semDescricao: 'Sem descrição', semFoto: 'Sem foto', semAmbientada: 'Sem ambientada', semAtributos: 'Sem atributos', semVideo: 'Sem vídeo',
};

export const categoriaDe = (p: Product) => str(p['Categoria']) || 'Sem categoria';

const rec = (p: Product) => p as unknown as Record<string, unknown>;

const PRED_INTEGRACAO: Record<OpcaoIntegracao, (p: Product) => boolean> = {
  tiny: (p) => !!str(p._tinyProductId),
  wake: (p) => !!str(p._wakeProductId),
  bling: (p) => !!str(p._blingProductId),
  idworks: (p) => !!str(p._idworksProductId),
  nenhuma: (p) => !noErp(p),
};
// O estado de sincronização hasheia descrição, SEO e imagens de cada produto —
// caro demais para refazer a cada tecla da busca em catálogos grandes. O produto
// em memória é imutável (toda edição troca o objeto), então o cache é pelo objeto.
const cacheSync = new WeakMap<Product, ReturnType<typeof integracoesDe>>();

/** `integracoesDe` com cache por objeto — usado pelos filtros e pelo selo de cada linha. */
export function integracoesDoProduto(p: Product): ReturnType<typeof integracoesDe> {
  let v = cacheSync.get(p);
  if (!v) { v = integracoesDe(rec(p)); cacheSync.set(p, v); }
  return v;
}

const PRED_SYNC: Record<OpcaoSync, (p: Product) => boolean> = {
  emDia: (p) => { const i = integracoesDoProduto(p); return i.length > 0 && i.every((x) => x.estado.tipo === 'em-dia'); },
  pendente: (p) => integracoesDoProduto(p).some((x) => x.estado.tipo === 'pendente'),
};
const PRED_CONTEUDO: Record<OpcaoConteudo, (p: Product) => boolean> = {
  semDescricao: semDescricao,
  semFoto: (p) => !temFoto(p),
  semAmbientada: (p) => temFoto(p) && !temAmbientada(p),
  semAtributos: (p) => !getProductStatusFlags(p).atributosGerados,
  semVideo: (p) => temFoto(p) && !temVideo(p) && !videoRodando(p),
};

type Grupo = keyof FiltrosProdutos;

function passaGrupo(p: Product, f: FiltrosProdutos, g: Grupo): boolean {
  switch (g) {
    case 'integracao': return !f.integracao.length || f.integracao.some((o) => PRED_INTEGRACAO[o](p));
    case 'sync': return !f.sync.length || f.sync.some((o) => PRED_SYNC[o](p));
    case 'conteudo': return !f.conteudo.length || f.conteudo.some((o) => PRED_CONTEUDO[o](p));
    case 'categoria': return !f.categoria.length || f.categoria.includes(categoriaDe(p));
  }
}

const GRUPOS: Grupo[] = ['integracao', 'sync', 'conteudo', 'categoria'];

const casaBusca = (p: Product, q: string) => !q || nomeDe(p).toLowerCase().includes(q) || skuDe(p).toLowerCase().includes(q);

export function aplicarFiltros(lista: Product[], f: FiltrosProdutos, busca = ''): Product[] {
  const q = busca.trim().toLowerCase();
  return lista.filter((p) => casaBusca(p, q) && GRUPOS.every((g) => passaGrupo(p, f, g)));
}

export interface ContagemOpcoes {
  integracao: Record<OpcaoIntegracao, number>;
  sync: Record<OpcaoSync, number>;
  conteudo: Record<OpcaoConteudo, number>;
  categoria: Record<string, number>;
}

/** Quantos cada opção mostraria: aplica busca e os OUTROS grupos, nunca o próprio. */
export function contarOpcoes(lista: Product[], f: FiltrosProdutos, busca = ''): ContagemOpcoes {
  const q = busca.trim().toLowerCase();
  const base = (g: Grupo) => lista.filter((p) => casaBusca(p, q) && GRUPOS.every((o) => o === g || passaGrupo(p, f, o)));
  const contar = <K extends string>(itens: Product[], opcoes: K[], pred: Record<K, (p: Product) => boolean>) =>
    Object.fromEntries(opcoes.map((o) => [o, itens.filter(pred[o]).length])) as Record<K, number>;
  const categoria: Record<string, number> = {};
  for (const p of base('categoria')) categoria[categoriaDe(p)] = (categoria[categoriaDe(p)] ?? 0) + 1;
  return {
    integracao: contar(base('integracao'), OPCOES_INTEGRACAO, PRED_INTEGRACAO),
    sync: contar(base('sync'), OPCOES_SYNC, PRED_SYNC),
    conteudo: contar(base('conteudo'), OPCOES_CONTEUDO, PRED_CONTEUDO),
    categoria,
  };
}

export const quantosFiltrosAtivos = (f: FiltrosProdutos) =>
  f.integracao.length + f.sync.length + f.conteudo.length + f.categoria.length;

// ---------------------------------------------------------------------------
// Paginação e seleção
// ---------------------------------------------------------------------------

export const POR_PAGINA = 50;

export function paginar<T>(lista: T[], pagina: number, porPagina = POR_PAGINA) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const atual = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas);
  const ini = (atual - 1) * porPagina;
  const itens = lista.slice(ini, ini + porPagina);
  return { itens, pagina: atual, totalPaginas, inicio: itens.length ? ini + 1 : 0, fim: ini + itens.length };
}

/** "1 … 4 5 6 … 9": primeira, última e a vizinhança da atual. */
export function paginasVisiveis(pagina: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const ini = Math.max(2, pagina - 1);
  const fim = Math.min(total - 1, pagina + 1);
  if (ini > 2) out.push('…');
  for (let i = ini; i <= fim; i++) out.push(i);
  if (fim < total - 1) out.push('…');
  out.push(total);
  return out;
}

/** A faixa "Selecionar todos os N do filtro" só aparece com a página inteira marcada e mais resultados fora dela. */
export function estadoSelecao(idsDaPagina: string[], selecionados: Set<string>, totalFiltrado: number) {
  const paginaToda = idsDaPagina.length > 0 && idsDaPagina.every((id) => selecionados.has(id));
  return { paginaToda, oferecerTodos: paginaToda && totalFiltrado > idsDaPagina.length && selecionados.size < totalFiltrado };
}
