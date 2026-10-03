// Tela 0 da coorte v2 (src/modules/onboarding/mission/objetivos.ts).
// Rodar com: npx tsx scripts/verify-objetivos.mjs
import { alternarObjetivo, rotuloComecar, missaoDoObjetivo, OBJETIVO_INFO, aterrissaNoAlfred } from '../src/modules/onboarding/mission/objetivos.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('marcar acrescenta no fim', alternarObjetivo(['meli'], 'produto'), ['meli', 'produto']);
check('desmarcar tira e mantém a ordem', alternarObjetivo(['meli', 'produto', 'conteudo'], 'produto'), ['meli', 'conteudo']);
check('não muta a lista recebida', (() => { const a = ['meli']; alternarObjetivo(a, 'produto'); return a; })(), ['meli']);

check('nada marcado', rotuloComecar([]), 'Escolha um para começar');
check('começa pelo primeiro marcado', rotuloComecar(['meli', 'produto']), 'Começar pelo Mercado Livre');
check('produto', rotuloComecar(['produto']), 'Começar pelas descrições');
check('conteúdo', rotuloComecar(['conteudo']), 'Começar pelo blog');

check('produto tem missão', missaoDoObjetivo('produto'), 'produto');
check('conteúdo tem missão', missaoDoObjetivo('conteudo'), 'conteudo');
check('ML ainda não tem missão (fase 4)', missaoDoObjetivo('meli'), null);

check('títulos são os objetivos do cliente', Object.values(OBJETIVO_INFO).map((i) => i.titulo), [
  'Melhorar a descrição dos produtos', 'Otimizar meu Mercado Livre', 'Gerar conteúdo para o meu blog',
]);

// Aterrissagem da v2: quem já escolheu objetivos e não tem missão em curso abre no Alfred.
check('v2 com objetivos, sem missão: Alfred', aterrissaNoAlfred({ v2: true, objetivos: 1, emCurso: false, jornadaConcluida: false }), true);
check('v2 com missão concluída: Alfred', aterrissaNoAlfred({ v2: true, objetivos: 1, emCurso: false, jornadaConcluida: true }), true);
check('v2 com missão em curso: não', aterrissaNoAlfred({ v2: true, objetivos: 1, emCurso: true, jornadaConcluida: false }), false);
check('v2 sem objetivos (Tela 0): não', aterrissaNoAlfred({ v2: true, objetivos: 0, emCurso: false, jornadaConcluida: false }), false);
check('v1: não', aterrissaNoAlfred({ v2: false, objetivos: 0, emCurso: false, jornadaConcluida: true }), false);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
