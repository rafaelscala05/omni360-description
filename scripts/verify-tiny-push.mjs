// Verificação do envio para o Tiny: (1) o push nunca escreve dados fiscais /
// logísticos e (2) o parser da v2 expõe o erro real por registro. Não sobe
// servidor e não toca o Firestore (o fetch é dublado).
// Rodar com: npx tsx scripts/verify-tiny-push.mjs
import { buildProductPutBody } from '../server/tinyAgent.ts';
import { tinyV2CallRaw, buildV2AlterarPayload, normalizeV2Product } from '../server/tinyV2.ts';

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

const { body, steps, enviado } = buildProductPutBody(noTiny, localComFiscal);

check('ncm preservado do Tiny', body.ncm, '63026000');
check('gtin (código de barras) preservado do Tiny', body.gtin, '7891234567890');
check('dimensões/pesos preservados do Tiny', body.dimensoes, noTiny.dimensoes);
check('v3 não tem cest no modelo, não inventa o campo', 'cest' in body, false);
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

// --- 1b. log do que foi enviado (v3) --------------------------------------
// O log nasce na mesma decisão que grava o campo, então ele não pode divergir
// do payload: tudo que está no log tem que estar no body, e nada fiscal entra.
check('log lista os campos gravados', enviado.map((e) => e.campo), [
  'Nome do produto', 'Descrição complementar', 'Título SEO', 'Imagens novas',
]);
check('log traz o conteúdo do título', enviado[0].valor, 'Toalha de Banho Premium');
check('log traz o HTML da descrição', enviado[1].valor, '<p>nova descrição</p>');
check('log mede o tamanho real', enviado[1].bytes, Buffer.byteLength('<p>nova descrição</p>', 'utf8'));
check('log de imagens traz só a URL nova', enviado[3].itens, ['https://cdn.omni/nova.jpg']);
check('nenhum campo fiscal aparece no log', enviado.some((e) => /NCM|GTIN|Peso|Largura/i.test(e.campo)), false);

// Texto longo é cortado na exibição, mas o tamanho real vai junto.
const htmlGrande = '<p>' + 'x'.repeat(2000) + '</p>';
const grande = buildProductPutBody(noTiny, { tinyId: '1', descricaoHtml: htmlGrande });
const entradaGrande = grande.enviado.find((e) => e.campo === 'Descrição complementar');
check('valor longo é truncado', entradaGrande.valor.length, 601);
check('truncagem é sinalizada', entradaGrande.truncado, true);
check('bytes reportam o tamanho original', entradaGrande.bytes, Buffer.byteLength(htmlGrande, 'utf8'));
check('o payload continua com o HTML inteiro', grande.body.descricaoComplementar, htmlGrande);

// Nada gravado → log vazio.
check('sem alteração não gera log', buildProductPutBody(noTiny, { tinyId: '1', descricaoHtml: '<p>antiga</p>' }).enviado, []);

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

// --- 3b. v2: produto.alterar devolve os dados do Tiny de volta -------------
// produto.alterar.php é uma operação de registro inteiro: campo que não vai no
// payload não é "mantido", é zerado. Por isso o payload eco tudo que o Tiny já
// tem em vez de omitir. Repare no camelCase: obter responde larguraEmbalagem,
// alterar lê largura_embalagem.
const noTinyV2 = {
  id: '777',
  codigo: 'TATH05-1',
  nome: 'Fone de Ouvido Tascam TH-05',
  unidade: 'UN',
  preco: '487.78',
  origem: '1',
  situacao: 'A',
  tipo: 'P',
  ncm: '85183000',
  cest: '2106400',
  gtin: '7891234567890',
  peso_liquido: '0.320',
  peso_bruto: '0.450',
  larguraEmbalagem: '18.5',
  alturaEmbalagem: '9.0',
  comprimentoEmbalagem: '22.0',
  tipoEmbalagem: '2',
  estoque_minimo: '2.00',
  garantia: '12 meses',
  marca: 'Tascam',
  preco_custo: '300.00',
  localizacao: 'A-12',
  categoria: 'Áudio >> Fones',
  descricao_complementar: '<p>antiga</p>',
  diasPreparacao: '3',
  tipoEmbalagem: '0',
  id_fornecedor: '0',
  seo: { seo_title: 'Fone Tascam TH-05', seo_description: 'desc antiga', slug: 'fone-tascam-th-05', link_video: 'https://youtu.be/x' },
};

const { produto, steps: st2, enviado: env2, hasAnyChange } = buildV2AlterarPayload(noTinyV2, {
  tinyId: '777',
  nome: 'Fone de Ouvido Tascam TH-05 Monitoramento Profissional',
  descricaoHtml: '<p>nova descrição</p>',
});

