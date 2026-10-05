import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ScrollText } from 'lucide-react';
import type { Product } from '../../types/models';
import type { ExtrasSemana } from './useSemana';
import type { PedidoAlfred } from '../../types/agent';
import { fetchTools } from '../../services/agentChatService';
import { fetchIntegrationsOverview, desde, type IntegrationSummary } from '../../services/integrationsStatusService';
import { listenProjects } from '../../services/contentService';
import AlfredLogo from '../../components/alfredLogo/AlfredLogo';
import ConnectionsBar, { MARCA, type ConnectionItem } from './ConnectionsBar';
import { useAgentTheme } from './theme';
import { useAlturaTeclado, useTelaLarga, useTelaPequena } from './useViewport';
import ChatThread from './chat/ChatThread';
import Composer from './chat/Composer';
import LogsPanel from './chat/LogsPanel';
import LoteEmAndamento from './chat/LoteEmAndamento';
import { useConversaAlfred } from './useConversaAlfred';
import SemanaPanel from './SemanaPanel';
import ColunaAtividade from './ColunaAtividade';
import { useHistoricoSemana, useSemana } from './useSemana';
import { useEstadoMeli } from './useFontes';
import { entradasDoApp, montarFontes, resumoFontes, type ChaveFonte } from './conectores';
import { proximoPasso, type DestinoTarefa, type TarefaSemana } from './semana';
import { FaixaProximoPasso } from './ProximoPassoBar';
import CabecalhoTarefa from './chat/CabecalhoTarefa';
import { BotaoConta } from '../../components/ContaMenu';

interface Props {
  uid: string;
  credits: number;
  products: Product[];
  /** O que só o App sabe e a semana usa (categorias, vídeo, missões). */
  extras?: ExtrasSemana;
  hasContentAgent: boolean;
  hasOperationsAgent: boolean;
  onOpenIntegrations: () => void;
  /** Tela "Fontes e conectores" — rodapé da semana e o "+" da régua. */
  onAbrirFontes: () => void;
  /** "Ver tudo" da coluna de atividade no desktop. */
  onAbrirAtividade: () => void;
  /** Módulo do otimizador do Mercado Livre — alimenta a semana com propostas. */
  hasMeli: boolean;
  /** Fontes cujo módulo o admin desligou — não aparecem como disponíveis. */
  revogados?: ChaveFonte[];
  /** "Abrir" de uma tarefa da semana: leva à ferramenta dona dela. */
  onAbrirDestino: (destino: DestinoTarefa, tarefa?: TarefaSemana) => void;
  /** Campo focado no telefone — o App esconde a tab bar para o teclado. */
  onFocoChange?: (focado: boolean) => void;
  /** Pedido vindo de outra tela ("Pedir ao Alfred"): enviado ao montar, com o contexto dela. */
  promptInicial?: PedidoAlfred | null;
  onPromptConsumido?: () => void;
}

/** Atalhos curtos abaixo da semana — pedidos que o chat resolve sozinho. */
const SUGESTOES = [
  'Quais banners estão ativos na home da loja?',
  'Como estão os artigos desta semana?',
];

