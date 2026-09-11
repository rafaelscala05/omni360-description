import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, Boxes, Coins, FileText, Menu, Moon, ScrollText, Sparkles, Sun, Zap,
} from 'lucide-react';
import type { Product } from '../../types/models';
import type { AgentAction, AgentConnections, ThreadMessage } from '../../types/agent';
import {
  enviarMensagem, executarAcao, fetchConnections, fetchTools, listenActions, listenMessages, rejeitarAcao,
} from '../../services/agentChatService';
import { fetchIntegrationsOverview, desde, type IntegrationSummary } from '../../services/integrationsStatusService';
import { listenProjects } from '../../services/contentService';
import AgentSphere from './AgentSphere';
import VoiceOrb from './VoiceOrb';
import ConnectionsBar, { type ConnectionItem } from './ConnectionsBar';
import { useAgentTheme } from './theme';
import { useAlturaTeclado, useTelaPequena } from './useViewport';
import ChatThread from './chat/ChatThread';
import Composer from './chat/Composer';
import LogsPanel from './chat/LogsPanel';

interface Props {
  uid: string;
  credits: number;
  products: Product[];
  hasContentAgent: boolean;
  hasOperationsAgent: boolean;
  onOpenIntegrations: () => void;
  onManageContent: () => void;
  /** Abre o menu lateral — no telefone esta tela não tem barra inferior. */
  onAbrirMenu: () => void;
}

const SUGESTOES: { texto: string; icone: React.ComponentType<{ className?: string }> }[] = [
  { texto: 'Gere a descrição dos produtos sem descrição ainda', icone: Boxes },
  { texto: 'Quais banners estão ativos na home da loja?', icone: Zap },
  { texto: 'Qual o preço e o estoque do SKU ABC-123?', icone: Boxes },
  { texto: 'Crie um artigo novo pra um cluster de conteúdo', icone: FileText },
];

/** Identidade visual de cada plataforma na régua de conexões. */
const MARCA: Record<string, { glifo: string; cor: string }> = {
  wake: { glifo: 'W', cor: 'linear-gradient(135deg,#ff5b03,#ff9a52)' },
  tiny: { glifo: 'T', cor: 'linear-gradient(135deg,#3053ff,#7e94ff)' },
  bling: { glifo: 'B', cor: 'linear-gradient(135deg,#0f9d58,#4ade80)' },
  idworks: { glifo: 'ID', cor: 'linear-gradient(135deg,#828ed1,#b8c0ea)' },
  content: { glifo: 'C', cor: 'linear-gradient(135deg,#7c3aed,#c4b5fd)' },
};

/**
 * Métrica do estado inicial.
 *
 * Era um cartão de vidro com número de 26px. Virou pílula: o número continua
 * legível, mas para de competir com a pergunta — nesta tela o assunto é o
 * campo de digitar, e três cartões grandes empurravam o composer para fora da
 * dobra no telefone.
 */
const Metrica: React.FC<{
  icone: React.ReactNode;
  valor: React.ReactNode;
  rotulo: React.ReactNode;
  onClick?: () => void;
}> = ({ icone, valor, rotulo, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className="flex items-center gap-2 pl-2.5 pr-3.5 py-1.5 rounded-full shrink-0 transition-colors"
      style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
    >
      {icone}
      <span className="text-[13px] font-semibold text-[var(--ag-text)] tabular-nums">{valor}</span>
      <span className="text-[12px] text-[var(--ag-text-3)] whitespace-nowrap">{rotulo}</span>
    </Tag>
  );
};

