# Onboarding por Missão — Conteúdo, WhatsApp, ERP e Trilha (Plano 2 de 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar a jornada de missão: Missão Conteúdo ponta a ponta (blog nativo em preview `noindex`), pedido de WhatsApp com bônus durante a espera, caso "conta com catálogo" + publicação no Tiny na Missão Produto, e a trilha de missões para quem volta.

**Architecture:** Toda decisão de fluxo continua em módulos puros verificáveis (`missionSteps.ts`, e agora `conteudoFluxo.ts`, `trilha.ts`, `whatsapp.ts`, `server/onboardingMissionRules.ts`). A Missão Conteúdo é **retomável**: cada sub-passo grava em `state.dados` o id do que criou, e `proximaAcaoConteudo` decide o próximo passo a partir do que existe — recarregar a página no meio da produção continua de onde parou. O listener do artigo (`listenCalendar`) é a fonte da verdade do pipeline, não a resposta HTTP.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Firebase (client + Admin SDK no servidor), Express.

**Spec:** `docs/superpowers/specs/2026-09-09-onboarding-missao-design.md` (inclui a seção "Decisões do Plano 2").
**Plano anterior:** `docs/superpowers/plans/2026-09-10-onboarding-missao-fundacao.md` — as tarefas abaixo consomem os tipos e componentes de lá.

## Global Constraints

- **Sem framework de teste.** Lógica pura ganha `scripts/verify-*.mjs` (rodado com `npx tsx`, helper `check()` local). Componentes React ganham `npm run lint` + validação manual. Não introduza vitest/jest.
- **Type-check:** o `main` tem 3 erros pré-existentes (`App.tsx` "createdAt", `App.tsx` e `ProductEditModal.tsx` "text_ai"). Critério de cada tarefa: `npm run lint` **sem erro novo** além desses três.
- **Idioma pt-BR** em UI, nomes e comentários. Cores/tipografia do `DESIGN.md`: laranja `#FF5B03` é a única cor de ação; ink `#141311`; `font-display` nos títulos.
- **Créditos** (valores do seed de produção, `seed-credit-config.cjs`): clusters 2 + pesquisa de palavra-chave 1 (incondicional) + artigo 5 + capa 1 = **9** no caminho enxuto. O calendário (2) **não** é gerado — o artigo é criado com `createArticleManual`, que não cobra.
- **Bônus:** `ONBOARDING_BONUS` (30) de `src/types/onboarding.ts`, concedido **só no servidor** (o cliente não pode aumentar `credits` — ver `creditsNotIncreased()` em `firestore.rules`).
- **Consentimento de WhatsApp:** gravado com o texto exato `WHATSAPP_CONSENT_TEXT` e a data, em `users/{uid}.onboarding.contact` — é de lá que `server/crmAutomation.ts:103-104` lê `whatsapp` e `whatsappConsent`.
- **Nada do fluxo legado é removido.** Contas sem `cohort: 'missao-v1'` não veem nenhuma mudança.
- **Publicar no ERP dentro da missão: só Tiny.** Produtos de Bling/IdWorks salvam no catálogo e seguem pela tela de Integrações.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/onboarding/mission/whatsapp.ts` | Puro: normalizar, validar e formatar número BR. Usado por cliente e servidor. |
| `server/onboardingMissionRules.ts` | Puro: valida o pedido e monta o `OnboardingContact` da missão. |
| `src/modules/onboarding/mission/PedidoWhatsApp.tsx` | Cartão do pedido de WhatsApp, compartilhado pelas duas missões. |
| `src/modules/onboarding/mission/conteudoFluxo.ts` | Puro: `proximaAcaoConteudo`, rótulos de estágio, candidatos de slug. |
| `src/modules/onboarding/mission/MissaoConteudo.tsx` | A Missão Conteúdo. |
| `src/modules/onboarding/mission/trilha.ts` | Puro: monta os itens da trilha a partir do estado da conta. |
| `src/modules/onboarding/mission/TrilhaMissoes.tsx` | A view da trilha. |
| `scripts/verify-blog-indexable.mjs`, `scripts/verify-mission-contact.mjs`, `scripts/verify-conteudo-fluxo.mjs`, `scripts/verify-trilha.mjs` | Verificações puras. |

**Modificar:** `src/modules/content/blog/types.ts`, `server/blog/shell.ts`, `server/blogPublic.ts`, `server/crmStage.ts`, `scripts/verify-crm-stage.mjs`, `server/onboardingAgent.ts`, `src/services/onboardingService.ts`, `src/modules/onboarding/mission/missionSteps.ts`, `scripts/verify-mission-steps.mjs`, `src/modules/onboarding/mission/MissaoProduto.tsx`, `src/App.tsx`.

---

## Task 1: Blog indexável — `noindex` até publicar

Mudança de servidor isolada e sem efeito em blogs existentes: o campo novo é **ausente = indexável**.

**Files:**
- Modify: `src/modules/content/blog/types.ts` (interface `BlogSettings`, por volta da linha 172)
- Modify: `server/blog/shell.ts:114-138` (`renderDocument`)
- Modify: `server/blogPublic.ts` (blocos de `/sitemap.xml` e `/feed.xml`, por volta da linha 236)
- Create: `scripts/verify-blog-indexable.mjs`

**Interfaces:**
- Produces: `BlogSettings.indexable?: boolean`; `isBlogIndexable(s: Pick<BlogSettings, 'indexable'>): boolean`.

- [ ] **Step 1: Escrever o verify que falha**

Crie `scripts/verify-blog-indexable.mjs`:

```js
// Verificação do noindex do blog nativo. Não sobe servidor nem toca Firestore.
// Rodar com: npx tsx scripts/verify-blog-indexable.mjs
import { isBlogIndexable, DEFAULT_BLOG_COLORS } from '../src/modules/content/blog/types.ts';
import { renderDocument } from '../server/blog/shell.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// O default é o que protege os blogs que já estão no ar: sem o campo, indexa.
check('sem o campo → indexável (blogs existentes)', isBlogIndexable({}), true);
check('indexable: true → indexável', isBlogIndexable({ indexable: true }), true);
check('indexable: false → não indexável', isBlogIndexable({ indexable: false }), false);

const base = {
  enabled: true, slug: 'casa', title: 'Casa', description: '', template: 'editorial',
  colors: DEFAULT_BLOG_COLORS, customDomains: [], createdAt: '', updatedAt: '',
};
const head = { title: 'Casa', description: '', canonicalPath: '/', jsonLd: {} };
const render = (settings) => renderDocument(
  { settings, categories: [], baseUrl: '/b/casa', canonicalBase: 'https://app.test' },
  head, { css: '', body: '' },
);
const ROBOTS = '<meta name="robots" content="noindex,nofollow">';
check('preview (indexable: false) sai com noindex', render({ ...base, indexable: false }).includes(ROBOTS), true);
check('blog publicado não sai com noindex', render({ ...base, indexable: true }).includes(ROBOTS), false);
check('blog antigo (sem o campo) não sai com noindex', render(base).includes(ROBOTS), false);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx scripts/verify-blog-indexable.mjs`
Expected: FALHA — `isBlogIndexable` não é exportado (`SyntaxError`/`is not a function`).

- [ ] **Step 3: Implementar**

Em `src/modules/content/blog/types.ts`, dentro de `interface BlogSettings`, depois de `enabled: boolean;`:

```ts
  // Ausente = indexável. A Missão Conteúdo cria o blog com false (preview que
  // o dono abre, mas o Google não indexa) e "Publicar o blog" grava true.
  // O default é o que mantém os blogs que já estão no ar exatamente como estão.
  indexable?: boolean;
```

E, no fim do arquivo:

```ts
export function isBlogIndexable(s: Pick<BlogSettings, 'indexable'>): boolean {
  return s.indexable !== false;
}
```

Em `server/blog/shell.ts`, importe `isBlogIndexable` junto do import de tipos do blog e, dentro de `renderDocument`, logo depois da linha do `viewport`:

```ts
${isBlogIndexable(s) ? '' : '<meta name="robots" content="noindex,nofollow">'}
```

Em `server/blogPublic.ts`, importe `isBlogIndexable` de `../src/modules/content/blog/types` e, **antes** do `if (path === '/sitemap.xml')`:

```ts
  // Blog em preview (Missão Conteúdo, antes de "Publicar"): sem sitemap nem
  // feed — não há o que anunciar ao Google enquanto o dono não publicar.
  if ((path === '/sitemap.xml' || path === '/feed.xml') && !isBlogIndexable(t.settings)) {
    return send('Não encontrado', 'text/plain', 404);
  }
