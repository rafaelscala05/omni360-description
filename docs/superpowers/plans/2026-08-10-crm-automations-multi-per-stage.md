# CRM — múltiplas automações de WhatsApp por etapa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin configure N independent WhatsApp automations per Kanban stage (each with its own trigger/delay/template), instead of exactly one per stage.

**Architecture:** `crm_automations` moves from "id = stage" (5 fixed docs) to a normal collection with auto-generated ids and a `stage` field. The idempotency lock `users/{uid}/crm_messages/{stage}` moves to `users/{uid}/crm_messages/{automationId}`, so automations of the same stage never block each other. The pure decision function `shouldSend()` is untouched — it already operates on one `CrmAutomation` at a time; only its caller changes from "one automation per stage" to "loop over all automations matching this user's stage."

**Tech Stack:** TypeScript, Express, Firestore Admin SDK, React 19, no automated test framework — validated via `npm run lint`, `npx tsx scripts/verify-crm-automation.mjs`, and manual testing against the dev server (`npm run dev`).

## Global Constraints

- Portuguese (pt-BR) for all UI text, comments follow existing file style (see current files — sparse, explaining *why* not *what*).
- No automated test suite exists; `scripts/verify-crm-automation.mjs` is the only executable verification for the pure logic, run via `npx tsx scripts/verify-crm-automation.mjs`.
- `npm run lint` (tsc --noEmit) must stay clean after every task.
- No data migration: existing 5 docs at `crm_automations/{stage}` are abandoned in place (never read by new code), not deleted. Admin reconfigures manually in the new UI.
- Firestore rules already deny all client access to `crm_automations` and `crm_messages` at the collection level (`firestore.rules:154-156,177-179`) — no rule changes needed, the wildcard match covers any doc id.
- Every automation is evaluated fully independently: no priority/order/mutual exclusion between automations of the same stage.

---

### Task 1: `CrmAutomation` and `CrmMessage` types gain an automation id

**Files:**
- Modify: `src/types/crm.ts:212-288`

