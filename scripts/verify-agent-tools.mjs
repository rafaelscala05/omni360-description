// Verificação da lógica pura do Agente Operacional. Não sobe servidor, não toca
// Firestore e não chama Wake/Tiny. Rodar com: npx tsx scripts/verify-agent-tools.mjs
import { buildFieldDiff, isNoop, makePreview, sameValue, requireStr } from '../server/agent/preview.ts';
import { registerTool, getTool, listTools, describeTools, toGeminiDeclarations, _resetRegistry } from '../server/agent/registry.ts';
import { creditActionsFor } from '../server/agent/execution.ts';
import { CREDIT_ACTIONS } from '../src/credits.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok' : 'FALHA'}  ${label}${
      ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`
    }`,
  );
}

function checkThrows(label, fn, matcher) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ok = threw !== null && (!matcher || matcher.test(threw.message));
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → não lançou o erro esperado (veio: ${threw?.message ?? 'nada'})`}`);
}

// --- sameValue: o diff não pode inventar mudança onde não houve -------------

check('"1200" e 1200 são o mesmo preço', sameValue('1200', 1200), true);
check('vírgula decimal compara como número', sameValue('19,90', 19.9), true);
check('null, undefined e "" são todos vazios', sameValue(null, ''), true);
check('vazio não é igual a zero', sameValue('', 0), false);
check('espaço em volta não conta', sameValue(' abc ', 'abc'), true);
check('valores diferentes diferem', sameValue('abc', 'abd'), false);
check('objetos comparam por conteúdo', sameValue({ a: 1 }, { a: 1 }), true);

// --- buildFieldDiff --------------------------------------------------------

const diff = buildFieldDiff(
  { preco: 100, nome: 'Camiseta', ean: null },
  { preco: 80, nome: 'Camiseta', ean: undefined },
  { preco: 'Preço', nome: 'Nome' },
);
check('campos undefined ficam fora do diff', diff.length, 2);
check('campo alterado marca mudou', diff.find((c) => c.campo === 'Preço').mudou, true);
check('campo igual não marca mudou', diff.find((c) => c.campo === 'Nome').mudou, false);
check('sem label, usa a chave crua', buildFieldDiff({}, { xyz: 1 }, {})[0].campo, 'xyz');
check('antes ausente vira null, não undefined', buildFieldDiff({}, { a: 1 }, {})[0].antes, null);

// --- isNoop / makePreview --------------------------------------------------

check('diff vazio é no-op', isNoop([]), true);
check('diff sem mudanças é no-op', isNoop(diff.filter((c) => !c.mudou)), true);
check('diff com mudança não é no-op', isNoop(diff), false);

const noop = makePreview({ resumo: 'r', alvo: 'a', campos: [{ campo: 'x', antes: 1, depois: 1, mudou: false }] });
check('preview no-op avisa o usuário', noop.avisos.length, 1);

const criacao = makePreview({ resumo: 'r', alvo: 'a', campos: [], criacao: true });
check('criação não é tratada como no-op', criacao.avisos.length, 0);

const comAviso = makePreview({
  resumo: 'r', alvo: 'a', avisos: ['cuidado'],
  campos: [{ campo: 'x', antes: 1, depois: 2, mudou: true }],
});
check('avisos do tool são preservados', comAviso.avisos, ['cuidado']);
check('payload passa intacto', makePreview({ resumo: 'r', alvo: 'a', campos: [], payload: { a: 1 }, criacao: true }).payload, { a: 1 });

// --- requireStr ------------------------------------------------------------

check('requireStr apara espaços', requireStr({ sku: '  ABC ' }, 'sku'), 'ABC');
checkThrows('requireStr recusa ausente', () => requireStr({}, 'sku'), /obrigatório/);
checkThrows('requireStr recusa string vazia', () => requireStr({ sku: '   ' }, 'sku'), /obrigatório/);

// --- registry: o invariante de aprovação ------------------------------------

_resetRegistry();

const leitura = {
  name: 'wake.teste.ler', provider: 'wake', mode: 'read',
  description: 'lê', schema: { type: 'object', properties: {} },
  read: async () => ({ ok: true }),
};
const escrita = {
  name: 'wake.teste.escrever', provider: 'wake', mode: 'write',
  description: 'escreve', schema: { type: 'object', properties: {} },
  preview: async () => makePreview({ resumo: 'r', alvo: 'a', campos: [], criacao: true }),
  execute: async () => ({ ok: true }),
};

registerTool(leitura);
registerTool(escrita);

