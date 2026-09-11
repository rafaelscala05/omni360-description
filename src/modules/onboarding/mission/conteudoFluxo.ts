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
  | 'produzir' | 'aguardar' | 'publicar' | 'pronto' | 'erro';

/** O que a missão precisa saber do artigo, vindo do listener do calendário. */
export interface ArtigoResumo {
  status: string;
  stage: number;
  temFinal: boolean;
}

export function proximaAcaoConteudo(dados: DadosConteudo, artigo: ArtigoResumo | null): AcaoConteudo {
  if (!dados.clusterId) return 'gerar-clusters';
  if (!dados.articleId) return 'criar-artigo';
  if (!dados.blogSlug) return 'criar-blog';
  if (dados.urlPost) return 'pronto';
  if (!artigo) return 'aguardar';
  if (artigo.temFinal) return 'publicar';
  // "Tentar de novo" limpa producaoIniciada: um artigo em erro volta a produzir.
  if (artigo.status === 'erro') return dados.producaoIniciada ? 'erro' : 'produzir';
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
