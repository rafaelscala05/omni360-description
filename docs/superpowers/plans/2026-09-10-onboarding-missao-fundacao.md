# Onboarding por Missão — Fundação + Missão Produto (Plano 1 de 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar, para a coorte `missao-v1`, a Tela 0 de escolha por resultado e a Missão Produto completa — do login até um produto aprimorado salvo no catálogo ou publicado no ERP — rodando sobre uma máquina de estados única com dois renderizadores.

**Architecture:** Uma máquina de estados pura e sem I/O (`missionSteps.ts`) declara as duas missões como dados. Dois renderizadores (`MissionChat` no mobile, `MissionSplit` no desktop) leem a mesma máquina; nenhum deles guarda regra de negócio. O estado vive em `users/{uid}/missions/{missionId}`, o que dá retomada entre dispositivos. Um flag `users/{uid}.cohort` é a única porta: quem não é da coorte nova continua no fluxo atual, sem nenhuma alteração de comportamento.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `motion/react`, Firebase (Auth + Firestore, SDK client), Express + `tsx` no servidor. Sem framework de teste — ver Global Constraints.

**Spec:** `docs/superpowers/specs/2026-09-09-onboarding-missao-design.md`

## Global Constraints

- **Não existe framework de teste neste repositório.** CLAUDE.md: "There are no automated tests. The app is validated manually by running the dev server." O padrão de teste do repo é `scripts/verify-*.mjs` — script Node puro rodado com `npx tsx`, com um helper `check(label, actual, expected)` local, sem dependências. **Lógica pura ganha um verify script; componentes React ganham `npm run lint` + validação manual descrita passo a passo.** Não introduza vitest/jest/testing-library.
- Type-check: `npm run lint` (é `tsc --noEmit`). Deve passar limpo ao fim de cada tarefa.
- Dev server: `npm run dev` (Express + Vite na porta 3000). Exige `GEMINI_API_KEY` no `.env`.
- **Idioma: pt-BR em todo texto de UI, nome de campo e comentário.** O app inteiro é pt-BR.
- Cores e tipografia seguem `DESIGN.md`: laranja `#FF5B03` é a **única** cor de ação; ink `#141311`; porcelana `#E8E0D5`; superfície de app `#f7f9fb`. Display `font-display` (Bricolage Grotesque), corpo Inter. Botões `rounded-xl`, cards `rounded-2xl`/`rounded-3xl`.
- **Nada do fluxo legado é removido neste plano.** `OnboardingWizard.tsx`, `src/modules/content/OnboardingWizard.tsx` e `TutorialView.tsx` não são tocados.
- Consentimento de WhatsApp usa `WHATSAPP_CONSENT_TEXT` de `src/types/onboarding.ts` — o texto exato exibido é o que se grava, sem reescrever.
- Commits em pt-BR, prefixo Conventional Commits, e terminando com as linhas de atribuição da sessão.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/onboarding/mission/missionTypes.ts` | Tipos compartilhados da missão. Sem lógica. |
| `src/modules/onboarding/mission/missionSteps.ts` | **Puro, sem I/O.** As duas missões como dados + transições + roteamento sugerido. |
| `src/services/missionService.ts` | Único ponto de acesso ao Firestore para missões. |
| `src/modules/onboarding/mission/Stage.tsx` | O palco: log ao vivo + artefato. Compartilhado pelas duas trilhas e pelos dois renderizadores. |
| `src/modules/onboarding/mission/MissionChat.tsx` | Renderizador mobile (diálogo). |
| `src/modules/onboarding/mission/MissionSplit.tsx` | Renderizador desktop (duas colunas). |
| `src/modules/onboarding/mission/MissionRunner.tsx` | Escolhe o renderizador por viewport e liga estado ↔ serviço. |
| `src/modules/onboarding/mission/MissionPicker.tsx` | Tela 0 — escolha por resultado, duas variantes. |
| `scripts/verify-mission-steps.mjs` | Verificação da lógica pura. |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `src/App.tsx:383-390` | Auto-open do `ProductUrlImportModal` passa a checar a coorte. |
| `src/App.tsx` (estado + render) | Monta o `MissionRunner` para a coorte nova. |
| `src/types/crm.ts:200` | Novos nomes em `CLIENT_EVENT_NAMES`. |
| `src/analytics.ts` | Novos trackers de missão. |
| `firestore.rules:168` | Regra da subcoleção `missions`. |

---

## Task 1: Coorte, e desarmar o auto-open legado

Entrega isolada e reversível: contas novas passam a nascer com `cohort: 'missao-v1'` e **deixam de ver o `ProductUrlImportModal` auto-abrir**. Nada mais muda ainda. Essa é a peça de risco zero do spec — se algo der errado adiante, basta parar de gravar a coorte.

**Files:**
- Create: `src/modules/onboarding/mission/missionTypes.ts`
- Modify: `src/App.tsx` (o `useEffect` de auto-open em `src/App.tsx:383-390`, e onde o doc do usuário é criado)
- Modify: `firestore.rules` (função `isValidUser`, por volta de `firestore.rules:44`)

**Interfaces:**
- Consumes: nada.
- Produces: `MissionCohort`, `COORTE_ATUAL`, `isCoorteMissao(cohort)` — usados por todas as tarefas seguintes.

- [ ] **Step 1: Criar os tipos e o helper de coorte**

Crie `src/modules/onboarding/mission/missionTypes.ts`:

```ts
// Tipos da jornada de missão. Sem lógica e sem I/O — missionSteps.ts (puro) e
// missionService.ts (Firestore) dependem daqui, nunca o contrário.

export type MissionId = 'produto' | 'conteudo';
export type StepId = 'contexto' | 'palco' | 'chegada';

export const STEP_ORDER: readonly StepId[] = ['contexto', 'palco', 'chegada'] as const;

/** Coorte gravada em users/{uid}.cohort na criação da conta. */
export type MissionCohort = 'missao-v1';
export const COORTE_ATUAL: MissionCohort = 'missao-v1';

/** Única porta da jornada nova. Ausência de coorte = fluxo legado. */
export function isCoorteMissao(cohort: unknown): boolean {
  return cohort === COORTE_ATUAL;
}

/** Sinal da conta usado pela Tela 0 para sugerir uma trilha. */
export interface AccountSignal {
  produtos: number;
  erpConectado: boolean;
  temProjetoConteudo: boolean;
}

/** O que a missão produziu — é o que a tela de chegada mostra. */
export interface MissionArtifact {
  tipo: 'produto' | 'blog';
  id: string;
  rotulo: string;
  url?: string;
}

