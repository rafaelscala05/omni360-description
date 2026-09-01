import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Boxes, FileText, ScrollText, Store, Zap } from 'lucide-react';
import type { Product } from '../../types/models';
import type { AgentAction, AgentConnections, ThreadMessage } from '../../types/agent';
import {
  enviarMensagem, executarAcao, fetchConnections, listenActions, listenMessages, rejeitarAcao,
} from '../../services/agentChatService';
import { listenProjects } from '../../services/contentService';
import AgentSphere from './AgentSphere';
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

const SUGESTOES = [
  'Gere a descrição dos produtos sem descrição ainda',
  'Quais banners estão ativos na home da loja?',
  'Qual o preço e o estoque do SKU ABC-123?',
  'Crie um artigo novo pra um cluster de conteúdo',
];

const AgentHomeScreen: React.FC<Props> = ({
  uid, credits, products, hasContentAgent, hasOperationsAgent, onOpenIntegrations, onManageContent,
}) => {
  const [mensagens, setMensagens] = useState<ThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, AgentAction>>({});
  const [conns, setConns] = useState<AgentConnections | null>(null);
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

  const acoesPendentesOperacionais = Object.values(acoes)
    .filter((a) => a.status === 'pending' && (a.provider === 'wake' || a.provider === 'tiny')).length;
  const acoesPendentesConteudo = Object.values(acoes)
    .filter((a) => a.status === 'pending' && a.provider === 'content').length;

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
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-end px-1 pb-2">
        <button
          onClick={() => setLogsAberto(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Ver as chamadas feitas à API da Wake e do Tiny"
        >
          <ScrollText className="w-4 h-4" /> Logs
        </button>
      </div>

      <div className="flex-1 min-h-0 relative rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col">
        {semChat ? (
          <div className="flex-1 overflow-y-auto px-6 py-10">
            <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6">
              {erro && (
                <div className="w-full flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 text-left">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{erro}</span>
                </div>
              )}
              <AgentSphere size={132} active={streaming} />
              <div className="space-y-2">
                <h1 className="text-xl font-semibold text-[#141311]">Como posso ajudar hoje?</h1>
                <p className="text-sm text-slate-500 max-w-md">
                  Peça para gerar descrições, escrever um artigo ou executar uma ação no seu ERP —
                  eu mostro exatamente o que vai mudar antes de qualquer alteração.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3 w-full mt-2">
                <div className="rounded-xl border border-slate-200 p-4 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <Boxes className="w-4 h-4 text-[#FF5B03]" />
                    <span className="text-xs font-semibold text-slate-700">Produtos</span>
                  </div>
                  <p className="text-2xl font-semibold text-[#141311]">{totalProdutos.toLocaleString('pt-BR')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{comDescricao}% com descrição</p>
                </div>

                {hasContentAgent && (
                  <div className="rounded-xl border border-slate-200 p-4 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-[#3053FF]" />
                      <span className="text-xs font-semibold text-slate-700">Conteúdo</span>
                    </div>
                    <p className="text-2xl font-semibold text-[#141311]">{projetosCount ?? '—'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {acoesPendentesConteudo > 0 ? `${acoesPendentesConteudo} ação(ões) pendente(s)` : 'projeto(s) de conteúdo'}
                    </p>
                  </div>
                )}

                {hasOperationsAgent && (
                  <div className="rounded-xl border border-slate-200 p-4 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-semibold text-slate-700">Operações</span>
                    </div>
                    {conns && !conns.wake && !conns.tiny ? (
                      <button onClick={onOpenIntegrations} className="text-sm text-[#FF5B03] font-medium hover:underline">
                        Conectar plataforma
                      </button>
                    ) : (
                      <>
                        <p className="text-2xl font-semibold text-[#141311]">{acoesPendentesOperacionais}</p>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          {conns?.wake && <Store className="w-3 h-3" />}
                          {conns?.tiny && <Boxes className="w-3 h-3" />}
                          ação(ões) pendente(s)
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-left w-full mt-2">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    onClick={() => enviar(s)}
                    className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-colors"
                  >
                    {s}
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

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} />
    </div>
  );
};

export default AgentHomeScreen;
