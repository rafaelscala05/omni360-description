// Client do agente unificado (Conteúdo + Operações). Leituras da conversa
// vêm do Firestore em tempo real; tudo que avança a conversa vai por
// /api/agent/*, porque só o servidor pode escrever mensagens e mudar o
// status de uma ação. SSE é só o canal de "pensando ao vivo".
//
// Substitui src/services/operationsService.ts e
// src/services/contentAgentChatService.ts — thread única implícita
// ('principal', mesmo id que server/agent/contentAgentChat.ts usa), sem
// lista de conversas.

import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AgentAction, AgentConnections, AgentLog, AgentToolInfo, ThreadMessage, WorkspaceContext,
} from '../types/agent';

const AGENT_THREAD_ID = 'principal';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

/**
 * Um 200 com HTML significa que a requisição caiu no fallback do SPA, ou seja, a
 * rota de API não existe naquela instância — quase sempre servidor desatualizado,
 * já que `tsx server.ts` não recarrega o backend. Sem este check, o erro chega
 * como "Unexpected token '<'", que não aponta para nada.
 */
function assertJson(resp: Response): void {
  const tipo = resp.headers.get('content-type') ?? '';
  if (!tipo.includes('application/json')) {
    throw new Error(
      `O servidor respondeu ${tipo || 'sem content-type'} em vez de JSON em ${new URL(resp.url).pathname}. `
      + 'A rota provavelmente não existe nesta instância — reinicie o servidor (npm run dev).',
    );
  }
}

async function call<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: await authHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assertJson(resp);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Erro ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const fetchConnections = () => call<AgentConnections>('/api/agent/connections');
export const fetchTools = () => call<{ providers: string[]; tools: AgentToolInfo[] }>('/api/agent/tools');

/** Diagnóstico: últimas chamadas HTTP feitas a Wake/Tiny, com request e response. */
export const fetchLogs = (opts: { apenasErros?: boolean; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.apenasErros) p.set('erros', '1');
  p.set('limit', String(opts.limit ?? 50));
  return call<{ logs: AgentLog[] }>(`/api/agent/logs?${p}`).then((r) => r.logs);
};

// --- Listeners em tempo real -------------------------------------------------

const userCol = (...path: string[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Não autenticado');
  return collection(db, 'users', uid, ...path);
};

export function listenMessages(cb: (msgs: ThreadMessage[]) => void): () => void {
  const q = query(userCol('agent_threads', AGENT_THREAD_ID, 'messages'), orderBy('createdAt'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as ThreadMessage));
  });
}

export function listenActions(cb: (actions: AgentAction[]) => void): () => void {
  const q = query(userCol('agent_actions'), orderBy('createdAt'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as AgentAction));
  });
}

// --- SSE ----------------------------------------------------------------

export interface StreamHandlers {
  onDelta?: (texto: string) => void;
  onLeitura?: (e: { tool: string; ok: boolean; erro?: string }) => void;
  onAcao?: (a: AgentAction) => void;
  onResultado?: (e: { actionId: string; status: string; error?: string | null }) => void;
  onErro?: (msg: string) => void;
  onFim?: () => void;
}

/**
 * POST que responde text/event-stream. EventSource não serve aqui porque só
 * faz GET e não manda o header de autorização, então o stream é lido na mão
 * a partir do corpo da resposta.
 */
async function stream(url: string, body: unknown, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const tipo = resp.headers.get('content-type') ?? '';
    if (!tipo.includes('application/json')) {
      throw new Error(
        `O servidor respondeu ${tipo || 'sem content-type'} em vez de iniciar o stream. `
        + 'A rota provavelmente não existe nesta instância — reinicie o servidor (npm run dev).',
      );
    }
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Erro ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const despachar = (evento: string, dados: string) => {
    let payload: any = {};
    try { payload = JSON.parse(dados); } catch { /* evento sem corpo útil */ }
    switch (evento) {
      case 'delta': h.onDelta?.(payload.texto ?? ''); break;
      case 'leitura': h.onLeitura?.(payload); break;
      case 'acao': h.onAcao?.(payload); break;
      case 'resultado': h.onResultado?.(payload); break;
      case 'erro': h.onErro?.(payload.message ?? 'Falha no agente.'); break;
      case 'fim': h.onFim?.(); break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const evento = frame.match(/^event: (.+)$/m)?.[1];
      const dados = frame.match(/^data: ([\s\S]*)$/m)?.[1];
      if (evento) despachar(evento, dados ?? '{}');
    }
  }
  h.onFim?.();
}

export const enviarMensagem = (
  texto: string,
  h: StreamHandlers,
  signal?: AbortSignal,
  contexto?: WorkspaceContext,
) => stream('/api/agent/messages', { texto, contexto }, h, signal);

export const executarAcao = (actionId: string, h: StreamHandlers, contexto?: WorkspaceContext) =>
  stream(`/api/agent/actions/${actionId}/execute`, { contexto }, h);

export const rejeitarAcao = (actionId: string, h: StreamHandlers, contexto?: WorkspaceContext) =>
  stream(`/api/agent/actions/${actionId}/reject`, { contexto }, h);
