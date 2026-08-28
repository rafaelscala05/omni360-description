// Client do Agente de Conteúdo conversacional. Mesmo padrão de
// src/services/operationsService.ts (Agente Operacional): leituras da
// conversa vêm do Firestore em tempo real, tudo que avança a conversa vai
// por /api/content-agent/*, e SSE é só o canal de "pensando ao vivo".

import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { ContentAgentAction, ContentAgentThread, ContentThreadMessage, WorkspaceContext } from '../types/contentAgent';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

function assertJson(resp: Response): void {
  const tipo = resp.headers.get('content-type') ?? '';
  if (!tipo.includes('application/json')) {
    throw new Error(
      `O servidor respondeu ${tipo || 'sem content-type'} em vez de JSON em ${new URL(resp.url).pathname}. `
      + 'A rota provavelmente não existe nesta instância — reinicie o servidor (npm run dev).',
    );
  }
}

async function call<T>(url: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
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

export const listThreads = () => call<{ threads: ContentAgentThread[] }>('/api/content-agent/threads').then((r) => r.threads);
export const createThread = (titulo: string) => call<{ id: string }>('/api/content-agent/threads', 'POST', { titulo }).then((r) => r.id);
export const deleteThread = (id: string) => call<{ ok: boolean }>(`/api/content-agent/threads/${id}`, 'DELETE');

// --- Listeners em tempo real -----------------------------------------------

const userCol = (...path: string[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Não autenticado');
  return collection(db, 'users', uid, ...path);
};

export function listenMessages(threadId: string, cb: (msgs: ContentThreadMessage[]) => void): () => void {
  const q = query(userCol('content_agent_threads', threadId, 'messages'), orderBy('createdAt'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as ContentThreadMessage));
  });
}

export function listenActions(threadId: string, cb: (actions: ContentAgentAction[]) => void): () => void {
  const q = query(userCol('content_agent_actions'), where('threadId', '==', threadId));
  return onSnapshot(q, (snap) => {
    cb(snap.docs
      .map((d) => d.data() as ContentAgentAction)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });
}

export function listenThread(threadId: string, cb: (t: ContentAgentThread | null) => void): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Não autenticado');
  return onSnapshot(doc(db, 'users', uid, 'content_agent_threads', threadId), (snap) => {
    cb(snap.exists() ? (snap.data() as ContentAgentThread) : null);
  });
}

// --- SSE --------------------------------------------------------------------

export interface StreamHandlers {
  onDelta?: (texto: string) => void;
  onLeitura?: (e: { tool: string; ok: boolean; erro?: string }) => void;
  onAcao?: (a: ContentAgentAction) => void;
  onResultado?: (e: { actionId: string; status: string; error?: string | null }) => void;
  onErro?: (msg: string) => void;
  onFim?: () => void;
}

/**
 * POST que responde text/event-stream. EventSource não serve aqui porque só faz
 * GET e não manda o header de autorização, então o stream é lido na mão a
 * partir do corpo da resposta.
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
    // Frames SSE são separados por linha em branco.
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
  threadId: string,
  texto: string,
  h: StreamHandlers,
  signal?: AbortSignal,
  contexto?: WorkspaceContext,
) => stream(`/api/content-agent/threads/${threadId}/messages`, { texto, contexto }, h, signal);

export const executarAcao = (actionId: string, h: StreamHandlers, contexto?: WorkspaceContext) =>
  stream(`/api/content-agent/actions/${actionId}/execute`, { contexto }, h);

export const rejeitarAcao = (actionId: string, h: StreamHandlers, contexto?: WorkspaceContext) =>
  stream(`/api/content-agent/actions/${actionId}/reject`, { contexto }, h);
