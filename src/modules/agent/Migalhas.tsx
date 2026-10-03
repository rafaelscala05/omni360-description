import React from 'react';
import { ChevronRight } from 'lucide-react';
import { BotaoConta } from '../../components/ContaMenu';

export interface Migalha {
  rotulo: string;
  /** Sem `onClick` é a tela atual (a última migalha). */
  onClick?: () => void;
}

/**
 * Barra de topo das telas de ferramenta que não têm o cabeçalho de busca e
 * créditos do app (Categorias, Mercado Livre): o caminho até a tela e, no
 * telefone, o avatar da Conta. Mesma altura da barra "‹ Ferramentas" de Produtos.
 */
const Migalhas: React.FC<{ itens: Migalha[]; className?: string }> = ({ itens, className }) => (
  <div className={`flex items-center gap-1 min-h-[44px] shrink-0 ${className ?? ''}`}>
    <nav aria-label="Caminho" className="flex-1 min-w-0 flex items-center gap-1 text-[14px] font-medium overflow-hidden">
      {itens.map((m, i) => (
        <React.Fragment key={m.rotulo}>
          {i > 0 && <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" aria-hidden />}
          {m.onClick ? (
            <button onClick={m.onClick} className="shrink-0 py-2 text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors">
              {m.rotulo}
            </button>
          ) : (
            <span aria-current="page" className="min-w-0 truncate text-[var(--ag-text)] font-semibold">{m.rotulo}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
    <BotaoConta />
  </div>
);

export default Migalhas;
