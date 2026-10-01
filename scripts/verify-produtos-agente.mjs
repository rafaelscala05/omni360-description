// Verificação da tela "Agente Produtos" (src/modules/agent/produtosAgente.ts).
// Rodar com: npx tsx scripts/verify-produtos-agente.mjs
import {
  principais, pilulasDe, contarFiltros, filtrarProdutos, pedidoDaSelecao, FILTROS_DO_SEGMENTO, MAX_SKUS_CONTEXTO,
} from '../src/modules/agent/produtosAgente.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const p = (sku, extra = {}) => ({ _id: sku, 'Código (SKU)': sku, 'Descrição': `Produto ${sku}`, ...extra });
const FOTO = { 'URL imagem 1': 'https://x/1.jpg' };
const catalogo = [
  p('A', { ...FOTO, 'Descrição complementar': '<p>ok</p>', _tinyProductId: '1' }),
  p('B', { ...FOTO }),                                      // sem descrição
  p('C', { 'Descrição complementar': 'ok' }),               // sem foto
  p('C-1', { 'Código do pai': 'C' }),                       // variação: não conta
  p('D', { ...FOTO, 'Descrição complementar': 'ok', _blingDeleted: true }), // excluído no ERP
  p('E', { ...FOTO, 'Descrição complementar': 'ok', _ambientImages: ['a'], _videoUrl: 'v.mp4' }),
  p('F', { ...FOTO, 'Descrição complementar': 'ok', _videoStatus: 'processing' }),
];

const lista = principais(catalogo);
check('só principais e não excluídos', lista.map((x) => x._id), ['A', 'B', 'C', 'E', 'F']);
check('contagem do catálogo', contarFiltros(lista, FILTROS_DO_SEGMENTO.catalogo), { incompletos: 2, todos: 5, foraDoErp: 4 });
check('contagem de imagens (ambientada só conta com foto)', contarFiltros(lista, FILTROS_DO_SEGMENTO.imagens), { semFoto: 1, semAmbientada: 3, todos: 5 });
check('sem vídeo ignora o que está gerando e o que não tem foto', filtrarProdutos(lista, 'semVideo').map((x) => x._id), ['A', 'B']);
check('busca por nome e por SKU', [filtrarProdutos(lista, 'todos', 'produto e').map((x) => x._id), filtrarProdutos(lista, 'todos', 'f').map((x) => x._id)], [['E'], ['F']]);

check('pílulas do catálogo: descrição e foto pesam, o resto é opcional',
  pilulasDe(lista[1], 'catalogo').map((x) => `${x.rotulo}:${x.estado}`),
  ['descrição:alerta', 'atributos:opcional', 'foto:ok', 'ambientada:opcional']);
check('pílula de vídeo rodando', pilulasDe(lista[4], 'videos').map((x) => x.estado), ['ok', 'rodando']);

const pedido = pedidoDaSelecao([lista[0], lista[1]]);
check('pedido com seleção leva os SKUs no contexto', pedido.contexto, { tela: 'produtos', skus: ['A', 'B'], totalSelecionados: 2 });
check('o texto conta os sem descrição', pedido.texto.includes('(1 sem descrição)'), true);
check('sem seleção não manda skus', pedidoDaSelecao([]).contexto, { tela: 'produtos' });
const muitos = Array.from({ length: 70 }, (_, i) => p(`S${i}`));
const grande = pedidoDaSelecao(muitos).contexto;
check('seleção grande é cortada mas o total é real', [grande.skus.length, grande.totalSelecionados], [MAX_SKUS_CONTEXTO, 70]);

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
