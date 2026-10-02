import React from 'react';
import { ROTULO_GRUPO, ROTULO_INTEGRACAO, type EstadoSync, type IntegracaoSync } from '../sincronizacao';

/**
 * "Tiny · em dia" (neutro), "Tiny · 2 não enviadas" (âmbar, o title lista quais)
 * ou "Só no OMNI360" (contorno, sem integração).
 */
const SeloIntegracao: React.FC<{ integracao?: IntegracaoSync; estado?: EstadoSync }> = ({ integracao, estado }) => {
  const base = 'inline-flex items-center h-6 px-2 rounded-full text-[11.5px] font-medium whitespace-nowrap';
  if (!integracao || !estado) {
    return <span className={base} style={{ color: 'var(--ag-text-3)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' }}>Só no OMNI360</span>;
  }
  const nome = ROTULO_INTEGRACAO[integracao];
  if (estado.tipo === 'pendente') {
    const n = estado.grupos.length;
    return (
      <span
        className={base}
        title={`Não enviado ao ${nome}: ${estado.grupos.map((g) => ROTULO_GRUPO[g]).join(', ')}`}
        style={{ background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)' }}
      >
        {nome} · {n} {n === 1 ? 'não enviada' : 'não enviadas'}
      </span>
    );
  }
  return <span className={base} style={{ background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}>{nome} · em dia</span>;
};

export default SeloIntegracao;
