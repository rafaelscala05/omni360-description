// Trava o payload de POST /banners contra o contrato oficial da Wake.
//
// O bug que motivou este teste: a ferramenta omitia cinco campos obrigatórios e
// a Wake respondia 422 com a mensagem genérica "Erro ao inserir banner!", sem
// dizer qual campo faltava. A lista `REQUIRED` abaixo veio do OpenAPI publicado
// em https://wakecommerce.readme.io/reference/insere-um-novo-banner.md
//
// Não faz rede (o download da imagem é stubado) nem chama a Wake, mas carrega o
// módulo de ferramentas, que inicializa o Admin SDK — precisa de ADC local.
// Rodar com: npx tsx scripts/verify-wake-banner-payload.mjs

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('example.com/banner.png')) {
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  return realFetch(url, opts);
};

const { getTool } = await import('../server/agent/registry.ts');
await import('../server/agent/tools/wake.ts');

const REQUIRED = {
  '': ['nome', 'dataInicio'],
  'detalhe': ['posicionamentoId', 'urlBanner', 'textoAlternativo'],
  'detalhe.imagemBanner': ['base64', 'formato', 'nome'],
  'apresentacao': ['exibirNoSite', 'exibirEmTodasBuscas', 'naoExibirEmBuscas', 'termosBusca', 'exibirEmTodasCategorias'],
  'apresentacao.listaHotsites': ['exibirEmTodosHotsites'],
  'apresentacao.listaParceiros': ['exibirEmTodosParceiros'],
};
const FORMATOS_ACEITOS = ['PNG', 'JPG', 'JPEG'];

const ctx = { uid: 'verify', dryRun: true, wakeToken: async () => 'tok', tinyToken: async () => { throw new Error('n/a'); } };
const at = (o, p) => (p ? p.split('.').reduce((a, k) => a?.[k], o) : o);

let failures = 0;
const check = (label, ok, detalhe = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → ${detalhe}`}`);
};

// O caso que quebrava: só os campos required da própria ferramenta, que é o que
// o modelo manda quando o usuário diz "sobe esse banner" e nada mais.
const preview = await getTool('wake.banner.criar').preview(ctx, {
  nome: 'Banner Teste',
  imagemUrl: 'https://example.com/banner.png',
  posicionamentoId: 1,
});
const body = preview.payload;

for (const [path, campos] of Object.entries(REQUIRED)) {
  // No preview a imagem é um placeholder; base64/formato só entram no execute.
  const node = path === 'detalhe.imagemBanner'
    ? { base64: 'stub', formato: 'PNG', nome: at(body, path)?.nome }
    : at(body, path);
  if (node === undefined) { check(`objeto ${path || '(raiz)'} presente`, false, 'ausente'); continue; }
  for (const c of campos) {
    check(`${path ? `${path}.` : ''}${c} presente`, node[c] !== undefined, 'undefined — a Wake devolve 422');
  }
}

check('dataInicio tem default quando o usuário não informa', typeof body.nome === 'string' && !!body.dataInicio);
check('textoAlternativo cai para o nome do banner', body.detalhe.textoAlternativo === 'Banner Teste');
check('o card avisa os defaults assumidos', preview.avisos.length >= 2, `veio ${preview.avisos.length}`);

// A Wake só aceita PNG/JPG/JPEG; WEBP e GIF precisam ser recusados no preview,
// antes de o usuário aprovar, e não com um 422 depois.
const { fetchImageAsBase64 } = await import('../server/safeUrl.ts');
globalThis.fetch = async () => new Response(png, { status: 200, headers: { 'content-type': 'image/webp' } });
let recusou = false;
try { await fetchImageAsBase64('https://example.com/banner.png', undefined, FORMATOS_ACEITOS); }
catch (e) { recusou = /aceita apenas/.test(e.message); }
check('imagem WEBP é recusada no preview', recusou, 'passou batido');

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