export interface MissionState {
  missionId: MissionId;
  step: StepId;
  /** Payload livre por missão (URL colada, id do produto, config do blog…). */
  dados: Record<string, unknown>;
  iniciadaEm: string;
  concluidaEm?: string;
  abandonadaEm?: string;
  artefato?: MissionArtifact;
}
```

- [ ] **Step 2: Verificar que o type-check passa**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Gravar a coorte na criação do doc do usuário**

Em `src/App.tsx`, ache onde o documento `users/{uid}` é criado no primeiro login (procure por `setDoc` em `users/${user.uid}` — no fluxo de bootstrap de auth, próximo de onde `credits` é inicializado). Adicione `cohort` **apenas na criação**, nunca no update, para não reclassificar contas existentes:

```ts
// Coorte da jornada de onboarding. Gravada só na criação: contas
// existentes seguem sem o campo e permanecem no fluxo legado.
cohort: COORTE_ATUAL,
```

Importe no topo de `src/App.tsx`:

```ts
import { COORTE_ATUAL, isCoorteMissao } from './modules/onboarding/mission/missionTypes';
```

- [ ] **Step 4: Ler a coorte junto com os módulos**

Em `src/App.tsx`, no `onSnapshot` do doc do usuário que já lê `modules?.*` (por volta de `src/App.tsx:465-468`), adicione o estado da coorte. Declare junto dos outros `useState` (por volta de `src/App.tsx:270`):

```ts
const [cohort, setCohort] = useState<string | null>(null);
```

E dentro do snapshot, ao lado das linhas `setHasContentAgent(...)`:

```ts
setCohort(snap.data().cohort ?? null);
```

- [ ] **Step 5: Travar o auto-open do modal legado**

Em `src/App.tsx:383-390`, o efeito auto-abre o `ProductUrlImportModal` quando o catálogo está vazio. Para a coorte nova, a missão é a porta — os dois disparam na mesma condição e não podem coexistir (risco 2 do spec). Troque a guarda:

```ts
  // Auto-abre o wizard de onboarding de primeiro produto uma única vez,
  // quando o dashboard carrega vazio.
  //
  // Não vale para a coorte de missão: lá a Missão Produto é a porta de
  // entrada e chama a mesma extração por dentro. Deixar os dois armados
  // abriria duas janelas concorrentes na mesma condição.
  useEffect(() => {
    if (!isAuthReady || !user || productOnboardingPromptShown || products.length !== 0) return;
    if (isCoorteMissao(cohort)) return;
    handleOpenProductUrlImport();
    setProductOnboardingPromptShown(true);
    updateDoc(doc(db, `users/${user.uid}`), { productOnboarding: { promptShown: true } }).catch((err) =>
      console.error('Erro ao marcar productOnboarding.promptShown:', err),
    );
  }, [isAuthReady, user, productOnboardingPromptShown, products.length, cohort]);
```

Atenção: `cohort` começa `null` e só chega pelo snapshot. Como o efeito também depende de `products.length !== 0` e o snapshot do usuário resolve antes do catálogo carregar na prática, isso é seguro; mas se o modal piscar em teste manual, adicione `if (cohort === null) return;` como primeira linha (aguarda o snapshot resolver).

- [ ] **Step 6: Permitir o campo nas regras do Firestore**

`isValidUser()` em `firestore.rules` enumera os campos aceitos. Sem isso a criação da conta passa a ser **rejeitada**. Adicione a linha dentro da função (por volta de `firestore.rules:44`):

```
             (!('cohort' in data) || data.cohort is string) &&
```

- [ ] **Step 7: Verificar type-check e validar manualmente**

Run: `npm run lint`
Expected: sem erros.

Run: `npm run dev`, e valide:
1. Login com uma conta **existente** que tenha catálogo vazio → o `ProductUrlImportModal` ainda auto-abre (legado intacto).
2. Login com uma conta **nova** → o modal **não** auto-abre; o dashboard fica vazio (é o estado esperado até a Task 8).
3. No console do Firebase, o doc da conta nova tem `cohort: "missao-v1"`.

- [ ] **Step 8: Commit**

```bash
git add src/modules/onboarding/mission/missionTypes.ts src/App.tsx firestore.rules
git commit -m "feat(onboarding): coorte missao-v1 e desarme do auto-open legado

Contas novas nascem com cohort e deixam de ver o ProductUrlImportModal
auto-abrir — os dois disparam na mesma condição (products.length === 0) e
a missao passa a ser a porta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 2: A máquina de estados pura

O coração do spec: **as duas missões são a mesma máquina de três etapas.** Este arquivo não importa React, Firebase nem serviços — é o que torna a lógica verificável e o que impede o onboarding de se dividir em dois.

**Files:**
- Create: `src/modules/onboarding/mission/missionSteps.ts`
- Create: `scripts/verify-mission-steps.mjs`

**Interfaces:**
- Consumes: `MissionId`, `StepId`, `STEP_ORDER`, `MissionState`, `AccountSignal` de `missionTypes.ts`.
- Produces: `MISSOES`, `stepConcluido(state)`, `proximoStep(state)`, `avancar(state)`, `progresso(state)`, `sugerirTrilha(signal)`, `criarEstadoInicial(missionId)`.

- [ ] **Step 1: Escrever o verify script que falha**

Crie `scripts/verify-mission-steps.mjs`. Ele é a especificação executável da máquina:

```js
// Verificação da lógica pura da máquina de missão
// (src/modules/onboarding/mission/missionSteps.ts). Não sobe servidor, não
// toca Firestore e não renderiza React.
// Rodar com: npx tsx scripts/verify-mission-steps.mjs
import {
  MISSOES, avancar, criarEstadoInicial, progresso, proximoStep, stepConcluido, sugerirTrilha,
} from '../src/modules/onboarding/mission/missionSteps.ts';
import { STEP_ORDER } from '../src/modules/onboarding/mission/missionTypes.ts';

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

// --- O invariante central do spec: as duas missões têm as MESMAS três etapas.
for (const id of ['produto', 'conteudo']) {
  check(
    `missão ${id} tem as três etapas canônicas`,
    MISSOES[id].steps.map((s) => s.id),
    [...STEP_ORDER],
  );
}

// --- Transições
const inicial = criarEstadoInicial('produto');
check('estado inicial começa em contexto', inicial.step, 'contexto');
check('estado inicial não está concluído', inicial.concluidaEm, undefined);
check('progresso inicial', progresso(inicial), { indice: 1, total: 3 });

check('contexto sem dados não está concluído', stepConcluido(inicial), false);

const comUrl = { ...inicial, dados: { produtoId: 'p1' } };
check('contexto com produtoId está concluído', stepConcluido(comUrl), true);
check('próximo passo depois de contexto', proximoStep(comUrl), 'palco');
check('avançar move para palco', avancar(comUrl).step, 'palco');
check('avançar não altera o estado original', comUrl.step, 'contexto');

const noPalco = { ...comUrl, step: 'palco' };
check('palco sem geração não está concluído', stepConcluido(noPalco), false);
const palcoPronto = { ...noPalco, dados: { produtoId: 'p1', descricaoGerada: true } };
check('palco com descrição gerada está concluído', stepConcluido(palcoPronto), true);
check('progresso no palco', progresso(palcoPronto), { indice: 2, total: 3 });

const chegada = avancar(palcoPronto);
check('avançar move para chegada', chegada.step, 'chegada');
check('chegada é o último passo', proximoStep(chegada), null);
check('avançar na chegada não sai da chegada', avancar(chegada).step, 'chegada');

// --- Roteamento da Tela 0 (decisão 1 do spec: conta vazia é o caso principal)
check(
  'conta vazia não recebe sugestão e usa a variante vazia',
  sugerirTrilha({ produtos: 0, erpConectado: false, temProjetoConteudo: false }),
  { sugerida: null, variante: 'vazia' },
);
check(
  'ERP conectado sugere produto',
  sugerirTrilha({ produtos: 1243, erpConectado: true, temProjetoConteudo: false }),
  { sugerida: 'produto', variante: 'com-catalogo' },
);
check(
  'catálogo sem ERP também sugere produto',
  sugerirTrilha({ produtos: 12, erpConectado: false, temProjetoConteudo: false }),
  { sugerida: 'produto', variante: 'com-catalogo' },
);
check(
  'quem já tem projeto de conteúdo e nenhum produto é mandado pra produto',
  sugerirTrilha({ produtos: 0, erpConectado: false, temProjetoConteudo: true }),
  { sugerida: 'produto', variante: 'vazia' },
);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsx scripts/verify-mission-steps.mjs`
Expected: FALHA — `Cannot find module '.../missionSteps.ts'`.

