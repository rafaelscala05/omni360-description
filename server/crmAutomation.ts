// Worker das automações de WhatsApp e e-mail: percorre os clientes, avalia
// as automações da etapa em que cada um está e dispara os canais
// configurados (WhatsApp e/ou e-mail) em cada uma.
//
// Seis travas do WhatsApp (§Decisões do spec 2/3), estendidas para os dois
// canais:
//  1. Idempotência via create() — um lock por {automação}_{canal}, nunca
//     compartilhado entre os dois canais nem entre automações da mesma
//     etapa.
//  2. Consentimento registrado no onboarding (só WhatsApp — exigência da
//     Meta, não existe equivalente de e-mail).
//  3. Opt-out do cliente, independente por canal (whatsappOptOut/emailOptOut).
//  4. Janela de horário (09h–20h de Brasília), para os dois canais.
//  5. Teto de envios por rodada, combinado entre os dois canais.
//  6. WhatsApp só dispara template aprovado; e-mail só dispara com assunto
//     preenchido e o canal ligado na automação.
//
// Cada canal roda de forma independente: se só o e-mail está configurado
// (ou só o WhatsApp), o outro simplesmente não é avaliado — nunca um bloqueia
// o outro.

import { adminAuth, adminDb } from './firebaseAdmin';
import { recordEvent } from './crmEvents';
import { daysBetween } from './crmStage';
import {
  resolveParams,
  resolveToken,
  shouldSendEmail,
  shouldSendWhatsApp,
  type TokenContext,
} from './crmAutomationRules';
import { isConfigured as whatsappIsConfigured, sendTemplate } from './whatsappProvider';
import { isConfigured as emailIsConfigured, sendMail } from './emailProvider';
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
  const waStatus = whatsappIsConfigured();
  const emailStatus = emailIsConfigured();
  const empty: RunResult = {
    evaluated: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    dryRun: waStatus.dryRun || emailStatus.dryRun,
  };

  if (!waStatus.configured && !emailStatus.configured) {
    return { ...empty, reason: 'Nenhum canal configurado (WhatsApp e e-mail)' };
  }

  const automations = await loadAutomations();
  const active = automations.filter(
    (a) => a.active && (a.templateName || (a.emailEnabled && a.emailSubject)),
  );
  if (active.length === 0) return { ...empty, reason: 'Nenhuma automação ativa' };

  // Agrupa por etapa para não repetir o filtro a cada cliente.
  const byStage = new Map<CrmStage, CrmAutomation[]>();
  for (const automation of active) {
    const list = byStage.get(automation.stage) ?? [];
    list.push(automation);
    byStage.set(automation.stage, list);
  }

  const maxPerDay = Math.min(
    waStatus.configured ? waStatus.maxPerDay : Infinity,
    emailStatus.configured ? emailStatus.maxPerDay : Infinity,
  );

  const usersSnap = await adminDb.collection('users').get();
  const now = new Date();
  const result: RunResult = { ...empty };

  for (const doc of usersSnap.docs) {
    if (result.sent >= maxPerDay) break;

    try {
      const data = doc.data();
      const crm = data.crm as CrmSummary | undefined;
      if (!crm) continue;

      result.evaluated += 1;

      const automationsForStage = byStage.get(crm.stage) ?? [];
      if (automationsForStage.length === 0) continue;

      const whatsapp = String(data.onboarding?.contact?.whatsapp ?? '');
      const consent = data.onboarding?.contact?.whatsappConsent === true;

      const ctx: TokenContext = {
        displayName: data.displayName ?? '',
        companyName: data.company?.nomeFantasia || data.company?.razaoSocial || '',
        credits: Number(data.credits ?? 0),
        stage: crm.stage,
        daysInStage: daysBetween(crm.stageEnteredAt, now),
      };

      // E-mail só é resolvido (chamada ao Admin Auth) se alguma automação
      // desta etapa tem o canal ligado — evita uma chamada de Auth por
      // cliente sem necessidade.
      let email = '';
      if (emailStatus.configured && automationsForStage.some((a) => a.emailEnabled)) {
        try {
          email = (await adminAuth.getUser(doc.id)).email ?? '';
        } catch {
          email = '';
        }
      }

      for (const automation of automationsForStage) {
        if (result.sent >= maxPerDay) break;

        if (waStatus.configured) {
          const decision = shouldSendWhatsApp(crm, automation, { whatsapp, consent }, now);
          if (!decision.send) {
            result.skipped += 1;
          } else {
            const messageRef = doc.ref.collection('crm_messages').doc(`${automation.id}_whatsapp`);
            const locked = await tryLock(messageRef, {
              automationId: automation.id,
              channel: 'whatsapp',
              stage: crm.stage,
              trigger: automation.trigger,
              template: automation.templateName,
              to: whatsapp,
              sentAt: now.toISOString(),
              dryRun: waStatus.dryRun,
            });
            if (!locked) {
              result.skipped += 1;
            } else {
              const params = resolveParams(automation.bodyParams, ctx);
              try {
                const sent = await sendTemplate(whatsapp, automation.templateName, automation.templateLanguage, params);
                await messageRef.update({ status: 'sent', messageId: sent.messageId });
                result.sent += 1;
                void recordEvent(doc.id, 'whatsapp_sent', {
                  template: automation.templateName,
                  stage: crm.stage,
                  trigger: automation.trigger,
                  dryRun: waStatus.dryRun,
                });
              } catch (err) {
                // Mantém o doc de idempotência de propósito: um número inválido
                // não deve ser retentado a cada 30 minutos para sempre. O admin
                // reenvia à mão depois de corrigir o cadastro.
                await messageRef.update({ status: 'failed', error: (err as Error).message.slice(0, 500) });
                result.failed += 1;
                console.error(`[whatsapp] envio falhou para ${doc.id}:`, (err as Error).message);
              }
            }
          }
        }

        if (result.sent >= maxPerDay) break;

        if (emailStatus.configured) {
          const decision = shouldSendEmail(crm, automation, { email, optOut: crm.emailOptOut === true }, now);
          if (!decision.send) {
            result.skipped += 1;
          } else {
            const messageRef = doc.ref.collection('crm_messages').doc(`${automation.id}_email`);
            const subject = resolveToken(automation.emailSubject, ctx);
            const locked = await tryLock(messageRef, {
              automationId: automation.id,
              channel: 'email',
              stage: crm.stage,
              trigger: automation.trigger,
              template: subject,
              to: email,
              sentAt: now.toISOString(),
              dryRun: emailStatus.dryRun,
            });
            if (!locked) {
              result.skipped += 1;
            } else {
              const body = resolveToken(automation.emailBody, ctx);
              try {
                const sent = await sendMail(email, subject, body);
                await messageRef.update({ status: 'sent', messageId: sent.messageId });
                result.sent += 1;
                void recordEvent(doc.id, 'email_sent', {
                  template: subject,
                  stage: crm.stage,
                  trigger: automation.trigger,
                  dryRun: emailStatus.dryRun,
                });
              } catch (err) {
                await messageRef.update({ status: 'failed', error: (err as Error).message.slice(0, 500) });
                result.failed += 1;
                console.error(`[email] envio falhou para ${doc.id}:`, (err as Error).message);
              }
            }
          }
        }
      }
    } catch (err) {
      // Falha num cliente nunca interrompe os demais.
      console.error(`[crm-automation] erro avaliando ${doc.id}:`, err);
    }
  }

  return result;
}

