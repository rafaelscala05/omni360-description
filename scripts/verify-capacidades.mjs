// Regra única das peças do Alfred (src/modules/agent/capacidades.ts).
// Rodar com: npx tsx scripts/verify-capacidades.mjs
import { temAlfred, modulosDoObjetivo, montarAlfred, proximaPecaParaMontar, OBJETIVOS } from '../src/modules/agent/capacidades.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const conta = (over = {}) => ({
  objetivos: [],
  modules: {},
  conexoes: { erp: false, meli: false, site: false },
  marcos: { produtos: 0, produtosComDescricao: 0 },
  ...over,
});
const estados = (c) => Object.fromEntries(montarAlfred(c).map((p) => [p.id, p.estado]));

check('ordem dos objetivos', OBJETIVOS, ['produto', 'meli', 'conteudo']);

// temAlfred: só flags reais ligam o shell.
check('conta sem módulo não tem Alfred', temAlfred({}), false);
check('conta legada com Conteúdo tem Alfred', temAlfred({ contentAgent: true }), true);
check('conta legada com Operacional tem Alfred', temAlfred({ operationsAgent: true }), true);
check('coorte nova (produtos) tem Alfred', temAlfred({ produtos: true }), true);
check('só Mercado Livre não liga o shell', temAlfred({ meliListingOptimizer: true }), false);
check('flag false não conta', temAlfred({ produtos: false, contentAgent: false }), false);

check('módulos do objetivo produto', modulosDoObjetivo('produto'), ['produtos']);
check('módulos do objetivo meli', modulosDoObjetivo('meli'), ['meliListingOptimizer']);
check('módulos do objetivo conteudo', modulosDoObjetivo('conteudo'), ['contentAgent', 'blog']);

check('ordem fixa das peças', montarAlfred(conta()).map((p) => p.id), ['produtos', 'meli', 'conteudo', 'erp', 'video']);
check('conta vazia: módulos disponíveis, ERP e vídeo ocultos', estados(conta()), {
  produtos: 'disponivel', meli: 'disponivel', conteudo: 'disponivel', erp: 'oculta', video: 'oculta',
});

const nova = conta({ modules: { produtos: true } });
check('coorte nova: Produtos ativa', estados(nova).produtos, 'ativa');
check('com produto no catálogo: conectada', estados({ ...nova, marcos: { produtos: 3, produtosComDescricao: 0 } }).produtos, 'conectada');
check('com descrição: com resultado', estados({ ...nova, marcos: { produtos: 3, produtosComDescricao: 1 } }).produtos, 'com-resultado');
check('legado com Operacional também tem Produtos ativa', estados(conta({ modules: { operationsAgent: true } })).produtos, 'ativa');

const ml = conta({ modules: { meliListingOptimizer: true } });
check('ML ligado sem OAuth: ativa', estados(ml).meli, 'ativa');
check('ML conectado', estados({ ...ml, conexoes: { erp: false, meli: true, site: false } }).meli, 'conectada');
check('ML com proposta publicada', estados({ ...ml, conexoes: { erp: false, meli: true, site: false }, marcos: { produtos: 0, produtosComDescricao: 0, propostaPublicada: true } }).meli, 'com-resultado');

const co = conta({ modules: { contentAgent: true, blog: true } });
check('Conteúdo ligado: ativa', estados(co).conteudo, 'ativa');
check('Conteúdo com projeto: conectada', estados({ ...co, conexoes: { erp: false, meli: false, site: true } }).conteudo, 'conectada');

check('ERP aparece depois do 1º produto', estados(conta({ marcos: { produtos: 1, produtosComDescricao: 0 } })).erp, 'disponivel');
check('ERP conectado', estados(conta({ conexoes: { erp: true, meli: false, site: false } })).erp, 'conectada');
check('ERP com envio', estados(conta({ conexoes: { erp: true, meli: false, site: false }, marcos: { produtos: 1, produtosComDescricao: 0, envioErp: true } })).erp, 'com-resultado');
check('vídeo só com o módulo', estados(conta({ modules: { video: true } })).video, 'ativa');

const pecaErp = montarAlfred(conta()).find((p) => p.id === 'erp');
check('ERP não é aderível (é conexão)', pecaErp.objetivo, null);
check('peça ML adere pelo objetivo meli', montarAlfred(conta()).find((p) => p.id === 'meli').objetivo, 'meli');

// Próxima peça: só disponível e aderível; os objetivos marcados vêm antes.
const pecasNova = montarAlfred(nova);
check('próxima peça segue a ordem fixa sem objetivo', proximaPecaParaMontar(pecasNova, [])?.id, 'meli');
check('objetivo marcado vem primeiro', proximaPecaParaMontar(pecasNova, ['conteudo'])?.id, 'conteudo');
const tudo = montarAlfred(conta({ modules: { produtos: true, meliListingOptimizer: true, contentAgent: true, blog: true } }));
check('tudo montado: nenhuma peça', proximaPecaParaMontar(tudo, []), null);

// Revogado pelo admin (false explícito): a peça some, não vira "para montar".
check('ML revogado fica oculto', estados(conta({ modules: { meliListingOptimizer: false } })).meli, 'oculta');
check('Conteúdo revogado fica oculto', estados(conta({ modules: { contentAgent: false } })).conteudo, 'oculta');
check('revogado não é oferecido', proximaPecaParaMontar(montarAlfred(conta({ modules: { produtos: true, meliListingOptimizer: false } })), ['meli'])?.id, 'conteudo');

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
