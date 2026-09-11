// Regras puras do contato pedido durante a missão (sem I/O). A rota em
// onboardingAgent.ts só faz a transação em volta disto.

import { formatarWhatsapp, normalizarWhatsapp, whatsappValido } from '../src/modules/onboarding/mission/whatsapp';
import { WHATSAPP_CONSENT_TEXT, type OnboardingContact } from '../src/types/onboarding';

export function validarPedidoContato(body: unknown): { ok: true; digitos: string } | { ok: false; erro: string } {
  const raw = (body as { whatsapp?: unknown } | null)?.whatsapp;
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, erro: 'Informe o WhatsApp' };
  const digitos = normalizarWhatsapp(raw);
  if (!whatsappValido(digitos)) return { ok: false, erro: 'Número de WhatsApp inválido — use DDD + número' };
  return { ok: true, digitos };
}

/**
 * A missão pede só o número. Nome e e-mail vêm da conta Google, e o
 * consentimento é gravado com o texto exato exibido e a data — sem isso ele
 * não é comprovável (LGPD e política de opt-in da Meta).
 */
export function montarContatoMissao(
  digitos: string, conta: { email?: string; name?: string }, agoraIso: string,
): OnboardingContact {
  const [primeiro = '', ...resto] = String(conta.name ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    whatsapp: formatarWhatsapp(digitos),
    corporateEmail: conta.email ?? '',
    sameAsAccountEmail: true,
    firstName: primeiro,
    lastName: resto.join(' '),
    whatsappConsent: true,
    whatsappConsentAt: agoraIso,
    whatsappConsentText: WHATSAPP_CONSENT_TEXT,
  };
}
