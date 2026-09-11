import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, Boxes, Coins, FileText, Moon, ScrollText, Sparkles, Sun, Zap,
} from 'lucide-react';
import type { Product } from '../../types/models';
import type { AgentAction, AgentConnections, ThreadMessage } from '../../types/agent';
import {
  enviarMensagem, executarAcao, fetchConnections, fetchTools, listenActions, listenMessages, rejeitarAcao,
} from '../../services/agentChatService';
import { fetchIntegrationsOverview, desde, type IntegrationSummary } from '../../services/integrationsStatusService';
import { listenProjects } from '../../services/contentService';
import AgentSphere from './AgentSphere';
import ConnectionsBar, { type ConnectionItem } from './ConnectionsBar';
import { useAgentTheme } from './theme';
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
 * Miniatura do agente para a barra de título.
 *
 * Não é a AgentSphere: a malha de 90 nós vira uma bola cinza ilegível abaixo
 * de ~48px, e seriam dois contextos WebGL vivos na mesma página só para
 * desenhar um ponto de 30px (navegadores derrubam o mais antigo passando do
 * limite, que é baixo). O orb é CSS puro e pulsa quando o agente trabalha.
 */
const Orb: React.FC<{ ativo: boolean }> = ({ ativo }) => (
  <span className="relative block w-8 h-8 shrink-0">
    <span
      className="absolute inset-0 rounded-full"
      style={{
        background: 'radial-gradient(circle at 32% 28%, #ffd2b0, var(--ag-accent) 52%, #c23b00 100%)',
        boxShadow: '0 4px 14px -4px var(--ag-accent), inset 0 -2px 6px rgba(0,0,0,.28)',
      }}
    />
    {ativo && (
      <span
        className="ag-live absolute inset-0 rounded-full"
        style={{ color: 'var(--ag-accent)' }}
      />
    )}
  </span>
);

const Cartao: React.FC<{
  icone: React.ReactNode;
  titulo: string;
  valor: React.ReactNode;
  rodape: React.ReactNode;
}> = ({ icone, titulo, valor, rodape }) => (
  <div className="ag-glass ag-sheen rounded-[20px] p-4 text-left shrink-0 min-w-[8.75rem] sm:min-w-0">
    <div className="flex items-center gap-2 mb-2.5">
      {icone}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ag-text-3)]">{titulo}</span>
    </div>
    <div className="text-[26px] leading-none font-semibold text-[var(--ag-text)] tabular-nums">{valor}</div>
    <div className="text-[12px] text-[var(--ag-text-3)] mt-1.5">{rodape}</div>
  </div>
);

/**
 * A esfera é um canvas de lado fixo (o renderer recebe px, não %), então o
 * tamanho tem que vir do JS — 132px ocupa meia tela num telefone de 390px.
 */
function useEsferaPx(): number {
  const [px, setPx] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 96 : 132));
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const aplicar = () => setPx(mq.matches ? 132 : 96);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);
  return px;
}

const AgentHomeScreen: React.FC<Props> = ({
  uid, credits, products, hasContentAgent, hasOperationsAgent, onOpenIntegrations, onManageContent,
}) => {
  const { tema, alternar } = useAgentTheme();
  const esferaPx = useEsferaPx();
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
        className="ag-aurora flex-1 min-h-0 rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        {/* Barra de título — identidade, estado e os controles da superfície. */}
        <header
          className="ag-glass shrink-0 px-3 sm:px-4 py-2.5 flex items-center gap-3"
          style={{ borderBottom: '1px solid var(--ag-hairline)', borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Orb ativo={streaming} />
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

        <div className="px-3 sm:px-4 pt-3 shrink-0">
          <ConnectionsBar itens={itensConexao} carregando={statusCarregando} onConectar={onOpenIntegrations} />
        </div>

        {semChat ? (
          <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 py-8">
            <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6">
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

              <div className="relative ag-rise">
                <div
                  className="absolute inset-0 -z-10 rounded-full blur-3xl"
                  style={{ background: 'var(--ag-aurora-1)', transform: 'scale(1.4)' }}
                />
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

              <div className="ag-scroll-x flex sm:grid sm:grid-cols-3 gap-2.5 sm:gap-3 w-full mt-1 ag-rise overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
                <Cartao
                  icone={<Boxes className="w-4 h-4" style={{ color: 'var(--ag-accent)' }} />}
                  titulo="Produtos"
                  valor={totalProdutos.toLocaleString('pt-BR')}
                  rodape={`${comDescricao}% com descrição`}
                />

                {hasContentAgent && (
                  <Cartao
                    icone={<FileText className="w-4 h-4" style={{ color: 'var(--ag-blue)' }} />}
                    titulo="Conteúdo"
                    valor={projetosCount ?? '—'}
                    rodape={
                      acoesPendentesConteudo > 0 ? (
                        <span style={{ color: 'var(--ag-accent)' }}>
                          {acoesPendentesConteudo} {acoesPendentesConteudo === 1 ? 'ação pendente' : 'ações pendentes'}
                        </span>
                      ) : (
                        <button onClick={onManageContent} className="inline-flex items-center gap-1 hover:text-[var(--ag-text)] transition-colors">
                          gerenciar projetos <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )
                    }
                  />
                )}

                {hasOperationsAgent && (
                  <Cartao
                    icone={<Zap className="w-4 h-4" style={{ color: 'var(--ag-warn)' }} />}
                    titulo="Operações"
                    valor={
                      conns && !conns.wake && !conns.tiny
                        ? <span className="text-[16px]">—</span>
                        : acoesPendentesOperacionais
                    }
                    rodape={
                      conns && !conns.wake && !conns.tiny ? (
                        <button
                          onClick={onOpenIntegrations}
                          className="font-semibold inline-flex items-center gap-1"
                          style={{ color: 'var(--ag-accent)' }}
                        >
                          conectar plataforma <ArrowUpRight className="w-3 h-3" />
                        </button>
                      ) : (
                        `${acoesPendentesOperacionais === 1 ? 'ação pendente' : 'ações pendentes'}`
                      )
                    }
                  />
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-left w-full mt-1 ag-rise">
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

        <Composer disabled={false} streaming={streaming} onEnviar={enviar} onParar={parar} />
      </div>

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} tema={tema} />
    </div>
  );
};

export default AgentHomeScreen;
