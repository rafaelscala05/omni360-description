// Recorte do Centro de Operações (`OperacoesScreen.tsx`) com dados fictícios:
// vendas da semana, pedidos parados e alertas de estoque e preço.

import { AlertTriangle, PackageX, TrendingDown } from 'lucide-react';

const VENDAS = [
  { dia: 'seg', valor: 5820 },
  { dia: 'ter', valor: 6410 },
  { dia: 'qua', valor: 7980 },
  { dia: 'qui', valor: 6120 },
  { dia: 'sex', valor: 9240 },
  { dia: 'sáb', valor: 7350 },
  { dia: 'dom', valor: 5290 },
];

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const ALERTAS = [
  { icone: AlertTriangle, cor: 'var(--ag-warn)', fundo: 'var(--ag-warn-soft)', titulo: '7 pedidos parados', texto: 'Aprovados há mais de 2 dias sem faturar' },
  { icone: PackageX, cor: 'var(--ag-danger)', fundo: 'var(--ag-danger-soft)', titulo: '3 produtos que vendiam esgotaram', texto: 'Mais 5 acabam em menos de 14 dias' },
  { icone: TrendingDown, cor: 'var(--ag-danger)', fundo: 'var(--ag-danger-soft)', titulo: '2 preços abaixo do custo', texto: 'Vendidos por menos do que custaram' },
];

export default function OperacoesDemo() {
  const total = VENDAS.reduce((s, d) => s + d.valor, 0);
  const max = Math.max(...VENDAS.map((d) => d.valor));
  return (
    <div className="ag-glass-strong ag-sheen rounded-[30px] p-5 sm:p-6" aria-label="Exemplo do Centro de Operações">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-[var(--ag-text-2)]">Vendas, últimos 7 dias</p>
          <p className="mt-1 font-display text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--ag-text)]">{brl(total)}</p>
          <p className="mt-1.5 text-[13px] text-[var(--ag-text-2)]">
            <span className="font-semibold" style={{ color: 'var(--ag-ok)' }}>+12%</span> sobre a semana anterior
          </p>
        </div>
      </div>

      {/* Uma série só: o título nomeia, sem legenda. Valor em cada barra no hover/foco. */}
      <div className="mt-6 grid grid-cols-7 gap-2 items-end h-28" role="img" aria-label={`Vendas por dia: ${VENDAS.map((d) => `${d.dia} ${brl(d.valor)}`).join(', ')}`}>
        {VENDAS.map((d) => (
          <div key={d.dia} className="group relative flex flex-col items-center justify-end h-full">
            <span className="pointer-events-none absolute -top-7 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums opacity-0 group-hover:opacity-100 transition-opacity ag-glass-strong text-[var(--ag-text)]">
              {brl(d.valor)}
            </span>
            <div
              className="w-full max-w-[28px] rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{ height: `${(d.valor / max) * 100}%`, background: 'var(--ag-orig-operacoes)' }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[11px] text-[var(--ag-text-3)]" style={{ borderTop: '1px solid var(--ag-hairline)', paddingTop: 6 }}>
        {VENDAS.map((d) => <span key={d.dia}>{d.dia}</span>)}
      </div>

      <ul className="mt-6 flex flex-col gap-2">
        {ALERTAS.map(({ icone: Icone, cor, fundo, titulo, texto }) => (
          <li key={titulo} className="flex items-center gap-3 rounded-[16px] px-3.5 py-3" style={{ background: 'var(--ag-fill)' }}>
            <span className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0" style={{ background: fundo, color: cor }}>
              <Icone className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[var(--ag-text)]">{titulo}</p>
              <p className="text-[12.5px] text-[var(--ag-text-2)]">{texto}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
