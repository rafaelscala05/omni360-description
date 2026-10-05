// Trilha de missões (pura). Rodar com: npx tsx scripts/verify-trilha.mjs
import { emOnboarding, montarTrilha } from '../src/modules/onboarding/mission/trilha.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}
const estados = (s) => Object.fromEntries(montarTrilha(s).map((i) => [i.id, i.estado]));
const vazio = { missoes: [], produtos: 0, erpConectado: false, empresaCompleta: false };

check('ordem fixa dos itens', montarTrilha(vazio).map((i) => i.id), ['produto', 'conteudo', 'catalogo', 'erp', 'publicar-blog', 'empresa']);
check('conta nova: missões acionáveis, publicar bloqueado, empresa opcional', estados(vazio), {
  produto: 'agora', conteudo: 'agora', catalogo: 'agora', erp: 'agora', 'publicar-blog': 'bloqueado', empresa: 'opcional',
});

const depoisProduto = { ...vazio, produtos: 1, missoes: [{ missionId: 'produto', concluidaEm: 'x', dados: {} }] };
check('missão produto concluída fica feita', estados(depoisProduto).produto, 'feito');
check('um produto só ainda não é catálogo', estados(depoisProduto).catalogo, 'agora');
check('catálogo com mais de um produto', estados({ ...depoisProduto, produtos: 12 }).catalogo, 'feito');

const blogPreview = { ...vazio, missoes: [{ missionId: 'conteudo', concluidaEm: 'x', dados: {} }] };
check('blog criado libera "publicar"', estados(blogPreview)['publicar-blog'], 'agora');
check('blog publicado fica feito', estados({ ...vazio, missoes: [{ missionId: 'conteudo', concluidaEm: 'x', dados: { blogPublicado: true } }] })['publicar-blog'], 'feito');
check('missão em andamento não conta como feita', estados({ ...vazio, missoes: [{ missionId: 'conteudo', dados: {} }] }).conteudo, 'agora');
check('ERP conectado', estados({ ...vazio, erpConectado: true }).erp, 'feito');
check('empresa completa', estados({ ...vazio, empresaCompleta: true }).empresa, 'feito');

// Coorte v2: a trilha segue os objetivos marcados, na ordem.
const ids = (s) => montarTrilha(s).map((i) => i.id);
check('v1 (sem objetivos) não muda', ids(vazio), ['produto', 'conteudo', 'catalogo', 'erp', 'publicar-blog', 'empresa']);
check('v2 só ML', ids({ ...vazio, objetivos: ['meli'] }), ['meli', 'catalogo', 'erp', 'empresa']);
check('v2 ML depois produto', ids({ ...vazio, objetivos: ['meli', 'produto'] }), ['meli', 'produto', 'catalogo', 'erp', 'empresa']);
check('v2 com conteúdo traz publicar blog', ids({ ...vazio, objetivos: ['conteudo'] }), ['conteudo', 'catalogo', 'erp', 'publicar-blog', 'empresa']);
check('v2 ML conectado fica feito', estados({ ...vazio, objetivos: ['meli'], meliConectado: true }).meli, 'feito');
check('v2 ML sem conexão é agora', estados({ ...vazio, objetivos: ['meli'] }).meli, 'agora');
check('título do item ML', montarTrilha({ ...vazio, objetivos: ['meli'] })[0].titulo, 'Conectar seu Mercado Livre');

// Checklist do onboarding: some quando só resta o opcional.
check('conta nova está em onboarding', emOnboarding(montarTrilha(vazio)), true);
const tudoFeito = montarTrilha({
  ...vazio, produtos: 2, erpConectado: true, objetivos: ['meli'], meliConectado: true,
});
check('só o opcional aberto encerra o onboarding', emOnboarding(tudoFeito), false);
check('bloqueado ainda segura o checklist', emOnboarding([{ id: 'publicar-blog', titulo: '', meta: '', estado: 'bloqueado' }]), true);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
