// GET /api/ops/painel — o Centro de Operações. Resolve de onde cada domínio é
// lido (papeis.ts), liga/visita o sync de pedidos e devolve os indicadores
// calculados sobre `ops_pedidos` (indicadores.ts). O cálculo é no servidor:
// 60 dias podem ser milhares de docs, e assim `ops_pedidos` não precisa de
// regra de leitura no cliente. O estoque é calculado no cliente, sobre o
// catálogo que ele já tem, com o `vendidos30d` daqui.

import type express from 'express';
import { resolveConnections, requireAnyModule } from '../agent/connections';
import { fontesOps, temAdaptadorPedidos, type PlataformaOps } from '../../src/modules/agent/ops/papeis';
import { diaBrt, estadoDoSync, somaDias, type EstadoSync, type PedidoOps } from '../../src/modules/agent/ops/pedidos';
import { painelPedidos, type PainelPedidos, type RespostaPainelOps } from '../../src/modules/agent/ops/indicadores';
import { PEDIDOS_COL, SYNC_REF, dispararCiclo, visitarSync } from './pedidosSync';

/** Janela lida para o painel: 30 dias + os 30 anteriores, para comparar. */
export const DIAS_PAINEL = 60;

export async function lerPedidos(uid: string, dias = DIAS_PAINEL): Promise<PedidoOps[]> {
  const desde = somaDias(diaBrt(Date.now()), -(dias - 1));
  const snap = await PEDIDOS_COL(uid).where('data', '>=', desde).get();
  return snap.docs.map((d) => d.data() as PedidoOps);
}

const cache = new Map<string, { at: number; v: RespostaPainelOps }>();
const TTL_MS = 60_000;

export async function painelOps(uid: string, opts: { atualizar?: boolean } = {}): Promise<RespostaPainelOps> {
  const c = cache.get(uid);
  if (!opts.atualizar && c && Date.now() - c.at < TTL_MS) return c.v;

  const conns = await resolveConnections(uid);
  const fontes = fontesOps({ tiny: conns.tiny, bling: conns.bling, idworks: conns.idworks, wake: conns.wake });
  const suportado = temAdaptadorPedidos(fontes.pedidos);

  let sync: RespostaPainelOps['sync'] = null;
  let pedidos: PainelPedidos | null = null;
  if (suportado) {
    const fonte = fontes.pedidos as PlataformaOps;
    const estado: EstadoSync = await visitarSync(uid, fonte);
    // "Atualizar" força um ciclo, mas no máximo um a cada 2 min: cada ciclo gasta até 40 chamadas no Tiny.
    if (opts.atualizar && Date.now() - (estado.ultimoCicloEm ?? 0) > 120_000) dispararCiclo(uid, fonte, true);
    const e = estadoDoSync(estado, Date.now());
    sync = { ...e, erro: estado.erro && estado.erro !== 'credencial' ? estado.erro : null };
    pedidos = painelPedidos(await lerPedidos(uid), Date.now());
  }

  const v: RespostaPainelOps = { fontes, pedidosSuportados: suportado, sync, pedidos, geradoEm: new Date().toISOString() };
  cache.set(uid, { at: Date.now(), v });
  return v;
}

/** Estado do sync sem ligá-lo — para a ferramenta do Alfred, que não deve disparar importação. */
export async function syncExistente(uid: string, fonte: PlataformaOps): Promise<EstadoSync | null> {
  const snap = await SYNC_REF(uid, fonte).get();
  return snap.exists ? (snap.data() as EstadoSync) : null;
}

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerOpsRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.get('/api/ops/painel', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      return res.json(await painelOps(uid, { atualizar: req.query.atualizar === '1' }));
    } catch (e: any) {
      return res.status(typeof e?.status === 'number' ? e.status : 500).json({ message: e?.message });
    }
  });
}
