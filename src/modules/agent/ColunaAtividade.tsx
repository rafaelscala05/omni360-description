// D1 · a coluna da direita do Alfred no desktop: "Precisa de você · Rodando ·
// Feito hoje", ao lado da conversa, em vez de o usuário ter de trocar para a
// aba Atividade. É um resumo — cada linha leva à Atividade, onde estão o
// antes/depois completo e os botões de aprovar (o card do chat também tem).

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Clapperboard, Sparkles } from 'lucide-react';
import type { AgentAction } from '../../types/agent';
import type { Product } from '../../types/models';
import { carregarAutonomia } from './chat/autonomia';
import { useRodando } from './useRodando';

interface Props {
  uid: string;
  acoes: AgentAction[];
  products: Product[];
  onAbrirAtividade: () => void;
}

const Rotulo: React.FC<{ children: React.ReactNode; cor?: string }> = ({ children, cor }) => (
  <span className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: cor ?? 'var(--ag-text-2)' }}>{children}</span>
);

const mesmoDia = (iso: string | undefined, hoje: Date) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth() && d.getDate() === hoje.getDate();
};

const ColunaAtividade: React.FC<Props> = ({ uid, acoes, products, onAbrirAtividade }) => {
  const nomes = useMemo(() => new Map(products.map((p) => [p._id, String(p['Descrição'] ?? '')])), [products]);
  const rodando = useRodando(uid, nomes);
  // Travas fixas vêm do servidor (GET /api/agent/settings), com cache por sessão.
  const [travas, setTravas] = useState<Set<string>>(new Set());
  useEffect(() => { carregarAutonomia().then(({ travas: t }) => setTravas(t)).catch(() => {}); }, []);
  const pendentes = useMemo(() => acoes.filter((a) => a.status === 'pending').reverse(), [acoes]);
  const feitasHoje = useMemo(() => {
    const hoje = new Date();
    return acoes
      .filter((a) => a.status === 'executed' && mesmoDia(a.resolvedAt, hoje))
      .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  }, [acoes]);

  return (
    <aside className="w-[320px] shrink-0 flex flex-col gap-3 overflow-y-auto ag-scroll pr-1">
      <section
        className="ag-glass rounded-[22px] p-4 flex flex-col gap-2"
        style={pendentes.length ? { borderColor: 'color-mix(in srgb, var(--ag-accent) 35%, transparent)' } : undefined}
      >
        <Rotulo cor={pendentes.length ? 'var(--ag-accent)' : undefined}>
          Precisa de você{pendentes.length ? ` · ${pendentes.length}` : ''}
        </Rotulo>
        {pendentes.length === 0 ? (
          <p className="text-[13px] text-[var(--ag-text-2)]">Nada esperando. Antes de gravar qualquer coisa, o Alfred pede aqui.</p>
        ) : (
          pendentes.slice(0, 4).map((a, i) => (
            <button
              key={a.id}
              onClick={onAbrirAtividade}
              className="text-left flex items-center gap-2 py-2 group"
              style={i ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-[var(--ag-text)] leading-snug line-clamp-2">{a.preview.resumo}</div>
                <div className="text-[12px] text-[var(--ag-text-3)] truncate">{a.preview.alvo}</div>
              </div>
              {travas.has(a.tool) && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}>
                  trava fixa
                </span>
              )}
              <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ag-text-3)] group-hover:text-[var(--ag-text)]" />
            </button>
          ))
        )}
        {pendentes.length > 4 && (
          <button onClick={onAbrirAtividade} className="text-left text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">
            + {pendentes.length - 4} na Atividade ›
          </button>
        )}
      </section>

      <section className="ag-glass rounded-[22px] p-4 flex flex-col gap-2">
        <Rotulo>Rodando</Rotulo>
        {rodando.length === 0 ? (
          <p className="text-[13px] text-[var(--ag-text-2)]">Nada em segundo plano agora.</p>
        ) : (
          rodando.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[14px]">
              <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: 'var(--ag-blue-soft)', color: 'var(--ag-blue)' }}>
                {r.tipo === 'lote' ? <Sparkles className="w-3.5 h-3.5" /> : <Clapperboard className="w-3.5 h-3.5" />}
              </span>
              <span className="flex-1 min-w-0 font-semibold text-[var(--ag-text)] truncate">{r.titulo}</span>
              <span className="shrink-0 text-[12.5px] tabular-nums" style={{ color: r.parado ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>
                {r.parado ? 'parado' : r.feito !== null && r.total !== null ? `${r.feito} de ${r.total}` : r.etapa}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="ag-glass rounded-[22px] p-4 flex flex-col gap-2">
        <Rotulo>Feito hoje</Rotulo>
        {feitasHoje.length === 0 ? (
          <p className="text-[13px] text-[var(--ag-text-2)]">O que o Alfred gravar hoje aparece aqui, com recibo.</p>
        ) : (
          feitasHoje.slice(0, 5).map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[14px]">
              <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ag-ok)' }} />
              <span className="flex-1 min-w-0 text-[var(--ag-text)] truncate" title={a.preview.alvo}>{a.preview.resumo}</span>
              <button onClick={onAbrirAtividade} className="shrink-0 text-[12.5px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">
                Recibo
              </button>
            </div>
          ))
        )}
        <button onClick={onAbrirAtividade} className="text-left text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] pt-1">
          Ver toda a atividade ›
        </button>
      </section>
    </aside>
  );
};

export default ColunaAtividade;