- [ ] **Step 3: Implementar a máquina**

Crie `src/modules/onboarding/mission/missionSteps.ts`:

```ts
// Máquina de estados das missões de onboarding. PURO: não importa React,
// Firebase nem serviços — é o que permite verificar a lógica com
// scripts/verify-mission-steps.mjs e o que impede a jornada de se dividir
// em dois fluxos.
//
// As duas missões têm exatamente as mesmas três etapas. Só o conteúdo de
// cada etapa muda. Quebrar esse invariante quebra o verify script.

import {
  STEP_ORDER,
  type AccountSignal, type MissionId, type MissionState, type StepId,
} from './missionTypes';

export interface MissionStepDef {
  id: StepId;
  /** Rótulo mostrado no trilho de progresso. */
  titulo: string;
  /** Como saber que o passo terminou, a partir dos dados acumulados. */
  concluido: (dados: Record<string, unknown>) => boolean;
}

export interface MissionDef {
  id: MissionId;
  /** Texto do cartão da Tela 0 — o resultado, não o nome do agente. */
  resultado: string;
  /** Assinatura de quem executa, em letra pequena. */
  agente: string;
  steps: MissionStepDef[];
}

export const MISSOES: Record<MissionId, MissionDef> = {
  produto: {
    id: 'produto',
    resultado: 'Vender mais com o que já tenho',
    agente: 'Agente de Produto',
    steps: [
      {
        id: 'contexto',
        titulo: 'Contexto',
        // Conta vazia: veio da URL colada. Conta com catálogo: veio da seleção.
        concluido: (d) => typeof d.produtoId === 'string' && d.produtoId.length > 0,
      },
      {
        id: 'palco',
        titulo: 'Palco',
        concluido: (d) => d.descricaoGerada === true,
      },
      {
        id: 'chegada',
        titulo: 'Chegada',
        concluido: (d) => d.publicado === true || d.salvoNoCatalogo === true,
      },
    ],
  },
  conteudo: {
    id: 'conteudo',
    resultado: 'Aparecer no Google e trazer gente nova',
    agente: 'Agente de Conteúdo',
    steps: [
      {
        id: 'contexto',
        titulo: 'Contexto',
        concluido: (d) => d.configConfirmada === true,
      },
      {
        id: 'palco',
        titulo: 'Palco',
        concluido: (d) => typeof d.blogSlug === 'string' && d.blogSlug.length > 0,
      },
      {
        id: 'chegada',
        titulo: 'Chegada',
        concluido: (d) => d.blogPublicado === true || d.previewAberto === true,
      },
    ],
  },
};

export function criarEstadoInicial(missionId: MissionId): MissionState {
  return {
    missionId,
    step: 'contexto',
    dados: {},
    iniciadaEm: new Date().toISOString(),
  };
}

function defDoStep(state: MissionState): MissionStepDef {
  const def = MISSOES[state.missionId].steps.find((s) => s.id === state.step);
  if (!def) throw new Error(`Passo desconhecido: ${state.missionId}/${state.step}`);
  return def;
}

export function stepConcluido(state: MissionState): boolean {
  return defDoStep(state).concluido(state.dados);
}

export function proximoStep(state: MissionState): StepId | null {
  const i = STEP_ORDER.indexOf(state.step);
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null;
}

/** Imutável: devolve um novo estado, nunca muta o recebido. */
export function avancar(state: MissionState): MissionState {
  const proximo = proximoStep(state);
  return proximo ? { ...state, step: proximo } : state;
}

export function progresso(state: MissionState): { indice: number; total: number } {
  return { indice: STEP_ORDER.indexOf(state.step) + 1, total: STEP_ORDER.length };
}

export interface SugestaoTrilha {
  sugerida: MissionId | null;
  variante: 'vazia' | 'com-catalogo';
}

/**
 * Decisão 1 do spec: a variante principal é a de conta vazia. Sem catálogo e
 * sem ERP, nenhum cartão vem pré-selecionado e a trilha de Produto começa
 * pedindo a URL de um produto.
 *
 * Ter projeto de conteúdo não sugere a trilha de Conteúdo: quem já tem projeto
 * já passou por ali, e o que falta é o produto.
 */
export function sugerirTrilha(signal: AccountSignal): SugestaoTrilha {
  const temCatalogo = signal.produtos > 0 || signal.erpConectado;
  if (temCatalogo) return { sugerida: 'produto', variante: 'com-catalogo' };
  if (signal.temProjetoConteudo) return { sugerida: 'produto', variante: 'vazia' };
  return { sugerida: null, variante: 'vazia' };
}
```

- [ ] **Step 4: Rodar o verify e confirmar que passa**

Run: `npx tsx scripts/verify-mission-steps.mjs`
Expected: todas as linhas `ok`, e `Tudo ok.` no fim (exit 0).

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/modules/onboarding/mission/missionSteps.ts scripts/verify-mission-steps.mjs
git commit -m "feat(onboarding): máquina de estados pura das missões

As duas missões compartilham as mesmas três etapas (contexto, palco,
chegada) — o verify script trava esse invariante, que é o que impede a
jornada de virar dois fluxos de novo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 3: Persistência e retomada entre dispositivos

**Files:**
- Create: `src/services/missionService.ts`
- Modify: `firestore.rules` (dentro do bloco `match /users/{userId}`, por volta de `firestore.rules:212`, junto de `settings`)

**Interfaces:**
- Consumes: `MissionState`, `MissionId`, `MissionArtifact` de `missionTypes.ts`; `criarEstadoInicial` de `missionSteps.ts`.
- Produces: `carregarMissao(uid, missionId)`, `salvarMissao(uid, state)`, `ouvirMissoes(uid, cb)`, `iniciarMissao(uid, missionId)`, `concluirMissao(uid, state, artefato)`.

- [ ] **Step 1: Abrir a subcoleção nas regras**

Em `firestore.rules`, dentro de `match /users/{userId}`, ao lado do bloco `match /settings/{settingId}`, adicione:

```
      // Estado das missões de onboarding. O dono lê e escreve: a missão roda
      // no cliente (como o resto da geração do app) e o que ela guarda é
      // progresso, não autorização. É o que dá retomada entre dispositivos.
      match /missions/{missionId} {
        allow read, write: if isOwner(userId);
      }
```

- [ ] **Step 2: Implementar o serviço**

Crie `src/services/missionService.ts`. Único ponto de acesso ao Firestore para missões — nenhum componente fala com o Firestore direto:

