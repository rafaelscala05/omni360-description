import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes, Coins, LogOut, Menu, MessageSquarePlus, Plug, ScrollText, Store, Trash2, X, Zap,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import logoAlfreds from '../../assets/brand/logo-alfreds-produtos.png';
import type { AgentAction, AgentConnections, AgentThread, ThreadAttachment, ThreadMessage } from '../../types/agent';
import {
  createThread, deleteThread, enviarMensagem, executarAcao, fetchConnections,
  listThreads, listenActions, listenMessages, rejeitarAcao,
} from '../../services/operationsService';
import ChatThread from './ChatThread';
import Composer from './Composer';
import LogsPanel from './LogsPanel';

interface Props {
  user: User;
  credits: number;
  onSwitchToProduct: () => void;
  onBuyCredits: () => void;
  onLogout: () => void;
}

const SUGESTOES = [
  'Quais banners estão ativos na home?',
  'Sobe esse banner na home e aponta para a categoria de promoções',
  'Qual o preço e o estoque do SKU ABC-123?',
  'Quais pedidos estão aguardando envio?',
];

const OperationsApp: React.FC<Props> = ({ user, credits, onSwitchToProduct, onBuyCredits, onLogout }) => {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<ThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, AgentAction>>({});
  const [conns, setConns] = useState<AgentConnections | null>(null);
  const [parcial, setParcial] = useState('');
  const [leituras, setLeituras] = useState<{ tool: string; ok: boolean; erro?: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [logsAberto, setLogsAberto] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Carga inicial: conexões + lista de conversas.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [c, t] = await Promise.all([fetchConnections(), listThreads()]);
        if (!vivo) return;
        setConns(c);
        setThreads(t);
        setThreadId((prev) => prev ?? t[0]?.id ?? null);
      } catch (e: any) {
        if (vivo) setBloqueio(e?.message ?? 'Não consegui carregar o agente.');
      }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!threadId) { setMensagens([]); setAcoes({}); return; }
    const off1 = listenMessages(threadId, setMensagens);
    const off2 = listenActions(threadId, (list) => {
      setAcoes(Object.fromEntries(list.map((a) => [a.id, a])));
    });
    return () => { off1(); off2(); };
  }, [threadId]);

  const recarregarThreads = useCallback(async () => {
    try { setThreads(await listThreads()); } catch { /* a lista é secundária */ }
  }, []);

  const handlers = useMemo(() => ({
    onDelta: (t: string) => setParcial((p) => p + t),
    onLeitura: (l: { tool: string; ok: boolean; erro?: string }) => setLeituras((p) => [...p, l]),
    // O card chega pelo listener do Firestore; aqui só limpamos o rascunho para
    // não duplicar o texto que já foi persistido na mensagem.
    onAcao: () => { setParcial(''); setLeituras([]); },
    onErro: (m: string) => setErro(m),
    onFim: () => { setParcial(''); setLeituras([]); },
  }), []);

  const novaConversa = async (texto?: string) => {
    const id = await createThread(texto?.slice(0, 60) ?? '');
    setThreadId(id);
    await recarregarThreads();
    return id;
  };

  const enviar = async (texto: string, anexos: ThreadAttachment[]) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const id = threadId ?? (await novaConversa(texto));
      await enviarMensagem(id, texto, anexos, handlers, ctrl.signal);
      await recarregarThreads();
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
    try {
      await fn();
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao processar a ação.');
    } finally {
      setStreaming(false);
    }
  };

  const executar = (id: string) => responder(() => executarAcao(id, handlers));
  const rejeitar = (id: string) => responder(() => rejeitarAcao(id, undefined, handlers));

  const apagar = async (id: string) => {
    await deleteThread(id).catch(() => {});
    if (threadId === id) setThreadId(null);
    await recarregarThreads();
  };

  const parar = () => { abortRef.current?.abort(); setStreaming(false); };

  if (bloqueio) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f7f9fb] px-6">
        <div className="max-w-md text-center space-y-3">
          <Zap className="w-8 h-8 text-[#FF5B03] mx-auto" />
          <h1 className="text-lg font-semibold text-slate-900">Agente Operacional</h1>
          <p className="text-sm text-slate-500">{bloqueio}</p>
          <button onClick={onSwitchToProduct} className="text-sm text-[#FF5B03] font-medium hover:underline">
            Voltar para os Produtos
          </button>
        </div>
      </div>
    );
  }

  const semConexao = conns && !conns.wake && !conns.tiny;

  return (
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
      {sidebar && (
        <div onClick={() => setSidebar(false)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-30 md:hidden" />
      )}

      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-[#0f172a] flex flex-col transition-transform duration-200 ${sidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="px-4 py-4 flex items-center justify-between">
          <img src={logoAlfreds} alt="Alfred's" className="h-7 object-contain" />
          <button onClick={() => setSidebar(false)} className="md:hidden text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-3">
          <button
            onClick={() => { setThreadId(null); setSidebar(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-white bg-white/10 hover:bg-white/15 transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4" /> Nova conversa
          </button>
        </div>

        <nav className="mt-4 px-3 flex-1 overflow-y-auto space-y-0.5">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-lg ${threadId === t.id ? 'bg-[#1e293b]' : 'hover:bg-white/5'}`}
            >
              <button
                onClick={() => { setThreadId(t.id); setSidebar(false); }}
                className={`flex-1 min-w-0 text-left px-3 py-2 text-sm truncate ${threadId === t.id ? 'text-white' : 'text-slate-400'}`}
                title={t.titulo}
              >
                {t.titulo}
              </button>
              <button
                onClick={() => apagar(t.id)}
                className="opacity-0 group-hover:opacity-100 px-2 py-2 text-slate-500 hover:text-red-400 transition-opacity"
                aria-label={`Apagar ${t.titulo}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!threads.length && (
            <p className="px-3 py-2 text-xs text-slate-500">Nenhuma conversa ainda.</p>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-white/5 space-y-1">
          <div className="px-3 py-2 text-xs text-slate-400 space-y-1.5">
            <div className="font-medium text-slate-300">Conectado a</div>
            {conns?.wake && <div className="flex items-center gap-1.5"><Store className="w-3.5 h-3.5" /> Wake Commerce</div>}
            {conns?.tiny && <div className="flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Tiny ERP (v2)</div>}
            {semConexao && <div className="flex items-center gap-1.5 text-amber-400"><Plug className="w-3.5 h-3.5" /> Nenhuma plataforma</div>}
          </div>
          <button onClick={onBuyCredits} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            <Coins className="w-4 h-4" /> {credits} créditos
          </button>
          <button onClick={onSwitchToProduct} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            <Boxes className="w-4 h-4" /> Ir para Produtos
          </button>
          <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 px-4 flex items-center gap-3 border-b border-slate-200 bg-white/70 backdrop-blur">
          <button onClick={() => setSidebar(true)} className="md:hidden text-slate-500"><Menu className="w-5 h-5" /></button>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#FF5B03]" />
            <span className="font-medium text-slate-800 text-sm">Agente Operacional</span>
          </div>
          <span className="hidden sm:inline text-xs text-slate-400 truncate">
            {user.email}
          </span>
          <button
            onClick={() => setLogsAberto(true)}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            title="Ver as chamadas feitas à API da Wake e do Tiny"
          >
            <ScrollText className="w-4 h-4" /> Logs
          </button>
        </header>

        {semConexao ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="max-w-md text-center space-y-3">
              <Plug className="w-8 h-8 text-slate-300 mx-auto" />
              <h2 className="font-semibold text-slate-800">Nenhuma plataforma conectada</h2>
              <p className="text-sm text-slate-500">
                Conecte a Wake Commerce ou o Tiny ERP (v2) em Integrações para o agente
                poder consultar e operar a sua loja.
              </p>
              <button onClick={onSwitchToProduct} className="text-sm text-[#FF5B03] font-medium hover:underline">
                Ir para Integrações
              </button>
            </div>
          </div>
        ) : mensagens.length === 0 && !streaming ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className="max-w-2xl w-full text-center space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-slate-900">O que você quer fazer na loja?</h2>
                <p className="text-sm text-slate-500">
                  Descreva a alteração. Eu confiro como está hoje, mostro exatamente o que vai mudar
                  e só executo depois que você aprovar.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-left">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    onClick={() => enviar(s, [])}
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

        {!semConexao && (
          <Composer disabled={!!bloqueio} streaming={streaming} onEnviar={enviar} onParar={parar} />
        )}
      </main>

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} />
    </div>
  );
};

export default OperationsApp;
