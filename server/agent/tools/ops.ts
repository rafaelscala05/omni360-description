// Centro de Operações para o Alfred: responde "quanto vendi", "o que está
// parado" a partir de `ops_pedidos` (o sync de server/ops/pedidosSync.ts), sem
// chamar o ERP. Provider `tiny` porque é a única fonte de pedidos com sync na
// v1 — a ferramenta só aparece para quem tem o Tiny conectado.
// Não liga o sync: quem liga é a primeira visita ao painel.

import { registerTool } from '../registry';
import { lerPedidos, syncExistente } from '../../ops/painel';
import { estadoDoSync } from '../../../src/modules/agent/ops/pedidos';
import { painelPedidos } from '../../../src/modules/agent/ops/indicadores';

const r2 = (n: number) => Math.round(n * 100) / 100;

registerTool({
  name: 'ops.painel.resumo',
  provider: 'tiny',
  mode: 'read',
  description:
    'Resumo de vendas e pedidos da loja (Centro de Operações): receita, número de pedidos e ticket médio de hoje, 7 e 30 dias '
    + 'com o período anterior, receita por canal, contagem por situação e pedidos parados. Lê a cópia sincronizada dos pedidos '
    + 'do Tiny — use antes de listar pedidos um a um.',
  schema: { type: 'object', properties: {} },
  read: async (ctx) => {
    const sync = await syncExistente(ctx.uid, 'tiny');
    if (!sync) {
      return { disponivel: false, motivo: 'O Centro de Operações ainda não foi aberto: os pedidos começam a ser importados na primeira visita a Ferramentas › Operações.' };
    }
    const estado = estadoDoSync(sync, Date.now());
    const p = painelPedidos(await lerPedidos(ctx.uid), Date.now());
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
    };
  },
});
