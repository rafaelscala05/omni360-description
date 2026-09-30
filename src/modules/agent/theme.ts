// Tema da superfície do agente (claro/escuro), confinado à classe `.alfreds`.
//
// Não usa `prefers-color-scheme` como fonte da verdade porque o resto do app é
// sempre claro: quem tem o sistema no escuro não deveria abrir só esta tela em
// preto sem ter pedido. O sistema entra apenas como palpite inicial, na
// primeira visita, e a escolha explícita passa a valer a partir daí.
//
// O estado é um só para o app inteiro (store de módulo + useSyncExternalStore):
// Alfred, Atividade, Ferramentas, a tab bar e a barra "Próximo passo" leem o
// mesmo valor. Antes cada tela tinha seu useState, e trocar para o escuro no
// Alfred deixava a tab bar e as outras portas no claro até recarregar.

import { useCallback, useSyncExternalStore } from 'react';

export type AgentTheme = 'claro' | 'escuro';

const CHAVE = 'alfreds:tema';

function inicial(): AgentTheme {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'claro' || salvo === 'escuro') return salvo;
  } catch {
    /* localStorage bloqueado (modo privado / cookies desativados) */
  }
  return 'claro';
}

let atual: AgentTheme = inicial();
const ouvintes = new Set<() => void>();

function definir(t: AgentTheme): void {
  if (t === atual) return;
  atual = t;
  try {
    localStorage.setItem(CHAVE, t);
  } catch {
    /* idem */
  }
  ouvintes.forEach((f) => f());
}

function assinar(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

export function useAgentTheme(): { tema: AgentTheme; alternar: () => void } {
  const tema = useSyncExternalStore(assinar, () => atual, () => 'claro' as AgentTheme);
  const alternar = useCallback(() => definir(atual === 'claro' ? 'escuro' : 'claro'), []);
  return { tema, alternar };
}
