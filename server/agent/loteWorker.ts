// Worker do lote em job: escreve item a item o que um lote pediu
// (users/{uid}/agent_jobs/{id}), com lease para dois processos nunca gerarem o
// mesmo lote ao mesmo tempo.
//
// Roda onde o lote nasce (o serviço do grafo, logo depois do preview()) e no
// servidor principal, que varre a cada minuto os lotes "rodando" com lease
// vencido — o mesmo desenho do recoverMeliWork (server/meli/scheduler.ts). Isso
// cobre o serviço do grafo morrer ou ter a CPU estrangulada depois de
// responder: o lease vence e o servidor principal assume, e os itens que
// estavam "gerando" voltam para a fila (reivindicar, em lote.ts).

import { adminDb } from '../firebaseAdmin';
import { concluirGeracao, pegarProximo, reivindicar, type ItemLote, type ResultadoLote } from '../../src/modules/agent/lote';
import { mutarLote, novoLeaseId } from './loteStore';
import { aprovarLote } from './loteAprovacao';
import { clienteVertex, gerarAtributos, gerarDescricao, lerCatalogo, lerCategorias } from './produtosGeracao';
import { atributosEfetivos, type ProdutoDoc } from './produtosRules';

/** Quantos itens um worker escreve ao mesmo tempo — o Vertex limita requisições por minuto. */
const CONCORRENCIA = 2;

interface Sessao { gerar(item: ItemLote): Promise<ResultadoLote> }

/**
 * Como cada ferramenta de lote escreve um item. `preparar` roda uma vez por
 * reivindicação (lê o catálogo uma vez, não uma por item).
 */
const GERADORES: Record<string, (uid: string) => Promise<Sessao>> = {
  'produtos.descricoes.gerar': async (uid) => {
    const catalogo = await lerCatalogo(uid);
    const porDoc = new Map<string, ProdutoDoc>(catalogo.map((p) => [p._docId, p]));
    const ai = clienteVertex();
    return {
      async gerar(item) {
        const p = porDoc.get(item.docId);
        if (!p) throw new Error('o produto foi removido do catálogo');
        return gerarDescricao(ai, p, catalogo);
      },
    };
  },
  'produtos.atributos.gerar': async (uid) => {
    const [catalogo, categorias] = await Promise.all([lerCatalogo(uid), lerCategorias(uid)]);
    const porDoc = new Map<string, ProdutoDoc>(catalogo.map((p) => [p._docId, p]));
    const ai = clienteVertex();
    return {
      async gerar(item) {
        const p = porDoc.get(item.docId);
        if (!p) throw new Error('o produto foi removido do catálogo');
        const defs = atributosEfetivos(typeof p.categoryId === 'string' ? p.categoryId : undefined, categorias);
        if (!defs.length) throw new Error('a categoria do produto não tem atributos');
        return gerarAtributos(ai, p, defs);
      },
    };
  },
};

const emAndamento = new Set<string>();

export function scheduleLote(uid: string, id: string): void {
  const chave = `${uid}/${id}`;
  if (emAndamento.has(chave)) return;
  emAndamento.add(chave);
  setImmediate(() => {
    rodar(uid, id)
      .catch((e) => console.warn('[lote] worker falhou', id, e instanceof Error ? e.message : String(e)))
      .finally(() => emAndamento.delete(chave));
  });
}

async function rodar(uid: string, id: string): Promise<void> {
  const leaseId = novoLeaseId();
  const job = await mutarLote(uid, id, (j) => reivindicar(j, leaseId, Date.now()));
  if (!job) return;

  const preparar = GERADORES[job.tool];
  if (!preparar) {
    await mutarLote(uid, id, (j) => ({
      ...j,
      itens: j.itens.map((i) => (i.estado === 'fila' || i.estado === 'gerando' ? { ...i, estado: 'falhou' as const, erro: `sem gerador para ${j.tool}` } : i)),
    }));
    return;
  }
  const sessao = await preparar(uid);

  const trabalhador = async () => {
    for (;;) {
      const pego: { item: ItemLote | null } = { item: null };
      await mutarLote(uid, id, (j) => {
        const r = pegarProximo(j, leaseId, Date.now());
        pego.item = r?.item ?? null;
        return r?.job ?? null;
      });
      if (!pego.item) return;
      const atual = pego.item;
      let saida: { resultado: ResultadoLote } | { erro: string };
      try {
        saida = { resultado: await sessao.gerar(atual) };
      } catch (e) {
        saida = { erro: e instanceof Error ? e.message : String(e) };
      }
      const depois = await mutarLote(uid, id, (j) => concluirGeracao(j, atual.id, saida, Date.now()));
      // Autonomia ligada: cada item é gravado assim que fica pronto. Falha aqui
      // (ex.: sem créditos) não para a geração — o item volta a "pronto" e
      // espera o usuário.
      if (depois?.auto && depois.itens.find((i) => i.id === atual.id)?.estado === 'pronto') {
        await aprovarLote(uid, id, [atual.id]).catch((e) => console.warn('[lote] aprovação automática falhou', id, e?.message));
      }
    }
  };
  await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));

  // Solta o lease: pausado e retomado depois, qualquer processo pode pegar na hora.
  await mutarLote(uid, id, (j) => (j.leaseId === leaseId ? { ...j, leaseId: null, leaseUntil: null } : null)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Recuperação (servidor principal)
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;
let varrendo = false;

export async function recoverLotes(): Promise<void> {
  if (varrendo) return;
  varrendo = true;
  try {
    const snap = await adminDb.collectionGroup('agent_jobs').where('status', '==', 'rodando').limit(100).get();
    const agora = Date.now();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.leaseUntil && d.leaseUntil > agora) continue;
      const uid = doc.ref.path.match(/^users\/([^/]+)\/agent_jobs\/[^/]+$/)?.[1];
      if (uid) scheduleLote(uid, doc.id);
    }
  } catch (e) {
    console.warn('[lote] recuperação falhou', e instanceof Error ? e.message : String(e));
  } finally {
    varrendo = false;
  }
}

export function startLoteScheduler(): void {
  if (timer) return;
  void recoverLotes();
  timer = setInterval(() => void recoverLotes(), 60_000);
  timer.unref?.();
}