**Interfaces:**
- Produces: `CrmAutomation` now requires `id: string`. `defaultAutomation(stage)` returns `Omit<CrmAutomation, 'id'>` (a template for a not-yet-created automation, so it can't have an id yet). `CrmMessage` gains `automationId: string | null`.

- [ ] **Step 1: Update `CrmAutomation`, `CrmMessage`, and `defaultAutomation`**

Replace the block at `src/types/crm.ts:212-288`:

```ts
// --- Automação de WhatsApp (spec 2, revisado no spec 3) ---

// N automações por etapa do Kanban, cada uma com seu próprio gatilho, atraso
// e template — não um motor de regras genérico com prioridade/branching entre
// elas. `id` é a chave do documento (auto-gerado); `stage` é só um campo de
// filtro, não mais a chave.
export type AutomationTrigger = 'entered' | 'stagnant';

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  entered: 'Ao entrar na etapa',
  stagnant: 'Ao travar na etapa',
};

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

export interface WhatsAppTemplateInfo {
  name: string;
  language: string;
  status: string;
  category: string;
  bodyParamCount: number;
  bodyText: string;
}

export interface WhatsAppStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}

// Tokens que a automação resolve por cliente no momento do envio. Qualquer outro
// texto vai literal para o parâmetro do template.
export const TEMPLATE_TOKENS = [
  { token: '{{nome}}', description: 'Primeiro nome do cliente' },
  { token: '{{empresa}}', description: 'Nome fantasia ou razão social' },
  { token: '{{creditos}}', description: 'Saldo de créditos atual' },
  { token: '{{etapa}}', description: 'Nome da etapa atual' },
  { token: '{{dias}}', description: 'Dias parado na etapa' },
] as const;

// Valor inicial de um formulário de automação nova — ainda sem id, porque o id
// só existe depois de criada no Firestore.
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

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: FAILS — every consumer of `CrmAutomation`/`defaultAutomation`/`CrmMessage` (server/crmAutomation.ts, server/crmAutomationRules.ts is unaffected, server/crmAdmin.ts, src/modules/admin/AutomationsView.tsx, src/services/adminService.ts, scripts/verify-crm-automation.mjs is JS so tsc won't check it) now has type errors — this is expected, they get fixed in the following tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/crm.ts
git commit -m "feat(crm): CrmAutomation gets its own id, decoupled from stage"
```

---

### Task 2: Worker evaluates all automations of a user's stage, locks per automation

**Files:**
- Modify: `server/crmAutomation.ts` (whole file)

**Interfaces:**
- Consumes: `CrmAutomation` (with `id`) from Task 1; `shouldSend(summary, automation, contact, now)` from `server/crmAutomationRules.ts` (unchanged signature).
- Produces: `loadAutomations(): Promise<CrmAutomation[]>` (was `Record<string, CrmAutomation>`). `runAutomations(): Promise<RunResult>` (signature unchanged). Removes `AUTOMATION_REF` (no longer meaningful — no automation is keyed by stage) and `stageFromId` moves to Task 4 usage inline since it has no Firestore dependency.

- [ ] **Step 1: Rewrite `server/crmAutomation.ts`**

```ts
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
import { resolveParams, shouldSend, type TokenContext } from './crmAutomationRules';
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

        const decision = shouldSend(crm, automation, { whatsapp, consent }, now);
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
```

Note: `CRM_STAGES` import is kept because `stageFromId` still uses it.

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: `server/crmAutomation.ts` now clean. Errors remain in `server/crmAdmin.ts`, `src/modules/admin/AutomationsView.tsx`, `src/services/adminService.ts` — expected, fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add server/crmAutomation.ts
git commit -m "feat(crm): worker evaluates and locks automations independently, not by stage"
```

---

### Task 3: Admin API — CRUD by automation id instead of PUT-by-stage

**Files:**
- Modify: `server/crmAdmin.ts:1-28` (imports), `server/crmAdmin.ts:597-647` (the two automation routes)

**Interfaces:**
- Consumes: `loadAutomations(): Promise<CrmAutomation[]>`, `runAutomations`, `stageFromId` from Task 2's `server/crmAutomation.ts`.
- Produces: `GET /api/admin/automations` → `{ automations: CrmAutomation[] }` (now the raw list, no per-stage fill-in). `POST /api/admin/automations` → `{ ok: true; automation: CrmAutomation }`. `PUT /api/admin/automations/:id` → same shape. `DELETE /api/admin/automations/:id` → `{ ok: true }`.

- [ ] **Step 1: Update the import block**

In `server/crmAdmin.ts:9`, replace:

```ts
import { AUTOMATION_REF, loadAutomations, runAutomations, stageFromId } from './crmAutomation';
```

with:

```ts
import { loadAutomations, runAutomations, stageFromId } from './crmAutomation';
```

- [ ] **Step 2: Replace the two automation routes**

Replace the block at `server/crmAdmin.ts:597-647` (from the `// Sempre devolve as 5 etapas...` comment through the closing `});` of the PUT route) with:

```ts
  // Todas as automações, de todas as etapas — a UI agrupa por coluna do
  // Kanban no client.
  app.get('/api/admin/automations', async (req, res) => {
    try {
      await requireAdmin(req);
      res.json({ automations: await loadAutomations() });
    } catch (err) {
      sendError(res, err);
    }
  });

  function parseAutomationBody(body: Record<string, unknown>, stage: CrmStage) {
    const trigger = body.trigger === 'entered' ? 'entered' : 'stagnant';
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

  // Cria uma automação nova para a etapa informada no corpo. Não há mais
  // limite de uma por etapa — id é auto-gerado.
  app.post('/api/admin/automations', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const body = req.body ?? {};
      const stage = stageFromId(String(body.stage ?? ''));
      if (!stage) throw Object.assign(new Error('Etapa inválida'), { status: 422 });

      const fields = parseAutomationBody(body, stage);
      const ref = adminDb.collection('crm_automations').doc();
      const automation: CrmAutomation = {
        id: ref.id,
        ...fields,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.uid,
      };
      await ref.set(automation);
      await auditLog(
        admin,
        'automation',
        'automacao',
        `${STAGE_LABELS[stage]}: criada${automation.active ? ` (ativa, ${automation.templateName}, ${automation.trigger})` : ''}`,
      );
      res.json({ ok: true, automation });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/admin/automations/:id', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const id = req.params.id;
      const ref = adminDb.collection('crm_automations').doc(id);
      const existing = await ref.get();
      if (!existing.exists) throw Object.assign(new Error('Automação não encontrada'), { status: 404 });

      const body = req.body ?? {};
      const currentStage = (existing.data() as CrmAutomation).stage;
      const stage = stageFromId(String(body.stage ?? currentStage)) ?? currentStage;
      const fields = parseAutomationBody(body, stage);

      const automation: CrmAutomation = {
        id,
        ...fields,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.uid,
      };
      await ref.set(automation);
      await auditLog(
        admin,
        'automation',
        'automacao',
        `${STAGE_LABELS[stage]}: ${automation.active ? `ativa (${automation.templateName}, ${automation.trigger})` : 'desativada'}`,
      );
      res.json({ ok: true, automation });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/admin/automations/:id', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      const id = req.params.id;
      const ref = adminDb.collection('crm_automations').doc(id);
      const existing = await ref.get();
      if (!existing.exists) throw Object.assign(new Error('Automação não encontrada'), { status: 404 });
      const stage = (existing.data() as CrmAutomation).stage;
      await ref.delete();
      await auditLog(admin, 'automation', 'automacao', `${STAGE_LABELS[stage]}: removida`);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
```

- [ ] **Step 3: Drop the now-unused `defaultAutomation` import if flagged**

`server/crmAdmin.ts:17` still imports `defaultAutomation` from `../src/types/crm`. It's no longer used in this file (the fill-in-defaults logic is gone). Remove it from the import list at `server/crmAdmin.ts:13-28`:

```ts
import {
  CRM_STAGES,
  PIPELINE_STATUSES,
  STAGE_LABELS,
  type AdminStats,
  type CrmAutomation,
  type CrmMessage,
  type CrmStage,
  type CrmSummary,
  type CrmTask,
  type CustomerDetailPayload,
  type CustomerListItem,
  type PipelineStatus,
  type TimelineEntry,
} from '../src/types/crm';
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: `server/crmAdmin.ts` clean (check `CRM_STAGES` is still used elsewhere in the file — it is, in `/api/admin/stats`). Remaining errors only in `src/modules/admin/AutomationsView.tsx` and `src/services/adminService.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/crmAdmin.ts
git commit -m "feat(crm): automation routes become CRUD by id instead of PUT-by-stage"
```

---

### Task 4: Client service — create/update/delete instead of save-by-stage

**Files:**
- Modify: `src/services/adminService.ts:123-126`

**Interfaces:**
- Consumes: `CrmAutomation` (with `id`) from Task 1, routes from Task 3.
- Produces: `createAutomation(stage, automation): Promise<{ok, automation}>`, `updateAutomation(id, automation): Promise<{ok, automation}>`, `deleteAutomation(id): Promise<{ok}>`. Removes `saveAutomation`.

- [ ] **Step 1: Replace `saveAutomation`**

Replace `src/services/adminService.ts:125-126`:

```ts
export const saveAutomation = (stage: CrmStage, automation: Partial<CrmAutomation>) =>
  call<{ ok: boolean; automation: CrmAutomation }>(`/api/admin/automations/${stage}`, 'PUT', automation);
```

with:

```ts
export const createAutomation = (stage: CrmStage, automation: Partial<CrmAutomation>) =>
  call<{ ok: boolean; automation: CrmAutomation }>('/api/admin/automations', 'POST', { ...automation, stage });

export const updateAutomation = (id: string, automation: Partial<CrmAutomation>) =>
  call<{ ok: boolean; automation: CrmAutomation }>(`/api/admin/automations/${id}`, 'PUT', automation);

export const deleteAutomation = (id: string) =>
  call<{ ok: boolean }>(`/api/admin/automations/${id}`, 'DELETE');
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: `src/services/adminService.ts` clean. `CrmStage` import at the top (`src/services/adminService.ts:13`) is still used by `createAutomation` and `setPipeline`. Remaining errors only in `src/modules/admin/AutomationsView.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/services/adminService.ts
git commit -m "feat(crm): client automation API becomes create/update/delete by id"
```

---

### Task 5: Automations UI — a list of automations per stage Card

**Files:**
- Modify: `src/modules/admin/AutomationsView.tsx` (whole file)

**Interfaces:**
- Consumes: `CrmAutomation` (with `id`) from Task 1; `createAutomation`, `updateAutomation`, `deleteAutomation`, `listAutomations`, `getWhatsAppStatus`, `listTemplates`, `runAutomations` from Task 4.
- Produces: no exports consumed elsewhere — this is a leaf view component registered by the admin shell (unchanged registration, same default export).

- [ ] **Step 1: Rewrite `src/modules/admin/AutomationsView.tsx`**

```tsx
// Automações de WhatsApp: um Card por coluna do Kanban, cada um com sua
// própria lista de automações (spec 3). Continua espelhando o board — "o que
// mando quando o cliente chega/trava nesta etapa" — mas agora cada etapa pode
// ter N réguas independentes (ex.: "1h depois" e "10h depois"), não mais só
// uma.

import { useCallback, useEffect, useState } from 'react';
import {
  CRM_STAGES,
  STAGE_LABELS,
  STAGNATION_DAYS,
  TEMPLATE_TOKENS,
  TRIGGER_LABELS,
  defaultAutomation,
  type AutomationTrigger,
  type CrmAutomation,
  type CrmStage,
  type WhatsAppStatus,
  type WhatsAppTemplateInfo,
} from '../../types/crm';
import {
  createAutomation,
  deleteAutomation,
  getWhatsAppStatus,
  listAutomations,
  listTemplates,
  runAutomations,
  updateAutomation,
} from '../../services/adminService';
import { Card, ErrorBanner, Spinner } from './ui';

export default function AutomationsView() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplateInfo[]>([]);
  const [templatesError, setTemplatesError] = useState('');
  const [automations, setAutomations] = useState<CrmAutomation[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, a] = await Promise.all([getWhatsAppStatus(), listAutomations()]);
      setStatus(s);
      setAutomations(a.automations);

      // Templates só existem se o provider estiver configurado; a falha aqui não
      // pode impedir de ver/editar o resto da tela.
      if (s.configured) {
        try {
          setTemplates((await listTemplates()).templates);
          setTemplatesError('');
        } catch (err) {
          setTemplatesError((err as Error).message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addAutomation(stage: CrmStage) {
    if (!automations) return;
    setError('');
    try {
      const { automation } = await createAutomation(stage, defaultAutomation(stage));
      setAutomations([...automations, automation]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function persist(id: string, patch: Partial<CrmAutomation>) {
    if (!automations) return;
    const previous = automations;
    const next = automations.map((a) => (a.id === id ? { ...a, ...patch } : a));
    setAutomations(next);
    setError('');
    try {
      const target = next.find((a) => a.id === id)!;
      await updateAutomation(id, target);
    } catch (err) {
      setAutomations(previous);
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!automations) return;
    const previous = automations;
    setAutomations(automations.filter((a) => a.id !== id));
    setError('');
    try {
      await deleteAutomation(id);
    } catch (err) {
      setAutomations(previous);
      setError((err as Error).message);
    }
  }

  async function run() {
    setRunning(true);
    setRunResult('');
    try {
      const r = await runAutomations();
      setRunResult(
        r.reason
          ? r.reason
          : `${r.evaluated} clientes avaliados · ${r.sent} enviados · ${r.failed} falhas · ${r.skipped} pulados${r.dryRun ? ' (simulação)' : ''}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <Spinner />;
  if (!automations || !status) return error ? <ErrorBanner message={error} /> : null;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

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

      {templatesError && (
        <ErrorBanner message={`Não foi possível carregar os templates da Meta: ${templatesError}`} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">
          Cada coluna pode ter várias automações independentes. O envio respeita opt-out, horário
          comercial (9h–20h) e nunca repete a mesma automação para o mesmo cliente.
        </p>
        <button
          onClick={run}
          disabled={running}
          className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {running ? 'Rodando…' : 'Rodar agora'}
        </button>
      </div>

      {runResult && (
        <div className="px-4 py-2.5 rounded-lg bg-slate-100 text-sm text-slate-700">{runResult}</div>
      )}

      <div className="space-y-3">
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
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Variáveis disponíveis</h2>
        <p className="mt-1 text-xs text-slate-500">
          Use nos parâmetros do template. Qualquer outro texto é enviado literal.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {TEMPLATE_TOKENS.map((t) => (
            <li key={t.token} className="flex items-baseline gap-2">
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-xs font-bold text-violet-700">
                {t.token}
              </code>
              <span className="text-xs text-slate-500">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function StageCard({
  stage,
  automations,
  templates,
  onAdd,
  onChange,
  onRemove,
}: {
  stage: CrmStage;
  automations: CrmAutomation[];
  templates: WhatsAppTemplateInfo[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<CrmAutomation>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-slate-800">{STAGE_LABELS[stage]}</h3>
        <button
          onClick={onAdd}
          className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          + Adicionar automação
        </button>
      </div>

      {automations.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Nenhuma automação configurada nesta etapa.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              stage={stage}
              automation={automation}
              templates={templates}
              onChange={(patch) => onChange(automation.id, patch)}
              onRemove={() => onRemove(automation.id)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function AutomationRow({
  stage,
  automation,
  templates,
  onChange,
  onRemove,
}: {
  stage: CrmStage;
  automation: CrmAutomation;
  templates: WhatsAppTemplateInfo[];
  onChange: (patch: Partial<CrmAutomation>) => void;
  onRemove: () => void;
}) {
  const selected = templates.find((t) => t.name === automation.templateName);
  const expected = selected?.bodyParamCount ?? automation.bodyParams.length;

  function setParam(i: number, value: string) {
    const next = [...automation.bodyParams];
    while (next.length < expected) next.push('');
    next[i] = value;
    onChange({ bodyParams: next.slice(0, expected) });
  }

  return (
    <div className={`p-3 rounded-lg border ${automation.active ? 'border-violet-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer w-full sm:w-32 shrink-0">
          <input
            type="checkbox"
            checked={automation.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            className="accent-violet-600 w-4 h-4 shrink-0"
          />
          <span className="text-sm text-slate-600">Ativa</span>
        </label>

        <select
          value={automation.trigger}
          onChange={(e) => onChange({ trigger: e.target.value as AutomationTrigger })}
          className="w-44 shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {(['entered', 'stagnant'] as AutomationTrigger[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-slate-500 shrink-0">
          após
          <input
            type="number"
            min={0}
            max={720}
            value={automation.delayHours}
            onChange={(e) => onChange({ delayHours: Number(e.target.value) || 0 })}
            className="w-20 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          h
        </label>

        <select
          value={automation.templateName}
          onChange={(e) => {
            const t = templates.find((x) => x.name === e.target.value);
            onChange({
              templateName: e.target.value,
              templateLanguage: t?.language ?? automation.templateLanguage,
              bodyParams: Array(t?.bodyParamCount ?? 0).fill(''),
            });
          }}
          className="flex-1 min-w-48 px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">
            {templates.length === 0 ? 'Nenhum template disponível' : 'Escolha um template…'}
          </option>
          {templates.map((t) => (
            <option key={`${t.name}-${t.language}`} value={t.name}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>

        <button
          onClick={onRemove}
          className="shrink-0 px-2.5 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          Remover
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {automation.trigger === 'stagnant'
          ? Number.isFinite(STAGNATION_DAYS[stage])
            ? `Dispara quando o cliente passa de ${STAGNATION_DAYS[stage]} dias nesta etapa.`
            : 'Esta etapa é final — não existe “travado” aqui, então este gatilho nunca dispara. Use “ao entrar”.'
          : 'Dispara assim que o cliente chega nesta etapa.'}
        {automation.delayHours > 0 && ` Espera mais ${automation.delayHours}h antes de enviar.`}
      </p>

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

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS with no errors anywhere in the project.

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/AutomationsView.tsx
git commit -m "feat(crm): automations UI supports N automations per Kanban stage"
```

---

### Task 6: Update the pure-logic verification script for multiple automations per stage

**Files:**
- Modify: `scripts/verify-crm-automation.mjs`

**Interfaces:**
- Consumes: `shouldSend` from `server/crmAutomationRules.ts` (unchanged — this task only touches test fixtures/cases, not the rules file).

- [ ] **Step 1: Give the `automation()` fixture an id and add a two-automations-same-stage case**

In `scripts/verify-crm-automation.mjs`, update the `automation` helper at line 24 to include `id`:

```js
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
```

Then, right after the existing "Gatilho 'entered' com atraso" block (after the `'sem atraso dispara na hora'` check, before the `// --- Tokens ---` section), add:

```js
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
```

(`entrouHa5h` entered at `2026-08-06T10:00:00Z`, and `meioDia` is `2026-08-06T15:00:00Z` — 5 hours later, so the 1h-delay automation has passed its threshold and the 10h-delay one hasn't.)

- [ ] **Step 2: Run the script**

Run: `npx tsx scripts/verify-crm-automation.mjs`
Expected: `Todas as verificações passaram.` with exit code 0, including the two new checks.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-crm-automation.mjs
git commit -m "test(crm): verify two automations on the same stage fire independently"
```

---

### Task 7: Manual end-to-end validation

**Files:** none (validation only)

- [ ] **Step 1: Full type-check**

Run: `npm run lint`
Expected: clean, zero errors.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: server starts on port 3000 without errors.

- [ ] **Step 3: Manual check in `/admin` → Automações**

1. Open `/admin`, go to the Automações tab.
2. On the "Cadastrou" (signed_up) column, click "+ Adicionar automação" twice.
3. Configure the first as `entered` trigger, 1h delay, pick any approved template (or note "nenhum template disponível" if WhatsApp isn't configured in this environment — still verify the row renders and the delay/trigger fields persist via a page reload).
4. Configure the second as `entered` trigger, 10h delay.
5. Confirm both rows persist independently after a page reload (`listAutomations` returns both, grouped correctly under "Cadastrou").
6. Remove one of the two and confirm the other still exists after reload.
7. Add an automation to a different stage (e.g., "Subiu Produtos") and confirm it doesn't show up under "Cadastrou".

Expected: all of the above works without console errors; no stage is ever limited to one automation.

- [ ] **Step 4: If `WHATSAPP_DRY_RUN=true` and Meta credentials are set in `.env`**

1. Set `WHATSAPP_DRY_RUN=true`, restart `npm run dev`.
2. Configure two active automations on the same stage as a real test user's current stage (different `delayHours`, one already past its threshold).
3. Click "Rodar agora".
4. In Firestore, confirm `users/{uid}/crm_messages/` now has one doc per triggered automation, keyed by `automationId` (not by stage), each with `status: 'sent'` and `dryRun: true`.
5. Click "Rodar agora" again — confirm the counts show these as skipped the second time (idempotency held per automation).