```ts
// Persistência do estado das missões de onboarding.
// users/{uid}/missions/{missionId} — um doc por missão.

import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { criarEstadoInicial } from '../modules/onboarding/mission/missionSteps';
import type { MissionArtifact, MissionId, MissionState } from '../modules/onboarding/mission/missionTypes';

const ref = (uid: string, missionId: MissionId) => doc(db, `users/${uid}/missions/${missionId}`);

export async function carregarMissao(uid: string, missionId: MissionId): Promise<MissionState | null> {
  const snap = await getDoc(ref(uid, missionId));
  return snap.exists() ? (snap.data() as MissionState) : null;
}

export async function salvarMissao(uid: string, state: MissionState): Promise<void> {
  await setDoc(ref(uid, state.missionId), state, { merge: true });
}

/**
 * Retoma a missão se já existir — é o que faz "começa no celular, termina no
 * desktop" funcionar. Só cria estado novo quando não há nada gravado.
 */
export async function iniciarMissao(uid: string, missionId: MissionId): Promise<MissionState> {
  const existente = await carregarMissao(uid, missionId);
  if (existente && !existente.concluidaEm) return existente;
  const novo = criarEstadoInicial(missionId);
  await salvarMissao(uid, novo);
  return novo;
}

export async function concluirMissao(
  uid: string, state: MissionState, artefato: MissionArtifact,
): Promise<MissionState> {
  const concluida: MissionState = { ...state, artefato, concluidaEm: new Date().toISOString() };
  await salvarMissao(uid, concluida);
  return concluida;
}

/** Usado pela trilha do dia 2 (Plano 2) para saber o que já foi feito. */
export function ouvirMissoes(uid: string, cb: (missoes: MissionState[]) => void): () => void {
  return onSnapshot(collection(db, `users/${uid}/missions`), (snap) => {
    cb(snap.docs.map((d) => d.data() as MissionState));
  });
}
```

- [ ] **Step 3: Verificar type-check**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/services/missionService.ts firestore.rules
git commit -m "feat(onboarding): persistência das missões em users/{uid}/missions

Retomada entre dispositivos: iniciarMissao devolve a missão em andamento
em vez de recomeçar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 4: Eventos de missão

Sem isto não há como medir nada do spec, e o abandono continua sendo "não terminou o onboarding" em vez de dizer **em qual etapa** parou.

**Files:**
- Modify: `src/types/crm.ts:200-216` (`CLIENT_EVENT_NAMES`)
- Modify: `src/analytics.ts` (novos trackers, ao lado de `trackProductUrlImportStarted`, `src/analytics.ts:178`)

**Interfaces:**
- Consumes: `MissionId`, `StepId`.
- Produces: `trackMissionStarted`, `trackMissionStepCompleted`, `trackMissionCompleted`, `trackMissionArtifactPublished`.

- [ ] **Step 1: Adicionar os nomes à allowlist**

`server/crmEvents.ts:79` descarta em silêncio qualquer evento fora de `CLIENT_EVENT_NAMES`. Em `src/types/crm.ts`, adicione ao final do array, antes do `] as const;`:

```ts
  'mission_started',
  'mission_step_completed',
  'mission_completed',
  'mission_artifact_published',
```

- [ ] **Step 2: Adicionar os trackers**

Em `src/analytics.ts`, seguindo exatamente o padrão de `trackProductUrlImportResult` (`src/analytics.ts:184`):

```ts
export function trackMissionStarted(params: {
  missionId: MissionId; sugerida: MissionId | null; aceitouSugestao: boolean;
}) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'mission_started', params);
  crmTrack('mission_started', params);
}

export function trackMissionStepCompleted(params: { missionId: MissionId; step: StepId }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'mission_step_completed', params);
  crmTrack('mission_step_completed', params);
}

export function trackMissionCompleted(params: { missionId: MissionId }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'mission_completed', params);
  crmTrack('mission_completed', params);
}

export function trackMissionArtifactPublished(params: {
  missionId: MissionId; destino: 'tiny' | 'catalogo' | 'blog';
}) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'mission_artifact_published', params);
  crmTrack('mission_artifact_published', params);
}
```

E no topo do arquivo:

```ts
import type { MissionId, StepId } from './modules/onboarding/mission/missionTypes';
```

Nota: `destino` inclui `'catalogo'` porque, no caso principal (sem ERP), a chegada da Missão Produto salva no catálogo — ver Task 8.

- [ ] **Step 3: Verificar type-check**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/types/crm.ts src/analytics.ts
git commit -m "feat(onboarding): eventos de missão no beacon do CRM

O abandono passa a dizer em qual etapa parou, em vez de só 'não terminou'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 5: O palco

**Um componente, compartilhado pelas duas trilhas e pelos dois renderizadores.** Se cada trilha ganhar o seu, a jornada volta a ser dois onboardings — é o risco 1 do spec.

**Files:**
- Create: `src/modules/onboarding/mission/Stage.tsx`

**Interfaces:**
- Consumes: nada além de props.
- Produces: `Stage`, `StageLogLine`, `StageProps`.

- [ ] **Step 1: Implementar o palco**

Crie `src/modules/onboarding/mission/Stage.tsx`:

```tsx
// O palco: mostra o que o agente está lendo e o artefato se materializando.
//
// Um componente só, usado pelas duas missões e pelos dois renderizadores.
// No desktop ocupa a coluna direita; no mobile é um cartão dentro da conversa.
// Cada linha do log corresponde a uma leitura que o agente de fato fez — não
// é enfeite, é o que faz a espera valer a pena.

import React from 'react';

export interface StageLogLine {
  /** 'feito' já aconteceu; 'agora' é a linha em andamento. */
  estado: 'feito' | 'agora';
  texto: string;
  /** Trecho em destaque dentro da linha (o número, o nome do arquivo). */
  destaque?: string;
}

export interface StageProps {
  titulo: string;
  linhas: StageLogLine[];
  /** Conteúdo materializando — a descrição sendo escrita, o preview do blog. */
  children?: React.ReactNode;
}

const Stage: React.FC<StageProps> = ({ titulo, linhas, children }) => (
  <div className="flex flex-col gap-3">
    <div className="bg-[#141311] text-[#E8E0D5] rounded-2xl p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#E8E0D5]/50">
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5B03] animate-pulse motion-reduce:animate-none" />
        {titulo}
      </div>
      <div className="font-mono text-[11px] leading-relaxed flex flex-col">
        {linhas.map((l, i) => (
          <span key={i} className={l.estado === 'agora' ? 'text-[#E8E0D5]' : 'text-[#E8E0D5]/60'}>
            {l.estado === 'feito' ? <span className="text-[#FF5B03]">✓ </span> : '→ '}
            {l.destaque ? (
              <>
                <span className="text-[#E8E0D5] font-medium">{l.destaque}</span> {l.texto}
              </>
            ) : (
              l.texto
            )}
          </span>
        ))}
      </div>
    </div>
    {children}
  </div>
);

export default Stage;
```

- [ ] **Step 2: Verificar type-check**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/onboarding/mission/Stage.tsx
git commit -m "feat(onboarding): palco compartilhado das missões

