import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { paginasVisiveis } from '../produtosAgente';

interface Props {
  pagina: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
  onIr: (pagina: number) => void;
}

const Paginacao: React.FC<Props> = ({ pagina, totalPaginas, inicio, fim, total, onIr }) => {
  if (totalPaginas <= 1) return null;
  const botao = 'min-w-[40px] h-10 px-2 rounded-full text-[13.5px] font-medium tabular-nums disabled:opacity-40';
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-2 py-2">
      <span className="hidden sm:block text-[12.5px] text-[var(--ag-text-2)] tabular-nums">
        {inicio}–{fim} de {total.toLocaleString('pt-BR')}
      </span>
      <div className="flex-1 sm:flex-initial flex items-center justify-between sm:justify-end gap-1">
        <button className={botao} disabled={pagina === 1} onClick={() => onIr(pagina - 1)} aria-label="Página anterior"
          style={{ background: 'var(--ag-fill)', color: 'var(--ag-text)' }}>
          <ChevronLeft className="w-4 h-4 mx-auto" />
        </button>
        <span className="sm:hidden text-[13.5px] text-[var(--ag-text)] tabular-nums">{pagina} de {totalPaginas}</span>
        <span className="hidden sm:flex items-center gap-1">
          {paginasVisiveis(pagina, totalPaginas).map((n, i) => n === '…'
            ? <span key={`r${i}`} className="px-1 text-[var(--ag-text-3)]">…</span>
            : (
              <button key={n} className={botao} onClick={() => onIr(n)} aria-current={n === pagina ? 'page' : undefined}
                style={n === pagina ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' } : { color: 'var(--ag-text-2)' }}>
                {n}
              </button>
            ))}
        </span>
        <button className={botao} disabled={pagina === totalPaginas} onClick={() => onIr(pagina + 1)} aria-label="Próxima página"
          style={{ background: 'var(--ag-fill)', color: 'var(--ag-text)' }}>
          <ChevronRight className="w-4 h-4 mx-auto" />
        </button>
      </div>
    </nav>
  );
};

export default Paginacao;
