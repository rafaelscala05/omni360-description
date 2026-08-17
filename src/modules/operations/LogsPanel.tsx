import React, { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';
import type { AgentLog } from '../../types/agent';
import { fetchLogs } from '../../services/operationsService';

interface Props {
  aberto: boolean;
  onFechar: () => void;
}

const Json: React.FC<{ titulo: string; valor: unknown }> = ({ titulo, valor }) => {
  if (valor === null || valor === undefined) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{titulo}</div>
      <pre className="text-[11px] leading-relaxed font-mono bg-slate-900 text-slate-200 rounded-lg p-3 overflow-x-auto max-h-72">
        {JSON.stringify(valor, null, 2)}
      </pre>
    </div>
  );
};

const Linha: React.FC<{ log: AgentLog }> = ({ log }) => {
  const [aberto, setAberto] = useState(!log.ok);
  const hora = new Date(log.at).toLocaleTimeString('pt-BR');

  return (
    <div className={`border rounded-lg overflow-hidden ${log.ok ? 'border-slate-200' : 'border-red-200 bg-red-50/40'}`}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50/80 transition-colors"
      >
        {aberto ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${log.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {log.status ?? 'ERR'}
        </span>
        <span className="text-[11px] font-medium text-slate-500 uppercase shrink-0">{log.provider}</span>
        <span className="font-mono text-xs text-slate-700 truncate flex-1 min-w-0" title={`${log.operacao} ${log.alvo}`}>
          {log.operacao} {log.alvo}
        </span>
        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">{log.ms}ms</span>
        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums hidden sm:inline">{hora}</span>
      </button>

      {aberto && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100 pt-3">
          {log.erro && (
            <div className="flex gap-2 text-xs text-red-700 bg-red-100/70 rounded-lg px-3 py-2">
              <AlertOctagon className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="font-medium">{log.erro}</span>
            </div>
          )}
          {log.tool && <div className="text-[11px] text-slate-500">ferramenta: <span className="font-mono">{log.tool}</span></div>}
          <Json titulo="Enviado" valor={log.requisicao} />
          <Json titulo="Resposta" valor={log.resposta} />
        </div>
      )}
    </div>
  );
};

const LogsPanel: React.FC<Props> = ({ aberto, onFechar }) => {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [apenasErros, setApenasErros] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setLogs(await fetchLogs({ apenasErros }));
    } catch (e: any) {
      setErro(e?.message ?? 'Não consegui carregar os logs.');
    } finally {
      setCarregando(false);
    }
  }, [apenasErros]);

  useEffect(() => { if (aberto) void carregar(); }, [aberto, carregar]);

  if (!aberto) return null;

  const falhas = logs.filter((l) => !l.ok).length;

  return (
    <>
      <div onClick={onFechar} className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" />
      <aside className="fixed right-0 inset-y-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        <header className="h-14 px-4 flex items-center gap-3 border-b border-slate-200 shrink-0">
          <div className="font-medium text-slate-800 text-sm">Chamadas à API</div>
          {falhas > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              {falhas} {falhas === 1 ? 'falha' : 'falhas'}
            </span>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={apenasErros}
              onChange={(e) => setApenasErros(e.target.checked)}
              className="rounded border-slate-300 accent-[#FF5B03]"
            />
            só erros
          </label>
          <button onClick={carregar} disabled={carregando} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50" title="Atualizar">
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onFechar} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {erro && <div className="text-sm text-red-600">{erro}</div>}
          {!erro && !logs.length && !carregando && (
            <p className="text-sm text-slate-400 text-center py-8">
              {apenasErros ? 'Nenhuma falha registrada.' : 'Nenhuma chamada ainda.'}
            </p>
          )}
          {logs.map((l) => <Linha key={l.id} log={l} />)}
        </div>

        <footer className="px-4 py-3 border-t border-slate-100 text-[11px] text-slate-400 shrink-0">
          Cada linha é uma chamada HTTP real do agente. Imagens em base64 e tokens são omitidos.
        </footer>
      </aside>
    </>
  );
};

export default LogsPanel;
