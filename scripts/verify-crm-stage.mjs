// Verificação da lógica pura do CRM (server/crmStage.ts). Não sobe servidor e
// não toca o Firestore. Rodar com: npx tsx scripts/verify-crm-stage.mjs
import {
  applyEventToSummary,
  computeHealth,
  emptySummary,
  isStagnant,
  isoWeek,
  resolveStage,
} from '../server/crmStage.ts';

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

// resolveStage pega o marco mais alto, não o último inserido
check('estágio de conta nova', resolveStage({ signed_up: '2026-01-01T00:00:00.000Z' }), 'signed_up');
check(
  'estágio mais alto vence a ordem de inserção',
  resolveStage({
    content_generated: '2026-01-03T00:00:00.000Z',
    signed_up: '2026-01-01T00:00:00.000Z',
    products_uploaded: '2026-01-02T00:00:00.000Z',
  }),
  'content_generated',
);

// isoWeek
check('semana ISO', isoWeek('2026-08-06T12:00:00.000Z'), '2026-W32');

// Um evento de geração move o estágio e conta
let s = emptySummary('2026-08-01T00:00:00.000Z');
s = applyEventToSummary(s, 'spreadsheet_import', '2026-08-01T10:00:00.000Z');
check('import move para products_uploaded', s.stage, 'products_uploaded');
s = applyEventToSummary(s, 'description_generated', '2026-08-01T11:00:00.000Z');
check('geração move para content_generated', s.stage, 'content_generated');
check('contador de descrições', s.counters.descriptions, 1);

// Estágio nunca regride
s = applyEventToSummary(s, 'login', '2026-08-02T09:00:00.000Z');
check('login não rebaixa o estágio', s.stage, 'content_generated');

// 'active' exige 2 semanas distintas APÓS integrar/exportar
s = applyEventToSummary(s, 'spreadsheet_export', '2026-08-06T09:00:00.000Z');
check('export move para integrated_or_exported', s.stage, 'integrated_or_exported');
check('ainda não é ativo com uma semana só', s.milestones.active, undefined);
s = applyEventToSummary(s, 'description_generated', '2026-08-13T09:00:00.000Z');
check('segunda semana distinta vira ativo', s.stage, 'active');

// Estagnação usa o limite do estágio corrente
const parado = emptySummary('2026-08-01T00:00:00.000Z');
check('recém-cadastrado não está estagnado', isStagnant(parado, new Date('2026-08-02T00:00:00.000Z')), false);
check('4 dias em signed_up está estagnado', isStagnant(parado, new Date('2026-08-05T00:00:00.000Z')), true);

// Health: cliente ideal x cliente sumido
const base = emptySummary('2026-08-06T00:00:00.000Z');
const health = computeHealth(
  { ...base, stage: 'active', counters: { ...base.counters, aiOps30d: 60 } },
  new Date('2026-08-06T12:00:00.000Z'),
  { credits: 10, hasPurchased: true },
);
check('cliente ideal pontua 100', health.score, 100);
check('cliente ideal é banda ativo', health.band, 'ativo');

const frio = computeHealth(emptySummary('2026-01-01T00:00:00.000Z'), new Date('2026-08-06T00:00:00.000Z'), {
  credits: 0,
  hasPurchased: false,
});
check('cliente sumido pontua 0', frio.score, 0);
check('cliente sumido é banda inativo', frio.band, 'inativo');

// 'active' é terminal: nunca conta como travado, por mais tempo que passe.
const recorrente = { ...emptySummary('2026-01-01T00:00:00.000Z'), stage: 'active', stageEnteredAt: '2026-01-01T00:00:00.000Z' };
check('estágio terminal nunca fica travado', isStagnant(recorrente, new Date('2026-08-06T00:00:00.000Z')), false);

// Regressão: marco 'active' com data inválida NÃO pode marcar como travado —
// esse sinal dispara WhatsApp, então dado ruim jamais pode virar disparo.
const dataRuim = { ...emptySummary('2026-08-01T00:00:00.000Z'), stage: 'active', stageEnteredAt: '2026-W31' };
check('data inválida não marca como travado', isStagnant(dataRuim, new Date('2026-08-06T00:00:00.000Z')), false);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