Um componente para as duas trilhas e os dois renderizadores.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 6: Os dois renderizadores

**Files:**
- Create: `src/modules/onboarding/mission/MissionChat.tsx`
- Create: `src/modules/onboarding/mission/MissionSplit.tsx`
- Create: `src/modules/onboarding/mission/MissionRunner.tsx`

**Interfaces:**
- Consumes: `Stage`/`StageLogLine` (Task 5); `MissionState` (Task 1); `MISSOES`, `progresso` (Task 2); `salvarMissao` (Task 3).
- Produces: `MissionRunner` com props `{ uid, state, onState, turnos, palco, acoes }`; o tipo `Turno`.

- [ ] **Step 1: Definir o turno e o renderizador mobile**

O `Turno` é o que os dois renderizadores desenham — nenhum dos dois sabe qual missão está rodando. Crie `src/modules/onboarding/mission/MissionChat.tsx`:

```tsx
// Renderizador mobile: diálogo empilhado, o palco como cartão inline.
// Não guarda regra de negócio — desenha os turnos que a missão entrega.

import React from 'react';
import Stage, { type StageProps } from './Stage';

export interface Turno {
  autor: 'agente' | 'usuario';
  texto: React.ReactNode;
}

export interface Acao {
  rotulo: string;
  onClick: () => void;
  variante?: 'primaria' | 'secundaria';
}

export interface RendererProps {
  titulo: string;
  passo: { indice: number; total: number; titulo: string };
  turnos: Turno[];
  palco?: StageProps;
  acoes: Acao[];
}

export const Trilho: React.FC<{ indice: number; total: number; titulo: string }> = ({ indice, total, titulo }) => (
  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
    <span>Etapa <b className="text-[#FF5B03]">{indice}</b> de {total}</span>
    <span className="flex-1 h-[3px] rounded-full bg-slate-200 overflow-hidden">
      <i className="block h-full bg-[#FF5B03]" style={{ width: `${(indice / total) * 100}%` }} />
    </span>
    <span>{titulo}</span>
  </div>
);

export const Botoes: React.FC<{ acoes: Acao[] }> = ({ acoes }) => (
  <div className="flex flex-col gap-2">
    {acoes.map((a) => (
      <button
        key={a.rotulo}
        type="button"
        onClick={a.onClick}
        className={
          a.variante === 'secundaria'
            ? 'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 min-h-[44px]'
            : 'w-full rounded-xl bg-[#FF5B03] px-4 py-2.5 text-sm font-semibold text-white min-h-[44px]'
        }
      >
        {a.rotulo}
      </button>
    ))}
  </div>
);

const MissionChat: React.FC<RendererProps> = ({ passo, turnos, palco, acoes }) => (
  <div className="flex flex-col gap-3 p-4 pb-24">
    <Trilho {...passo} />
    <div className="flex flex-col gap-2">
      {turnos.map((t, i) => (
        <div
          key={i}
          className={
            t.autor === 'agente'
              ? 'self-start max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm'
              : 'self-end max-w-[88%] rounded-2xl rounded-br-md bg-[#141311] px-3 py-2 text-sm text-[#E8E0D5]'
          }
        >
          {t.texto}
        </div>
      ))}
    </div>
    {palco && <Stage {...palco} />}
    <Botoes acoes={acoes} />
  </div>
);

export default MissionChat;
```

- [ ] **Step 2: Renderizador desktop**

Crie `src/modules/onboarding/mission/MissionSplit.tsx` — **mesmo contrato `RendererProps`**, layout diferente:

```tsx
// Renderizador desktop: conversa à esquerda, palco à direita.
// Mesmo contrato do MissionChat — a missão não sabe qual dos dois está ativo.

import React from 'react';
import Stage from './Stage';
import { Botoes, Trilho, type RendererProps } from './MissionChat';

const MissionSplit: React.FC<RendererProps> = ({ titulo, passo, turnos, palco, acoes }) => (
  <div className="grid grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] min-h-[520px] rounded-2xl overflow-hidden border border-slate-200 bg-white">
    <div className="flex flex-col gap-3 border-r border-slate-200 p-5">
      <Trilho {...passo} />
      <h2 className="font-display text-xl font-extrabold tracking-tight">{titulo}</h2>
      <div className="flex flex-col gap-2 flex-1">
        {turnos.map((t, i) => (
          <div
            key={i}
            className={
              t.autor === 'agente'
                ? 'self-start max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm'
                : 'self-end max-w-[88%] rounded-2xl rounded-br-md bg-[#141311] px-3 py-2 text-sm text-[#E8E0D5]'
            }
          >
            {t.texto}
          </div>
        ))}
      </div>
      <Botoes acoes={acoes} />
    </div>
    <div className="flex flex-col gap-3 bg-[#f7f9fb] p-5">
      {palco && <Stage {...palco} />}
    </div>
  </div>
);

export default MissionSplit;
```

- [ ] **Step 3: O seletor por viewport**

Crie `src/modules/onboarding/mission/MissionRunner.tsx`. A escolha é **por largura, não por user-agent**, e trocável em runtime — redimensionar a janela não pode perder estado, e por isso o estado vive fora dos dois:

```tsx
// Escolhe o renderizador pela largura da viewport. O estado da missão vive
// acima dos dois, então redimensionar a janela troca o layout sem perder nada.

import React, { useEffect, useState } from 'react';
import MissionChat, { type RendererProps } from './MissionChat';
import MissionSplit from './MissionSplit';

const BREAKPOINT = 768;

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= BREAKPOINT : true,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${BREAKPOINT}px)`);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

const MissionRunner: React.FC<RendererProps> = (props) => {
  const desktop = useIsDesktop();
  return desktop ? <MissionSplit {...props} /> : <MissionChat {...props} />;
};

export default MissionRunner;
```

- [ ] **Step 4: Verificar type-check**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/modules/onboarding/mission/MissionChat.tsx src/modules/onboarding/mission/MissionSplit.tsx src/modules/onboarding/mission/MissionRunner.tsx
git commit -m "feat(onboarding): dois renderizadores da mesma máquina de missão

Diálogo no celular, painel de duas colunas no desktop, mesmo contrato de
props. A escolha é por largura de viewport e o estado vive acima dos dois,
então redimensionar não perde progresso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 7: Tela 0 — escolha por resultado

**Files:**
- Create: `src/modules/onboarding/mission/MissionPicker.tsx`

**Interfaces:**
- Consumes: `MISSOES`, `sugerirTrilha` (Task 2); `AccountSignal`, `MissionId` (Task 1); `trackMissionStarted` (Task 4).
- Produces: `MissionPicker` com props `{ signal, onEscolher }`.

- [ ] **Step 1: Implementar as duas variantes**

Crie `src/modules/onboarding/mission/MissionPicker.tsx`. **A variante principal é a de conta vazia** (decisão 1 do spec) — sem números inventados quando não há catálogo:

```tsx
// Tela 0: a pergunta é "o que você quer resolver", não "qual agente".
//
// Duas variantes honestas. Conta vazia (caso principal): nada
// pré-selecionado e nenhum número. Conta com catálogo: Produto vem marcado
// com a contagem real.

import React, { useState } from 'react';
import { MISSOES, sugerirTrilha } from './missionSteps';
import type { AccountSignal, MissionId } from './missionTypes';
import { trackMissionStarted } from '../../../analytics';

