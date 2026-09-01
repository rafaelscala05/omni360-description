// Ponte REST+SSE entre o app principal e o servidor LangGraph.js do Agente
// de Conteúdo — substitui a integração via CopilotKit (removida: os pacotes
// @copilotkit/* não eram um encaixe bom pra este projeto — telemetria
// habilitada por padrão e uma API v2 ainda instável). Mesmo padrão do
// Agente Operacional (server/agent/{loop,actions,routes}.ts): mensagens e
// ações pendentes viram documentos legíveis no Firestore — o frontend
// escuta em tempo real via onSnapshot; SSE é só o canal de "pensando ao
// vivo" durante uma chamada específica.
//
// Diferença-chave em relação ao Operacional: aqui quem decide o próximo
// passo da conversa (chamar ferramenta, pausar pra aprovação, responder) é
// o grafo LangGraph.js rodando num servidor separado
// (server/agent/contentGraph.ts via CONTENT_AGENT_LANGGRAPH_URL), não um
// loop de function-calling manual neste processo. Este módulo só traduz o
// stream nativo do LangGraph.js (stream_mode: messages-tuple + values) em
// eventos SSE + documentos Firestore no mesmo formato do Operacional.

import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { contentThreadRef } from './firestoreCheckpointer';
import { resolveConnections } from './connections';
import type { ToolProvider } from './types';

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_LANGGRAPH_URL || 'http://localhost:8123';
const GRAPH_ID = 'content_agent';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export type Emit = (event: string, data: unknown) => void;

interface PreviewField { campo: string; antes: unknown; depois: unknown; mudou: boolean }
interface ContentActionPreview {
  resumo: string; alvo: string; campos: PreviewField[]; avisos: string[];
  ferramenta?: string; args?: Record<string, unknown>;
}
// Espelha WorkspaceContext em server/agent/contentGraph.ts — o que está
// aberto no workspace agora (ContentAgentPanel.tsx manda isso a cada envio),
// pra o modelo não precisar perguntar o ID de um projeto que o usuário já
// tem na tela.
interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
}

interface ContentAgentAction {
  id: string;
  threadId: string;
  tool: string;
  args: Record<string, unknown>;
  preview: ContentActionPreview;
  status: 'pending' | 'executed' | 'failed' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
  result?: unknown;
  error?: string;
}

interface AgentContext {
  providers: ToolProvider[];
  conexoes: { wake: boolean; tiny: boolean };
}

/**
 * Which tools a user's account can see, combining the per-module opt-in
 * flags (users/{uid}.modules.contentAgent / .operationsAgent) with actual
 * Wake/Tiny connection state. A module being off hides its tools from the
 * model entirely — same principle resolveConnections already applies to
 * unconnected platforms, extended to cover the content/operations split.
 */
async function resolveAgentContext(uid: string): Promise<AgentContext> {
  const userSnap = await adminDb.collection('users').doc(uid).get();
  const modules = (userSnap.data()?.modules ?? {}) as Record<string, boolean>;

  const conns = modules.operationsAgent === true
    ? await resolveConnections(uid)
    : { wake: false, tiny: false, providers: [] as ToolProvider[] };

  const providers: ToolProvider[] = [...conns.providers];
  if (modules.contentAgent === true) providers.push('content');

  return { providers, conexoes: { wake: conns.wake, tiny: conns.tiny } };
}

/** users/{uid}.modules.contentAgent or .operationsAgent must be on — the account needs at least one of the two features this agent covers. */
async function requireAnyModule(uid: string): Promise<void> {
  const snap = await adminDb.collection('users').doc(uid).get();
  const modules = snap.data()?.modules ?? {};
  if (modules.contentAgent !== true && modules.operationsAgent !== true) {
    throw Object.assign(new Error('Nenhum módulo de agente está habilitado nesta conta.'), { status: 403 });
  }
}

const messagesCol = (uid: string, threadId: string) => contentThreadRef(uid, threadId).collection('messages');
const actionsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_actions');

const httpStatus = (e: any) => (typeof e?.status === 'number' ? e.status : 500);

