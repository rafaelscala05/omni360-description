import React, { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';
import type { AgentLog } from '../../../types/agent';
import { fetchLogs } from '../../../services/agentChatService';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** Repassa o tema da superfície do agente: o sheet é montado fora da árvore `.alfreds`. */
  tema?: string;
}

const Json: React.FC<{ titulo: string; valor: unknown }> = ({ titulo, valor }) => {
  if (valor === null || valor === undefined) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ag-text-3)]">{titulo}</div>
      <pre
        className="ag-scroll text-[11px] leading-relaxed font-mono rounded-xl p-3 overflow-x-auto max-h-72"
        style={{ background: 'rgba(2,6,23,.92)', color: '#e2e8f0' }}
      >
        {JSON.stringify(valor, null, 2)}
      </pre>
    </div>
  );
};

const Linha: React.FC<{ log: AgentLog }> = ({ log }) => {
  const [aberto, setAberto] = useState(!log.ok);
  const hora = new Date(log.at).toLocaleTimeString('pt-BR');

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        border: '1px solid var(--ag-hairline)',
        background: log.ok ? 'var(--ag-fill)' : 'var(--ag-danger-soft)',
      }}
    >
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        {aberto
          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--ag-text-3)] shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-[var(--ag-text-3)] shrink-0" />}
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 tabular-nums"
          style={{
            background: log.ok ? 'var(--ag-ok-soft)' : 'var(--ag-danger-soft)',
            color: log.ok ? 'var(--ag-ok)' : 'var(--ag-danger)',
          }}
        >
          {log.status ?? 'ERR'}
        </span>
        <span className="text-[11px] font-semibold text-[var(--ag-text-3)] uppercase shrink-0">{log.provider}</span>
        <span
          className="font-mono text-xs text-[var(--ag-text-2)] truncate flex-1 min-w-0"
          title={`${log.operacao} ${log.alvo}`}
        >
          {log.operacao} {log.alvo}
        </span>
        <span className="text-[11px] text-[var(--ag-text-3)] shrink-0 tabular-nums">{log.ms}ms</span>
        <span className="text-[11px] text-[var(--ag-text-3)] shrink-0 tabular-nums hidden sm:inline">{hora}</span>
      </button>

      {aberto && (
        <div className="px-3 pb-3 space-y-3 pt-3" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          {log.erro && (
            <div
              className="flex gap-2 text-xs rounded-xl px-3 py-2"
              style={{ background: 'var(--ag-danger-soft)', color: 'var(--ag-danger)' }}
            >
              <AlertOctagon className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="font-medium">{log.erro}</span>
            </div>
          )}
          {log.tool && (
            <div className="text-[11px] text-[var(--ag-text-3)]">
              ferramenta: <span className="font-mono text-[var(--ag-text-2)]">{log.tool}</span>
            </div>
          )}
          <Json titulo="Enviado" valor={log.requisicao} />
          <Json titulo="Resposta" valor={log.resposta} />
        </div>
      )}
    </div>
  );
};

const LogsPanel: React.FC<Props> = ({ aberto, onFechar, tema }) => {
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

  // Esc fecha, como em qualquer sheet do sistema.
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const falhas = logs.filter((l) => !l.ok).length;

  return (
    <div className="alfreds" data-tema={tema}>
      <div
        onClick={onFechar}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(2,6,23,.35)', backdropFilter: 'blur(6px)' }}
      />
      <aside
        className="ag-sheet-in ag-glass-strong fixed right-0 inset-y-0 z-50 w-full max-w-2xl flex flex-col sm:rounded-l-[28px] overflow-hidden"
        style={{ background: 'var(--ag-surface-solid)', boxShadow: 'var(--ag-shadow-lg)' }}
      >
        <header
          className="h-16 px-5 flex items-center gap-3 shrink-0"
          style={{ borderBottom: '1px solid var(--ag-hairline)' }}
        >
          <div>
            <div className="font-semibold text-[var(--ag-text)] text-[15px] leading-tight">Chamadas à API</div>
            <div className="text-[11px] text-[var(--ag-text-3)] leading-tight">Wake e Tiny, requisição e resposta</div>
          </div>
          {falhas > 0 && (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'var(--ag-danger-soft)', color: 'var(--ag-danger)' }}
            >
              {falhas} {falhas === 1 ? 'falha' : 'falhas'}
            </span>
          )}

          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--ag-text-2)] cursor-pointer">
            <input
              type="checkbox"
              checked={apenasErros}
              onChange={(e) => setApenasErros(e.target.checked)}
              className="rounded accent-[var(--ag-accent)]"
            />
            só erros
          </label>
          <button
            onClick={carregar}
            disabled={carregando}
            className="w-9 h-9 rounded-full grid place-items-center text-[var(--ag-text-3)] hover:text-[var(--ag-text)] disabled:opacity-50 transition-colors"
            style={{ background: 'var(--ag-fill)' }}
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onFechar}
            className="w-9 h-9 rounded-full grid place-items-center text-[var(--ag-text-3)] hover:text-[var(--ag-text)] transition-colors"
            style={{ background: 'var(--ag-fill)' }}
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="ag-scroll flex-1 overflow-y-auto p-4 space-y-2">
          {erro && <div className="text-sm" style={{ color: 'var(--ag-danger)' }}>{erro}</div>}
          {!erro && !logs.length && !carregando && (
            <p className="text-sm text-[var(--ag-text-3)] text-center py-10">
              {apenasErros ? 'Nenhuma falha registrada.' : 'Nenhuma chamada ainda.'}
            </p>
          )}
          {logs.map((l) => <Linha key={l.id} log={l} />)}
        </div>

        <footer
          className="px-5 py-3 text-[11px] text-[var(--ag-text-3)] shrink-0"
          style={{ borderTop: '1px solid var(--ag-hairline)' }}
        >
          Cada linha é uma chamada HTTP real do agente. Imagens em base64 e tokens são omitidos.
        </footer>
      </aside>
    </div>
  );
};

export default LogsPanel;
