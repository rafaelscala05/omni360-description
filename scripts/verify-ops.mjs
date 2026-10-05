// Verificação do Centro de Operações (src/modules/agent/ops/*): papel dos
// conectores, normalização dos pedidos do Tiny, janelas do sync e indicadores.
// Rodar com: npx tsx scripts/verify-ops.mjs
import { fonteDe, fontesOps, papelDe, temAdaptadorPedidos } from '../src/modules/agent/ops/papeis.ts';
import {
  dataHoraBr, dataIso, detalheTiny, diaBrt, estadoDoSync, estadoInicial, janelaBackfill,
  normalizarSituacao, numeroBr, orcamentoDoCiclo, progressoBackfill, resumoTiny, somaDias,
} from '../src/modules/agent/ops/pedidos.ts';
import { distribuicao, painelEntrega, painelEstoque, painelPedidos, variacao } from '../src/modules/agent/ops/indicadores.ts';
import { itemLojaWake, itensErp, painelCatalogo, painelPrecos, precoFinalErp } from '../src/modules/agent/ops/catalogo.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// --- Papéis -----------------------------------------------------------------
check('Tiny é ERP, Wake é loja, ML é marketplace', [papelDe('tiny'), papelDe('wake'), papelDe('meli')], ['erp', 'loja', 'marketplace']);
check('pedidos vêm do ERP mesmo com a Wake conectada', fonteDe('pedidos', { tiny: true, wake: true }), 'tiny');
check('Tiny tem preferência sobre Bling', fonteDe('estoque', { bling: true, tiny: true }), 'tiny');
check('sem ERP, pedidos e estoque caem na Wake', [fonteDe('pedidos', { wake: true }), fonteDe('estoque', { wake: true })], ['wake', 'wake']);
check('catálogo da loja é sempre a Wake', [fonteDe('catalogo_loja', { tiny: true }), fonteDe('catalogo_loja', { tiny: true, wake: true })], [null, 'wake']);
check('nada conectado → null em tudo', fontesOps({}), { pedidos: null, estoque: null, catalogoLoja: null });
check('só o Tiny tem adaptador de pedidos na v1', [temAdaptadorPedidos('tiny'), temAdaptadorPedidos('bling'), temAdaptadorPedidos(null)], [true, false, false]);

// --- Normalização -----------------------------------------------------------
check('situações do Tiny', ['Em aberto', 'Preparando envio', 'Pronto para envio', 'Enviado', 'Entregue', 'Cancelado', 'Não Entregue', ''].map(normalizarSituacao),
  ['aberto', 'aprovado', 'faturado', 'enviado', 'entregue', 'cancelado', 'outro', 'outro']);
check('códigos da tabela e descrição com complemento', ['preparando_envio', 'pronto_envio', 'Faturado (atendido)', 'nao_entregue', 'ENTREGUE'].map(normalizarSituacao),
  ['aprovado', 'faturado', 'faturado', 'outro', 'entregue']);
check('canal: canalVenda antes do nome da integração', detalheTiny({ ecommerce: { nomeEcommerce: 'Integração X', canalVenda: 'Mercado Livre' } }).canal, 'Mercado Livre');
check('números BR e US', [numeroBr('1.234,56'), numeroBr('1234.56'), numeroBr(10), numeroBr('x'), numeroBr(null)], [1234.56, 1234.56, 10, 0, 0]);
check('data dd/mm/aaaa → ISO', [dataIso('03/10/2026'), dataIso('lixo')], ['2026-10-03', '']);
const AGORA = Date.parse('2026-10-04T02:30:00Z'); // 03/10 23:30 em Brasília
check('dia em Brasília, não em UTC', diaBrt(AGORA), '2026-10-03');
check('dataAtualizacao no formato do Tiny', dataHoraBr(AGORA), '03/10/2026 23:30:00');

