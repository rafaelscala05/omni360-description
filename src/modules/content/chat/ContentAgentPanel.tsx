import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, MessageSquarePlus, X } from 'lucide-react';
import type { ContentAgentAction, ContentThreadMessage, WorkspaceContext } from '../../../types/contentAgent';
import {
  createThread, enviarMensagem, executarAcao, listThreads, listenActions, listenMessages, rejeitarAcao,
} from '../../../services/contentAgentChatService';
import ContentChatThread from './ContentChatThread';
import ContentComposer from './ContentComposer';

interface Props {
  uid: string;
  children: ReactNode;
  /** Projeto e artigo atualmente abertos no workspace — mandados a cada
   * envio para o agente saber por padrão de qual projeto o usuário está
   * falando, sem precisar perguntar o ID (que a UI nunca mostra). */
  projeto?: { id: string; nomeEmpresa: string } | null;
  articleId?: string | null;
}

/**
 * Painel docado do Agente de Conteúdo — substitui o CopilotSidebar do
 * CopilotKit. Uma única conversa persistente por usuário (sem troca de
 * thread na v1, ao contrário do Agente Operacional): abre a mais recente, ou
 * cria uma na primeira mensagem. children entra como irmão (o painel é um
 * overlay, não um wrapper de layout).
 */
export function ContentAgentPanel({ uid, children, projeto, articleId }: Props) {
  const [aberto, setAberto] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [carregouThread, setCarregouThread] = useState(false);
  const [mensagens, setMensagens] = useState<ContentThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, ContentAgentAction>>({});
  const [parcial, setParcial] = useState('');
  const [leituras, setLeituras] = useState<{ tool: string; ok: boolean; erro?: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let vivo = true;
    listThreads().then((list) => {
      if (!vivo) return;
      setThreadId(list[0]?.id ?? null);
      setCarregouThread(true);
    }).catch(() => { if (vivo) setCarregouThread(true); });
    return () => { vivo = false; };
  }, [uid]);

  useEffect(() => {
    if (!threadId) { setMensagens([]); setAcoes({}); return; }
    const off1 = listenMessages(threadId, setMensagens);
    const off2 = listenActions(threadId, (list) => {
      setAcoes(Object.fromEntries(list.map((a) => [a.id, a])));
    });
    return () => { off1(); off2(); };
  }, [threadId]);

  const contexto: WorkspaceContext | undefined = projeto
    ? { projetoId: projeto.id, projetoNome: projeto.nomeEmpresa, ...(articleId ? { articleId } : {}) }
    : undefined;

  const handlers = useMemo(() => ({
    onDelta: (t: string) => setParcial((p) => p + t),
    onLeitura: (l: { tool: string; ok: boolean; erro?: string }) => setLeituras((p) => [...p, l]),
    onAcao: () => { setParcial(''); setLeituras([]); },
    onErro: (m: string) => setErro(m),
    onFim: () => { setParcial(''); setLeituras([]); },
  }), []);

  const enviar = async (texto: string) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const id = threadId ?? await createThread(texto.slice(0, 60));
      if (!threadId) setThreadId(id);
      await enviarMensagem(id, texto, handlers, ctrl.signal, contexto);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErro(e?.message ?? 'Falha ao falar com o agente.');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const responder = useCallback(async (fn: () => Promise<void>) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    try {
      await fn();
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao processar a ação.');
    } finally {
      setStreaming(false);
    }
  }, []);

  const executar = useCallback(
    (id: string) => responder(() => executarAcao(id, handlers, contexto)),
    [responder, handlers, contexto],
  );
  const rejeitar = useCallback(
    (id: string) => responder(() => rejeitarAcao(id, handlers, contexto)),
    [responder, handlers, contexto],
  );
  const parar = () => { abortRef.current?.abort(); setStreaming(false); };

  const novaConversa = () => {
    abortRef.current?.abort();
    setThreadId(null);
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(false);
  };

  return (
    <>
      {children}

      {!aberto && (
        <button
          onClick={() => setAberto(true)}
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-orange text-white shadow-lg flex items-center justify-center hover:bg-orange/90 transition-colors"
          title="Abrir o Agente de Conteúdo"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] bg-[#f7f9fb] border-l border-ink/10 shadow-2xl flex flex-col transition-transform duration-200 ${aberto ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="h-14 px-4 flex items-center gap-2 border-b border-ink/10 bg-white shrink-0">
          <Bot className="w-4 h-4 text-orange" />
          <span className="font-medium text-ink text-sm">Agente de Conteúdo</span>
          <button
            onClick={novaConversa}
            title="Nova conversa"
            className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-100 transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAberto(false)}
            title="Fechar"
            className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {!carregouThread ? (
          <div className="flex-1" />
        ) : mensagens.length === 0 && !streaming ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-2">
            <h2 className="text-base font-semibold text-ink">O que você precisa?</h2>
            <p className="text-sm text-slate-500">
              Peça pra criar um cluster, gerar um artigo, revisar SEO ou publicar — eu mostro exatamente
              o que vai mudar antes de qualquer alteração.
            </p>
          </div>
        ) : (
          <ContentChatThread
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

        <ContentComposer disabled={false} streaming={streaming} onEnviar={enviar} onParar={parar} />
      </aside>
    </>
  );
}
