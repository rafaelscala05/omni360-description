// Trilha de missões do dia 2 em diante. PURO: recebe o estado da conta e
// devolve os itens com o estado de cada um. Na v1 a ordem é fixa — é a
// sequência que o spec propõe, e a primeira missão já chega riscada. Na v2
// (`objetivos`) só os objetivos marcados viram missão, na ordem marcada.

import type { MissionId } from './missionTypes';
import type { Objetivo } from '../../agent/capacidades';

export type EstadoItem = 'feito' | 'agora' | 'bloqueado' | 'opcional';
export type ItemId = 'produto' | 'conteudo' | 'meli' | 'catalogo' | 'erp' | 'publicar-blog' | 'empresa';

export interface ItemTrilha {
  id: ItemId;
  titulo: string;
  meta: string;
  estado: EstadoItem;
}

export interface SinalTrilha {
  missoes: { missionId: MissionId; concluidaEm?: string; dados: Record<string, unknown> }[];
  produtos: number;
  erpConectado: boolean;
  empresaCompleta: boolean;
  /** Coorte v2: só os objetivos marcados viram missão, na ordem marcada. */
  objetivos?: Objetivo[];
  meliConectado?: boolean;
}

export function montarTrilha(s: SinalTrilha): ItemTrilha[] {
  const concluida = (id: MissionId) => s.missoes.find((m) => m.missionId === id && m.concluidaEm);
  const conteudo = concluida('conteudo');
  const blogPublicado = conteudo?.dados.blogPublicado === true;

  const missao: Record<Objetivo, ItemTrilha> = {
    produto: { id: 'produto', titulo: 'Aprimorar seu primeiro produto', meta: 'Agente de Produto', estado: concluida('produto') ? 'feito' : 'agora' },
    conteudo: { id: 'conteudo', titulo: 'Montar seu blog', meta: 'Agente de Conteúdo', estado: conteudo ? 'feito' : 'agora' },
    // Até a Missão ML existir (fase 4), conectar a conta é a chegada.
    meli: { id: 'meli', titulo: 'Conectar seu Mercado Livre', meta: 'Agente Mercado Livre', estado: s.meliConectado ? 'feito' : 'agora' },
  };
  const resto = (comBlog: boolean): ItemTrilha[] => [
    { id: 'catalogo', titulo: 'Trazer o resto do catálogo', meta: 'cole mais links ou suba a planilha', estado: s.produtos > 1 ? 'feito' : 'agora' },
    { id: 'erp', titulo: 'Conectar seu ERP', meta: 'publica direto na sua loja', estado: s.erpConectado ? 'feito' : 'agora' },
    ...(comBlog ? [{
      id: 'publicar-blog' as const,
      titulo: 'Publicar seu blog',
      meta: conteudo ? 'libera o blog para o Google' : 'libera depois que o blog existir',
      estado: (blogPublicado ? 'feito' : conteudo ? 'agora' : 'bloqueado') as EstadoItem,
    }] : []),
    { id: 'empresa', titulo: 'Completar dados da empresa', meta: 'necessário só para emitir nota', estado: s.empresaCompleta ? 'feito' : 'opcional' },
  ];

  if (!s.objetivos) return [missao.produto, missao.conteudo, ...resto(true)];
  return [...s.objetivos.map((o) => missao[o]), ...resto(s.objetivos.includes('conteudo'))];
}

/**
 * Ainda em onboarding: alguma etapa obrigatória da trilha não foi feita
 * ("opcional" não segura o checklist na tela). Enquanto for verdade, a tela do
 * Alfred mostra o checklist e deixa "Sua semana" recolhida.
 */
export function emOnboarding(itens: ItemTrilha[]): boolean {
  return itens.some((i) => i.estado === 'agora' || i.estado === 'bloqueado');
}
