// Verificação do lote em job (src/modules/agent/lote.ts) — as transições que o
// worker e a rota de aprovação aplicam dentro de transações do Firestore.
// Rodar com: npx tsx scripts/verify-lote.mjs
import {
  reivindicar, pegarProximo, concluirGeracao, pausar, retomar, parar, descartar, reservarParaGravar,
  concluirGravacao, resumoLote, statusDerivado, statusDaAcao, linhaProgresso, camposDoItem, nomeDoLote, LEASE_MS,
} from '../src/modules/agent/lote.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const T = 1_000_000;
const R = { descricao: '<p>Nova</p>', tituloSeo: 'T', descricaoSeo: 'D', palavrasChave: 'k' };
const novo = (n = 3) => ({
  id: 'j', tool: 'produtos.descricoes.gerar', args: {}, chave: 'c', actionId: 'a', status: 'rodando', auto: false, avisos: [],
  itens: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, docId: `d${i}`, sku: `S${i}`, nome: `P${i}`, estado: 'fila', descricaoAntes: '' })),
  createdAt: '', updatedAt: '',
});
const estados = (j) => j.itens.map((i) => i.estado).join(',');

// --- lease ---
let j = reivindicar(novo(), 'L1', T);
check('reivindica um lote novo', [j.leaseId, j.leaseUntil], ['L1', T + LEASE_MS]);
check('outro worker não rouba um lease válido', reivindicar(j, 'L2', T + 1000), null);
let r = pegarProximo(j, 'L1', T);
j = r.job;
check('pega o primeiro da fila', [r.item.id, estados(j)], ['i0', 'gerando,fila,fila']);
check('worker sem o lease não pega nada', pegarProximo(j, 'L2', T), null);
const roubado = reivindicar(j, 'L2', T + LEASE_MS + 1);
check('lease vencido: outro worker assume e o item preso volta para a fila', [roubado.leaseId, estados(roubado)], ['L2', 'fila,fila,fila']);

// --- geração e aprovação parcial ---
j = concluirGeracao(j, 'i0', { resultado: R }, T + 10);
check('item gerado fica pronto e o lote segue rodando', [estados(j), j.status], ['pronto,fila,fila', 'rodando']);
check('progresso conta o pronto', linhaProgresso(j), '1 de 3 · na fila');
r = pegarProximo(j, 'L1', T + 11); j = r.job;
check('"agora:" mostra quem está sendo escrito', linhaProgresso(j), '1 de 3 · agora: P1');
let res = reservarParaGravar(j, null, '');
j = res.job;
check('aprovar as prontas reserva só as prontas', [res.reservados.map((i) => i.id), estados(j)], [['i0'], 'gravando,gerando,fila']);
check('não reserva duas vezes (duplo clique)', reservarParaGravar(j, null, '').reservados.length, 0);
j = concluirGravacao(j, { gravados: ['i0'], pulados: [] }, '');
check('gravado sem parar a geração', [estados(j), j.status], ['gravado,gerando,fila', 'rodando']);

// --- pausa ---
j = pausar(j, '');
check('pausado não entrega o próximo', [j.status, pegarProximo(j, 'L1', T)], ['pausado', null]);
j = concluirGeracao(j, 'i1', { erro: 'Vertex 503' }, T + 20);
check('item em andamento termina mesmo pausado', [estados(j), j.status], ['gravado,falhou,fila', 'pausado']);
check('linha diz pausado', linhaProgresso(j), '2 de 3 · pausado');
j = retomar(j, '');
check('retomar limpa o lease para qualquer worker pegar', [j.status, j.leaseId], ['rodando', null]);

// --- parar e descartar ---
let k = parar(j, '');
check('parar descarta a fila e conclui', [estados(k), k.status, statusDaAcao(k)], ['gravado,falhou,descartado', 'concluido', 'executed']);
check('descartado antes de escrever sai da conta', linhaProgresso(k), '2 de 2');

let d = novo(2);
d = reivindicar(d, 'L', T); d = pegarProximo(d, 'L', T).job;
d = descartar(d, ['i0'], '');
d = concluirGeracao(d, 'i0', { resultado: R }, T);
check('resultado de item descartado no meio é ignorado', d.itens[0].estado, 'descartado');
d = descartar(d, null, '');
check('recusar tudo: ação rejeitada', [d.status, statusDaAcao(d)], ['concluido', 'rejected']);

// --- falha na gravação ---
let g = novo(1);
g = reivindicar(g, 'L', T); g = pegarProximo(g, 'L', T).job; g = concluirGeracao(g, 'i0', { resultado: R }, T);
check('tudo gerado e esperando: revisão', g.status, 'revisao');
g = reservarParaGravar(g, ['i0'], '').job;
g = concluirGravacao(g, { erro: 'INSUFFICIENT_CREDITS', ids: ['i0'] }, '');
check('sem crédito: item volta a ficar pronto', [estados(g), g.status, statusDaAcao(g)], ['pronto', 'revisao', 'pending']);
g = reservarParaGravar(g, null, '').job;
g = concluirGravacao(g, { gravados: [], pulados: [{ id: 'i0', motivo: 'mudou' }] }, '');
check('só pulados: ação falhou', [g.itens[0].erro, statusDaAcao(g)], ['mudou', 'failed']);

check('resumo', resumoLote(k), { total: 3, fila: 0, gerando: 0, prontos: 0, gravando: 0, gravados: 1, pulados: 0, falhas: 1, descartados: 1, gerados: 2, agora: null });
check('status derivado de lote vazio de trabalho', statusDerivado({ status: 'rodando', itens: [] }), 'concluido');
check('campos da amostra', camposDoItem({ descricaoAntes: '<b>Velha</b>', resultado: R }).map((c) => [c.campo, c.antes, c.depois]),
  [['Descrição', 'Velha', 'Nova'], ['Título SEO', null, 'T'], ['Descrição SEO', null, 'D']]);

check('campos de atributos', camposDoItem({ resultado: { atributos: [{ key: 'cor', label: 'Cor', antes: null, valor: 'Preto' }, { key: 'u', label: '', antes: ['Sala'], valor: ['Sala', 'Quarto'] }] } }).map((c) => [c.campo, c.antes, c.depois]),
  [['Cor', null, 'Preto'], ['u', 'Sala', 'Sala, Quarto']]);
check('campos de ambientadas viram miniaturas', camposDoItem({ resultado: { imagens: ['a', 'b'] } }).map((c) => [c.campo, c.imagens]), [['2 imagens ambientadas', ['a', 'b']]]);
check('nome do lote por ferramenta', [nomeDoLote('produtos.atributos.gerar', 1), nomeDoLote('x', 3)], ['Atributos · 1 produto', 'Lote · 3 produtos']);

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