check('peso líquido devolvido ao Tiny', produto.peso_liquido, '0.320');
check('peso bruto devolvido ao Tiny', produto.peso_bruto, '0.450');
check('largura convertida para snake_case', produto.largura_embalagem, '18.5');
check('altura convertida para snake_case', produto.altura_embalagem, '9.0');
check('comprimento convertido para snake_case', produto.comprimento_embalagem, '22.0');
check('ncm preservado', produto.ncm, '85183000');
check('cest preservado', produto.cest, '2106400');
check('gtin preservado', produto.gtin, '7891234567890');
check('garantia preservada', produto.garantia, '12 meses');
check('marca preservada', produto.marca, 'Tascam');
check('preço de custo preservado', produto.preco_custo, '300.00');
check('estoque mínimo preservado', produto.estoque_minimo, '2.00');
check('localização preservada', produto.localizacao, 'A-12');
check('categoria preservada', produto.categoria, 'Áudio >> Fones');
check('campos obrigatórios ecoados', [produto.unidade, produto.preco, produto.origem, produto.situacao, produto.tipo], ['UN', '487.78', '1', 'A', 'P']);
check('descrição local é a única coisa nova', produto.descricao_complementar, '<p>nova descrição</p>');
check('título local aplicado', produto.nome, 'Fone de Ouvido Tascam TH-05 Monitoramento Profissional');
check('há mudança a enviar', hasAnyChange, true);
check('log v2 registra só o que foi gravado', env2.map((e) => e.campo), ['Nome do produto', 'Descrição complementar']);
check('log v2 não inclui os campos ecoados', env2.some((e) => /NCM|CEST|Peso|Marca|Garantia/i.test(e.campo)), false);
check('passos v2', st2, { titulo: 'ok', descricao: 'ok', seo: 'sem dado local', imagens: 'sem dado local' });

// Campo que o Tiny não tem não é inventado no payload.
check('campo vazio no Tiny não é enviado', 'obs' in produto, false);
check('chave em camelCase no obter é reconhecida', produto.dias_preparacao, '3');

// O bloco seo vai em TODA chamada, mesmo num envio só de descrição — deixá-lo
// de fora arriscaria resetá-lo do mesmo jeito que os pesos foram resetados.
check('seo preservado num envio só de descrição', produto.seo, {
  seo_title: 'Fone Tascam TH-05', seo_description: 'desc antiga',
  slug: 'fone-tascam-th-05', link_video: 'https://youtu.be/x',
});
check('envio só de descrição não marca seo como alterado', st2.seo, 'sem dado local');

// SEO novo sobrescreve só o que mudou; slug e link_video continuam.
const comSeo = buildV2AlterarPayload(noTinyV2, { tinyId: '777', seoTitle: 'Título SEO novo' });
check('seo_title novo aplicado', comSeo.produto.seo.seo_title, 'Título SEO novo');
check('seo_description antigo preservado', comSeo.produto.seo.seo_description, 'desc antiga');
check('slug preservado', comSeo.produto.seo.slug, 'fone-tascam-th-05');
check('link_video preservado', comSeo.produto.seo.link_video, 'https://youtu.be/x');
check('passo seo marcado como enviado', comSeo.steps.seo, 'ok');
check('log v2 registra o SEO gravado', comSeo.enviado.map((e) => e.campo), ['Título SEO']);
check('log v2 traz o valor do SEO', comSeo.enviado[0].valor, 'Título SEO novo');

// Campo recusado pelo limite não entra no log — ele não foi enviado.
const recusado = buildV2AlterarPayload(noTinyV2, { tinyId: '777', seoDescription: 'D'.repeat(256) });
check('campo recusado não entra no log', recusado.enviado, []);

// obter responde "0" para "não definido"; alterar só aceita 1/2/3 em
// tipo_embalagem e exige fornecedor cadastrado — ecoar o zero viraria erro.
check('tipo_embalagem 0 não é ecoado', 'tipo_embalagem' in produto, false);
check('id_fornecedor 0 não é ecoado', 'id_fornecedor' in produto, false);
const comEmbalagem = buildV2AlterarPayload({ ...noTinyV2, tipoEmbalagem: '2' }, { tinyId: '777', descricaoHtml: '<p>x</p>' });
check('tipo_embalagem válido é ecoado', comEmbalagem.produto.tipo_embalagem, '2');

// Limites documentados do layout: acima deles o Tiny recusa o registro inteiro.
const seoLongo = buildV2AlterarPayload(noTinyV2, {
  tinyId: '777',
  seoDescription: 'D'.repeat(256),
  seoTitle: 'Título SEO aceitável',
});
check('seo_description acima de 255 não é enviado', seoLongo.produto.seo.seo_description, 'desc antiga');
check('seo_title dentro do limite é enviado', seoLongo.produto.seo.seo_title, 'Título SEO aceitável');
checkMatch('recusa do seo é reportada', seoLongo.steps.seo, /seo_description com 256 caracteres \(máx\. 255\)/);

const soRecusa = buildV2AlterarPayload(noTinyV2, { tinyId: '777', seoTitle: 'T'.repeat(121) });
check('seo_title acima de 120 não é enviado', soRecusa.produto.seo.seo_title, 'Fone Tascam TH-05');
check('nada a enviar quando só havia o campo recusado', soRecusa.hasAnyChange, false);

// Nada local mudou → nem chega a montar chamada.
const semMudanca = buildV2AlterarPayload(noTinyV2, { tinyId: '777', descricaoHtml: '<p>antiga</p>' });
check('sem diferença não gera chamada', semMudanca.hasAnyChange, false);

// normalizeV2Product tem que ler o camelCase do obter.
const norm = normalizeV2Product(noTinyV2);
check('normalizador lê larguraEmbalagem', norm.largura, 18.5);
check('normalizador lê alturaEmbalagem', norm.altura, 9);
check('normalizador lê comprimentoEmbalagem', norm.comprimento, 22);

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
