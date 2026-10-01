// Os números que só o servidor alcança, para os cartões de Ferramentas (D2):
// pedidos em aberto no Tiny, banners ativos na Wake e anúncios ativos do
// Mercado Livre sem vídeo. Usa as mesmas ferramentas de leitura do Alfred
// (registry), então só conta o que a conta tem conectado — e cada número falha
// sozinho (null), nunca derruba os outros.

import { adminDb } from '../firebaseAdmin';
import { getTool } from './registry';
import { buildContext, resolveAgentContext } from './connections';

export interface NumerosLoja {
  /** Pedidos com situação "aberto"; `pedidosAbertosMais` = há mais páginas além da contada. */
  pedidosAbertos: number | null;
  pedidosAbertosMais?: boolean;
  bannersAtivos: number | null;
  meliSemVideo: number | null;
  geradoEm: string;
}

/** Tiny v2 pagina pedidos.pesquisa de 100 em 100. */
export function contarPedidos(r: { pedidos?: unknown[]; numeroPaginas?: number } | null): { n: number; mais: boolean } | null {
  if (!r) return null;
  const n = Array.isArray(r.pedidos) ? r.pedidos.length : 0;
  const paginas = Number(r.numeroPaginas ?? 1);
  return paginas > 1 ? { n: (paginas - 1) * 100 + n, mais: true } : { n, mais: false };
}

export function contarBannersAtivos(lista: unknown): number | null {
  if (!Array.isArray(lista)) return null;
  return lista.filter((b) => (b as { ativo?: boolean })?.ativo === true).length;
}

const cache = new Map<string, { at: number; v: NumerosLoja }>();
const TTL_MS = 10 * 60_000;

export async function numerosDaLoja(uid: string): Promise<NumerosLoja> {
  const c = cache.get(uid);
  if (c && Date.now() - c.at < TTL_MS) return c.v;

  const { providers } = await resolveAgentContext(uid);
  const ctx = buildContext(uid);
  const ler = async (nome: string, args: Record<string, unknown>) => {
    const def = getTool(nome);
    if (!def?.read || !providers.includes(def.provider)) return null;
    return def.read(ctx, args).catch(() => null);
  };

  const [pedidos, banners, semVideo] = await Promise.all([
    ler('tiny.pedido.listar', { situacao: 'aberto' }),
    ler('wake.banner.listar', { quantidadePorPagina: 50 }),
    providers.includes('meli')
      ? adminDb.collection('users').doc(uid).collection('meli_listings').select('status', 'videoId').get()
        .then((s) => s.docs.filter((d) => d.data().status === 'active' && !d.data().videoId).length)
        .catch(() => null)
      : Promise.resolve(null),
  ]);
  const p = contarPedidos(pedidos as never);
  const v: NumerosLoja = {
    pedidosAbertos: p?.n ?? null,
    ...(p?.mais ? { pedidosAbertosMais: true } : {}),
    bannersAtivos: contarBannersAtivos(banners),
    meliSemVideo: semVideo,
    geradoEm: new Date().toISOString(),
  };
  cache.set(uid, { at: Date.now(), v });
  return v;
}