interface Props {
  signal: AccountSignal;
  semDescricao: number;
  onEscolher: (missionId: MissionId) => void;
}

const MissionPicker: React.FC<Props> = ({ signal, semDescricao, onEscolher }) => {
  const { sugerida, variante } = sugerirTrilha(signal);
  const [escolhida, setEscolhida] = useState<MissionId | null>(sugerida);

  const dadoProduto =
    variante === 'com-catalogo'
      ? `${signal.produtos} produtos · ${semDescricao} sem descrição`
      : 'comece colando o link de um produto';
  const dadoConteudo =
    signal.temProjetoConteudo ? 'você já tem um projeto de conteúdo' : 'seu site ainda não tem blog';

  const cartao = (id: MissionId, dado: string) => {
    const def = MISSOES[id];
    const ativo = escolhida === id;
    const escuro = id === 'conteudo';
    return (
      <button
        key={id}
        type="button"
        onClick={() => setEscolhida(id)}
        aria-pressed={ativo}
        className={[
          'relative w-full text-left rounded-2xl border p-4 flex flex-col gap-1.5 transition',
          escuro ? 'bg-[#141311] text-[#E8E0D5] border-[#141311]' : 'bg-white border-slate-200',
          ativo ? 'ring-2 ring-[#FF5B03] border-[#FF5B03]' : '',
        ].join(' ')}
      >
        {ativo && sugerida === id && (
          <span className="absolute -top-2.5 left-4 rounded-full bg-[#FF5B03] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Sugerido pra você
          </span>
        )}
        <span className="font-display text-base font-bold leading-tight">{def.resultado}</span>
        <span className={escuro ? 'text-xs text-[#E8E0D5]/60' : 'text-xs text-slate-500'}>{dado}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF5B03]">{def.agente}</span>
      </button>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          O que você quer resolver primeiro?
        </h1>
        <p className="mt-1 text-sm text-slate-500">Dá pra fazer os dois. Comece pelo que aperta mais.</p>
      </div>
      <div className="flex flex-col gap-3">
        {cartao('produto', dadoProduto)}
        {cartao('conteudo', dadoConteudo)}
      </div>
      <button
        type="button"
        disabled={!escolhida}
        onClick={() => {
          if (!escolhida) return;
          trackMissionStarted({
            missionId: escolhida,
            sugerida,
            aceitouSugestao: escolhida === sugerida,
          });
          onEscolher(escolhida);
        }}
        className="w-full min-h-[44px] rounded-xl bg-[#FF5B03] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Começar
      </button>
      <p className="text-center text-[11px] text-slate-400">
        Uns 4 minutos. Pode parar e voltar depois.
      </p>
    </div>
  );
};

export default MissionPicker;
```

- [ ] **Step 2: Verificar type-check**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/onboarding/mission/MissionPicker.tsx
git commit -m "feat(onboarding): Tela 0 de escolha por resultado

Variante principal é a de conta vazia — sem número inventado quando não há
catálogo. Com catálogo, Produto vem pré-selecionado com a contagem real.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Task 8: Missão Produto ponta a ponta

A tarefa que amarra tudo. **Reaproveita integralmente a extração do `ProductUrlImportModal`** — parser determinístico antes do Gemini, fallback manual, e Imagem + Título + Categoria obrigatórios (decisões do spec `2026-08-18` que **não** foram revertidas).

**Files:**
- Create: `src/modules/onboarding/mission/MissaoProduto.tsx`
- Create: `src/components/onboarding/buildProduct.ts` (extração — ver Step 1)
- Modify: `src/components/onboarding/ProductUrlImportModal.tsx:51-67` (passa a importar o extraído)
- Modify: `src/App.tsx` (montar a jornada para a coorte nova)

**Interfaces:**
- Consumes: tudo das tarefas 1–7; `scrapeProductUrl(url): Promise<{ product: ScrapedProductFields; source: 'structured'|'hybrid'|'ai'|'failed' }>` de `src/services/productImportService.ts`; `ProductFormValue` de `src/components/onboarding/ProductFormFields.tsx`; e os handlers **já existentes** em `App.tsx`: `handleProductCreatedFromOnboarding(product: Product): void` (`src/App.tsx:2312`), `handleGenerateDescriptionForOnboarding(id: string): Promise<void>`, `handleSuggestAttributesForOnboarding(id: string): Promise<boolean>`, `handleCreateCategoryForOnboarding(name: string): Promise<string | null>`.
- Produces: `buildProduct(form, categories): Product`; `MissaoProduto`.

**Atenção — dois fatos verificados no código, contra o que seria a suposição natural:**

1. `scrapeProductUrl` **não devolve um `Product`**. Devolve `ScrapedProductFields`
   (`{ title?, description?, price?, imageUrl?, brand?, category? }`) — campos soltos, sem
   `_id` e sem as chaves de planilha. Quem transforma isso num `Product` é `buildProduct`.
2. `buildProduct` hoje é uma função **privada** de `ProductUrlImportModal.tsx:51`. A missão
   precisa exatamente dela; duplicá-la faria os dois caminhos divergirem no primeiro ajuste.
   Por isso o Step 1 extrai antes de usar.

- [ ] **Step 1: Extrair `buildProduct` para uso compartilhado**

Crie `src/components/onboarding/buildProduct.ts` com o corpo **idêntico** ao de
`ProductUrlImportModal.tsx:51-67` (não reescreva os valores — qualquer mudança aqui muda o
formato do produto criado pelo fluxo que já está em produção):

```ts
// Converte o formulário de cadastro em um Product do app.
// Extraído de ProductUrlImportModal para ser compartilhado com a Missão
// Produto — os dois caminhos precisam produzir exatamente o mesmo formato.

import type { Category, Product } from '../../types/models';
import type { ProductFormValue } from './ProductFormFields';

export function buildProduct(form: ProductFormValue, categories: Category[]): Product {
  const category = categories.find((c) => c.id === form.categoryId);
  return {
    _id: `prod_url_${Date.now()}`,
    _statusDescricao: 'Sem descrição',
    _statusSEO: 'Sem SEO',
    _isDirty: true,
    _selectedImage: form.imageUrl,
    'Descrição': form.title,
    'Descrição complementar': form.description || undefined,
    'Categoria': category?.path.join(' > '),
    categoryId: form.categoryId || undefined,
    categoryPath: category?.path,
    'Preço': form.price || undefined,
    'URL imagem externa 1': form.imageUrl,
  };
}
```

Em `src/components/onboarding/ProductUrlImportModal.tsx`, apague a função local
(linhas 51-67) e importe:

```ts
import { buildProduct } from './buildProduct';
```

Run: `npm run lint`
Expected: sem erros. O modal legado continua funcionando idêntico — só mudou de onde a função vem.

- [ ] **Step 2: Implementar a missão**

Crie `src/modules/onboarding/mission/MissaoProduto.tsx`. Ele traduz o estado da máquina em `RendererProps` — **toda a regra fica aqui, nenhuma nos renderizadores**:

```tsx
// Missão Produto: URL → descrição gerada → antes/depois → catálogo ou ERP.
//
// Caso principal é a conta vazia: a etapa de contexto pede a URL de um
// produto e usa a mesma extração do ProductUrlImportModal. Conta com
// catálogo cai no caso secundário e escolhe um produto sem descrição.

