// Regra pura da automação de WhatsApp e e-mail: quando disparar, se o
// horário permite, e como resolver os tokens do template/assunto/corpo.
//
// SEM I/O — nenhum import de firebase, express ou fetch. As decisões que
// definem se um cliente recebe ou não uma mensagem ficam todas aqui,
// isoladas e verificáveis por script (scripts/verify-crm-automation.mjs).
// Automação de canal pessoal erra feio quando erra; essa lógica merece ser
// testável sozinha.

import { daysBetween, isStagnant } from './crmStage';
import { STAGE_LABELS, type CrmAutomation, type CrmSummary } from '../src/types/crm';

// Janela de envio no horário de Brasília. Mensagem comercial às 3h da manhã
// queima a marca e gera bloqueio na Meta (e é indelicada por e-mail também).
export const SEND_WINDOW = { startHour: 9, endHour: 20 };

// Hora do dia em Brasília (UTC-3), sem depender do fuso do servidor — em produção
// o App Hosting roda em UTC.
export function brasiliaHour(now: Date): number {
  return (now.getUTCHours() - 3 + 24) % 24;
}

export function isWithinSendWindow(now: Date): boolean {
  const hour = brasiliaHour(now);
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}

// Gatilho + atraso — sem checks de canal ou janela. Responsabilidade de
// cada shouldSendX é chamar este depois de verificar a janela.
function isTriggerDue(summary: CrmSummary, automation: CrmAutomation, now: Date): boolean {
  const hoursInStage = (now.getTime() - new Date(summary.stageEnteredAt).getTime()) / 3600000;

  if (automation.trigger === 'entered') {
    return hoursInStage >= automation.delayHours;
  }
  // 'stagnant': além do limite de dias da etapa, mais o atraso configurado.
  return isStagnant(summary, now) && hoursInStage >= automation.delayHours;
}

export type SkipReason =
  | 'sem_automacao'
  | 'inativa'
  | 'sem_template'
  | 'opt_out'
  | 'sem_whatsapp'
  | 'sem_consentimento'
  | 'fora_do_horario'
  | 'gatilho_nao_atingido';

export type Decision = { send: true } | { send: false; reason: SkipReason | EmailSkipReason };

export interface ContactInfo {
  whatsapp: string;
  // Autorização registrada no onboarding. Quem se cadastrou antes de o texto de
  // consentimento existir não tem esta flag — e não consentiu de fato, então não
  // recebe. Falso por omissão é a única leitura defensável.
  consent: boolean;
}

// Decide se este cliente deve receber a mensagem de WhatsApp desta etapa
// AGORA. Não checa idempotência: isso é responsabilidade do worker, via
// create() no Firestore, que é a única forma de fazer certo sob concorrência.
export function shouldSendWhatsApp(
  summary: CrmSummary,
  automation: CrmAutomation | undefined,
  contact: ContactInfo,
  now: Date,
): Decision {
  if (!automation) return { send: false, reason: 'sem_automacao' };
  if (!automation.active) return { send: false, reason: 'inativa' };
  if (!automation.templateName) return { send: false, reason: 'sem_template' };
  if (summary.whatsappOptOut === true) return { send: false, reason: 'opt_out' };
  if (!contact.whatsapp?.trim()) return { send: false, reason: 'sem_whatsapp' };
  if (!contact.consent) return { send: false, reason: 'sem_consentimento' };
  if (!isWithinSendWindow(now)) return { send: false, reason: 'fora_do_horario' };
  if (!isTriggerDue(summary, automation, now)) return { send: false, reason: 'gatilho_nao_atingido' };
  return { send: true };
}

export type EmailSkipReason =
  | 'sem_automacao'
  | 'inativa'
  | 'email_desativado'
  | 'sem_assunto'
  | 'opt_out'
  | 'sem_email'
  | 'fora_do_horario'
  | 'gatilho_nao_atingido';

export interface EmailContactInfo {
  email: string;
  optOut: boolean;
}

// Decide se este cliente deve receber o e-mail desta etapa AGORA. Não exige
// consentimento (isso é regra específica da política da Meta para
// WhatsApp) — só respeita o opt-out próprio do canal.
export function shouldSendEmail(
  summary: CrmSummary,
  automation: CrmAutomation | undefined,
  contact: EmailContactInfo,
  now: Date,
): Decision {
  if (!automation) return { send: false, reason: 'sem_automacao' };
  if (!automation.active) return { send: false, reason: 'inativa' };
  if (!automation.emailEnabled) return { send: false, reason: 'email_desativado' };
  if (!automation.emailSubject.trim()) return { send: false, reason: 'sem_assunto' };
  if (contact.optOut) return { send: false, reason: 'opt_out' };
  if (!contact.email?.trim()) return { send: false, reason: 'sem_email' };
  if (!isWithinSendWindow(now)) return { send: false, reason: 'fora_do_horario' };
  if (!isTriggerDue(summary, automation, now)) return { send: false, reason: 'gatilho_nao_atingido' };
  return { send: true };
}

export interface TokenContext {
  displayName: string;
  companyName: string;
  credits: number;
  stage: CrmSummary['stage'];
  daysInStage: number;
}

// Resolve os tokens de um texto (parâmetro de template, assunto ou corpo de
// e-mail). Texto fora dos tokens vai literal.
// Token que resolve vazio vira '—' porque a Cloud API rejeita parâmetro em
// branco — mantido também para e-mail por consistência (um assunto/corpo
// nunca deve terminar em branco visível).
export function resolveToken(raw: string, ctx: TokenContext): string {
  const firstName = ctx.displayName.trim().split(/\s+/)[0] ?? '';
  const replaced = raw
    .replaceAll('{{nome}}', firstName)
    .replaceAll('{{empresa}}', ctx.companyName)
    .replaceAll('{{creditos}}', String(ctx.credits))
    .replaceAll('{{etapa}}', STAGE_LABELS[ctx.stage])
    .replaceAll('{{dias}}', String(ctx.daysInStage));
  return replaced.trim() || '—';
}

export function resolveParams(params: string[], ctx: TokenContext): string[] {
  return params.map((p) => resolveToken(p, ctx));
}
