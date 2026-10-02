// Verificação do lote em job (src/modules/agent/lote.ts) — as transições que o
// worker e a rota de aprovação aplicam dentro de transações do Firestore.
// Rodar com: npx tsx scripts/verify-lote.mjs
import {
  reivindicar, pegarProximo, concluirGeracao, pausar, retomar, parar, descartar, reservarParaGravar,
  concluirGravacao, resumoLote, statusDerivado, statusDaAcao, linhaProgresso, camposDoItem, nomeDoLote, LEASE_MS,
  linhasAoVivo, podeDesfazer, marcarDesfeito, podeRestaurar, camposDeRestauro, restauroDaVariacao, chaveDeRecarga,
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

// --- Lote em massa: linhas ao vivo e desfazer -------------------------------------
{
  const item = (id, estado, over = {}) => ({ id, docId: id, sku: id, nome: `P${id}`, estado, ...over });
  const job = {
    id: 'j', tool: 'produtos.descricoes.gerar', args: {}, chave: 'k', actionId: 'a', status: 'rodando', auto: true, avisos: [],
    origem: 'massa', createdAt: 'x', updatedAt: 'x',
    itens: [
      item('1', 'gravado', { descricaoAntes: '<p>velha</p>', resultado: { descricao: '<p>nova</p>', tituloSeo: 'T', descricaoSeo: 'D', palavrasChave: 'K' },
        antes: { tituloSeo: 't0', descricaoSeo: 'd0', palavrasChave: 'k0', statusDescricao: 'Descrição original', statusSEO: null } }),
      item('2', 'gerando'),
      item('3', 'falhou', { erro: 'sem foto pública' }),
      item('4', 'fila'),
    ],
  };
  check('linhas ao vivo', linhasAoVivo(job), [
    { texto: '✓ P1', tom: 'ok' },
    { texto: '✍️ escrevendo P2…', tom: 'trabalhando' },
    { texto: '⚠ P3: sem foto pública', tom: 'alerta' },
    { texto: '+1 na fila', tom: 'trabalhando' },
  ]);

  const fim = { ...job, status: 'concluido', itens: job.itens.map((i) => (i.estado === 'gerando' || i.estado === 'fila' ? { ...i, estado: 'gravado' } : i)) };
  check('só desfaz lote concluído com gravados', [podeDesfazer(job), podeDesfazer(fim)], [false, true]);

  // Review Focus 5: desfazer duas vezes.
  const desfeito = marcarDesfeito(fim, 'agora');
  check('marca desfeito', desfeito?.desfeito, true);
  check('segunda vez não faz nada', marcarDesfeito(desfeito, 'agora'), null);
  check('lote desfeito não oferece desfazer de novo', podeDesfazer(desfeito), false);

  // Review Focus 2: usuário editou depois do lote.
  check('restaura se o texto ainda é o gravado', podeRestaurar(' <p>nova</p> ', '<p>nova</p>'), true);
  check('não restaura edição do usuário', podeRestaurar('<p>editei</p>', '<p>nova</p>'), false);

  const intacto = { 'Descrição complementar': '<p>nova</p>', 'Título SEO': 'T', 'Descrição SEO': 'D', 'Palavras chave SEO': 'K' };
  check('campos de restauro da descrição', camposDeRestauro(job.itens[0], intacto), {
    descricao: true, seo: true,
    campos: {
      'Descrição complementar': '<p>velha</p>', _statusDescricao: 'Descrição original',
      'Título SEO': 't0', 'Descrição SEO': 'd0', 'Palavras chave SEO': 'k0', _statusSEO: null,
    },
  });
  check('item sem resultado não restaura', camposDeRestauro(job.itens[1], intacto), null);

  // Ajuste: o SEO editado depois do lote fica; a descrição intacta volta.
  check('SEO editado depois do lote não é desfeito', camposDeRestauro(job.itens[0], { ...intacto, 'Título SEO': 'meu título' }), {
    descricao: true, seo: false,
    campos: { 'Descrição complementar': '<p>velha</p>', _statusDescricao: 'Descrição original' },
  });
  check('descrição editada, SEO intacto: só o SEO volta', camposDeRestauro(job.itens[0], { ...intacto, 'Descrição complementar': '<p>editei</p>' })?.campos,
    { 'Título SEO': 't0', 'Descrição SEO': 'd0', 'Palavras chave SEO': 'k0', _statusSEO: null });
  check('tudo editado: nada a desfazer', camposDeRestauro(job.itens[0], { ...intacto, 'Descrição complementar': 'x', 'Palavras chave SEO': 'y' }), null);

  // Ajuste: cada variação volta ao próprio texto e status, não ao do pai com "Gerado por IA".
  const comVar = { ...job.itens[0], variacoesAntes: { v1: { status: null }, v2: { descricao: '<p>só da v2</p>', status: 'Original' } } };
  check('variação que herdava o texto volta ao do pai e ao status dela', restauroDaVariacao(comVar, 'v1', '<p>nova</p>'),
    { 'Descrição complementar': '<p>velha</p>', _statusDescricao: null });
  check('variação com texto próprio volta ao dela', restauroDaVariacao(comVar, 'v2', '<p>nova</p>'),
    { 'Descrição complementar': '<p>só da v2</p>', _statusDescricao: 'Original' });
  check('variação editada depois do lote fica', restauroDaVariacao(comVar, 'v1', '<p>editei</p>'), null);
  check('variação criada depois do lote fica', restauroDaVariacao(comVar, 'v9', '<p>nova</p>'), null);
  check('lote antigo (sem variacoesAntes) usa o status de antes do pai', restauroDaVariacao(job.itens[0], 'v1', '<p>nova</p>'),
    { 'Descrição complementar': '<p>velha</p>', _statusDescricao: 'Descrição original' });
}

// --- Final review I1/I2 -------------------------------------------------------------
{
  const it = { id: 'i0', docId: 'd', sku: 's', nome: 'P', estado: 'gravado', descricaoAntes: 'x', resultado: { descricao: 'y', tituloSeo: '', descricaoSeo: '', palavrasChave: '' } };
  const base = { id: 'j', tool: 'produtos.descricoes.gerar', args: {}, chave: 'k', actionId: 'a', status: 'concluido', auto: true, avisos: [], createdAt: 'x', updatedAt: 'x', itens: [it] };
  check('Desfazer só em lote em massa (o do chat não guarda o SEO de antes)', [podeDesfazer(base), podeDesfazer({ ...base, origem: 'massa' })], [false, true]);
  const acao = { id: 'a', provider: 'produtos', status: 'executed', result: { gravados: 2 } };
  check('chave de recarga muda quando o lote é desfeito',
    chaveDeRecarga(acao) !== chaveDeRecarga({ ...acao, result: { gravados: 2, desfeitoEm: 'agora' } }), true);
  check('envio ao ERP pelo chat também recarrega', chaveDeRecarga({ id: 'b', provider: 'tiny', tool: 'tiny.catalogo.enviar', status: 'executed' }) !== null, true);
  check('ação pendente de outro provider não recarrega', chaveDeRecarga({ id: 'c', provider: 'wake', tool: 'wake.banners.criar', status: 'executed' }), null);
}

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
