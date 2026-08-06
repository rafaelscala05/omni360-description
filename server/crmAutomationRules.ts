// Regra pura da automação de WhatsApp: quando disparar, se o horário permite, e
// como resolver os tokens do template.
//
// SEM I/O — nenhum import de firebase, express ou fetch. As decisões que definem
// se um cliente recebe ou não uma mensagem ficam todas aqui, isoladas e
// verificáveis por script (scripts/verify-crm-automation.mjs). Automação de canal
// pessoal erra feio quando erra; essa lógica merece ser testável sozinha.

import { daysBetween, isStagnant } from './crmStage';
import { STAGE_LABELS, type CrmAutomation, type CrmSummary } from '../src/types/crm';

// Janela de envio no horário de Brasília. Mensagem comercial às 3h da manhã
// queima a marca e gera bloqueio na Meta.
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

export type SkipReason =
  | 'sem_automacao'
  | 'inativa'
  | 'sem_template'
  | 'opt_out'
  | 'sem_whatsapp'
  | 'fora_do_horario'
  | 'gatilho_nao_atingido';

export type Decision = { send: true } | { send: false; reason: SkipReason };

// Decide se este cliente deve receber a mensagem desta etapa AGORA.
// Não checa idempotência: isso é responsabilidade do worker, via create() no
// Firestore, que é a única forma de fazer certo sob concorrência.
export function shouldSend(
  summary: CrmSummary,
  automation: CrmAutomation | undefined,
  whatsapp: string,
  now: Date,
): Decision {
  if (!automation) return { send: false, reason: 'sem_automacao' };
  if (!automation.active) return { send: false, reason: 'inativa' };
  if (!automation.templateName) return { send: false, reason: 'sem_template' };
  if (summary.whatsappOptOut === true) return { send: false, reason: 'opt_out' };
  if (!whatsapp?.trim()) return { send: false, reason: 'sem_whatsapp' };
  if (!isWithinSendWindow(now)) return { send: false, reason: 'fora_do_horario' };

  const daysInStage = daysBetween(summary.stageEnteredAt, now);
  const hoursInStage = (now.getTime() - new Date(summary.stageEnteredAt).getTime()) / 3600000;

  if (automation.trigger === 'entered') {
    if (hoursInStage < automation.delayHours) return { send: false, reason: 'gatilho_nao_atingido' };
    return { send: true };
  }

  // 'stagnant': além do limite de dias da etapa, mais o atraso configurado.
  if (!isStagnant(summary, now)) return { send: false, reason: 'gatilho_nao_atingido' };
  if (hoursInStage < automation.delayHours) return { send: false, reason: 'gatilho_nao_atingido' };
  void daysInStage;
  return { send: true };
}

export interface TokenContext {
  displayName: string;
  companyName: string;
  credits: number;
  stage: CrmSummary['stage'];
  daysInStage: number;
}

// Resolve os tokens de um parâmetro. Texto fora dos tokens vai literal.
// Token que resolve vazio vira '—' porque a Cloud API rejeita parâmetro em branco.
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
