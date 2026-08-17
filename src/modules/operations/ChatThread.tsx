import React, { useEffect, useRef } from 'react';
import { AlertCircle, Bot, Check, Search, X } from 'lucide-react';
import type { AgentAction, ThreadMessage } from '../../types/agent';
import ActionCard from './ActionCard';
import Markdown from './Markdown';

interface Props {
  mensagens: ThreadMessage[];
  acoes: Record<string, AgentAction>;
  parcial: string;
  leituras: { tool: string; ok: boolean; erro?: string }[];
  streaming: boolean;
  erro: string | null;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
}

const Leitura: React.FC<{ tool: string; ok: boolean; erro?: string }> = ({ tool, ok, erro }) => (
  <div className="flex items-center gap-2 text-xs text-slate-400" title={erro}>
    {ok ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-red-400" />}
    <span className="font-mono">{tool}</span>
    {erro && <span className="text-red-400 truncate max-w-xs">— {erro}</span>}
  </div>
);

const Avatar = () => (
  <div className="w-7 h-7 rounded-lg bg-[#FF5B03]/10 flex items-center justify-center shrink-0">
    <Bot className="w-4 h-4 text-[#FF5B03]" />
  </div>
);

const ChatThread: React.FC<Props> = ({
  mensagens, acoes, parcial, leituras, streaming, erro, onExecutar, onRejeitar,
}) => {
  const fimRef = useRef<HTMLDivElement>(null);
  const grudarRef = useRef(true);

  // Só rola sozinho se o usuário já estiver no fim — senão atrapalha quem
  // voltou para reler algo enquanto o agente responde.
  const aoRolar = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    grudarRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (grudarRef.current) fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens.length, parcial, leituras.length]);

  return (
    <div onScroll={aoRolar} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {mensagens.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] space-y-2">
                  {!!m.anexos?.length && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {m.anexos.map((a) => (
                        a.mimeType.startsWith('image/') ? (
                          <img key={a.url} src={a.url} alt={a.nome} className="max-h-40 rounded-lg border border-slate-200" />
                        ) : (
                          <span key={a.url} className="px-2 py-1 rounded bg-slate-100 text-xs text-slate-600">{a.nome}</span>
                        )
                      ))}
                    </div>
                  )}
                  {m.texto && (
                    <div className="bg-slate-100 rounded-2xl rounded-tr-sm px-4 py-2.5 text-[15px] text-slate-800 whitespace-pre-wrap">
                      {m.texto}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          const cards = (m.actionIds ?? []).map((id) => acoes[id]).filter(Boolean);
          if (!m.texto && !m.leituras?.length && !cards.length) return null;

          return (
            <div key={m.id} className="flex gap-3">
              <Avatar />
              <div className="min-w-0 flex-1 space-y-3">
                {!!m.leituras?.length && (
                  <div className="space-y-1">
                    {m.leituras.map((l, i) => <Leitura key={i} tool={l.tool} ok={l.ok} />)}
                  </div>
                )}
                {m.texto && <Markdown texto={m.texto} />}
                {cards.map((a) => (
                  <ActionCard key={a.id} action={a} onExecutar={onExecutar} onRejeitar={onRejeitar} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Turno em andamento: leituras + texto que ainda está chegando. */}
        {(streaming || parcial || leituras.length > 0) && (
          <div className="flex gap-3">
            <Avatar />
            <div className="min-w-0 flex-1 space-y-3">
              {leituras.length > 0 && (
                <div className="space-y-1">
                  {leituras.map((l, i) => <Leitura key={i} {...l} />)}
                </div>
              )}
              {parcial ? (
                <Markdown texto={parcial} />
              ) : streaming && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Search className="w-3.5 h-3.5 animate-pulse" />
                  <span>pensando…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {erro && (
          <div className="flex gap-3">
            <Avatar />
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          </div>
        )}

        <div ref={fimRef} />
      </div>
    </div>
  );
};

export default ChatThread;
