// A conversa do Alfred — mensagens, ações, o "pensando ao vivo" e os envios —
// fora de qualquer tela. Mora no `ConversaAlfredProvider`, montado na raiz do
// App: a aba Alfred (AgentHomeScreen) e o painel lateral da tela de Produtos
// (PainelAlfred) leem a mesma instância. Se o estado morasse na tela, trocar
// de aba no meio de um turno desmontava o hook e o "pensando ao vivo" sumia —
// o servidor seguia trabalhando, mas a tela voltava como se nada rodasse.

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentAction, ThreadMessage, WorkspaceContext } from '../../types/agent';
import {
  ajustarAcao, enviarMensagem, executarAcao, listenActions, listenMessages, rejeitarAcao,
} from '../../services/agentChatService';

type Leitura = { tool: string; ok: boolean; erro?: string };

export interface ConversaAlfred {
  mensagens: ThreadMessage[];
  acoes: Record<string, AgentAction>;
  listaAcoes: AgentAction[];
  parcial: string;
  leituras: Leitura[];
  streaming: boolean;
  erro: string | null;
  setErro: (m: string | null) => void;
  interagiu: boolean;
  enviar: (texto: string, contexto?: WorkspaceContext) => Promise<void>;
  enviarDoComposer: (texto: string) => Promise<void>;
  executar: (id: string) => Promise<void>;
  rejeitar: (id: string) => Promise<void>;
  parar: () => void;
  comecarAjuste: (a: AgentAction) => void;
  iniciarAjuste: (actionId: string) => void;
  etiquetaAjuste: { resumo: string; onCancelar: () => void } | null;
  definirContexto: (c: WorkspaceContext | undefined) => void;
}

interface ConversaInterna {
  conversa: ConversaAlfred;
  /** Telas montadas que reagem a um envio (a aba Alfred troca para o modo conversa). */
  ouvintes: Set<() => void>;
}

const ConversaCtx = createContext<ConversaInterna | null>(null);

/** `uid` vazio = sem usuário ou sem Alfred: nada é escutado. */
export function ConversaAlfredProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const valor = useConversaEstado(uid);
  return createElement(ConversaCtx.Provider, { value: valor }, children);
}

/** `aoEnviar`: a tela que hospeda reage a um envio (a aba Alfred troca para o modo conversa). */
export function useConversaAlfred(opts?: { aoEnviar?: () => void }): ConversaAlfred {
  const ctx = useContext(ConversaCtx);
  if (!ctx) throw new Error('useConversaAlfred fora do ConversaAlfredProvider.');
  const aoEnviarRef = useRef(opts?.aoEnviar);
  aoEnviarRef.current = opts?.aoEnviar;
  const { ouvintes } = ctx;
  useEffect(() => {
    const f = () => aoEnviarRef.current?.();
    ouvintes.add(f);
    return () => { ouvintes.delete(f); };
  }, [ouvintes]);
  return ctx.conversa;
}

