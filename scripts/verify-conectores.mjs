// Verificação da tela "Fontes e conectores" (src/modules/agent/conectores.ts).
// Rodar com: npx tsx scripts/verify-conectores.mjs
import { montarFontes, resumoFontes, entradasDoApp } from '../src/modules/agent/conectores.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const integracoes = [
  { chave: 'wake', conectado: false, validado: false, detalhe: null },
  { chave: 'tiny', conectado: true, validado: true, detalhe: '12.345.678/0001-90' },
  { chave: 'bling', conectado: false, validado: false, detalhe: null, erro: 'Erro 500' },
  { chave: 'idworks', conectado: true, validado: false, detalhe: 'loja' },
];

const entradas = entradasDoApp({
  integracoes, hasMeli: true, meli: { conectado: true, status: 'active' }, hasContentAgent: true, projetos: 1,
});
const f = montarFontes(entradas, { tiny: 13, produtos: 12, content: 41 }, { tiny: 2 });

check('catálogo sempre entra', entradas[0], { chave: 'produtos', conectado: true });
check('atenção: checagem falhou e credencial não validada', f.atencao.map((x) => [x.chave, x.acao]), [['bling', 'verificar'], ['idworks', 'revalidar']]);
check('atenção explica o motivo', f.atencao[0].linha, 'Não conseguimos checar a conexão');
check('conectados na ordem ERP → loja → resto', f.conectados.map((x) => x.chave), ['tiny', 'meli', 'content', 'produtos']);
check('linha do conectado com conta e ferramentas', f.conectados[0].linha, 'Produtos, pedidos, estoque · 12.345.678/0001-90 · 13 ferramentas');
check('uma ferramenta no singular', montarFontes([{ chave: 'tiny', conectado: true }], { tiny: 1 }).conectados[0].linha, 'Produtos, pedidos, estoque · 1 ferramenta');
check('projetos de conteúdo', f.conectados[2].linha, 'Clusters, calendário, artigos · 1 projeto · 41 ferramentas');
check('pendentes por fonte', f.conectados[0].pendentes, 2);
check('disponível diz o que libera', f.disponiveis.map((x) => x.linha), ['Libera: banners, preço, SEO da loja']);
check('disponível não exibe ferramentas', f.disponiveis[0].ferramentas, 0);
check('resumo do rodapé', resumoFontes(f), { ativas: 6, paraConectar: 1, alerta: 2 });

const semModulos = entradasDoApp({ integracoes, hasMeli: false, meli: { conectado: true, status: 'active' }, hasContentAgent: false });
const dispSemModulo = montarFontes(semModulos).disponiveis.filter((x) => x.chave === 'meli' || x.chave === 'content');
check('sem módulo, ML e Conteúdo ficam disponíveis para montar', dispSemModulo.map((x) => x.chave), ['meli', 'content']);
check('sem módulo, a linha diz o que libera', dispSemModulo.map((x) => x.linha), ['Libera: anúncios e propostas do otimizador', 'Libera: artigos, calendário e SEO']);

const reauth = montarFontes(entradasDoApp({ integracoes: [], hasMeli: true, meli: { conectado: false, status: 'reauthorization_required' }, hasContentAgent: false }));
check('ML com autorização vencida vai para atenção, mesmo com connected false', reauth.atencao.map((x) => [x.chave, x.acao]), [['meli', 'reconectar']]);

const meliErro = montarFontes(entradasDoApp({ integracoes: [], hasMeli: true, meli: { erro: 'offline' }, hasContentAgent: false }));
check('falha ao checar o ML pede verificação', meliErro.atencao.map((x) => x.acao), ['verificar']);

const meliOff = montarFontes(entradasDoApp({ integracoes: [], hasMeli: true, meli: { conectado: false, status: 'disconnected' }, hasContentAgent: false }));
check('ML desconectado fica disponível', meliOff.disponiveis.filter((x) => x.chave === 'meli').map((x) => x.chave), ['meli']);

const meliCarregando = entradasDoApp({ integracoes: [], hasMeli: true, meli: null, hasContentAgent: false });
check('ML ainda não checado não aparece (nem como disponível)', meliCarregando.some((e) => e.chave === 'meli'), false);

check('chave repetida não duplica', montarFontes([{ chave: 'tiny', conectado: true }, { chave: 'tiny', conectado: false }]).conectados.length, 1);

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