const AgentHomeScreen: React.FC<Props> = ({
  uid, credits, products, extras, hasContentAgent, hasMeli, revogados, onOpenIntegrations, onAbrirFontes, onAbrirAtividade, onAbrirDestino,
  onFocoChange, promptInicial, onPromptConsumido,
}) => {
  const { tema } = useAgentTheme();
  const telaPequena = useTelaPequena();
  // Desktop largo (D1): semana | conversa | atividade lado a lado, sem
  // alternar entre semana e conversa.
  const larga = useTelaLarga();
  const alturaTeclado = useAlturaTeclado();
  const [composerFocado, setComposerFocado] = useState(false);
  // A tela abre na semana mesmo com conversa antiga; mandar algo leva ao chat
  // e o botão do cabeçalho alterna entre os dois.
  // A conversa sobrevive à troca de aba (ver useConversaAlfred): voltando com um
  // turno ainda rodando, a tela reabre nele, não na semana.
  const conversa = useConversaAlfred({ aoEnviar: () => setModo('chat') });
  const [modo, setModo] = useState<'semana' | 'chat'>(() => (conversa.streaming ? 'chat' : 'semana'));
  // Modo foco: só no telefone, e só enquanto o campo está focado. No desktop
  // não há teclado cobrindo nada e recolher a tela seria gratuito.
  const emFoco = telaPequena && composerFocado;
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);
  const [statusCarregando, setStatusCarregando] = useState(true);
  const [ferramentas, setFerramentas] = useState<Record<string, number>>({});
  const [providers, setProviders] = useState<string[]>([]);
  const [projetosCount, setProjetosCount] = useState<number | null>(null);
  const [logsAberto, setLogsAberto] = useState(false);
  const {
    mensagens, acoes, listaAcoes, parcial, leituras, streaming, erro, interagiu,
    enviar, enviarDoComposer, executar, rejeitar, parar, comecarAjuste, etiquetaAjuste,
  } = conversa;
  // Estado real das quatro integrações, para a régua de conexões. Falha de uma
  // não derruba as outras (ver fetchIntegrationsOverview).
  useEffect(() => {
    let vivo = true;
    setStatusCarregando(true);
    fetchIntegrationsOverview()
      .then((lista) => { if (vivo) setIntegracoes(lista); })
      .catch(() => {})
      .finally(() => { if (vivo) setStatusCarregando(false); });
    return () => { vivo = false; };
  }, [uid]);

  // Quantas ferramentas cada plataforma libera — é o que traduz "conectado"
  // em "o agente consegue fazer N coisas aqui".
  useEffect(() => {
    let vivo = true;
    fetchTools()
      .then(({ tools, providers: lista }) => {
        if (!vivo) return;
        setProviders(lista ?? []);
        const contagem: Record<string, number> = {};
        for (const t of tools) contagem[t.provider] = (contagem[t.provider] ?? 0) + 1;
        setFerramentas(contagem);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [uid]);

  useEffect(() => {
    if (!hasContentAgent) return;
    return listenProjects(uid, (list) => setProjetosCount(list.length));
  }, [uid, hasContentAgent]);

  const { tarefas, hoje } = useSemana({
    uid, products, acoes: listaAcoes, integracoes, hasContentAgent, hasMeli, providers, extras,
  });
  // O próximo passo mora logo acima do campo de digitar nesta tela (nas
  // outras, é a barra do topo) — a mesma conta, então nunca discordam.
  const passo = proximoPasso(tarefas, hoje);
  // Só esta tela grava o histórico (Ferramentas e a barra também calculam a semana).
  const semanaPassada = useHistoricoSemana(uid, tarefas, true);

  const focar = (f: boolean) => { setComposerFocado(f); onFocoChange?.(f); };

  // Sair da tela com o campo focado não dispara blur — sem isso a tab bar
  // continuaria escondida na volta.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onFocoChange?.(false), []);

  // Consome antes de enviar: se o envio falhar, voltar à tela não repete o
  // pedido sozinho — o usuário vê o erro e decide.
  useEffect(() => {
    if (!promptInicial) return;
    onPromptConsumido?.();
    setTarefaAtual(null);
    if (promptInicial.ajustarAcaoId) {
      conversa.iniciarAjuste(promptInicial.ajustarAcaoId);
      return;
    }
    void enviar(promptInicial.texto, promptInicial.contexto ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptInicial]);

  // A2: a conversa que nasceu de uma tarefa da semana mostra de qual, no topo.
  const [tarefaAtual, setTarefaAtual] = useState<TarefaSemana | null>(null);
  const fazerTarefa = (prompt: string, t: TarefaSemana) => { setTarefaAtual(t); void enviar(prompt, {}); };
  // Só no desktop: no telefone a semana já abre com essa tarefa no topo, e a
  // faixa disputaria o pouco espaço acima do teclado.
  const faixaPasso = passo && (
    <div className="hidden md:block mb-2">
      <FaixaProximoPasso compacta passo={passo} onAbrir={onAbrirDestino} onPedirAlfred={(p) => fazerTarefa(p, passo)} />
    </div>
  );

  const pendentesPorProvider = useMemo(() => {
    const contagem: Record<string, number> = {};
    for (const a of Object.values(acoes)) {
      if (a.status !== 'pending') continue;
      contagem[a.provider] = (contagem[a.provider] ?? 0) + 1;
    }
    return contagem;
  }, [acoes]);

  const acoesPendentesOperacionais = ['wake', 'tiny', 'bling', 'idworks'].reduce((n, k) => n + (pendentesPorProvider[k] ?? 0), 0);
  const acoesPendentesConteudo = pendentesPorProvider.content ?? 0;
  const pendentesTotal = acoesPendentesOperacionais + acoesPendentesConteudo;

  // A régua junta o estado das quatro plataformas com as ferramentas que cada
  // uma libera e as aprovações paradas nela. Conteúdo entra como um item
  // próprio porque, do ponto de vista do usuário, é mais uma coisa "ligada" ao
  // agente — mesmo não sendo um ERP.
  const itensConexao = useMemo<ConnectionItem[]>(() => {
    const base = integracoes.map<ConnectionItem>((i) => ({
      id: i.chave,
      nome: i.nome,
      papel: i.papel,
      conectado: i.conectado,
      atencao: i.conectado && !i.validado,
      detalhe: i.detalhe,
      rodape: i.conectado && i.ultimaValidacao ? `validada ${desde(i.ultimaValidacao)}` : null,
      ferramentas: ferramentas[i.chave] ?? 0,
      pendentes: pendentesPorProvider[i.chave] ?? 0,
      erro: i.erro,
      glifo: MARCA[i.chave]?.glifo ?? i.nome.slice(0, 1),
      cor: MARCA[i.chave]?.cor ?? 'linear-gradient(135deg,#64748b,#94a3b8)',
    }));

    if (hasContentAgent) {
      base.push({
        id: 'content',
        nome: 'Conteúdo',
        papel: 'Blog e CMS',
        conectado: true,
        detalhe: projetosCount === null ? null : `${projetosCount} ${projetosCount === 1 ? 'projeto' : 'projetos'}`,
        rodape: null,
        ferramentas: ferramentas.content ?? 0,
        pendentes: acoesPendentesConteudo,
        glifo: MARCA.content.glifo,
        cor: MARCA.content.cor,
      });
    }

    return base;
  }, [integracoes, ferramentas, pendentesPorProvider, hasContentAgent, projetosCount, acoesPendentesConteudo]);

  // Rodapé da semana: a mesma conta da tela de fontes, para o "+2 para
  // conectar" bater com a lista que abre. Só depois da primeira checagem —
  // antes disso toda integração pareceria "para conectar".
  const meli = useEstadoMeli(hasMeli);
  const resumoDasFontes = useMemo(() => (statusCarregando || (hasMeli && !meli) ? null : resumoFontes(montarFontes(
    entradasDoApp({ integracoes, meli, hasMeli, hasContentAgent, projetos: projetosCount, revogados }),
  ))), [statusCarregando, integracoes, meli, hasMeli, hasContentAgent, projetosCount, revogados]);

  // `mensagens` só reflete o Firestore quando o listener entrega o snapshot,
  // o que chega depois do fim do SSE — sem `interagiu`, essa janela faz a
  // tela voltar para o estado inicial entre o streaming acabar e a mensagem
  // persistida aparecer.
  const semChat = modo === 'semana' || (mensagens.length === 0 && !streaming && !interagiu);
  const temConversa = mensagens.length > 0 || streaming || interagiu;

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {/* Barra do topo: as conexões (botão que abre a coluna) e, à direita,
            o que só esta tela precisa. Créditos e tema moram no trilho;
            os Logs, na coluna de atividade — no telefone e em telas sem a
            coluna, o atalho dos Logs fica aqui. No telefone ela também
            carrega o avatar da Conta. */}
        <header className="ag-tela-x relative z-20 shrink-0 pt-2.5 sm:pt-3 pb-1 flex items-center gap-2 sm:gap-3">
          <BotaoConta />

          {/* No desktop largo as conexões moram na coluna da direita (card dos Logs). */}
          {!larga && (
            <ConnectionsBar itens={itensConexao} carregando={statusCarregando} onConectar={onOpenIntegrations} onAdicionar={onAbrirFontes} />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {streaming && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[var(--ag-text-3)]">
                <span className="flex items-center gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="ag-dot w-1 h-1 rounded-full" style={{ background: 'var(--ag-accent)' }} />
                  ))}
                </span>
                trabalhando…
              </span>
            )}
            {temConversa && !larga && (
              <button
                onClick={() => setModo(semChat ? 'chat' : 'semana')}
                className="h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-[var(--ag-text)] transition-colors"
                style={{ background: 'var(--ag-fill-2)' }}
              >
                {semChat ? 'Conversa' : 'Semana'}
              </button>
            )}
            {pendentesTotal > 0 && (
              <span
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] font-semibold"
                style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}
              >
                {pendentesTotal} {pendentesTotal === 1 ? 'aprovação' : 'aprovações'}
              </span>
            )}
            {!larga && (
              <button
                onClick={() => setLogsAberto(true)}
                title="Logs — as chamadas feitas às APIs"
                aria-label="Logs"
                className="w-9 h-9 rounded-full grid place-items-center text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
                style={{ background: 'var(--ag-fill)' }}
              >
                <ScrollText className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {larga ? (
          <div className="ag-tela-x flex-1 min-h-0 flex gap-4 pt-3 pb-4">
            <aside className="ag-scroll w-[320px] shrink-0 overflow-y-auto pr-1">
              {/* Sem o rodapé de fontes: as conexões estão na coluna da direita. */}
              <SemanaPanel tarefas={tarefas} hoje={hoje} onFazer={fazerTarefa} onAbrir={onAbrirDestino} semanaPassada={semanaPassada} />
            </aside>

            <div className="flex-1 min-w-0 flex flex-col">
              {tarefaAtual && temConversa && (
                <CabecalhoTarefa tarefa={tarefaAtual} streaming={streaming} pendentes={pendentesTotal} />
              )}
              {temConversa ? (
                <ChatThread
                  uid={uid}
                  mensagens={mensagens}
                  acoes={acoes}
                  parcial={parcial}
                  leituras={leituras}
                  streaming={streaming}
                  erro={erro}
                  onExecutar={executar}
                  onRejeitar={rejeitar}
                  onAjustar={comecarAjuste}
                />
              ) : (
                <div className="ag-scroll flex-1 overflow-y-auto flex flex-col items-center justify-center gap-4 px-6 text-center">
                  {erro && (
                    <div
                      className="w-full max-w-xl flex items-start gap-2 text-[13px] rounded-2xl px-3.5 py-2.5 text-left"
                      style={{ background: 'var(--ag-danger-soft)', border: '1px solid var(--ag-hairline)', color: 'var(--ag-danger)' }}
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}
                  <AlfredLogo size={132} ativo={streaming} marca="malha" rotulo="Alfreds" />
                  <p className="text-[15px] text-[var(--ag-text-2)] max-w-sm">
                    Escolha uma tarefa da semana ou peça qualquer coisa ao Alfred.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                    {SUGESTOES.map((texto) => (
                      <button
                        key={texto}
                        onClick={() => enviar(texto, {})}
                        className="min-h-[36px] px-3.5 rounded-full text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
                        style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
                      >
                        {texto}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Composer
                disabled={false}
                streaming={streaming}
                onEnviar={(t) => { void enviarDoComposer(t); }}
                ajustando={etiquetaAjuste}
                onParar={parar}
                onFoco={focar}
                recuoTeclado={0}
                emFoco={false}
                acima={<>{faixaPasso}<LoteEmAndamento uid={uid} /></>}
              />
            </div>

            <aside className="ag-scroll w-[320px] shrink-0 overflow-y-auto">
              <ColunaAtividade
                uid={uid}
                acoes={listaAcoes}
                products={products}
                onExecutar={executar}
                onRejeitar={rejeitar}
                onVerAtividade={onAbrirAtividade}
                onVerLogs={() => setLogsAberto(true)}
                conexoes={
                  <ConnectionsBar embutida itens={itensConexao} carregando={statusCarregando} onConectar={onOpenIntegrations} onAdicionar={onAbrirFontes} />
                }
              />
            </aside>
          </div>
        ) : (
          <>
            {semChat ? (
              <div className="ag-tela-x ag-scroll flex-1 overflow-y-auto py-6 sm:py-8">
                {/* No modo foco os blocos recolhem para altura zero, mas o `gap` do
                    flex continua valendo e sobra um buraco no topo — por isso ele
                    também zera. */}
                <div
                  className={`max-w-2xl mx-auto flex flex-col items-center text-center ${
                    // No modo foco o que sobra (os atalhos) desce e encosta no
                    // campo, em vez de ficar boiando embaixo do cabeçalho com o
                    // teclado ocupando o resto da tela.
                    emFoco ? 'gap-0 min-h-full justify-end' : 'gap-4'
                  }`}
                >
                  {erro && (
                    <div
                      className="w-full flex items-start gap-2 text-[13px] rounded-2xl px-3.5 py-2.5 text-left"
                      style={{
                        background: 'var(--ag-danger-soft)',
                        border: '1px solid var(--ag-hairline)',
                        color: 'var(--ag-danger)',
                      }}
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}

                  {/* A semana recolhe no modo foco: com o teclado aberto o que
                      importa é o campo, e os atalhos descem para encostar nele. */}
                  <div className="ag-recolhe w-full ag-rise" data-recolhido={emFoco} style={{ maxHeight: 2400 }}>
                    <SemanaPanel tarefas={tarefas} hoje={hoje} onFazer={fazerTarefa} onAbrir={onAbrirDestino} semanaPassada={semanaPassada} fontes={resumoDasFontes} onAbrirFontes={onAbrirFontes} />
                  </div>

                  <div className="ag-scroll-x flex gap-2 w-full overflow-x-auto -mx-1 px-1 pt-1">
                    {SUGESTOES.map((texto) => (
                      <button
                        key={texto}
                        onClick={() => enviar(texto, {})}
                        className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
                        style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
                      >
                        {texto}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {tarefaAtual && (
                  <CabecalhoTarefa tarefa={tarefaAtual} streaming={streaming} pendentes={pendentesTotal} onVoltar={() => setModo('semana')} />
                )}
                <ChatThread
                  uid={uid}
                  mensagens={mensagens}
                  acoes={acoes}
                  parcial={parcial}
                  leituras={leituras}
                  streaming={streaming}
                  erro={erro}
                  onExecutar={executar}
                  onRejeitar={rejeitar}
                  onAjustar={comecarAjuste}
                />
              </>
            )}

            <Composer
              disabled={false}
              streaming={streaming}
              onEnviar={(t) => { void enviarDoComposer(t); }}
              ajustando={etiquetaAjuste}
              onParar={parar}
              onFoco={focar}
              recuoTeclado={alturaTeclado}
              emFoco={emFoco}
              acima={<>{faixaPasso}{modo === 'chat' && <LoteEmAndamento uid={uid} />}</>}
            />
          </>
        )}
      </div>

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} tema={tema} />
    </div>
  );
};

export default AgentHomeScreen;
