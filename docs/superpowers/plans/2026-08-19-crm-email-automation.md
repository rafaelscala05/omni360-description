# CRM Email Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an SMTP email channel to the existing per-stage CRM automation, so each `crm_automations/{id}` record can fire WhatsApp and/or email on the same trigger.

**Architecture:** Mirror the existing WhatsApp automation stack one layer at a time: a new isolated `server/emailProvider.ts` (nodemailer, same `isConfigured()`/send-function shape as `whatsappProvider.ts`), extended pure decision logic in `server/crmAutomationRules.ts` (`shouldSendEmail` alongside the renamed `shouldSendWhatsApp`, sharing a new `isTriggerDue` helper), a worker (`server/crmAutomation.ts`) that evaluates both channels per automation with independent idempotency locks, admin CRUD/status routes in `server/crmAdmin.ts`, and an admin UI extension in `AutomationsView.tsx` / `CustomerWhatsApp.tsx`.

**Tech Stack:** TypeScript, Express, Firebase Admin SDK (Firestore + Auth), React 19, `nodemailer` (new dependency), `tsx` for running server code and the verify script directly.

**Spec:** `docs/superpowers/specs/2026-08-19-crm-email-automation-design.md`

## Global Constraints

- No automated test suite in this repo (per `CLAUDE.md`) — verification is `npx tsx scripts/verify-crm-automation.mjs`, `npm run lint` (tsc --noEmit), and manual dry-run testing against the dev server.
- All UI text, code comments that explain *why*, and admin-facing strings are pt-BR, matching the rest of the codebase.
- Every new SMTP env var is optional at the process level — if unset, `email.isConfigured().configured === false` and the email channel silently no-ops, exactly like the WhatsApp provider today. Never throw at boot for missing SMTP config.
- Idempotency locks are one Firestore doc per `{automationId}_{channel}` — never share a lock between WhatsApp and email for the same automation.
- `git commit` after every task (not every step) — small, working increments.

---

### Task 1: Add `nodemailer` dependency and SMTP/email env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `nodemailer` importable from `server/emailProvider.ts` in Task 4; env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `EMAIL_DRY_RUN`, `EMAIL_MAX_PER_DAY` consumed by `emailProvider.isConfigured()`.

- [ ] **Step 1: Install `nodemailer` and its types**

Run:
```bash
npm install nodemailer
npm install -D @types/nodemailer
```

- [ ] **Step 2: Verify `package.json` picked up both entries**

Run: `grep -n '"nodemailer"' package.json`
Expected: two lines — one in `dependencies`, one (`@types/nodemailer`) in `devDependencies`.

- [ ] **Step 3: Add the SMTP/email env vars to `.env.example`**

Open `.env.example`, find the existing WhatsApp block (`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_WABA_ID` / `WHATSAPP_MAX_PER_DAY` / `WHATSAPP_DRY_RUN`), and append directly after it:

```
# E-mail (SMTP genérico — Gmail Workspace, SES, SendGrid SMTP relay, Zoho etc.)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Omni360 <no-reply@seudominio.com>"
EMAIL_DRY_RUN=false
EMAIL_MAX_PER_DAY=100
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add nodemailer dependency and SMTP env vars"
```

---

### Task 2: Extend `src/types/crm.ts` schema for the email channel

