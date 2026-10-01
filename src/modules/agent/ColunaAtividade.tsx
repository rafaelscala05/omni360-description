import React, { useMemo } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { AgentAction } from '../../types/agent';
import type { Product } from '../../types/models';
import { useRodando } from './useRodando';
import { feitasHoje } from './rodando';
import { rotuloFerramenta } from './plano';
import ActionCard from './chat/ActionCard';

interface Props {
  uid: string;
  acoes: AgentAction[];
  products: Product[];
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
  onVerAtividade: () => void;
  onVerLogs: () => void;
}

const Bloco: React.FC<{ titulo: string; alerta?: boolean; children: React.ReactNode }> = ({ titulo, alerta, children }) => (
  <section
    className="ag-glass rounded-[24px] p-4 flex flex-col gap-2.5"
    style={alerta ? { borderColor: 'color-mix(in srgb, var(--ag-accent) 35%, transparent)' } : undefined}
  >
    <h2
      className="text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={{ color: alerta ? 'var(--ag-accent)' : 'var(--ag-text-2)' }}
    >
      {titulo}
    </h2>
    {children}
  </section>
);

const Vazio: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[13px] text-[var(--ag-text-3)]">{children}</div>
);

/**
 * Terceira coluna do Alfred no desktop (D1): o que precisa de você, o que está
 * rodando e o que ficou pronto hoje — a Atividade inteira de relance, ao lado
 * da conversa, sem trocar de tela.
 *
 * Só a primeira aprovação aparece inteira (com a amostra e os botões do
 * `ActionCard`); as demais são uma linha que leva à Atividade. Uma coluna de
 * 320px com três cartões de aprovação empilhados empurraria Rodando e Feito
 * para fora da vista.
 */
const ColunaAtividade: React.FC<Props> = ({ uid, acoes, products, onExecutar, onRejeitar, onVerAtividade, onVerLogs }) => {
  const nomes = useMemo(() => new Map(products.map((p) => [p._id, String(p['Descrição'] ?? '')])), [products]);
  const rodando = useRodando(uid, nomes);
  const pendentes = useMemo(
    () => acoes.filter((a) => a.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [acoes],
  );
  const feitas = useMemo(() => feitasHoje(acoes), [acoes]);
  const [primeira, ...outras] = pendentes;

  return (
    <div className="flex flex-col gap-3">
      <Bloco titulo={`Precisa de você${pendentes.length ? ` · ${pendentes.length}` : ''}`} alerta={pendentes.length > 0}>
        {primeira ? (
          <>
            <ActionCard uid={uid} action={primeira} onExecutar={onExecutar} onRejeitar={onRejeitar} />
            {outras.slice(0, 3).map((a) => (
              <button
                key={a.id}
                onClick={onVerAtividade}
                className="min-h-[40px] flex items-center justify-between gap-2 text-left text-[13.5px] text-[var(--ag-text)]"
                style={{ borderTop: '1px solid var(--ag-hairline)' }}
              >
                <span className="truncate">{a.preview.resumo || rotuloFerramenta(a.tool)}</span>
                <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
              </button>
            ))}
            {outras.length > 3 && (
              <button onClick={onVerAtividade} className="text-left text-[13px] font-medium text-[var(--ag-accent)]">
                +{outras.length - 3} na Atividade
              </button>
            )}
          </>
        ) : (
          <Vazio>Nada esperando por você.</Vazio>
        )}
      </Bloco>

      <Bloco titulo="Rodando">
        {rodando.length ? rodando.slice(0, 5).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 text-[14px]">
            <span className="font-semibold text-[var(--ag-text)] truncate">{item.titulo}</span>
            <span className="shrink-0 tabular-nums" style={{ color: item.parado ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>
              {item.parado ? 'parado' : item.feito !== null && item.total ? `${item.feito} de ${item.total}` : item.etapa}
            </span>
          </div>
        )) : <Vazio>Nada rodando agora.</Vazio>}
      </Bloco>

      <Bloco titulo="Feito hoje">
        {feitas.length ? feitas.slice(0, 5).map((a) => (
          <div key={a.id} className="flex items-start gap-2 text-[14px] text-[var(--ag-text)]">
            <Check className="w-4 h-4 mt-0.5 shrink-0 text-[var(--ag-ok)]" />
            <span className="min-w-0 truncate">{a.preview.resumo || rotuloFerramenta(a.tool)}</span>
          </div>
        )) : <Vazio>Nada gravado hoje ainda.</Vazio>}
        <div className="flex items-center justify-between pt-1 text-[13px] font-medium">
          <button onClick={onVerLogs} className="text-[var(--ag-text)] hover:text-[var(--ag-accent)]">Ver como ele trabalhou ›</button>
          {feitas.length > 5 && <button onClick={onVerAtividade} className="text-[var(--ag-text-2)]">Ver tudo</button>}
        </div>
      </Bloco>
    </div>
  );
};

export default ColunaAtividade;
