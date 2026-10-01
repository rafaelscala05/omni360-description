// "Recibo" de uma ação executada: o que foi gravado e, quando a escrita foi a
// uma API externa (Wake, Tiny, Bling, IdWorks), cada chamada HTTP feita para
// gravar — achadas pelo execucaoId que o servidor pôs no resultado e nos logs
// (server/agent/execution.ts). Carrega só ao abrir.

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { AgentAction, AgentLog } from '../../../types/agent';
import { fetchRecibo } from '../../../services/agentChatService';
import { destinoGravacao } from '../plano';
import { Linha as LinhaLog } from './LogsPanel';
import { linhasDoRecibo, resumoRecibo } from './reciboTexto';

const Recibo: React.FC<{ action: AgentAction }> = ({ action }) => {
  const [aberto, setAberto] = useState(false);
  const [logs, setLogs] = useState<AgentLog[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const resumo = resumoRecibo(action.result);
  const linhas = linhasDoRecibo(action.result);

  const alternar = () => {
    const abrir = !aberto;
    setAberto(abrir);
    if (abrir && logs === null) {
      fetchRecibo(action.id)
        .then((r) => setLogs(r.logs))
        .catch((e) => { setErro(e?.message ?? 'Não consegui carregar as chamadas.'); setLogs([]); });
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--ag-hairline)' }}>
      <button onClick={alternar} aria-expanded={aberto} className="w-full px-4 py-2 text-[12px] text-[var(--ag-text-2)] flex items-center gap-1.5 text-left">
        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ag-ok)' }} />
        <span className="flex-1 min-w-0">
          Recibo: gravado {destinoGravacao(action.provider) || ''} em {new Date(action.resolvedAt!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {resumo && <span className="text-[var(--ag-text-3)]"> · {resumo}</span>}
        </span>
        {aberto ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
      </button>
      {aberto && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {linhas.length > 0 && (
            <ul className="text-[12.5px] text-[var(--ag-text)] flex flex-col gap-1">
              {linhas.map((l, i) => <li key={i} style={l.falha ? { color: 'var(--ag-danger)' } : undefined}>{l.texto}</li>)}
            </ul>
          )}
          {logs === null ? (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--ag-text-3)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando as chamadas…</div>
          ) : logs.length ? (
            <>
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ag-text-3)] pt-1">Chamadas feitas · {logs.length}</div>
              {logs.map((l) => <LinhaLog key={l.id} log={l} />)}
            </>
          ) : (
            <div className="text-[12px] text-[var(--ag-text-3)]">
              {erro ?? 'Gravado direto no OMNI360 — nenhuma API externa foi chamada.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Recibo;
