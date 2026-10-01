// Aprovar itens de um lote: o único caminho de um lote até o execute() da
// ferramenta. Reserva os itens prontos (estado "gravando", numa transação —
// duplo clique não grava nem cobra duas vezes), roda runApprovedWrite com só
// esses itens (débito por item + auditoria, como qualquer escrita aprovada) e
// devolve cada item a gravado/pulado — ou a "pronto", se a gravação falhou
// inteira (ex.: sem créditos).

import { concluirGravacao, reservarParaGravar, type ItemLote, type LoteJob } from '../../src/modules/agent/lote';
import { mutarLote } from './loteStore';
import { getTool } from './registry';
import { runApprovedWrite } from './execution';
import { buildContext } from './connections';

export async function aprovarLote(uid: string, id: string, ids: string[] | null): Promise<LoteJob | null> {
  let reservados: ItemLote[] = [];
  let tool = '';
  let args: Record<string, unknown> = {};
  await mutarLote(uid, id, (j) => {
    const r = reservarParaGravar(j, ids, new Date().toISOString());
    reservados = r.reservados;
    tool = j.tool;
    args = j.args;
    return reservados.length ? r.job : null;
  });
  if (!reservados.length) throw Object.assign(new Error('Nenhum item pronto para gravar.'), { status: 409 });

  const def = getTool(tool);
  const idsReservados = reservados.map((i) => i.id);
  if (!def?.execute) {
    await mutarLote(uid, id, (j) => concluirGravacao(j, { erro: 'ferramenta ausente', ids: idsReservados }, new Date().toISOString()));
    throw Object.assign(new Error(`Ferramenta ${tool} não está registrada neste servidor.`), { status: 500 });
  }

  const preview = {
    resumo: `Gravar ${reservados.length === 1 ? '1 item' : `${reservados.length} itens`} do lote`,
    alvo: reservados.map((i) => i.nome).join(', '),
    campos: [],
    avisos: [],
    payload: {
      itens: reservados.map((i) => ({
        itemId: i.id, docId: i.docId, sku: i.sku, nome: i.nome, descricaoAntes: i.descricaoAntes ?? '', ...i.resultado,
      })),
    },
  };

  try {
    const r = (await runApprovedWrite(buildContext(uid), def, args, preview)) as {
      gravadosIds?: string[]; puladosIds?: { id: string; motivo: string }[];
    };
    return await mutarLote(uid, id, (j) => concluirGravacao(j, {
      gravados: r?.gravadosIds ?? [],
      pulados: r?.puladosIds ?? [],
    }, new Date().toISOString()));
  } catch (e) {
    await mutarLote(uid, id, (j) => concluirGravacao(j, { erro: String(e), ids: idsReservados }, new Date().toISOString())).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(msg === 'INSUFFICIENT_CREDITS' ? 'Créditos insuficientes para gravar estes itens.' : msg), {
      status: (e as { status?: number }).status ?? 500,
    });
  }
}
