// Roda o vídeo que o usuário aprovou no chat (produtos.video.gerar). O app
// chama esta rota logo depois da aprovação e segura a requisição aberta até o
// vídeo terminar — a mesma garantia de CPU do wizard (ver videoPedido.ts).
//
// Idempotente: a ação é reivindicada numa transação (result.videoIniciadoEm);
// duas abas abertas, ou um recarregamento no meio, não geram dois vídeos nem
// dois débitos.

import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { gerarRoteiro, iniciarVideo } from '../videoAgent';
import { gerarRoteiroUgc, iniciarVideoUgc } from '../ugcVideoAgent';
import { requireAnyModule } from './connections';
import type { PedidoVideo } from './videoPedido';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string; name?: string; email?: string }>;
}

/** Um pedido aprovado há mais que isso não começa sozinho: o usuário já não está esperando por ele. */
export const VALIDADE_PEDIDO_MS = 30 * 60_000;
/** Uma reivindicação mais velha que isso sem jobId é de um início que morreu antes de criar o job. */
const REIVINDICACAO_MS = 5 * 60_000;

export function registerVideoAlfredRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/agent/video/:actionId/iniciar', async (req, res) => {
    let ref: FirebaseFirestore.DocumentReference | null = null;
    try {
      const decoded = await verifyFirebaseToken(req);
      await requireAnyModule(decoded.uid);
      ref = adminDb.collection('users').doc(decoded.uid).collection('agent_actions').doc(req.params.actionId);

      const pedido = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref!);
        const a = snap.data();
        if (!a || a.tool !== 'produtos.video.gerar' || a.status !== 'executed' || !a.result?.pedidoVideo) {
          throw Object.assign(new Error('Não há vídeo aprovado para iniciar nesta ação.'), { status: 404, daReivindicacao: true });
        }
        if (a.result.videoJobId) throw Object.assign(new Error('Este vídeo já foi iniciado.'), { status: 409, daReivindicacao: true });
        const agora = Date.now();
        if (agora - Date.parse(a.resolvedAt ?? a.createdAt) > VALIDADE_PEDIDO_MS) {
          throw Object.assign(new Error('A aprovação deste vídeo expirou — peça de novo ao Alfred.'), { status: 410, daReivindicacao: true });
        }
        if (a.result.videoIniciadoEm && agora - Date.parse(a.result.videoIniciadoEm) < REIVINDICACAO_MS) {
          throw Object.assign(new Error('Este vídeo já está sendo iniciado.'), { status: 409, daReivindicacao: true });
        }
        tx.update(ref!, { 'result.videoIniciadoEm': new Date(agora).toISOString(), 'result.status': 'escrevendo o roteiro', 'result.videoErro': null });
        return a.result.pedidoVideo as PedidoVideo;
      });

      const aoCriarJob = async (jobId: string) => {
        await ref!.update({ 'result.videoJobId': jobId, 'result.status': 'gerando o vídeo' });
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ jobId }));
      };
      if (pedido.tipo === 'ugc') {
        const script = await gerarRoteiroUgc(pedido.roteiro);
        // O mesmo vínculo que o wizard grava (handleUgcVideoJobStarted no App):
        // o próximo vídeo UGC deste produto sugere o mesmo avatar.
        await adminDb.collection('users').doc(decoded.uid).collection('products').doc(pedido.inicio.productId)
          .update({ _ugcAvatarId: pedido.avatarId }).catch(() => {});
        await iniciarVideoUgc(decoded, { ...pedido.inicio, script }, aoCriarJob);
      } else {
        const script = await gerarRoteiro(pedido.roteiro);
        await iniciarVideo(decoded, { ...pedido.inicio, script }, aoCriarJob);
      }
      res.end();
    } catch (e: any) {
      // Falhou antes de criar o job (roteiro, crédito, outro vídeo rodando):
      // o card mostra o motivo e a reivindicação é solta para tentar de novo.
      if (ref && !e?.daReivindicacao) {
        await ref.update({ 'result.videoErro': e?.message ?? 'Falha ao iniciar o vídeo.', 'result.videoIniciadoEm': null, 'result.status': 'não iniciado' }).catch(() => {});
      }
      if (!res.headersSent) res.status(typeof e?.status === 'number' ? e.status : 500).json({ message: e?.message });
      else res.end();
    }
  });
}
