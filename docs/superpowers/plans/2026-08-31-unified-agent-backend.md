# Unified Agent Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Operational Agent (manual Gemini function-calling loop) and the Content Agent (LangGraph.js graph) into a single LangGraph-based engine, serving every tool provider (`wake`, `tiny`, `docs`, `content`) through one approval/execution path and one implicit thread per user.

**Architecture:** `server/agent/contentGraph.ts` becomes the only orchestrator. `server/agent/registry.ts`'s `toLangChainTools` is the only place a write tool's `execute()` is reachable from, routed through a new `server/agent/execution.ts` that centralizes credit debiting and audit logging for every provider. `server/agent/contentAgentChat.ts` (the existing REST+SSE bridge) becomes the sole HTTP surface for sending messages and resolving approvals, resolving which providers a user can see from their module flags (`modules.contentAgent`, `modules.operationsAgent`) and Wake/Tiny connection state. The old manual loop (`server/agent/loop.ts`), its routes, and its dedicated approval module (`server/agent/actions.ts`) are deleted.

**Tech Stack:** TypeScript, Express, `@langchain/langgraph`, `@langchain/google-vertexai`, Firebase Admin SDK (Firestore), `tsx` for running verify scripts.

**Spec:** `docs/superpowers/specs/2026-08-31-unified-agent-design.md`

## Global Constraints

- No automated test framework exists in this repo — verification is either a pure-logic `scripts/verify-*.mjs` script (run with `npx tsx`) or a manual end-to-end check. Do not invent a test framework; follow this existing convention exactly.
- The registry's write-tool invariant must never be weakened: **the model loop never calls `execute()` directly** — only reachable via an approved `interrupt()` resume or an `auto`-approval-mode tool, and always through the new `runApprovedWrite` helper (Task 1).
- `ALWAYS_ASK_TOOLS` in `server/agent/agentSettings.ts` (publish, unpublish, connect credential, delete project) keeps forcing `ask` regardless of the account's approval mode — no task in this plan touches that list.
- Tasks 1–4 land together in the same deploy. Task 3 renames Firestore collections that Task 4's deletions depend on being the *only* writer of; do not ship Task 3 to production without Task 4 in the same release, or the old Operational loop (still writing `agent_threads` as readable messages) and the renamed checkpointer (now also writing `agent_threads`, as opaque checkpoint blobs) will collide in the same collection.
- No migration of existing `agent_threads`/`agent_actions` (Operational) or `content_agent_threads`/`content_agent_actions` (Content) documents. They are left as frozen history. Any action pending approval at the moment of deploy is lost — call this out in the deploy checklist (Task 5).

---

### Task 1: Generalized approval/execution path (credit debit + audit, every provider)

**Files:**
- Create: `server/agent/execution.ts`
- Modify: `server/agent/registry.ts` (the write-tool branch inside `toLangChainTools`)
- Modify: `server/agent/tools/content.ts:180-184,205-208` (remove inline `debitCreditsAdmin` calls)
- Modify: `server/agent/tools/contentSeo.ts:27-31` (remove inline `debitCreditsAdmin` call)
- Modify: `scripts/verify-agent-tools.mjs` (add coverage for `creditActionsFor`)

**Interfaces:**
- Produces: `runApprovedWrite(ctx: ToolCtx, def: ToolDef<any>, args: Record<string, unknown>, preview: ActionPreview): Promise<unknown>` and `creditActionsFor(def: ToolDef<any>): CreditAction[]`, both exported from `server/agent/execution.ts`. Task 2 and Task 4 do not call these directly, but Task 4's cleanup of `registry.ts` must not remove the import this task adds.

- [ ] **Step 1: Read the two call sites this task changes**

Confirm the current write-tool branch in `server/agent/registry.ts` still matches what this plan assumes (it may have drifted since this plan was written):

```bash
sed -n '160,181p' server/agent/registry.ts
```

Expected: the block calls `await def.execute!(ctx, args, preview)` twice — once in the `mode === 'auto'` branch, once after `if (!decisao?.aprovado) return ...`.

- [ ] **Step 2: Write the failing verification for `creditActionsFor`**

Add this block near the top of `scripts/verify-agent-tools.mjs`, right after the existing `import` line (do not remove `toGeminiDeclarations` from the import yet — Task 4 does that):

```js
import { creditActionsFor } from '../server/agent/execution.ts';
import { CREDIT_ACTIONS } from '../src/credits.ts';

// --- execution: creditActionsFor -------------------------------------------

check(
  'wake write tools debitam agentAction',
  creditActionsFor({ name: 'wake.banner.criar', provider: 'wake', mode: 'write' }),
  [CREDIT_ACTIONS.agentAction],
);
check(
  'tiny write tools debitam agentAction',
  creditActionsFor({ name: 'tiny.produto.atualizar', provider: 'tiny', mode: 'write' }),
  [CREDIT_ACTIONS.agentAction],
);
check(
  'content.clusters.gerar debita clusters + keyword research',
  creditActionsFor({ name: 'content.clusters.gerar', provider: 'content', mode: 'write' }),
  [CREDIT_ACTIONS.contentClusters, CREDIT_ACTIONS.seoKeywordResearch],
);
check(
  'content.calendario.gerar debita calendar',
  creditActionsFor({ name: 'content.calendario.gerar', provider: 'content', mode: 'write' }),
  [CREDIT_ACTIONS.contentCalendar],
);
check(
  'content.seo.auditoria.gerar debita seo audit',
  creditActionsFor({ name: 'content.seo.auditoria.gerar', provider: 'content', mode: 'write' }),
  [CREDIT_ACTIONS.seoAudit],
);
check(
  'ferramenta de conteúdo sem mapeamento não debita nada aqui (debita mais fundo, fora deste helper)',
  creditActionsFor({ name: 'content.artigo.publicar', provider: 'content', mode: 'write' }),
  [],
);
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npx tsx scripts/verify-agent-tools.mjs
```