import React, { useMemo, useState } from 'react';
import MissionRunner from './MissionRunner';
import type { Acao, Turno } from './MissionChat';
import type { StageLogLine } from './Stage';
import { MISSOES, avancar, progresso } from './missionSteps';
import type { MissionState } from './missionTypes';
import type { Category, Product } from '../../../types/models';
import { scrapeProductUrl } from '../../../services/productImportService';
import { buildProduct } from '../../../components/onboarding/buildProduct';
import type { ProductFormValue } from '../../../components/onboarding/ProductFormFields';
import {
  trackMissionArtifactPublished, trackMissionCompleted, trackMissionStepCompleted,
} from '../../../analytics';

interface Props {
  uid: string;
  state: MissionState;
  onState: (s: MissionState) => void;
  produtos: Product[];
  categorias: Category[];
  temErp: boolean;
  /** handleProductCreatedFromOnboarding (src/App.tsx:2312) */
  onProdutoCriado: (p: Product) => void;
  /** handleGenerateDescriptionForOnboarding */
  onGerarDescricao: (id: string) => Promise<void>;
  /** saveToCloud(true) — persiste o catálogo já com o produto novo */
  onSalvarNoCatalogo: () => Promise<void>;
  onPublicarNoErp: (id: string) => Promise<void>;
  onConcluir: () => void;
}

