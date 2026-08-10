// Verificação da lógica pura da automação de WhatsApp (server/crmAutomationRules.ts).
// Não sobe servidor, não toca o Firestore e não chama a Meta.
// Rodar com: npx tsx scripts/verify-crm-automation.mjs
import {
  brasiliaHour,
  isWithinSendWindow,
  resolveParams,
  resolveToken,
  shouldSend,
} from '../server/crmAutomationRules.ts';
import { emptySummary } from '../server/crmStage.ts';

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

const automation = (over = {}) => ({
  id: 'automation-1',
  stage: 'signed_up',
  active: true,
  trigger: 'stagnant',
  delayHours: 0,
  templateName: 'boas_vindas',
  templateLanguage: 'pt_BR',
  bodyParams: [],
  updatedAt: null,
  updatedBy: null,
  ...over,
});

// --- Horário: 12h UTC = 9h em Brasília (primeiro minuto permitido) ---
check('12h UTC vira 9h em Brasília', brasiliaHour(new Date('2026-08-06T12:00:00Z')), 9);
check('9h de Brasília está na janela', isWithinSendWindow(new Date('2026-08-06T12:00:00Z')), true);
check('8h59 de Brasília está fora', isWithinSendWindow(new Date('2026-08-06T11:59:00Z')), false);
check('20h de Brasília está fora', isWithinSendWindow(new Date('2026-08-06T23:00:00Z')), false);
check('3h da manhã está fora', isWithinSendWindow(new Date('2026-08-06T06:00:00Z')), false);

// Horário comercial usado no resto dos casos
const meioDia = new Date('2026-08-06T15:00:00Z'); // 12h em Brasília

// --- Travas ---
const parado = { ...emptySummary('2026-08-01T00:00:00.000Z'), stageEnteredAt: '2026-08-01T00:00:00.000Z' };

check('sem automação não envia', shouldSend(parado, undefined, { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'sem_automacao',
});
check('automação inativa não envia', shouldSend(parado, automation({ active: false }), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'inativa',
});
check('sem template não envia', shouldSend(parado, automation({ templateName: '' }), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'sem_template',
});
check(
  'opt-out não envia',
  shouldSend({ ...parado, whatsappOptOut: true }, automation(), { whatsapp: '11999999999', consent: true }, meioDia),
  { send: false, reason: 'opt_out' },
);
check('sem whatsapp não envia', shouldSend(parado, automation(), { whatsapp: '', consent: true }, meioDia), {
  send: false,
  reason: 'sem_whatsapp',
});
check(
  'fora do horário não envia',
  shouldSend(parado, automation(), { whatsapp: '11999999999', consent: true }, new Date('2026-08-06T06:00:00Z')),
  { send: false, reason: 'fora_do_horario' },
);

// --- Gatilho 'stagnant': signed_up trava em 3 dias ---
check('5 dias parado em signed_up dispara', shouldSend(parado, automation(), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: true,
});
const recente = { ...emptySummary('2026-08-06T00:00:00.000Z'), stageEnteredAt: '2026-08-06T00:00:00.000Z' };
check('recém-chegado não dispara o gatilho de travado', shouldSend(recente, automation(), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});

// --- Gatilho 'entered' com atraso ---
const entered = automation({ trigger: 'entered', delayHours: 24 });
check('entrou há 15h, atraso de 24h: não dispara', shouldSend(recente, entered, { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});
check('entrou há 5 dias, atraso de 24h: dispara', shouldSend(parado, entered, { whatsapp: '11999999999', consent: true }, meioDia), {
  send: true,
});
check(
  'sem atraso dispara na hora',
  shouldSend(recente, automation({ trigger: 'entered', delayHours: 0 }), { whatsapp: '11999999999', consent: true }, meioDia),
  { send: true },
);

// --- Duas automações ativas na mesma etapa (spec 3): cada uma decide sozinha,
// sem interferir na outra. A trava de idempotência por automação.id é
// responsabilidade do worker (Firestore), não desta função pura — aqui só
// confirmamos que shouldSend() não tem noção de "já existe uma automação
// desta etapa", então nada nela impede as duas de retornar send:true juntas.
const automacao1h = automation({ id: 'auto-1h', trigger: 'entered', delayHours: 1 });
const automacao10h = automation({ id: 'auto-10h', trigger: 'entered', delayHours: 10 });
const entrouHa5h = { ...emptySummary('2026-08-06T10:00:00.000Z'), stageEnteredAt: '2026-08-06T10:00:00.000Z' };
check(
  'duas automações da mesma etapa: a de 1h dispara independente da de 10h',
  shouldSend(entrouHa5h, automacao1h, { whatsapp: '11999999999', consent: true }, meioDia),
  { send: true },
);
check(
  'duas automações da mesma etapa: a de 10h ainda não dispara, mesmo com a de 1h ativa',
  shouldSend(entrouHa5h, automacao10h, { whatsapp: '11999999999', consent: true }, meioDia),
  { send: false, reason: 'gatilho_nao_atingido' },
);

// --- Tokens ---
const ctx = {
  displayName: 'Rafael Scala',
  companyName: 'Alfreds',
  credits: 42,
  stage: 'products_uploaded',
  daysInStage: 7,
};
check('nome usa só o primeiro nome', resolveToken('{{nome}}', ctx), 'Rafael');
check('empresa', resolveToken('{{empresa}}', ctx), 'Alfreds');
check('créditos viram string', resolveToken('{{creditos}}', ctx), '42');
check('etapa usa o rótulo', resolveToken('{{etapa}}', ctx), 'Subiu Produtos');
check('dias', resolveToken('{{dias}}', ctx), '7');
check('texto livre passa literal', resolveToken('Oi, tudo bem?', ctx), 'Oi, tudo bem?');
check('token misturado com texto', resolveToken('Oi {{nome}}, você tem {{creditos}} créditos', ctx), 'Oi Rafael, você tem 42 créditos');
check(
  'token vazio vira travessão (a Cloud API rejeita branco)',
  resolveToken('{{empresa}}', { ...ctx, companyName: '' }),
  '—',
);
check('lista de parâmetros', resolveParams(['{{nome}}', '{{etapa}}'], ctx), ['Rafael', 'Subiu Produtos']);

// Consentimento é obrigatório: quem se cadastrou antes do texto de autorização
// existir não tem a flag, e não pode receber.
check(
  'sem consentimento não envia',
  shouldSend(parado, automation(), { whatsapp: '11999999999', consent: false }, meioDia),
  { send: false, reason: 'sem_consentimento' },
);

// Regressão: a régua não pode disparar para cliente com stageEnteredAt inválido.
const dataRuim = { ...emptySummary('2026-08-01T00:00:00.000Z'), stage: 'active', stageEnteredAt: '2026-W31' };
check('data inválida não dispara a régua', shouldSend(dataRuim, automation({ stage: 'active' }), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
