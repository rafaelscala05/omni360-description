// O App fornece a navegação; os cards do Alfred (no chat e na Atividade) só
// pedem "abra este destino". Contexto em vez de prop porque o card mora vários
// níveis abaixo (AgentHomeScreen › ChatThread › ActionCard).

import React, { createContext, useContext } from 'react';
import type { DestinoItem } from './abrirNaFerramenta';

const Ctx = createContext<((d: DestinoItem) => void) | null>(null);

export const AbrirNaFerramentaProvider: React.FC<{ abrir: (d: DestinoItem) => void; children: React.ReactNode }> = ({ abrir, children }) => (
  <Ctx.Provider value={abrir}>{children}</Ctx.Provider>
);

/** null fora do App (nenhum botão é mostrado). */
export const useAbrirNaFerramenta = () => useContext(Ctx);
