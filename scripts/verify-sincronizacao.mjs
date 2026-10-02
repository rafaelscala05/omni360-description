// Verificação da regra de sincronização (src/modules/agent/sincronizacao.ts).
// Rodar com: npx tsx scripts/verify-sincronizacao.mjs
import {
  djb2, conteudoDoProduto, assinaturasDoEnvio, assinaturasDeImportacao, estadoIntegracao, integracoesDe, assinaturaLegada,
} from '../src/modules/agent/sincronizacao.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const base = {
  _id: 'A', 'Código (SKU)': 'A', 'Descrição': 'Camiseta',
  'Descrição complementar': '<p>texto</p>', 'Título SEO': 'Camiseta azul', 'Descrição SEO': 'meta', 'Palavras chave SEO': 'camiseta',
  'URL imagem 1': 'https://x/1.jpg', _tinyProductId: '10',
};

// Hash estável e independente de espaços nas pontas e da ordem das imagens.
check('djb2 é estável', djb2('abc'), djb2('abc'));
const c1 = conteudoDoProduto({ ...base, _ambientImages: ['https://x/a.jpg'] }, 'tiny');
const c2 = conteudoDoProduto({ ...base, 'Descrição complementar': '  <p>texto</p>  ', _ambientImages: ['https://x/a.jpg'] }, 'tiny');
check('conteúdo tiny junta ambientadas e URL imagem', c1.imagens, ['https://x/1.jpg', 'https://x/a.jpg']);
check('wake só conta ambientadas como imagem', conteudoDoProduto({ ...base, _ambientImages: ['https://x/a.jpg'] }, 'wake').imagens, ['https://x/a.jpg']);
check('espaço nas pontas não muda a assinatura',
  assinaturasDeImportacao('tiny', c1).descricao, assinaturasDeImportacao('tiny', c2).descricao);

// Envio: só grupos com passo "ok" ou "sem alteração" são carimbados.
const env = assinaturasDoEnvio('tiny', c1, { titulo: 'sobrescrita desativada', descricao: 'ok', seo: 'ok (seo_title acima de 120)', imagens: 'sem alteração' });
check('envio carimba só ok/sem alteração', Object.keys(env).sort(), ['descricao', 'imagens']);
check('envio wake ignora grupo fora da integração', Object.keys(assinaturasDoEnvio('wake', c1, { titulo: 'ok', descricao: 'ok' })), ['descricao']);

// Importação nunca carimba imagens (o ERP re-hospeda as URLs).
check('importação carimba título, descrição e SEO', Object.keys(assinaturasDeImportacao('tiny', c1)).sort(), ['descricao', 'seo', 'titulo']);

// Estado
check('sem vínculo', estadoIntegracao(base, 'wake'), { tipo: 'sem-vinculo' });
const carimbado = { ...base, _tinyPushed: { ...assinaturasDeImportacao('tiny', conteudoDoProduto(base, 'tiny')), imagens: assinaturasDoEnvio('tiny', conteudoDoProduto(base, 'tiny'), { imagens: 'ok' }).imagens } };
check('carimbo igual ao local = em dia', estadoIntegracao(carimbado, 'tiny'), { tipo: 'em-dia' });
check('descrição mudou depois do carimbo = pendente',
  estadoIntegracao({ ...carimbado, 'Descrição complementar': '<p>novo</p>' }, 'tiny'), { tipo: 'pendente', grupos: ['descricao'] });
check('grupo vazio no local nunca fica pendente',
  estadoIntegracao({ ...carimbado, 'Título SEO': '', 'Descrição SEO': '', 'Palavras chave SEO': '' }, 'tiny'), { tipo: 'em-dia' });

// Review Focus 1: produto antigo, sem carimbo nenhum.
check('sem carimbo e nada gerado = em dia', estadoIntegracao(base, 'tiny'), { tipo: 'em-dia' });
check('sem carimbo com descrição gerada por IA = pendente',
  estadoIntegracao({ ...base, _statusDescricao: 'Gerado por IA', _statusSEO: 'Gerado por IA' }, 'tiny'), { tipo: 'pendente', grupos: ['descricao', 'seo'] });
check('sem carimbo de imagem com ambientada = imagem pendente',
  estadoIntegracao({ ...carimbado, _tinyPushed: { ...carimbado._tinyPushed, imagens: undefined }, _ambientImages: ['https://x/a.jpg'] }, 'tiny'),
  { tipo: 'pendente', grupos: ['imagens'] });

// Bling continua com a assinatura legada gravada pelo navegador.
const bling = { ...base, _tinyProductId: undefined, _blingProductId: '7', _statusDescricao: 'Gerado por IA' };
check('bling sem _blingPushed e descrição gerada = pendente', estadoIntegracao(bling, 'bling'), { tipo: 'pendente', grupos: ['descricao'] });
check('bling com _blingPushed igual = em dia',
  estadoIntegracao({ ...bling, _blingPushed: { descricao: assinaturaLegada(bling, 'descricao').sig } }, 'bling'), { tipo: 'em-dia' });

check('integracoesDe lista só as vinculadas',
  integracoesDe({ ...base, _wakeProductId: 'w1' }).map((i) => i.integracao), ['tiny', 'wake']);

if (failures) { console.error(`\n${failures} falha(s).`); process.exit(1); }
console.log('\nTudo certo.');