const resumo = resumoTiny({ id: 77, numero: '1001', data_pedido: '01/10/2026', valor: '199,90', situacao: 'Aprovado' }, 'T');
check('resumo do pesquisa', resumo, { fonte: 'tiny', idExterno: '77', numero: '1001', data: '2026-10-01', situacao: 'aprovado', situacaoOriginal: 'Aprovado', valor: 199.9, dataPrevista: null, atualizadoEm: 'T' });
check('resumo sem data é descartado', resumoTiny({ id: 1 }, 'T'), null);
const det = detalheTiny({ total_pedido: '50.00', situacao: 'Faturado', ecommerce: { nomeEcommerce: 'Mercado Livre' }, itens: [{ item: { codigo: 'A1', quantidade: '2', valor_unitario: '25' } }, { item: { codigo: '', quantidade: 1 } }] });
check('detalhe: itens com SKU, canal e situação', [det.itens, det.canal, det.valor, det.situacao], [[{ sku: 'A1', qtd: 2, valor: 25 }], 'Mercado Livre', 50, 'faturado']);
check('detalhe sem e-commerce → Sem canal', detalheTiny({ itens: [] }).canal, 'Sem canal');

// --- Sync -------------------------------------------------------------------
const est = estadoInicial('tiny', AGORA);
check('backfill começa hoje e vai até 90 dias atrás', [est.backfill.ate, est.backfill.alvo], ['2026-10-04', '2026-07-05']);
check('primeira janela: os 7 dias até hoje', janelaBackfill(est.backfill), { inicio: '2026-09-27', fim: '2026-10-03' });
check('última janela é cortada no alvo', janelaBackfill({ ate: '2026-07-08', alvo: '2026-07-05', pagina: 1 }), { inicio: '2026-07-05', fim: '2026-07-07' });
check('histórico completo → sem janela', janelaBackfill({ ate: '2026-07-05', alvo: '2026-07-05', pagina: 1 }), null);
check('progresso 0 no início e 1 no fim', [progressoBackfill(est.backfill, AGORA), progressoBackfill({ ...est.backfill, ate: est.backfill.alvo }, AGORA)], [0, 1]);
check('orçamento por ciclo: 30% do limite do plano, entre 4 e 40', [orcamentoDoCiclo(null), orcamentoDoCiclo(20), orcamentoDoCiclo(30), orcamentoDoCiclo(60), orcamentoDoCiclo(120), orcamentoDoCiclo(1000)], [6, 6, 9, 18, 36, 40]);
check('estado do sync: importando → em dia → credencial → pausado', [
  estadoDoSync(est, AGORA).estado,
  estadoDoSync({ ...est, backfill: { ...est.backfill, ate: est.backfill.alvo } }, AGORA).estado,
  estadoDoSync({ ...est, erro: 'credencial' }, AGORA).estado,
  estadoDoSync({ ...est, proximaEm: null }, AGORA).estado,
], ['importando', 'em-dia', 'credencial', 'pausado']);

// --- Indicadores de pedidos ---------------------------------------------------
const hoje = diaBrt(AGORA);
const ped = (id, diasAtras, valor, situacao = 'aprovado', extra = {}) =>
  ({ idExterno: id, numero: id, data: somaDias(hoje, -diasAtras), situacao, valor, detalhado: false, ...extra });
const pedidos = [
  ped('1', 0, 100, 'aberto'),
  ped('2', 0, 300, 'cancelado'),
  ped('3', 3, 200, 'enviado', { detalhado: true, canal: 'Loja', itens: [{ sku: 'A', qtd: 2, valor: 100 }] }),
  ped('4', 5, 100, 'aprovado', { detalhado: true, canal: 'Mercado Livre', itens: [{ sku: 'A', qtd: 1, valor: 100 }] }),
  ped('5', 10, 50, 'entregue'),
  ped('6', 40, 400, 'aberto'),
  ped('7', 1, 80, 'faturado'),
];
const pp = painelPedidos(pedidos, AGORA);
check('hoje: cancelado não conta na receita', [pp.periodos.hoje.receita, pp.periodos.hoje.pedidos], [100, 1]);
check('7 dias e o período anterior', [pp.periodos.d7.receita, pp.periodos.d7.pedidos, pp.periodos.d7.anterior.receita], [480, 4, 50]);
check('ticket médio de 30 dias', pp.periodos.d30.ticket, 530 / 5);
check('série tem 30 dias e termina hoje', [pp.serie.length, pp.serie[29].dia, pp.serie[29].receita], [30, hoje, 100]);
check('canais só dos detalhados, por receita', pp.canais.map((c) => c.nome), ['Loja', 'Mercado Livre']);
check('fração detalhada de 30 dias', pp.detalhados, 2 / 6);
check('funil de 30 dias', [pp.funil.aberto, pp.funil.cancelado, pp.funil.entregue], [1, 1, 1]);
check('parados: aberto há 40 dias e aprovado há 5', pp.parados.map((p) => [p.numero, p.dias]), [['6', 40], ['4', 5]]);
check('vendidos por SKU', pp.vendidos30d, { A: 3 });
check('variação', [variacao(150, 100), variacao(5, 0)], [0.5, null]);

