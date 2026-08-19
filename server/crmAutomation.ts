// Worker da automação de WhatsApp: percorre os clientes, avalia as automações
// da etapa em que cada um está e dispara os templates configurados.
//
// Seis travas, todas obrigatórias (§Decisões do spec):
//  1. Idempotência via create() — a mesma automação nunca dispara duas vezes
//     para o mesmo cliente, nem sob concorrência nem se o worker reiniciar no
//     meio. Duas automações da mesma etapa NÃO se bloqueiam entre si — cada
//     uma tem sua própria trava (spec 3).
//  2. Consentimento registrado no onboarding (falso por omissão).
//  3. Opt-out do cliente.
//  4. Janela de horário (09h–20h de Brasília).
//  5. Teto de envios por rodada.
//  6. Só template aprovado, nunca texto livre.

import { adminDb } from './firebaseAdmin';
import { recordEvent } from './crmEvents';
import { daysBetween } from './crmStage';
import { resolveParams, shouldSendWhatsApp, type TokenContext } from './crmAutomationRules';
import { isConfigured, sendTemplate } from './whatsappProvider';
import { CRM_STAGES, type CrmAutomation, type CrmStage, type CrmSummary } from '../src/types/crm';

const RUN_INTERVAL_MS = 30 * 60 * 1000; // 30 min

export async function loadAutomations(): Promise<CrmAutomation[]> {
  const snap = await adminDb.collection('crm_automations').get();
  return snap.docs.map((doc) => ({ ...(doc.data() as Omit<CrmAutomation, 'id'>), id: doc.id }));
}

export interface RunResult {
  evaluated: number;
  sent: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  reason?: string;
}

export async function runAutomations(): Promise<RunResult> {
  const status = isConfigured();
  const empty: RunResult = { evaluated: 0, sent: 0, failed: 0, skipped: 0, dryRun: status.dryRun };

  if (!status.configured) {
    return { ...empty, reason: `WhatsApp não configurado (faltam: ${status.missing.join(', ')})` };
  }

  const automations = await loadAutomations();
  const active = automations.filter((a) => a.active && a.templateName);
  if (active.length === 0) return { ...empty, reason: 'Nenhuma automação ativa' };

  // Agrupa por etapa para não repetir o filtro a cada cliente.
  const byStage = new Map<CrmStage, CrmAutomation[]>();
  for (const automation of active) {
    const list = byStage.get(automation.stage) ?? [];
    list.push(automation);
    byStage.set(automation.stage, list);
  }

  const usersSnap = await adminDb.collection('users').get();
  const now = new Date();
  const result: RunResult = { ...empty };

  for (const doc of usersSnap.docs) {
    if (result.sent >= status.maxPerDay) break;

    try {
      const data = doc.data();
      const crm = data.crm as CrmSummary | undefined;
      if (!crm) continue;

      result.evaluated += 1;

      const automationsForStage = byStage.get(crm.stage) ?? [];
      if (automationsForStage.length === 0) continue;

      const whatsapp = String(data.onboarding?.contact?.whatsapp ?? '');
      const consent = data.onboarding?.contact?.whatsappConsent === true;

      for (const automation of automationsForStage) {
        if (result.sent >= status.maxPerDay) break;

        const decision = shouldSendWhatsApp(crm, automation, { whatsapp, consent }, now);
        if (!decision.send) {
          result.skipped += 1;
          continue;
        }

        // Trava de idempotência por automação. create() falha se o doc já
        // existir, então mesmo duas rodadas concorrentes só conseguem enviar
        // uma vez — e a automação "1h" não bloqueia a automação "10h" da
        // mesma etapa, porque cada uma tem seu próprio doc.
        const messageRef = doc.ref.collection('crm_messages').doc(automation.id);
        try {
          await messageRef.create({
            automationId: automation.id,
            stage: crm.stage,
            trigger: automation.trigger,
            templateName: automation.templateName,
            to: whatsapp,
            status: 'pending',
            error: null,
            messageId: null,
            sentAt: now.toISOString(),
            manual: false,
            dryRun: status.dryRun,
          });
        } catch {
          result.skipped += 1;
          continue; // já enviado antes
        }

        const ctx: TokenContext = {
          displayName: data.displayName ?? '',
          companyName: data.company?.nomeFantasia || data.company?.razaoSocial || '',
          credits: Number(data.credits ?? 0),
          stage: crm.stage,
          daysInStage: daysBetween(crm.stageEnteredAt, now),
        };
        const params = resolveParams(automation.bodyParams, ctx);

        try {
          const sent = await sendTemplate(
            whatsapp,
            automation.templateName,
            automation.templateLanguage,
            params,
          );
          await messageRef.update({ status: 'sent', messageId: sent.messageId });
          result.sent += 1;
          void recordEvent(doc.id, 'whatsapp_sent', {
            template: automation.templateName,
            stage: crm.stage,
            trigger: automation.trigger,
            dryRun: status.dryRun,
          });
        } catch (err) {
          // Mantém o doc de idempotência de propósito: um número inválido não
          // deve ser retentado a cada 30 minutos para sempre. O admin reenvia
          // à mão depois de corrigir o cadastro.
          await messageRef.update({ status: 'failed', error: (err as Error).message.slice(0, 500) });
          result.failed += 1;
          console.error(`[whatsapp] envio falhou para ${doc.id}:`, (err as Error).message);
        }
      }
    } catch (err) {
      // Falha num cliente nunca interrompe os demais.
      console.error(`[whatsapp] erro avaliando ${doc.id}:`, err);
    }
  }

  return result;
}

// Mesmo padrão de startCrmScheduler / startTinyScheduler.
export function startAutomationScheduler(): void {
  const run = () => {
    void runAutomations()
      .then((r) => {
        if (r.reason) return; // não configurado ou sem régua ativa: silencioso
        console.log(
          `[whatsapp] rodada: ${r.evaluated} avaliados, ${r.sent} enviados, ${r.failed} falhas${r.dryRun ? ' (dry-run)' : ''}`,
        );
      })
      .catch((err) => console.error('[whatsapp] scheduler falhou:', err));
  };
  setTimeout(run, 120_000); // 2min após o boot, depois da reconciliação
  setInterval(run, RUN_INTERVAL_MS);
}

export function stageFromId(id: string): CrmStage | null {
  return (CRM_STAGES as readonly string[]).includes(id) ? (id as CrmStage) : null;
}
