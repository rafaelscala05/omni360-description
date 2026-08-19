# CRM: automação de e-mail em paralelo ao WhatsApp

Data: 2026-08-19

## Contexto

O CRM admin (`/admin`) já dispara WhatsApp automaticamente por etapa do
Kanban via `server/crmAutomation.ts` (worker), `server/crmAutomationRules.ts`
(regras puras) e `server/whatsappProvider.ts` (isolamento da Meta Cloud API).
Cada etapa pode ter N automações independentes (`crm_automations/{id}`),
cada uma com seu próprio gatilho (`entered` | `stagnant`), atraso e template.

Este trabalho adiciona um segundo canal — e-mail via SMTP — ao **mesmo**
registro de automação, para "acompanhar o envio" de WhatsApp. Não existe
nenhuma infraestrutura de e-mail no repositório hoje (confirmado por busca
por `nodemailer|smtp|sendmail`); a única coisa próxima é
`sendPasswordResetEmail` do Firebase Auth no client, que não tem relação com
isto.

## Decisões (das perguntas ao usuário)

1. **Um registro, dois canais.** `CrmAutomation` ganha campos de e-mail ao
   lado dos já existentes de WhatsApp. Mesmo `trigger`/`delayHours` para os
   dois canais.
2. **Editor de template no admin**, sem aprovação externa (SMTP não tem a
   restrição de templates pré-aprovados que a Meta exige). Assunto + corpo
   HTML editáveis diretamente na tela de automações, com os mesmos tokens
   `{{nome}}`, `{{empresa}}`, `{{creditos}}`, `{{etapa}}`, `{{dias}}`.
3. **SMTP genérico via env vars** — funciona com qualquer provedor
   (Gmail Workspace, SES, SendGrid SMTP relay, Zoho etc.), decidido depois
   no `.env`.
4. **E-mail vem da conta Firebase Auth** (`adminAuth.getUser(uid).email`),
   não de um campo de onboarding — sempre existe, sempre é o e-mail de
   login.
5. **Lock de idempotência independente por canal** —
   `users/{uid}/crm_messages/{automationId}_whatsapp` e `..._email`, cada
   um travado via `create()` separadamente. Falha num canal não bloqueia
   nem re-trava o outro.
6. **Opt-out separado** — novo campo `emailOptOut` em `CrmSummary`,
   independente de `whatsappOptOut`.

## Escopo

Dentro do escopo:
- Novo provider SMTP (`server/emailProvider.ts`) usando `nodemailer`.
- Extensão de `CrmAutomation`, `CrmSummary`, `CrmMessage` em
  `src/types/crm.ts`.
- Extensão do worker (`server/crmAutomation.ts`) e das regras puras
  (`server/crmAutomationRules.ts`) para avaliar e disparar o canal de
  e-mail em paralelo ao de WhatsApp.
- Extensão das rotas de admin (`server/crmAdmin.ts`) para validar e
  persistir os campos de e-mail.
- Extensão da UI (`src/modules/admin/AutomationsView.tsx`) com o editor de
  assunto/corpo por automação.
- Toggle de opt-out de e-mail por cliente (mesma tela que já tem o de
  WhatsApp, `CustomerWhatsApp.tsx` ou equivalente).
- Extensão de `scripts/verify-crm-automation.mjs` cobrindo as novas regras
  puras.
- Novas env vars documentadas em `.env.example`.

Fora do escopo:
- Anexos, tracking de abertura/clique, templates transacionais para outros
  fluxos (recibo, boas-vindas) — só a régua de CRM por etapa.
- Editor WYSIWYG — o corpo é um textarea de HTML simples.
- Envio manual avulso de e-mail (o WhatsApp tem isso em
  `CustomerWhatsApp.tsx`/`POST /api/admin/customers/:uid/whatsapp`); pode
  vir depois, não é pedido agora.

## Arquitetura

### 1. `server/emailProvider.ts` (novo)

Espelha `server/whatsappProvider.ts`: toda a conversa com o SMTP fica atrás
de duas funções, para trocar de provedor depois sem tocar no worker.

