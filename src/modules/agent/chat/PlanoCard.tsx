import React, { useState } from 'react';
import { Check, ChevronDown, Minus, X } from 'lucide-react';
import type { EstadoPasso, Plano, TipoPasso } from '../plano';

const CHIP: Record<TipoPasso, { texto: string; fundo: string; cor: string }> = {
  leitura: { texto: 'leitura', fundo: 'var(--ag-fill-2)', cor: 'var(--ag-text-2)' },
  trabalho: { texto: 'Alfred', fundo: 'var(--ag-blue-soft)', cor: 'var(--ag-blue)' },
  voce: { texto: 'você', fundo: 'var(--ag-accent-soft)', cor: 'var(--ag-accent)' },
  gravacao: { texto: 'gravação', fundo: 'var(--ag-fill-2)', cor: 'var(--ag-text-2)' },
};

const Numero: React.FC<{ n: number; estado: EstadoPasso }> = ({ n, estado }) => {
  const base = 'w-[26px] h-[26px] rounded-full grid place-items-center shrink-0 text-[12px] font-semibold';
  if (estado === 'feito') {
    return <span className={base} style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}><Check className="w-3.5 h-3.5" /></span>;
  }
  if (estado === 'erro') {
    return <span className={base} style={{ background: 'var(--ag-danger-soft)', color: 'var(--ag-danger)' }}><X className="w-3.5 h-3.5" /></span>;
  }
  if (estado === 'cancelado') {
    return <span className={base} style={{ background: 'var(--ag-fill)', color: 'var(--ag-text-3)' }}><Minus className="w-3.5 h-3.5" /></span>;
  }
  if (estado === 'agora') {
    return (
      <span className={`${base} relative`} style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}>
        {n}
        <span className="ag-live absolute inset-0 rounded-full" />
      </span>
    );
  }
  return <span className={base} style={{ background: 'var(--ag-fill)', color: 'var(--ag-text-3)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' }}>{n}</span>;
};

/**
 * O plano do turno: passos numerados, cada um marcado como leitura, você ou
 * gravação — "ver antes de gravar". O passo atual fica em destaque; o log
 * técnico (as chamadas cruas) fica atrás de "Ver como ele trabalhou".
 */
const PlanoCard: React.FC<{ plano: Plano; detalhes?: React.ReactNode }> = ({ plano, detalhes }) => {
  const [aberto, setAberto] = useState(false);
  const { passos, custo } = plano;
  if (!passos.length) return null;

  return (
    <div className="ag-glass rounded-[20px] px-4 pt-3 pb-2">
      <div className="flex items-center justify-between gap-3 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-2)]">
          Plano · {passos.length} {passos.length === 1 ? 'passo' : 'passos'}
        </span>
        {typeof custo === 'number' && custo > 0 && (
          <span className="text-[12px] text-[var(--ag-text-3)] tabular-nums">{custo} {custo === 1 ? 'crédito' : 'créditos'}</span>
        )}
      </div>

      <ol>
        {passos.map((p, i) => (
          <li
            key={`${p.titulo}-${i}`}
            className="flex items-start gap-3 py-2.5"
            style={{ ...(i === 0 ? {} : { borderTop: '1px solid var(--ag-hairline)' }), opacity: p.estado === 'depois' || p.estado === 'cancelado' ? 0.6 : 1 }}
            aria-current={p.estado === 'agora' ? 'step' : undefined}
          >
            <Numero n={i + 1} estado={p.estado} />
            <div className="min-w-0 flex-1">
              <div className={`text-[14px] leading-snug text-[var(--ag-text)] ${p.estado === 'agora' ? 'font-semibold' : 'font-medium'}`}>{p.titulo}</div>
              {p.detalhe && (
                <div className="text-[12.5px] leading-snug mt-0.5 break-words" style={{ color: p.estado === 'erro' ? 'var(--ag-danger)' : 'var(--ag-text-2)' }}>
                  {p.detalhe}
                </div>
              )}
            </div>
            <span
              className="shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: CHIP[p.tipo].fundo, color: CHIP[p.tipo].cor }}
            >
              {CHIP[p.tipo].texto}
            </span>
          </li>
        ))}
      </ol>

      {detalhes && (
        <>
          <button
            onClick={() => setAberto((v) => !v)}
            className="w-full min-h-[40px] flex items-center gap-1 text-[12.5px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
            style={{ borderTop: '1px solid var(--ag-hairline)' }}
            aria-expanded={aberto}
          >
            Ver como ele trabalhou
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${aberto ? 'rotate-180' : ''}`} />
          </button>
          {aberto && <div className="pb-2">{detalhes}</div>}
        </>
      )}
    </div>
  );
};

export default PlanoCard;
