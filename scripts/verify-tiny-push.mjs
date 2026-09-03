// Verificação do envio para o Tiny: (1) o push nunca escreve dados fiscais /
// logísticos e (2) o parser da v2 expõe o erro real por registro. Não sobe
// servidor e não toca o Firestore (o fetch é dublado).
// Rodar com: npx tsx scripts/verify-tiny-push.mjs
import { buildProductPutBody } from '../server/tinyAgent.ts';
import { tinyV2CallRaw } from '../server/tinyV2.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}
function checkMatch(label, actual, re) {
  const ok = re.test(String(actual));
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → ${re} não bate com ${JSON.stringify(String(actual))}`}`);
}

// --- 1. buildProductPutBody (v3) nunca sobrescreve fiscal ------------------
// Produto como está hoje no Tiny: dados fiscais corretos, cadastrados no ERP.
const noTiny = {
  sku: 'TATH05',
  descricao: 'Toalha de Banho',
  descricaoComplementar: '<p>antiga</p>',
  unidade: 'UN',
  ncm: '63026000',
  gtin: '7891234567890',
  dimensoes: { largura: 30, altura: 5, comprimento: 40, pesoLiquido: 0.5, pesoBruto: 0.6 },
  seo: { titulo: 'SEO antigo', descricao: 'desc antiga', keywords: ['a'] },
  anexos: [{ url: 'https://cdn.tiny/1.jpg', externo: true }],
};

// Payload local com fiscal DIVERGENTE (o que a planilha / enriquecimento por IA gera).
const localComFiscal = {
  tinyId: '1',
  nome: 'Toalha de Banho Premium',
  descricaoHtml: '<p>nova descrição</p>',
  seoTitle: 'SEO novo',
  ncm: '99999999',
  gtin: '0000000000000',
  pesoLiquido: 9.9,
  pesoBruto: 9.9,
  largura: 99,
  altura: 99,
  comprimento: 99,
  imagens: ['https://cdn.omni/nova.jpg'],
};

const { body, steps } = buildProductPutBody(noTiny, localComFiscal);

check('ncm preservado do Tiny', body.ncm, '63026000');
check('gtin (código de barras) preservado do Tiny', body.gtin, '7891234567890');
check('dimensões/pesos preservados do Tiny', body.dimensoes, noTiny.dimensoes);
check('nenhum campo cest é enviado', 'cest' in body, false);
check('não existe mais o passo fiscal', 'fiscal' in steps, false);

check('título é enviado', body.descricao, 'Toalha de Banho Premium');
check('descrição complementar é enviada', body.descricaoComplementar, '<p>nova descrição</p>');
check('SEO é enviado', body.seo.titulo, 'SEO novo');
check('SEO mantém irmãos não alterados', body.seo.descricao, 'desc antiga');
check('imagem nova mesclada com a existente', body.anexos, [
  { url: 'https://cdn.tiny/1.jpg', externo: true },
  { url: 'https://cdn.omni/nova.jpg', externo: true },
]);
check('passos reportados', steps, {
  titulo: 'ok', descricao: 'ok', seo: 'ok', imagens: 'ok',
});

// --- 2. limite de 120 caracteres do nome ----------------------------------
const tituloLongo = 'A'.repeat(121);
const r2 = buildProductPutBody(noTiny, { tinyId: '1', nome: tituloLongo });
check('título acima de 120 não vai para o Tiny', r2.body.descricao, 'Toalha de Banho');
checkMatch('título longo é reportado ao usuário', r2.steps.titulo, /121 caracteres.*m[áa]ximo 120/);

const r3 = buildProductPutBody(noTiny, { tinyId: '1', nome: 'A'.repeat(120) });
check('título com exatamente 120 é enviado', r3.body.descricao, 'A'.repeat(120));

// --- 3. sobrescrever título desmarcado ------------------------------------
const r4 = buildProductPutBody(noTiny, { tinyId: '1', nome: 'Outro título' }, false);
check('sobrescrita desativada mantém o título do Tiny', r4.body.descricao, 'Toalha de Banho');
check('passo título reportado como desativado', r4.steps.titulo, 'sobrescrita desativada');

// --- 4. parser de erro da v2 --------------------------------------------
// produto.alterar devolve HTTP 200 com status "Erro" no topo, SEM erros no topo:
// o motivo real fica em registros[].registro.erros. Antes isso virava o inútil
// "Tiny v2 status Erro (cod ?)".
const originalFetch = globalThis.fetch;
const mockRetorno = (retorno) => async () => new Response(JSON.stringify({ retorno }), { status: 200 });

globalThis.fetch = mockRetorno({
  status_processamento: 3,
  status: 'Erro',
  registros: [{ registro: { sequencia: 1, status: 'Erro', codigo_erro: 31, erros: [{ erro: 'Nome do produto excede o tamanho permitido' }] } }],
});
let msg = '';
try { await tinyV2CallRaw('tok', 'produto.alterar.php', {}); } catch (e) { msg = e.message; }
checkMatch('erro por registro aparece mesmo com status Erro no topo', msg, /Nome do produto excede/);
checkMatch('código do erro do registro aparece', msg, /cod 31/);
checkMatch('não cai mais no genérico "status Erro (cod ?)"', msg, /^(?!.*\(cod \?\)).*$/);

// Erro só no topo continua funcionando.
globalThis.fetch = mockRetorno({ status: 'Erro', codigo_erro: 3, erros: [{ erro: 'Token inválido' }] });
msg = '';
let status = 0;
try { await tinyV2CallRaw('tok', 'produto.alterar.php', {}); } catch (e) { msg = e.message; status = e.status; }
checkMatch('erro de topo preservado', msg, /\[cod 3\] Token inválido/);
check('token inválido vira 401', status, 401);

// "Nenhum registro" continua sendo resultado vazio, não erro.
globalThis.fetch = mockRetorno({ status: 'Erro', codigo_erro: 20, erros: [{ erro: 'A consulta não retornou registros' }] });
const vazio = await tinyV2CallRaw('tok', 'produtos.pesquisa.php', {});
check('codigo_erro 20 vira lista vazia', vazio.produtos, []);

// Sucesso passa direto.
globalThis.fetch = mockRetorno({ status: 'OK', registros: [{ registro: { sequencia: 1, status: 'OK', id: 42 } }] });
const ok = await tinyV2CallRaw('tok', 'produto.alterar.php', {});
check('resposta OK não lança', ok.status, 'OK');

globalThis.fetch = originalFetch;

console.log(failures === 0 ? '\nTudo certo.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
