// Client do Agente Operacional.
//
// Leituras da conversa vêm do Firestore em tempo real (as rules dão read ao
// dono); tudo que avança a conversa vai por /api/agent/*, porque só o servidor
// pode escrever mensagens e mudar o status de uma ação.
//
// Mesmo padrão de fetch de src/services/adminService.ts, com um transporte SSE
// a mais para acompanhar o agente pensando.

import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AgentAction, AgentConnections, AgentLog, AgentThread, AgentToolInfo, ThreadAttachment, ThreadMessage,
} from '../types/agent';

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

export const fetchConnections = () => call<AgentConnections>('/api/agent/connections');
export const fetchTools = () => call<{ providers: string[]; tools: AgentToolInfo[] }>('/api/agent/tools');
export const listThreads = () => call<{ threads: AgentThread[] }>('/api/agent/threads').then((r) => r.threads);
export const createThread = (titulo: string) => call<{ id: string }>('/api/agent/threads', 'POST', { titulo }).then((r) => r.id);
export const deleteThread = (id: string) => call<{ ok: boolean }>(`/api/agent/threads/${id}`, 'DELETE');

/** Diagnóstico: últimas chamadas HTTP feitas a Wake/Tiny, com request e response. */
export const fetchLogs = (opts: { apenasErros?: boolean; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.apenasErros) p.set('erros', '1');
  p.set('limit', String(opts.limit ?? 50));
  return call<{ logs: AgentLog[] }>(`/api/agent/logs?${p}`).then((r) => r.logs);
};

// --- Listeners em tempo real -----------------------------------------------

const userCol = (...path: string[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Não autenticado');
  return collection(db, 'users', uid, ...path);
};

export function listenMessages(threadId: string, cb: (msgs: ThreadMessage[]) => void): () => void {
  const q = query(userCol('agent_threads', threadId, 'messages'), orderBy('createdAt'));
  return onSnapshot(q, (snap) => {
    // As mensagens 'function' carregam o resultado das ferramentas para o
    // modelo; não têm nada a mostrar no chat.
    cb(snap.docs.map((d) => d.data() as ThreadMessage).filter((m) => m.role !== 'function'));
  });
}

export function listenActions(threadId: string, cb: (actions: AgentAction[]) => void): () => void {
  const q = query(userCol('agent_actions'), where('threadId', '==', threadId));
  return onSnapshot(q, (snap) => {
    cb(snap.docs
      .map((d) => d.data() as AgentAction)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });
}

export function listenThread(threadId: string, cb: (t: AgentThread | null) => void): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Não autenticado');
  return onSnapshot(doc(db, 'users', uid, 'agent_threads', threadId), (snap) => {
    cb(snap.exists() ? (snap.data() as AgentThread) : null);
  });
}

// --- SSE --------------------------------------------------------------------

export interface StreamHandlers {
  onDelta?: (texto: string) => void;
  onLeitura?: (e: { tool: string; ok: boolean; erro?: string }) => void;
  onAcao?: (a: AgentAction) => void;
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
      case 'aguardando': break; // a ação já chegou pelo evento anterior
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
  anexos: ThreadAttachment[],
  h: StreamHandlers,
  signal?: AbortSignal,
) => stream(`/api/agent/threads/${threadId}/messages`, { texto, anexos }, h, signal);

export const executarAcao = (actionId: string, h: StreamHandlers) =>
  stream(`/api/agent/actions/${actionId}/execute`, {}, h);

export const rejeitarAcao = (actionId: string, motivo: string | undefined, h: StreamHandlers) =>
  stream(`/api/agent/actions/${actionId}/reject`, { motivo }, h);

// --- Upload de anexo --------------------------------------------------------

/** Reaproveita POST /api/upload, o mesmo caminho usado pelas imagens do app. */
export async function uploadAnexo(file: File): Promise<ThreadAttachment> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    fr.readAsDataURL(file);
  });
  const { url } = await call<{ url: string }>('/api/upload', 'POST', {
    imageBase64: base64,
    filename: file.name.replace(/\.[^.]+$/, ''),
  });
  return { url, mimeType: file.type || 'application/octet-stream', nome: file.name };
}