```

`send(body, contentType, status)` é o helper local declarado em `server/blogPublic.ts:216` — o mesmo que o sitemap e o feed usam logo abaixo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsx scripts/verify-blog-indexable.mjs` → Expected: `Tudo ok.`
Run: `npm run lint` → Expected: nenhum erro novo.

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/blog/types.ts server/blog/shell.ts server/blogPublic.ts scripts/verify-blog-indexable.mjs
git commit -m "feat(blog): noindex até o dono publicar, sem afetar blogs existentes"
```

---

## Task 2: Missão concluída comprova o marco de conteúdo no CRM

**Files:**
- Modify: `server/crmStage.ts` (`EVENT_MILESTONE`, por volta da linha 16)
- Modify: `scripts/verify-crm-stage.mjs`

**Interfaces:**
- Consumes: o evento `mission_completed` (já na allowlist desde o Plano 1).

- [ ] **Step 1: Escrever a verificação que falha**

Em `scripts/verify-crm-stage.mjs`, adicione `EVENT_MILESTONE` ao import de `../server/crmStage.ts` e, antes do resumo final:

```js
// Missão concluída = conteúdo gerado (a missão sempre gera descrição ou artigo).
check('mission_completed comprova o marco de conteúdo', EVENT_MILESTONE.mission_completed, 'content_generated');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx scripts/verify-crm-stage.mjs` → Expected: `FALHA  mission_completed…  → esperado "content_generated", veio undefined`.

- [ ] **Step 3: Implementar**

Em `server/crmStage.ts`, dentro de `EVENT_MILESTONE`, depois de `attributes_generated`:

```ts
  mission_completed: 'content_generated',
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsx scripts/verify-crm-stage.mjs` → Expected: `Todas as verificações passaram.`

- [ ] **Step 5: Commit**

```bash
git add server/crmStage.ts scripts/verify-crm-stage.mjs
git commit -m "feat(crm): missão concluída comprova o marco de conteúdo gerado"
```

---

## Task 3: Contato da missão com bônus — servidor

O pedido de WhatsApp grava o contato **no mesmo lugar** que o wizard legado (`onboarding.contact`), marca `onboarding.completed: true` e concede `ONBOARDING_BONUS` numa transação. Marcar `completed` é o que impede bônus duplo: `/api/onboarding/complete` devolve `alreadyCompleted` e não paga de novo.

**Files:**
- Create: `src/modules/onboarding/mission/whatsapp.ts`
- Create: `server/onboardingMissionRules.ts`
- Create: `scripts/verify-mission-contact.mjs`
- Modify: `server/onboardingAgent.ts` (nova rota + extração do pagamento de indicação)
- Modify: `src/services/onboardingService.ts`

**Interfaces:**
- Produces: `normalizarWhatsapp(raw): string`, `whatsappValido(digitos): boolean`, `formatarWhatsapp(digitos): string`; `validarPedidoContato(body): { ok: true; digitos: string } | { ok: false; erro: string }`; `montarContatoMissao(digitos, conta, agoraIso): OnboardingContact`; rota `POST /api/onboarding/mission-contact` → `{ alreadyCompleted: boolean; creditsAdded: number }`; cliente `enviarContatoMissao(whatsapp: string)`.

- [ ] **Step 1: Escrever o verify que falha**

Crie `scripts/verify-mission-contact.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx scripts/verify-mission-contact.mjs` → Expected: `ERR_MODULE_NOT_FOUND` (whatsapp.ts).

- [ ] **Step 3: Implementar os módulos puros**

Crie `src/modules/onboarding/mission/whatsapp.ts`:

```ts
// Número de WhatsApp brasileiro: normalização, validação e o formato mascarado
// que o wizard legado grava — a automação do CRM lê o mesmo campo, então os
// dois caminhos precisam produzir a mesma forma. Puro: usado no cliente e no
// servidor.

export function normalizarWhatsapp(raw: string): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}

/** DDD + número: 10 dígitos (fixo) ou 11 (celular). */
export function whatsappValido(digitos: string): boolean {
  return /^\d{10,11}$/.test(digitos);
}

export function formatarWhatsapp(digitos: string): string {
  const d = digitos.slice(0, 11);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
```

Crie `server/onboardingMissionRules.ts`:

```ts
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
```

- [ ] **Step 4: Rodar o verify e confirmar que passa**

Run: `npx tsx scripts/verify-mission-contact.mjs` → Expected: `Tudo ok.`

- [ ] **Step 5: A rota, com o pagamento de indicação compartilhado**

Em `server/onboardingAgent.ts`, o bloco "Referral milestone" de `/api/onboarding/complete` (o `if (shouldPayReferrer && referredBy) { … }`) passa a ser uma função no escopo do módulo, para as duas rotas pagarem a indicação do mesmo jeito. Acima de `registerOnboardingRoutes`:

```ts
// Paga ao indicador o bônus de "amigo completou onboarding", uma vez só.
// Compartilhado pelo onboarding legado e pelo contato da missão.
function pagarIndicacao(
  tx: FirebaseFirestore.Transaction,
  referredBy: string,
  referralRef: FirebaseFirestore.DocumentReference,
  now: FirebaseFirestore.FieldValue,
): void {
  const referrerRef = adminDb.collection('users').doc(referredBy);
  tx.update(referrerRef, { credits: FieldValue.increment(REFERRAL_ONBOARDING_BONUS) });
  tx.set(referrerRef.collection('credit_logs').doc(), {
    type: 'bonus',
    actionType: 'Indicação — amigo completou onboarding',
    actionKey: 'referral_onboarding_bonus',
    productName: 'N/A',
    sku: 'N/A',
    userName: '',
    creditsConsumed: 0,
    creditsAdded: REFERRAL_ONBOARDING_BONUS,
    timestamp: new Date().toISOString(),
  });
  tx.update(referralRef, { status: 'onboarding_completed', onboardingCreditsGranted: true, onboardingGrantedAt: now });
}
```

Na rota legada, troque o corpo do `if (shouldPayReferrer && referredBy) { … }` por `pagarIndicacao(tx, referredBy, referralRef, now);` — **sem mudar mais nada** nela.

Adicione o import no topo: `import { montarContatoMissao, validarPedidoContato } from './onboardingMissionRules';`

E a rota nova, depois de `/api/onboarding/complete`:

```ts
  // Contato pedido durante a missão (coorte missao-v1). Grava onde o wizard
  // legado grava (onboarding.contact — é de lá que a automação de WhatsApp lê)
  // e marca onboarding.completed, o que impede o bônus de ser pago duas vezes
  // se a pessoa abrir o wizard antigo depois.
  app.post('/api/onboarding/mission-contact', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const pedido = validarPedidoContato(req.body);
      if (!pedido.ok) throw Object.assign(new Error(pedido.erro), { status: 422 });

      const userRef = adminDb.collection('users').doc(decoded.uid);
      const referralRef = adminDb.collection('referrals').doc(decoded.uid);
      const contact = montarContatoMissao(pedido.digitos, { email: decoded.email, name: decoded.name }, new Date().toISOString());

      const result = await adminDb.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });
        if (userSnap.data()?.onboarding?.completed === true) return { alreadyCompleted: true, creditsAdded: 0 };

        const referredBy = userSnap.data()?.referredBy as string | undefined;
        const referralSnap = referredBy ? await tx.get(referralRef) : null;
        const shouldPayReferrer =
          !!referredBy && !!referralSnap?.exists && referralSnap.data()?.onboardingCreditsGranted !== true;

        const now = FieldValue.serverTimestamp();
        tx.update(userRef, {
          onboarding: { completed: true, completedAt: now, source: 'missao', contact },
          credits: FieldValue.increment(ONBOARDING_BONUS),
        });
        tx.set(userRef.collection('credit_logs').doc(), {
          type: 'bonus',
          actionType: 'Bônus de Onboarding',
          actionKey: 'onboarding_bonus',
          productName: 'N/A',
          sku: 'N/A',
          userName: decoded.name ?? decoded.email ?? '',
          creditsConsumed: 0,
          creditsAdded: ONBOARDING_BONUS,
          timestamp: new Date().toISOString(),
        });
        if (shouldPayReferrer && referredBy) pagarIndicacao(tx, referredBy, referralRef, now);
        return { alreadyCompleted: false, creditsAdded: ONBOARDING_BONUS };
      });

      if (!result.alreadyCompleted) void recordEvent(decoded.uid, 'onboarding_completed', { source: 'missao' });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });
```

Em `src/services/onboardingService.ts`:

```ts
export const enviarContatoMissao = (whatsapp: string) =>
  callJson<{ alreadyCompleted: boolean; creditsAdded: number }>('/api/onboarding/mission-contact', 'POST', { whatsapp });
```

- [ ] **Step 6: Verificar**

Run: `npx tsx scripts/verify-mission-contact.mjs` → `Tudo ok.`
Run: `npm run lint` → nenhum erro novo.

- [ ] **Step 7: Commit**

```bash
git add src/modules/onboarding/mission/whatsapp.ts server/onboardingMissionRules.ts scripts/verify-mission-contact.mjs server/onboardingAgent.ts src/services/onboardingService.ts
git commit -m "feat(onboarding): contato da missão com bônus de onboarding, uma vez só"
```

---

## Task 4: Pedido de WhatsApp na espera

**Files:**
- Create: `src/modules/onboarding/mission/PedidoWhatsApp.tsx`

**Interfaces:**
- Consumes: `normalizarWhatsapp`, `whatsappValido`, `formatarWhatsapp` (Task 3); `WHATSAPP_CONSENT_TEXT`, `ONBOARDING_BONUS`.
- Produces: `PedidoWhatsApp` com props `{ onEnviar: (whatsapp: string) => Promise<void> }`.

- [ ] **Step 1: Implementar**

Crie `src/modules/onboarding/mission/PedidoWhatsApp.tsx`:

```tsx
// Pedido de WhatsApp durante a espera: o número é pedido como serviço ("te
// aviso quando ficar pronto"), com o bônus de onboarding como contrapartida.
// Compartilhado pelas duas missões; aparece dentro do palco.

import React, { useState } from 'react';
import { formatarWhatsapp, normalizarWhatsapp, whatsappValido } from './whatsapp';
import { ONBOARDING_BONUS, WHATSAPP_CONSENT_TEXT } from '../../../types/onboarding';

interface Props {
  onEnviar: (whatsapp: string) => Promise<void>;
}