Expected: fails to even start, with an error that `server/agent/execution.ts` cannot be found (the module doesn't exist yet).

- [ ] **Step 4: Create `server/agent/execution.ts`**

```ts
// server/agent/execution.ts
//
// Single place where an approved write tool's execute() actually runs.
// Reached only from registry.ts's toLangChainTools, after an interrupt()
// resolves { aprovado: true } or the tool's approval mode is 'auto' — this
// is what makes credit debiting and audit logging consistent across every
// provider (wake/tiny/content), instead of each tool handling it ad hoc.
// Replaces the old server/agent/actions.ts, which only covered the
// Operational provider's now-removed HTTP approve/reject endpoints.

import { adminDb } from '../firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost, type CreditAction } from '../../src/credits';
import type { ActionPreview, ToolCtx, ToolDef } from './types';

const auditCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_audit');

/**
 * Which credits (if any) a write tool debits. Only tools that debited
 * credits before this module existed are listed here — everything else
 * (content.artigo.produzir, .imagem.regenerar, .publicar, .despublicar, the
 * cluster/calendar/blog CRUD tools, credential connect) runs for free
 * through this path, exactly as before: several of them debit deeper inside
 * their own service functions (runArticlePipeline, regenerateArticleImage),
 * which this change does not touch.
 */
export function creditActionsFor(def: Pick<ToolDef<any>, 'name' | 'provider'>): CreditAction[] {
  if (def.provider === 'wake' || def.provider === 'tiny') return [CREDIT_ACTIONS.agentAction];
  switch (def.name) {
    case 'content.clusters.gerar':
      return [CREDIT_ACTIONS.contentClusters, CREDIT_ACTIONS.seoKeywordResearch];
    case 'content.calendario.gerar':
      return [CREDIT_ACTIONS.contentCalendar];
    case 'content.seo.auditoria.gerar':
      return [CREDIT_ACTIONS.seoAudit];
    default:
      return [];
  }
}

async function getCreditCosts(): Promise<Record<string, number>> {
  const snap = await adminDb.collection('config').doc('credits').get().catch(() => null);
  return (snap?.data()?.costs as Record<string, number>) ?? {};
}

async function debitCredits(uid: string, actions: CreditAction[], productName: string): Promise<void> {
  if (!actions.length) return;
  const costs = await getCreditCosts();
  const userRef = adminDb.collection('users').doc(uid);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('Usuário não encontrado.');
    const current = snap.data()?.credits ?? 0;
    const totalCost = actions.reduce((sum, action) => sum + resolveCreditCost(costs, action.key), 0);
    if (current < totalCost) throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { status: 402 });

    tx.update(userRef, { credits: current - totalCost });
    for (const action of actions) {
      const cost = resolveCreditCost(costs, action.key);
      tx.set(userRef.collection('credit_logs').doc(), {
        actionType: action.label,
        actionKey: action.key,
        productName,
        sku: 'N/A',
        userName: '',
        creditsConsumed: cost,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

/** Firestore rejects undefined; previews/results legitimately contain optional fields. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

/**
 * Runs an approved (or auto-approved) write tool. Debits credits, calls
 * execute(), and writes an audit doc — success or failure — to
 * users/{uid}/agent_audit. Re-throws on failure so the caller's existing
 * catch (registry.ts's toLangChainTools) still produces the
 * "Erro ao executar <tool>: <message>" string the rest of the system
 * already matches on (contentAgentChat.ts's streamRun).
 */
export async function runApprovedWrite(
  ctx: ToolCtx,
  def: ToolDef<any>,
  args: Record<string, unknown>,
  preview: ActionPreview,
): Promise<unknown> {
  await debitCredits(ctx.uid, creditActionsFor(def), preview.alvo);

  try {
    const result = await def.execute!(ctx, args, preview);
    await auditCol(ctx.uid).add({
      tool: def.name,
      provider: def.provider,
      resumo: preview.resumo,
      alvo: preview.alvo,
      args: stripUndefined(args),
      result: stripUndefined(result),
      dryRun: ctx.dryRun,
      at: new Date().toISOString(),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await auditCol(ctx.uid).add({
      tool: def.name,
      provider: def.provider,
      resumo: preview.resumo,
      alvo: preview.alvo,
      args: stripUndefined(args),
      erro: message,
      dryRun: ctx.dryRun,
      at: new Date().toISOString(),
    });
    throw err;
  }
}
```

- [ ] **Step 5: Run the verification again to confirm it passes**

```bash
npx tsx scripts/verify-agent-tools.mjs
```

Expected: all `creditActionsFor` checks print `ok`. (Other checks in the file that reference `toGeminiDeclarations` still pass unchanged — that import stays until Task 4.)

- [ ] **Step 6: Wire `runApprovedWrite` into `registry.ts`**

In `server/agent/registry.ts`, add the import near the top (after the `resolveApprovalMode` import):

```ts
import { runApprovedWrite } from './execution';
```

Then replace the write-tool branch inside `toLangChainTools`'s tool callback (the block currently reading `const preview = await def.preview!(ctx, args); ... return await def.execute!(ctx, args, preview);` twice) with:

```ts
          const preview = await def.preview!(ctx, args);
          const mode = resolveApprovalMode(settings, def.name);
          if (mode === 'auto') {
            return await runApprovedWrite(ctx, def, args, preview);
          }

          const decisao = interrupt({
            ferramenta: def.name,
            resumo: preview.resumo,
            alvo: preview.alvo,
            campos: preview.campos,
            avisos: preview.avisos,
            args,
          }) as { aprovado: boolean };

          if (!decisao?.aprovado) return 'Ação cancelada pelo usuário.';
          return await runApprovedWrite(ctx, def, args, preview);
```

- [ ] **Step 7: Remove the now-redundant inline credit debits in content tools**

In `server/agent/tools/content.ts`, find the `content.clusters.gerar` tool's `execute()` and delete these two lines (they duplicate what `runApprovedWrite` now does):

```ts
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.contentClusters, { productName: project.config.nomeEmpresa });
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.seoKeywordResearch, { productName: project.config.nomeEmpresa });
```

And in `content.calendario.gerar`'s `execute()`, delete:

```ts
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.contentCalendar, { productName: project.config.nomeEmpresa });
```

If `debitCreditsAdmin` and/or `CREDIT_ACTIONS` become unused imports in `content.ts` after these deletions, remove those import lines too (check with `grep -n "debitCreditsAdmin\|CREDIT_ACTIONS" server/agent/tools/content.ts`).

- [ ] **Step 8: Same removal in `contentSeo.ts`**

In `server/agent/tools/contentSeo.ts`, find `content.seo.auditoria.gerar`'s `execute()` and delete:

```ts
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.seoAudit, project.config.nomeEmpresa);
```

Remove the now-unused `debitCreditsAdmin`/`CREDIT_ACTIONS` imports if nothing else in the file uses them (check with `grep -n "debitCreditsAdmin\|CREDIT_ACTIONS" server/agent/tools/contentSeo.ts`).

- [ ] **Step 9: Type-check**

```bash
npm run lint
```

Expected: no new TypeScript errors. (This is the project's only automated check — see `CLAUDE.md`.)

- [ ] **Step 10: Commit**

```bash
git add server/agent/execution.ts server/agent/registry.ts server/agent/tools/content.ts server/agent/tools/contentSeo.ts scripts/verify-agent-tools.mjs
git commit -m "feat(agent): generalize write-tool approval into a single debit+audit path"
```

---

### Task 2: Unify the content graph to serve every tool provider

**Files:**
- Modify: `server/agent/contentGraph.ts`

**Interfaces:**
- Consumes: `runApprovedWrite`/`creditActionsFor` are not called directly here — this task only widens which providers `toLangChainTools` (Task 1's caller inside `registry.ts`) is asked for.
- Consumes: `buildContext` from `./connections` (already exists, signature `(uid: string, opts?: { dryRun?: boolean }) => ToolCtx`).
- Produces: `ContentGraphConfig.configurable` gains two new optional fields, `providers: ToolProvider[]` and `conexoes: { wake: boolean; tiny: boolean }`, which Task 3 populates from the HTTP bridge.

- [ ] **Step 1: Read the current file in full**

```bash
cat server/agent/contentGraph.ts
```

Confirm it still matches the version read while writing this plan (imports at the top, `buildTools`, `buildSystemPrompt`, `callModel`, `toolsNode`, the compiled `graph`).

- [ ] **Step 2: Add the tool-registration imports for Wake/Tiny/docs**

At the top of `server/agent/contentGraph.ts`, alongside the existing three tool imports, add:

```ts
import '../agent/tools/wake';
import '../agent/tools/tiny';
import '../agent/tools/discovery';
```

So the top of the file reads:

```ts
import '../agent/tools/content';
import '../agent/tools/contentSeo';
import '../agent/tools/contentBlog';
import '../agent/tools/wake';
import '../agent/tools/tiny';
import '../agent/tools/discovery';
```

- [ ] **Step 3: Replace the imports for `buildTools`'s context**

Replace the line `import type { ToolCtx } from '../agent/types';` with:

```ts
import { buildContext } from '../agent/connections';
import type { ToolCtx, ToolProvider } from '../agent/types';
```

- [ ] **Step 4: Replace the system prompt and `ContentGraphConfig`**

Replace the whole block from `const SYSTEM_PROMPT = [` through the end of `buildSystemPrompt` (i.e. everything between the imports and `function buildTools`) with:

```ts
interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
}

interface ContentGraphConfig {
  configurable?: {
    uid?: string;
    settings?: AgentSettings;
    contexto?: WorkspaceContext;
    providers?: ToolProvider[];
    conexoes?: { wake: boolean; tiny: boolean };
  };
}

const SYSTEM_PROMPT = [
  'Você é o Agente do Alfreds: cuida da criação e publicação de conteúdo',
  '(clusters, calendário editorial, artigos, SEO) e opera a loja/ERP do',
  'usuário (Wake Commerce, Tiny ERP) através das ferramentas disponíveis.',
  'Responda sempre em português do Brasil. Nunca peça senhas, tokens ou',
  'credenciais pelo chat — se precisar conectar uma integração, avise o',
  'usuário para usar o formulário de conexão correspondente.',
  'Ferramentas de LEITURA rodam na hora. Ferramentas de ESCRITA não',
  'executam quando você as chama — elas montam uma prévia com o antes/depois',
  'real e param para o usuário aprovar. Chame uma vez e aguarde; não repita',
  'a chamada achando que falhou. Proponha no máximo uma escrita por vez.',
  'Nunca invente SKU, id, preço ou qualquer identificador de e-commerce/ERP',
  '— descubra com uma ferramenta de leitura ou pergunte.',
  'Nunca peça o ID de um projeto de conteúdo ao usuário — ele não vê IDs na',
  'UI, só nomes. Se o contexto do workspace abaixo indicar um projeto',
  'aberto, use o ID dele por padrão sem perguntar. Se não houver, ou o',
  'usuário mencionar outro projeto por nome, chame content.projetos.listar',
  'para resolver o nome em ID antes de qualquer outra ferramenta que',
  'precise de projectId.',
].join(' ');

// Injetado a cada chamada (não fixo no bind do modelo) porque reflete o
// contexto/conexões NO MOMENTO da mensagem — ver
// server/agent/contentAgentChat.ts, que resolve providers/conexoes por
// requisição a partir dos módulos habilitados na conta e das credenciais
// Wake/Tiny conectadas.
function buildSystemPrompt(config: ContentGraphConfig): string {
  const contexto = config.configurable?.contexto;
  const conexoes = config.configurable?.conexoes;
  const partes = [SYSTEM_PROMPT];

  if (conexoes) {
    const plataformas = [
      conexoes.wake ? '- Wake Commerce (loja/e-commerce): banners, hotsites, produtos, preço, estoque e SEO.' : null,
      conexoes.tiny ? '- Tiny ERP (v2): produtos, preço, estoque, pedidos e contatos.' : null,
    ].filter(Boolean).join('\n');
    partes.push(`Plataformas de e-commerce/ERP conectadas nesta conta:\n${plataformas || '- Nenhuma plataforma conectada.'}`);
  }

  if (contexto?.projetoId) {
    partes.push(`Contexto do workspace: o projeto aberto agora é "${contexto.projetoNome ?? contexto.projetoId}" (projectId: ${contexto.projetoId}).`);
    if (contexto.articleId) partes.push(`Artigo em foco: ${contexto.articleId}.`);
  }

  return partes.join(' ');
}
```

- [ ] **Step 5: Replace `buildTools`**

Replace the whole `function buildTools(config: ContentGraphConfig) { ... }` block with:

```ts
function buildTools(config: ContentGraphConfig) {
  const uid = config.configurable?.uid;
  if (!uid) throw new Error('uid ausente na configuração do grafo — server/agent/contentAgentChat.ts deveria sempre fornecer.');
  const settings = config.configurable?.settings ?? DEFAULT_AGENT_SETTINGS;
  const providers = config.configurable?.providers ?? ['content'];
  const ctx: ToolCtx = buildContext(uid);
  return toLangChainTools(providers, ctx, settings);
}
```

- [ ] **Step 6: Update `callModel`'s system-prompt call**

In `callModel`, replace:

```ts
  const response = await model.invoke([{ role: 'system', content: buildSystemPrompt(config.configurable?.contexto) }, ...state.messages]);
```

with:

```ts
  const response = await model.invoke([{ role: 'system', content: buildSystemPrompt(config) }, ...state.messages]);
```

- [ ] **Step 7: Type-check**

```bash
npm run lint
```

Expected: no new TypeScript errors. In particular, check that `ToolProvider` is actually exported from `server/agent/types.ts` (it is — confirmed while writing this plan) and that `buildContext`'s return type (`ToolCtx`) matches what `toLangChainTools` expects (it does — both come from `server/agent/types.ts`).

- [ ] **Step 8: Manual verification**

There is no automated harness for the graph itself (it needs Vertex AI credentials and a running Firestore). Start the content-agent server locally and confirm it still boots without throwing at import time (this catches typos/missing exports immediately, before any real conversation):

```bash
npm run dev:content-agent
```

Expected: log line `[content-agent-server] ouvindo na porta 8123`, no thrown error. Stop it with Ctrl+C — full conversational verification happens in Task 5, once Task 3 gives it a real caller.

- [ ] **Step 9: Commit**

```bash
git add server/agent/contentGraph.ts
git commit -m "feat(agent): let the content graph serve wake/tiny/docs tools, not just content"
```

**Note on the old loop's `MAX_STEPS = 8` guard:** `loop.ts` (removed in Task 4) capped itself at 8 model turns per message to avoid a runaway conversation. LangGraph's `StateGraph.stream()` already enforces its own default recursion limit (`GraphRecursionError` past 25 supersteps) independent of anything in this file, so a Wake/Tiny-heavy conversation is not unbounded even without an explicit change here. 25 is looser than the old 8, but not open-ended — leave it at the LangGraph default for this plan; revisit only if Task 5's manual testing shows a real runaway conversation.

---

### Task 3: Single implicit thread, module-gated providers, renamed collections

**Files:**
- Modify: `server/agent/firestoreCheckpointer.ts` (collection name rename)
- Modify: `server/agent/contentAgentChat.ts` (provider resolution, implicit thread, renamed collections/routes)

**Interfaces:**
- Consumes: `resolveConnections(uid): Promise<Connections>` from `./connections` (existing, `Connections = { wake: boolean; tiny: boolean; providers: ToolProvider[] }`).
- Consumes: `contentThreadRef(uid, threadId)` from `./firestoreCheckpointer` (existing export, this task only changes which collection name it points at).
- Produces: `POST /api/agent/messages` (body `{ texto, contexto? }`, SSE response) and `POST /api/agent/actions/:id/{execute,reject}` (SSE response) — these replace `/api/content-agent/threads/:id/messages` and `/api/content-agent/actions/:id/{execute,reject}`. Task 4's frontend consumers (out of scope for this plan, see the separate frontend plan) call these new paths.

- [ ] **Step 1: Rename the checkpointer's collection**

In `server/agent/firestoreCheckpointer.ts`, change:

```ts
export function contentThreadRef(uid: string, threadId: string) {
  return adminDb.collection('users').doc(uid).collection('content_agent_threads').doc(threadId);
}
```

to:

```ts
export function contentThreadRef(uid: string, threadId: string) {
  return adminDb.collection('users').doc(uid).collection('agent_threads').doc(threadId);
}
```

and:

```ts
function threadOwnerRef(threadId: string) {
  return adminDb.collection('content_agent_thread_owners').doc(threadId);
}
```

to:

```ts
function threadOwnerRef(threadId: string) {
  return adminDb.collection('agent_thread_owners').doc(threadId);
}
```

Update the file's top comment block (lines 1–17) to drop the now-stale rationale about avoiding a collision with the Operational loop's `agent_threads` (that loop is deleted in Task 4, so there is no longer a collision to avoid — this collection is now the only `agent_threads`):

```ts
// Checkpointer do LangGraph.js sobre o Firestore. Não existe um checkpointer
// oficial do LangGraph.js para Firestore (só Postgres/SQLite/MongoDB/Redis) —
// sem persistência, uma aprovação pendente se perde se o servidor reiniciar
// entre a pergunta e a resposta do usuário (relevante em Cloud Run, que
// escala a zero). A lógica de leitura/escrita abaixo espelha a
// implementação de referência do próprio pacote (`MemorySaver`, em
// node_modules/@langchain/langgraph-checkpoint/dist/memory.js), só trocando
// os dois objetos em memória por documentos no Firestore.
//
// Estrutura: users/{uid}/agent_threads/{threadId}/checkpoints/{checkpointId},
// com uma subcoleção `writes/{taskId}__{writeIdx}` por checkpoint.
// `agent_threads/{threadId}` também guarda uma subcoleção `messages`
// (legível, para a UI — ver server/agent/contentAgentChat.ts), irmã de
// `checkpoints`.
```

- [ ] **Step 2: Add provider/module resolution to `contentAgentChat.ts`**

In `server/agent/contentAgentChat.ts`, add this import alongside the existing ones:

```ts
import { resolveConnections } from './connections';
import type { ToolProvider } from './types';
```

Then add this function after the `WorkspaceContext` interface (before `interface ContentAgentAction`):

```ts
interface AgentContext {
  providers: ToolProvider[];
  conexoes: { wake: boolean; tiny: boolean };
}

/**
 * Which tools a user's account can see, combining the per-module opt-in
 * flags (users/{uid}.modules.contentAgent / .operationsAgent) with actual
 * Wake/Tiny connection state. A module being off hides its tools from the
 * model entirely — same principle resolveConnections already applies to
 * unconnected platforms, extended to cover the content/operations split.
 */
async function resolveAgentContext(uid: string): Promise<AgentContext> {
  const userSnap = await adminDb.collection('users').doc(uid).get();
  const modules = (userSnap.data()?.modules ?? {}) as Record<string, boolean>;

  const conns = modules.operationsAgent === true
    ? await resolveConnections(uid)
    : { wake: false, tiny: false, providers: [] as ToolProvider[] };

  const providers: ToolProvider[] = [...conns.providers];
  if (modules.contentAgent === true) providers.push('content');

  return { providers, conexoes: { wake: conns.wake, tiny: conns.tiny } };
}

/** users/{uid}.modules.contentAgent or .operationsAgent must be on — the account needs at least one of the two features this agent covers. */
async function requireAnyModule(uid: string): Promise<void> {
  const snap = await adminDb.collection('users').doc(uid).get();
  const modules = snap.data()?.modules ?? {};
  if (modules.contentAgent !== true && modules.operationsAgent !== true) {
    throw Object.assign(new Error('Nenhum módulo de agente está habilitado nesta conta.'), { status: 403 });
  }
}
```

- [ ] **Step 3: Rename the actions collection**

Change:

```ts
const actionsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('content_agent_actions');
```

to:

```ts
const actionsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_actions');
```

- [ ] **Step 4: Thread the new context through `streamRun`**

Replace the `streamRun` function signature and its `config.configurable` body construction. Change:

```ts
async function streamRun(
  uid: string,
  threadId: string,
  body: { input?: { messages: { role: 'human'; content: string }[] } } | { command: { resume: unknown } },
  emit: Emit,
  contexto?: WorkspaceContext,
): Promise<RunResult> {
  const res = await fetch(`${CONTENT_AGENT_URL}/threads/${threadId}/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      assistant_id: GRAPH_ID,
      config: { configurable: { uid, ...(contexto ? { contexto } : {}) } },
      stream_mode: ['messages-tuple', 'values'],
      ...body,
    }),
  });
