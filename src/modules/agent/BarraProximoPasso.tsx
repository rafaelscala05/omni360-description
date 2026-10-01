// Barra "Próximo passo · N selecionados" no pé de toda tela de agente (F2):
// a ação principal da tela para a seleção e o atalho "Pedir ao Alfred" levando
// a seleção como contexto. Usada em Produtos, Mercado Livre e Conteúdo.
//
// Mercado Livre e Conteúdo ainda estão no visual antigo (fora do escopo
// .alfreds); com `escopo`, a barra abre o próprio escopo e lê o tema único.

import React from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useAgentTheme } from './theme';

export interface AcaoBarra {
  rotulo: string;
  detalhe?: string;
  onClick: () => void;
  desabilitada?: boolean;
  ocupada?: boolean;
}

interface Props {
  /** Quantos itens estão selecionados (0 = sem seleção). */
  n: number;
  acao?: AcaoBarra | null;
  onPedirAlfred?: () => void;
  /** Tela fora do escopo .alfreds: a barra abre o próprio, com o tema do agente. */
  escopo?: boolean;
  /** Classe do contêiner externo (ex.: sticky bottom-0 numa tela que rola). */
  className?: string;
}

const Conteudo: React.FC<Omit<Props, 'escopo' | 'className'>> = ({ n, acao, onPedirAlfred }) => (
  <div className="ag-glass-strong px-4 sm:px-6 pt-3 pb-3" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
    <div className="max-w-3xl mx-auto flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-2)] tabular-nums">
        Próximo passo{n > 0 ? ` · ${n} selecionado${n === 1 ? '' : 's'}` : ''}
      </span>
      <div className="flex gap-2">
        {acao && (
          <button
            onClick={acao.onClick}
            disabled={acao.desabilitada}
            className="flex-1 min-h-[48px] px-4 rounded-full flex items-center justify-center gap-2 text-[15px] font-semibold disabled:opacity-70"
            style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
          >
            {acao.ocupada ? <RefreshCw className="w-4 h-4 animate-spin" /> : n > 0 ? <Sparkles className="w-4 h-4" /> : null}
            {acao.rotulo}
            {acao.detalhe && <span className="font-medium opacity-70 text-[13px]">· {acao.detalhe}</span>}
          </button>
        )}
        {onPedirAlfred && (
          <button
            onClick={onPedirAlfred}
            aria-label={n ? `Pedir ao Alfred sobre os ${n} selecionados` : 'Pedir ao Alfred'}
            title="Pedir ao Alfred"
            className={`min-h-[48px] rounded-full flex items-center justify-center gap-2 text-[14px] font-semibold ${acao ? 'w-12 shrink-0' : 'flex-1 px-4'}`}
            style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
          >
            <span
              className="w-6 h-6 rounded-full shrink-0"
              style={{ background: 'var(--ag-accent)', boxShadow: 'inset 0 0 0 4px color-mix(in srgb, var(--ag-accent) 45%, var(--ag-bg-2))' }}
            />
            {!acao && 'Pedir ao Alfred'}
          </button>
        )}
      </div>
    </div>
  </div>
);

const BarraProximoPasso: React.FC<Props> = ({ escopo, className, ...resto }) => {
  const { tema } = useAgentTheme();
  if (!resto.acao && !resto.onPedirAlfred) return null;
  if (!escopo) return <div className={`shrink-0 ${className ?? ''}`}><Conteudo {...resto} /></div>;
  return (
    <div className={`alfreds shrink-0 ${className ?? ''}`} data-tema={tema}>
      <Conteudo {...resto} />
    </div>
  );
};

export default BarraProximoPasso;
