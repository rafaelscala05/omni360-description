// Centro de Operações para o Alfred: responde "quanto vendi", "o que está
// parado" a partir de `ops_pedidos` (o sync de server/ops/pedidosSync.ts), sem
// chamar o ERP. Provider `tiny` porque é a única fonte de pedidos com sync na
// v1 — a ferramenta só aparece para quem tem o Tiny conectado.
// Não liga o sync: quem liga é a primeira visita ao painel.

import { registerTool } from '../registry';
import { lerPedidos, lerProdutosErp, syncExistente } from '../../ops/painel';
import { ID_SYNC_LOJA, lerLoja } from '../../ops/lojaSync';
import { SYNC_REF } from '../../ops/pedidosSync';
import { resolveConnections } from '../connections';
import { estadoDoSync } from '../../../src/modules/agent/ops/pedidos';
import { painelEntrega, painelPedidos } from '../../../src/modules/agent/ops/indicadores';
import { estadoDoLoja, itensErp, painelCatalogo, painelPrecos, type EstadoLoja } from '../../../src/modules/agent/ops/catalogo';

const r2 = (n: number) => Math.round(n * 100) / 100;

registerTool({
  name: 'ops.painel.resumo',
  provider: 'tiny',
  mode: 'read',
  description:
    'Resumo de vendas, pedidos e entrega da loja (Centro de Operações): receita, número de pedidos e ticket médio de hoje, 7 e 30 dias '
    + 'com o período anterior, receita por canal, contagem por situação, pedidos parados, tempo até o envio e de transporte (mediana e p90), '
    + '% entregue no prazo e pedidos atrasados. Lê a cópia sincronizada dos pedidos '
    + 'do Tiny — use antes de listar pedidos um a um.',
  schema: { type: 'object', properties: {} },
  read: async (ctx) => {
    const sync = await syncExistente(ctx.uid, 'tiny');
    if (!sync) {
      return { disponivel: false, motivo: 'O Centro de Operações ainda não foi aberto: os pedidos começam a ser importados na primeira visita a Ferramentas › Operações.' };
    }
    const estado = estadoDoSync(sync, Date.now());
    const lista = await lerPedidos(ctx.uid);
    const p = painelPedidos(lista, Date.now());
    const e = painelEntrega(lista, Date.now());
    const periodo = (k: keyof typeof p.periodos) => ({
      receita: r2(p.periodos[k].receita),
      pedidos: p.periodos[k].pedidos,
      ticketMedio: r2(p.periodos[k].ticket),
      anterior: { receita: r2(p.periodos[k].anterior.receita), pedidos: p.periodos[k].anterior.pedidos },
    });
    return {
      disponivel: true,
      fonte: 'Tiny',
      historicoImportado: `${Math.round(estado.progresso * 100)}%`,
      atualizadoEm: estado.atualizadoEm ? new Date(estado.atualizadoEm).toISOString() : null,
      hoje: periodo('hoje'),
      ultimos7dias: periodo('d7'),
      ultimos30dias: periodo('d30'),
      canais30dias: p.canais.map((c) => ({ ...c, receita: r2(c.receita) })),
      fracaoComItens: r2(p.detalhados),
      situacoes30dias: p.funil,
      pedidosParados: { total: p.totalParados, maisAntigos: p.parados },
      entrega: {
        diasAteEnviar: e.ateEnviar,
        diasDeTransporte: e.transporte,
        diasPedidoAteEntrega: e.total,
        entreguesNoPrazo: e.noPrazo ? { percentual: Math.round(e.noPrazo.fracao * 100), amostra: e.noPrazo.amostra } : null,
        atrasados: { total: e.totalAtrasados, maisAtrasados: e.atrasados },
        naoEntregues: e.naoEntregues,
        porFormaEnvio: e.porFormaEnvio,
      },
    };
  },
});

registerTool({
  name: 'ops.loja.resumo',
  provider: 'wake',
  mode: 'read',
  description:
    'Catálogo e preços da loja Wake comparados com o ERP (Centro de Operações): produtos no ERP fora da loja, na loja fora do ERP, '
    + 'ocultos com estoque, estoque diferente, preço final diferente entre ERP e loja, à venda sem preço, promoções ativas, '
    + 'produtos abaixo do custo e com margem baixa. Lê a cópia sincronizada da loja — use antes de buscar produto a produto; '
    + 'para corrigir, use wake.produto.preco / wake.produto.atualizar.',
  schema: { type: 'object', properties: {} },
  read: async (ctx) => {
    const snap = await SYNC_REF(ctx.uid, ID_SYNC_LOJA).get();
    if (!snap.exists) {
      return { disponivel: false, motivo: 'O catálogo da loja ainda não foi lido: começa na primeira visita a Ferramentas › Operações.' };
    }
    const estado = estadoDoLoja(snap.data() as EstadoLoja);
    const conns = await resolveConnections(ctx.uid);
    const temErp = conns.tiny || conns.bling || conns.idworks;
    const [loja, produtos] = await Promise.all([lerLoja(ctx.uid), temErp ? lerProdutosErp(ctx.uid) : Promise.resolve(null)]);
    const erp = produtos ? itensErp(produtos) : null;
    return {
      disponivel: true,
      leituraDaLoja: estado.estado === 'em-dia' ? 'completa' : `em andamento (${estado.lidos} variantes lidas)`,
      comparadoComErp: !!erp,
      catalogo: painelCatalogo(erp, loja),
      precos: painelPrecos(erp, loja),
    };
  },
});
