// Trilha de missões do dia 2 em diante. PURO: recebe o estado da conta e
// devolve os itens com o estado de cada um. A ordem é fixa — é a sequência que
// o spec propõe, e a primeira missão já chega riscada.

import type { MissionId } from './missionTypes';

export type EstadoItem = 'feito' | 'agora' | 'bloqueado' | 'opcional';
export type ItemId = 'produto' | 'conteudo' | 'catalogo' | 'erp' | 'publicar-blog' | 'empresa';

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
}

export function montarTrilha(s: SinalTrilha): ItemTrilha[] {
  const concluida = (id: MissionId) => s.missoes.find((m) => m.missionId === id && m.concluidaEm);
  const conteudo = concluida('conteudo');
  const blogPublicado = conteudo?.dados.blogPublicado === true;
  return [
    { id: 'produto', titulo: 'Aprimorar seu primeiro produto', meta: 'Agente de Produto', estado: concluida('produto') ? 'feito' : 'agora' },
    { id: 'conteudo', titulo: 'Montar seu blog', meta: 'Agente de Conteúdo', estado: conteudo ? 'feito' : 'agora' },
    { id: 'catalogo', titulo: 'Trazer o resto do catálogo', meta: 'cole mais links ou suba a planilha', estado: s.produtos > 1 ? 'feito' : 'agora' },
    { id: 'erp', titulo: 'Conectar seu ERP', meta: 'publica direto na sua loja', estado: s.erpConectado ? 'feito' : 'agora' },
    {
      id: 'publicar-blog',
      titulo: 'Publicar seu blog',
      meta: conteudo ? 'libera o blog para o Google' : 'libera depois que o blog existir',
      estado: blogPublicado ? 'feito' : conteudo ? 'agora' : 'bloqueado',
    },
    { id: 'empresa', titulo: 'Completar dados da empresa', meta: 'necessário só para emitir nota', estado: s.empresaCompleta ? 'feito' : 'opcional' },
  ];
}
