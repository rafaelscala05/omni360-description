// Vídeos aprovados no chat que ainda não começaram (produtos.video.gerar).
// O app aberto é quem inicia: chama POST /api/agent/video/:actionId/iniciar e
// segura a requisição até o fim, como o wizard faz — ver
// server/agent/videoPedido.ts. Puro; verificar com `npx tsx scripts/verify-plano.mjs`.

import type { AgentAction } from '../../types/agent';

/** Igual a VALIDADE_PEDIDO_MS do servidor: depois disso o pedido não começa sozinho. */
export const VALIDADE_PEDIDO_MS = 30 * 60_000;

export interface EstadoVideoAlfred {
  status?: string;
  videoJobId?: string;
  videoIniciadoEm?: string | null;
  videoErro?: string | null;
  pedidoVideo?: unknown;
}

export const estadoVideo = (a: Pick<AgentAction, 'result'>) => (a.result ?? {}) as EstadoVideoAlfred;

export function videosParaIniciar(acoes: AgentAction[], agora = Date.now()): string[] {
  return acoes
    .filter((a) => {
      if ((a.tool !== 'produtos.video.gerar' && a.tool !== 'meli.video.gerar') || a.status !== 'executed') return false;
      const r = estadoVideo(a);
      if (!r.pedidoVideo || r.videoJobId || r.videoIniciadoEm || r.videoErro) return false;
      const quando = Date.parse(a.resolvedAt ?? a.createdAt);
      return Number.isFinite(quando) && agora - quando <= VALIDADE_PEDIDO_MS;
    })
    .map((a) => a.id);
}