function openSse(res: express.Response): Emit {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

// ---------------------------------------------------------------------------
// Firestore — mensagens e ações (mesmo espírito de loop.ts/actions.ts)
// ---------------------------------------------------------------------------

async function saveMessage(
  uid: string,
  threadId: string,
  msg: {
    role: 'user' | 'model'; texto: string; actionIds?: string[];
    leituras?: { tool: string; ok: boolean; erro?: string }[]; createdAt: string;
  },
): Promise<string> {
  const ref = messagesCol(uid, threadId).doc();
  await ref.set({ ...msg, id: ref.id });
  await contentThreadRef(uid, threadId).update({ updatedAt: msg.createdAt }).catch(() => {});
  return ref.id;
}

async function createAction(input: {
  uid: string; threadId: string; tool: string; args: Record<string, unknown>; preview: ContentActionPreview;
}): Promise<ContentAgentAction> {
  const ref = actionsCol(input.uid).doc();
  const action: ContentAgentAction = {
    id: ref.id,
    threadId: input.threadId,
    tool: input.tool,
    args: input.args,
    preview: input.preview,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await ref.set(action);
  return action;
}

async function getAction(uid: string, actionId: string): Promise<ContentAgentAction> {
  const snap = await actionsCol(uid).doc(actionId).get();
  if (!snap.exists) throw Object.assign(new Error('Ação não encontrada.'), { status: 404 });
  return snap.data() as ContentAgentAction;
}

/**
 * Reivindica uma ação pendente numa transação, igual a actions.ts:claim() do
 * Operacional — evita que um duplo clique (ou duas abas) mande dois resumes
 * pro mesmo interrupt do LangGraph.
 */
async function claimAction(uid: string, actionId: string): Promise<ContentAgentAction> {
  const ref = actionsCol(uid).doc(actionId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('Ação não encontrada.'), { status: 404 });
    const action = snap.data() as ContentAgentAction;
    if (action.status !== 'pending') {
      throw Object.assign(
        new Error(`Esta ação já foi ${action.status === 'executed' ? 'executada' : action.status === 'rejected' ? 'rejeitada' : 'processada'}.`),
        { status: 409 },
      );
    }
    tx.update(ref, { resolvedAt: new Date().toISOString() });
    return action;
  });
}

async function resolveAction(uid: string, actionId: string, patch: Partial<ContentAgentAction>): Promise<void> {
  await actionsCol(uid).doc(actionId).update(patch);
}

// ---------------------------------------------------------------------------
// Cliente HTTP do servidor LangGraph.js
// ---------------------------------------------------------------------------