**Files:**
- Modify: `src/types/crm.ts:66-84` (`CrmSummary`), `:228-239` (`CrmAutomation`), `:241-256` (`CrmMessage`), `:267-272` (`WhatsAppStatus`, add `EmailStatus`), `:286-298` (`defaultAutomation`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CrmAutomation.emailEnabled/emailSubject/emailBody`, `CrmSummary.emailOptOut`, `CrmMessage.channel`/`template` (renamed from `templateName`), `EmailStatus` type — all consumed by every later task.

- [ ] **Step 1: Add `emailOptOut` to `CrmSummary`**

In `src/types/crm.ts`, find:
```ts
  // Bloqueia todo envio automático de WhatsApp. Respeitar isso é exigência da
  // política da Meta, não só cortesia.
  whatsappOptOut?: boolean;
  updatedAt: string;
```
Replace with:
```ts
  // Bloqueia todo envio automático de WhatsApp. Respeitar isso é exigência da
  // política da Meta, não só cortesia.
  whatsappOptOut?: boolean;
  // Opt-out de e-mail, independente do de WhatsApp — cada canal tem sua
  // própria trava.
  emailOptOut?: boolean;
  updatedAt: string;
```

- [ ] **Step 2: Add email fields to `CrmAutomation`**

Find:
```ts
export interface CrmAutomation {
  id: string;
  stage: CrmStage;
  active: boolean;
  trigger: AutomationTrigger;
  delayHours: number;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}
```
Replace with:
```ts
export interface CrmAutomation {
  id: string;
  stage: CrmStage;
  active: boolean;
  trigger: AutomationTrigger;
  delayHours: number;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  // Canal de e-mail, mesmo trigger/delayHours do WhatsApp acima — só o
  // conteúdo e o "ligado/desligado" são independentes.
  emailEnabled: boolean;
  emailSubject: string;
  emailBody: string; // HTML; mesmos tokens de TEMPLATE_TOKENS
  updatedAt: string | null;
  updatedBy: string | null;
}
```

- [ ] **Step 3: Rename `CrmMessage.templateName` to `template` and add `channel`**

Find:
```ts
export interface CrmMessage {
  id: string;
  // null para envios manuais e para mensagens antigas gravadas antes desta
  // mudança (id de documento era o nome da etapa, não de uma automação).
  automationId: string | null;
  stage: CrmStage | 'manual';
  trigger: AutomationTrigger | 'manual';
  templateName: string;
  to: string;
  status: 'sent' | 'failed';
  error: string | null;
  messageId: string | null;
  sentAt: string;
  manual: boolean;
  dryRun: boolean;
}
```
Replace with:
```ts
export interface CrmMessage {
  id: string;
  // null para envios manuais e para mensagens antigas gravadas antes desta
  // mudança (id de documento era o nome da etapa, não de uma automação).
  automationId: string | null;
  // Docs gravados antes deste campo existir são sempre WhatsApp — não há
  // migração retroativa, a UI trata 'channel' ausente como 'whatsapp'.
  channel: 'whatsapp' | 'email';
  stage: CrmStage | 'manual';
  trigger: AutomationTrigger | 'manual';
  // templateName (whatsapp) ou emailSubject (email) resolvido no momento do envio.
  template: string;
  to: string;
  status: 'sent' | 'failed';
  error: string | null;
  messageId: string | null;
  sentAt: string;
  manual: boolean;
  dryRun: boolean;
}
```

- [ ] **Step 4: Add `EmailStatus` next to `WhatsAppStatus`**

Find:
```ts
export interface WhatsAppStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}
```
Add directly after it:
```ts
export interface EmailStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}
```

- [ ] **Step 5: Update `defaultAutomation()`**

Find:
```ts
export function defaultAutomation(stage: CrmStage): Omit<CrmAutomation, 'id'> {
  return {
    stage,
    active: false,
    trigger: 'stagnant',
    delayHours: 0,
    templateName: '',
    templateLanguage: 'pt_BR',
    bodyParams: [],
    updatedAt: null,
    updatedBy: null,
  };
}
```
Replace with:
```ts
export function defaultAutomation(stage: CrmStage): Omit<CrmAutomation, 'id'> {
  return {
    stage,
    active: false,
    trigger: 'stagnant',
    delayHours: 0,
    templateName: '',
    templateLanguage: 'pt_BR',
    bodyParams: [],
    emailEnabled: false,
    emailSubject: '',
    emailBody: '',
    updatedAt: null,
    updatedBy: null,
  };
}
```

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: FAILS — `server/crmAdmin.ts` and `src/modules/admin/CustomerWhatsApp.tsx` still write/read `CrmMessage.templateName`, and `server/crmAutomation.ts`/`server/crmAdmin.ts` construct `CrmMessage`/`CrmAutomation` objects missing the new required fields. This is expected; those call sites are fixed in Tasks 5, 6, 9. Confirm the errors are only in those two files plus `crmAutomation.ts`/`crmAdmin.ts` — no unrelated breakage.

- [ ] **Step 7: Commit**

```bash
git add src/types/crm.ts
git commit -m "feat(types): extend CrmAutomation/CrmSummary/CrmMessage for email channel"
```

---

### Task 3: Extend `server/crmAutomationRules.ts` with `shouldSendEmail`

**Files:**
- Modify: `server/crmAutomationRules.ts` (whole file restructure of the trigger logic + new function)
- Modify: `server/crmAutomation.ts:18,81` (import/call rename only, mechanical)
- Modify: `scripts/verify-crm-automation.mjs` (rename `shouldSend` calls, add email cases)

**Interfaces:**
- Consumes: `CrmAutomation.emailEnabled/emailSubject/emailBody` (Task 2), `CrmSummary.emailOptOut` (Task 2).
- Produces: `shouldSendWhatsApp(summary, automation, contact, now): Decision` (renamed from `shouldSend`, same signature/behavior), `shouldSendEmail(summary, automation, contact, now): Decision` — consumed by `server/crmAutomation.ts` (Task 5) and `server/crmAdmin.ts` (Task 6 does NOT need it, manual send stays WhatsApp-only per spec scope).

- [ ] **Step 1: Rewrite `server/crmAutomationRules.ts`**

Replace the whole file with:
```ts
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