const AgentHomeScreen: React.FC<Props> = ({
  uid, credits, products, hasContentAgent, hasOperationsAgent, onOpenIntegrations, onManageContent,
  onAbrirMenu,
}) => {
  const { tema, alternar } = useAgentTheme();
  const telaPequena = useTelaPequena();
  const alturaTeclado = useAlturaTeclado();
  const [composerFocado, setComposerFocado] = useState(false);
  // A esfera é um canvas de lado fixo (o renderer recebe px, não %), então o
  // tamanho tem que vir do JS — 132px ocupa meia tela num telefone de 390px.
  const esferaPx = telaPequena ? 96 : 132;
  // Modo foco: só no telefone, e só enquanto o campo está focado. No desktop
  // não há teclado cobrindo nada e recolher a tela seria gratuito.
  const emFoco = telaPequena && composerFocado;
  const [mensagens, setMensagens] = useState<ThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, AgentAction>>({});
  const [conns, setConns] = useState<AgentConnections | null>(null);
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);
  const [statusCarregando, setStatusCarregando] = useState(true);
  const [ferramentas, setFerramentas] = useState<Record<string, number>>({});
  const [projetosCount, setProjetosCount] = useState<number | null>(null);
  const [parcial, setParcial] = useState('');
  const [leituras, setLeituras] = useState<{ tool: string; ok: boolean; erro?: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [logsAberto, setLogsAberto] = useState(false);
  const [interagiu, setInteragiu] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    if (!hasOperationsAgent) return;
    let vivo = true;
    fetchConnections().then((c) => { if (vivo) setConns(c); }).catch(() => {});
    return () => { vivo = false; };
  }, [hasOperationsAgent]);

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
      .then(({ tools }) => {
        if (!vivo) return;
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

  const enviar = async (texto: string) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    turnoComErroRef.current = false;
    mensagensAoIniciarRef.current = mensagens.length;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await enviarMensagem(texto, handlers, ctrl.signal);
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

  const executar = (id: string) => responder(() => executarAcao(id, handlers));
  const rejeitar = (id: string) => responder(() => rejeitarAcao(id, handlers));
  const parar = () => { abortRef.current?.abort(); setStreaming(false); };

  const pendentesPorProvider = useMemo(() => {
    const contagem: Record<string, number> = {};
    for (const a of Object.values(acoes)) {
      if (a.status !== 'pending') continue;
      contagem[a.provider] = (contagem[a.provider] ?? 0) + 1;
    }
    return contagem;
  }, [acoes]);

  const acoesPendentesOperacionais = (pendentesPorProvider.wake ?? 0) + (pendentesPorProvider.tiny ?? 0);
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

  const totalProdutos = products.length;
  const comDescricao = totalProdutos
    ? Math.round((products.filter((p) => !!p['Descrição']?.trim()).length / totalProdutos) * 100)
    : 0;

  // `mensagens` só reflete o Firestore quando o listener entrega o snapshot,
  // o que chega depois do fim do SSE — sem `interagiu`, essa janela faz a
  // tela voltar para o estado inicial entre o streaming acabar e a mensagem
  // persistida aparecer.
  const semChat = mensagens.length === 0 && !streaming && !interagiu;

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
              className={`max-w-3xl mx-auto flex flex-col items-center text-center ${
                // No modo foco o que sobra (os atalhos) desce e encosta no
                // campo, em vez de ficar boiando embaixo do cabeçalho com o
                // teclado ocupando o resto da tela.
                emFoco ? 'gap-0 min-h-full justify-end' : 'gap-5 sm:gap-6'
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

              {/* `pt-7 -mt-5`: o `.ag-recolhe` precisa de `overflow: hidden` para
                  recolher, e sem essa folga no topo ele corta o halo da esfera
                  numa linha reta. A margem negativa devolve o espaço ao layout
                  e zera junto com o resto quando o bloco recolhe. */}
              <div
                className="ag-recolhe flex flex-col items-center gap-5 sm:gap-6 pt-7 -mt-5"
                data-recolhido={emFoco}
                style={{ maxHeight: 640 }}
              >
                <div className="ag-rise">
                  <AgentSphere size={esferaPx} active={streaming} tema={tema} />
                </div>

                <div className="space-y-2 ag-rise">
                  <h1 className="font-display text-[22px] sm:text-[30px] font-semibold text-[var(--ag-text)] tracking-tight">
                    Como posso ajudar hoje?
                  </h1>
                  <p className="text-[14px] text-[var(--ag-text-2)] max-w-md mx-auto leading-relaxed">
                    Peça uma descrição, um artigo ou uma ação no seu ERP — eu mostro exatamente
                    o que vai mudar antes de alterar qualquer coisa.
                  </p>
                </div>
              </div>

              {/* Métricas em pílula, não em cartão: o protagonista da tela é a
                  pergunta que o usuário vai fazer, não o painel. */}
              <div
                className="ag-scroll-x ag-recolhe flex sm:flex-wrap sm:justify-center items-center gap-2 w-full overflow-x-auto -mx-1 px-1"
                data-recolhido={emFoco}
                style={{ maxHeight: 80 }}
              >
                <Metrica
                  icone={<Boxes className="w-3.5 h-3.5" style={{ color: 'var(--ag-accent)' }} />}
                  valor={totalProdutos.toLocaleString('pt-BR')}
                  rotulo={
                    <>
                      produtos
                      <span className="hidden sm:inline"> · {comDescricao}% com descrição</span>
                    </>
                  }
                />

                {hasContentAgent && (
                  <Metrica
                    icone={<FileText className="w-3.5 h-3.5" style={{ color: 'var(--ag-blue)' }} />}
                    valor={projetosCount ?? '—'}
                    rotulo={
                      acoesPendentesConteudo > 0
                        ? `projetos · ${acoesPendentesConteudo} pendente(s)`
                        : <span className="inline-flex items-center gap-1">projetos <ArrowUpRight className="w-3 h-3" /></span>
                    }
                    onClick={onManageContent}
                  />
                )}

                {hasOperationsAgent && (
                  conns && !conns.wake && !conns.tiny ? (
                    <Metrica
                      icone={<Zap className="w-3.5 h-3.5" style={{ color: 'var(--ag-warn)' }} />}
                      valor={<span style={{ color: 'var(--ag-accent)' }}>Conectar</span>}
                      rotulo={<span className="inline-flex items-center gap-1">plataforma <ArrowUpRight className="w-3 h-3" /></span>}
                      onClick={onOpenIntegrations}
                    />
                  ) : (
                    <Metrica
                      icone={<Zap className="w-3.5 h-3.5" style={{ color: 'var(--ag-warn)' }} />}
                      valor={acoesPendentesOperacionais}
                      rotulo={acoesPendentesOperacionais === 1 ? 'ação pendente' : 'ações pendentes'}
                    />
                  )
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-left w-full ag-rise">
                {SUGESTOES.map(({ texto, icone: Icone }) => (
                  <button
                    key={texto}
                    onClick={() => enviar(texto)}
                    className="group ag-glass rounded-[18px] px-4 py-3 flex items-center gap-3 text-left text-[13.5px] text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-all duration-200"
                  >
                    <Icone className="w-4 h-4 shrink-0 text-[var(--ag-text-3)] group-hover:text-[var(--ag-accent)] transition-colors" />
                    <span className="min-w-0">{texto}</span>
                    <Sparkles className="w-3.5 h-3.5 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--ag-accent)' }} />
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
          onEnviar={enviar}
          onParar={parar}
          onFoco={setComposerFocado}
          recuoTeclado={alturaTeclado}
          emFoco={emFoco}
        />
      </div>

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} tema={tema} />
    </div>
  );
};

export default AgentHomeScreen;
