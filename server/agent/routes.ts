// Read-only introspection surface: which providers/tools an account can see,
// and the diagnostic log of Wake/Tiny HTTP calls. Sending messages and
// resolving approvals now live in server/agent/contentAgentChat.ts, which
// serves every provider through the unified LangGraph engine — see
// docs/superpowers/specs/2026-08-31-unified-agent-design.md.

import type express from 'express';
// Registra as ferramentas neste processo também: sem isto /api/agent/tools
// listava zero ferramentas e a aprovação de lote não acharia o execute().
import './tools/index';
import { adminDb } from '../firebaseAdmin';
import { describeTools } from './registry';
import { agentSettingsRef, loadAgentSettings, resolveAgentContext, requireAnyModule } from './connections';
import { alwaysAskTools, sanitizeSettings } from './agentSettings';
import { numerosDaLoja } from './numeros';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const httpStatus = (e: any) => (typeof e?.status === 'number' ? e.status : 500);

export function registerOperationsRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.get('/api/agent/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const ctx = await resolveAgentContext(uid);
      return res.json({ wake: ctx.conexoes.wake, tiny: ctx.conexoes.tiny, providers: ctx.providers });
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
      const ctx = await resolveAgentContext(uid);
      return res.json({ providers: ctx.providers, tools: describeTools(ctx.providers) });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Autonomia por ferramenta. Gravado pelo servidor (sanitizeSettings) e não
  // direto pelo cliente, para uma trava fixa nunca aparecer como automática.
  app.get('/api/agent/settings', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      return res.json({ settings: await loadAgentSettings(uid), travas: alwaysAskTools() });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  app.put('/api/agent/settings', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const settings = sanitizeSettings(req.body?.settings);
      await agentSettingsRef(uid).set({ ...settings, updatedAt: new Date().toISOString() });
      return res.json({ settings, travas: alwaysAskTools() });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Diagnóstico: as últimas chamadas HTTP que o agente fez para Wake/Tiny, com
  // requisição, resposta e status. É o que transforma um "Erro ao inserir
  // banner!" da Wake em algo acionável.
  // Recibo de uma ação executada: o que foi gravado (o resultado) e as chamadas
  // HTTP feitas para gravar, achadas pelo execucaoId que runApprovedWrite pôs
  // nos logs e no resultado. Escrita que só mexe no Firestore (catálogo,
  // conteúdo) não tem chamada — o recibo é o resultado.
  app.get('/api/agent/actions/:id/recibo', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const userRef = adminDb.collection('users').doc(uid);
      const snap = await userRef.collection('agent_actions').doc(req.params.id).get();
      if (!snap.exists) return res.status(404).json({ message: 'Ação não encontrada.' });
      const acao = snap.data() as { result?: { execucaoId?: string } };
      const execucaoId = acao.result?.execucaoId;
      const logs = execucaoId
        ? (await userRef.collection('agent_logs').where('execucaoId', '==', execucaoId).limit(100).get())
          .docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)))
        : [];
      return res.json({ acao: { id: snap.id, ...acao }, logs });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Números de Ferramentas que só o servidor alcança (Tiny, Wake, MELI).
  app.get('/api/agent/numeros', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      return res.json(await numerosDaLoja(uid));
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

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
