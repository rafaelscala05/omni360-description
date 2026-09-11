// Orquestração pura da Missão Conteúdo. Rodar com: npx tsx scripts/verify-conteudo-fluxo.mjs
import { proximaAcaoConteudo, rotuloEstagio, slugCandidatos } from '../src/modules/onboarding/mission/conteudoFluxo.ts';
import { MISSOES } from '../src/modules/onboarding/mission/missionSteps.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const p = { projectId: 'p1' };
check('sem clusters → gera clusters', proximaAcaoConteudo(p, null), 'gerar-clusters');
const c = { ...p, clusterId: 'c1' };
check('com cluster, sem artigo → cria artigo', proximaAcaoConteudo(c, null), 'criar-artigo');
const a = { ...c, articleId: 'a1' };
check('com artigo, sem blog → cria blog', proximaAcaoConteudo(a, null), 'criar-blog');
const b = { ...a, blogSlug: 'casa' };
check('artigo ainda não carregou → aguarda', proximaAcaoConteudo(b, null), 'aguardar');
check('artigo agendado → produz', proximaAcaoConteudo(b, { status: 'agendado', stage: 0, temFinal: false }), 'produzir');
const iniciada = { ...b, producaoIniciada: true };
check('produção pedida, ainda agendado → aguarda', proximaAcaoConteudo(iniciada, { status: 'agendado', stage: 0, temFinal: false }), 'aguardar');
check('em produção → aguarda', proximaAcaoConteudo(iniciada, { status: 'em_producao', stage: 2, temFinal: false }), 'aguardar');
check('erro do pipeline → erro', proximaAcaoConteudo(iniciada, { status: 'erro', stage: 3, temFinal: false }), 'erro');
check('erro + "tentar de novo" → produz', proximaAcaoConteudo(b, { status: 'erro', stage: 3, temFinal: false }), 'produzir');
check('versão final pronta → publica', proximaAcaoConteudo(iniciada, { status: 'revisao', stage: 5, temFinal: true }), 'publicar');
check('publicado → pronto', proximaAcaoConteudo({ ...iniciada, urlPost: 'https://x/b/casa/post' }, { status: 'revisao', stage: 5, temFinal: true }), 'pronto');

check('rótulos na ordem do ArticleView', [1, 2, 3, 4, 5].map(rotuloEstagio), ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem']);
check('estágio 0 não tem rótulo', rotuloEstagio(0), '');

check('slug a partir do nome', slugCandidatos('Casa & Brilho'), ['casa-brilho', 'casa-brilho-blog', 'casa-brilho-2', 'casa-brilho-3']);
check('nome curto demais cai no padrão', slugCandidatos('Oi')[0], 'meu-blog');

// O palco de Conteúdo só termina quando o artigo foi publicado no blog —
// não quando o blog passa a existir.
const palco = MISSOES.conteudo.steps.find((s) => s.id === 'palco');
check('palco não termina com o blog só criado', palco.concluido({ blogSlug: 'casa' }), false);
check('palco termina com o post publicado', palco.concluido({ blogSlug: 'casa', urlPost: 'https://x' }), true);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
