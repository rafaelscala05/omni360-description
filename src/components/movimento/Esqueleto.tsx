// Esqueletos com a forma do conteúdo que vai chegar — no lugar do spinner
// solto. Usam o .ag-shimmer, então seguem o tema do Alfred.

import React from 'react';

export const Bloco: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = '', style }) => (
  <span aria-hidden className={`ag-shimmer block rounded-md ${className}`} style={style} />
);

/** Linha de produto: miniatura, título, subtítulo e duas pílulas. */
export const EsqueletoLinhaProduto: React.FC = () => (
  <div className="flex items-center gap-3 px-3 py-3" aria-hidden>
    <Bloco className="w-11 h-11 rounded-xl flex-none" />
    <div className="flex-1 min-w-0 flex flex-col gap-2">
      <Bloco className="h-3.5 w-3/5" />
      <Bloco className="h-3 w-2/5" />
    </div>
    <Bloco className="h-5 w-16 rounded-full hidden sm:block" />
    <Bloco className="h-5 w-12 rounded-full hidden sm:block" />
  </div>
);

/** Card (ação, conector, métrica). */
export const EsqueletoCard: React.FC<{ linhas?: number; className?: string }> = ({ linhas = 2, className = '' }) => (
  <div className={`ag-glass rounded-2xl p-4 flex flex-col gap-2.5 ${className}`} aria-hidden>
    <div className="flex items-center gap-2.5">
      <Bloco className="w-8 h-8 rounded-full flex-none" />
      <Bloco className="h-3.5 w-1/2" />
    </div>
    {Array.from({ length: linhas }, (_, i) => (
      <Bloco key={i} className="h-3" style={{ width: `${88 - i * 18}%` }} />
    ))}
  </div>
);

/** Gráfico: barras de alturas variadas. */
export const EsqueletoGrafico: React.FC<{ altura?: number }> = ({ altura = 140 }) => (
  <div className="flex items-end gap-1.5" style={{ height: altura }} aria-hidden>
    {[45, 70, 38, 82, 60, 92, 54, 76, 40, 66, 88, 58].map((h, i) => (
      <Bloco key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
    ))}
  </div>
);

export const EsqueletoLista: React.FC<{ n?: number }> = ({ n = 6 }) => (
  <div role="status" aria-label="Carregando" className="flex flex-col">
    {Array.from({ length: n }, (_, i) => (
      <div key={i} style={i ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}>
        <EsqueletoLinhaProduto />
      </div>
    ))}
  </div>
);
