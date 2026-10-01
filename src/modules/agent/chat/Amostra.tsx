import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PreviewField } from '../../../types/agent';

export function formatar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const Bloco: React.FC<{ rotulo: string; valor: unknown; destaque?: boolean }> = ({ rotulo, valor, destaque }) => (
  <div
    className="rounded-[14px] px-3 py-2.5"
    style={destaque
      ? { background: 'var(--ag-ok-soft)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--ag-ok) 30%, transparent)' }
      : { background: 'var(--ag-fill)' }}
  >
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] mb-1" style={{ color: destaque ? 'var(--ag-ok)' : 'var(--ag-text-3)' }}>{rotulo}</div>
    <div className="text-[13px] leading-[1.5] break-words whitespace-pre-wrap" style={{ color: destaque ? 'var(--ag-text)' : 'var(--ag-text-2)' }}>
      {formatar(valor) === '—' ? 'vazio' : formatar(valor)}
    </div>
  </div>
);

/**
 * Lote: um item por vez, com antes e depois empilhados e setas para navegar —
 * "aprovar 12" sem ver nenhum seria aprovar às cegas, e uma tabela com 36
 * linhas ninguém lê no celular.
 */
export const Amostra: React.FC<{
  itens: { alvo: string; campos: (PreviewField & { imagens?: string[] })[] }[];
  /** Ação por item (ex.: "Descartar este" no lote), abaixo do antes/depois. */
  rodape?: (indice: number) => React.ReactNode;
}> = ({ itens, rodape }) => {
  const [i, setI] = useState(0);
  const atual = Math.min(i, itens.length - 1);
  const item = itens[atual];
  if (!item) return null;
  return (
    <div className="px-4 py-3 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-[var(--ag-text)] truncate" title={item.alvo}>{item.alvo}</span>
        {itens.length > 1 && (
          <span className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setI(Math.max(0, atual - 1))}
              disabled={atual === 0}
              aria-label="Item anterior"
              className="w-9 h-9 rounded-full grid place-items-center disabled:opacity-35"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[12px] tabular-nums text-[var(--ag-text-2)] min-w-[3.2rem] text-center">{atual + 1} / {itens.length}</span>
            <button
              onClick={() => setI(Math.min(itens.length - 1, atual + 1))}
              disabled={atual >= itens.length - 1}
              aria-label="Próximo item"
              className="w-9 h-9 rounded-full grid place-items-center disabled:opacity-35"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </span>
        )}
      </div>
      {item.campos.map((c, k) => (
        c.imagens?.length
          ? (
            <div key={k} className="flex flex-col gap-1.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: 'var(--ag-ok)' }}>{c.campo}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {c.imagens.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block rounded-[12px] overflow-hidden aspect-square" style={{ background: 'var(--ag-fill)' }}>
                    <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )
          : c.antes === null || c.antes === undefined || !c.mudou
          ? <Bloco key={k} rotulo={c.campo} valor={c.depois} destaque={c.mudou} />
          : (
            <div key={k} className="grid gap-2">
              <Bloco rotulo={`${c.campo} · antes`} valor={c.antes} />
              <Bloco rotulo={`${c.campo} · depois`} valor={c.depois} destaque />
            </div>
          )
      ))}
      {rodape?.(atual)}
    </div>
  );
};

