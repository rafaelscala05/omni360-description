// A conversa do Alfred — mensagens, ações, o "pensando ao vivo" e os envios —
// fora de qualquer tela. A aba Alfred (AgentHomeScreen) e o painel lateral da
// tela de Produtos (PainelAlfred) usam este mesmo hook sobre a mesma thread:
// o que acontece num lugar aparece no outro.

import { useEffect, useMemo, useRef, useState } from 'react';
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

/** `aoEnviar`: a tela que hospeda reage a um envio (a aba Alfred troca para o modo conversa). */
export function useConversaAlfred(uid: string, opts?: { aoEnviar?: () => void }): ConversaAlfred {
  const aoEnviarRef = useRef(opts?.aoEnviar);
  aoEnviarRef.current = opts?.aoEnviar;
  const aoEnviar = () => aoEnviarRef.current?.();

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

  const handlers = useMemo(() => ({
    onDelta: (t: string) => setParcial((p) => p + t),
    onLeitura: (l: Leitura) => setLeituras((p) => [...p, l]),
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
    aoEnviar();
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

  // "Ajustar no chat" (A3): a próxima mensagem do composer vira o ajuste da
  // proposta pendente, não uma mensagem nova (o grafo está parado no interrupt
  // dela). Vindo da Atividade, o id chega antes das ações carregarem.
  const [ajustandoId, setAjustandoId] = useState<string | null>(null);
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

  return {
    mensagens, acoes, listaAcoes, parcial, leituras, streaming, erro, setErro, interagiu,
    enviar, enviarDoComposer, executar, rejeitar, parar, comecarAjuste, iniciarAjuste, etiquetaAjuste, definirContexto,
  };
}
