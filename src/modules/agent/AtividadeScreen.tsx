import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Inbox, Menu } from 'lucide-react';
import type { AgentAction } from '../../types/agent';
import { executarAcao, listenActions, rejeitarAcao } from '../../services/agentChatService';
import { useAgentTheme } from './theme';
import ActionCard from './chat/ActionCard';

interface Props {
  uid: string;
  onAbrirMenu: () => void;
  /** Leva ao chat — é lá que o Alfred responde depois de uma aprovação. */
  onAbrirAlfred: () => void;
}

type Aba = 'voce' | 'historico';

/**
 * Caixa de entrada única do agente: tudo o que ele pediu para gravar e tudo o
 * que já gravou, venha do chat ou de um botão numa ferramenta. É a resposta
 * para "o que está sendo aprovado e o que já foi feito" sem rolar a conversa.
 */
const AtividadeScreen: React.FC<Props> = ({ uid, onAbrirMenu, onAbrirAlfred }) => {
  const { tema } = useAgentTheme();
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

          <div className="grid grid-cols-2 p-[3px] rounded-[14px] max-w-md" style={{ background: 'var(--ag-fill-2)' }} role="tablist">
            {([
              ['voce', `Para você${pendentes.length ? ` · ${pendentes.length}` : ''}`],
              ['historico', 'Histórico'],
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

            {lista.length === 0 ? (
              <div className="ag-glass rounded-[22px] px-5 py-8 flex flex-col items-center gap-3 text-center">
                <Inbox className="w-6 h-6 text-[var(--ag-text-3)]" />
                <div className="text-[14px] text-[var(--ag-text-2)] max-w-xs">
                  {aba === 'voce'
                    ? 'Nada esperando por você. Quando o Alfred precisar gravar algo, a aprovação aparece aqui.'
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
