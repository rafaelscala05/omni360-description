// Verificação da confirmação "pular ou sobrescrever" (src/modules/agent/confirmacaoMassa.ts).
// Rodar com: npx tsx scripts/verify-confirmacao-massa.mjs
import { montarConfirmacao, alvos, custoDe, etapasPensando, emLotes, listaNomes, TAMANHO_LOTE, resumoConfirmacao } from '../src/modules/agent/confirmacaoMassa.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const c = (id, over = {}) => ({ id, nome: `P${id}`, temDescricao: false, temAmbientada: false, temFoto: true, ...over });
const sel = [c('1'), c('2', { temDescricao: true }), c('3', { temDescricao: true, temAmbientada: true }), c('4', { temFoto: false })];

const d = montarConfirmacao('produtos.descricoes.gerar', sel, 3);
check('descrição: novos e já têm', [d.novos.map((x) => x.id), d.jaTem.map((x) => x.id), d.semFoto.length], [['1', '4'], ['2', '3'], 0]);
check('pular gera só os novos', alvos(d, false).map((x) => x.id), ['1', '4']);
check('sobrescrever gera todos', alvos(d, true).map((x) => x.id), ['1', '4', '2', '3']);
check('custo por modo', [custoDe(d, false), custoDe(d, true)], [6, 12]);

const i = montarConfirmacao('produtos.ambientadas.gerar', sel, 1);
check('imagem: sem foto fica de fora sempre', [i.novos.map((x) => x.id), i.jaTem.map((x) => x.id), i.semFoto.map((x) => x.id)], [['1', '2'], ['3'], ['4']]);
check('sobrescrever imagem não inclui sem foto', alvos(i, true).map((x) => x.id), ['1', '2', '3']);

// Review Focus 3: todos já têm.
const todos = montarConfirmacao('produtos.descricoes.gerar', [c('a', { temDescricao: true })], 3);
check('todos já têm: nada no modo pular', [alvos(todos, false).length, alvos(todos, true).length], [0, 1]);

const etapas = etapasPensando(d);
check('etapas reais', etapas, [
  'Lendo os 4 produtos selecionados…',
  'Conferindo descrições — 2 já têm: P2, P3',
  'Calculando custo — 2 × 3 = 6 créditos',
]);
check('etapas de imagem citam quem fica sem foto', etapasPensando(i)[2], 'Sem foto para servir de base — 1 fica de fora: P4');

check('lotes de 50 e 10', [TAMANHO_LOTE['produtos.descricoes.gerar'], TAMANHO_LOTE['produtos.ambientadas.gerar']], [50, 10]);
check('emLotes', emLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
check('lista de nomes corta com "e mais"', listaNomes([{ nome: 'a' }, { nome: 'b' }, { nome: 'c' }, { nome: 'd' }], 2), 'a, b e mais 2');

// Final review M1: nenhum tem foto.
const semFotoNenhum = montarConfirmacao('produtos.ambientadas.gerar', [c('x', { temFoto: false })], 1);
check('resumo quando nenhum tem foto', resumoConfirmacao(semFotoNenhum), 'Nenhum dos selecionados tem foto para servir de base.');
check('resumo quando todos já têm', resumoConfirmacao(todos), 'Todos já têm descrição.');
check('resumo com novos', resumoConfirmacao(d), '2 serão gerados.');

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
