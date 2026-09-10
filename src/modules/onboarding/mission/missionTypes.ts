// Tipos da jornada de missão. Sem lógica e sem I/O — missionSteps.ts (puro) e
// missionService.ts (Firestore) dependem daqui, nunca o contrário.

export type MissionId = 'produto' | 'conteudo';
export type StepId = 'contexto' | 'palco' | 'chegada';

export const STEP_ORDER: readonly StepId[] = ['contexto', 'palco', 'chegada'] as const;

/** Coorte gravada em users/{uid}.cohort na criação da conta. */
export type MissionCohort = 'missao-v1';
export const COORTE_ATUAL: MissionCohort = 'missao-v1';

/** Única porta da jornada nova. Ausência de coorte = fluxo legado. */
export function isCoorteMissao(cohort: unknown): boolean {
  return cohort === COORTE_ATUAL;
}

/** Sinal da conta usado pela Tela 0 para sugerir uma trilha. */
export interface AccountSignal {
  produtos: number;
  erpConectado: boolean;
  temProjetoConteudo: boolean;
}

/** O que a missão produziu — é o que a tela de chegada mostra. */
export interface MissionArtifact {
  tipo: 'produto' | 'blog';
  id: string;
  rotulo: string;
  url?: string;
}

export interface MissionState {
  missionId: MissionId;
  step: StepId;
  /** Payload livre por missão (URL colada, id do produto, config do blog…). */
  dados: Record<string, unknown>;
  iniciadaEm: string;
  concluidaEm?: string;
  abandonadaEm?: string;
  artefato?: MissionArtifact;
}
