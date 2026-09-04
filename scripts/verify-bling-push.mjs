// Verificação da lógica pura do envio ao Bling (server/blingAgent.ts):
// o corpo do PUT e o log do que foi enviado (server/pushLog.ts).
// Não sobe servidor e não toca o Firestore.
// Rodar com: npx tsx scripts/verify-bling-push.mjs
import { buildProductPutBody } from '../server/blingAgent.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// Produto como está no Bling hoje.
const atual = {
  nome: 'Toalha de Banho',
  codigo: 'TB01',
  tipo: 'P',
  situacao: 'A',
  unidade: 'UN',
  preco: 59.9,
  descricaoComplementar: '<p>antiga</p>',
  gtin: '7891234567890',
  pesoLiquido: 0.5,
  pesoBruto: 0.6,
  dimensoes: { largura: 30, altura: 5, profundidade: 40, unidadeMedida: 1 },
  tributacao: { ncm: '63026000', cest: '2810400', origem: 0 },
  midia: { imagens: { externas: [{ link: 'https://cdn.bling/1.jpg' }] } },
};

const todos = { descricao: true, seo: true, fiscal: true, imagens: true };

// --- 1. envio completo ----------------------------------------------------
const { body, enviado } = buildProductPutBody(atual, {
  blingId: '1',
  descricaoHtml: '<p>nova descrição</p>',
  ncm: '99999999',
  pesoLiquido: 1.25,
  imagens: ['https://cdn.bling/1.jpg', 'https://cdn.omni/nova.jpg'],
  campos: todos,
});

check('descrição nova entra no body', body.descricaoComplementar, '<p>nova descrição</p>');
check('ncm local sobrescreve (grupo fiscal ligado)', body.tributacao.ncm, '99999999');
check('cest não informado mantém o do Bling', body.tributacao.cest, '2810400');
check('peso líquido local aplicado', body.pesoLiquido, 1.25);
check('peso bruto sem valor local mantém o do Bling', body.pesoBruto, 0.6);
check('imagem existente preservada e a nova somada', body.midia.imagens.externas, [
  { link: 'https://cdn.bling/1.jpg' }, { link: 'https://cdn.omni/nova.jpg' },
]);

// --- 2. log do que foi enviado -------------------------------------------
check('log lista os campos gravados', enviado.map((e) => e.campo), [
  'Descrição complementar', 'NCM', 'Peso líquido (Kg)', 'Imagens novas',
]);
check('log traz o HTML da descrição', enviado[0].valor, '<p>nova descrição</p>');
check('log traz o NCM gravado', enviado[1].valor, '99999999');
check('log de imagens traz só a URL nova', enviado[3].itens, ['https://cdn.omni/nova.jpg']);
check('campo sem valor local não entra no log', enviado.some((e) => e.campo === 'CEST'), false);

// --- 3. grupos desligados -------------------------------------------------
const soDescricao = buildProductPutBody(atual, {
  blingId: '1',
  descricaoHtml: '<p>só isso</p>',
  ncm: '99999999',
  campos: { descricao: true, seo: false, fiscal: false, imagens: false },
});
check('grupo fiscal desligado não toca o ncm', soDescricao.body.tributacao.ncm, '63026000');
check('grupo desligado não entra no log', soDescricao.enviado.map((e) => e.campo), ['Descrição complementar']);

const nada = buildProductPutBody(atual, {
  blingId: '1',
  campos: { descricao: false, seo: false, fiscal: false, imagens: false },
});
check('nada selecionado → log vazio', nada.enviado, []);
check('nada selecionado → body ainda ecoa o produto atual', nada.body.gtin, '7891234567890');

// --- 4. truncagem ---------------------------------------------------------
const htmlGrande = '<p>' + 'x'.repeat(2000) + '</p>';
const grande = buildProductPutBody(atual, { blingId: '1', descricaoHtml: htmlGrande, campos: todos });
const entrada = grande.enviado.find((e) => e.campo === 'Descrição complementar');
check('valor longo é truncado na exibição', entrada.valor.length, 601);
check('truncagem é sinalizada', entrada.truncado, true);
check('bytes reportam o tamanho original', entrada.bytes, Buffer.byteLength(htmlGrande, 'utf8'));
check('o payload continua com o HTML inteiro', grande.body.descricaoComplementar, htmlGrande);

console.log(failures === 0 ? '\nTudo certo.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
