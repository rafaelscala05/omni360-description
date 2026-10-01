// Verificação da lógica pura da tela "Fontes e conectores" (src/modules/agent/conectores.ts).
// Rodar com: npx tsx scripts/verify-conectores.mjs
import { montarConectores, resumoFontes } from '../src/modules/agent/conectores.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const integ = (chave, over = {}) => ({ chave, nome: chave, papel: 'ERP', conectado: false, validado: false, detalhe: null, ultimaValidacao: null, ...over });
const lista = montarConectores({
  integracoes: [
    integ('wake'),
    integ('tiny', { conectado: true, validado: true }),
    integ('bling', { erro: 'HTTP 500' }),
    integ('idworks', { conectado: true, validado: false }),
  ],
  ferramentas: { tiny: 9, content: 41, produtos: 8, meli: 3 },
  hasContentAgent: true,
  hasMeli: true,
});

check('ordem: atenção, conectados, disponíveis', lista.map((c) => [c.id, c.secao]), [
  ['bling', 'atencao'], ['idworks', 'atencao'],
  ['tiny', 'conectado'], ['meli', 'conectado'], ['content', 'conectado'], ['produtos', 'conectado'],
  ['wake', 'disponivel'],
]);
check('falha de checagem não vira "não conectado"', lista.find((c) => c.id === 'bling').alerta, 'Não conseguimos checar a conexão');
check('credencial sem validação pede reconexão', lista.find((c) => c.id === 'idworks').alerta, 'A credencial não foi confirmada — reconecte');
check('conectado diz o que libera e quantas ferramentas', lista.find((c) => c.id === 'tiny').linha, 'Produtos, preço, estoque, pedidos e envio do catálogo · 9 ferramentas');
check('disponível diz o que libera', lista.find((c) => c.id === 'wake').linha, 'Libera: banners, hotsites, preço, estoque e SEO da loja');
check('catálogo e conteúdo não têm o que conectar', lista.filter((c) => !c.conectavel).map((c) => c.id), ['meli', 'content', 'produtos']);
check('singular de ferramenta', montarConectores({ integracoes: [], ferramentas: { produtos: 1 }, hasContentAgent: false, hasMeli: false })[0].linha, 'Produtos, categorias, descrições e imagens · 1 ferramenta');
check('sem módulos, só o catálogo', montarConectores({ integracoes: [], ferramentas: {}, hasContentAgent: false, hasMeli: false }).map((c) => c.id), ['produtos']);
check('resumo das fontes', resumoFontes(lista), { fontes: 6, paraConectar: 1, atencao: 2 });

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