// --- Estoque ----------------------------------------------------------------
const pe = painelEstoque([
  { 'Código (SKU)': 'PAI', 'Descrição': 'Camiseta', 'Estoque': 99 },
  { 'Código (SKU)': 'PAI-P', 'Código do pai': 'PAI', 'Descrição': 'Camiseta P', 'Estoque': 0 },
  { 'Código (SKU)': 'PAI-M', 'Código do pai': 'PAI', 'Descrição': 'Camiseta M', 'Estoque': '3', 'Estoque mínimo': '5' },
  { 'Código (SKU)': 'B', 'Descrição': 'Boné', 'Estoque': 0 },
  { 'Código (SKU)': 'C', 'Descrição': 'Caneca' },
  { 'Código (SKU)': 'D', 'Descrição': 'Disco', 'Estoque': '1.000,00' },
], { 'PAI-P': 4, 'PAI-M': 30, D: 30 });
check('pai de variação fica de fora', pe.avaliados, 4);
check('sem estoque informado', pe.semEstoqueInformado, 1);
check('esgotados e os que vendiam', [pe.esgotados, pe.esgotadosQueVendiam.map((i) => i.sku)], [2, ['PAI-P']]);
check('abaixo do mínimo', pe.abaixoMinimo.map((i) => i.sku), ['PAI-M']);
check('cobertura curta (3 un a 1/dia = 3 dias)', pe.coberturaCurta.map((i) => [i.sku, i.diasCobertura]), [['PAI-M', 3]]);


// --- Entrega ----------------------------------------------------------------
const dia = (n) => somaDias(hoje, -n);
check('detalhe traz as datas do ciclo', detalheTiny({ data_prevista: '05/10/2026', data_faturamento: '01/10/2026', data_envio: '02/10/2026', data_entrega: '', forma_envio: 'PAC' }).datas,
  { dataPrevista: '2026-10-05', dataFaturamento: '2026-10-01', dataEnvio: '2026-10-02', dataEntrega: null, formaEnvio: 'PAC' });
check('mediana e p90', distribuicao([1, 2, 3, 4, 10]), { mediana: 3, p90: 10, amostra: 5 });
check('distribuição vazia → null', distribuicao([]), null);
const ent = painelEntrega([
  { ...ped('e1', 10, 100, 'entregue'), dataEnvio: dia(9), dataEntrega: dia(5), dataPrevista: dia(4), formaEnvio: 'PAC' },
  { ...ped('e2', 10, 100, 'entregue'), dataEnvio: dia(8), dataEntrega: dia(6), dataPrevista: dia(7), formaEnvio: 'SEDEX' },
  { ...ped('e3', 6, 100, 'enviado'), dataEnvio: dia(5), dataPrevista: dia(1) },
  { ...ped('e4', 6, 100, 'aprovado'), dataPrevista: dia(3) },
  { ...ped('e5', 6, 100, 'cancelado'), dataPrevista: dia(3) },
  { ...ped('e6', 3, 100, 'outro'), situacaoOriginal: 'Não Entregue', dataPrevista: dia(1) },
  { ...ped('e7', 1, 100, 'aprovado'), dataPrevista: somaDias(hoje, 3) },
], AGORA);
check('pedido → envio', ent.ateEnviar, { mediana: 1, p90: 2, amostra: 3 });
check('transporte', ent.transporte, { mediana: 2, p90: 4, amostra: 2 });
check('no prazo: 1 de 2 com previsão', ent.noPrazo, { fracao: 0.5, amostra: 2 });
check('atrasados: previsão vencida, sem cancelado nem não entregue', ent.atrasados.map((a) => [a.numero, a.diasAtraso]), [['e4', 3], ['e3', 1]]);
check('não entregues à parte', ent.naoEntregues, 1);
check('por forma de envio', ent.porFormaEnvio.map((f) => f.forma).sort(), ['PAC', 'SEDEX']);

