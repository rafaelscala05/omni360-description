// Peças visuais do Centro de Operações, compartilhadas pelas seções
// (OperacoesScreen, SecaoEntrega, SecaoCatalogo). Cores só por tokens `--ag-*`.
import React from 'react';
import { AlertTriangle, Plug, Sparkles } from 'lucide-react';

export const brl = (v: number, compacto = false) =>
  v.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    ...(compacto && v >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: v >= 1000 ? 0 : 2 }),
  });
export const int = (v: number) => v.toLocaleString('pt-BR');

export const Secao: React.FC<{ titulo: string; nota?: string; acao?: React.ReactNode; children: React.ReactNode }> = ({ titulo, nota, acao, children }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-end gap-3 px-1">
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-semibold text-[var(--ag-text)]">{titulo}</h2>
        {nota && <p className="text-[12.5px] text-[var(--ag-text-3)]">{nota}</p>}
      </div>
      {acao}
    </div>
    {children}
  </section>
);

export const BotaoAlfred: React.FC<{ onClick: () => void; children?: React.ReactNode }> = ({ onClick, children }) => (
  <button
    onClick={onClick}
    className="shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-semibold flex items-center gap-1.5"
    style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}
  >
    <Sparkles className="w-3.5 h-3.5" /> {children ?? 'Pedir ao Alfred'}
  </button>
);

/** Número com rótulo. Com `onClick`, vira um seletor: `ativo` marca o que está aberto embaixo. */
export const Tile: React.FC<{ rotulo: string; valor: string; children?: React.ReactNode; alerta?: boolean; onClick?: () => void; ativo?: boolean }> = ({ rotulo, valor, children, alerta, onClick, ativo }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
  <Tag
    {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': !!ativo } : {})}
    className="ag-glass rounded-[18px] px-4 py-3.5 flex flex-col gap-1 min-w-0 text-left transition-shadow"
    style={ativo ? { boxShadow: 'inset 0 0 0 1.5px var(--ag-orig-operacoes)' } : undefined}
  >
    <span className="text-[12.5px] font-medium text-[var(--ag-text-2)] flex items-center gap-1">
      {alerta && <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--ag-warn)' }} aria-hidden />}
      {rotulo}
    </span>
    <span className="font-display text-[26px] leading-tight font-semibold tabular-nums text-[var(--ag-text)] truncate">{valor}</span>
    {children}
  </Tag>
  );
};


export const Aviso: React.FC<{ titulo: string; texto: string; acao?: { rotulo: string; onClick: () => void }; tom?: 'warn' | 'neutro' }> = ({ titulo, texto, acao, tom = 'neutro' }) => (
  <div
    className={tom === 'warn' ? 'rounded-[18px] px-4 py-3.5 flex items-start gap-3' : 'ag-glass rounded-[18px] px-4 py-3.5 flex items-start gap-3'}
    style={tom === 'warn' ? { background: 'var(--ag-warn-soft)', border: '1px solid var(--ag-warn-line)' } : undefined}
  >
    {tom === 'warn'
      ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--ag-warn)' }} />
      : <Plug className="w-4 h-4 mt-0.5 shrink-0 text-[var(--ag-text-2)]" />}
    <div className="min-w-0 flex-1">
      <div className="text-[14px] font-semibold text-[var(--ag-text)]">{titulo}</div>
      <p className="text-[13px] leading-snug text-[var(--ag-text-2)]">{texto}</p>
    </div>
    {acao && (
      <button onClick={acao.onClick} className="shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-semibold" style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}>
        {acao.rotulo}
      </button>
    )}
  </div>
);

export const LinhaItem: React.FC<{ primeira: boolean; titulo: string; sub: string; valor: string; tom?: 'warn' }> = ({ primeira, titulo, sub, valor, tom }) => (
  <li className="flex items-center gap-3 px-4 py-2.5" style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}>
    <div className="min-w-0 flex-1">
      <div className="text-[14px] text-[var(--ag-text)] truncate">{titulo}</div>
      <div className="text-[12px] text-[var(--ag-text-3)] truncate">{sub}</div>
    </div>
    <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: tom === 'warn' ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>{valor}</span>
  </li>
);