```ts
export interface ProviderStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}

export function isConfigured(): ProviderStatus
// Checa SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
// dryRun de EMAIL_DRY_RUN, maxPerDay de EMAIL_MAX_PER_DAY (default 100).

export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<{ messageId: string; dryRun: boolean }>
// Cria o transporte nodemailer (lazy, reaproveitado entre chamadas),
// envia; dry-run loga no console e retorna sem chamar o SMTP real.
```

Sem as env vars, `isConfigured().configured === false` e o canal de e-mail
simplesmente não dispara — igual ao comportamento do WhatsApp hoje. O
transporte nodemailer usa `SMTP_SECURE` para decidir TLS implícito
(porta 465) vs STARTTLS.

### 2. Novas env vars (`.env.example`)

```
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Omni360 <no-reply@seudominio.com>"
EMAIL_DRY_RUN=false
EMAIL_MAX_PER_DAY=100
```

### 3. `src/types/crm.ts` — schema

```ts
export interface CrmAutomation {
  // ...campos existentes de WhatsApp, inalterados...
  emailEnabled: boolean;
  emailSubject: string;
  emailBody: string; // HTML com os mesmos tokens de TEMPLATE_TOKENS
}
```

`defaultAutomation()` ganha `emailEnabled: false, emailSubject: '', emailBody: ''`.

```ts
export interface CrmSummary {
  // ...
  whatsappOptOut?: boolean;
  emailOptOut?: boolean; // novo, mesmo padrão (falso por omissão)
}
```

`CrmMessage` ganha um campo `channel: 'whatsapp' | 'email'` (obrigatório
daqui pra frente; docs antigos não têm o campo e continuam lidos como
`'whatsapp'` implícito onde necessário, já que o histórico deles não muda
de forma). O campo `templateName` deixa de fazer sentido para e-mail —
para e-mail, o histórico grava `emailSubject` no lugar. Como os dois
canais têm shape ligeiramente diferente, `CrmMessage` vira:

```ts
export interface CrmMessage {
  id: string;
  automationId: string | null;
  channel: 'whatsapp' | 'email';
  stage: CrmStage | 'manual';
  trigger: AutomationTrigger | 'manual';
  template: string; // templateName (whatsapp) ou emailSubject (email)
  to: string;
  status: 'sent' | 'failed';
  error: string | null;
  messageId: string | null;
  sentAt: string;
  manual: boolean;
  dryRun: boolean;
}
```

Isso renomeia `templateName` → `template` em `CrmMessage` (não em
`CrmAutomation`, que continua com `templateName` específico do WhatsApp).
Único ponto de leitura desse shape hoje é a timeline do cliente no admin —
ajustar a chamada de exibição junto.

### 4. `server/crmAutomationRules.ts` — regra pura, extendida

Fatorar a lógica de gatilho/horário/atraso — hoje só dentro de
`shouldSend` — em um helper compartilhado, para não duplicá-la:

```ts
function isTriggerDue(summary: CrmSummary, automation: CrmAutomation, now: Date): boolean {
  if (!isWithinSendWindow(now)) return false;
  const hoursInStage = (now.getTime() - new Date(summary.stageEnteredAt).getTime()) / 3600000;
  if (automation.trigger === 'entered') return hoursInStage >= automation.delayHours;
  return isStagnant(summary, now) && hoursInStage >= automation.delayHours;
}
```

`shouldSend` (WhatsApp) é renomeado para `shouldSendWhatsApp` e passa a
usar `isTriggerDue` internamente — mesmo comportamento observável, só
reduz duplicação. Novo `shouldSendEmail`:

```ts
export interface EmailContactInfo {
  email: string;
  optOut: boolean;
}

export type EmailSkipReason =
  | 'sem_automacao' | 'inativa' | 'email_desativado' | 'sem_assunto'
  | 'opt_out' | 'sem_email' | 'fora_do_horario' | 'gatilho_nao_atingido';

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
```

Note que e-mail **não** depende de `consent` (esse campo é específico da
política da Meta para WhatsApp) — só do opt-out próprio.

