import React, { useEffect, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Product } from '../../types/models';
import type { ExtrasSemana } from './useSemana';
import type { AgentAction } from '../../types/agent';
import { listenActions } from '../../services/agentChatService';
import { fetchIntegrationsOverview, type IntegrationSummary } from '../../services/integrationsStatusService';
import { useAgentTheme } from './theme';
import { useProvidersAlfred, useSemana } from './useSemana';
import { proximoPasso, type DestinoTarefa, type TarefaSemana } from './semana';
import { ORIGEM } from './SemanaPanel';

interface Props {
  uid: string;
  products: Product[];
  /** O que só o App sabe e a semana usa (categorias, vídeo, missões). */
  extras?: ExtrasSemana;
  hasContentAgent: boolean;
  hasMeli: boolean;
  onAbrir: (destino: DestinoTarefa, tarefa?: TarefaSemana) => void;
  onPedirAlfred: (prompt: string) => void;
}

/**
 * Barra "Próximo passo" do desktop: uma única ação, a mais valiosa agora, em
 * qualquer tela — o princípio 1 do conselho de design. Usa a mesma conta da
 * semana (proximoPasso), para a barra, a semana e o topo de Ferramentas nunca
 * discordarem. No telefone quem cumpre esse papel é a própria semana, então a
 * barra só existe de `md` para cima.
 */
const ProximoPassoBar: React.FC<Props> = ({ uid, products, extras, hasContentAgent, hasMeli, onAbrir, onPedirAlfred }) => {
  const { tema } = useAgentTheme();
  const [acoes, setAcoes] = useState<AgentAction[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);

  useEffect(() => listenActions(setAcoes), [uid]);
  useEffect(() => {
    let vivo = true;
    fetchIntegrationsOverview().then((l) => { if (vivo) setIntegracoes(l); }).catch(() => {});
    return () => { vivo = false; };
  }, [uid]);

  const providers = useProvidersAlfred(uid, true);
  const { tarefas, hoje } = useSemana({ uid, products, acoes, integracoes, hasContentAgent, hasMeli, providers, extras });
  const passo = proximoPasso(tarefas, hoje);
  if (!passo) return null;

  return (
    // Sem fundo externo: a barra fica sobre a aurora do app, sem faixa clara em volta.
    <div className="hidden md:block px-6 pt-4">
      <div className="alfreds" data-tema={tema}>
        <FaixaProximoPasso passo={passo} onAbrir={onAbrir} onPedirAlfred={onPedirAlfred} />
      </div>
    </div>
  );
};

/**
 * A faixa em si, sem hooks: a barra do topo (telas fora do Alfred) e a tela do
 * Alfred, que a mostra logo acima do campo de digitar e já tem a semana
 * calculada. Tokens `--ag-*`: quem monta abre o escopo `.alfreds`.
 */
export const FaixaProximoPasso: React.FC<{
  passo: TarefaSemana;
  onAbrir: (destino: DestinoTarefa, tarefa?: TarefaSemana) => void;
  onPedirAlfred: (prompt: string) => void;
  compacta?: boolean;
}> = ({ passo, onAbrir, onPedirAlfred, compacta = false }) => (
  <div
    className={`rounded-[20px] pl-5 pr-2 flex items-center gap-4 ${compacta ? 'py-1.5' : 'py-2'}`}
    style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)', boxShadow: 'var(--ag-shadow-sm)' }}
  >
    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] shrink-0" style={{ color: 'var(--ag-accent)' }}>
      Próximo passo
    </span>
    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ORIGEM[passo.origem].cor }} aria-hidden />
    <span className="flex-1 min-w-0 text-[14px] font-medium truncate" title={passo.titulo}>{passo.titulo}</span>
    {passo.prompt && (
      <button
        onClick={() => onPedirAlfred(passo.prompt!)}
        className={`shrink-0 px-4 rounded-full flex items-center gap-1.5 text-[13.5px] font-semibold ${compacta ? 'min-h-[34px]' : 'min-h-[40px]'}`}
        style={{ background: 'color-mix(in srgb, var(--ag-bg-2) 16%, transparent)', color: 'var(--ag-bg-2)' }}
      >
        <Sparkles className="w-4 h-4" /> Pedir ao Alfred
      </button>
    )}
    <button
      onClick={() => onAbrir(passo.destino, passo)}
      className={`shrink-0 px-4 rounded-full flex items-center gap-1.5 text-[13.5px] font-semibold ${compacta ? 'min-h-[34px]' : 'min-h-[40px]'}`}
      style={{ background: 'var(--ag-bg-2)', color: 'var(--ag-text)' }}
    >
      {passo.estado === 'precisa' ? 'Revisar agora' : 'Resolver agora'} <ArrowRight className="w-4 h-4" />
    </button>
  </div>
);

export default ProximoPassoBar;
