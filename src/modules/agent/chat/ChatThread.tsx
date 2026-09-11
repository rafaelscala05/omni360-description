import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Sparkles, X } from 'lucide-react';
import type { AgentAction, ThreadMessage } from '../../../types/agent';
import ActionCard from './ActionCard';
import Markdown from './Markdown';

interface Props {
  uid: string;
  mensagens: ThreadMessage[];
  acoes: Record<string, AgentAction>;
  parcial: string;
  leituras: { tool: string; ok: boolean; erro?: string }[];
  streaming: boolean;
  erro: string | null;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
}

type Leitura = { tool: string; ok: boolean; erro?: string };

/** Nome técnico da ferramenta em algo legível: `tiny.produto.obter` → "Tiny · produto obter". */
function humanizar(tool: string): string {
  const [provider, ...resto] = tool.split('.');
  const nome = resto.join(' ').replace(/[._]/g, ' ');
  const marca = { wake: 'Wake', tiny: 'Tiny', content: 'Conteúdo', docs: 'Documentação' }[provider] ?? provider;
  return nome ? `${marca} · ${nome}` : marca;
}

/**
 * As leituras que o agente fez num turno, colapsadas numa linha só.
 *
 * Enquanto o turno está em andamento elas abrem sozinhas (é o "pensando ao
 * vivo", o usuário quer ver acontecendo); depois de pronto viram uma linha
 * discreta que não compete com a resposta, mas continua auditável num clique.
 */
const Trilha: React.FC<{ leituras: Leitura[]; aoVivo?: boolean }> = ({ leituras, aoVivo }) => {
  const [aberto, setAberto] = useState(false);
  const falhas = leituras.filter((l) => !l.ok).length;
  const expandido = aoVivo || aberto;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
    >
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className="relative shrink-0 flex items-center" style={{ color: falhas ? 'var(--ag-danger)' : 'var(--ag-ok)' }}>
          <span className="w-[6px] h-[6px] rounded-full bg-current" />
          {aoVivo && <span className="ag-live absolute inset-0" />}
        </span>
        <span className="text-[12px] font-medium text-[var(--ag-text-2)]">
          {aoVivo ? 'Consultando' : 'Consultei'} {leituras.length} {leituras.length === 1 ? 'fonte' : 'fontes'}
          {falhas > 0 && ` · ${falhas} com erro`}
        </span>
        {!aoVivo && (
          <ChevronDown
            className={`w-3.5 h-3.5 ml-auto text-[var(--ag-text-3)] transition-transform ${aberto ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {expandido && (
        <div className="px-3 pb-2.5 space-y-1.5" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          {leituras.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px] pt-1.5" title={l.erro}>
              {l.ok
                ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ag-ok)' }} />
                : <X className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ag-danger)' }} />}
              <span className="text-[var(--ag-text-2)] truncate">{humanizar(l.tool)}</span>
              {l.erro && (
                <span className="truncate max-w-[16rem]" style={{ color: 'var(--ag-danger)' }}>— {l.erro}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Avatar = () => (
  <div
    className="w-8 h-8 rounded-full grid place-items-center shrink-0 ag-glass"
    style={{ boxShadow: '0 0 0 1px var(--ag-hairline), 0 6px 16px -8px var(--ag-accent)' }}
  >
    <Sparkles className="w-[15px] h-[15px]" style={{ color: 'var(--ag-accent)' }} />
  </div>
);

const Pensando = () => (
  <div className="flex items-center gap-2.5 py-1">
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="ag-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ag-accent)' }} />
      ))}
    </span>
    <span className="text-[13px] text-[var(--ag-text-3)]">pensando…</span>
  </div>
);

const ChatThread: React.FC<Props> = ({
  uid, mensagens, acoes, parcial, leituras, streaming, erro, onExecutar, onRejeitar,
}) => {
  const areaRef = useRef<HTMLDivElement>(null);
  const grudarRef = useRef(true);

  // Só rola sozinho se o usuário já estiver no fim — senão atrapalha quem
  // voltou para reler algo enquanto o agente responde.
  const aoRolar = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    grudarRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // scrollTop na própria área, e não `scrollIntoView` no fim da lista: o
  // scrollIntoView rola TODOS os ancestrais roláveis até o elemento aparecer —
  // e um contêiner `overflow: hidden` continua rolável por script. Na prática
  // isso empurrava a barra de título do agente (e, no app, a `main` inteira)
  // para fora da tela na primeira resposta.
  useEffect(() => {
    const el = areaRef.current;
    if (el && grudarRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [mensagens.length, parcial, leituras.length]);

  return (
    <div ref={areaRef} onScroll={aoRolar} className="ag-scroll flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {mensagens.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="ag-rise flex justify-end">
                <div
                  className="max-w-[85%] rounded-[20px] rounded-br-[6px] px-4 py-2.5 text-[15px] leading-[1.5] whitespace-pre-wrap"
                  style={{
                    background: 'var(--ag-accent)',
                    color: 'var(--ag-accent-ink)',
                    boxShadow: '0 8px 22px -12px var(--ag-accent)',
                  }}
                >
                  {m.texto}
                </div>
              </div>
            );
          }

          const cards = (m.actionIds ?? []).map((id) => acoes[id]).filter(Boolean);
          if (!m.texto && !m.leituras?.length && !cards.length) return null;

          return (
            <div key={m.id} className="ag-rise flex gap-3">
              <Avatar />
              <div className="min-w-0 flex-1 space-y-3">
                {!!m.leituras?.length && <Trilha leituras={m.leituras} />}
                {m.texto && <Markdown texto={m.texto} />}
                {cards.map((a) => (
                  <ActionCard key={a.id} uid={uid} action={a} onExecutar={onExecutar} onRejeitar={onRejeitar} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Turno em andamento: leituras + texto que ainda está chegando. */}
        {(streaming || parcial || leituras.length > 0) && (
          <div className="ag-rise flex gap-3">
            <Avatar />
            <div className="min-w-0 flex-1 space-y-3">
              {leituras.length > 0 && <Trilha leituras={leituras} aoVivo={streaming} />}
              {parcial ? <Markdown texto={parcial} /> : streaming && <Pensando />}
            </div>
          </div>
        )}

        {erro && (
          <div className="ag-rise flex gap-3">
            <Avatar />
            <div
              className="flex items-start gap-2 text-[13px] rounded-2xl px-3.5 py-2.5"
              style={{
                background: 'var(--ag-danger-soft)',
                border: '1px solid var(--ag-hairline)',
                color: 'var(--ag-danger)',
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{erro}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default ChatThread;
