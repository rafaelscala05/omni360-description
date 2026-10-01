// Verificação do "Plano" do chat do Alfred (src/modules/agent/plano.ts).
// Rodar com: npx tsx scripts/verify-plano.mjs
import { videosParaIniciar, VALIDADE_PEDIDO_MS } from '../src/modules/agent/videoAlfred.ts';
import { montarPlano, rotuloFerramenta, temPlano } from '../src/modules/agent/plano.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}
const L = (tool, ok = true, erro) => ({ tool, ok, ...(erro ? { erro } : {}) });
const acao = (status, over = {}) => ({
  status, provider: 'produtos',
  preview: { resumo: 'Escrever 3 descrições', alvo: '3 produtos do catálogo', campos: [], avisos: [], itens: [{}, {}, {}], custo: 3, ...over },
});

check('rótulo amigável conhecido', rotuloFerramenta('produtos.incompletos.listar'), 'Ler o catálogo');
check('rótulo genérico', rotuloFerramenta('tiny.produto.obter'), 'Tiny · produto obter');

const p1 = montarPlano({ leituras: [L('produtos.incompletos.listar')], acao: acao('pending') });
check('plano com escrita pendente', p1.passos.map((p) => [p.tipo, p.estado]), [['leitura', 'feito'], ['voce', 'agora'], ['gravacao', 'depois']]);
check('gravação diz onde grava', p1.passos[2].titulo, 'Gravar no catálogo');
check('lote aparece no passo de revisão', p1.passos[1].detalhe, 'Amostra navegável dos 3 itens antes de gravar');
check('custo vem da prévia', p1.custo, 3);

check('executada fecha os passos', montarPlano({ leituras: [], acao: acao('executed') }).passos.map((p) => p.estado), ['feito', 'feito']);
check('recusada cancela revisão e gravação', montarPlano({ leituras: [], acao: acao('rejected') }).passos.map((p) => p.estado), ['cancelado', 'cancelado']);
check('falha marca a gravação', montarPlano({ leituras: [], acao: acao('failed') }).passos.map((p) => p.estado), ['feito', 'erro']);

const dup = montarPlano({ leituras: [L('produtos.buscar'), L('produtos.buscar', false, 'timeout')] });
check('mesma ferramenta seguida vira um passo, e o erro prevalece', dup.passos.map((p) => [p.titulo, p.estado, p.detalhe]), [['Buscar no catálogo', 'erro', 'timeout']]);

check('ao vivo sem leitura ainda', montarPlano({ leituras: [], aoVivo: true }).passos.map((p) => [p.titulo, p.estado]), [['Entendendo o pedido', 'agora']]);
check('ao vivo depois de ler', montarPlano({ leituras: [L('docs.buscar')], aoVivo: true }).passos.at(-1).titulo, 'Montando a resposta');

check('uma leitura só, turno pronto: sem plano', temPlano({ leituras: [L('docs.buscar')] }), false);
check('escrita sempre tem plano', temPlano({ leituras: [], acao: {} }), true);
check('duas leituras têm plano', temPlano({ leituras: [L('a.b'), L('c.d')] }), true);

const lote = (status) => ({ status, provider: 'produtos', preview: { resumo: 'r', alvo: '12 produtos do catálogo', campos: [], avisos: [], custo: 12, lote: { id: 'j', total: 12 } } });
check('lote: Alfred escreve, você revisa as prontas, grava', montarPlano({ leituras: [], acao: lote('pending') }).passos.map((p) => [p.tipo, p.estado]),
  [['trabalho', 'agora'], ['voce', 'agora'], ['gravacao', 'depois']]);
check('lote concluído fecha tudo', montarPlano({ leituras: [], acao: lote('executed') }).passos.map((p) => p.estado), ['feito', 'feito', 'feito']);

// Vídeo aprovado no chat: o app inicia só o que está pronto, recente e intocado.
{
  const AG = Date.parse('2026-10-01T12:00:00Z');
  const v = (id, result, resolvedAt = new Date(AG - 60_000).toISOString(), status = 'executed') => ({ id, tool: 'produtos.video.gerar', status, resolvedAt, createdAt: resolvedAt, result });
  check('vídeos a iniciar', videosParaIniciar([
    v('ok', { pedidoVideo: {} }),
    v('iniciado', { pedidoVideo: {}, videoJobId: 'j' }),
    v('reivindicado', { pedidoVideo: {}, videoIniciadoEm: 'x' }),
    v('erro', { pedidoVideo: {}, videoErro: 'sem crédito' }),
    v('velho', { pedidoVideo: {} }, new Date(AG - VALIDADE_PEDIDO_MS - 1).toISOString()),
    v('pendente', { pedidoVideo: {} }, undefined, 'pending'),
    { ...v('outra', { pedidoVideo: {} }), tool: 'x' },
  ], AG), ['ok']);
}

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