// Uma ferramenta de escrita sem preview() seria um buraco no gate de aprovação:
// o registry precisa recusar isso no boot, não no primeiro clique do usuário.
checkThrows(
  'escrita sem preview é recusada no registro',
  () => registerTool({ ...escrita, name: 'wake.teste.semPreview', preview: undefined }),
  /preview/,
);
checkThrows(
  'escrita sem execute é recusada no registro',
  () => registerTool({ ...escrita, name: 'wake.teste.semExecute', execute: undefined }),
  /execute/,
);
checkThrows(
  'leitura sem read é recusada no registro',
  () => registerTool({ ...leitura, name: 'wake.teste.semRead', read: undefined }),
  /read/,
);
checkThrows('nome duplicado é recusado', () => registerTool(leitura), /[Dd]uplicada/);
checkThrows(
  'nome inválido para function calling é recusado',
  () => registerTool({ ...leitura, name: 'wake teste!' }),
  /inválido/,
);

// --- registry: filtro por provider conectado -------------------------------

registerTool({ ...leitura, name: 'tiny.teste.ler', provider: 'tiny' });

check('só wake conectada expõe só wake', listTools(['wake']).map((t) => t.name), ['wake.teste.escrever', 'wake.teste.ler']);
check('sem provider conectado, nenhuma ferramenta', listTools([]).length, 0);
check('providers somam', listTools(['wake', 'tiny']).length, 3);
check('ferramenta de provider desconectado não é encontrável na lista', listTools(['wake']).some((t) => t.name === 'tiny.teste.ler'), false);

// getTool ignora conexão de propósito: quem checa é o loop, que compara com os
// providers da conta antes de chamar. Este teste fixa esse contrato.
check('getTool encontra por nome, sem filtrar provider', getTool('tiny.teste.ler').name, 'tiny.teste.ler');
check('getTool devolve undefined para nome inexistente', getTool('nao.existe'), undefined);

// --- conversão para Gemini --------------------------------------------------

const decls = toGeminiDeclarations(['wake']);
check('cada ferramenta vira uma declaration', decls.length, 2);

const declEscrita = decls.find((d) => d.name === 'wake.teste.escrever');
const declLeitura = decls.find((d) => d.name === 'wake.teste.ler');
check('declaration de escrita avisa o modelo que vai pausar', /\[ESCRITA\]/.test(declEscrita.description), true);
check('declaration de leitura não leva o marcador', /\[ESCRITA\]/.test(declLeitura.description), false);
check('schema vai como parametersJsonSchema', declEscrita.parametersJsonSchema, { type: 'object', properties: {} });

// --- introspecção (base do futuro MCP tools/list) --------------------------

const descrito = describeTools(['wake']);
check('describeTools expõe modo e schema', Object.keys(descrito[0]).sort(), ['description', 'inputSchema', 'mode', 'name', 'provider']);
check('describeTools não vaza as funções', descrito[0].execute, undefined);
check('lista sai ordenada por nome', descrito.map((t) => t.name), ['wake.teste.escrever', 'wake.teste.ler']);

// --- execution: creditActionsFor -------------------------------------------

check(
  'wake write tools debitam agentAction',
  creditActionsFor({ name: 'wake.banner.criar', provider: 'wake', mode: 'write' }),
  [CREDIT_ACTIONS.agentAction],
);
check(
  'tiny write tools debitam agentAction',
  creditActionsFor({ name: 'tiny.produto.atualizar', provider: 'tiny', mode: 'write' }),
  [CREDIT_ACTIONS.agentAction],
);
check(
  'content.clusters.gerar debita clusters + keyword research',
  creditActionsFor({ name: 'content.clusters.gerar', provider: 'content', mode: 'write' }),
  [CREDIT_ACTIONS.contentClusters, CREDIT_ACTIONS.seoKeywordResearch],
);
check(
  'content.calendario.gerar debita calendar',
  creditActionsFor({ name: 'content.calendario.gerar', provider: 'content', mode: 'write' }),
  [CREDIT_ACTIONS.contentCalendar],
);
check(
  'content.seo.auditoria.gerar debita seo audit',
  creditActionsFor({ name: 'content.seo.auditoria.gerar', provider: 'content', mode: 'write' }),
  [CREDIT_ACTIONS.seoAudit],
);
check(
  'ferramenta de conteúdo sem mapeamento não debita nada aqui (debita mais fundo, fora deste helper)',
  creditActionsFor({ name: 'content.artigo.publicar', provider: 'content', mode: 'write' }),
  [],
);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
