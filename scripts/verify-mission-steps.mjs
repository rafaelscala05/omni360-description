// Verificação da lógica pura da máquina de missão
// (src/modules/onboarding/mission/missionSteps.ts). Não sobe servidor, não
// toca Firestore e não renderiza React.
// Rodar com: npx tsx scripts/verify-mission-steps.mjs
import {
  MISSOES, avancar, criarEstadoInicial, progresso, proximoStep, stepConcluido, sugerirTrilha,
} from '../src/modules/onboarding/mission/missionSteps.ts';
import { STEP_ORDER } from '../src/modules/onboarding/mission/missionTypes.ts';

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

// --- O invariante central do spec: as duas missões têm as MESMAS três etapas.
for (const id of ['produto', 'conteudo']) {
  check(
    `missão ${id} tem as três etapas canônicas`,
    MISSOES[id].steps.map((s) => s.id),
    [...STEP_ORDER],
  );
}

// --- Transições
const inicial = criarEstadoInicial('produto');
check('estado inicial começa em contexto', inicial.step, 'contexto');
check('estado inicial não está concluído', inicial.concluidaEm, undefined);
check('progresso inicial', progresso(inicial), { indice: 1, total: 3 });

check('contexto sem dados não está concluído', stepConcluido(inicial), false);

const comUrl = { ...inicial, dados: { produtoId: 'p1' } };
check('contexto com produtoId está concluído', stepConcluido(comUrl), true);
check('próximo passo depois de contexto', proximoStep(comUrl), 'palco');
check('avançar move para palco', avancar(comUrl).step, 'palco');
check('avançar não altera o estado original', comUrl.step, 'contexto');

const noPalco = { ...comUrl, step: 'palco' };
check('palco sem geração não está concluído', stepConcluido(noPalco), false);
const palcoPronto = { ...noPalco, dados: { produtoId: 'p1', descricaoGerada: true } };
check('palco com descrição gerada está concluído', stepConcluido(palcoPronto), true);
check('progresso no palco', progresso(palcoPronto), { indice: 2, total: 3 });

const chegada = avancar(palcoPronto);
check('avançar move para chegada', chegada.step, 'chegada');
check('chegada é o último passo', proximoStep(chegada), null);
check('avançar na chegada não sai da chegada', avancar(chegada).step, 'chegada');

// --- Roteamento da Tela 0 (decisão 1 do spec: conta vazia é o caso principal)
check(
  'conta vazia não recebe sugestão e usa a variante vazia',
  sugerirTrilha({ produtos: 0, erpConectado: false, temProjetoConteudo: false }),
  { sugerida: null, variante: 'vazia' },
);
check(
  'ERP conectado sugere produto',
  sugerirTrilha({ produtos: 1243, erpConectado: true, temProjetoConteudo: false }),
  { sugerida: 'produto', variante: 'com-catalogo' },
);
check(
  'catálogo sem ERP também sugere produto',
  sugerirTrilha({ produtos: 12, erpConectado: false, temProjetoConteudo: false }),
  { sugerida: 'produto', variante: 'com-catalogo' },
);
check(
  'quem já tem projeto de conteúdo e nenhum produto é mandado pra produto',
  sugerirTrilha({ produtos: 0, erpConectado: false, temProjetoConteudo: true }),
  { sugerida: 'produto', variante: 'vazia' },
);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
