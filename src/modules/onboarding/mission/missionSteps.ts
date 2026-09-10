// Máquina de estados das missões de onboarding. PURO: não importa React,
// Firebase nem serviços — é o que permite verificar a lógica com
// scripts/verify-mission-steps.mjs e o que impede a jornada de se dividir
// em dois fluxos.
//
// As duas missões têm exatamente as mesmas três etapas. Só o conteúdo de
// cada etapa muda. Quebrar esse invariante quebra o verify script.

import {
  STEP_ORDER,
  type AccountSignal, type MissionId, type MissionState, type StepId,
} from './missionTypes';

export interface MissionStepDef {
  id: StepId;
  /** Rótulo mostrado no trilho de progresso. */
  titulo: string;
  /** Como saber que o passo terminou, a partir dos dados acumulados. */
  concluido: (dados: Record<string, unknown>) => boolean;
}

export interface MissionDef {
  id: MissionId;
  /** Texto do cartão da Tela 0 — o resultado, não o nome do agente. */
  resultado: string;
  /** Assinatura de quem executa, em letra pequena. */
  agente: string;
  steps: MissionStepDef[];
}

export const MISSOES: Record<MissionId, MissionDef> = {
  produto: {
    id: 'produto',
    resultado: 'Vender mais com o que já tenho',
    agente: 'Agente de Produto',
    steps: [
      {
        id: 'contexto',
        titulo: 'Contexto',
        // Conta vazia: veio da URL colada. Conta com catálogo: veio da seleção.
        concluido: (d) => typeof d.produtoId === 'string' && d.produtoId.length > 0,
      },
      {
        id: 'palco',
        titulo: 'Palco',
        concluido: (d) => d.descricaoGerada === true,
      },
      {
        id: 'chegada',
        titulo: 'Chegada',
        concluido: (d) => d.publicado === true || d.salvoNoCatalogo === true,
      },
    ],
  },
  conteudo: {
    id: 'conteudo',
    resultado: 'Aparecer no Google e trazer gente nova',
    agente: 'Agente de Conteúdo',
    steps: [
      {
        id: 'contexto',
        titulo: 'Contexto',
        concluido: (d) => d.configConfirmada === true,
      },
      {
        id: 'palco',
        titulo: 'Palco',
        concluido: (d) => typeof d.blogSlug === 'string' && d.blogSlug.length > 0,
      },
      {
        id: 'chegada',
        titulo: 'Chegada',
        concluido: (d) => d.blogPublicado === true || d.previewAberto === true,
      },
    ],
  },
};

export function criarEstadoInicial(missionId: MissionId): MissionState {
  return {
    missionId,
    step: 'contexto',
    dados: {},
    iniciadaEm: new Date().toISOString(),
  };
}

function defDoStep(state: MissionState): MissionStepDef {
  const def = MISSOES[state.missionId].steps.find((s) => s.id === state.step);
  if (!def) throw new Error(`Passo desconhecido: ${state.missionId}/${state.step}`);
  return def;
}

export function stepConcluido(state: MissionState): boolean {
  return defDoStep(state).concluido(state.dados);
}

export function proximoStep(state: MissionState): StepId | null {
  const i = STEP_ORDER.indexOf(state.step);
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null;
}

/** Imutável: devolve um novo estado, nunca muta o recebido. */
export function avancar(state: MissionState): MissionState {
  const proximo = proximoStep(state);
  return proximo ? { ...state, step: proximo } : state;
}

export function progresso(state: MissionState): { indice: number; total: number } {
  return { indice: STEP_ORDER.indexOf(state.step) + 1, total: STEP_ORDER.length };
}

export interface SugestaoTrilha {
  sugerida: MissionId | null;
  variante: 'vazia' | 'com-catalogo';
}

/**
 * Decisão 1 do spec: a variante principal é a de conta vazia. Sem catálogo e
 * sem ERP, nenhum cartão vem pré-selecionado e a trilha de Produto começa
 * pedindo a URL de um produto.
 *
 * Ter projeto de conteúdo não sugere a trilha de Conteúdo: quem já tem projeto
 * já passou por ali, e o que falta é o produto.
 */
export function sugerirTrilha(signal: AccountSignal): SugestaoTrilha {
  const temCatalogo = signal.produtos > 0 || signal.erpConectado;
  if (temCatalogo) return { sugerida: 'produto', variante: 'com-catalogo' };
  if (signal.temProjetoConteudo) return { sugerida: 'produto', variante: 'vazia' };
  return { sugerida: null, variante: 'vazia' };
}