const PedidoWhatsApp: React.FC<Props> = ({ onEnviar }) => {
  const [valor, setValor] = useState('');
  const [estado, setEstado] = useState<'aberto' | 'enviando' | 'feito' | 'recusado'>('aberto');
  const [erro, setErro] = useState<string | null>(null);
  const digitos = normalizarWhatsapp(valor);

  if (estado === 'recusado') return null;
  if (estado === 'feito') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <b>Anotado.</b> Te chamo quando ficar pronto — e os {ONBOARDING_BONUS} créditos já estão na sua conta.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 border-l-[3px] border-l-[#FF5B03] bg-white p-3">
      <p className="text-xs leading-relaxed">
        Isso leva uns minutos. Te chamo no WhatsApp quando ficar pronto? Você ganha <b>{ONBOARDING_BONUS} créditos</b>.
      </p>
      <input
        id="missao-whatsapp"
        type="tel"
        inputMode="tel"
        value={valor}
        onChange={(e) => setValor(formatarWhatsapp(normalizarWhatsapp(e.target.value)))}
        placeholder="(11) 98765-4321"
        className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 font-mono text-xs"
      />
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!whatsappValido(digitos) || estado === 'enviando'}
          onClick={async () => {
            setErro(null);
            setEstado('enviando');
            try {
              await onEnviar(valor);
              setEstado('feito');
            } catch (e) {
              setErro(e instanceof Error ? e.message : 'Não consegui salvar agora.');
              setEstado('aberto');
            }
          }}
          className="flex-1 min-h-[44px] rounded-xl bg-[#FF5B03] px-3 text-xs font-semibold text-white disabled:opacity-40"
        >
          {estado === 'enviando' ? 'Salvando…' : 'Pode me chamar'}
        </button>
        <button
          type="button"
          onClick={() => setEstado('recusado')}
          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600"
        >
          Espero aqui
        </button>
      </div>
      <p className="text-[10px] leading-snug text-slate-400">{WHATSAPP_CONSENT_TEXT}</p>
    </div>
  );
};

export default PedidoWhatsApp;
```

- [ ] **Step 2: Verificar** — `npm run lint` → nenhum erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/modules/onboarding/mission/PedidoWhatsApp.tsx
git commit -m "feat(onboarding): pedido de WhatsApp com bônus durante a espera"
```

---

## Task 5: Missão Produto — caso com catálogo, publicar no Tiny, e o pedido de WhatsApp

**Files:**
- Modify: `src/modules/onboarding/mission/missionSteps.ts`
- Modify: `scripts/verify-mission-steps.mjs`
- Modify: `src/modules/onboarding/mission/MissaoProduto.tsx`
- Modify: `src/App.tsx` (extrair `tinyPushPayloadOf` de `buildTinyPushPayload`, por volta da linha 1811)

**Interfaces:**
- Produces: `produtosSemDescricao<T>(produtos: T[], limite?: number): T[]`; em `MissaoProduto`, as props novas `onPublicarNoTiny: (id: string) => Promise<void>`, `mostrarPedidoWhatsapp: boolean`, `onEnviarWhatsapp: (w: string) => Promise<void>`.

- [ ] **Step 1: Escrever a verificação que falha**

Em `scripts/verify-mission-steps.mjs`, adicione `produtosSemDescricao` ao import e, antes do resumo:

```js
const cat = [
  { _id: 'a', 'Descrição complementar': 'tem' },
  { _id: 'b' },
  { _id: 'c', 'Descrição complementar': '' },
  { _id: 'd' },
];
check('só produtos sem descrição, na ordem', produtosSemDescricao(cat).map((p) => p._id), ['b', 'c', 'd']);
check('respeita o limite', produtosSemDescricao(cat, 2).map((p) => p._id), ['b', 'c']);
check('catálogo todo descrito', produtosSemDescricao([{ _id: 'a', 'Descrição complementar': 'x' }]), []);
```

Run: `npx tsx scripts/verify-mission-steps.mjs` → Expected: FALHA (`produtosSemDescricao` não exportado).

- [ ] **Step 2: Implementar a função pura**

Em `src/modules/onboarding/mission/missionSteps.ts`, no fim:

```ts
/** Caso "conta com catálogo": os primeiros produtos que ainda não têm descrição. */
export function produtosSemDescricao<T extends { 'Descrição complementar'?: unknown }>(produtos: T[], limite = 5): T[] {
  return produtos.filter((p) => !String(p['Descrição complementar'] ?? '').trim()).slice(0, limite);
}
```

Run: `npx tsx scripts/verify-mission-steps.mjs` → `Tudo ok.`

- [ ] **Step 3: Extrair o payload de um produto no App**

Em `src/App.tsx`, `buildTinyPushPayload` mapeia os produtos selecionados com um objeto literal. Extraia o objeto para uma função, sem mudar os campos (a invariante do push está no CLAUDE.md — o payload só carrega título, descrição, SEO e imagens):

```ts
  const tinyPushPayloadOf = (p: Product): TinyPushProduct => ({
    tinyId: p._tinyProductId!,
    sku: p['Código (SKU)'],
    nome: p['Descrição'],
    descricaoHtml: p['Descrição complementar'],
    seoTitle: p['Título SEO'],
    seoDescription: p['Descrição SEO'],
    seoKeywords: p['Palavras chave SEO'],
    imagens: collectTinyImages(p),
  });

  const buildTinyPushPayload = async (): Promise<TinyPushProduct[]> =>
    tinySelectedProducts(productsRef.current).map(tinyPushPayloadOf);

  // Publica um único produto no Tiny (Missão Produto). O push nunca cria
  // produto — só atualiza um que já veio do Tiny, então exige _tinyProductId.
  const publicarProdutoNoTiny = async (id: string): Promise<void> => {
    const p = productsRef.current.find((x) => x._id === id);
    if (!p?._tinyProductId) throw new Error('Esse produto não veio do Tiny.');
    const { resultados } = await tinyPush([tinyPushPayloadOf(p)]);
    const r = resultados[0];
    if (!r?.ok) {
      const motivo = Object.values(r?.steps ?? {}).find((v) => v && v !== 'ok' && v !== 'sem alteração');
      throw new Error(motivo ?? 'O Tiny recusou o envio.');
    }
  };
```

(`collectTinyImages` é declarada antes, em `src/App.tsx:1792`; `tinyPush` já é importado.)

- [ ] **Step 4: Missão Produto — catálogo, Tiny e WhatsApp**

Em `src/modules/onboarding/mission/MissaoProduto.tsx`:

1. Imports: `produtosSemDescricao` de `./missionSteps`; `PedidoWhatsApp` de `./PedidoWhatsApp`.
2. Props novas:

```ts
  /** publicarProdutoNoTiny do App — só chamado quando o produto tem _tinyProductId */
  onPublicarNoTiny: (id: string) => Promise<void>;
  /** true quando a conta ainda não deixou contato (onboarding não concluído) */
  mostrarPedidoWhatsapp: boolean;
  onEnviarWhatsapp: (whatsapp: string) => Promise<void>;
```

3. Estado inicial da fase: quem tem produtos sem descrição começa escolhendo do catálogo.

```ts
  const candidatos = useMemo(() => produtosSemDescricao(produtos), [produtos]);
  const [fase, setFase] = useState<'catalogo' | 'link' | 'revisao'>(() =>
    produtosSemDescricao(produtos).length > 0 ? 'catalogo' : 'link');
  // Capturado na montagem: depois do envio o App passa false, mas o cartão
  // precisa continuar na tela para mostrar o "Anotado".
  const [pedirWhatsapp] = useState(mostrarPedidoWhatsapp);
```

4. Novo bloco de render, antes do bloco `fase === 'link'`:

```tsx
  if (state.step === 'contexto' && fase === 'catalogo') {
    turnos.push({
      autor: 'agente',
      texto: `Você tem ${produtos.length} produtos, ${produtosSemDescricao(produtos, Infinity).length} sem descrição nenhuma. Escolhe um pra começar:`,
    });
    turnos.push({
      autor: 'agente',
      texto: (
        <div className="flex flex-col gap-1.5">
          {candidatos.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => avancarPasso({ produtoId: p._id, origem: 'catalogo', descricaoOriginal: '' })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:border-[#FF5B03]"
            >
              {String(p['Descrição'] ?? p['Código (SKU)'] ?? 'Produto sem nome')}
            </button>
          ))}
        </div>
      ),
    });
    acoes.push({ rotulo: 'Colar um link em vez disso', variante: 'secundaria', onClick: () => setFase('link') });
  }
```

5. No bloco `state.step === 'palco'`, o palco ganha o pedido de WhatsApp:

```tsx
    palco = {
      titulo: 'Agente de Produto trabalhando',
      linhas: log.length ? log : [{ estado: 'feito', texto: 'produto no catálogo', destaque: String(produto?.['Descrição'] ?? '') }],
      children: pedirWhatsapp ? <PedidoWhatsApp onEnviar={onEnviarWhatsapp} /> : undefined,
    };
```

6. Na chegada, com Tiny o botão principal publica; sem Tiny, salva. Troque `finalizar` e as ações da chegada:

```tsx
  const temTiny = !!produto?._tinyProductId;

  const finalizar = async (modo: 'tiny' | 'catalogo' | 'depois') => {
    if (!produto?._id) return;
    setErro(null);
    setOcupado(true);
    try {
      if (modo !== 'depois') await onSalvarNoCatalogo();
      if (modo === 'tiny') await onPublicarNoTiny(produto._id);
      if (modo !== 'depois') trackMissionArtifactPublished({ missionId: 'produto', destino: modo });
      trackMissionStepCompleted({ missionId: 'produto', step: 'chegada' });
      trackMissionCompleted({ missionId: 'produto' });
      onState({
        ...state,
        dados: {
          ...state.dados,
          ...(modo === 'tiny' ? { publicado: true } : {}),
          ...(modo !== 'depois' ? { salvoNoCatalogo: true } : {}),
        },
        artefato: { tipo: 'produto', id: produto._id, rotulo: String(produto['Descrição'] ?? 'Produto') },
        concluidaEm: new Date().toISOString(),
      });
      onConcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar agora. Tenta de novo.');
    } finally {
      setOcupado(false);
    }
  };
```

