// A2 · cabeçalho da conversa que nasceu de uma tarefa da semana:
// "‹ Semana · Descrições · 12 produtos · Trabalhando". Diz de onde a conversa
// veio e em que pé está, sem o usuário ter de rolar até o card.

import React from 'react';
import { ChevronLeft } from 'lucide-react';
import type { TarefaSemana } from '../semana';
import { ORIGEM } from '../SemanaPanel';

interface Props {
  tarefa: TarefaSemana;
  streaming: boolean;
  /** Aprovações esperando o usuário agora. */
  pendentes: number;
  /** Ausente no desktop em 3 colunas: a semana já está ao lado. */
  onVoltar?: () => void;
}

const CabecalhoTarefa: React.FC<Props> = ({ tarefa, streaming, pendentes, onVoltar }) => {
  const estado = streaming
    ? { rotulo: 'Trabalhando', fundo: 'var(--ag-blue-soft)', cor: 'var(--ag-blue)' }
    : pendentes > 0
      ? { rotulo: 'Precisa de você', fundo: 'var(--ag-accent-soft)', cor: 'var(--ag-accent)' }
      : { rotulo: 'Em dia', fundo: 'var(--ag-ok-soft)', cor: 'var(--ag-ok)' };
  return (
    <div className="shrink-0 px-3 sm:px-4 py-2 flex items-center gap-2 text-[13px]" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
      {onVoltar && (
        <button onClick={onVoltar} className="min-h-[36px] pr-1 flex items-center text-[var(--ag-text-2)] hover:text-[var(--ag-text)] shrink-0">
          <ChevronLeft className="w-4 h-4" /> Semana
        </button>
      )}
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ORIGEM[tarefa.origem].cor }} />
      <span className="flex-1 min-w-0 truncate font-semibold text-[var(--ag-text)]" title={tarefa.titulo}>{tarefa.titulo}</span>
      <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium" style={{ background: estado.fundo, color: estado.cor }}>
        {streaming && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
        {estado.rotulo}
      </span>
    </div>
  );
};

export default CabecalhoTarefa;
