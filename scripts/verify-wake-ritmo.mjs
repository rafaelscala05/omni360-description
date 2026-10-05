// Verificação do ritmo das chamadas à Wake na importação (server/wakeRitmo.ts,
// fbitsFetch e aggregateProduct em server/wakeAgent.ts). Sem rede: fetch falso.
// Rodar com: npx tsx scripts/verify-wake-ritmo.mjs
import { aguardarVaga, CHAMADAS_POR_MINUTO, esquecerToken } from '../server/wakeRitmo.ts';
import { aggregateProduct, esperasLimitePorToken, fbitsFetch } from '../server/wakeAgent.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// --- 1 · Janela deslizante com relógio falso ---------------------------------
let t = 0;
const relogio = { agora: () => t, dormir: async (ms) => { t += ms; } };
const marcas = [];
await Promise.all(Array.from({ length: 100 }, () => aguardarVaga('tok', CHAMADAS_POR_MINUTO, relogio).then(() => marcas.push(t))));
const piorJanela = Math.max(...marcas.map((m) => marcas.filter((x) => x >= m && x < m + 60_000).length));
check(`100 chamadas concorrentes: nunca mais de ${CHAMADAS_POR_MINUTO} em 60 s`, piorJanela <= CHAMADAS_POR_MINUTO, true);
check('100 chamadas levam ~2 janelas (36 + 36 + 28)', Math.round(Math.max(...marcas) / 60_000), 2);
esquecerToken('tok');
t = 0;
const esperas = [];
for (let i = 0; i < 37; i++) esperas.push(await aguardarVaga('tok2', CHAMADAS_POR_MINUTO, relogio));
check('a 37ª espera ~60 s e as anteriores não esperam', [esperas.slice(0, 36).every((e) => e === 0), Math.round(esperas[36] / 1000)], [true, 60]);
check('tokens diferentes não dividem a janela', await aguardarVaga('outro', CHAMADAS_POR_MINUTO, relogio), 0);

// --- 2 · fbitsFetch respeita o Retry-After em 429 -----------------------------
const chamadas = [];
let respostas = [];
globalThis.fetch = async (url) => {
  chamadas.push({ url: String(url), em: Date.now() });
  const r = respostas.shift();
  return r ? r() : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};
respostas = [() => new Response('{}', { status: 429, headers: { 'retry-after': '2' } }), () => new Response('{"ok":true}', { status: 200 })];
const inicio = Date.now();
const r = await fbitsFetch('tok-429', 'GET', '/produtos?quantidadeRegistros=1');
const passou = Date.now() - inicio;
check('429: uma repetição só, depois do Retry-After', [chamadas.length, r.ok, passou >= 2900], [2, true, true]);
check('a pausa fica registrada para o progresso', esperasLimitePorToken.get('tok-429'), 3000);
chamadas.length = 0;
respostas = [() => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }), () => new Response('{"mensagem":"limite"}', { status: 429, headers: { 'retry-after': '1' } })];
const erro = await fbitsFetch('tok-429b', 'GET', '/x').catch((e) => e);
check('429 duas vezes: desiste (não insiste até bloquear o token)', [chamadas.length, erro?.status], [2, 429]);

// --- 3 · aggregateProduct reaproveita o que já veio ---------------------------
const pedidos = [];
const get = async (path) => {
  pedidos.push(path.split('?')[0].split('/').pop());
  if (path.includes('/seo?')) return comMeta ? { title: 'T', metatags: [{ name: 'description', content: 'D' }] } : { title: 'T' };
  if (path.includes('/seo/metaTag')) return [{ name: 'description', content: 'D2' }];
  if (path.includes('/informacoes')) return [{ tipoInformacao: 'Informacoes', texto: 'html', informacaoId: 9 }];
  return [];
};
let comMeta = true;
const a = await aggregateProduct('t', { produtoId: 1, produtoVarianteId: 11, sku: 'A', informacoes: [{ tipoInformacao: 'Informacoes', texto: 'html da lista', informacaoId: 7 }] }, get);
check('com informações na lista e metatags no SEO: 3 chamadas', pedidos.sort(), ['categorias', 'imagens', 'seo']);
check('descrição e SEO vêm do que já estava', [a.descricaoHtml, a.informacaoId, a.seoDescription], ['html da lista', 7, 'D']);
pedidos.length = 0;
comMeta = false;
const b = await aggregateProduct('t', { produtoId: 2, produtoVarianteId: 22, sku: 'B' }, get);
check('sem elas: busca as 5 como antes', pedidos.sort(), ['categorias', 'imagens', 'informacoes', 'metaTag', 'seo']);
check('e o resultado é o mesmo de antes', [b.descricaoHtml, b.seoDescription], ['html', 'D2']);

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