// content-agent-graph roda com --no-allow-unauthenticated (o grafo confia
// cegamente no uid que chega em config.configurable — quem verifica o token
// Firebase é esta ponte, antes de chamar; então o serviço não pode ficar
// público, senão qualquer um passa um uid alheio). Autenticação
// serviço-a-serviço padrão do Cloud Run: um ID token de curta duração via
// metadata server, com `aud` = URL do serviço de destino. Fora do Cloud Run
// (dev local, `langgraph dev` sem IAM) o metadata server não responde — cai
// no catch e segue sem header, igual antes.
let cachedIdToken: { token: string; exp: number } | null = null;
async function getIdToken(audience: string): Promise<string | null> {
  if (cachedIdToken && cachedIdToken.exp > Date.now()) return cachedIdToken.token;
  try {
    const res = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (!res.ok) return null;
    const token = await res.text();
    // Token do metadata server dura ~1h — 50min de cache é conservador o
    // bastante pra nunca mandar um expirado.
    cachedIdToken = { token, exp: Date.now() + 50 * 60_000 };
    return token;
  } catch {
    return null;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken(CONTENT_AGENT_URL);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function ensureLangGraphThread(threadId: string): Promise<void> {
  const res = await fetch(`${CONTENT_AGENT_URL}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ thread_id: threadId }),
  });
  // 409 = a thread já existe no LangGraph — tudo bem, só usamos ela.
  if (!res.ok && res.status !== 409) {
    throw new Error(`Falha ao preparar a conversa no agente (HTTP ${res.status}).`);
  }
}

interface RunResult {
  interrupted: { value: ContentActionPreview } | null;
  finalText: string;
  lastToolResult: { toolCallId: string; content: string } | null;
  leituras: { tool: string; ok: boolean; erro?: string }[];
}

/**
 * Faz uma chamada de streaming ao LangGraph.js (nova mensagem OU resume de
 * um interrupt) e traduz o stream nativo (stream_mode: messages-tuple +
 * values) em eventos SSE `delta`/`leitura` ao vivo.
 *
 * `messages-tuple` só dá o texto do modelo chegando token a token — o nome de
 * uma tool call ali é o pedido, não o resultado (e pode repetir em vários
 * chunks enquanto os argumentos streamam). O sinal de "terminou de ler" real
 * é uma nova ToolMessage aparecendo num snapshot `values` subsequente (o
 * grafo emite um `values` a cada passo, não só no final) — cada tool call do
 * registro (`toLangChainTools` em registry.ts) devolve texto começando com
 * "Erro ao executar" quando falha, o mesmo sinal que loop.ts usa pro
 * Operacional. A versão final e autoritativa do turno inteiro (texto final,
 * ou um `interrupt()` pausando pra aprovação) vem do ÚLTIMO `values`.
 */
async function streamRun(
  uid: string,
  threadId: string,
  body: { input?: { messages: { role: 'human'; content: string }[] } } | { command: { resume: unknown } },
  emit: Emit,
  contexto?: WorkspaceContext,
): Promise<RunResult> {
  const agentContext = await resolveAgentContext(uid);
  const res = await fetch(`${CONTENT_AGENT_URL}/threads/${threadId}/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      assistant_id: GRAPH_ID,
      config: {
        configurable: {
          uid,
          providers: agentContext.providers,
          conexoes: agentContext.conexoes,
          ...(contexto ? { contexto } : {}),
        },
      },
      stream_mode: ['messages-tuple', 'values'],
      ...body,
    }),
  });

  if (!res.ok || !res.body) {
    const texto = await res.text().catch(() => '');
    throw new Error(`Falha ao falar com o agente (HTTP ${res.status}). ${texto}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastValues: any = null;
  const seenToolCallIds = new Set<string>();
  const leituras: { tool: string; ok: boolean; erro?: string }[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const eventoMatch = frame.match(/^event: (.+)$/m);
      // Ao contrário do SSE que openSse() escreve (2 linhas, sem "id:"), o
      // servidor LangGraph.js emite um "id: N" depois de cada "data:" —
      // por isso aqui o payload precisa parar no fim da própria linha
      // (sem [\s\S], que já capturou "id: N" junto e quebrava o JSON.parse
      // silenciosamente via catch/continue, testado ao vivo).
      const dadosMatch = frame.match(/^data: (.*)$/m);
      if (!eventoMatch || !dadosMatch) continue;
      const evento = eventoMatch[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let dados: any;
      try { dados = JSON.parse(dadosMatch[1]); } catch { continue; }

      if (evento === 'messages') {
        const chunk = Array.isArray(dados) ? dados[0] : null;
        // Só texto de mensagem do MODELO vira delta — testado ao vivo: um
        // ToolMessageChunk (o retorno cru da ferramenta, ex.: um JSON com
        // projectId) também aparece em stream_mode "messages" com
        // content string, e sem o filtro de type ele vazava pro chat como
        // se fosse fala do modelo. content também pode vir como array
        // vazio (não string) num chunk intermediário de tool call — um
        // array vazio é truthy em JS, daí o guard checar o tipo também.
        if (chunk?.type === 'ai' && typeof chunk?.content === 'string' && chunk.content) {
          emit('delta', { texto: chunk.content });
        }
      } else if (evento === 'values') {
        lastValues = dados;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = dados?.messages ?? [];
        for (const m of messages) {
          // ToolMessage carrega o próprio nome da ferramenta em `name` —
          // testado ao vivo — bem mais confiável que reconstruir via
          // tool_call_chunks (que só tem `id` no primeiro chunk streamado).
          if (m.type !== 'tool' || !m.tool_call_id || seenToolCallIds.has(m.tool_call_id)) continue;
          seenToolCallIds.add(m.tool_call_id);
          const tool = m.name ?? 'ferramenta';
          const conteudo = String(m.content ?? '');
          const ok = !conteudo.startsWith('Erro ao executar');
          const item = { tool, ok, ...(ok ? {} : { erro: conteudo }) };
          leituras.push(item);
          emit('leitura', item);
        }
      }
    }
  }

  if (lastValues?.__interrupt__?.length) {
    return { interrupted: { value: lastValues.__interrupt__[0].value }, finalText: '', lastToolResult: null, leituras };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = lastValues?.messages ?? [];
  const finalAi = [...messages].reverse().find((m) => m.type === 'ai' && typeof m.content === 'string' && m.content);
  const toolMsg = [...messages].reverse().find((m) => m.type === 'tool');

  return {
    interrupted: null,
    finalText: finalAi?.content ?? '',
    lastToolResult: toolMsg ? { toolCallId: toolMsg.tool_call_id, content: String(toolMsg.content) } : null,
    leituras,
  };
}

// ---------------------------------------------------------------------------
// Turnos da conversa
// ---------------------------------------------------------------------------

async function afterRun(uid: string, threadId: string, result: RunResult, emit: Emit): Promise<void> {
  if (result.interrupted) {
    const preview = result.interrupted.value;
    const action = await createAction({
      uid, threadId, tool: preview.ferramenta ?? 'desconhecida', args: preview.args ?? {}, preview,
    });
    await saveMessage(uid, threadId, {
      role: 'model', texto: '', actionIds: [action.id],
      ...(result.leituras.length ? { leituras: result.leituras } : {}),
      createdAt: new Date().toISOString(),
    });
    emit('acao', action);
    return;
  }

  await saveMessage(uid, threadId, {
    role: 'model', texto: result.finalText,
    ...(result.leituras.length ? { leituras: result.leituras } : {}),
    createdAt: new Date().toISOString(),
  });
  emit('fim', { texto: result.finalText });
}

async function sendUserMessage(
  uid: string, threadId: string, texto: string, emit: Emit, contexto?: WorkspaceContext,
): Promise<void> {
  await saveMessage(uid, threadId, { role: 'user', texto, createdAt: new Date().toISOString() });
  const result = await streamRun(uid, threadId, { input: { messages: [{ role: 'human', content: texto }] } }, emit, contexto);
  await afterRun(uid, threadId, result, emit);
}

async function resolveAndContinue(
  uid: string, action: ContentAgentAction, aprovado: boolean, emit: Emit, contexto?: WorkspaceContext,
): Promise<void> {
  const result = await streamRun(uid, action.threadId, { command: { resume: { aprovado } } }, emit, contexto);

  const toolResult = result.lastToolResult;
  let status: ContentAgentAction['status'];
  let patch: Partial<ContentAgentAction>;
  if (!aprovado) {
    status = 'rejected';
    patch = { status };
  } else if (toolResult?.content?.startsWith('Erro ao executar')) {
    status = 'failed';
    patch = { status, error: toolResult.content };
  } else {
    status = 'executed';
    let parsed: unknown = toolResult?.content;
    try { parsed = toolResult ? JSON.parse(toolResult.content) : undefined; } catch { /* mantém string crua */ }
    patch = { status, result: parsed };
  }
  await resolveAction(uid, action.id, patch);
  emit('resultado', { actionId: action.id, status, error: patch.error ?? null });

  await afterRun(uid, action.threadId, result, emit);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

const AGENT_THREAD_ID = 'principal';

async function ensureUserThread(uid: string): Promise<void> {
  const ref = contentThreadRef(uid, AGENT_THREAD_ID);
  const snap = await ref.get();
  if (snap.exists) return;
  await ensureLangGraphThread(AGENT_THREAD_ID);
  const now = new Date().toISOString();
  await ref.set({ id: AGENT_THREAD_ID, createdAt: now, updatedAt: now });
}

export function registerContentAgentChatRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/agent/messages', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      await ensureUserThread(uid);

      const texto = String(req.body?.texto ?? '');
      if (!texto.trim()) return res.status(400).json({ message: 'Mensagem vazia.' });
      const contexto = req.body?.contexto as WorkspaceContext | undefined;

      emit = openSse(res);
      await sendUserMessage(uid, AGENT_THREAD_ID, texto, emit, contexto);
      res.end();
    } catch (e: any) {
      if (emit) {
        emit('erro', { message: e?.message ?? 'Falha no agente.' });
        res.end();
      } else {
        res.status(httpStatus(e)).json({ message: e?.message });
      }
    }
  });

  app.post('/api/agent/actions/:id/execute', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const action = await claimAction(uid, req.params.id);
      const contexto = req.body?.contexto as WorkspaceContext | undefined;
      emit = openSse(res);
      await resolveAndContinue(uid, action, true, emit, contexto);
      res.end();
    } catch (e: any) {
      if (emit) {
        emit('erro', { message: e?.message ?? 'Falha ao executar a ação.' });
        res.end();
      } else {
        res.status(httpStatus(e)).json({ message: e?.message });
      }
    }
  });

  app.post('/api/agent/actions/:id/reject', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const action = await claimAction(uid, req.params.id);
      const contexto = req.body?.contexto as WorkspaceContext | undefined;
      emit = openSse(res);
      await resolveAndContinue(uid, action, false, emit, contexto);
      res.end();
    } catch (e: any) {
      if (emit) {
        emit('erro', { message: e?.message ?? 'Falha ao rejeitar a ação.' });
        res.end();
      } else {
        res.status(httpStatus(e)).json({ message: e?.message });
      }
    }
  });
}