// Trava de idempotência por automação+canal. create() falha se o doc já
// existir, então mesmo duas rodadas concorrentes só conseguem enviar uma
// vez — e o canal de e-mail não bloqueia nem depende do de WhatsApp, porque
// cada um tem seu próprio doc.
async function tryLock(
  ref: FirebaseFirestore.DocumentReference,
  fields: {
    automationId: string;
    channel: 'whatsapp' | 'email';
    stage: CrmStage;
    trigger: CrmAutomation['trigger'];
    template: string;
    to: string;
    sentAt: string;
    dryRun: boolean;
  },
): Promise<boolean> {
  try {
    await ref.create({
      ...fields,
      status: 'pending',
      error: null,
      messageId: null,
      manual: false,
    });
    return true;
  } catch {
    return false; // já enviado antes
  }
}

// Mesmo padrão de startCrmScheduler / startTinyScheduler.
export function startAutomationScheduler(): void {
  const run = () => {
    void runAutomations()
      .then((r) => {
        if (r.reason) return; // nenhum canal configurado ou sem régua ativa: silencioso
        console.log(
          `[crm-automation] rodada: ${r.evaluated} avaliados, ${r.sent} enviados, ${r.failed} falhas${r.dryRun ? ' (dry-run)' : ''}`,
        );
      })
      .catch((err) => console.error('[crm-automation] scheduler falhou:', err));
  };
  setTimeout(run, 120_000); // 2min após o boot, depois da reconciliação
  setInterval(run, RUN_INTERVAL_MS);
}

export function stageFromId(id: string): CrmStage | null {
  return (CRM_STAGES as readonly string[]).includes(id) ? (id as CrmStage) : null;
}
