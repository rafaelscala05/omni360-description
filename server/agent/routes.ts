// HTTP surface of the Agente Operacional.
//
// The three endpoints that advance a conversation (send, execute, reject) all
// stream Server-Sent Events, because a single user message can fan out into
// several read calls before the model answers, and the user should watch that
// happen instead of staring at a spinner.

import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { describeTools } from './registry';
import { resolveConnections } from './connections';
import { createThread, resumeAfterAction, sendUserMessage, type Emit } from './loop';
import { executeAction, getAction, rejectAction } from './actions';
import type { ThreadAttachment } from './types';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const threadsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_threads');

/** The module is opt-in per account: users/{uid}.modules.operationsAgent === true. */
async function requireModule(uid: string): Promise<void> {
  const snap = await adminDb.collection('users').doc(uid).get();
  if (snap.data()?.modules?.operationsAgent !== true) {
    throw Object.assign(new Error('O módulo Agente Operacional não está habilitado nesta conta.'), { status: 403 });
  }
}

function openSse(res: express.Response): Emit {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable proxy buffering so deltas arrive as they're produced.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

const httpStatus = (e: any) => (typeof e?.status === 'number' ? e.status : 500);

export function registerOperationsRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // --- Read-only metadata --------------------------------------------------

  app.get('/api/agent/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);
      return res.json(await resolveConnections(uid));
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Introspection of the registry. Also the shape a future MCP tools/list
  // returns, which is why it lives here rather than being inlined in the UI.
  app.get('/api/agent/tools', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);
      const conns = await resolveConnections(uid);
      return res.json({ providers: conns.providers, tools: describeTools(conns.providers) });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Diagnóstico: as últimas chamadas HTTP que o agente fez para Wake/Tiny, com
  // requisição, resposta e status. É o que transforma um "Erro ao inserir
  // banner!" da Wake em algo acionável.
  app.get('/api/agent/logs', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      let q = adminDb.collection('users').doc(uid).collection('agent_logs')
        .orderBy('at', 'desc').limit(limit);
      const snap = await q.get();
      let logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Filtro por thread aplicado depois da query: evita exigir um índice
      // composto só para um painel de diagnóstico.
      const threadId = req.query.threadId as string | undefined;
      if (threadId) logs = logs.filter((l: any) => l.threadId === threadId);
      const apenasErros = req.query.erros === '1';
      if (apenasErros) logs = logs.filter((l: any) => !l.ok);
      return res.json({ logs });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // --- Threads -------------------------------------------------------------

  app.get('/api/agent/threads', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);
      const snap = await threadsCol(uid).orderBy('updatedAt', 'desc').limit(50).get();
      return res.json({ threads: snap.docs.map((d) => d.data()) });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  app.post('/api/agent/threads', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);
      const id = await createThread(uid, String(req.body?.titulo ?? ''));
      return res.json({ id });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  app.delete('/api/agent/threads/:id', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);
      const ref = threadsCol(uid).doc(req.params.id);
      const msgs = await ref.collection('messages').get();
      // Small collections (a conversation), so a single batch is enough.
      const batch = adminDb.batch();
      msgs.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(ref);
      await batch.commit();
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // --- Conversation (SSE) --------------------------------------------------

  app.post('/api/agent/threads/:id/messages', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);

      const threadId = req.params.id;
      const exists = (await threadsCol(uid).doc(threadId).get()).exists;
      if (!exists) return res.status(404).json({ message: 'Conversa não encontrada.' });

      const texto = String(req.body?.texto ?? '');
      const anexos: ThreadAttachment[] = Array.isArray(req.body?.anexos)
        ? req.body.anexos
            .filter((a: any) => typeof a?.url === 'string')
            .slice(0, 5)
            .map((a: any) => ({
              url: String(a.url),
              mimeType: String(a.mimeType ?? 'application/octet-stream'),
              nome: String(a.nome ?? 'anexo'),
            }))
        : [];

      emit = openSse(res);
      await sendUserMessage({ uid, threadId, texto, anexos, emit });
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

  // --- Approval ------------------------------------------------------------

  app.post('/api/agent/actions/:id/execute', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireModule(uid);

      const action = await getAction(uid, req.params.id);
      emit = openSse(res);

      const outcome = await executeAction(uid, req.params.id);
      emit('resultado', {
        actionId: action.id,
        status: outcome.action.status,
        result: outcome.result ?? null,
        error: outcome.error ?? null,
      });

      await resumeAfterAction({
        uid,
        threadId: action.threadId,
        action,
        outcome: { ok: !outcome.error, result: outcome.result, error: outcome.error },
        emit,
      });
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
      await requireModule(uid);

      const action = await rejectAction(uid, req.params.id, req.body?.motivo);
      emit = openSse(res);
      emit('resultado', { actionId: action.id, status: 'rejected' });

      await resumeAfterAction({
        uid,
        threadId: action.threadId,
        action,
        outcome: { ok: false, rejeitada: true },
        emit,
      });
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