`resolveToken`/`resolveParams` são reaproveitados como estão para resolver
o assunto e o corpo do e-mail (mesmos tokens, texto livre em vez de
parâmetro posicional — chamamos `resolveToken(automation.emailSubject, ctx)`
e `resolveToken(automation.emailBody, ctx)` diretamente, sem a
peculiaridade do `'—'` para vazio dos parâmetros do WhatsApp... mas como
`resolveToken` já faz isso genericamente e um assunto/corpo vazio não
combina com token vazio isolado, mantemos o mesmo `resolveToken` sem
alteração — na prática o corpo de e-mail raramente é *só* um token).

`Decision`/`SkipReason` do WhatsApp continuam como estão; `EmailSkipReason`
é seu próprio tipo porque os motivos não são idênticos (`sem_consentimento`
não existe para e-mail; `email_desativado`/`sem_assunto` não existem para
WhatsApp).

### 5. `server/crmAutomation.ts` — worker, extendido

Mudança principal: hoje o worker inteiro sai cedo se o WhatsApp não está
configurado (`if (!status.configured) return`). Isso precisa virar
"cada canal roda se estiver configurado", não "tudo ou nada":

```ts
export async function runAutomations(): Promise<RunResult> {
  const waStatus = whatsapp.isConfigured();
  const emailStatus = email.isConfigured();
  const empty: RunResult = { evaluated: 0, sent: 0, failed: 0, skipped: 0, dryRun: waStatus.dryRun || emailStatus.dryRun };

  if (!waStatus.configured && !emailStatus.configured) {
    return { ...empty, reason: 'Nenhum canal configurado (WhatsApp e e-mail)' };
  }

  const automations = await loadAutomations();
  const active = automations.filter(
    (a) => a.active && (a.templateName || (a.emailEnabled && a.emailSubject)),
  );
  if (active.length === 0) return { ...empty, reason: 'Nenhuma automação ativa' };

  // ...agrupamento por etapa igual a hoje...

  for (const doc of usersSnap.docs) {
    // teto de envio combinado nos dois canais, como hoje (result.sent >= maxPerDay)
    // usa o menor dos dois maxPerDay configurados, para não estourar o mais restrito
    ...
    for (const automation of automationsForStage) {
      // canal WhatsApp — só se waStatus.configured
      if (waStatus.configured) {
        const decision = shouldSendWhatsApp(crm, automation, { whatsapp, consent }, now);
        if (decision.send) {
          const ref = doc.ref.collection('crm_messages').doc(`${automation.id}_whatsapp`);
          // create() + sendTemplate() + update(), como hoje
        } else result.skipped += 1;
      }

      // canal e-mail — só se emailStatus.configured
      if (emailStatus.configured) {
        const decision = shouldSendEmail(crm, automation, { email, optOut: crm.emailOptOut === true }, now);
        if (decision.send) {
          const ref = doc.ref.collection('crm_messages').doc(`${automation.id}_email`);
          // create() + sendMail() + update(), mesmo padrão de try/catch
        } else result.skipped += 1;
      }
    }
  }
}
```

Pontos que se repetem do padrão de WhatsApp, canal a canal:
- `create()` no doc de lock antes de enviar — mesma trava de concorrência.
- Falha mantém o doc de idempotência com `status: 'failed'` (sem retry
  automático a cada 30min).
- Try/catch por cliente não muda — um cliente ruim não derruba o lote.
- `email` do cliente vem de `adminAuth.getUser(doc.id).email` — chamada
  ao Admin Auth por usuário avaliado (só quando há automação de e-mail
  ativa para a etapa dele, para não gastar uma chamada de Auth por
  cliente sem necessidade).