// --- Catálogo e preços ----------------------------------------------------------
const erp = itensErp([
  { 'Código (SKU)': 'PAI', _tinyProductId: '1', 'Preço': 99 },
  { 'Código (SKU)': 'PAI-P', 'Código do pai': 'PAI', _tinyProductId: '2', 'Preço': '100,00', 'Preço promocional': '90', 'Estoque': 5, 'Preço de custo': '80' },
  { 'Código (SKU)': 'A', _tinyProductId: '3', 'Preço': 50, 'Estoque': 10 },
  { 'Código (SKU)': 'B', _tinyProductId: '4', 'Preço': 30, 'Estoque': 0 },
  { 'Código (SKU)': 'SO-APP', 'Preço': 10 },
]);
check('lado ERP: só produtos do ERP, sem o pai', erp.map((e) => e.sku), ['PAI-P', 'A', 'B']);
check('preço final do ERP usa o promocional menor', [precoFinalErp(erp[0]), precoFinalErp(erp[1])], [90, 50]);
const lojaW = [
  { produtoVarianteId: 11, produtoId: 1, sku: 'PAI-P', nome: 'Camiseta P', precoPor: 90, precoDe: 120, precoCusto: 0, exibirSite: true, valido: true, estoque: [{ estoqueFisico: 6, estoqueReservado: 1 }] },
  { produtoVarianteId: 12, produtoId: 2, sku: 'B', nome: 'Boné', precoPor: 35, precoDe: 0, precoCusto: 40, exibirSite: true, valido: true, estoque: [{ estoqueFisico: 3 }] },
  { produtoVarianteId: 13, produtoId: 3, sku: 'X', nome: 'Extra', precoPor: 0, exibirSite: false, valido: true, estoque: [{ estoqueFisico: 7 }] },
  { produtoVarianteId: 14, produtoId: 4, sku: 'Z', nome: 'Zero', precoPor: 0, exibirSite: true, valido: true, estoque: [] },
].map(itemLojaWake);
check('item da Wake: estoque físico − reservado, sem custo zero', [lojaW[0].estoque, lojaW[0].precoCusto, lojaW[3].estoque], [5, null, null]);
check('item da Wake sem SKU é descartado', itemLojaWake({ produtoVarianteId: 1 }), null);
const cat = painelCatalogo(erp, lojaW);
check('fora da loja, com estoque primeiro', [cat.foraDaLoja.total, cat.foraDaLoja.comEstoque, cat.foraDaLoja.itens[0].sku], [1, 1, 'A']);
check('fora do ERP', cat.foraDoErp.itens.map((i) => i.sku), ['X', 'Z']);
check('oculto com estoque', cat.ocultosComEstoque.itens.map((i) => [i.sku, i.estoque]), [['X', 7]]);
check('estoque diferente entre ERP e loja', cat.estoqueDiferente.itens.map((i) => [i.sku, i.erp, i.loja]), [['B', 0, 3]]);
const pr = painelPrecos(erp, lojaW);
check('preço diferente: ERP 30 × loja 35', pr.precoDiferente.itens.map((i) => [i.sku, i.erp, i.loja]), [['B', 30, 35]]);
check('à venda sem preço', pr.semPrecoNaLoja.itens.map((i) => i.sku), ['Z']);
check('promoção da loja e desconto', [pr.promocoes.total, pr.promocoes.itens[0].desconto], [1, 0.25]);
check('custo da Wake na frente do ERP; ERP quando a Wake não tem', [pr.abaixoDoCusto.itens.map((m) => m.sku), pr.margemBaixa.itens.map((m) => [m.sku, m.margem])], [['B'], [['PAI-P', 0.11]]]);
check('só a loja: sem comparação, promoções seguem', [painelCatalogo(null, lojaW).comparado, painelPrecos(null, lojaW).promocoes.total, painelPrecos(null, lojaW).precoDiferente.total], [false, 1, 0]);

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
