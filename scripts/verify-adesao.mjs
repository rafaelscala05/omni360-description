// Regras puras da adesão a módulos (server/adesaoRules.ts).
// Rodar com: npx tsx scripts/verify-adesao.mjs
import { validarPedidoAdesao, bonusDaMissao, planejarAdesao, BONUS_MISSAO_PADRAO, TEXTO_ADESAO } from '../server/adesaoRules.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('padrões do crédito de missão', BONUS_MISSAO_PADRAO, { produto: 10, meli: 20, conteudo: 15 });
check('todo objetivo tem texto de aceite', Object.keys(TEXTO_ADESAO).sort(), ['conteudo', 'meli', 'produto']);

// Pedido vindo do navegador.
check('pedido válido mantém a ordem', validarPedidoAdesao({ objetivos: ['meli', 'produto'] }), { ok: true, objetivos: ['meli', 'produto'] });
check('repetido é colapsado', validarPedidoAdesao({ objetivos: ['meli', 'meli', 'produto'] }), { ok: true, objetivos: ['meli', 'produto'] });
check('vazio é recusado', validarPedidoAdesao({ objetivos: [] }).ok, false);
check('sem corpo é recusado', validarPedidoAdesao(null).ok, false);
check('não-array é recusado', validarPedidoAdesao({ objetivos: 'meli' }).ok, false);
check('objetivo desconhecido é recusado', validarPedidoAdesao({ objetivos: ['wake'] }).ok, false);
check('mensagem em pt-BR', validarPedidoAdesao({ objetivos: ['wake'] }).erro, 'Objetivo desconhecido: wake');

// Valor do crédito: config/credits.missao, com teto.
check('sem config usa o padrão', bonusDaMissao(undefined, 'meli'), 20);
check('config válida vence', bonusDaMissao({ missao: { meli: 35 } }, 'meli'), 35);
check('zero é válido (desliga o bônus)', bonusDaMissao({ missao: { meli: 0 } }, 'meli'), 0);
check('negativo cai no padrão', bonusDaMissao({ missao: { meli: -5 } }, 'meli'), 20);
check('string cai no padrão', bonusDaMissao({ missao: { meli: '50' } }, 'meli'), 20);
check('acima de 200 cai no padrão', bonusDaMissao({ missao: { meli: 10000 } }, 'meli'), 20);
check('fracionário cai no padrão', bonusDaMissao({ missao: { meli: 2.5 } }, 'meli'), 20);

// Planejamento: o que é novo paga, o que já foi aderido só religa.
const p1 = planejarAdesao({ pedidos: ['meli', 'produto'], jaAderidos: [], config: undefined });
check('dois novos: soma dos créditos', p1.creditos, 30);
check('dois novos: ambos novos', p1.novos, ['meli', 'produto']);
check('campos de módulo', p1.campos, { 'modules.meliListingOptimizer': true, 'modules.produtos': true });

const p2 = planejarAdesao({ pedidos: ['meli'], jaAderidos: ['meli'], config: undefined });
check('já aderido não paga de novo', p2.creditos, 0);
check('já aderido não é novo', p2.novos, []);
check('já aderido religa o módulo', p2.campos, { 'modules.meliListingOptimizer': true });

const p3 = planejarAdesao({ pedidos: ['conteudo'], jaAderidos: [], config: { missao: { conteudo: 40 } } });
check('conteúdo liga dois módulos', p3.campos, { 'modules.contentAgent': true, 'modules.blog': true });
check('conteúdo com config', p3.creditos, 40);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