- `recordEvent(uid, 'email_sent', {...})` no sucesso, espelhando
  `whatsapp_sent`. Eventos emitidos pelo servidor (via `recordEvent`) não
  passam pela allowlist `CLIENT_EVENT_NAMES` — essa lista só filtra o
  beacon do client (`server/crmEvents.ts:79`). O único lugar a atualizar é
  o mapa de rótulos amigáveis da timeline em `server/crmAdmin.ts:63`
  (`EVENT_LABELS` ou nome equivalente), acrescentando
  `email_sent: 'E-mail enviado'` ao lado de
  `whatsapp_sent: 'Mensagem de WhatsApp enviada'`.

`RunResult` continua com contadores agregados (`sent`/`failed`/`skipped`
somam os dois canais) — a UI já mostra só uma linha de resumo, não precisa
de split por canal.

### 6. `server/crmAdmin.ts` — validação e rotas

`parseAutomationBody` ganha os três campos novos, sem exigir e-mail para
ativar a automação (só exige e-mail se `emailEnabled === true`):

```ts
const emailEnabled = body.emailEnabled === true;
const emailSubject = String(body.emailSubject ?? '').trim();
if (emailEnabled && !emailSubject) {
  throw Object.assign(new Error('Escolha um assunto para ativar o e-mail'), { status: 422 });
}
```

Novas rotas espelhando as existentes (`GET /api/admin/whatsapp/status`,
`GET /api/admin/whatsapp/templates` não se aplica a e-mail — não há
templates para listar):
- `GET /api/admin/email/status` → `email.isConfigured()`.

### 7. `src/modules/admin/AutomationsView.tsx` — UI

`AutomationRow` ganha uma segunda seção, abaixo da de WhatsApp, com o
mesmo padrão visual (borda, ativa/inativa):

- Toggle `emailEnabled` (mesmo estilo do checkbox "Ativa" do WhatsApp).
- Input de assunto (`emailSubject`).
- Textarea de corpo HTML (`emailBody`), com o legend de
  `TEMPLATE_TOKENS` reaproveitado (não precisa duplicar a lista de tokens
  no rodapé da página — os tokens já são os mesmos para os dois canais).

A tela carrega `getEmailStatus()` em paralelo a `getWhatsAppStatus()` e
mostra o mesmo banner de "não configurado" / "modo simulação" para o
canal de e-mail, na mesma estrutura condicional já existente para
WhatsApp.

Opt-out de e-mail: adicionar um segundo toggle ao lado do de WhatsApp em
`CustomerWhatsApp.tsx` (ou renomear a seção para cobrir os dois canais,
decisão de implementação, sem mudar o endpoint de WhatsApp existente) —
`POST /api/admin/customers/:uid/email-optout` espelhando o de WhatsApp.

### 8. Verificação

`scripts/verify-crm-automation.mjs` ganha casos para `shouldSendEmail`:
cada `EmailSkipReason` individualmente, `entered` vs `stagnant` via
`isTriggerDue` compartilhado, opt-out de e-mail não afetado por
`whatsappOptOut` e vice-versa, e-mail vazio, `emailEnabled: false`.

## Testando

Sem suite automatizada de testes de integração no projeto (por
`CLAUDE.md`); a verificação real é:
1. `npx tsx scripts/verify-crm-automation.mjs` — cobre a lógica pura dos
   dois canais.
2. `npm run lint` — type-check.
3. Manual: `EMAIL_DRY_RUN=true` + credenciais SMTP de teste (ou só as
   env vars presentes com um host qualquer, já que dry-run não conecta),
   criar uma automação com e-mail ativo e rodar "Rodar agora" no admin,
   conferir o log de dry-run e o doc `crm_messages/{id}_email` criado com
   `status: 'sent', dryRun: true`.
4. Manual com SMTP real (conta de teste) para confirmar que o e-mail
   chega, o assunto/corpo resolvem os tokens, e o opt-out realmente
   impede o envio.

## Riscos e decisões em aberto para a implementação

- **Corpo do e-mail como HTML livre** abre superfície para o admin colar
  HTML malformado; não é um risco de segurança (só admins autenticados
  escrevem isso, é conteúdo próprio da empresa para os próprios clientes),
  mas vale um preview simples (`dangerouslySetInnerHTML` num painel de
  preview) se o tempo permitir — não bloqueante para o MVP.
