// Read-only introspection surface: which providers/tools an account can see,
// and the diagnostic log of Wake/Tiny HTTP calls. Sending messages and
// resolving approvals now live in server/agent/contentAgentChat.ts, which
// serves every provider through the unified LangGraph engine — see
// docs/superpowers/specs/2026-08-31-unified-agent-design.md.

import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { describeTools } from './registry';
import { resolveConnections } from './connections';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

/** users/{uid}.modules.contentAgent or .operationsAgent must be on. */
async function requireAnyModule(uid: string): Promise<void> {
  const snap = await adminDb.collection('users').doc(uid).get();
  const modules = snap.data()?.modules ?? {};
  if (modules.contentAgent !== true && modules.operationsAgent !== true) {
    throw Object.assign(new Error('Nenhum módulo de agente está habilitado nesta conta.'), { status: 403 });
  }
}

const httpStatus = (e: any) => (typeof e?.status === 'number' ? e.status : 500);

export function registerOperationsRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.get('/api/agent/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
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
      await requireAnyModule(uid);
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
      await requireAnyModule(uid);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      let q = adminDb.collection('users').doc(uid).collection('agent_logs')
        .orderBy('at', 'desc').limit(limit);
      const snap = await q.get();
      let logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const threadId = req.query.threadId as string | undefined;
      if (threadId) logs = logs.filter((l: any) => l.threadId === threadId);
      const apenasErros = req.query.erros === '1';
      if (apenasErros) logs = logs.filter((l: any) => !l.ok);
      return res.json({ logs });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
}