```tsx
    acoes.push({
      rotulo: ocupado ? 'Salvando…' : temTiny ? 'Publicar no Tiny' : 'Salvar no meu catálogo',
      onClick: () => finalizar(temTiny ? 'tiny' : 'catalogo'),
      desabilitada: ocupado,
    });
    acoes.push({ rotulo: 'Quero ajustar antes', variante: 'secundaria', onClick: () => finalizar('depois'), desabilitada: ocupado });
```

Com catálogo, o "Antes" mostra a descrição original: no `avancarPasso` do catálogo, troque `descricaoOriginal: ''` por `descricaoOriginal: semHtml(p['Descrição complementar'])` (é vazio por definição, mas mantém a mesma fonte do caso por link).

- [ ] **Step 5: Verificar** — `npx tsx scripts/verify-mission-steps.mjs` → `Tudo ok.`; `npm run lint` → nenhum erro novo. (O `App.tsx` ainda não passa as props novas; se o lint acusar isso aqui, é esperado e fecha na Task 8 — nesse caso faça o commit desta tarefa junto com a Task 8.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/onboarding/mission/missionSteps.ts scripts/verify-mission-steps.mjs src/modules/onboarding/mission/MissaoProduto.tsx src/App.tsx
git commit -m "feat(onboarding): Missão Produto escolhe do catálogo e publica no Tiny"
```

---

## Task 6: O fluxo retomável da Missão Conteúdo (puro)

**Files:**
- Create: `src/modules/onboarding/mission/conteudoFluxo.ts`
- Create: `scripts/verify-conteudo-fluxo.mjs`
- Modify: `src/modules/onboarding/mission/missionSteps.ts` (condição do palco de Conteúdo)
- Modify: `scripts/verify-mission-steps.mjs`

**Interfaces:**
- Produces: `DadosConteudo`; `AcaoConteudo`; `ArtigoResumo`; `proximaAcaoConteudo(dados, artigo): AcaoConteudo`; `rotuloEstagio(stage): string`; `slugCandidatos(nome): string[]`.

- [ ] **Step 1: Escrever o verify que falha**

Crie `scripts/verify-conteudo-fluxo.mjs`:

```js
// Orquestração pura da Missão Conteúdo. Rodar com: npx tsx scripts/verify-conteudo-fluxo.mjs
import { proximaAcaoConteudo, rotuloEstagio, slugCandidatos } from '../src/modules/onboarding/mission/conteudoFluxo.ts';
import { MISSOES } from '../src/modules/onboarding/mission/missionSteps.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const p = { projectId: 'p1' };
check('sem clusters → gera clusters', proximaAcaoConteudo(p, null), 'gerar-clusters');
const c = { ...p, clusterId: 'c1' };
check('com cluster, sem artigo → cria artigo', proximaAcaoConteudo(c, null), 'criar-artigo');
const a = { ...c, articleId: 'a1' };
check('com artigo, sem blog → cria blog', proximaAcaoConteudo(a, null), 'criar-blog');
const b = { ...a, blogSlug: 'casa' };
check('artigo ainda não carregou → aguarda', proximaAcaoConteudo(b, null), 'aguardar');
check('artigo agendado → produz', proximaAcaoConteudo(b, { status: 'agendado', stage: 0, temFinal: false }), 'produzir');
const iniciada = { ...b, producaoIniciada: true };
check('produção pedida, ainda agendado → aguarda', proximaAcaoConteudo(iniciada, { status: 'agendado', stage: 0, temFinal: false }), 'aguardar');
check('em produção → aguarda', proximaAcaoConteudo(iniciada, { status: 'em_producao', stage: 2, temFinal: false }), 'aguardar');
check('erro do pipeline → erro', proximaAcaoConteudo(iniciada, { status: 'erro', stage: 3, temFinal: false }), 'erro');
check('erro + "tentar de novo" → produz', proximaAcaoConteudo(b, { status: 'erro', stage: 3, temFinal: false }), 'produzir');
check('versão final pronta → publica', proximaAcaoConteudo(iniciada, { status: 'revisao', stage: 5, temFinal: true }), 'publicar');
check('publicado → pronto', proximaAcaoConteudo({ ...iniciada, urlPost: 'https://x/b/casa/post' }, { status: 'revisao', stage: 5, temFinal: true }), 'pronto');

check('rótulos na ordem do ArticleView', [1, 2, 3, 4, 5].map(rotuloEstagio), ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem']);
check('estágio 0 não tem rótulo', rotuloEstagio(0), '');

check('slug a partir do nome', slugCandidatos('Casa & Brilho'), ['casa-brilho', 'casa-brilho-blog', 'casa-brilho-2', 'casa-brilho-3']);
check('nome curto demais cai no padrão', slugCandidatos('Oi')[0], 'meu-blog');

// O palco de Conteúdo só termina quando o artigo foi publicado no blog —
// não quando o blog passa a existir.
const palco = MISSOES.conteudo.steps.find((s) => s.id === 'palco');
check('palco não termina com o blog só criado', palco.concluido({ blogSlug: 'casa' }), false);
check('palco termina com o post publicado', palco.concluido({ blogSlug: 'casa', urlPost: 'https://x' }), true);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

Run: `npx tsx scripts/verify-conteudo-fluxo.mjs` → Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Implementar**

Crie `src/modules/onboarding/mission/conteudoFluxo.ts`:

```ts
// Orquestração da Missão Conteúdo. PURO.
//
// A missão é retomável: cada sub-passo grava em state.dados o id do que
// criou, e proximaAcaoConteudo decide o próximo passo a partir do que já
// existe. Recarregar a página no meio da produção continua de onde parou, e
// nenhum passo roda duas vezes (cada um só roda quando o seu id ainda falta).

import { slugify } from '../../content/blog/slug';

export interface DadosConteudo {
  projectId?: string;
  configConfirmada?: boolean;
  nomeEmpresa?: string;
  descricao?: string;
  nClusters?: number;
  clusterId?: string;
  tema?: string;
  kwPrincipal?: string;
  articleId?: string;
  blogSlug?: string;
  producaoIniciada?: boolean;
  urlPost?: string;
  previewAberto?: boolean;
  blogPublicado?: boolean;
}

export type AcaoConteudo =
  | 'gerar-clusters' | 'criar-artigo' | 'criar-blog'
  | 'produzir' | 'aguardar' | 'publicar' | 'pronto' | 'erro';

/** O que a missão precisa saber do artigo, vindo do listener do calendário. */
export interface ArtigoResumo {
  status: string;
  stage: number;
  temFinal: boolean;
}

export function proximaAcaoConteudo(dados: DadosConteudo, artigo: ArtigoResumo | null): AcaoConteudo {
  if (!dados.clusterId) return 'gerar-clusters';
  if (!dados.articleId) return 'criar-artigo';
  if (!dados.blogSlug) return 'criar-blog';
  if (dados.urlPost) return 'pronto';
  if (!artigo) return 'aguardar';
  if (artigo.temFinal) return 'publicar';
  // "Tentar de novo" limpa producaoIniciada: um artigo em erro volta a produzir.
  if (artigo.status === 'erro') return dados.producaoIniciada ? 'erro' : 'produzir';
  if (artigo.status === 'agendado' && !dados.producaoIniciada) return 'produzir';
  return 'aguardar';
}

// Mesma ordem de src/modules/content/ArticleView.tsx (STAGES), indexada por stage 1..5.
const ESTAGIOS = ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem'];

export function rotuloEstagio(stage: number): string {
  return ESTAGIOS[stage - 1] ?? '';
}

/** Endereços tentados em ordem — o servidor responde 409 quando um já está em uso. */
export function slugCandidatos(nome: string): string[] {
  const s = slugify(nome);
  const base = s.length >= 3 ? s : 'meu-blog';
  return [base, `${base}-blog`, `${base}-2`, `${base}-3`];
}
```

`slugify` é a mesma função que `server/blogAdmin.ts` usa no claim — conferido: `'Casa & Brilho'` → `'casa-brilho'`, `'Oi'` → `'oi'` (curto demais, por isso cai em `meu-blog`).

Em `src/modules/onboarding/mission/missionSteps.ts`, na missão `conteudo`, troque a condição do palco:

```ts
        // Só termina com o post publicado no blog — não quando o blog passa a existir.
        concluido: (d) => typeof d.urlPost === 'string' && d.urlPost.length > 0,
```

- [ ] **Step 3: Verificar** — `npx tsx scripts/verify-conteudo-fluxo.mjs` → `Tudo ok.`; `npx tsx scripts/verify-mission-steps.mjs` → `Tudo ok.`; `npm run lint` → nenhum erro novo.

- [ ] **Step 4: Commit**

```bash
git add src/modules/onboarding/mission/conteudoFluxo.ts scripts/verify-conteudo-fluxo.mjs src/modules/onboarding/mission/missionSteps.ts
git commit -m "feat(onboarding): fluxo retomável da Missão Conteúdo"
```

---

## Task 7: A Missão Conteúdo

**Files:**
- Create: `src/modules/onboarding/mission/MissaoConteudo.tsx`

**Interfaces:**
- Consumes: `proximaAcaoConteudo`, `rotuloEstagio`, `slugCandidatos`, `DadosConteudo` (Task 6); `PedidoWhatsApp` (Task 4); `MissionRunner`, `Acao`, `Turno`, `StageLogLine`, `StageProps`, `MISSOES`, `avancar`, `progresso`, `MissionState` (Plano 1); de `contentService`: `scanWebsite`, `createProject`, `generateClusters`, `approveCluster`, `createArticleManual`, `produceArticle`, `publishArticle`, `listenCalendar`; de `blogService`: `claimBlogSlug`, `saveBlogSettings`; `DEFAULT_BLOG_COLORS`.
- Produces: `MissaoConteudo` com props `{ uid, state, onState, custoCreditos, mostrarPedidoWhatsapp, onEnviarWhatsapp, onHabilitarConteudo, onComprarCreditos, onConcluir }`.

- [ ] **Step 1: Implementar**

Crie `src/modules/onboarding/mission/MissaoConteudo.tsx`:

```tsx
// Missão Conteúdo: site → configuração revisada → clusters → artigo → blog em
// preview (noindex) → "Publicar o blog".
//
// O palco é retomável (conteudoFluxo.ts). O listener do artigo é a fonte da
// verdade do pipeline: a resposta HTTP de produceArticle pode cair numa espera
// longa sem que o pipeline pare, e os erros dele (créditos inclusive) aparecem
// como status 'erro' no próprio artigo.

import React, { useEffect, useRef, useState } from 'react';
import MissionRunner from './MissionRunner';
import type { Acao, Turno } from './MissionChat';
import type { StageLogLine, StageProps } from './Stage';
import PedidoWhatsApp from './PedidoWhatsApp';
import { MISSOES, avancar, progresso } from './missionSteps';
import type { MissionState } from './missionTypes';
import { proximaAcaoConteudo, rotuloEstagio, slugCandidatos, type AcaoConteudo, type DadosConteudo } from './conteudoFluxo';
import {
  approveCluster, createArticleManual, createProject, generateClusters, listenCalendar,
  produceArticle, publishArticle, scanWebsite,
} from '../../../services/contentService';
import { claimBlogSlug, saveBlogSettings } from '../../../services/blogService';
import { DEFAULT_BLOG_COLORS } from '../../content/blog/types';
import type { CalendarArticle, ContentProjectConfig } from '../../content/types';
import { trackMissionArtifactPublished, trackMissionCompleted, trackMissionStepCompleted } from '../../../analytics';

interface Props {
  uid: string;
  state: MissionState;
  onState: (s: MissionState) => void;
  /** Soma estimada dos créditos do caminho enxuto (clusters + pesquisa + artigo + capa). */
  custoCreditos: number;
  mostrarPedidoWhatsapp: boolean;
  onEnviarWhatsapp: (whatsapp: string) => Promise<void>;
  /** Liga modules.contentAgent e modules.blog para esta conta. */
  onHabilitarConteudo: () => Promise<void>;
  onComprarCreditos: () => void;
  onConcluir: () => void;
}

interface Rascunho { nome: string; oQueVende: string; publico: string; tom: string; descricao: string; objetivos: string[]; palavrasChave: string[] }
const rascunhoVazio: Rascunho = { nome: '', oQueVende: '', publico: '', tom: '', descricao: '', objetivos: [], palavrasChave: [] };

const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);
const pareceCredito = (m: string | null) => !!m && /cr[ée]dito/i.test(m);

const MissaoConteudo: React.FC<Props> = ({
  uid, state, onState, custoCreditos, mostrarPedidoWhatsapp, onEnviarWhatsapp,
  onHabilitarConteudo, onComprarCreditos, onConcluir,
}) => {
  const d = state.dados as DadosConteudo;
  const [site, setSite] = useState('');
  const [fase, setFase] = useState<'site' | 'revisao'>('site');
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoVazio);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [artigo, setArtigo] = useState<CalendarArticle | null>(null);
  const [tick, setTick] = useState(0);
  const [pedirWhatsapp] = useState(mostrarPedidoWhatsapp);
  const executando = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const artigoRef = useRef(artigo);
  artigoRef.current = artigo;

  const passo = { ...progresso(state), titulo: MISSOES.conteudo.steps.find((s) => s.id === state.step)!.titulo };

  // Grava no estado da missão a partir do valor mais recente (não do render).
  const gravar = (patch: DadosConteudo) => {
    const s = stateRef.current;
    const novo = { ...s, dados: { ...s.dados, ...patch } };
    stateRef.current = novo;
    onState(novo);
  };
  const avancarPasso = (patch: DadosConteudo) => {
    const s = stateRef.current;
    trackMissionStepCompleted({ missionId: 'conteudo', step: s.step });
    const novo = avancar({ ...s, dados: { ...s.dados, ...patch } });
    stateRef.current = novo;
    onState(novo);
  };

  useEffect(() => {
    if (!d.projectId || !d.articleId) return;
    return listenCalendar(uid, d.projectId, (lista) => setArtigo(lista.find((a) => a.id === d.articleId) ?? null));
  }, [uid, d.projectId, d.articleId]);

  // ---- contexto -----------------------------------------------------------
  const lerSite = async () => {
    setErro(null);
    setOcupado(true);
    try {
      const { config } = await scanWebsite(site.trim());
      setRascunho({
        nome: config.nomeEmpresa ?? '',
        oQueVende: config.produtoServico ?? '',
        publico: (config.publicoAlvo ?? []).join(', '),
        tom: config.tomDeVoz ?? '',
        descricao: config.descricao ?? '',
        objetivos: config.objetivos ?? [],
        palavrasChave: config.palavrasChave ?? [],
      });
    } catch (e) {
      setRascunho(rascunhoVazio);
      setErro(`${mensagem(e, 'Não consegui ler o site.')} Me conta aqui mesmo:`);
    } finally {
      setOcupado(false);
      setFase('revisao');
    }
  };

  const confirmar = async () => {
    setErro(null);
    setOcupado(true);
    try {
      const config: ContentProjectConfig = {
        nomeEmpresa: rascunho.nome.trim(),
        descricao: (rascunho.descricao || rascunho.oQueVende).trim(),
        produtoServico: rascunho.oQueVende.trim(),
        publicoAlvo: rascunho.publico.split(',').map((x) => x.trim()).filter(Boolean),
        tomDeVoz: rascunho.tom.trim() || 'Amigável',
        objetivos: rascunho.objetivos.length ? rascunho.objetivos : ['Atrair visitantes do Google'],
        palavrasChave: rascunho.palavrasChave,
        referencias: [],
        frequenciaPostagens: '2 vezes na semana',
        wordpressUrl: '',
        wordpressUser: '',
        sanityProjectId: '',
        sanityDataset: 'production',
        estiloImagem: 'Realista',
        siteUrl: site.trim(),
      };
      const projectId = await createProject(uid, config);
      await onHabilitarConteudo();
      avancarPasso({ projectId, configConfirmada: true, nomeEmpresa: config.nomeEmpresa, descricao: config.descricao });
    } catch (e) {
      setErro(mensagem(e, 'Não consegui criar o projeto.'));
    } finally {
      setOcupado(false);
    }
  };

  // ---- palco: um sub-passo por vez, sempre a partir do estado gravado -------
  const executar = async (acao: AcaoConteudo) => {
    const dd = stateRef.current.dados as DadosConteudo;
    const projectId = dd.projectId!;
    if (acao === 'gerar-clusters') {
      const { clusters } = await generateClusters(projectId);
      const ativos = clusters.filter((c) => !c.excluido);
      if (!ativos.length) throw new Error('Não encontrei temas para o seu blog. Tenta revisar o que você vende.');
      const volume = (c: (typeof ativos)[number]) => c.palavrasChave.reduce((t, k) => t + (k.volume ?? 0), 0);
      const tema = [...ativos].sort((a, b) => volume(b) - volume(a))[0];
      const kw = [...tema.palavrasChave].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0]?.termo ?? tema.nome;
      await approveCluster(uid, projectId, tema.id, true);
      gravar({ clusterId: tema.id, tema: tema.nome, kwPrincipal: kw, nClusters: ativos.length });
      return;
    }
    if (acao === 'criar-artigo') {
      const kw = dd.kwPrincipal ?? dd.tema ?? '';
      const articleId = await createArticleManual(uid, projectId, {
        titulo: kw.charAt(0).toUpperCase() + kw.slice(1),
        kwPrincipal: kw,
        tamanho: 'curto',
        scheduledDate: new Date().toISOString().slice(0, 10),
        clusterId: dd.clusterId ?? '',
        produtosVinculados: [],
        priority: 0,
      });
      gravar({ articleId });
      return;
    }
    if (acao === 'criar-blog') {
      let ultimoErro: unknown = null;
      for (const candidato of slugCandidatos(dd.nomeEmpresa ?? '')) {
        try {
          const { slug } = await claimBlogSlug(projectId, candidato);
          await saveBlogSettings(uid, projectId, {
            enabled: true,
            indexable: false,
            slug,
            title: dd.nomeEmpresa ?? 'Meu blog',
            description: dd.descricao ?? '',
            template: 'editorial',
            colors: DEFAULT_BLOG_COLORS,
            customDomains: [],
            createdAt: new Date().toISOString(),
          });
          gravar({ blogSlug: slug });
          return;
        } catch (e) {
          ultimoErro = e; // 409: endereço em uso — tenta o próximo
        }
      }
      throw ultimoErro ?? new Error('Não consegui reservar um endereço para o blog.');
    }
    if (acao === 'produzir') {
      gravar({ producaoIniciada: true });
      try {
        await produceArticle(projectId, dd.articleId!);
      } catch (e) {
        // Se o servidor nem começou (o artigo segue agendado), devolve o erro e
        // libera o "tentar de novo". Se começou, o listener mostra o desfecho.
        if ((artigoRef.current?.status ?? 'agendado') === 'agendado') {
          gravar({ producaoIniciada: false });
          throw e;
        }
      }
      return;
    }
    if (acao === 'publicar') {
      const { url } = await publishArticle(projectId, dd.articleId!, 'blog');
      gravar({ urlPost: url });
      return;
    }
    if (acao === 'pronto') {
      avancarPasso({});
    }
  };

  const resumo = artigo ? { status: artigo.status, stage: artigo.stage, temFinal: !!artigo.articleFinal } : null;
  const acao = state.step === 'palco' ? proximaAcaoConteudo(d, resumo) : null;

  useEffect(() => {
    if (!acao || acao === 'aguardar' || acao === 'erro' || erro || executando.current) return;
    executando.current = true;
    executar(acao)
      .catch((e) => setErro(mensagem(e, 'Algo falhou no meio do caminho.')))
      .finally(() => {
        executando.current = false;
        setTick((t) => t + 1); // reavalia: o próximo passo pode depender só do que acabou de ser gravado
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao, erro, tick]);

  const tentarDeNovo = () => {
    if (artigo?.status === 'erro') gravar({ producaoIniciada: false });
    setErro(null);
  };

  // ---- render ---------------------------------------------------------------
  const turnos: Turno[] = [];
  const acoes: Acao[] = [];
  let palco: StageProps | undefined;
  const campo = (id: string, rotulo: string, valor: string, onChange: (v: string) => void, dica?: string) => (
    <label htmlFor={id} className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
      {rotulo}
      <input
        id={id}
        value={valor}
        placeholder={dica}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 text-xs font-normal text-slate-800"
      />
    </label>
  );

  if (state.step === 'contexto' && fase === 'site') {
    turnos.push({ autor: 'agente', texto: 'Me passa o endereço do seu site ou loja. Eu leio a página e monto a estratégia do blog pra você só revisar.' });
    turnos.push({
      autor: 'agente',
      texto: (
        <input
          id="missao-conteudo-site"
          type="url"
          inputMode="url"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="suamarca.com.br"
          className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 font-mono text-xs"
        />
      ),
    });
    acoes.push({ rotulo: ocupado ? 'Lendo o site…' : 'Ler meu site', onClick: lerSite, desabilitada: ocupado || !site.trim() });
    acoes.push({ rotulo: 'Ainda não tenho site', variante: 'secundaria', onClick: () => { setRascunho(rascunhoVazio); setFase('revisao'); } });
  }

  if (state.step === 'contexto' && fase === 'revisao') {
    turnos.push({ autor: 'agente', texto: erro ?? 'Montei isso — confere o que não bater:' });
    turnos.push({
      autor: 'agente',
      texto: (
        <div className="flex flex-col gap-2">
          {campo('conteudo-nome', 'Nome da marca', rascunho.nome, (v) => setRascunho((r) => ({ ...r, nome: v })))}
          {campo('conteudo-vende', 'O que você vende', rascunho.oQueVende, (v) => setRascunho((r) => ({ ...r, oQueVende: v })), 'ex.: utilidades domésticas')}
          {campo('conteudo-publico', 'Para quem (separe por vírgula)', rascunho.publico, (v) => setRascunho((r) => ({ ...r, publico: v })))}
          {campo('conteudo-tom', 'Tom de voz', rascunho.tom, (v) => setRascunho((r) => ({ ...r, tom: v })), 'ex.: prático e acolhedor')}
        </div>
      ),
    });
    acoes.push({
      rotulo: ocupado ? 'Criando…' : 'Está certo',
      onClick: confirmar,
      desabilitada: ocupado || !rascunho.nome.trim() || !rascunho.oQueVende.trim(),
    });
    acoes.push({ rotulo: 'Voltar', variante: 'secundaria', onClick: () => { setErro(null); setFase('site'); } });
  }

  if (state.step === 'palco') {
    const linhas: StageLogLine[] = [{ estado: 'feito', texto: 'marca e público confirmados', destaque: d.nomeEmpresa }];
    if (d.clusterId) linhas.push({ estado: 'feito', texto: `temas encontrados — escolhi "${d.tema}"`, destaque: String(d.nClusters ?? '') });
    if (d.blogSlug) linhas.push({ estado: 'feito', texto: 'blog criado', destaque: `/b/${d.blogSlug}/` });
    const stage = artigo?.stage ?? 0;
    for (let i = 1; i < stage; i++) linhas.push({ estado: 'feito', texto: rotuloEstagio(i) });
    if (acao === 'gerar-clusters') linhas.push({ estado: 'agora', texto: 'pesquisando temas e palavras-chave…' });
    else if (artigo?.status === 'em_producao') linhas.push({ estado: 'agora', texto: `${rotuloEstagio(stage) || 'escrevendo'}…` });
    else if (acao === 'publicar') linhas.push({ estado: 'agora', texto: 'publicando no blog…' });
    else if (!erro && acao !== 'erro') linhas.push({ estado: 'agora', texto: 'preparando o artigo…' });

    turnos.push({
      autor: 'agente',
      texto: d.kwPrincipal
        ? <>Vou escrever sobre <b>{d.kwPrincipal}</b> — é o que mais buscam no seu tema. Usa cerca de {custoCreditos} créditos.</>
        : <>Procurando os temas que o seu público mais busca. O caminho todo usa cerca de {custoCreditos} créditos.</>,
    });
    const falha = erro ?? (acao === 'erro' ? (artigo?.lastError ?? 'O artigo falhou no meio da produção.') : null);
    if (falha) {
      turnos.push({ autor: 'agente', texto: falha });
      acoes.push({ rotulo: 'Tentar de novo', onClick: tentarDeNovo });
      if (pareceCredito(falha)) acoes.push({ rotulo: 'Comprar créditos', variante: 'secundaria', onClick: onComprarCreditos });
    }
    palco = {
      titulo: 'Agente de Conteúdo trabalhando',
      linhas,
      children: pedirWhatsapp ? <PedidoWhatsApp onEnviar={onEnviarWhatsapp} /> : undefined,
    };
  }

  if (state.step === 'chegada') {
    const blogUrl = `${window.location.origin}/b/${d.blogSlug}/`;
    turnos.push({ autor: 'agente', texto: <>Seu blog está montado. <b>Abre aí</b> — por enquanto só você consegue ver.</> });
    if (erro) turnos.push({ autor: 'agente', texto: erro });
    palco = {
      titulo: 'Resultado',
      linhas: [{ estado: 'feito', texto: 'primeiro artigo no ar, fora do Google', destaque: `/b/${d.blogSlug}/` }],
      children: (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <span className="truncate font-mono text-[11px] text-slate-600">{blogUrl}</span>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">noindex</span>
        </div>
      ),
    };
    const concluir = (publicado: boolean) => {
      trackMissionStepCompleted({ missionId: 'conteudo', step: 'chegada' });
      trackMissionCompleted({ missionId: 'conteudo' });
      const s = stateRef.current;
      onState({
        ...s,
        dados: { ...s.dados, ...(publicado ? { blogPublicado: true } : {}) },
        artefato: { tipo: 'blog', id: String(d.projectId), rotulo: String(d.nomeEmpresa ?? 'Blog'), url: blogUrl },
        concluidaEm: new Date().toISOString(),
      });
      onConcluir();
    };
    acoes.push({
      rotulo: 'Abrir meu blog',
      variante: 'secundaria',
      onClick: () => { window.open(blogUrl, '_blank', 'noopener'); gravar({ previewAberto: true }); },
    });
    acoes.push({
      rotulo: ocupado ? 'Publicando…' : 'Publicar o blog',
      desabilitada: ocupado,
      onClick: async () => {
        setErro(null);
        setOcupado(true);
        try {
          await saveBlogSettings(uid, String(d.projectId), { indexable: true });
          trackMissionArtifactPublished({ missionId: 'conteudo', destino: 'blog' });
          concluir(true);
        } catch (e) {
          setErro(mensagem(e, 'Não consegui publicar agora.'));
        } finally {
          setOcupado(false);
        }
      },
    });
    acoes.push({ rotulo: 'Publico depois', variante: 'secundaria', onClick: () => concluir(false) });
  }

  return <MissionRunner titulo="Seu blog no ar" passo={passo} turnos={turnos} palco={palco} acoes={acoes} />;
};

export default MissaoConteudo;
```

Conferido no código: `generateClusters` devolve `{ clusters: ContentCluster[] }` (`src/services/contentService.ts:75`); `CalendarArticle` tem `status`, `stage`, `articleFinal` e `lastError` (`src/modules/content/types.ts:210-244`); `saveBlogSettings` aceita `Partial<BlogSettings>` (`src/services/blogService.ts:39`).

- [ ] **Step 2: Verificar** — `npm run lint` → nenhum erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/modules/onboarding/mission/MissaoConteudo.tsx
git commit -m "feat(onboarding): Missão Conteúdo ponta a ponta, com blog em preview"
```

---

## Task 8: Ligar as duas missões no App

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `MissaoConteudo` (Task 7), `MissaoProduto` com as props novas (Task 5), `enviarContatoMissao` (Task 3), `publicarProdutoNoTiny` (Task 5), `listenProjects`.

- [ ] **Step 1: Retomada de qualquer missão**

No `useEffect` de retomada criado no Plano 1 (o que chama `ouvirMissoes`), troque a busca da missão em andamento para não filtrar por `'produto'`, pegando a mais recente:

```ts
      const emAndamento = lista
        .filter((m) => !m.concluidaEm)
        .sort((a, b) => b.iniciadaEm.localeCompare(a.iniciadaEm))[0] ?? null;
```

- [ ] **Step 2: Sinal real de projeto de conteúdo**

O Plano 1 passava `temProjetoConteudo: hasContentAgent` — isso é a flag do módulo, não a existência de projeto. Declare junto dos estados da missão:

```ts
  const [projetosConteudo, setProjetosConteudo] = useState(0);
```

E um efeito ao lado do de retomada:

```ts
  useEffect(() => {
    if (!user || !isCoorteMissao(cohort)) return;
    return listenProjects(user.uid, (lista) => setProjetosConteudo(lista.length));
  }, [user, cohort]);
```

Importe `listenProjects` de `./services/contentService` e `enviarContatoMissao` de `./services/onboardingService`.

- [ ] **Step 3: Handlers compartilhados**

Junto dos handlers do App (depois de `publicarProdutoNoTiny`):

```ts
  const enviarWhatsappDaMissao = async (whatsapp: string) => {
    await enviarContatoMissao(whatsapp);
  };

  // Quem inicia a Missão Conteúdo passa a ter o workspace de Conteúdo e o
  // blog nativo — sem isso o blog criado na missão ficaria inalcançável.
  const habilitarConteudo = async () => {
    if (!user) return;
    await updateDoc(doc(db, `users/${user.uid}`), { 'modules.contentAgent': true, 'modules.blog': true });
  };

  const custoMissaoConteudo =
    getCreditCost(CREDIT_ACTIONS.contentClusters.key) +
    getCreditCost(CREDIT_ACTIONS.seoKeywordResearch.key) +
    getCreditCost(CREDIT_ACTIONS.contentArticle.key) +
    getCreditCost(CREDIT_ACTIONS.contentImage.key);
```

- [ ] **Step 4: Reescrever o bloco de render da jornada**

Substitua o bloco inteiro `if (user && isAuthReady && isCoorteMissao(cohort) && missoesCarregadas && !jornadaConcluida) { … }` do Plano 1 por:

```tsx
  // Jornada de missão (coorte nova). Tela 0 até a primeira missão concluída;
  // depois disso, uma missão só aparece em tela cheia quando iniciada pela
  // trilha (e fica até ser concluída).
  if (user && isAuthReady && isCoorteMissao(cohort) && missoesCarregadas) {
    const emCurso = missao && !missao.concluidaEm ? missao : null;
    const modalCreditos = isCreditPurchaseOpen && (
      <CreditPurchaseModal onClose={() => setIsCreditPurchaseOpen(false)} />
    );
    const salvar = (s: MissionState) => {
      setMissao(s);
      salvarMissao(user.uid, s).catch((err) => console.error('Erro ao salvar missão:', err));
    };
    const aoConcluir = () => { setJornadaConcluida(true); setMainView('missoes'); };

    if (!emCurso && !jornadaConcluida) {
      return (
        <MissionPicker
          signal={{
            produtos: products.length,
            erpConectado: products.some((p) => p._tinyProductId || p._blingProductId || p._idworksProductId),
            temProjetoConteudo: projetosConteudo > 0,
          }}
          semDescricao={products.filter((p) => !p['Descrição complementar']).length}
          onEscolher={async (id) => setMissao(await iniciarMissao(user.uid, id))}
        />
      );
    }
    if (emCurso?.missionId === 'produto') {
      return (
        <>
          <MissaoProduto
            state={emCurso}
            onState={salvar}
            produtos={products}
            categorias={existingCategories}
            onProdutoCriado={handleProductCreatedFromOnboarding}
            onCriarCategoria={handleCreateCategoryForOnboarding}
            onGerarDescricao={handleGenerateDescriptionForOnboarding}
            onSalvarNoCatalogo={() => saveToCloud(true)}
            onPublicarNoTiny={publicarProdutoNoTiny}
            mostrarPedidoWhatsapp={!onboardingCompleted}
            onEnviarWhatsapp={enviarWhatsappDaMissao}
            onConcluir={aoConcluir}
          />
          {modalCreditos}
        </>
      );
    }
    if (emCurso?.missionId === 'conteudo') {
      return (
        <>
          <MissaoConteudo
            uid={user.uid}
            state={emCurso}
            onState={salvar}
            custoCreditos={custoMissaoConteudo}
            mostrarPedidoWhatsapp={!onboardingCompleted}
            onEnviarWhatsapp={enviarWhatsappDaMissao}
            onHabilitarConteudo={habilitarConteudo}
            onComprarCreditos={() => setIsCreditPurchaseOpen(true)}
            onConcluir={aoConcluir}
          />
          {modalCreditos}
        </>
      );
    }
  }
```

Import no topo: `import MissaoConteudo from './modules/onboarding/mission/MissaoConteudo';`. Confirme que `CreditPurchaseModal`, `CREDIT_ACTIONS`, `updateDoc`, `doc` e `db` já estão importados em `App.tsx` (estão — são usados em outros pontos); `'missoes'` entra no tipo de `mainView` na Task 9 — se executar esta tarefa antes, o lint acusa `setMainView('missoes')`, e o commit desta tarefa vai junto com o da Task 9.

- [ ] **Step 5: Verificar** — `npm run lint` → nenhum erro novo (com a ressalva acima); `npx vite build --outDir <scratch>` → build ok.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(onboarding): as duas missões ligadas no App, com bônus e créditos"
```

---

## Task 9: A trilha de missões

**Files:**
- Create: `src/modules/onboarding/mission/trilha.ts`
- Create: `scripts/verify-trilha.mjs`
- Create: `src/modules/onboarding/mission/TrilhaMissoes.tsx`
- Modify: `src/App.tsx` (tipo de `mainView`, item de sidebar, render da view, aterrissagem)

**Interfaces:**
- Produces: `montarTrilha(sinal: SinalTrilha): ItemTrilha[]`; `TrilhaMissoes` com props `{ nome, itens, onAcao }`.

- [ ] **Step 1: Escrever o verify que falha**

Crie `scripts/verify-trilha.mjs`:

```js
// Trilha de missões (pura). Rodar com: npx tsx scripts/verify-trilha.mjs
import { montarTrilha } from '../src/modules/onboarding/mission/trilha.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}
const estados = (s) => Object.fromEntries(montarTrilha(s).map((i) => [i.id, i.estado]));
const vazio = { missoes: [], produtos: 0, erpConectado: false, empresaCompleta: false };

check('ordem fixa dos itens', montarTrilha(vazio).map((i) => i.id), ['produto', 'conteudo', 'catalogo', 'erp', 'publicar-blog', 'empresa']);
check('conta nova: missões acionáveis, publicar bloqueado, empresa opcional', estados(vazio), {
  produto: 'agora', conteudo: 'agora', catalogo: 'agora', erp: 'agora', 'publicar-blog': 'bloqueado', empresa: 'opcional',
});

const depoisProduto = { ...vazio, produtos: 1, missoes: [{ missionId: 'produto', concluidaEm: 'x', dados: {} }] };
check('missão produto concluída fica feita', estados(depoisProduto).produto, 'feito');
check('um produto só ainda não é catálogo', estados(depoisProduto).catalogo, 'agora');
check('catálogo com mais de um produto', estados({ ...depoisProduto, produtos: 12 }).catalogo, 'feito');

const blogPreview = { ...vazio, missoes: [{ missionId: 'conteudo', concluidaEm: 'x', dados: {} }] };
check('blog criado libera "publicar"', estados(blogPreview)['publicar-blog'], 'agora');
check('blog publicado fica feito', estados({ ...vazio, missoes: [{ missionId: 'conteudo', concluidaEm: 'x', dados: { blogPublicado: true } }] })['publicar-blog'], 'feito');
check('missão em andamento não conta como feita', estados({ ...vazio, missoes: [{ missionId: 'conteudo', dados: {} }] }).conteudo, 'agora');
check('ERP conectado', estados({ ...vazio, erpConectado: true }).erp, 'feito');
check('empresa completa', estados({ ...vazio, empresaCompleta: true }).empresa, 'feito');

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

Run: `npx tsx scripts/verify-trilha.mjs` → Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Implementar a trilha pura**

Crie `src/modules/onboarding/mission/trilha.ts`:

```ts
// Trilha de missões do dia 2 em diante. PURO: recebe o estado da conta e
// devolve os itens com o estado de cada um. A ordem é fixa — é a sequência que
// o spec propõe, e a primeira missão já chega riscada.

import type { MissionId } from './missionTypes';

export type EstadoItem = 'feito' | 'agora' | 'bloqueado' | 'opcional';
export type ItemId = 'produto' | 'conteudo' | 'catalogo' | 'erp' | 'publicar-blog' | 'empresa';

export interface ItemTrilha {
  id: ItemId;
  titulo: string;
  meta: string;
  estado: EstadoItem;
}

export interface SinalTrilha {
  missoes: { missionId: MissionId; concluidaEm?: string; dados: Record<string, unknown> }[];
  produtos: number;
  erpConectado: boolean;
  empresaCompleta: boolean;
}

export function montarTrilha(s: SinalTrilha): ItemTrilha[] {
  const concluida = (id: MissionId) => s.missoes.find((m) => m.missionId === id && m.concluidaEm);
  const conteudo = concluida('conteudo');
  const blogPublicado = conteudo?.dados.blogPublicado === true;
  return [
    { id: 'produto', titulo: 'Aprimorar seu primeiro produto', meta: 'Agente de Produto', estado: concluida('produto') ? 'feito' : 'agora' },
    { id: 'conteudo', titulo: 'Montar seu blog', meta: 'Agente de Conteúdo', estado: conteudo ? 'feito' : 'agora' },
    { id: 'catalogo', titulo: 'Trazer o resto do catálogo', meta: 'cole mais links ou suba a planilha', estado: s.produtos > 1 ? 'feito' : 'agora' },
    { id: 'erp', titulo: 'Conectar seu ERP', meta: 'publica direto na sua loja', estado: s.erpConectado ? 'feito' : 'agora' },
    {
      id: 'publicar-blog',
      titulo: 'Publicar seu blog',
      meta: conteudo ? 'libera o blog para o Google' : 'libera depois que o blog existir',
      estado: blogPublicado ? 'feito' : conteudo ? 'agora' : 'bloqueado',
    },
    { id: 'empresa', titulo: 'Completar dados da empresa', meta: 'necessário só para emitir nota', estado: s.empresaCompleta ? 'feito' : 'opcional' },
  ];
}
```

Run: `npx tsx scripts/verify-trilha.mjs` → `Tudo ok.`

- [ ] **Step 3: A view**

Crie `src/modules/onboarding/mission/TrilhaMissoes.tsx`:

```tsx
// A trilha de missões: para onde a coorte nova volta depois da primeira missão.

import React from 'react';
import type { ItemId, ItemTrilha } from './trilha';

interface Props {
  nome: string;
  itens: ItemTrilha[];
  onAcao: (id: ItemId) => void;
}

const rotuloAcao: Record<ItemTrilha['estado'], string> = {
  feito: 'Ver', agora: 'Começar', bloqueado: '—', opcional: 'Quando precisar',
};

const TrilhaMissoes: React.FC<Props> = ({ nome, itens, onAcao }) => {
  const feitos = itens.filter((i) => i.estado === 'feito').length;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">{nome ? `Oi, ${nome}.` : 'Suas missões'}</h1>
        <p className="text-sm text-slate-500">
          {feitos === 0 ? 'Comece por uma — cada missão termina em algo que você consegue abrir.' : `Sua loja já está ${feitos} ${feitos === 1 ? 'missão' : 'missões'} à frente.`}
        </p>
      </div>
      <ol className="flex flex-col rounded-2xl border border-slate-200 bg-white px-4">
        {itens.map((item, i) => (
          <li key={item.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-slate-100 py-3 last:border-b-0">
            <span
              className={[
                'grid h-6 w-6 place-items-center rounded-full border text-[11px] font-bold',
                item.estado === 'feito' ? 'border-emerald-700 bg-emerald-700 text-white' : '',
                item.estado === 'agora' ? 'border-[#FF5B03] text-[#FF5B03]' : '',
                item.estado === 'bloqueado' || item.estado === 'opcional' ? 'border-slate-300 text-slate-400' : '',
              ].join(' ')}
            >
              {item.estado === 'feito' ? '✓' : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${item.estado === 'feito' ? 'text-slate-400 line-through' : ''}`}>{item.titulo}</span>
              <span className="block text-xs text-slate-500">{item.meta}</span>
            </span>
            <button
              type="button"
              disabled={item.estado === 'bloqueado'}
              onClick={() => onAcao(item.id)}
              className={`min-h-[44px] px-2 text-xs font-bold ${item.estado === 'agora' ? 'text-[#FF5B03]' : 'text-slate-400'} disabled:cursor-default`}
            >
              {rotuloAcao[item.estado]}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default TrilhaMissoes;
```

- [ ] **Step 4: Ligar no App**

Em `src/App.tsx`:

1. No tipo de `mainView` (linha com `useState<'home' | 'products' | …>`), acrescente `| 'missoes'`.
2. Import: `import TrilhaMissoes from './modules/onboarding/mission/TrilhaMissoes';`, `import { montarTrilha, type ItemId } from './modules/onboarding/mission/trilha';`, e o ícone `Target` no import de `lucide-react`.
3. Estado da lista de missões para a trilha, junto dos outros estados da missão:

```ts
  const [todasMissoes, setTodasMissoes] = useState<MissionState[]>([]);
```

No efeito de retomada (o que chama `ouvirMissoes`), grave a lista: `setTodasMissoes(lista);` como primeira linha do callback.

4. Aterrissagem: quem é da coorte e já concluiu a primeira missão abre na trilha — uma vez por sessão:

```ts
  const trilhaAterrissou = useRef(false);
  useEffect(() => {
    if (!isCoorteMissao(cohort) || !jornadaConcluida || trilhaAterrissou.current) return;
    trilhaAterrissou.current = true;
    setMainView('missoes');
  }, [cohort, jornadaConcluida]);
```

5. A ação de cada item:

```ts
  const acaoDaTrilha = async (id: ItemId) => {
    if (!user) return;
    if (id === 'produto' || id === 'conteudo') { setMissao(await iniciarMissao(user.uid, id)); return; }
    if (id === 'catalogo') { setMainView('products'); handleOpenProductUrlImport(); return; }
    if (id === 'erp') { setMainView('integrations'); return; }
    if (id === 'publicar-blog') { setWorkspace('content'); return; }
    if (id === 'empresa') { setMainView('company'); }
  };
```

6. Item na sidebar, **antes** do bloco `(hasContentAgent || hasOperationsAgent) && (…Início…)`, só para a coorte:

```tsx
          {isCoorteMissao(cohort) && (
            <button
              onClick={() => { setMainView('missoes'); setIsSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'missoes' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
              title="Missões"
            >
              <Target className="w-4 h-4 shrink-0" /> {!sidebarCollapsed && 'Missões'}
            </button>
          )}
```

7. Render da view, como primeiro ramo da cadeia `mainView === 'home' ? (…)` (troque `{mainView === 'home' ? (` por `{mainView === 'missoes' ? (<TrilhaMissoes … />) : mainView === 'home' ? (`):

```tsx
            <TrilhaMissoes
              nome={(user.displayName ?? '').split(' ')[0]}
              itens={montarTrilha({
                missoes: todasMissoes,
                produtos: products.length,
                erpConectado: products.some((p) => p._tinyProductId || p._blingProductId || p._idworksProductId),
                empresaCompleta: !!companyData?.cnpj,
              })}
              onAcao={acaoDaTrilha}
            />
```

`companyData` é o estado setado por `setCompanyData` no snapshot do usuário, e `CompanyData.cnpj` é `string` (`src/types/onboarding.ts:43`).

- [ ] **Step 5: Verificar** — `npx tsx scripts/verify-trilha.mjs` → `Tudo ok.`; `npm run lint` → nenhum erro novo; `npx vite build --outDir <scratch>` → ok.

- [ ] **Step 6: Commit**

```bash
git add src/modules/onboarding/mission/trilha.ts scripts/verify-trilha.mjs src/modules/onboarding/mission/TrilhaMissoes.tsx src/App.tsx
git commit -m "feat(onboarding): trilha de missões para quem volta"
```

---

## Validação manual (depois da Task 9)

Exige **deploy das regras do Firestore antes** (a subcoleção `missions` do Plano 1) e uma conta nova. Em ~375px de largura:

1. Tela 0 → "Aparecer no Google" → etapa 1 pede o site. "Ainda não tenho site" leva ao formulário vazio.
2. Com o site: os campos voltam preenchidos; "Está certo" cria o projeto e **a sidebar passa a mostrar o workspace de Conteúdo** (`modules.contentAgent`).
3. Palco: aparecem "pesquisando temas…" e o **pedido de WhatsApp**. Enviar o número → "Anotado", e o saldo sobe 30. No Firestore, `onboarding.contact.whatsapp` fica no formato `(11) 98765-4321`, com `whatsappConsent: true`.
4. **Recarregar no meio da produção** → volta no palco, no mesmo estágio, sem gerar clusters de novo (confira em `credit_logs` que `content_clusters` foi cobrado **uma vez**).
5. Chegada: a URL `/b/{slug}/` abre com o post; o HTML tem `<meta name="robots" content="noindex,nofollow">` e `/b/{slug}/sitemap.xml` responde 404.
6. "Publicar o blog" → o `noindex` some do HTML e o sitemap volta.
7. A trilha aparece com "Montar seu blog" riscado e "Publicar seu blog" feito.
8. Abrir o wizard de onboarding legado depois → ele **não** paga os 30 de novo.
9. Conta com produtos do Tiny: a Missão Produto começa listando os produtos sem descrição, e a chegada diz "Publicar no Tiny".
10. Conta sem coorte: nada mudou.

## Auto-revisão

**Cobertura do spec e das pendências do Plano 1:** `indexable`/`noindex` → Task 1; marco no CRM → Task 2; decisão 3 (WhatsApp na espera) → Tasks 3, 4, 5, 7; publicação no ERP → Task 5; caso "conta com catálogo" (lacuna do Plano 1) → Task 5; Missão Conteúdo → Tasks 6, 7; `modules.blog` (e `contentAgent`) → Task 8; trilha → Task 9; o bug de `temProjetoConteudo: hasContentAgent` → Task 8, Step 2; o palco de Conteúdo que terminava cedo demais → Task 6.

**Riscos que continuam:** a produção do artigo roda dentro de uma requisição HTTP longa; se o App Hosting cortar a requisição antes do fim, o pipeline segue no servidor e o listener mostra o desfecho — mas se a instância for derrubada junto, o artigo fica em `em_producao` sem avançar. O "tentar de novo" só aparece para `status: 'erro'`; um artigo travado em `em_producao` exige a tela de Conteúdo existente.

**Consistência de tipos:** `DadosConteudo`/`proximaAcaoConteudo`/`slugCandidatos` (Task 6) usados como definidos na Task 7; `PedidoWhatsApp({ onEnviar })` (Task 4) usado nas Tasks 5 e 7; `enviarContatoMissao` (Task 3) usado na Task 8; `publicarProdutoNoTiny` (Task 5) usado na Task 8; `montarTrilha`/`ItemId` (Task 9) usados só na Task 9; `destino: 'tiny' | 'catalogo' | 'blog'` (Plano 1) cobre os três finais.
