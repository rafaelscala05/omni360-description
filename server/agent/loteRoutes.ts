// Rotas do lote em job — o que o card do lote (chat/LoteCard.tsx) chama.
// O conteúdo do lote o cliente lê direto do Firestore (agent_jobs é legível
// pelo dono); tudo que muda o lote passa por aqui, porque só o servidor
// escreve nele.

import type express from 'express';
import { descartar, parar, pausar, retomar } from '../../src/modules/agent/lote';
import { requireAnyModule } from './connections';
import { mutarLote } from './loteStore';
import { aprovarLote } from './loteAprovacao';
import { scheduleLote } from './loteWorker';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

const httpStatus = (e: any) => (typeof e?.status === 'number' ? e.status : 500);

const idsDoCorpo = (body: unknown): string[] | null => {
  const itens = (body as { itens?: unknown } | undefined)?.itens;
  if (!Array.isArray(itens)) return null;
  return itens.filter((i): i is string => typeof i === 'string').slice(0, 200);
};

export function registerLoteRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/agent/lotes/:id/:acao', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const { id, acao } = req.params;
      const agora = () => new Date().toISOString();
      let job;
      switch (acao) {
        case 'aprovar':
          job = await aprovarLote(uid, id, idsDoCorpo(req.body));
          break;
        case 'descartar':
          job = await mutarLote(uid, id, (j) => descartar(j, idsDoCorpo(req.body), agora()));
          break;
        case 'pausar':
          job = await mutarLote(uid, id, (j) => pausar(j, agora()));
          break;
        case 'retomar':
          job = await mutarLote(uid, id, (j) => retomar(j, agora()));
          if (job?.status === 'rodando') scheduleLote(uid, id);
          break;
        case 'parar':
          job = await mutarLote(uid, id, (j) => parar(j, agora()));
          break;
        default:
          return res.status(404).json({ message: 'Ação de lote desconhecida.' });
      }
      return res.json({ status: job?.status ?? null });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
}