const MissaoProduto: React.FC<Props> = ({
  state, onState, produtos, categorias, temErp,
  onProdutoCriado, onGerarDescricao, onSalvarNoCatalogo, onPublicarNoErp, onConcluir,
}) => {
  const [url, setUrl] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [log, setLog] = useState<StageLogLine[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const passo = { ...progresso(state), titulo: MISSOES.produto.steps.find((s) => s.id === state.step)!.titulo };
  const produto = useMemo(
    () => produtos.find((p) => p._id === state.dados.produtoId) ?? null,
    [produtos, state.dados.produtoId],
  );

  // Avança um passo, registrando a conclusão do anterior.
  const avancarPasso = (dados: Record<string, unknown>) => {
    const atualizado = { ...state, dados: { ...state.dados, ...dados } };
    trackMissionStepCompleted({ missionId: 'produto', step: state.step });
    onState(avancar(atualizado));
  };

  const turnos: Turno[] = [];
  const acoes: Acao[] = [];
  let palco: { titulo: string; linhas: StageLogLine[]; children?: React.ReactNode } | undefined;

  if (state.step === 'contexto') {
    turnos.push({
      autor: 'agente',
      texto: 'Me manda o link de um produto seu — pode ser do seu site ou de um anúncio. Eu leio a página e trago título, foto e ficha técnica.',
    });
    turnos.push({
      autor: 'agente',
      texto: (
        <input
          id="missao-produto-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="cole o link aqui"
          className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 font-mono text-xs"
        />
      ),
    });
    if (erro) turnos.push({ autor: 'agente', texto: erro });
    acoes.push({
      rotulo: ocupado ? 'Lendo a página…' : 'Ler esse produto',
      onClick: async () => {
        setErro(null);
        setOcupado(true);
        setLog([{ estado: 'agora', texto: 'abrindo a página…' }]);
        try {
          const r = await scrapeProductUrl(url);
          setLog([
            { estado: 'feito', texto: 'página lida', destaque: new URL(url).hostname },
            { estado: 'feito', texto: `dados extraídos (${r.source})` },
          ]);
          // r.product é ScrapedProductFields (campos soltos), não um Product.
          // buildProduct faz a conversão — o mesmo caminho do modal legado.
          const form: ProductFormValue = {
            title: r.product.title ?? '',
            categoryId: '',
            imageUrl: r.product.imageUrl ?? '',
            price: r.product.price != null ? String(r.product.price) : '',
            description: r.product.description ?? '',
          };
          // Imagem + Título + Categoria são obrigatórios (spec 2026-08-18) e a
          // categoria não vem do scrape, então o usuário confirma antes de seguir.
          if (!form.title || !form.imageUrl) {
            setErro('Consegui abrir a página, mas faltou foto ou título. Quer preencher na mão?');
            return;
          }
          const criado = buildProduct(form, categorias);
          onProdutoCriado(criado);
          avancarPasso({ produtoId: criado._id, origem: 'url' });
        } catch {
          // Nunca é dead-end: cai no manual, como decidido no spec 2026-08-18.
          setErro('Não consegui ler essa página. Quer cadastrar na mão? Preciso de foto, título e categoria.');
        } finally {
          setOcupado(false);
        }
      },
    });
  }

  if (state.step === 'palco') {
    turnos.push({ autor: 'agente', texto: `Escrevendo a descrição de ${produto?.['Descrição'] ?? 'seu produto'}.` });
    palco = { titulo: 'Agente de Produto trabalhando', linhas: log };
    acoes.push({
      rotulo: ocupado ? 'Escrevendo…' : 'Gerar a descrição',
      onClick: async () => {
        if (!produto?._id) return;
        setOcupado(true);
        setLog([
          { estado: 'feito', texto: 'ficha técnica extraída das fotos' },
          { estado: 'agora', texto: 'escrevendo a descrição…' },
        ]);
        try {
          await onGerarDescricao(produto._id);
          setLog((l) => [...l.slice(0, -1), { estado: 'feito', texto: 'descrição escrita' }]);
          avancarPasso({ descricaoGerada: true });
        } finally {
          setOcupado(false);
        }
      },
    });
  }

  if (state.step === 'chegada') {
    turnos.push({ autor: 'agente', texto: 'Pronto. Olha o antes e o depois:' });
    palco = {
      titulo: 'Resultado',
      linhas: [{ estado: 'feito', texto: 'descrição, título de SEO e atributos gerados' }],
      children: (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider">Antes</span>
            — sem descrição —
          </div>
          <div className="rounded-xl border-2 border-[#FF5B03] bg-white p-3 text-xs">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-[#FF5B03]">Depois</span>
            {String(produto?.['Descrição complementar'] ?? '').slice(0, 220)}…
          </div>
        </div>
      ),
    };
    // Sem ERP (caso principal) a chegada nunca depende de uma integração
    // que a conta não tem.
    acoes.push({
      rotulo: temErp ? 'Publicar no Tiny' : 'Salvar no meu catálogo',
      onClick: async () => {
        if (!produto?._id) return;
        setOcupado(true);
        try {
          if (temErp) await onPublicarNoErp(produto._id);
          else await onSalvarNoCatalogo();
          trackMissionArtifactPublished({ missionId: 'produto', destino: temErp ? 'tiny' : 'catalogo' });
          trackMissionCompleted({ missionId: 'produto' });
          onState({
            ...state,
            dados: { ...state.dados, [temErp ? 'publicado' : 'salvoNoCatalogo']: true },
            artefato: { tipo: 'produto', id: produto._id, rotulo: String(produto['Descrição'] ?? 'Produto') },
            concluidaEm: new Date().toISOString(),
          });
          onConcluir();
        } finally {
          setOcupado(false);
        }
      },
    });
    acoes.push({ rotulo: 'Quero ajustar antes', variante: 'secundaria', onClick: onConcluir });
  }

  return <MissionRunner titulo="Seu primeiro produto aprimorado" passo={passo} turnos={turnos} palco={palco} acoes={acoes} />;
};

export default MissaoProduto;
```

**Nota de integração:** confirme a forma real do retorno de `scrapeProductUrl` em `src/services/productImportService.ts` (o tipo é `ScrapeProductUrlResult`) e ajuste `r.product` / `r.source` para os nomes reais dos campos antes de rodar. `onSalvarNoCatalogo` deve reusar o mesmo caminho de criação que `onProductCreated` já usa no modal legado.

- [ ] **Step 3: Montar a jornada em App.tsx para a coorte nova**

Em `src/App.tsx`, depois do bloco `if (user && workspace === 'content')` (por volta de `src/App.tsx:3071`), adicione a porta da jornada nova. Declare o estado junto dos outros:

```ts
const [missao, setMissao] = useState<MissionState | null>(null);
const [missaoEscolhida, setMissaoEscolhida] = useState<MissionId | null>(null);
```

E o bloco de render:

```tsx
  // Jornada de missão — só para a coorte nova, e só enquanto não concluída.
  if (user && isCoorteMissao(cohort) && !missao?.concluidaEm) {
    const signal = {
      produtos: products.length,
      erpConectado: products.some((p) => p._tinyProductId || p._blingProductId || p._idworksProductId),
      temProjetoConteudo: hasContentAgent,
    };
    if (!missaoEscolhida) {
      return (
        <MissionPicker
          signal={signal}
          semDescricao={products.filter((p) => !p['Descrição complementar']).length}
          onEscolher={async (id) => {
            setMissaoEscolhida(id);
            setMissao(await iniciarMissao(user.uid, id));
          }}
        />
      );
    }
    if (missaoEscolhida === 'produto' && missao) {
      return (
        <MissaoProduto
          uid={user.uid}
          state={missao}
          onState={(s) => { setMissao(s); void salvarMissao(user.uid, s); }}
          produtos={products}
          categorias={existingCategories}
          temErp={signal.erpConectado}
          onProdutoCriado={handleProductCreatedFromOnboarding}
          onGerarDescricao={handleGenerateDescriptionForOnboarding}
          onSalvarNoCatalogo={() => saveToCloud(true)}
          onPublicarNoErp={async (id) => { void id; /* push de ERP: Plano 2 */ }}
          onConcluir={() => setMissao((m) => (m ? { ...m, concluidaEm: new Date().toISOString() } : m))}
        />
      );
    }
    // Missão Conteúdo chega no Plano 2 — por ora volta pra escolha.
    setMissaoEscolhida(null);
  }
```

Os nomes acima são os reais, conferidos em `src/App.tsx:2312` e no bloco que monta o
`ProductUrlImportModal` (`src/App.tsx:4956-4971`). `onPublicarNoErp` fica como no-op neste
plano: o push para o ERP só é alcançável por contas que já têm ERP conectado — que é o caso
secundário — e entra no Plano 2 junto com a publicação do blog.

- [ ] **Step 4: Verificar type-check**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Validar manualmente ponta a ponta**

Run: `npm run dev`

Com uma conta nova (coorte `missao-v1`), no navegador em ~375px de largura:
1. Aparece a Tela 0, **sem** cartão pré-selecionado e sem números (variante vazia). O botão "Começar" começa desabilitado.
2. Escolher "Vender mais com o que já tenho" → etapa 1 de 3, pedindo o link.
3. Colar a URL de um produto real → o palco mostra as linhas de leitura, e a missão avança para a etapa 2.
4. Gerar a descrição → o log completa e avança para a etapa 3.
5. A chegada mostra antes/depois e o botão diz **"Salvar no meu catálogo"** (conta sem ERP).
6. **Retomada:** recarregar a página no meio da etapa 2 volta na etapa 2, não no começo.
7. **Troca de layout:** alargar a janela para >768px troca para as duas colunas **sem perder o progresso**.
8. No Firestore, `users/{uid}/missions/produto` reflete o passo atual.
9. Em `/admin`, os eventos `mission_started` e `mission_step_completed` aparecem na jornada do usuário.

Com uma conta **existente** (sem coorte): nada mudou — o `ProductUrlImportModal` auto-abre como antes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/onboarding/mission/MissaoProduto.tsx src/components/onboarding/buildProduct.ts src/components/onboarding/ProductUrlImportModal.tsx src/App.tsx
git commit -m "feat(onboarding): Missão Produto ponta a ponta

Do link colado até o produto salvo no catálogo ou publicado no ERP,
reaproveitando a extração do fluxo de import por URL. A chegada nunca
depende de uma integração que a conta não tem.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0145emgyx4jy8XzpsXzdVDnK"
```

---

## Fica para o Plano 2

- `indexable` em `BlogSettings` + `noindex` no `renderDocument` (`server/blog/shell.ts:114`) e 404 em sitemap/feed (`server/blogPublic.ts:236,249`), com **default `true` na ausência do campo** para não desindexar blogs existentes.
- Missão Conteúdo (contexto via `scanWebsite`, palco montando clusters + blog, chegada com o preview e "Publicar o blog").
- Ligar `modules.blog` para a coorte nova.
- Trilha de missões do dia 2, consumindo `ouvirMissoes`.
- `server/crmReconcile.ts` considerando missão concluída como marco.

## Auto-revisão

**Cobertura do spec (Plano 1):** decisão 1 → Tasks 2 e 7; decisão 2 → Tasks 2 e 6; decisão 5 → Task 1; máquina de estados → Task 2; estado/retomada → Task 3; palco → Task 5; eventos → Task 4; Missão Produto → Task 8; risco 2 (colisão com `ProductUrlImportModal`) → Task 1 Step 5. Decisões 3 e 4 e os riscos 1 e 3 caem no Plano 2 — listados acima.

**Lacuna conhecida:** o pedido de WhatsApp durante a espera (decisão 3) **não** está neste plano. Ele depende de a geração ser longa o bastante para valer a interrupção, o que só se sabe medindo a etapa de palco em uso real. Fica para o Plano 2, junto com a Missão Conteúdo, que tem a espera mais longa das duas.

**Correção aplicada na auto-revisão:** a primeira versão da Task 8 assumia que
`scrapeProductUrl` devolvia um `Product` e chutava os nomes dos handlers de `App.tsx`. Os dois
estavam errados — o retorno é `ScrapedProductFields` e os handlers têm sufixo
`...FromOnboarding`/`...ForOnboarding`. Corrigido contra o código, e `buildProduct` passou a
ser extraído em vez de duplicado.

**Consistência de tipos:** `MissionState`, `MissionId`, `StepId`, `AccountSignal`, `MissionArtifact` definidos na Task 1 e usados sem renomear nas Tasks 2–8. `RendererProps`, `Turno` e `Acao` definidos na Task 6 e consumidos na Task 8. `StageLogLine`/`StageProps` definidos na Task 5 e consumidos nas Tasks 6 e 8. `destino: 'tiny' | 'catalogo' | 'blog'` na Task 4 cobre os dois caminhos de chegada da Task 8.
