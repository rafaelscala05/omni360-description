// Verificação das regras puras das ferramentas de Produto do agente
// (server/agent/produtosRules.ts). Não chama o Vertex nem o Firestore.
// Rodar com: npx tsx scripts/verify-agent-produtos.mjs
import {
  cortarHtml, faltando, normalizarGeracao, selecionarParaDescricao, textoPuro, variacoesDoPai,
  LOTE_PADRAO, MAX_DESCRICOES_POR_LOTE, MAX_HTML,
} from '../server/agent/produtosRules.ts';
import { chavePrevia } from '../server/agent/previewCache.ts';
import { resolveApprovalMode } from '../server/agent/agentSettings.ts';
import { creditActionsFor } from '../server/agent/execution.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const p = (sku, over = {}) => ({ _docId: `d-${sku}`, 'Código (SKU)': sku, 'Descrição': `Produto ${sku}`, ...over });
const catalogo = [
  p('A', { 'URL imagem 1': 'http://x/a.jpg' }),
  p('A-P', { 'Código do pai': 'A', 'Variações': 'Tamanho:P' }),
  p('A-M', { 'Código do pai': 'A', 'Variações': 'Tamanho:M' }),
  p('B', { 'Descrição complementar': '<p>ok</p>', 'Título SEO': 'B' }),
  ...Array.from({ length: 12 }, (_, i) => p(`C${i}`)),
];

// Seleção padrão: só pais sem descrição, no lote padrão.
const s1 = selecionarParaDescricao(catalogo, {});
check('lote padrão só com pais sem descrição', s1.escolhidos.map((x) => x['Código (SKU)']), ['A', 'C0', 'C1', 'C2', 'C3'].slice(0, LOTE_PADRAO));
check('conta os pais sem descrição (variações não entram)', s1.totalSemDescricao, 13);
check('limite é travado no máximo', selecionarParaDescricao(catalogo, { limite: 50 }).escolhidos.length, MAX_DESCRICOES_POR_LOTE);
check('limite mínimo é 1', selecionarParaDescricao(catalogo, { limite: 0 }).escolhidos.length, 1);

// Com SKUs: pedido explícito vale mesmo com descrição, e reporta o que não achou.
const s2 = selecionarParaDescricao(catalogo, { skus: ['b', 'ZZ', 'B'] });
check('SKU explícito aceita produto já descrito, sem duplicar', s2.escolhidos.map((x) => x['Código (SKU)']), ['B']);
check('SKU inexistente vai para naoEncontrados', s2.naoEncontrados, ['ZZ']);

check('variações do grupo no formato do prompt', variacoesDoPai(catalogo, 'A'), 'Tamanho:P | Tamanho:M');
check('produto sem variação', variacoesDoPai(catalogo, 'B'), 'Nenhuma');
check('faltando: descrição, foto e SEO', faltando(p('X')), ['descrição', 'foto', 'SEO']);
check('faltando: nada', faltando({ ...catalogo[3], 'URL imagem externa 1': 'http://y' }), []);

// Normalização da resposta do modelo.
check('decodifica entidades e mantém os campos', normalizarGeracao({
  descricao_html: '<p>Mesa &amp; cadeira</p>', titulo_seo: 'Mesa', descricao_seo: 'Meta', palavras_chave: 'mesa, cadeira',
}), { descricao: '<p>Mesa & cadeira</p>', tituloSeo: 'Mesa', descricaoSeo: 'Meta', palavrasChave: 'mesa, cadeira' });
let erro = null;
try { normalizarGeracao({ descricao_html: '   ' }); } catch (e) { erro = e.message; }
check('descrição vazia é erro, nunca grava ""', erro, 'O modelo não devolveu a descrição.');
const longo = '<div>' + '<p>abc def</p>'.repeat(400) + '</div>';
const cortado = normalizarGeracao({ descricao_html: longo }).descricao;
check('corta no teto do template', cortado.length <= MAX_HTML, true);
check('corte termina num fechamento de tag', cortado.endsWith('>'), true);
check('cortarHtml não deixa tag aberta pela metade', cortarHtml('<p>ab</p><p>cd<str', 14), '<p>ab</p>');
check('texto puro para a amostra', textoPuro('<h2>Oi</h2><p>tudo&nbsp;bem</p>'), 'Oi tudo bem');

// Cache da prévia: a ordem das chaves não muda o pedido.
check('chave da prévia ignora ordem dos argumentos', chavePrevia('t', { a: 1, b: [2] }) === chavePrevia('t', { b: [2], a: 1 }), true);
check('argumentos diferentes, chave diferente', chavePrevia('t', { a: 1 }) === chavePrevia('t', { a: 2 }), false);

// Publicar no Mercado Livre é trava fixa, mesmo no modo automático.
check('meli.proposta.publicar sempre pergunta', resolveApprovalMode({ approvalMode: 'auto' }, 'meli.proposta.publicar'), 'ask');
check('descrições seguem o modo configurado', resolveApprovalMode({ approvalMode: 'auto' }, 'produtos.descricoes.gerar'), 'auto');

// Créditos: um por produto do lote, nada para as leituras e para o MELI.
check('descrições debitam 1 geração em massa por produto',
  creditActionsFor({ name: 'produtos.descricoes.gerar', provider: 'produtos' }, { payload: { itens: [{}, {}, {}] } }).map((a) => a.key),
  ['generate_seo_mass', 'generate_seo_mass', 'generate_seo_mass']);
check('publicar no MELI não debita', creditActionsFor({ name: 'meli.proposta.publicar', provider: 'meli' }), []);

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
