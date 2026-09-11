// Regras puras do contato da missão. Rodar com: npx tsx scripts/verify-mission-contact.mjs
import { formatarWhatsapp, normalizarWhatsapp, whatsappValido } from '../src/modules/onboarding/mission/whatsapp.ts';
import { montarContatoMissao, validarPedidoContato } from '../server/onboardingMissionRules.ts';
import { WHATSAPP_CONSENT_TEXT } from '../src/types/onboarding.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('máscara vira dígitos', normalizarWhatsapp('(11) 98765-4321'), '11987654321');
check('+55 é removido', normalizarWhatsapp('+55 11 98765-4321'), '11987654321');
check('celular com DDD é válido', whatsappValido('11987654321'), true);
check('fixo com DDD é válido', whatsappValido('1133334444'), true);
check('curto demais é inválido', whatsappValido('98765'), false);
check('formata celular no padrão do wizard legado', formatarWhatsapp('11987654321'), '(11) 98765-4321');
check('formata fixo', formatarWhatsapp('1133334444'), '(11) 3333-4444');

check('pedido válido', validarPedidoContato({ whatsapp: '(11) 98765-4321' }), { ok: true, digitos: '11987654321' });
check('pedido sem número', validarPedidoContato({}).ok, false);
check('pedido com número inválido', validarPedidoContato({ whatsapp: '123' }).ok, false);

const c = montarContatoMissao('11987654321', { email: 'm@loja.com', name: 'Márcia Souza Lima' }, '2026-09-10T22:00:00.000Z');
check('grava no formato mascarado do legado', c.whatsapp, '(11) 98765-4321');
check('nome vem da conta Google', [c.firstName, c.lastName], ['Márcia', 'Souza Lima']);
check('e-mail da conta', [c.corporateEmail, c.sameAsAccountEmail], ['m@loja.com', true]);
check('consentimento com o texto exato', [c.whatsappConsent, c.whatsappConsentText], [true, WHATSAPP_CONSENT_TEXT]);
check('data do consentimento', c.whatsappConsentAt, '2026-09-10T22:00:00.000Z');
check('conta sem nome', montarContatoMissao('11987654321', {}, 'x').firstName, '');

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
