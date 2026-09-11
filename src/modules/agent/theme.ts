// Tema da superfície do agente (claro/escuro), confinado à classe `.alfreds`.
//
// Não usa `prefers-color-scheme` como fonte da verdade porque o resto do app é
// sempre claro: quem tem o sistema no escuro não deveria abrir só esta tela em
// preto sem ter pedido. O sistema entra apenas como palpite inicial, na
// primeira visita, e a escolha explícita passa a valer a partir daí.

import { useCallback, useEffect, useState } from 'react';

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

export function useAgentTheme(): { tema: AgentTheme; alternar: () => void } {
  const [tema, setTema] = useState<AgentTheme>(inicial);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, tema);
    } catch {
      /* idem */
    }
  }, [tema]);

  const alternar = useCallback(() => {
    setTema((t) => (t === 'claro' ? 'escuro' : 'claro'));
  }, []);

  return { tema, alternar };
}