function useConversaEstado(uid: string): ConversaInterna {
  const [ouvintes] = useState(() => new Set<() => void>());
  const aoEnviar = () => ouvintes.forEach((f) => f());

  const [mensagens, setMensagens] = useState<ThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, AgentAction>>({});
  const listaAcoes = useMemo(() => Object.values(acoes), [acoes]);
  const [parcial, setParcial] = useState('');
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
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
    if (!uid) return;
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

  // O provider sobrevive a sair e entrar com outra conta: um turno ainda em
  // voo da conta anterior não pode escrever na conversa da nova.
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const handlers = useMemo(() => {
    const daConta = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (uidRef.current === uid) f(...a); };
    return {
    onDelta: daConta((t: string) => setParcial((p) => p + t)),
    onLeitura: daConta((l: Leitura) => setLeituras((p) => [...p, l])),
    // O card em si vem do listener de `agent_actions`; o rascunho de texto
    // (`parcial`) só é limpo quando `mensagens` confirmar que já foi
    // persistido (ver o useEffect de `mensagens` acima) — não aqui.
    onAcao: () => {},
    onErro: daConta((m: string) => { turnoComErroRef.current = true; setErro(m); }),
    onFim: daConta(() => {
      // Se o turno terminou sem erro, a mensagem foi persistida — mantém o
      // ChatThread visível já a partir de agora, sem esperar o snapshot do
      // Firestore chegar (evita o flash de volta pro estado inicial). Se
      // houve erro e nada foi persistido, deixa `interagiu` como estava pra
      // a tela poder voltar à tela inicial (com o banner de erro nela).
      if (!turnoComErroRef.current) setInteragiu(true);
    }),
    };
  }, [uid]);

  const enviar = async (texto: string, contextoNovo?: WorkspaceContext) => {
    // O contexto de um "Pedir ao Alfred" vale para a conversa que ele abriu,
    // não só para a primeira mensagem: "agora gere as descrições deles" tem de
    // saber quem são "eles". Um pedido novo de outra tela o substitui.
    if (contextoNovo) contextoRef.current = contextoNovo;
    aoEnviar();
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    turnoComErroRef.current = false;
    mensagensAoIniciarRef.current = mensagens.length;
    const dono = uid;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await enviarMensagem(texto, handlers, ctrl.signal, contextoRef.current);
    } catch (e: any) {
      if (e?.name !== 'AbortError' && uidRef.current === dono) setErro(e?.message ?? 'Falha ao falar com o agente.');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const responder = async (fn: () => Promise<void>) => {
    const dono = uid;
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    turnoComErroRef.current = false;
    mensagensAoIniciarRef.current = mensagens.length;
    try {
      await fn();
    } catch (e: any) {
      if (uidRef.current === dono) setErro(e?.message ?? 'Falha ao processar a ação.');
    } finally {
      setStreaming(false);
    }
  };

  // "Ajustar no chat" (A3): a próxima mensagem do composer vira o ajuste da
  // proposta pendente, não uma mensagem nova (o grafo está parado no interrupt
  // dela). Vindo da Atividade, o id chega antes das ações carregarem.
  const [ajustandoId, setAjustandoId] = useState<string | null>(null);

  // Troca de conta (ou saída): nada da conversa anterior fica na tela.
  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
    contextoRef.current = undefined;
    setMensagens([]);
    setAcoes({});
    setParcial('');
    setLeituras([]);
    setStreaming(false);
    setErro(null);
    setInteragiu(false);
    setAjustandoId(null);
  }, [uid]);
  const ajustando = ajustandoId ? acoes[ajustandoId] : undefined;
  useEffect(() => {
    if (ajustando && ajustando.status !== 'pending') setAjustandoId(null);
  }, [ajustando]);
  const comecarAjuste = (a: AgentAction) => { aoEnviar(); setAjustandoId(a.id); };
  const iniciarAjuste = (actionId: string) => { aoEnviar(); setAjustandoId(actionId); };
  const enviarDoComposer = (texto: string) => {
    if (ajustando?.status === 'pending') {
      const id = ajustando.id;
      setAjustandoId(null);
      aoEnviar();
      return responder(() => ajustarAcao(id, texto, handlers, contextoRef.current));
    }
    return enviar(texto);
  };
  const etiquetaAjuste = ajustando?.status === 'pending'
    ? { resumo: ajustando.preview.resumo, onCancelar: () => setAjustandoId(null) }
    : null;

  const executar = (id: string) => responder(() => executarAcao(id, handlers, contextoRef.current));
  const rejeitar = (id: string) => responder(() => rejeitarAcao(id, handlers, contextoRef.current));
  const parar = () => { abortRef.current?.abort(); setStreaming(false); };
  const definirContexto = (c: WorkspaceContext | undefined) => { contextoRef.current = c; };

  const conversa: ConversaAlfred = {
    mensagens, acoes, listaAcoes, parcial, leituras, streaming, erro, setErro, interagiu,
    enviar, enviarDoComposer, executar, rejeitar, parar, comecarAjuste, iniciarAjuste, etiquetaAjuste, definirContexto,
  };
  return { conversa, ouvintes };
}
