// Persistência do estado das missões de onboarding.
// users/{uid}/missions/{missionId} — um doc por missão.

import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { criarEstadoInicial } from '../modules/onboarding/mission/missionSteps';
import type { MissionArtifact, MissionId, MissionState } from '../modules/onboarding/mission/missionTypes';

const ref = (uid: string, missionId: MissionId) => doc(db, `users/${uid}/missions/${missionId}`);

export async function carregarMissao(uid: string, missionId: MissionId): Promise<MissionState | null> {
  const snap = await getDoc(ref(uid, missionId));
  return snap.exists() ? (snap.data() as MissionState) : null;
}

export async function salvarMissao(uid: string, state: MissionState): Promise<void> {
  await setDoc(ref(uid, state.missionId), state, { merge: true });
}

/**
 * Retoma a missão se já existir — é o que faz "começa no celular, termina no
 * desktop" funcionar. Só cria estado novo quando não há nada gravado.
 */
export async function iniciarMissao(uid: string, missionId: MissionId): Promise<MissionState> {
  const existente = await carregarMissao(uid, missionId);
  if (existente && !existente.concluidaEm) return existente;
  const novo = criarEstadoInicial(missionId);
  await salvarMissao(uid, novo);
  return novo;
}

export async function concluirMissao(
  uid: string, state: MissionState, artefato: MissionArtifact,
): Promise<MissionState> {
  const concluida: MissionState = { ...state, artefato, concluidaEm: new Date().toISOString() };
  await salvarMissao(uid, concluida);
  return concluida;
}

/** Retomada no App e, no Plano 2, a trilha do dia 2. */
export function ouvirMissoes(uid: string, cb: (missoes: MissionState[]) => void): () => void {
  return onSnapshot(collection(db, `users/${uid}/missions`), (snap) => {
    cb(snap.docs.map((d) => d.data() as MissionState));
  });
}
