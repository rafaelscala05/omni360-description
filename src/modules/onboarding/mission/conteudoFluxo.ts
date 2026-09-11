// Orquestração da Missão Conteúdo. PURO.
//
// A missão é retomável: cada sub-passo grava em state.dados o id do que
// criou, e proximaAcaoConteudo decide o próximo passo a partir do que já
// existe. Recarregar a página no meio da produção continua de onde parou, e
// nenhum passo roda duas vezes (cada um só roda quando o seu id ainda falta).

import { slugify } from '../../content/blog/slug';

export interface DadosConteudo {
  projectId?: string;
  configConfirmada?: boolean;
  nomeEmpresa?: string;
  descricao?: string;
  nClusters?: number;
  clusterId?: string;
  tema?: string;
  kwPrincipal?: string;
  articleId?: string;
  blogSlug?: string;
  producaoIniciada?: boolean;
  urlPost?: string;
  previewAberto?: boolean;
  blogPublicado?: boolean;
}

export type AcaoConteudo =
  | 'gerar-clusters' | 'criar-artigo' | 'criar-blog'
  | 'produzir' | 'aguardar' | 'publicar' | 'pronto' | 'erro' | 'travado';

/** O que a missão precisa saber do artigo, vindo do listener do calendário. */
export interface ArtigoResumo {
  status: string;
  stage: number;
  temFinal: boolean;
  /** Minutos desde o updatedAt do artigo — calculado pelo componente. */
  paradoHaMin?: number;
}

/** Estados finais em que articleFinal já reflete a versão pronta a publicar. */
const STATUS_PUBLICAVEL = new Set(['revisao', 'aprovado', 'publicado']);

/** Acima disso sem novidade do servidor, a produção é considerada travada. */
export const LIMITE_PRODUCAO_PARADA_MIN = 15;

/**
 * Verdadeiro quando o artigo está 'em_producao' e a última escrita do
 * servidor (updatedAt) é recente o bastante para supor que o pipeline ainda
 * está de fato rodando (evita iniciar uma segunda corrida concorrente).
 */
export function producaoRecente(status: string, updatedAtIso: string | undefined, agoraMs: number): boolean {
  if (status !== 'em_producao' || !updatedAtIso) return false;
  const updatedMs = new Date(updatedAtIso).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return agoraMs - updatedMs < LIMITE_PRODUCAO_PARADA_MIN * 60 * 1000;
}

export function proximaAcaoConteudo(dados: DadosConteudo, artigo: ArtigoResumo | null): AcaoConteudo {
  if (!dados.clusterId) return 'gerar-clusters';
  if (!dados.articleId) return 'criar-artigo';
  if (!dados.blogSlug) return 'criar-blog';
  if (dados.urlPost) return 'pronto';
  if (!artigo) return 'aguardar';

  // Uma corrida (nova ou reinício) que não avança há LIMITE_PRODUCAO_PARADA_MIN
  // minutos é considerada travada — sem isso, um servidor morto trava a
  // missão em 'aguardar' para sempre.
  const parada = artigo.status === 'em_producao' || (artigo.status === 'agendado' && !!dados.producaoIniciada);
  if (parada && (artigo.paradoHaMin ?? 0) >= LIMITE_PRODUCAO_PARADA_MIN) {
    return dados.producaoIniciada ? 'travado' : 'produzir';
  }

  // "Tentar de novo" limpa producaoIniciada: um artigo em erro volta a produzir.
  // Avaliado antes de 'publicar': um erro no fim do pipeline (ex.: créditos
  // insuficientes ao debitar) deixa articleFinal preenchido de uma corrida
  // anterior, mas o artigo NÃO deve ser publicado sem terminar de pagar.
  if (artigo.status === 'erro') return dados.producaoIniciada ? 'erro' : 'produzir';
  if (artigo.temFinal && STATUS_PUBLICAVEL.has(artigo.status)) return 'publicar';
  if (artigo.status === 'agendado' && !dados.producaoIniciada) return 'produzir';
  return 'aguardar';
}

// Mesma ordem de src/modules/content/ArticleView.tsx (STAGES), indexada por stage 1..5.
const ESTAGIOS = ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem'];

export function rotuloEstagio(stage: number): string {
  return ESTAGIOS[stage - 1] ?? '';
}

/** Endereços tentados em ordem — o servidor responde 409 quando um já está em uso. */
export function slugCandidatos(nome: string): string[] {
  const s = slugify(nome);
  const base = s.length >= 3 ? s : 'meu-blog';
  return [base, `${base}-blog`, `${base}-2`, `${base}-3`];
}