// Gatilho + atraso + janela de horário — igual para os dois canais. Não checa
// nada específico de canal (template, opt-out, contato): isso é
// responsabilidade de cada shouldSendX.
function isTriggerDue(summary: CrmSummary, automation: CrmAutomation, now: Date): boolean {
  if (!isWithinSendWindow(now)) return false;
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
```

Note: `resolveToken` trims and collapses an empty result to `'—'`. For e-mail this only matters if `emailSubject`/`emailBody` resolve to nothing at all (e.g. a body that's only `{{empresa}}` for a client with no company name) — acceptable, matches the existing WhatsApp behavior 1:1 rather than adding a second code path.

- [ ] **Step 2: Fix the rename in `server/crmAutomation.ts`**

In `server/crmAutomation.ts`, line 18:
```ts
import { resolveParams, shouldSend, type TokenContext } from './crmAutomationRules';
```
becomes:
```ts
import { resolveParams, shouldSendWhatsApp, type TokenContext } from './crmAutomationRules';
```
And line 81:
```ts
        const decision = shouldSend(crm, automation, { whatsapp, consent }, now);
```
becomes:
```ts
        const decision = shouldSendWhatsApp(crm, automation, { whatsapp, consent }, now);
```
(Task 5 rewrites this whole file anyway — this step just keeps the tree compiling in between tasks. If you're doing Task 5 immediately after this one in the same sitting, you may skip this step and do the rename as part of Task 5's rewrite instead — but run Step 4 below either way before moving on.)

- [ ] **Step 3: Update `scripts/verify-crm-automation.mjs`: rename + add email cases**

Replace the whole file with:
```js
// Verificação da lógica pura da automação de WhatsApp e e-mail
// (server/crmAutomationRules.ts). Não sobe servidor, não toca o Firestore e
// não chama a Meta nem um SMTP real.
// Rodar com: npx tsx scripts/verify-crm-automation.mjs
import {
  brasiliaHour,
  isWithinSendWindow,
  resolveParams,
  resolveToken,
  shouldSendEmail,
  shouldSendWhatsApp,
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
  emailEnabled: true,
  emailSubject: 'Bem-vindo!',
  emailBody: 'Oi {{nome}}, bem-vindo.',
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

// --- Travas (WhatsApp) ---
const parado = { ...emptySummary('2026-08-01T00:00:00.000Z'), stageEnteredAt: '2026-08-01T00:00:00.000Z' };

check('sem automação não envia (whatsapp)', shouldSendWhatsApp(parado, undefined, { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'sem_automacao',
});
check('automação inativa não envia (whatsapp)', shouldSendWhatsApp(parado, automation({ active: false }), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'inativa',
});
check('sem template não envia', shouldSendWhatsApp(parado, automation({ templateName: '' }), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'sem_template',
});
check(
  'opt-out de whatsapp não envia whatsapp',
  shouldSendWhatsApp({ ...parado, whatsappOptOut: true }, automation(), { whatsapp: '11999999999', consent: true }, meioDia),
  { send: false, reason: 'opt_out' },
);
check('sem whatsapp não envia', shouldSendWhatsApp(parado, automation(), { whatsapp: '', consent: true }, meioDia), {
  send: false,
  reason: 'sem_whatsapp',
});
check(
  'fora do horário não envia (whatsapp)',
  shouldSendWhatsApp(parado, automation(), { whatsapp: '11999999999', consent: true }, new Date('2026-08-06T06:00:00Z')),
  { send: false, reason: 'fora_do_horario' },
);

// --- Gatilho 'stagnant': signed_up trava em 3 dias ---
check('5 dias parado em signed_up dispara (whatsapp)', shouldSendWhatsApp(parado, automation(), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: true,
});
const recente = { ...emptySummary('2026-08-06T00:00:00.000Z'), stageEnteredAt: '2026-08-06T00:00:00.000Z' };
check('recém-chegado não dispara o gatilho de travado (whatsapp)', shouldSendWhatsApp(recente, automation(), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});

// --- Gatilho 'entered' com atraso ---
const entered = automation({ trigger: 'entered', delayHours: 24 });
check('entrou há 15h, atraso de 24h: não dispara (whatsapp)', shouldSendWhatsApp(recente, entered, { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});
check('entrou há 5 dias, atraso de 24h: dispara (whatsapp)', shouldSendWhatsApp(parado, entered, { whatsapp: '11999999999', consent: true }, meioDia), {
  send: true,
});
check(
  'sem atraso dispara na hora (whatsapp)',
  shouldSendWhatsApp(recente, automation({ trigger: 'entered', delayHours: 0 }), { whatsapp: '11999999999', consent: true }, meioDia),
  { send: true },
);

// --- Duas automações ativas na mesma etapa (spec 3): cada uma decide sozinha,
// sem interferir na outra. A trava de idempotência por automação.id é
// responsabilidade do worker (Firestore), não desta função pura — aqui só
// confirmamos que shouldSendWhatsApp() não tem noção de "já existe uma
// automação desta etapa", então nada nela impede as duas de retornar
// send:true juntas.
const automacao1h = automation({ id: 'auto-1h', trigger: 'entered', delayHours: 1 });
const automacao10h = automation({ id: 'auto-10h', trigger: 'entered', delayHours: 10 });
const entrouHa5h = { ...emptySummary('2026-08-06T10:00:00.000Z'), stageEnteredAt: '2026-08-06T10:00:00.000Z' };
check(
  'duas automações da mesma etapa: a de 1h dispara independente da de 10h',
  shouldSendWhatsApp(entrouHa5h, automacao1h, { whatsapp: '11999999999', consent: true }, meioDia),
  { send: true },
);
check(
  'duas automações da mesma etapa: a de 10h ainda não dispara, mesmo com a de 1h ativa',
  shouldSendWhatsApp(entrouHa5h, automacao10h, { whatsapp: '11999999999', consent: true }, meioDia),
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

// Consentimento é obrigatório só para WhatsApp: quem se cadastrou antes do
// texto de autorização existir não tem a flag, e não pode receber.
check(
  'sem consentimento não envia (whatsapp)',
  shouldSendWhatsApp(parado, automation(), { whatsapp: '11999999999', consent: false }, meioDia),
  { send: false, reason: 'sem_consentimento' },
);

// Regressão: a régua não pode disparar para cliente com stageEnteredAt inválido.
const dataRuim = { ...emptySummary('2026-08-01T00:00:00.000Z'), stage: 'active', stageEnteredAt: '2026-W31' };
check('data inválida não dispara a régua (whatsapp)', shouldSendWhatsApp(dataRuim, automation({ stage: 'active' }), { whatsapp: '11999999999', consent: true }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});
check('data inválida não dispara a régua (email)', shouldSendEmail(dataRuim, automation({ stage: 'active' }), { email: 'a@b.com', optOut: false }, meioDia), {
  send: false,
  reason: 'gatilho_nao_atingido',
});

// --- E-mail: mesmas travas de gatilho/horário, motivos próprios de canal ---
check('sem automação não envia (email)', shouldSendEmail(parado, undefined, { email: 'a@b.com', optOut: false }, meioDia), {
  send: false,
  reason: 'sem_automacao',
});
check('automação inativa não envia (email)', shouldSendEmail(parado, automation({ active: false }), { email: 'a@b.com', optOut: false }, meioDia), {
  send: false,
  reason: 'inativa',
});
check('email desativado na automação não envia', shouldSendEmail(parado, automation({ emailEnabled: false }), { email: 'a@b.com', optOut: false }, meioDia), {
  send: false,
  reason: 'email_desativado',
});
check('sem assunto não envia', shouldSendEmail(parado, automation({ emailSubject: '' }), { email: 'a@b.com', optOut: false }, meioDia), {
  send: false,
  reason: 'sem_assunto',
});
check(
  'opt-out de email não envia email',
  shouldSendEmail(parado, automation(), { email: 'a@b.com', optOut: true }, meioDia),
  { send: false, reason: 'opt_out' },
);
check('sem email não envia', shouldSendEmail(parado, automation(), { email: '', optOut: false }, meioDia), {
  send: false,
  reason: 'sem_email',
});
check(
  'fora do horário não envia (email)',
  shouldSendEmail(parado, automation(), { email: 'a@b.com', optOut: false }, new Date('2026-08-06T06:00:00Z')),
  { send: false, reason: 'fora_do_horario' },
);
check('5 dias parado em signed_up dispara (email)', shouldSendEmail(parado, automation(), { email: 'a@b.com', optOut: false }, meioDia), {
  send: true,
});
check(
  'opt-out de whatsapp não bloqueia email (canais independentes)',
  shouldSendEmail({ ...parado, whatsappOptOut: true }, automation(), { email: 'a@b.com', optOut: false }, meioDia),
  { send: true },
);
check(
  'opt-out de email não bloqueia whatsapp (canais independentes)',
  shouldSendWhatsApp({ ...parado, emailOptOut: true }, automation(), { whatsapp: '11999999999', consent: true }, meioDia),
  { send: true },
);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 4: Run the verify script**

Run: `npx tsx scripts/verify-crm-automation.mjs`
Expected: `Todas as verificações passaram.` and exit code 0. If any line says `FALHA`, read the label and fix `crmAutomationRules.ts` (not the script) unless the script itself has a typo'd expectation.

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: same pre-existing failures as Task 2 Step 6 (crmAdmin.ts, crmAutomation.ts, CustomerWhatsApp.tsx), but NO NEW failures from `crmAutomationRules.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add server/crmAutomationRules.ts server/crmAutomation.ts scripts/verify-crm-automation.mjs
git commit -m "feat(crm): add shouldSendEmail alongside renamed shouldSendWhatsApp"
```

---

### Task 4: `server/emailProvider.ts` — SMTP provider

**Files:**
- Create: `server/emailProvider.ts`

**Interfaces:**
- Consumes: `nodemailer` (Task 1), env vars `SMTP_*`/`EMAIL_*` (Task 1).
- Produces: `isConfigured(): ProviderStatus`, `sendMail(to, subject, html): Promise<{messageId: string; dryRun: boolean}>` — consumed by `server/crmAutomation.ts` (Task 5) and `server/crmAdmin.ts` (Task 6).

- [ ] **Step 1: Write `server/emailProvider.ts`**

```ts
// Provider de e-mail (SMTP genérico via nodemailer).
//
// Toda a conversa com o SMTP vive aqui, atrás de duas funções. O worker e as
// rotas não sabem qual provedor está por trás (Gmail Workspace, SES,
// SendGrid SMTP relay, Zoho...) — trocar depois é reescrever só este arquivo.
//
// Sem as env vars o provider reporta configured: false e nada mais acontece;
// o CRM inteiro (incluindo o canal de WhatsApp) continua funcionando sem
// e-mail configurado.

import nodemailer, { type Transporter } from 'nodemailer';

export interface ProviderStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}

export function isConfigured(): ProviderStatus {
  const missing: string[] = [];
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
  if (!process.env.SMTP_USER) missing.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS');
  if (!process.env.SMTP_FROM) missing.push('SMTP_FROM');
  return {
    configured: missing.length === 0,
    missing,
    dryRun: process.env.EMAIL_DRY_RUN === 'true',
    maxPerDay: Math.max(1, Number(process.env.EMAIL_MAX_PER_DAY ?? 100)),
  };
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<{ messageId: string; dryRun: boolean }> {
  const status = isConfigured();

  if (status.dryRun) {
    console.log(`[email] DRY RUN → to=${to} subject="${subject}"`);
    return { messageId: `dry-run-${Date.now()}`, dryRun: true };
  }

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });
  return { messageId: info.messageId, dryRun: false };
}
```

- [ ] **Step 2: Type-check just this file**

Run: `npx tsc --noEmit server/emailProvider.ts 2>&1 | grep emailProvider || echo "sem erros em emailProvider.ts"`
Expected: `sem erros em emailProvider.ts` (a full `npm run lint` run still shows the pre-existing unrelated failures from Tasks 5/6/9, which is fine at this point).

- [ ] **Step 3: Manual dry-run smoke check**

Run:
```bash
EMAIL_DRY_RUN=true SMTP_HOST=x SMTP_USER=x SMTP_PASS=x SMTP_FROM=x npx tsx -e "
import('./server/emailProvider.ts').then(async (m) => {
  console.log(m.isConfigured());
  console.log(await m.sendMail('cliente@example.com', 'Teste', '<p>Oi</p>'));
});
"
```
Expected: prints `{ configured: true, missing: [], dryRun: true, maxPerDay: 100 }` then a `[email] DRY RUN → ...` log line and `{ messageId: 'dry-run-...', dryRun: true }`.

- [ ] **Step 4: Commit**

```bash
git add server/emailProvider.ts
git commit -m "feat(server): add SMTP email provider (nodemailer)"
```

---

### Task 5: Extend `server/crmAutomation.ts` worker for the email channel

**Files:**
- Modify: `server/crmAutomation.ts` (full rewrite of `runAutomations`, plus a small helper)

**Interfaces:**
- Consumes: `shouldSendWhatsApp`, `shouldSendEmail`, `resolveParams`, `resolveToken` from `server/crmAutomationRules.ts` (Task 3); `sendTemplate`/`isConfigured as whatsappIsConfigured` from `server/whatsappProvider.ts`; `sendMail`/`isConfigured as emailIsConfigured` from `server/emailProvider.ts` (Task 4); `adminAuth` from `server/firebaseAdmin.ts`.
- Produces: `runAutomations(): Promise<RunResult>` — same exported name/shape as today (`RunResult` unchanged), consumed by `server/crmAdmin.ts`'s existing `POST /api/admin/automations/run` route (Task 6, no change needed there) and by the scheduler.

- [ ] **Step 1: Rewrite `server/crmAutomation.ts`**

```ts
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
```

Note: this changes `RunResult.reason` messages and the console log prefix from `[whatsapp]` to `[crm-automation]` for the scheduler-level lines (per-channel error logs keep `[whatsapp]`/`[email]`). That's intentional — the worker now covers two channels.

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: remaining failures should now only be in `server/crmAdmin.ts` and `src/modules/admin/CustomerWhatsApp.tsx` (fixed in Tasks 6 and 9).

- [ ] **Step 3: Commit**

```bash
git add server/crmAutomation.ts
git commit -m "feat(crm): dual-channel worker (WhatsApp + email) with independent locks"
```

---

### Task 6: `server/crmAdmin.ts` — validation, event label, and email routes

**Files:**
- Modify: `server/crmAdmin.ts:44-64` (`EVENT_LABELS`)
- Modify: `server/crmAdmin.ts:608-624` (`parseAutomationBody`)
- Modify: `server/crmAdmin.ts:723-777` (manual WhatsApp send route — fix `CrmMessage` field rename)
- Modify: `server/crmAdmin.ts:779-793` (opt-out route area — add a parallel email opt-out route)
- Modify: `server/crmAdmin.ts` top imports (add `emailProvider` import) and the WhatsApp status route area (add email status route)

**Interfaces:**
- Consumes: `emailProvider.isConfigured()` (Task 4), `CrmAutomation.emailEnabled/emailSubject/emailBody`, `CrmSummary.emailOptOut`, `CrmMessage.channel/template` (Task 2).
- Produces: `GET /api/admin/email/status`, `POST /api/admin/customers/:uid/email/optout` — consumed by `src/services/adminService.ts` (Task 7).

- [ ] **Step 1: Add the `emailProvider` import**

Find the existing import of `whatsappProvider` near the top of `server/crmAdmin.ts` (something like `import { isConfigured as whatsappIsConfigured, ... } from './whatsappProvider';` — check the exact existing alias pattern used for `isConfigured`/`sendTemplate`/`listTemplates` before editing, since Task 5 introduced `whatsappIsConfigured`/`emailIsConfigured` aliases in `crmAutomation.ts` but `crmAdmin.ts` may import differently). Add directly after it:
```ts
import { isConfigured as emailIsConfigured } from './emailProvider';
```

- [ ] **Step 2: Add `email_sent` to `EVENT_LABELS`**

Find:
```ts
  whatsapp_sent: 'Mensagem de WhatsApp enviada',
};
```
Replace with:
```ts
  whatsapp_sent: 'Mensagem de WhatsApp enviada',
  email_sent: 'E-mail enviado',
};
```

- [ ] **Step 3: Extend `parseAutomationBody` with the email fields**

Find:
```ts
  function parseAutomationBody(body: Record<string, unknown>, stage: CrmStage) {
    const trigger: AutomationTrigger = body.trigger === 'entered' ? 'entered' : 'stagnant';
    const active = body.active === true;
    const templateName = String(body.templateName ?? '').trim();
    if (active && !templateName) {
      throw Object.assign(new Error('Escolha um template para ativar a automação'), { status: 422 });
    }
    return {
      stage,
      active,
      trigger,
      delayHours: Math.max(0, Math.min(720, Number(body.delayHours ?? 0) || 0)),
      templateName,
      templateLanguage: String(body.templateLanguage ?? 'pt_BR').trim() || 'pt_BR',
      bodyParams: Array.isArray(body.bodyParams) ? body.bodyParams.map((p: unknown) => String(p)) : [],
    };
  }
```
Replace with:
```ts
  function parseAutomationBody(body: Record<string, unknown>, stage: CrmStage) {
    const trigger: AutomationTrigger = body.trigger === 'entered' ? 'entered' : 'stagnant';
    const active = body.active === true;
    const templateName = String(body.templateName ?? '').trim();
    const emailEnabled = body.emailEnabled === true;
    const emailSubject = String(body.emailSubject ?? '').trim();
    const emailBody = String(body.emailBody ?? '');
    // WhatsApp exige template só se a automação está ativa (comportamento
    // existente); e-mail exige assunto só se o canal de e-mail está ligado —
    // os dois podem ser independentes: uma automação pode estar ativa com só
    // WhatsApp, só e-mail, ou os dois.
    if (active && !templateName && !emailEnabled) {
      throw Object.assign(new Error('Ative pelo menos um canal (WhatsApp ou e-mail) para ativar a automação'), { status: 422 });
    }
    if (emailEnabled && !emailSubject) {
      throw Object.assign(new Error('Escolha um assunto para ativar o e-mail'), { status: 422 });
    }
    return {
      stage,
      active,
      trigger,
      delayHours: Math.max(0, Math.min(720, Number(body.delayHours ?? 0) || 0)),
      templateName,
      templateLanguage: String(body.templateLanguage ?? 'pt_BR').trim() || 'pt_BR',
      bodyParams: Array.isArray(body.bodyParams) ? body.bodyParams.map((p: unknown) => String(p)) : [],
      emailEnabled,
      emailSubject,
      emailBody,
    };
  }
```

Note this loosens the original guard (`active && !templateName` → throw) to allow an automation that's active with only email configured. This is a deliberate, spec-required behavior change, not a regression: today's guard assumed WhatsApp was the only channel.

- [ ] **Step 4: Fix `CrmMessage` field rename in the manual WhatsApp send route**

Find (two occurrences in the same route, success and failure branches):
```ts
        await messageRef.set({
          stage: 'manual', trigger: 'manual', automationId: null, templateName, to: whatsapp,
          status: 'sent', error: null, messageId: sent.messageId,
          sentAt: now.toISOString(), manual: true, dryRun: sent.dryRun,
        });
```
Replace with:
```ts
        await messageRef.set({
          stage: 'manual', trigger: 'manual', automationId: null, channel: 'whatsapp', template: templateName, to: whatsapp,
          status: 'sent', error: null, messageId: sent.messageId,
          sentAt: now.toISOString(), manual: true, dryRun: sent.dryRun,
        });
```
And:
```ts
        await messageRef.set({
          stage: 'manual', trigger: 'manual', automationId: null, templateName, to: whatsapp,
          status: 'failed', error: (err as Error).message.slice(0, 500), messageId: null,
          sentAt: now.toISOString(), manual: true, dryRun: false,
        });
```
Replace with:
```ts
        await messageRef.set({
          stage: 'manual', trigger: 'manual', automationId: null, channel: 'whatsapp', template: templateName, to: whatsapp,
          status: 'failed', error: (err as Error).message.slice(0, 500), messageId: null,
          sentAt: now.toISOString(), manual: true, dryRun: false,
        });
```

- [ ] **Step 5: Add the email status route**

Find the existing `GET /api/admin/whatsapp/status` route (around line 579) and add directly after its closing `});`:
```ts
  app.get('/api/admin/email/status', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json(emailIsConfigured());
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 6: Add the email opt-out route**

Find the existing WhatsApp opt-out route:
```ts
  app.post('/api/admin/customers/:uid/optout', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const optOut = req.body?.optOut === true;
      const ref = adminDb.collection('users').doc(uid);
      const crm = (await ref.get()).get('crm') as CrmSummary | undefined;
      if (!crm) throw Object.assign(new Error('Cliente ainda não reconciliado'), { status: 409 });
      await ref.set({ crm: { ...crm, whatsappOptOut: optOut } }, { merge: true });
      await auditLog(admin, uid, 'optout', optOut ? 'bloqueou WhatsApp' : 'liberou WhatsApp');
      res.json({ ok: true, optOut });
    } catch (err) {
      sendError(res, err);
    }
  });
```
Add directly after it:
```ts
  app.post('/api/admin/customers/:uid/email/optout', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const uid = req.params.uid;
      const optOut = req.body?.optOut === true;
      const ref = adminDb.collection('users').doc(uid);
      const crm = (await ref.get()).get('crm') as CrmSummary | undefined;
      if (!crm) throw Object.assign(new Error('Cliente ainda não reconciliado'), { status: 409 });
      await ref.set({ crm: { ...crm, emailOptOut: optOut } }, { merge: true });
      await auditLog(admin, uid, 'optout', optOut ? 'bloqueou e-mail' : 'liberou e-mail');
      res.json({ ok: true, optOut });
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: remaining failures only in `src/modules/admin/CustomerWhatsApp.tsx` (fixed in Task 9) and `src/services/adminService.ts`/`AutomationsView.tsx` if you haven't reached Tasks 7-8 yet.

- [ ] **Step 8: Commit**

```bash
git add server/crmAdmin.ts
git commit -m "feat(admin): validate email automation fields, add email status/optout routes"
```

---

### Task 7: `src/services/adminService.ts` — client calls for the email channel

**Files:**
- Modify: `src/services/adminService.ts` (imports block, add two exports near the existing WhatsApp ones)

**Interfaces:**
- Consumes: `GET /api/admin/email/status`, `POST /api/admin/customers/:uid/email/optout` (Task 6); `EmailStatus` type (Task 2).
- Produces: `getEmailStatus(): Promise<EmailStatus>`, `setEmailOptOut(uid, optOut): Promise<{ok: boolean; optOut: boolean}>` — consumed by `AutomationsView.tsx` (Task 8) and `CustomerWhatsApp.tsx` (Task 9).

- [ ] **Step 1: Add `EmailStatus` to the type import**

Find the `import type { ... } from '../types/crm'` block and add `EmailStatus` to it alongside `WhatsAppStatus`.

- [ ] **Step 2: Add the two new exports**

Find:
```ts
export const getWhatsAppStatus = () => call<WhatsAppStatus>('/api/admin/whatsapp/status');
```
Add directly after it:
```ts
export const getEmailStatus = () => call<EmailStatus>('/api/admin/email/status');
```

Find:
```ts
export const setOptOut = (uid: string, optOut: boolean) =>
  call<{ ok: boolean; optOut: boolean }>(`/api/admin/customers/${uid}/optout`, 'POST', { optOut });
```
(confirm the exact existing signature/formatting before editing — reproduce its style) and add directly after it:
```ts
export const setEmailOptOut = (uid: string, optOut: boolean) =>
  call<{ ok: boolean; optOut: boolean }>(`/api/admin/customers/${uid}/email/optout`, 'POST', { optOut });
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: remaining failures only in `AutomationsView.tsx` and `CustomerWhatsApp.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/services/adminService.ts
git commit -m "feat(admin): client calls for email status and opt-out"
```

---

### Task 8: `AutomationsView.tsx` — email fields in the automation editor

**Files:**
- Modify: `src/modules/admin/AutomationsView.tsx`

**Interfaces:**
- Consumes: `getEmailStatus()` (Task 7), `EmailStatus`/`TEMPLATE_TOKENS` types (Task 2, existing), `CrmAutomation.emailEnabled/emailSubject/emailBody` (Task 2).
- Produces: nothing consumed elsewhere — this is a leaf UI component.

- [ ] **Step 1: Load email status alongside WhatsApp status**

In the imports, add `getEmailStatus` to the `adminService` import and `type EmailStatus` to the `types/crm` import.

Find:
```ts
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
```
Add directly after it:
```ts
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
```

Find:
```ts
      const [s, a] = await Promise.all([getWhatsAppStatus(), listAutomations()]);
      setStatus(s);
      setAutomations(a.automations);
```
Replace with:
```ts
      const [s, es, a] = await Promise.all([getWhatsAppStatus(), getEmailStatus(), listAutomations()]);
      setStatus(s);
      setEmailStatus(es);
      setAutomations(a.automations);
```

- [ ] **Step 2: Add the email status banners**

Find the closing of the WhatsApp "not configured" banner block:
```ts
      {!status.configured && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <p className="font-bold">WhatsApp Oficial não configurado</p>
          <p className="mt-1">
            Defina no ambiente:{' '}
            {status.missing.map((m) => (
              <code key={m} className="mx-0.5 px-1 py-0.5 rounded bg-amber-100 text-xs">
                {m}
              </code>
            ))}
            . Você pode configurar as automações agora — elas só começam a disparar quando as
            credenciais existirem.
          </p>
        </div>
      )}

      {status.dryRun && (
        <div className="px-4 py-3 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-800">
          <strong>Modo simulação ligado</strong> (<code>WHATSAPP_DRY_RUN=true</code>). Os envios são
          registrados no histórico mas nenhuma mensagem sai de verdade. Use para validar a régua antes
          de apontar para clientes reais.
        </div>
      )}
```
Add directly after it (and update the `!status || !emailStatus` guard a few lines above — see Step 3):
```ts
      {emailStatus && !emailStatus.configured && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <p className="font-bold">E-mail (SMTP) não configurado</p>
          <p className="mt-1">
            Defina no ambiente:{' '}
            {emailStatus.missing.map((m) => (
              <code key={m} className="mx-0.5 px-1 py-0.5 rounded bg-amber-100 text-xs">
                {m}
              </code>
            ))}
            . Você pode configurar as automações agora — o e-mail só começa a disparar quando as
            credenciais SMTP existirem.
          </p>
        </div>
      )}

      {emailStatus?.dryRun && (
        <div className="px-4 py-3 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-800">
          <strong>Modo simulação de e-mail ligado</strong> (<code>EMAIL_DRY_RUN=true</code>). Os envios
          são registrados no histórico mas nenhum e-mail sai de verdade.
        </div>
      )}
```

- [ ] **Step 3: Update the loading/empty guard**

Find:
```ts
  if (loading) return <Spinner />;
  if (!automations || !status) return error ? <ErrorBanner message={error} /> : null;
```
Replace with:
```ts
  if (loading) return <Spinner />;
  if (!automations || !status || !emailStatus) return error ? <ErrorBanner message={error} /> : null;
```

- [ ] **Step 4: Pass `emailStatus` down and add the email section to `AutomationRow`**

Find:
```ts
        {CRM_STAGES.map((stage) => (
          <StageCard
            key={stage}
            stage={stage}
            automations={automations.filter((a) => a.stage === stage)}
            templates={templates}
            onAdd={() => addAutomation(stage)}
            onChange={(id, patch) => persist(id, patch)}
            onRemove={(id) => remove(id)}
          />
        ))}
```
This doesn't need `emailStatus` threaded through (the row doesn't need to know if SMTP is configured to let the admin edit the text — only the top-level banner communicates configuration status). No change needed here.

In `AutomationRow`, find the closing `</div>` of the template-preview block:
```ts
      {selected && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 whitespace-pre-wrap bg-slate-50 rounded-lg p-2.5">
            {selected.bodyText}
          </p>
          {expected > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: expected }, (_, i) => (
                <label key={i} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 shrink-0">{`{{${i + 1}}}`}</span>
                  <input
                    value={automation.bodyParams[i] ?? ''}
                    onChange={(e) => setParam(i, e.target.value)}
                    placeholder="Ex.: {{nome}}"
                    className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```
Replace with (adds the email section right after the WhatsApp preview block, still inside the outer automation card `<div>`):
```ts
      {selected && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 whitespace-pre-wrap bg-slate-50 rounded-lg p-2.5">
            {selected.bodyText}
          </p>
          {expected > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: expected }, (_, i) => (
                <label key={i} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 shrink-0">{`{{${i + 1}}}`}</span>
                  <input
                    value={automation.bodyParams[i] ?? ''}
                    onChange={(e) => setParam(i, e.target.value)}
                    placeholder="Ex.: {{nome}}"
                    className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={automation.emailEnabled}
            onChange={(e) => onChange({ emailEnabled: e.target.checked })}
            className="accent-violet-600 w-4 h-4 shrink-0"
          />
          <span className="text-sm text-slate-600">Também enviar e-mail</span>
        </label>

        {automation.emailEnabled && (
          <div className="mt-2 space-y-2">
            <input
              value={automation.emailSubject}
              onChange={(e) => onChange({ emailSubject: e.target.value })}
              placeholder="Assunto do e-mail"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm"
            />
            <textarea
              value={automation.emailBody}
              onChange={(e) => onChange({ emailBody: e.target.value })}
              placeholder="Corpo do e-mail (HTML). Use {{nome}}, {{empresa}} etc."
              rows={5}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: remaining failures only in `CustomerWhatsApp.tsx` (Task 9).

- [ ] **Step 6: Manual UI check**

Run `npm run dev`, log in as an admin, open `/admin` → Automações tab, expand a stage, add an automation, toggle "Também enviar e-mail" on, type a subject/body, save, reload the page, and confirm the values persisted.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/AutomationsView.tsx
git commit -m "feat(admin-ui): email subject/body editor per automation"
```

---

### Task 9: `CustomerWhatsApp.tsx` — email opt-out toggle + `CrmMessage` rename fix

**Files:**
- Modify: `src/modules/admin/CustomerWhatsApp.tsx`

**Interfaces:**
- Consumes: `setEmailOptOut` (Task 7), `CrmMessage.channel/template` (Task 2), `CrmSummary.emailOptOut` (Task 2, passed down from the parent customer-detail view — see Step 1).
- Produces: nothing consumed elsewhere — leaf UI component.

- [ ] **Step 1: Confirm the parent component's prop wiring**

Before editing, run:
```bash
grep -n "CustomerWhatsApp" src/modules/admin/*.tsx
```
This finds the parent (likely a `CustomerDetail.tsx` or similar) that renders `<CustomerWhatsApp uid=... whatsapp=... optOut=... .../>`. Read that call site to see what `CrmSummary`/`CustomerDetailPayload` data it already has in scope — `emailOptOut` should already be present on the payload once Task 2's `CrmSummary` extension is deployed (the field just wasn'т read yet). Add an `emailOptOut` prop and an `onEmailOptOutChange` callback there, mirroring however `optOut`/`onOptOutChange` are threaded today. Reproduce the exact existing pattern (state lives in the parent, or is it local to `CustomerWhatsApp`? — check `onOptOutChange` prop usage before deciding).

- [ ] **Step 2: Add the `emailOptOut`/`onEmailOptOutChange` props**

In `src/modules/admin/CustomerWhatsApp.tsx`, find the component's prop type (near the top, alongside `{ uid, whatsapp, optOut, consent, consentAt, onOptOutChange }`) and add:
```ts
  emailOptOut: boolean;
  onEmailOptOutChange: (optOut: boolean) => void;
```

- [ ] **Step 3: Add the `flipEmailOptOut` handler**

Find the existing `flipOptOut` handler (around lines 98-107) and reproduce its exact optimistic-update/revert-on-error shape, calling `setEmailOptOut` instead of `setOptOut` and `onEmailOptOutChange` instead of `onOptOutChange`. Example shape (adapt names to match what's actually there after reading it in Step 1):
```ts
  async function flipEmailOptOut() {
    const next = !emailOptOut;
    onEmailOptOutChange(next);
    try {
      await setEmailOptOut(uid, next);
    } catch (err) {
      onEmailOptOutChange(!next);
      setError((err as Error).message);
    }
  }
```

- [ ] **Step 4: Add the email opt-out toggle next to the WhatsApp one**

Find:
```tsx
<label className="flex items-center gap-2 cursor-pointer">
  <input type="checkbox" checked={optOut} onChange={flipOptOut} className="accent-rose-600 w-4 h-4" />
  <span className="text-sm text-slate-600">
    Não enviar automações
    <span className="block text-xs text-slate-400">Bloqueia toda a régua para este cliente</span>
  </span>
</label>
```
Replace with:
```tsx
<label className="flex items-center gap-2 cursor-pointer">
  <input type="checkbox" checked={optOut} onChange={flipOptOut} className="accent-rose-600 w-4 h-4" />
  <span className="text-sm text-slate-600">
    Não enviar WhatsApp
    <span className="block text-xs text-slate-400">Bloqueia a régua de WhatsApp para este cliente</span>
  </span>
</label>
<label className="flex items-center gap-2 cursor-pointer">
  <input type="checkbox" checked={emailOptOut} onChange={flipEmailOptOut} className="accent-rose-600 w-4 h-4" />
  <span className="text-sm text-slate-600">
    Não enviar e-mail
    <span className="block text-xs text-slate-400">Bloqueia a régua de e-mail para este cliente</span>
  </span>
</label>
```
(The original label text "Não enviar automações" is changed to "Não enviar WhatsApp" since it no longer blocks everything — this is a deliberate, spec-required copy change, not a typo.)

- [ ] **Step 5: Fix the `CrmMessage.templateName` render site**

Find:
```tsx
<span ...>{m.templateName}</span>
```
(read the surrounding `messages.map((m) => ...)` block first to get the exact JSX context) and replace `m.templateName` with `m.template`. While there, if the message list doesn't already distinguish channel visually, add a small badge so an admin can tell WhatsApp sends from email sends apart in the same history list:
```tsx
<span className="text-xs font-bold text-slate-400 mr-1">
  {m.channel === 'email' ? '✉️' : '💬'}
</span>
<span>{m.template}</span>
```

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: no errors anywhere (this was the last file with pending failures from Task 2's rename).

- [ ] **Step 7: Manual UI check**

Run `npm run dev`, open a customer detail page in `/admin`, confirm both opt-out toggles render, toggling "Não enviar e-mail" persists after reload, and the message history shows the channel badge.

- [ ] **Step 8: Commit**

```bash
git add src/modules/admin/CustomerWhatsApp.tsx src/modules/admin/*.tsx
git commit -m "feat(admin-ui): email opt-out toggle and channel badge in message history"
```

---

### Task 10: End-to-end manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full verify + lint pass**

Run:
```bash
npx tsx scripts/verify-crm-automation.mjs
npm run lint
```
Expected: both clean, zero failures.

- [ ] **Step 2: Dry-run end-to-end against the dev server**

In `.env`, set:
```
SMTP_HOST=smtp.example.com
SMTP_USER=test
SMTP_PASS=test
SMTP_FROM="Omni360 <no-reply@example.com>"
EMAIL_DRY_RUN=true
EMAIL_MAX_PER_DAY=100
```
Run `npm run dev`. In `/admin` → Automações, create an automation for a stage a test customer is currently in, with `trigger: entered`, `delayHours: 0`, `emailEnabled: true`, a subject and body using `{{nome}}`. Click "Rodar agora".

Expected: the run summary shows at least 1 sent; server console shows a `[email] DRY RUN → to=... subject="..."` line; a new Firestore doc appears at `users/{uid}/crm_messages/{automationId}_email` with `status: 'sent'`, `channel: 'email'`, `dryRun: true`; running "Rodar agora" again does NOT resend (doc already exists, `shouldSendEmail` isn't even reached because the lock isn't the gate here — the same automation now just returns `skipped` since the doc creation isn't re-attempted... actually it IS reached and re-evaluated as `send:true` each time since `shouldSendEmail` has no idempotency awareness; the `tryLock` `create()` is what fails on the second run). Confirm the second run's `skipped` count increases by 1 (or more, if other automations are configured) instead of `sent`.

- [ ] **Step 3: Confirm WhatsApp-only and email-only configurations both work standalone**

Temporarily unset `SMTP_HOST` (leave WhatsApp env vars, if any, as they are) and click "Rodar agora" again with a fresh test customer/automation. Expected: `reason` is empty (not "Nenhum canal configurado") if WhatsApp is configured, or the automation's WhatsApp side still evaluates independently of email being unset. If neither channel is configured, expected: `reason: 'Nenhum canal configurado (WhatsApp e e-mail)'`.

- [ ] **Step 4: Confirm opt-out independence**

Set `emailOptOut: true` for a test customer via the admin UI toggle (Task 9), leave `whatsappOptOut` false, run the automation again (with a fresh delay/trigger so it's due). Expected: WhatsApp still sends (if configured) or evaluates normally; email is skipped with reason `opt_out` (visible via server logs if you temporarily log `decision` in `crmAutomation.ts`, or infer from the `crm_messages` doc simply not being created for `_email`).

- [ ] **Step 5: Final commit (docs note, if anything was adjusted during manual QA)**

If Steps 1-4 required any code fixes, commit them individually with descriptive messages as you go (not batched here). If everything passed as designed, there's nothing to commit for this task — it's verification-only.

---

## Self-Review Notes (for whoever picks this up)

- **Spec coverage:** all 8 in-scope items from the spec's "Escopo" section map to a task — provider (Task 4), schema (Task 2), worker (Task 5), rules (Task 3), admin routes (Task 6), UI editor (Task 8), opt-out UI (Task 9), verify script (Task 3). Env vars (Task 1). Out-of-scope items (attachments, tracking, manual email send, WYSIWYG) are explicitly not tasked.
- **Known unknown flagged in Task 9, Step 1:** the exact prop-passing pattern between the customer detail parent and `CustomerWhatsApp.tsx` wasn't traced during planning (only the file's own internals were). The task tells the implementer to `grep` and read the parent before editing rather than guessing a shape that might not match.
- **`RunResult.reason` and log-prefix changes in Task 5** are a deliberate, small behavior change (message text only, not shape) — flagged inline in that task so it isn't mistaken for scope creep during review.
