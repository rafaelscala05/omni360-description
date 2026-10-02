// Verificação da tela "Agente Produtos" (src/modules/agent/produtosAgente.ts).
// Rodar com: npx tsx scripts/verify-produtos-agente.mjs
import {
  principais, pilulasDe, contarFiltros, filtrarProdutos, pedidoDaSelecao, FILTROS_DO_SEGMENTO, MAX_SKUS_CONTEXTO,
  aplicarFiltros, contarOpcoes, FILTROS_PADRAO, FILTROS_VAZIOS, quantosFiltrosAtivos, paginar, paginasVisiveis, estadoSelecao, categoriaDe,
} from '../src/modules/agent/produtosAgente.ts';
import { resumoConteudo, resumoProdutos, sugestoesAlfred, PROMPT_MONTAR_SEMANA } from '../src/modules/agent/painelFerramentas.ts';

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

// --- Filtros por grupo (painel de filtros) --------------------------------------
{
  const P = (sku, over = {}) => ({ _id: sku, 'Código (SKU)': sku, 'Descrição': sku, 'URL imagem 1': 'https://f', 'Descrição complementar': 'ok', ...over });
  const L = [
    P('T1', { _tinyProductId: '1', Categoria: 'Camisetas' }),                                   // tiny em dia
    P('T2', { _tinyProductId: '2', _statusDescricao: 'Gerado por IA', Categoria: 'Camisetas' }), // tiny pendente (sem carimbo, gerado)
    P('W1', { _wakeProductId: 'w', 'Descrição complementar': '' }),                              // wake, sem descrição
    P('N1', { 'URL imagem 1': '' }),                                                              // só OMNI360, sem foto
  ];
  const f = (over) => ({ ...FILTROS_VAZIOS, ...over });
  check('vazio mostra tudo', aplicarFiltros(L, FILTROS_VAZIOS).map((x) => x._id), ['T1', 'T2', 'W1', 'N1']);
  check('OU dentro do grupo', aplicarFiltros(L, f({ integracao: ['wake', 'nenhuma'] })).map((x) => x._id), ['W1', 'N1']);
  check('E entre grupos', aplicarFiltros(L, f({ integracao: ['tiny'], sync: ['pendente'] })).map((x) => x._id), ['T2']);
  check('sincronização em dia exige vínculo', aplicarFiltros(L, f({ sync: ['emDia'] })).map((x) => x._id), ['T1', 'W1']);
  check('padrão = incompletos', aplicarFiltros(L, FILTROS_PADRAO).map((x) => x._id), ['W1', 'N1']);
  check('categoria', aplicarFiltros(L, f({ categoria: ['Camisetas'] })).map((x) => x._id), ['T1', 'T2']);
  check('sem categoria tem nome', categoriaDe(L[2]), 'Sem categoria');
  check('busca combina com filtros', aplicarFiltros(L, f({ integracao: ['tiny'] }), 't2').map((x) => x._id), ['T2']);
  const c = contarOpcoes(L, f({ integracao: ['tiny'] }));
  check('contagem do próprio grupo ignora a seleção dele', c.integracao, { tiny: 2, wake: 1, bling: 0, idworks: 0, nenhuma: 1 });
  check('contagem dos outros grupos respeita a integração escolhida', c.sync, { emDia: 1, pendente: 1 });
  check('filtros ativos', quantosFiltrosAtivos(f({ integracao: ['tiny'], conteudo: ['semFoto', 'semDescricao'] })), 3);
}

// --- Paginação e seleção ----------------------------------------------------------
{
  const n = Array.from({ length: 120 }, (_, i) => i);
  const p2 = paginar(n, 2);
  check('página 2 de 50', [p2.itens[0], p2.itens.length, p2.inicio, p2.fim, p2.totalPaginas], [50, 50, 51, 100, 3]);
  check('última página parcial', paginar(n, 3).itens.length, 20);
  check('página fora do intervalo cai na última', paginar(n, 9).pagina, 3);
  check('lista vazia tem 1 página', [paginar([], 1).totalPaginas, paginar([], 1).inicio], [1, 0]);
  check('páginas visíveis com reticências', paginasVisiveis(5, 9), [1, '…', 4, 5, 6, '…', 9]);
  check('poucas páginas sem reticências', paginasVisiveis(1, 3), [1, 2, 3]);

  // Review Focus 4: seleção atravessa páginas e filtros.
  const pagina = ['a', 'b'];
  check('página toda marcada e mais no filtro oferece todos',
    estadoSelecao(pagina, new Set(['a', 'b']), 412), { paginaToda: true, oferecerTodos: true });
  check('tudo do filtro já selecionado não oferece',
    estadoSelecao(pagina, new Set(['a', 'b']), 2), { paginaToda: true, oferecerTodos: false });
  check('seleção de outra página não conta como página toda',
    estadoSelecao(pagina, new Set(['a', 'z']), 412), { paginaToda: false, oferecerTodos: false });
}

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
// --- painel de Ferramentas ------------------------------------------------------
{
  const P = (sku, over = {}) => ({ _id: sku, 'Código (SKU)': sku, 'Descrição': sku, ...over });
  const r = resumoProdutos([
    P('A', { 'Descrição complementar': 'x', 'URL imagem 1': 'https://a', _tinyProductId: '1', _ambientImages: ['https://b'] }),
    P('B', { 'URL imagem 1': 'https://a' }),
    P('C', { 'Descrição complementar': 'x' }),
    P('A-1', { 'Código do pai': 'A' }),
    P('D', { _blingDeleted: true }),
  ]);
  check('resumo do catálogo (só pais, sem apagados)', r, { total: 3, incompletos: 2, semDescricao: 1, semFoto: 1, semAmbientada: 1, foraDoErp: 2 });
  const c = resumoConteudo([
    { id: '1', titulo: 'a', scheduledDate: '2026-09-29', status: 'revisao' },
    { id: '2', titulo: 'b', scheduledDate: '2026-09-02', status: 'publicado' },
    { id: '3', titulo: 'c', scheduledDate: '2026-08-30', status: 'publicado' },
  ], new Date(2026, 8, 30, 12));
  check('conteúdo: semana, revisão e publicados no mês', c, { semana: 1, revisao: 1, publicadosMes: 1 });
  const t = (id, prompt, estado = 'aberta') => ({ id, titulo: id, prompt, estado, dia: 2, origem: 'produto', destino: 'produtos' });
  const s = sugestoesAlfred([t('a', 'pa'), t('b', 'pb'), t('c', 'pc'), t('d', undefined), t('e', 'pe', 'feita')], t('a', 'pa'));
  check('Alfred sugere: sem o próximo passo, até 3, termina em montar a semana', s.map((x) => x.prompt), ['pb', 'pc', PROMPT_MONTAR_SEMANA]);
}

console.log('\nTudo certo.');
