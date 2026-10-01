import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Coins, Menu, Moon, ScrollText, Sun } from 'lucide-react';
import type { Category, Product } from '../../types/models';
import type { AgentAction, PedidoAlfred, ThreadMessage, WorkspaceContext } from '../../types/agent';
import {
  enviarMensagem, executarAcao, fetchTools, listenActions, listenMessages, rejeitarAcao,
} from '../../services/agentChatService';
import { fetchIntegrationsOverview, desde, type IntegrationSummary } from '../../services/integrationsStatusService';
import { listenProjects } from '../../services/contentService';
import VoiceOrb from './VoiceOrb';
import ConnectionsBar, { type ConnectionItem } from './ConnectionsBar';
import { useAgentTheme } from './theme';
import { useAlturaTeclado, useTelaPequena } from './useViewport';
import ChatThread from './chat/ChatThread';
import Composer from './chat/Composer';
import LogsPanel from './chat/LogsPanel';
import LoteEmAndamento from './chat/LoteEmAndamento';
import SemanaPanel from './SemanaPanel';
import { useSemana } from './useSemana';
import type { DestinoTarefa } from './semana';

interface Props {
  uid: string;
  credits: number;
  products: Product[];
  /** Para a semana saber quais produtos têm atributo da categoria por preencher. */
  categories?: Category[];
  hasContentAgent: boolean;
  hasOperationsAgent: boolean;
  onOpenIntegrations: () => void;
  /** Módulo do otimizador do Mercado Livre — alimenta a semana com propostas. */
  hasMeli: boolean;
  /** "Abrir" de uma tarefa da semana: leva à ferramenta dona dela. */
  onAbrirDestino: (destino: DestinoTarefa) => void;
  onAbrirMenu: () => void;
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

/** Identidade visual de cada plataforma na régua de conexões. */
const MARCA: Record<string, { glifo: string; cor: string }> = {
  wake: { glifo: 'W', cor: 'linear-gradient(135deg,#ff5b03,#ff9a52)' },
  tiny: { glifo: 'T', cor: 'linear-gradient(135deg,#3053ff,#7e94ff)' },
  bling: { glifo: 'B', cor: 'linear-gradient(135deg,#0f9d58,#4ade80)' },
  idworks: { glifo: 'ID', cor: 'linear-gradient(135deg,#828ed1,#b8c0ea)' },
  content: { glifo: 'C', cor: 'linear-gradient(135deg,#7c3aed,#c4b5fd)' },
};

const AgentHomeScreen: React.FC<Props> = ({
  uid, credits, products, categories, hasContentAgent, hasMeli, onOpenIntegrations, onAbrirDestino,
  onAbrirMenu, onFocoChange, promptInicial, onPromptConsumido,
}) => {
  const { tema, alternar } = useAgentTheme();
  const telaPequena = useTelaPequena();
  const alturaTeclado = useAlturaTeclado();
  const [composerFocado, setComposerFocado] = useState(false);
  // A tela abre na semana mesmo com conversa antiga; mandar algo leva ao chat
  // e o botão do cabeçalho alterna entre os dois.
  const [modo, setModo] = useState<'semana' | 'chat'>('semana');
  // Modo foco: só no telefone, e só enquanto o campo está focado. No desktop
  // não há teclado cobrindo nada e recolher a tela seria gratuito.
  const emFoco = telaPequena && composerFocado;
  const [mensagens, setMensagens] = useState<ThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, AgentAction>>({});
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);
  const [statusCarregando, setStatusCarregando] = useState(true);
  const [ferramentas, setFerramentas] = useState<Record<string, number>>({});
  const [providers, setProviders] = useState<string[]>([]);
  const [projetosCount, setProjetosCount] = useState<number | null>(null);
  const listaAcoes = useMemo(() => Object.values(acoes), [acoes]);
  const [parcial, setParcial] = useState('');
  const [leituras, setLeituras] = useState<{ tool: string; ok: boolean; erro?: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [logsAberto, setLogsAberto] = useState(false);
  const [interagiu, setInteragiu] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const contextoRef = useRef<WorkspaceContext | undefined>(undefined);
  // Só true durante um turno que teve evento `erro` — usado pra não marcar
  // `interagiu` num turno que falhou sem persistir nenhuma mensagem (ver
  // handlers.onFim). Ref porque é lido e escrito dentro do mesmo ciclo
  // síncrono de despacho dos eventos SSE, antes de qualquer re-render.
  const turnoComErroRef = useRef(false);
  // Quantas mensagens existiam quando o turno atual começou a enviar —
  // usado pra saber quando o Firestore já persistiu o que `parcial`/
  // `leituras` mostram (ver o useEffect logo abaixo).
  const mensagensAoIniciarRef = useRef(0);

  useEffect(() => {
    const off1 = listenMessages(setMensagens);
    const off2 = listenActions((list) => {
      setAcoes(Object.fromEntries(list.map((a) => [a.id, a])));
    });
    return () => { off1(); off2(); };
  }, [uid]);

  // O rascunho local (`parcial`/`leituras`) só deve sumir quando a mensagem
  // persistida equivalente já estiver em `mensagens` — limpar no evento SSE
  // (`acao` no meio do turno, `fim` no final) assume que o Firestore já
  // escreveu aquilo, mas o listener pode demorar bem mais que o SSE
  // (principalmente em long-polling), e nesse intervalo o texto some da
  // tela antes de a versão persistida reaparecer.
  useEffect(() => {
    if (mensagens.length > mensagensAoIniciarRef.current) {
      setParcial('');
      setLeituras([]);
    }
  }, [mensagens]);

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
    uid, products, acoes: listaAcoes, integracoes, hasContentAgent, hasMeli, providers, categories,
  });

  const focar = (f: boolean) => { setComposerFocado(f); onFocoChange?.(f); };

  const handlers = useMemo(() => ({
    onDelta: (t: string) => setParcial((p) => p + t),
    onLeitura: (l: { tool: string; ok: boolean; erro?: string }) => setLeituras((p) => [...p, l]),
    // O card em si vem do listener de `agent_actions`; o rascunho de texto
    // (`parcial`) só é limpo quando `mensagens` confirmar que já foi
    // persistido (ver o useEffect de `mensagens` acima) — não aqui.
    onAcao: () => {},
    onErro: (m: string) => { turnoComErroRef.current = true; setErro(m); },
    onFim: () => {
      // Se o turno terminou sem erro, a mensagem foi persistida — mantém o
      // ChatThread visível já a partir de agora, sem esperar o snapshot do
      // Firestore chegar (evita o flash de volta pro estado inicial). Se
      // houve erro e nada foi persistido, deixa `interagiu` como estava pra
      // a tela poder voltar à tela inicial (com o banner de erro nela).
      if (!turnoComErroRef.current) setInteragiu(true);
    },
  }), []);

  const enviar = async (texto: string, contextoNovo?: WorkspaceContext) => {
    // O contexto de um "Pedir ao Alfred" vale para a conversa que ele abriu,
    // não só para a primeira mensagem: "agora gere as descrições deles" tem de
    // saber quem são "eles". Um pedido novo de outra tela o substitui.
    if (contextoNovo) contextoRef.current = contextoNovo;
    setModo('chat');
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    turnoComErroRef.current = false;
    mensagensAoIniciarRef.current = mensagens.length;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await enviarMensagem(texto, handlers, ctrl.signal, contextoRef.current);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErro(e?.message ?? 'Falha ao falar com o agente.');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const responder = async (fn: () => Promise<void>) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    turnoComErroRef.current = false;
    mensagensAoIniciarRef.current = mensagens.length;
    try {
      await fn();
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao processar a ação.');
    } finally {
      setStreaming(false);
    }
  };

  // Sair da tela com o campo focado não dispara blur — sem isso a tab bar
  // continuaria escondida na volta.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onFocoChange?.(false), []);

  // Consome antes de enviar: se o envio falhar, voltar à tela não repete o
  // pedido sozinho — o usuário vê o erro e decide.
  useEffect(() => {
    if (!promptInicial) return;
    onPromptConsumido?.();
    void enviar(promptInicial.texto, promptInicial.contexto ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptInicial]);

  const executar = (id: string) => responder(() => executarAcao(id, handlers, contextoRef.current));
  const rejeitar = (id: string) => responder(() => rejeitarAcao(id, handlers, contextoRef.current));
  const parar = () => { abortRef.current?.abort(); setStreaming(false); };

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

  // `mensagens` só reflete o Firestore quando o listener entrega o snapshot,
  // o que chega depois do fim do SSE — sem `interagiu`, essa janela faz a
  // tela voltar para o estado inicial entre o streaming acabar e a mensagem
  // persistida aparecer.
  const semChat = modo === 'semana' || (mensagens.length === 0 && !streaming && !interagiu);
  const temConversa = mensagens.length > 0 || streaming || interagiu;

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="ag-aurora flex-1 min-h-0 rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        {/* Barra de título — identidade, estado e os controles da superfície.
            No telefone ela também carrega o menu: esta tela não tem barra
            inferior, para a base da tela ser só do campo de digitar. */}
        <header
          className="ag-glass shrink-0 px-2.5 sm:pl-5 sm:pr-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3"
          style={{ borderBottom: '1px solid var(--ag-hairline)', borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}
        >
          <button
            onClick={onAbrirMenu}
            title="Menu"
            className="md:hidden w-9 h-9 rounded-full grid place-items-center shrink-0 text-[var(--ag-text-2)] transition-colors"
            style={{ background: 'var(--ag-fill)' }}
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <VoiceOrb size={34} ativo={streaming} />
            <div className="min-w-0">
              <div className="font-display text-[15px] font-semibold text-[var(--ag-text)] leading-tight">Alfreds</div>
              <div className="text-[11px] text-[var(--ag-text-3)] leading-tight flex items-center gap-1.5">
                {streaming ? (
                  <>
                    <span className="flex items-center gap-[3px]">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="ag-dot w-1 h-1 rounded-full" style={{ background: 'var(--ag-accent)' }} />
                      ))}
                    </span>
                    trabalhando…
                  </>
                ) : (
                  <>
                    <span className="relative flex items-center" style={{ color: 'var(--ag-ok)' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    </span>
                    pronto
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {temConversa && (
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

            <span
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] font-medium text-[var(--ag-text-2)] tabular-nums"
              style={{ background: 'var(--ag-fill)' }}
              title="Créditos disponíveis"
            >
              <Coins className="w-3.5 h-3.5 text-[var(--ag-text-3)]" />
              {credits}
            </span>

            <button
              onClick={alternar}
              title={tema === 'claro' ? 'Tema escuro' : 'Tema claro'}
              className="w-9 h-9 rounded-full grid place-items-center text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
              style={{ background: 'var(--ag-fill)' }}
            >
              {tema === 'claro' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setLogsAberto(true)}
              title="Ver as chamadas feitas à API da Wake e do Tiny"
              className="h-9 px-3 rounded-full flex items-center gap-1.5 text-[12px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors"
              style={{ background: 'var(--ag-fill)' }}
            >
              <ScrollText className="w-4 h-4" />
              <span className="hidden sm:inline">Logs</span>
            </button>
          </div>
        </header>

        {/* Com o teclado aberto no telefone a régua vira ruído: some para o
            campo ficar com o que sobrou da viewport. */}
        <div className="ag-recolhe px-3 sm:px-4 pt-3 shrink-0" data-recolhido={emFoco} style={{ maxHeight: 220 }}>
          <ConnectionsBar itens={itensConexao} carregando={statusCarregando} onConectar={onOpenIntegrations} />
        </div>

        {semChat ? (
          <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8">
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
                <SemanaPanel tarefas={tarefas} hoje={hoje} onFazer={(t) => enviar(t, {})} onAbrir={onAbrirDestino} />
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
          />
        )}

        <Composer
          disabled={false}
          streaming={streaming}
          onEnviar={(t) => enviar(t)}
          onParar={parar}
          onFoco={focar}
          recuoTeclado={alturaTeclado}
          emFoco={emFoco}
          acima={modo === 'chat' ? <LoteEmAndamento uid={uid} /> : undefined}
        />
      </div>

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} tema={tema} />
    </div>
  );
};

export default AgentHomeScreen;
