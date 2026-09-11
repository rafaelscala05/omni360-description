// Trilha de missões (pura). Rodar com: npx tsx scripts/verify-trilha.mjs
import { montarTrilha } from '../src/modules/onboarding/mission/trilha.ts';

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

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
