import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, ScrollText } from 'lucide-react';
import CheckDesenhado from '../../components/movimento/CheckDesenhado';
import { itemLista, itemResolvido } from './movimento';
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
  /** As conexões (`ConnectionsBar` embutida), no mesmo card dos Logs. */
  conexoes?: React.ReactNode;
}

const Bloco: React.FC<{ titulo: string; alerta?: boolean; children: React.ReactNode }> = ({ titulo, alerta, children }) => (
  // Sem fundo próprio: o bloco é só um rótulo sobre o que ele agrupa — o
  // `ActionCard` dentro já é um cartão, e cartão dentro de cartão pesa.
  <section className="flex flex-col gap-2.5 px-1">
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
const ColunaAtividade: React.FC<Props> = ({ uid, acoes, products, onExecutar, onRejeitar, onVerAtividade, onVerLogs, conexoes }) => {
  const nomes = useMemo(() => new Map(products.map((p) => [p._id, String(p['Descrição'] ?? '')])), [products]);
  const rodando = useRodando(uid, nomes);
  const pendentes = useMemo(
    () => acoes.filter((a) => a.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [acoes],
  );
  const feitas = useMemo(() => feitasHoje(acoes), [acoes]);
  // O que já estava feito ao abrir aparece pronto; só o que ficou feito agora desenha o check.
  const [feitasIniciais] = React.useState(() => new Set(feitas.map((a) => a.id)));
  const [primeira, ...outras] = pendentes;

  return (
    <div className="flex flex-col gap-3">
      <Bloco titulo={`Precisa de você${pendentes.length ? ` · ${pendentes.length}` : ''}`} alerta={pendentes.length > 0}>
        {/* A aprovação resolvida sai deslizando para a direita — rumo ao "Feito
            hoje" logo abaixo, onde ela reaparece com o check se desenhando. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {primeira && (
            <motion.div key={primeira.id} layout {...itemResolvido}>
              <ActionCard uid={uid} action={primeira} onExecutar={onExecutar} onRejeitar={onRejeitar} />
            </motion.div>
          )}
        </AnimatePresence>
        {primeira ? (
          <>
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
        <AnimatePresence initial={false}>
          {feitas.slice(0, 5).map((a) => (
            <motion.div key={a.id} layout {...itemLista} className="flex items-start gap-2 text-[14px] text-[var(--ag-text)]">
              <CheckDesenhado feito tamanho={16} animarAoMontar={!feitasIniciais.has(a.id)} className="mt-0.5 shrink-0" />
              <span className="min-w-0 truncate">{a.preview.resumo || rotuloFerramenta(a.tool)}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {!feitas.length && <Vazio>Nada gravado hoje ainda.</Vazio>}
        {feitas.length > 5 && (
          <button onClick={onVerAtividade} className="self-start pt-1 text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">Ver tudo</button>
        )}
      </Bloco>

      {/* Logs e conexões num card só: os dois respondem "com o que o Alfred
          está falando e o que ele chamou" — a infraestrutura por trás das
          tarefas, embaixo do que rodou. Os Logs saíram do cabeçalho; as
          conexões, da barra do topo. */}
      <section className="ag-glass rounded-[20px] p-1.5 flex flex-col">
        <button
          onClick={onVerLogs}
          className="min-h-[40px] flex items-center gap-2.5 px-2.5 rounded-[14px] text-left text-[13.5px] text-[var(--ag-text)] hover:bg-[var(--ag-fill)] transition-colors"
        >
          <ScrollText className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
          <span className="flex-1 min-w-0">Logs · chamadas às APIs</span>
          <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
        </button>
        {conexoes && (
          <>
            <div className="mx-2.5 my-1" style={{ borderTop: '1px solid var(--ag-hairline)' }} />
            {conexoes}
          </>
        )}
      </section>
    </div>
  );
};

export default ColunaAtividade;
