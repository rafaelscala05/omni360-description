import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clapperboard, Inbox, Menu } from 'lucide-react';
import type { AgentAction } from '../../types/agent';
import type { Product } from '../../types/models';
import { useRodando } from './useRodando';
import type { ItemRodando } from './rodando';
import { executarAcao, listenActions, rejeitarAcao } from '../../services/agentChatService';
import { useAgentTheme } from './theme';
import ActionCard from './chat/ActionCard';

interface Props {
  uid: string;
  onAbrirMenu: () => void;
  /** Leva ao chat — é lá que o Alfred responde depois de uma aprovação. */
  onAbrirAlfred: () => void;
  /** Para dar nome aos vídeos em produção (o job só guarda o id do produto). */
  products?: Product[];
}

type Aba = 'voce' | 'rodando' | 'feito';

const LinhaRodando: React.FC<{ item: ItemRodando }> = ({ item }) => {
  const pct = item.feito !== null && item.total ? Math.round((item.feito / item.total) * 100) : null;
  return (
    <div className="ag-glass rounded-[22px] p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ background: 'var(--ag-blue-soft)', color: 'var(--ag-blue)' }}>
          <Clapperboard className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold text-[var(--ag-text)] truncate">{item.titulo}</div>
          <div className="text-[12.5px]" style={{ color: item.parado ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>
            {item.parado ? 'Sem atualização há mais de 30 min — confira no produto' : item.etapa}
          </div>
        </div>
        {item.feito !== null && item.total !== null && (
          <span className="shrink-0 px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums" style={{ background: 'var(--ag-blue-soft)', color: 'var(--ag-blue)' }}>
            {item.feito} de {item.total}
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--ag-fill-2)' }} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        {pct !== null
          ? <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(pct, 4)}%`, background: 'var(--ag-blue)' }} />
          : <div className="h-full w-1/3 rounded-full ag-indeterminado" style={{ background: 'var(--ag-blue)' }} />}
      </div>
    </div>
  );
};

/**
 * Caixa de entrada única do agente: tudo o que ele pediu para gravar e tudo o
 * que já gravou, venha do chat ou de um botão numa ferramenta. É a resposta
 * para "o que está sendo aprovado e o que já foi feito" sem rolar a conversa.
 */
const AtividadeScreen: React.FC<Props> = ({ uid, onAbrirMenu, onAbrirAlfred, products = [] }) => {
  const { tema } = useAgentTheme();
  const nomes = useMemo(() => new Map(products.map((p) => [p._id, String(p['Descrição'] ?? '')])), [products]);
  const rodando = useRodando(uid, nomes);
  const [acoes, setAcoes] = useState<AgentAction[]>([]);
  const [aba, setAba] = useState<Aba>('voce');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => listenActions(setAcoes), [uid]);

  const pendentes = useMemo(() => acoes.filter((a) => a.status === 'pending').reverse(), [acoes]);
  const historico = useMemo(
    () => acoes
      .filter((a) => a.status !== 'pending')
      .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))
      .slice(0, 50),
    [acoes],
  );

  // A aprovação continua o turno do agente no chat (ele comenta o resultado
  // lá); aqui só importa o erro, o card se atualiza pelo listener.
  const resolver = (fn: typeof executarAcao) => async (id: string) => {
    setErro(null);
    try {
      await fn(id, { onErro: setErro });
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao processar a ação.');
    }
  };

  const lista = aba === 'voce' ? pendentes : historico;
  const vazio = aba === 'rodando' ? rodando.length === 0 : lista.length === 0;

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="ag-aurora flex-1 min-h-0 rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        <header className="shrink-0 px-4 sm:px-6 pt-4 pb-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onAbrirMenu}
              title="Menu"
              className="md:hidden w-9 h-9 rounded-full grid place-items-center shrink-0 text-[var(--ag-text-2)]"
              style={{ background: 'var(--ag-fill)' }}
            >
              <Menu className="w-[18px] h-[18px]" />
            </button>
            <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Atividade</h1>
          </div>

          <div className="grid grid-cols-3 p-[3px] rounded-[14px] max-w-md" style={{ background: 'var(--ag-fill-2)' }} role="tablist">
            {([
              ['voce', `Para você${pendentes.length ? ` · ${pendentes.length}` : ''}`],
              ['rodando', `Rodando${rodando.length ? ` · ${rodando.length}` : ''}`],
              ['feito', 'Feito'],
            ] as [Aba, string][]).map(([id, rotulo]) => (
              <button
                key={id}
                role="tab"
                aria-selected={aba === id}
                onClick={() => setAba(id)}
                className="min-h-[38px] rounded-[11px] text-[13px] font-semibold transition-colors"
                style={aba === id
                  ? { background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', boxShadow: 'var(--ag-shadow-sm)' }
                  : { color: 'var(--ag-text-2)' }}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </header>

        <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 pb-28 md:pb-6">
          <div className="max-w-2xl flex flex-col gap-3">
            {erro && (
              <div
                className="flex items-start gap-2 text-[13px] rounded-2xl px-3.5 py-2.5"
                style={{ background: 'var(--ag-danger-soft)', border: '1px solid var(--ag-hairline)', color: 'var(--ag-danger)' }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{erro}</span>
              </div>
            )}

            {vazio ? (
              <div className="ag-glass rounded-[22px] px-5 py-8 flex flex-col items-center gap-3 text-center">
                <Inbox className="w-6 h-6 text-[var(--ag-text-3)]" />
                <div className="text-[14px] text-[var(--ag-text-2)] max-w-xs">
                  {aba === 'voce'
                    ? 'Nada esperando por você. Quando o Alfred precisar gravar algo, a aprovação aparece aqui.'
                    : aba === 'rodando'
                      ? 'Nada rodando agora. Vídeos em produção aparecem aqui com o progresso.'
                      : 'O Alfred ainda não gravou nada.'}
                </div>
                <button
                  onClick={onAbrirAlfred}
                  className="min-h-[44px] px-5 rounded-full text-[14px] font-semibold"
                  style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
                >
                  Ver a semana
                </button>
              </div>
            ) : aba === 'rodando' ? (
              rodando.map((item) => <LinhaRodando key={item.id} item={item} />)
            ) : (
              lista.map((a) => (
                <ActionCard
                  key={a.id}
                  uid={uid}
                  action={a}
                  onExecutar={resolver(executarAcao)}
                  onRejeitar={resolver(rejeitarAcao)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AtividadeScreen;
