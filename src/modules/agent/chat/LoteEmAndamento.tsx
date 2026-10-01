import React, { useEffect, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { agirNoLote, listenLotesAtivos } from '../../../services/agentChatService';
import { linhaProgresso, nomeDoLote, type LoteJob } from '../lote';

/**
 * Faixa acima do campo de digitar enquanto um lote do Alfred trabalha (A2:
 * "Pausar" no composer). O card do lote pode ter rolado para cima na
 * conversa; daqui o usuário vê o progresso e pausa sem procurá-lo.
 */
const LoteEmAndamento: React.FC<{ uid: string }> = ({ uid }) => {
  const [lotes, setLotes] = useState<LoteJob[]>([]);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => listenLotesAtivos(setLotes), [uid]);

  // O mais recente primeiro: é o que o usuário acabou de pedir.
  const lote = [...lotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!lote) return null;
  const pausado = lote.status === 'pausado';

  const alternar = async () => {
    setOcupado(true);
    try { await agirNoLote(lote.id, pausado ? 'retomar' : 'pausar'); } catch { /* o card mostra o erro */ } finally { setOcupado(false); }
  };

  return (
    <div className="ag-glass rounded-full pl-4 pr-1.5 py-1.5 mb-2 flex items-center gap-3">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${pausado ? '' : 'animate-pulse'}`}
        style={{ background: pausado ? 'var(--ag-text-3)' : 'var(--ag-blue)' }}
        aria-hidden
      />
      <span className="flex-1 min-w-0 text-[12.5px] text-[var(--ag-text-2)] truncate tabular-nums" aria-live="polite">
        <span className="font-semibold text-[var(--ag-text)]">{nomeDoLote(lote.tool, lote.itens.length)}</span> · {linhaProgresso(lote)}
      </span>
      <button
        onClick={() => void alternar()}
        disabled={ocupado}
        className="shrink-0 min-h-[36px] px-3 rounded-full flex items-center gap-1.5 text-[12.5px] font-semibold disabled:opacity-60"
        style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
      >
        {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pausado ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        {pausado ? 'Continuar' : 'Pausar'}
      </button>
    </div>
  );
};

export default LoteEmAndamento;