```

to:

```ts
async function streamRun(
  uid: string,
  threadId: string,
  body: { input?: { messages: { role: 'human'; content: string }[] } } | { command: { resume: unknown } },
  emit: Emit,
  contexto?: WorkspaceContext,
): Promise<RunResult> {
  const agentContext = await resolveAgentContext(uid);
  const res = await fetch(`${CONTENT_AGENT_URL}/threads/${threadId}/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      assistant_id: GRAPH_ID,
      config: {
        configurable: {
          uid,
          providers: agentContext.providers,
          conexoes: agentContext.conexoes,
          ...(contexto ? { contexto } : {}),
        },
      },
      stream_mode: ['messages-tuple', 'values'],
      ...body,
    }),
  });
```

- [ ] **Step 5: Replace the multi-thread routes with a single implicit thread**

Replace the whole `export function registerContentAgentChatRoutes(...)` function with:

```ts
const AGENT_THREAD_ID = 'principal';

async function ensureUserThread(uid: string): Promise<void> {
  const ref = contentThreadRef(uid, AGENT_THREAD_ID);
  const snap = await ref.get();
  if (snap.exists) return;
  await ensureLangGraphThread(AGENT_THREAD_ID);
  const now = new Date().toISOString();
  await ref.set({ id: AGENT_THREAD_ID, createdAt: now, updatedAt: now });
}

export function registerContentAgentChatRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/agent/messages', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      await ensureUserThread(uid);

      const texto = String(req.body?.texto ?? '');
      if (!texto.trim()) return res.status(400).json({ message: 'Mensagem vazia.' });
      const contexto = req.body?.contexto as WorkspaceContext | undefined;

      emit = openSse(res);
      await sendUserMessage(uid, AGENT_THREAD_ID, texto, emit, contexto);
      res.end();
    } catch (e: any) {
      if (emit) {
        emit('erro', { message: e?.message ?? 'Falha no agente.' });
        res.end();
      } else {
        res.status(httpStatus(e)).json({ message: e?.message });
      }
    }
  });

  app.post('/api/agent/actions/:id/execute', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const action = await claimAction(uid, req.params.id);
      const contexto = req.body?.contexto as WorkspaceContext | undefined;
      emit = openSse(res);
      await resolveAndContinue(uid, action, true, emit, contexto);
      res.end();
    } catch (e: any) {
      if (emit) {
        emit('erro', { message: e?.message ?? 'Falha ao executar a ação.' });
        res.end();
      } else {
        res.status(httpStatus(e)).json({ message: e?.message });
      }
    }
  });

  app.post('/api/agent/actions/:id/reject', async (req, res) => {
    let emit: Emit | null = null;
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const action = await claimAction(uid, req.params.id);
      const contexto = req.body?.contexto as WorkspaceContext | undefined;
      emit = openSse(res);
      await resolveAndContinue(uid, action, false, emit, contexto);
      res.end();
    } catch (e: any) {
      if (emit) {
        emit('erro', { message: e?.message ?? 'Falha ao rejeitar a ação.' });
        res.end();
      } else {
        res.status(httpStatus(e)).json({ message: e?.message });
      }
    }
  });
}
```

This removes the `threadsCol`, `GET /api/agent/threads`, `POST /api/agent/threads`, and `DELETE /api/agent/threads/:id` handlers — check with `grep -n "threadsCol" server/agent/contentAgentChat.ts` afterwards and delete the now-unused `const threadsCol = ...` line near the top of the file if it's still there.

- [ ] **Step 6: Type-check**

```bash
npm run lint
```

Expected: no new TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add server/agent/firestoreCheckpointer.ts server/agent/contentAgentChat.ts
git commit -m "feat(agent): single implicit thread per user, module-gated providers, renamed collections"
```

---

### Task 4: Retire the old Operational loop

**Files:**
- Delete: `server/agent/loop.ts`
- Delete: `server/agent/actions.ts`
- Modify: `server/agent/routes.ts` (keep only the introspection endpoints)
- Modify: `server.ts` (routing wire-up)
- Modify: `server/agent/registry.ts` (drop `toGeminiDeclarations`, update the file's top comment)
- Modify: `scripts/verify-agent-tools.mjs` (drop the now-removed `toGeminiDeclarations` coverage)

**Interfaces:**
- Produces: `registerOperationsRoutes` keeps the same name and signature (`(app: express.Express, { verifyFirebaseToken }: Deps) => void`) but now only registers `GET /api/agent/connections`, `GET /api/agent/tools`, `GET /api/agent/logs`.

- [ ] **Step 1: Delete the two files**

```bash
git rm server/agent/loop.ts server/agent/actions.ts
```

- [ ] **Step 2: Rewrite `server/agent/routes.ts` to keep only introspection**

Replace the entire file with:

```ts
// Read-only introspection surface: which providers/tools an account can see,
// and the diagnostic log of Wake/Tiny HTTP calls. Sending messages and
// resolving approvals now live in server/agent/contentAgentChat.ts, which
// serves every provider through the unified LangGraph engine — see
// docs/superpowers/specs/2026-08-31-unified-agent-design.md.

import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { describeTools } from './registry';
import { resolveConnections } from './connections';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

/** users/{uid}.modules.contentAgent or .operationsAgent must be on. */
async function requireAnyModule(uid: string): Promise<void> {
  const snap = await adminDb.collection('users').doc(uid).get();
  const modules = snap.data()?.modules ?? {};
  if (modules.contentAgent !== true && modules.operationsAgent !== true) {
    throw Object.assign(new Error('Nenhum módulo de agente está habilitado nesta conta.'), { status: 403 });
  }
}

const httpStatus = (e: any) => (typeof e?.status === 'number' ? e.status : 500);

export function registerOperationsRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.get('/api/agent/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      return res.json(await resolveConnections(uid));
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Introspection of the registry. Also the shape a future MCP tools/list
  // returns, which is why it lives here rather than being inlined in the UI.
  app.get('/api/agent/tools', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const conns = await resolveConnections(uid);
      return res.json({ providers: conns.providers, tools: describeTools(conns.providers) });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });

  // Diagnóstico: as últimas chamadas HTTP que o agente fez para Wake/Tiny, com
  // requisição, resposta e status. É o que transforma um "Erro ao inserir
  // banner!" da Wake em algo acionável.
  app.get('/api/agent/logs', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      let q = adminDb.collection('users').doc(uid).collection('agent_logs')
        .orderBy('at', 'desc').limit(limit);
      const snap = await q.get();
      let logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const threadId = req.query.threadId as string | undefined;
      if (threadId) logs = logs.filter((l: any) => l.threadId === threadId);
      const apenasErros = req.query.erros === '1';
      if (apenasErros) logs = logs.filter((l: any) => !l.ok);
      return res.json({ logs });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
}
```

- [ ] **Step 3: Confirm `server.ts`'s wiring still holds**

```bash
grep -n "registerOperationsRoutes\|registerContentAgentChatRoutes" server.ts
```

Expected: both lines from Task 0 exploration are still there (`registerOperationsRoutes(app, { verifyFirebaseToken });` and `registerContentAgentChatRoutes(app, { verifyFirebaseToken });`). No change needed here — both functions keep their names and `Deps` shape, so `server.ts` doesn't need editing. If the grep shows anything different (e.g. the calls were removed or renamed since this plan was written), restore both calls in the same relative position they're in today, right after the CRM/webhook route registrations and before the static file serving.

- [ ] **Step 4: Strip `toGeminiDeclarations` from `registry.ts`**

In `server/agent/registry.ts`, delete the `interface GeminiFunctionDeclaration { ... }` block and the whole `export function toGeminiDeclarations(...) { ... }` function that follows it (everything between the `describeTools` function and the `_resetRegistry` function).

Update the file's top comment, which currently reads:

```ts
// Transport-agnostic tool registry — the "MCP" of the operational agent.
//
// Tools register themselves here at import time. Consumers ask for the subset
// they're allowed to see and convert it to their own wire format. Today that's
// Gemini FunctionDeclarations; a future server/agent/mcp.ts maps the same list
// to MCP tools/list and tools/call without touching a single tool definition.
```

to:

```ts
// Transport-agnostic tool registry — the "MCP" of the unified agent.
//
// Tools register themselves here at import time. Consumers ask for the subset
// they're allowed to see and convert it to their own wire format. Today that's
// LangChain/LangGraph tools (toLangChainTools, below); a future
// server/agent/mcp.ts maps the same list to MCP tools/list and tools/call
// without touching a single tool definition.
```

- [ ] **Step 5: Fix `scripts/verify-agent-tools.mjs`**

Remove `toGeminiDeclarations` from the import line added back in Task 1 (it now reads `import { registerTool, getTool, listTools, describeTools, _resetRegistry } from '../server/agent/registry.ts';` — no `toGeminiDeclarations`).

Delete the whole `// --- conversão para Gemini` section:

```js
const decls = toGeminiDeclarations(['wake']);
check('cada ferramenta vira uma declaration', decls.length, 2);

const declEscrita = decls.find((d) => d.name === 'wake.teste.escrever');
const declLeitura = decls.find((d) => d.name === 'wake.teste.ler');
check('declaration de escrita avisa o modelo que vai pausar', /\[ESCRITA\]/.test(declEscrita.description), true);
check('declaration de leitura não leva o marcador', /\[ESCRITA\]/.test(declLeitura.description), false);
check('schema vai como parametersJsonSchema', declEscrita.parametersJsonSchema, { type: 'object', properties: {} });
```

- [ ] **Step 6: Run the verification script**

```bash
npx tsx scripts/verify-agent-tools.mjs
```

Expected: `Todas as verificações passaram.`, exit code 0.

- [ ] **Step 7: Type-check the whole project**

```bash
npm run lint
```

Expected: no TypeScript errors anywhere (this also catches any remaining reference to `loop.ts`/`actions.ts` left behind, e.g. a stray import).

- [ ] **Step 8: Search for stragglers**

```bash
grep -rn "agent/loop\|agent/actions\|toGeminiDeclarations" --include="*.ts" --include="*.tsx" server src scripts
```

Expected: no matches. If any turn up, fix them before committing (a leftover import of a deleted file is a build-breaking bug, not a style nit).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(agent): remove the old Operational function-calling loop"
```

---

### Task 5: Manual end-to-end verification

There is no automated integration harness for this system (needs live Vertex AI + Firestore + a running content-agent server) — this task is a documented manual checklist, run once Tasks 1–4 are deployed to a dev/staging environment with `AGENT_DRY_RUN=true` (so Wake/Tiny writes compute their payload but skip the outbound call).

**Files:** none (verification only).

- [ ] **Step 1: Boot both processes**

```bash
npm run dev
```

and, in a second terminal:

```bash
npm run dev:content-agent
```

Expected: both start without errors.

- [ ] **Step 2: Confirm provider gating**

On a test account with only `modules.contentAgent: true` (Firestore `users/{uid}.modules`), call:

```bash
curl -s -H "Authorization: Bearer <ID_TOKEN>" http://localhost:3000/api/agent/tools | jq '.providers'
```

Expected: `["content"]` — no `wake`/`tiny`/`docs`, even if the account has a Wake token stored (the module flag gates it, per `resolveAgentContext` in Task 3).

- [ ] **Step 3: Content action through the unified path**

With `AGENT_DRY_RUN=true`, send a message that produces a content write (e.g. "gere o calendário editorial do projeto X"), via:

```bash
curl -N -H "Authorization: Bearer <ID_TOKEN>" -H "Content-Type: application/json" \
  -d '{"texto":"gere o calendário editorial do projeto X"}' \
  http://localhost:3000/api/agent/messages
```

Expected: SSE stream includes an `acao` event with `preview.resumo` describing the calendar generation. Approve it via `POST /api/agent/actions/:id/execute`. Confirm in Firestore: `users/{uid}/agent_actions/{id}.status === 'executed'`, a new `users/{uid}/agent_audit` doc with `tool: 'content.calendario.gerar'`, and a `users/{uid}/credit_logs` doc with `actionKey: 'content_calendar'` — and only ONE such credit_logs doc (confirms Task 1's dedup: the tool no longer self-debits).

- [ ] **Step 4: Operational action through the unified path**

On an account with `modules.operationsAgent: true` and a Wake token stored, ask for a Wake write (e.g. "desative o banner 123"). Approve it. Confirm: `users/{uid}/agent_audit` has a doc with `tool: 'wake.banner.status'`, `provider: 'wake'`, and `dryRun: true` (since `AGENT_DRY_RUN=true`); `users/{uid}/credit_logs` has a doc with `actionKey: 'agent_action'`.

- [ ] **Step 5: Rejection path**

Propose another write, reject it via `POST /api/agent/actions/:id/reject`. Confirm: the action's `status === 'rejected'`, no new `agent_audit` doc, no new `credit_logs` doc, and the model's next SSE `fim` event acknowledges the rejection instead of retrying the same call.

- [ ] **Step 6: Single-thread behavior**

Send two messages in sequence without creating any thread explicitly. Confirm both land in the same `users/{uid}/agent_threads/principal/messages` subcollection, in order — there is no thread-picker UI to test yet (that's the separate frontend plan), just confirm the backend never asks for a `threadId`.

- [ ] **Step 7: `ALWAYS_ASK_TOOLS` still forces approval**

Even with the account's approval mode set to `auto` (`users/{uid}/agent_settings.approvalMode: 'auto'`), ask the agent to publish an article. Confirm it still produces an `acao` (approval) event instead of executing immediately — this is `server/agent/agentSettings.ts`'s `ALWAYS_ASK_TOOLS`, untouched by this plan, still working through the new path.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-31-unified-agent-backend.md`. This covers the backend engine unification only (spec sections "Motor único", "Aprovação e execução", "Modelo de dados", "Modelo de thread"). The frontend work (new chat-first home screen, unified `agentChatService.ts`, the three.js particle sphere) is independent enough to be its own plan, written once this one lands — the frontend's service layer needs the endpoints this plan produces (`POST /api/agent/messages`, `POST /api/agent/actions/:id/{execute,reject}`) to exist first.
