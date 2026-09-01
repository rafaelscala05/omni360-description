# Unified Agent Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two separate agent chat surfaces (`OperationsApp` full-page app, `ContentAgentPanel` docked overlay) with a single chat-first home screen — the design-canvas prototype approved earlier this session, built with real data against the endpoints `docs/superpowers/plans/2026-08-31-unified-agent-backend.md` produced (`POST /api/agent/messages`, `POST /api/agent/actions/:id/{execute,reject}`, `GET /api/agent/{connections,tools,logs}`).

**Architecture:** One merged type file (`src/types/agent.ts`) and one merged service (`src/services/agentChatService.ts`) replace the two per-agent pairs. A `src/modules/agent/` module holds the new home screen (`AgentHomeScreen.tsx`), a real three.js particle sphere (`AgentSphere.tsx`), and the chat rendering components merged from the two old modules (`chat/ChatThread.tsx`, `ActionCard.tsx`, `Composer.tsx`, `Markdown.tsx`, `CredentialForm.tsx`, `LogsPanel.tsx`). `App.tsx` mounts it as a new `mainView` (`'home'`), made the default, with the existing product-workspace sidebar collapsed to an icon rail by default. `OperationsApp` and its whole `src/modules/operations/` directory are deleted (it was pure chat, nothing else). `ContentApp` (the real content-management workspace — clusters, calendar, article editor) is kept, only losing the `ContentAgentPanel` chat wrapper around it.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Firebase (Firestore `onSnapshot` for live reads), `three` (new dependency) for the particle sphere.

**Spec:** `docs/superpowers/specs/2026-08-31-unified-agent-design.md` (section "Frontend" and "UI: da mockup para a implementação real")
**Depends on:** `docs/superpowers/plans/2026-08-31-unified-agent-backend.md` (must be merged first — this plan calls the endpoints it produces)

## Global Constraints

- No automated test framework exists in this repo (`CLAUDE.md`) — verification is `npm run lint` (`tsc --noEmit`) plus manual checks in the running dev server (`npm run dev`). Screenshot or describe what you see when a step says to check the UI visually.
- Match the app's existing visual vocabulary exactly — colors `#FF5B03` (primary), `#141311` (ink/sidebar), `#1e293b` (sidebar active), `#f7f9fb` (surface background), `border-slate-200`, `rounded-xl`/`rounded-2xl`, `shadow-sm`. These are lifted from `src/App.tsx` and `src/index.css`, not invented.
- **Deviation from the literal spec text, called out explicitly:** the spec says the sidebar "perde os dois botões" (loses both switcher buttons). That's correct for "Ir para Agente Operacional" (`OperationsApp` is pure chat — full replacement, safe to remove). It is **not** correct for "Ir para Agente de Conteúdo": that button is the only entry point to `ContentApp`, which is a real content-management workspace (project/cluster/calendar/article editor pages), not just a chat wrapper. Task 5 keeps that entry point, renamed to reflect what it actually opens, and only removes the chat panel wrapped around `ContentApp`'s pages.
- No file-attachment support in the new composer. The unified backend's `POST /api/agent/messages` never accepted attachments (only the now-deleted Operational loop did) — the old `Composer.tsx`'s attach-image feature has no backend to call. This is a known, deliberate regression for Wake banner-creation-from-image flows; re-adding it is a future backend task, not part of this plan.
- Every task ends with `npm run lint` showing no new errors beyond the pre-existing baseline: `src/App.tsx(761,32)`, `src/App.tsx(1502,11)`, `src/components/modals/ProductEditModal.tsx(313,13)` (all pre-existing, unrelated to this work — confirmed before this plan was written).

---

### Task 1: Backend hardening + unified types and service layer

Three small, related fixes discovered while designing the frontend, plus the type/service merge itself. All three backend fixes are necessary for the frontend to show accurate data — none are optional polish.

**Files:**
- Modify: `server/agent/connections.ts` (add `resolveAgentContext`/`requireAnyModule`, the single source of truth for module-gated providers)
- Modify: `server/agent/contentAgentChat.ts` (use the shared functions instead of its own copies; add `dryRun` to the executed-action patch)
- Modify: `server/agent/routes.ts` (use the shared functions; module-gate `/api/agent/connections` and `/api/agent/tools`, which today ignore module flags and can over-report available providers)
- Modify: `src/types/agent.ts` (merge in content's `ferramenta`/`args` preview fields, drop dead fields)
- Delete: `src/types/contentAgent.ts`
- Create: `src/services/agentChatService.ts`
- Delete: `src/services/operationsService.ts`, `src/services/contentAgentChatService.ts`
- Modify: `firestore.rules` (remove the now-dead `content_agent_threads`/`content_agent_actions` rules)

**Interfaces:**
- Produces: `resolveAgentContext(uid): Promise<{ providers: ToolProvider[]; conexoes: { wake: boolean; tiny: boolean } }>` and `requireAnyModule(uid): Promise<void>`, both exported from `server/agent/connections.ts`.
- Produces (frontend): `agentChatService.ts` exports `fetchConnections`, `fetchTools`, `fetchLogs`, `listenMessages(cb)`, `listenActions(cb)`, `enviarMensagem(texto, h, signal?, contexto?)`, `executarAcao(id, h, contexto?)`, `rejeitarAcao(id, h, contexto?)` — all consumed by Task 4's `AgentHomeScreen` and Task 2's `LogsPanel`.

- [ ] **Step 1: Confirm the current shape of the two duplicated functions**

```bash
grep -n "resolveAgentContext\|requireAnyModule" server/agent/contentAgentChat.ts server/agent/routes.ts
```

Expected: `contentAgentChat.ts` defines both; `routes.ts` defines its own separate `requireAnyModule` and does not have `resolveAgentContext` at all (its `/api/agent/connections` and `/api/agent/tools` call `resolveConnections` directly, unfiltered by module flags).

- [ ] **Step 2: Move the shared logic into `connections.ts`**

In `server/agent/connections.ts`, add after `resolveConnections`:

```ts
export interface AgentContext {
  providers: ToolProvider[];
  conexoes: { wake: boolean; tiny: boolean };
}

/**
 * Which tools a user's account can see, combining the per-module opt-in
 * flags (users/{uid}.modules.contentAgent / .operationsAgent) with actual
 * Wake/Tiny connection state. A module being off hides its tools from the
 * model entirely — same principle resolveConnections already applies to
 * unconnected platforms, extended to cover the content/operations split.
 * Shared by contentAgentChat.ts (the chat itself) and routes.ts
 * (introspection endpoints) so the two never disagree about what an
 * account can see.
 */
export async function resolveAgentContext(uid: string): Promise<AgentContext> {
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
export async function requireAnyModule(uid: string): Promise<void> {
  const snap = await adminDb.collection('users').doc(uid).get();
  const modules = snap.data()?.modules ?? {};
  if (modules.contentAgent !== true && modules.operationsAgent !== true) {
    throw Object.assign(new Error('Nenhum módulo de agente está habilitado nesta conta.'), { status: 403 });
  }
}
```

- [ ] **Step 3: Point `contentAgentChat.ts` at the shared functions**

In `server/agent/contentAgentChat.ts`, delete the local `interface AgentContext { ... }`, `async function resolveAgentContext(...) { ... }`, and `async function requireAnyModule(...) { ... }` definitions (added when this plan's backend predecessor built them — they're now in `connections.ts`). Replace the import line:

```ts
import { resolveConnections } from './connections';
```

with:

```ts
import { resolveAgentContext, requireAnyModule } from './connections';
```

- [ ] **Step 4: Add `dryRun` to the executed-action patch**

In `server/agent/contentAgentChat.ts`'s `resolveAndContinue`, find:

```ts
  } else {
    status = 'executed';
    let parsed: unknown = toolResult?.content;
    try { parsed = toolResult ? JSON.parse(toolResult.content) : undefined; } catch { /* mantém string crua */ }
    patch = { status, result: parsed };
  }
```

Change the last line to:

```ts
    patch = { status, result: parsed, dryRun: process.env.AGENT_DRY_RUN === 'true' };
```

Also add `dryRun?: boolean;` to the local `interface ContentAgentAction { ... }` in the same file, alongside its other optional fields (`resolvedAt?`, `result?`, `error?`).

- [ ] **Step 5: Module-gate the introspection routes**

In `server/agent/routes.ts`, delete the local `requireAnyModule` function and its import line for `adminDb` stays (still used by `/api/agent/logs`). Replace:

```ts
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
```

with:

```ts
import { adminDb } from '../firebaseAdmin';
import { describeTools } from './registry';
import { resolveAgentContext, requireAnyModule } from './connections';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}
```

Then replace the `/api/agent/connections` handler body:

```ts
  app.get('/api/agent/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      return res.json(await resolveConnections(uid));
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
```

with:

```ts
  app.get('/api/agent/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const ctx = await resolveAgentContext(uid);
      return res.json({ wake: ctx.conexoes.wake, tiny: ctx.conexoes.tiny, providers: ctx.providers });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
```

And the `/api/agent/tools` handler body:

```ts
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
```

with:

```ts
  app.get('/api/agent/tools', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await requireAnyModule(uid);
      const ctx = await resolveAgentContext(uid);
      return res.json({ providers: ctx.providers, tools: describeTools(ctx.providers) });
    } catch (e: any) {
      return res.status(httpStatus(e)).json({ message: e?.message });
    }
  });
```

- [ ] **Step 6: Type-check the backend changes**

```bash
npm run lint
```

Expected: only the 3 pre-existing baseline errors (see Global Constraints).

- [ ] **Step 7: Merge the frontend types**

Replace the entire contents of `src/types/agent.ts` with:

```ts
// Tipos do agente unificado (Conteúdo + Operações), compartilhados pelo
// módulo e pelo serviço. Espelham server/agent/types.ts — mantenha os dois
// em sincronia.

export type ToolProvider = 'wake' | 'tiny' | 'docs' | 'content';

export interface PreviewField {
  campo: string;
  antes: unknown;
  depois: unknown;
  mudou: boolean;
}

export interface ActionPreview {
  resumo: string;
  alvo: string;
  campos: PreviewField[];
  avisos: string[];
  /** Nome da ferramenta e argumentos originais — dá pra UI renderizar um
   * formulário específico por ferramenta (ex.: content.credencial.conectar)
   * em vez do diff padrão. Sempre presentes: registry.ts inclui os dois em
   * todo interrupt(), de qualquer provider. */
  ferramenta?: string;
  args?: Record<string, unknown>;
}

export type AgentActionStatus = 'pending' | 'executed' | 'failed' | 'rejected';

export interface AgentAction {
  id: string;
  threadId: string;
  tool: string;
  provider: ToolProvider;
  args: Record<string, unknown>;
  preview: ActionPreview;
  status: AgentActionStatus;
  createdAt: string;
  resolvedAt?: string;
  result?: unknown;
  error?: string;
  dryRun?: boolean;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'model';
  texto: string;
  actionIds?: string[];
  leituras?: { tool: string; ok: boolean; erro?: string }[];
  createdAt: string;
}

export interface AgentConnections {
  wake: boolean;
  tiny: boolean;
  providers: ToolProvider[];
}

export interface AgentToolInfo {
  name: string;
  provider: ToolProvider;
  mode: 'read' | 'write';
  description: string;
}

export interface AgentLog {
  id: string;
  provider: 'wake' | 'tiny';
  tool?: string;
  /** GET/POST/PUT na Wake; nome do endpoint .php no Tiny. */
  operacao: string;
  alvo: string;
  requisicao?: unknown;
  resposta?: unknown;
  status: number | null;
  ok: boolean;
  erro?: string | null;
  ms: number;
  at: string;
}

// O que está aberto no workspace de conteúdo agora (projeto selecionado,
// artigo em foco) — mandado a cada mensagem/ação pra o agente saber por
// padrão de qual projeto o usuário está falando, sem precisar perguntar o
// ID (que a UI nunca mostra). Espelha WorkspaceContext em
// server/agent/contentGraph.ts.
export interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
}
```

This drops `AgentThread` (no more thread listing — single implicit thread) and `ThreadAttachment` (no attachment support).

- [ ] **Step 8: Delete the now-redundant content type file**

```bash
git rm src/types/contentAgent.ts
```

- [ ] **Step 9: Create the merged service**

Create `src/services/agentChatService.ts`:

```ts
// Client do agente unificado (Conteúdo + Operações). Leituras da conversa
// vêm do Firestore em tempo real; tudo que avança a conversa vai por
// /api/agent/*, porque só o servidor pode escrever mensagens e mudar o
// status de uma ação. SSE é só o canal de "pensando ao vivo".
//
// Substitui src/services/operationsService.ts e
// src/services/contentAgentChatService.ts — thread única implícita
// ('principal', mesmo id que server/agent/contentAgentChat.ts usa), sem
// lista de conversas.

import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AgentAction, AgentConnections, AgentLog, AgentToolInfo, ThreadMessage, WorkspaceContext,
} from '../types/agent';

const AGENT_THREAD_ID = 'principal';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

/**
 * Um 200 com HTML significa que a requisição caiu no fallback do SPA, ou seja, a
 * rota de API não existe naquela instância — quase sempre servidor desatualizado,
 * já que `tsx server.ts` não recarrega o backend. Sem este check, o erro chega
 * como "Unexpected token '<'", que não aponta para nada.
 */
function assertJson(resp: Response): void {
  const tipo = resp.headers.get('content-type') ?? '';
  if (!tipo.includes('application/json')) {
    throw new Error(
      `O servidor respondeu ${tipo || 'sem content-type'} em vez de JSON em ${new URL(resp.url).pathname}. `
      + 'A rota provavelmente não existe nesta instância — reinicie o servidor (npm run dev).',
    );
  }
}

async function call<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: await authHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assertJson(resp);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Erro ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const fetchConnections = () => call<AgentConnections>('/api/agent/connections');
export const fetchTools = () => call<{ providers: string[]; tools: AgentToolInfo[] }>('/api/agent/tools');

/** Diagnóstico: últimas chamadas HTTP feitas a Wake/Tiny, com request e response. */
export const fetchLogs = (opts: { apenasErros?: boolean; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.apenasErros) p.set('erros', '1');
  p.set('limit', String(opts.limit ?? 50));
  return call<{ logs: AgentLog[] }>(`/api/agent/logs?${p}`).then((r) => r.logs);
};

// --- Listeners em tempo real -------------------------------------------------

const userCol = (...path: string[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Não autenticado');
  return collection(db, 'users', uid, ...path);
};

export function listenMessages(cb: (msgs: ThreadMessage[]) => void): () => void {
  const q = query(userCol('agent_threads', AGENT_THREAD_ID, 'messages'), orderBy('createdAt'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as ThreadMessage));
  });
}

export function listenActions(cb: (actions: AgentAction[]) => void): () => void {
  const q = query(userCol('agent_actions'), orderBy('createdAt'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as AgentAction));
  });
}

// --- SSE ----------------------------------------------------------------

export interface StreamHandlers {
  onDelta?: (texto: string) => void;
  onLeitura?: (e: { tool: string; ok: boolean; erro?: string }) => void;
  onAcao?: (a: AgentAction) => void;
  onResultado?: (e: { actionId: string; status: string; error?: string | null }) => void;
  onErro?: (msg: string) => void;
  onFim?: () => void;
}

/**
 * POST que responde text/event-stream. EventSource não serve aqui porque só
 * faz GET e não manda o header de autorização, então o stream é lido na mão
 * a partir do corpo da resposta.
 */
async function stream(url: string, body: unknown, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const tipo = resp.headers.get('content-type') ?? '';
    if (!tipo.includes('application/json')) {
      throw new Error(
        `O servidor respondeu ${tipo || 'sem content-type'} em vez de iniciar o stream. `
        + 'A rota provavelmente não existe nesta instância — reinicie o servidor (npm run dev).',
      );
    }
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Erro ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const despachar = (evento: string, dados: string) => {
    let payload: any = {};
    try { payload = JSON.parse(dados); } catch { /* evento sem corpo útil */ }
    switch (evento) {
      case 'delta': h.onDelta?.(payload.texto ?? ''); break;
      case 'leitura': h.onLeitura?.(payload); break;
      case 'acao': h.onAcao?.(payload); break;
      case 'resultado': h.onResultado?.(payload); break;
      case 'erro': h.onErro?.(payload.message ?? 'Falha no agente.'); break;
      case 'fim': h.onFim?.(); break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const evento = frame.match(/^event: (.+)$/m)?.[1];
      const dados = frame.match(/^data: ([\s\S]*)$/m)?.[1];
      if (evento) despachar(evento, dados ?? '{}');
    }
  }
  h.onFim?.();
}

export const enviarMensagem = (
  texto: string,
  h: StreamHandlers,
  signal?: AbortSignal,
  contexto?: WorkspaceContext,
) => stream('/api/agent/messages', { texto, contexto }, h, signal);

export const executarAcao = (actionId: string, h: StreamHandlers, contexto?: WorkspaceContext) =>
  stream(`/api/agent/actions/${actionId}/execute`, { contexto }, h);

export const rejeitarAcao = (actionId: string, h: StreamHandlers, contexto?: WorkspaceContext) =>
  stream(`/api/agent/actions/${actionId}/reject`, { contexto }, h);
```

- [ ] **Step 10: Delete the two old services**

```bash
git rm src/services/operationsService.ts src/services/contentAgentChatService.ts
```

- [ ] **Step 11: Remove the dead Firestore rules for the retired collections**

In `firestore.rules`, delete this block (the collections it names are no longer written by anything after the backend plan's Task 3):

```
      // Agente de Conteúdo conversacional (LangGraph.js + ponte REST/SSE em
      // server/agent/contentAgentChat.ts). Mesmo motivo do Agente Operacional
      // acima: o dono só lê, toda escrita passa pelo servidor (Admin SDK),
      // que também é quem grava os checkpoints do LangGraph nesta mesma
      // subcoleção de thread — o cliente nunca acessa `checkpoints` porque
      // não há regra permitindo, então fica bloqueada por padrão.
      match /content_agent_threads/{threadId} {
        allow read: if isOwner(userId);
        allow write: if false;

        match /messages/{messageId} {
          allow read: if isOwner(userId);
          allow write: if false;
        }
      }
      match /content_agent_actions/{actionId} {
        allow read: if isOwner(userId);
        allow write: if false;
      }
```

Update the comment above the surviving `agent_threads`/`agent_actions` block (currently says "Agente Operacional") to:

```
      // Agente unificado (Conteúdo + Operações). O dono lê a conversa para
      // renderizar o chat, mas toda escrita passa pelo servidor: as
      // mensagens são o histórico que alimenta o modelo, e as ações
      // carregam o status de aprovação. Deixar o cliente escrever aqui
      // permitiria forjar um 'approved' e pular o gate. O servidor também
      // grava os checkpoints do LangGraph nesta mesma subcoleção de thread
      // — o cliente nunca acessa `checkpoints` porque não há regra
      // permitindo, então fica bloqueada por padrão.
```

This file change needs a manual `firebase deploy --only firestore:rules` at deploy time — note it in Task 6's checklist, this plan cannot deploy rules from here.

- [ ] **Step 12: Type-check everything so far**

```bash
npm run lint
```

Expected: errors for every file that still imports the deleted `contentAgent.ts`/`operationsService.ts`/`contentAgentChatService.ts` — that's expected right now, Task 2's relocation fixes them. If `App.tsx` or `ContentApp.tsx` themselves error at this point, that's also expected (not touched until Task 5) — just confirm the errors are all import-not-found for the paths this step deleted, nothing else new.

- [ ] **Step 13: Commit**

```bash
git add server/agent/connections.ts server/agent/contentAgentChat.ts server/agent/routes.ts src/types/agent.ts src/services/agentChatService.ts firestore.rules
git add -u src/types/contentAgent.ts src/services/operationsService.ts src/services/contentAgentChatService.ts
git commit -m "feat(agent): module-gate introspection routes, merge frontend types and service layer"
```

---

### Task 2: Shared chat components

Consolidates the two near-duplicate component sets (`src/modules/operations/{ChatThread,ActionCard,Composer,Markdown,LogsPanel}.tsx` and `src/modules/content/chat/{ContentChatThread,ContentActionCard,ContentComposer,CredentialForm}.tsx`) into one, under a new `src/modules/agent/chat/` directory. Base each merged component on whichever original is more complete, folding in the other's unique behavior (the credential-form branch, the dry-run badge), and drop attachment handling per the Global Constraints note.

**Files:**
- Create: `src/modules/agent/chat/Markdown.tsx`, `src/modules/agent/chat/CredentialForm.tsx`, `src/modules/agent/chat/ActionCard.tsx`, `src/modules/agent/chat/ChatThread.tsx`, `src/modules/agent/chat/Composer.tsx`, `src/modules/agent/chat/LogsPanel.tsx`
- Delete: `src/modules/operations/{ChatThread,ActionCard,Composer,Markdown,LogsPanel}.tsx`, `src/modules/content/chat/{ContentChatThread,ContentActionCard,ContentComposer,CredentialForm}.tsx`

**Interfaces:**
- Produces: `ChatThread` props `{ uid: string; mensagens: ThreadMessage[]; acoes: Record<string, AgentAction>; parcial: string; leituras: {tool,ok,erro?}[]; streaming: boolean; erro: string | null; onExecutar: (id: string) => Promise<void>; onRejeitar: (id: string) => Promise<void> }`. `Composer` props `{ disabled: boolean; streaming: boolean; onEnviar: (texto: string) => void; onParar: () => void; placeholder?: string }`. `LogsPanel` props `{ aberto: boolean; onFechar: () => void }`. All consumed by Task 4's `AgentHomeScreen`.

- [ ] **Step 1: Relocate `Markdown.tsx` unchanged**

```bash
mkdir -p src/modules/agent/chat
git mv src/modules/operations/Markdown.tsx src/modules/agent/chat/Markdown.tsx
```

No content changes — it has no dependency on either agent's types.

- [ ] **Step 2: Relocate `CredentialForm.tsx` unchanged**

```bash
git mv src/modules/content/chat/CredentialForm.tsx src/modules/agent/chat/CredentialForm.tsx
```

No content changes — it only imports from `../../../services/contentService`, which is unaffected by this migration (its relative path `../../../services/contentService` still resolves correctly from the new location, since both old and new paths are 3 levels under `src/`).

- [ ] **Step 3: Create the merged `ActionCard.tsx`**

Create `src/modules/agent/chat/ActionCard.tsx`:

```tsx
import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import type { AgentAction, PreviewField } from '../../../types/agent';
import { CredentialForm } from './CredentialForm';

interface Props {
  uid: string;
  action: AgentAction;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
}

function formatar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const Linha: React.FC<{ campo: PreviewField }> = ({ campo }) => (
  <div className={`grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${campo.mudou ? '' : 'opacity-50'}`}>
    <div className="text-slate-500 truncate" title={campo.campo}>{campo.campo}</div>
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <span className={`truncate max-w-full ${campo.mudou ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-600'}`}>
        {formatar(campo.antes)}
      </span>
      {campo.mudou && (
        <>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <span className="font-medium text-slate-900 break-words">{formatar(campo.depois)}</span>
        </>
      )}
    </div>
  </div>
);

/**
 * content.credencial.conectar é a única ferramenta que pausa mas não mostra o
 * diff padrão — a senha/token nunca vira argumento de tool call (nunca passa
 * pelo modelo), então o formulário grava o segredo direto no Firestore e só
 * então resolve a ação (aprovando ou rejeitando o interrupt).
 */
const ActionCard: React.FC<Props> = ({ uid, action, onExecutar, onRejeitar }) => {
  const [busy, setBusy] = useState<'executar' | 'rejeitar' | null>(null);
  const pendente = action.status === 'pending';
  const semMudanca = action.preview.campos.length > 0 && action.preview.campos.every((c) => !c.mudou);

  const rodar = async (qual: 'executar' | 'rejeitar') => {
    setBusy(qual);
    try {
      await (qual === 'executar' ? onExecutar(action.id) : onRejeitar(action.id));
    } finally {
      setBusy(null);
    }
  };

  if (pendente && action.tool === 'content.credencial.conectar') {
    const args = action.args as { provider?: 'wordpress' | 'sanity'; projectId?: string };
    if (args.provider && args.projectId) {
      return (
        <CredentialForm
          uid={uid}
          provider={args.provider}
          projectId={args.projectId}
          onDone={(ok) => void (ok ? onExecutar(action.id) : onRejeitar(action.id))}
        />
      );
    }
  }

  const selo = {
    pending: { texto: 'Aguardando sua aprovação', classe: 'bg-amber-50 text-amber-700 border-amber-200' },
    executed: { texto: action.dryRun ? 'Simulado (dry-run)' : 'Executado', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    failed: { texto: 'Falhou', classe: 'bg-red-50 text-red-700 border-red-200' },
    rejected: { texto: 'Rejeitado', classe: 'bg-slate-100 text-slate-500 border-slate-200' },
  }[action.status];

  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-opacity ${pendente ? 'border-[#FF5B03]/40 shadow-sm' : 'border-slate-200'} ${action.status === 'rejected' ? 'opacity-60' : ''}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-slate-900 text-sm">{action.preview.resumo}</div>
          <div className="text-xs text-slate-500 mt-0.5 truncate" title={action.preview.alvo}>{action.preview.alvo}</div>
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-1 rounded-full border ${selo.classe}`}>
          {selo.texto}
        </span>
      </div>

      {action.preview.campos.length > 0 && (
        <div className="divide-y divide-slate-50">
          {action.preview.campos.map((c, i) => <Linha key={`${c.campo}-${i}`} campo={c} />)}
        </div>
      )}

      {action.preview.avisos.length > 0 && (
        <div className="px-4 py-3 bg-amber-50/60 border-t border-amber-100 space-y-1.5">
          {action.preview.avisos.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {action.error && (
        <div className="px-4 py-3 bg-red-50 border-t border-red-100 text-xs text-red-700">{action.error}</div>
      )}

      {pendente && (
        <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={() => rodar('executar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FF5B03] text-white text-sm font-medium hover:bg-[#e65003] disabled:opacity-50 transition-colors"
          >
            {busy === 'executar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Executar
          </button>
          <button
            onClick={() => rodar('rejeitar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-200/70 disabled:opacity-50 transition-colors"
          >
            {busy === 'rejeitar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Rejeitar
          </button>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            {semMudanca ? 'Nada muda' : 'Nada é alterado até você aprovar'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionCard;
```

- [ ] **Step 4: Delete the two old action cards**

```bash
git rm src/modules/operations/ActionCard.tsx src/modules/content/chat/ContentActionCard.tsx
```

- [ ] **Step 5: Create the merged `ChatThread.tsx`**

Create `src/modules/agent/chat/ChatThread.tsx` (based on the operations version, `uid` threaded through to `ActionCard` for the credential form, attachment rendering removed since `ThreadMessage` no longer carries `anexos`):

```tsx
import React, { useEffect, useRef } from 'react';
import { AlertCircle, Bot, Check, Search, X } from 'lucide-react';
import type { AgentAction, ThreadMessage } from '../../../types/agent';
import ActionCard from './ActionCard';
import Markdown from './Markdown';

interface Props {
  uid: string;
  mensagens: ThreadMessage[];
  acoes: Record<string, AgentAction>;
  parcial: string;
  leituras: { tool: string; ok: boolean; erro?: string }[];
  streaming: boolean;
  erro: string | null;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
}

const Leitura: React.FC<{ tool: string; ok: boolean; erro?: string }> = ({ tool, ok, erro }) => (
  <div className="flex items-center gap-2 text-xs text-slate-400" title={erro}>
    {ok ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-red-400" />}
    <span className="font-mono">{tool}</span>
    {erro && <span className="text-red-400 truncate max-w-xs">— {erro}</span>}
  </div>
);

const Avatar = () => (
  <div className="w-7 h-7 rounded-lg bg-[#FF5B03]/10 flex items-center justify-center shrink-0">
    <Bot className="w-4 h-4 text-[#FF5B03]" />
  </div>
);

const ChatThread: React.FC<Props> = ({
  uid, mensagens, acoes, parcial, leituras, streaming, erro, onExecutar, onRejeitar,
}) => {
  const fimRef = useRef<HTMLDivElement>(null);
  const grudarRef = useRef(true);

  // Só rola sozinho se o usuário já estiver no fim — senão atrapalha quem
  // voltou para reler algo enquanto o agente responde.
  const aoRolar = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    grudarRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (grudarRef.current) fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens.length, parcial, leituras.length]);

  return (
    <div onScroll={aoRolar} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {mensagens.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] bg-slate-100 rounded-2xl rounded-tr-sm px-4 py-2.5 text-[15px] text-slate-800 whitespace-pre-wrap">
                  {m.texto}
                </div>
              </div>
            );
          }

          const cards = (m.actionIds ?? []).map((id) => acoes[id]).filter(Boolean);
          if (!m.texto && !m.leituras?.length && !cards.length) return null;

          return (
            <div key={m.id} className="flex gap-3">
              <Avatar />
              <div className="min-w-0 flex-1 space-y-3">
                {!!m.leituras?.length && (
                  <div className="space-y-1">
                    {m.leituras.map((l, i) => <Leitura key={i} {...l} />)}
                  </div>
                )}
                {m.texto && <Markdown texto={m.texto} />}
                {cards.map((a) => (
                  <ActionCard key={a.id} uid={uid} action={a} onExecutar={onExecutar} onRejeitar={onRejeitar} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Turno em andamento: leituras + texto que ainda está chegando. */}
        {(streaming || parcial || leituras.length > 0) && (
          <div className="flex gap-3">
            <Avatar />
            <div className="min-w-0 flex-1 space-y-3">
              {leituras.length > 0 && (
                <div className="space-y-1">
                  {leituras.map((l, i) => <Leitura key={i} {...l} />)}
                </div>
              )}
              {parcial ? (
                <Markdown texto={parcial} />
              ) : streaming && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Search className="w-3.5 h-3.5 animate-pulse" />
                  <span>pensando…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {erro && (
          <div className="flex gap-3">
            <Avatar />
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          </div>
        )}

        <div ref={fimRef} />
      </div>
    </div>
  );
};

export default ChatThread;
```

- [ ] **Step 6: Delete the two old chat threads**

```bash
git rm src/modules/operations/ChatThread.tsx src/modules/content/chat/ContentChatThread.tsx
```

- [ ] **Step 7: Create the merged `Composer.tsx`**

Create `src/modules/agent/chat/Composer.tsx` (based on `ContentComposer.tsx` — no attachment UI — with the operations version's wider `max-w-3xl` centering, matching the new full-page layout):

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface Props {
  disabled: boolean;
  streaming: boolean;
  onEnviar: (texto: string) => void;
  onParar: () => void;
  placeholder?: string;
}

const Composer: React.FC<Props> = ({ disabled, streaming, onEnviar, onParar, placeholder }) => {
  const [texto, setTexto] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Cresce com o conteúdo até um teto, como no Claude.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [texto]);

  const enviar = () => {
    if (disabled || streaming) return;
    if (!texto.trim()) return;
    onEnviar(texto.trim());
    setTexto('');
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm focus-within:border-slate-300 transition-colors">
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? 'Pergunte algo ou peça uma ação…'}
            className="w-full resize-none bg-transparent px-4 py-3.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <span className="text-[11px] text-slate-400 ml-1.5">Enter envia · Shift+Enter quebra linha</span>
            {streaming ? (
              <button
                onClick={onParar}
                title="Parar"
                className="p-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={enviar}
                disabled={disabled || !texto.trim()}
                title="Enviar"
                className="p-2 rounded-lg bg-[#FF5B03] text-white hover:bg-[#e65003] disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Composer;
```

- [ ] **Step 8: Delete the two old composers**

```bash
git rm src/modules/operations/Composer.tsx src/modules/content/chat/ContentComposer.tsx
```

- [ ] **Step 9: Relocate `LogsPanel.tsx`, repointing its imports**

```bash
git mv src/modules/operations/LogsPanel.tsx src/modules/agent/chat/LogsPanel.tsx
```

Then in the moved file, update the two import lines:

```ts
import type { AgentLog } from '../../types/agent';
import { fetchLogs } from '../../services/operationsService';
```

to:

```ts
import type { AgentLog } from '../../../types/agent';
import { fetchLogs } from '../../../services/agentChatService';
```

(One extra `../` because the file moved one directory deeper, from `src/modules/operations/` to `src/modules/agent/chat/`.)

- [ ] **Step 10: Type-check**

```bash
npm run lint
```

Expected: `src/modules/content/ContentApp.tsx` and `src/App.tsx` still error (they import the now-deleted `ContentAgentPanel`/`OperationsApp` — fixed in Task 5). No errors from anything under `src/modules/agent/` or `src/services/agentChatService.ts`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(agent): merge the two chat component sets into src/modules/agent/chat"
```

---

### Task 3: Three.js particle sphere

**Files:**
- Create: `src/modules/agent/AgentSphere.tsx`
- Modify: `package.json`, `package-lock.json` (new dependency)

**Interfaces:**
- Produces: `<AgentSphere size={number} active={boolean} />`, a self-contained React component with no external state — consumed by Task 4's `AgentHomeScreen`.

- [ ] **Step 1: Install `three`**

```bash
npm install three
```

Recent `three` releases ship their own TypeScript types (no separate `@types/three` needed) — confirm after install:

```bash
grep -n '"three"' package.json
ls node_modules/three/src/Three.d.ts 2>&1 || ls node_modules/three/build/three.core.d.ts 2>&1
```

Expected: `three` in `package.json` dependencies, and at least one of the two `.d.ts` paths exists.

- [ ] **Step 2: Create the component**

Create `src/modules/agent/AgentSphere.tsx`:

```tsx
// Esfera de partículas conectadas por linhas — o núcleo visual do agente.
// Réplica em three.js de verdade do protótipo do canvas de design (que
// simulava o mesmo efeito em Canvas 2D porque o canvas de design roda em
// iframe sandboxed sem egress de rede, inviabilizando carregar a lib ali).
//
// Espírito do exemplo oficial webgl_buffergeometry_drawrange: todos os
// pares de pontos são pré-computados uma vez; a cada frame, só os pares com
// distância atual menor que `minDistance` entram no drawRange do
// LineSegments. `minDistance` oscila continuamente (Math.sin) — mais forte
// enquanto `active` (o agente está processando/respondendo), mais discreta
// em repouso, para a esfera nunca parecer estática.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  /** Lado do quadrado em px. */
  size?: number;
  /** true enquanto uma resposta está em andamento (SSE delta/leitura chegando). */
  active?: boolean;
}

const N = 90;
const RADIUS = 1;

function fibonacciSphere(n: number): Float32Array {
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    pts[i * 3] = Math.cos(theta) * r * RADIUS;
    pts[i * 3 + 1] = y * RADIUS;
    pts[i * 3 + 2] = Math.sin(theta) * r * RADIUS;
  }
  return pts;
}

export default function AgentSphere({ size = 132, active = false }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Lido dentro do loop de animação, que não deve reiniciar a cada mudança
  // de `active` — só o valor lido a cada frame precisa estar atualizado.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const positions = fibonacciSphere(N);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.z = 2.6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Nós.
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointsMat = new THREE.PointsMaterial({ color: 0xff5b03, size: 0.035, sizeAttenuation: true });
    const points = new THREE.Points(pointsGeo, pointsMat);
    group.add(points);

    // Todo par possível, pré-computado uma vez; o drawRange recorta pra só
    // os pares cuja distância atual é menor que minDistance, a cada frame.
    const pairs: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) pairs.push([i, j]);
    }
    const linePositions = new Float32Array(pairs.length * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.35 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    group.add(lines);

    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      group.rotation.y = t * 0.15;

      const amplitude = activeRef.current ? 0.5 : 0.18;
      const base = activeRef.current ? 0.85 : 0.62;
      const minDistance = base + Math.sin(t * 1.1) * amplitude;

      let count = 0;
      const linePos = lineGeo.attributes.position as THREE.BufferAttribute;
      for (const [i, j] of pairs) {
        const ax = positions[i * 3], ay = positions[i * 3 + 1], az = positions[i * 3 + 2];
        const bx = positions[j * 3], by = positions[j * 3 + 1], bz = positions[j * 3 + 2];
        const d = Math.hypot(ax - bx, ay - by, az - bz);
        if (d < minDistance) {
          linePos.setXYZ(count * 2, ax, ay, az);
          linePos.setXYZ(count * 2 + 1, bx, by, bz);
          count++;
        }
      }
      linePos.needsUpdate = true;
      lineGeo.setDrawRange(0, count * 2);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      pointsGeo.dispose();
      pointsMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return <div ref={mountRef} style={{ width: size, height: size }} />;
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: only the pre-existing baseline errors.

- [ ] **Step 3: Manual visual check**

There's no page mounting this yet (Task 4 does that) — for a quick isolated check, temporarily render it somewhere reachable, e.g. add `<AgentSphere active />` at the very top of `renderApp`'s returned JSX in `src/App.tsx` (right after the opening `<div>`), run `npm run dev`, open the app, confirm you see a small rotating sphere of orange dots with dark connecting lines that pulse in and out. Then remove the temporary line — do not commit it.

```bash
npm run dev
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/modules/agent/AgentSphere.tsx
git commit -m "feat(agent): add the three.js particle sphere component"
```

---

### Task 4: New home screen page

**Files:**
- Create: `src/modules/agent/AgentHomeScreen.tsx`

**Interfaces:**
- Consumes: `agentChatService.{fetchConnections,listenMessages,listenActions,enviarMensagem,executarAcao,rejeitarAcao}` (Task 1), `ChatThread`/`Composer`/`LogsPanel` (Task 2), `AgentSphere` (Task 3), `listenProjects` from `../../services/contentService` (existing).
- Produces: `<AgentHomeScreen uid={string} credits={number} products={Product[]} hasContentAgent={boolean} hasOperationsAgent={boolean} onOpenIntegrations={() => void} onManageContent={() => void} />`, mounted by Task 5 as the `'home'` `mainView`.

- [ ] **Step 1: Confirm the `Product` type's description field**

```bash
grep -n "'Descrição'" src/types/models.ts src/App.tsx | head -5
```

Expected: confirms the field key is literally `'Descrição'` on the `Product` type, matching what Task 5 passes in from `App.tsx`'s existing `products` state.

- [ ] **Step 2: Create the page**

Create `src/modules/agent/AgentHomeScreen.tsx`:

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, FileText, Loader2, ScrollText, Store, Zap } from 'lucide-react';
import type { Product } from '../../types/models';
import type { AgentAction, AgentConnections, ThreadMessage } from '../../types/agent';
import {
  enviarMensagem, executarAcao, fetchConnections, listenActions, listenMessages, rejeitarAcao,
} from '../../services/agentChatService';
import { listenProjects } from '../../services/contentService';
import AgentSphere from './AgentSphere';
import ChatThread from './chat/ChatThread';
import Composer from './chat/Composer';
import LogsPanel from './chat/LogsPanel';

interface Props {
  uid: string;
  credits: number;
  products: Product[];
  hasContentAgent: boolean;
  hasOperationsAgent: boolean;
  onOpenIntegrations: () => void;
  onManageContent: () => void;
}

const SUGESTOES = [
  'Gere a descrição dos produtos sem descrição ainda',
  'Quais banners estão ativos na home da loja?',
  'Qual o preço e o estoque do SKU ABC-123?',
  'Crie um artigo novo pra um cluster de conteúdo',
];

const AgentHomeScreen: React.FC<Props> = ({
  uid, credits, products, hasContentAgent, hasOperationsAgent, onOpenIntegrations, onManageContent,
}) => {
  const [mensagens, setMensagens] = useState<ThreadMessage[]>([]);
  const [acoes, setAcoes] = useState<Record<string, AgentAction>>({});
  const [conns, setConns] = useState<AgentConnections | null>(null);
  const [projetosCount, setProjetosCount] = useState<number | null>(null);
  const [parcial, setParcial] = useState('');
  const [leituras, setLeituras] = useState<{ tool: string; ok: boolean; erro?: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [logsAberto, setLogsAberto] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const off1 = listenMessages(setMensagens);
    const off2 = listenActions((list) => {
      setAcoes(Object.fromEntries(list.map((a) => [a.id, a])));
    });
    return () => { off1(); off2(); };
  }, [uid]);

  useEffect(() => {
    if (!hasOperationsAgent) return;
    let vivo = true;
    fetchConnections().then((c) => { if (vivo) setConns(c); }).catch(() => {});
    return () => { vivo = false; };
  }, [hasOperationsAgent]);

  useEffect(() => {
    if (!hasContentAgent) return;
    return listenProjects(uid, (list) => setProjetosCount(list.length));
  }, [uid, hasContentAgent]);

  const handlers = useMemo(() => ({
    onDelta: (t: string) => setParcial((p) => p + t),
    onLeitura: (l: { tool: string; ok: boolean; erro?: string }) => setLeituras((p) => [...p, l]),
    // O card chega pelo listener do Firestore; aqui só limpamos o rascunho
    // para não duplicar o texto que já foi persistido na mensagem.
    onAcao: () => { setParcial(''); setLeituras([]); },
    onErro: (m: string) => setErro(m),
    onFim: () => { setParcial(''); setLeituras([]); },
  }), []);

  const enviar = async (texto: string) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await enviarMensagem(texto, handlers, ctrl.signal);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErro(e?.message ?? 'Falha ao falar com o agente.');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const responder = async (fn: () => Promise<void>) => {
    setErro(null);
    setParcial('');
    setLeituras([]);
    setStreaming(true);
    try {
      await fn();
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao processar a ação.');
    } finally {
      setStreaming(false);
    }
  };

  const executar = (id: string) => responder(() => executarAcao(id, handlers));
  const rejeitar = (id: string) => responder(() => rejeitarAcao(id, handlers));
  const parar = () => { abortRef.current?.abort(); setStreaming(false); };

  const acoesPendentesOperacionais = Object.values(acoes)
    .filter((a) => a.status === 'pending' && (a.provider === 'wake' || a.provider === 'tiny')).length;
  const acoesPendentesConteudo = Object.values(acoes)
    .filter((a) => a.status === 'pending' && a.provider === 'content').length;

  const totalProdutos = products.length;
  const comDescricao = totalProdutos
    ? Math.round((products.filter((p) => !!p['Descrição']?.trim()).length / totalProdutos) * 100)
    : 0;

  const semChat = mensagens.length === 0 && !streaming;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-end px-1 pb-2">
        <button
          onClick={() => setLogsAberto(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Ver as chamadas feitas à API da Wake e do Tiny"
        >
          <ScrollText className="w-4 h-4" /> Logs
        </button>
      </div>

      <div className="flex-1 min-h-0 relative rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col">
        {semChat ? (
          <div className="flex-1 overflow-y-auto px-6 py-10">
            <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6">
              <AgentSphere size={132} active={streaming} />
              <div className="space-y-2">
                <h1 className="text-xl font-semibold text-[#141311]">Como posso ajudar hoje?</h1>
                <p className="text-sm text-slate-500 max-w-md">
                  Peça para gerar descrições, escrever um artigo ou executar uma ação no seu ERP —
                  eu mostro exatamente o que vai mudar antes de qualquer alteração.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3 w-full mt-2">
                <div className="rounded-xl border border-slate-200 p-4 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <Boxes className="w-4 h-4 text-[#FF5B03]" />
                    <span className="text-xs font-semibold text-slate-700">Produtos</span>
                  </div>
                  <p className="text-2xl font-semibold text-[#141311]">{totalProdutos.toLocaleString('pt-BR')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{comDescricao}% com descrição</p>
                </div>

                {hasContentAgent && (
                  <div className="rounded-xl border border-slate-200 p-4 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-[#3053FF]" />
                      <span className="text-xs font-semibold text-slate-700">Conteúdo</span>
                    </div>
                    <p className="text-2xl font-semibold text-[#141311]">{projetosCount ?? '—'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {acoesPendentesConteudo > 0 ? `${acoesPendentesConteudo} ação(ões) pendente(s)` : 'projeto(s) de conteúdo'}
                    </p>
                  </div>
                )}

                {hasOperationsAgent && (
                  <div className="rounded-xl border border-slate-200 p-4 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-semibold text-slate-700">Operações</span>
                    </div>
                    {conns && !conns.wake && !conns.tiny ? (
                      <button onClick={onOpenIntegrations} className="text-sm text-[#FF5B03] font-medium hover:underline">
                        Conectar plataforma
                      </button>
                    ) : (
                      <>
                        <p className="text-2xl font-semibold text-[#141311]">{acoesPendentesOperacionais}</p>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          {conns?.wake && <Store className="w-3 h-3" />}
                          {conns?.tiny && <Boxes className="w-3 h-3" />}
                          ação(ões) pendente(s)
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-left w-full mt-2">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    onClick={() => enviar(s)}
                    className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ChatThread
            uid={uid}
            mensagens={mensagens}
            acoes={acoes}
            parcial={parcial}
            leituras={leituras}
            streaming={streaming}
            erro={erro}
            onExecutar={executar}
            onRejeitar={rejeitar}
          />
        )}

        <Composer disabled={false} streaming={streaming} onEnviar={enviar} onParar={parar} />
      </div>

      <LogsPanel aberto={logsAberto} onFechar={() => setLogsAberto(false)} />
    </div>
  );
};

export default AgentHomeScreen;
```

Notes on what changed from the design-canvas prototype: the floating context cards and the SVG "tendril" connectors from the mockup are replaced with plain bordered cards laid out in a responsive grid, and the sphere only appears on the empty-conversation state (matching how the mockup's hero treatment reads before a conversation starts) rather than staying pinned above an active thread. Precisely reproducing the mockup's pixel-positioned tendrils connecting to N conditionally-rendered cards (1–3 depending on which modules are enabled) would need a `ResizeObserver`-driven measurement system for a purely decorative element — not worth the fragility for what the cards need to do here. `credits` is accepted as a prop for a future use (e.g. a low-balance nudge) but not rendered yet — remove the prop if `tsc` flags it unused after this task; keep it if a later step in this task's review finds a use.

- [ ] **Step 3: Type-check**

```bash
npm run lint
```

Fix any TypeScript error before moving on — in particular, confirm `Product['Descrição']` is typed as `string | undefined` (not e.g. `unknown`) so `.trim()` in `comDescricao`'s filter type-checks; if it's typed more loosely, adjust the filter to `String(p['Descrição'] ?? '').trim()` instead.

- [ ] **Step 4: Commit**

```bash
git add src/modules/agent/AgentHomeScreen.tsx
git commit -m "feat(agent): add the unified chat-first home screen"
```

---

### Task 5: Wire into App.tsx, retire the old surfaces

**Files:**
- Modify: `src/App.tsx` (new `'home'` mainView + default, sidebar collapse, remove Operations route/button, rename Content button)
- Modify: `src/modules/content/ContentApp.tsx` (remove the `ContentAgentPanel` wrapper)
- Delete: `src/modules/operations/OperationsApp.tsx`, `src/modules/content/chat/ContentAgentPanel.tsx`

**Interfaces:** none new — this task only wires existing pieces together.

- [ ] **Step 1: Remove the `ContentAgentPanel` wrapper from `ContentApp.tsx`**

In `src/modules/content/ContentApp.tsx`, delete the import:

```ts
import { ContentAgentPanel } from './chat/ContentAgentPanel';
```

Then find the `return` statement (starts with `<ContentAgentPanel ... >` around line 78, ends with `</ContentAgentPanel>` around line 243) and remove just the wrapper tags, keeping everything between them:

```tsx
    <ContentAgentPanel
      uid={uid}
      projeto={selected ? { id: selected.id, nomeEmpresa: selected.config.nomeEmpresa } : null}
      articleId={openArticleId}
    >
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
```

becomes:

```tsx
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
```

and:

```tsx
    </div>
    </ContentAgentPanel>
  );
```

becomes:

```tsx
    </div>
  );
```

Leave the rest of the file's indentation as-is (it's one level deeper than it needs to be now — a pure cosmetic issue, not worth the diff noise of reindenting ~165 lines for this change).

- [ ] **Step 2: Delete the retired panel and app files**

```bash
git rm src/modules/content/chat/ContentAgentPanel.tsx src/modules/operations/OperationsApp.tsx
```

- [ ] **Step 3: Confirm nothing else references them**

```bash
grep -rn "ContentAgentPanel\|OperationsApp" --include="*.tsx" --include="*.ts" src
```

Expected: no matches (the `App.tsx` references are removed in the steps below — if this grep still shows `App.tsx` lines at this point in the task, that's expected until Step 4 runs; re-run this check after Step 4 as well).

- [ ] **Step 4: Add the `'home'` mainView and make it the default**

In `src/App.tsx`, change:

```tsx
  const [mainView, setMainView] = useState<'products' | 'categories' | 'history' | 'integrations' | 'tutorial' | 'referral' | 'company'>('products');
```

to:

```tsx
  const [mainView, setMainView] = useState<'home' | 'products' | 'categories' | 'history' | 'integrations' | 'tutorial' | 'referral' | 'company'>('home');
```

- [ ] **Step 5: Import `AgentHomeScreen`**

Near the top of `src/App.tsx`, alongside the other lazy imports (find `const OperationsApp = lazy(...)` and delete that line — the component it pointed to no longer exists), add:

```ts
import AgentHomeScreen from './modules/agent/AgentHomeScreen';
```

`AgentHomeScreen` is a normal (non-lazy) import — unlike `OperationsApp`/`ContentApp`, it's not a whole separate route bundle, it's the default view, so there's no benefit to code-splitting it out.

- [ ] **Step 6: Remove the `workspace === 'operations'` branch**

In `src/App.tsx`, delete this whole block:

```tsx
  if (user && workspace === 'operations') {
    return (
      <Suspense fallback={<div className="h-screen flex items-center justify-center bg-[#f7f9fb] text-slate-400"><RefreshCw className="w-6 h-6 animate-spin" /></div>}>
        <OperationsApp
          user={user}
          credits={credits}
          onSwitchToProduct={() => setWorkspace('product')}
          onBuyCredits={() => setIsCreditPurchaseOpen(true)}
          onLogout={handleLogout}
        />
      </Suspense>
    );
  }
```

Leave the `workspace === 'content'` block right after it untouched — `ContentApp` is still a real, reachable workspace.

Also update the `workspace` state type: find `const [workspace, setWorkspace] = useState<'product' | 'content' | 'operations'>('product');` and drop `'operations'`:

```tsx
  const [workspace, setWorkspace] = useState<'product' | 'content'>('product');
```

- [ ] **Step 7: Remove the Operations sidebar button, rename the Content one**

In the sidebar block, replace:

```tsx
        {/* Workspace switcher — only when Content Agent module is enabled */}
        {hasContentAgent && (
          <div className="px-3 mb-3">
            <button
              onClick={() => { setWorkspace('content'); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
              title="Trocar para a Agente de Conteúdo"
            >
              <FileText className="w-4 h-4" /> Ir para Agente de Conteúdo
            </button>
          </div>
        )}

        {/* Agente Operacional — opera Wake/Tiny por conversa, com aprovação por ação */}
        {hasOperationsAgent && (
          <div className="px-3 mb-3">
            <button
              onClick={() => { setWorkspace('operations'); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
              title="Trocar para o Agente Operacional"
            >
              <Zap className="w-4 h-4" /> Ir para Agente Operacional
            </button>
          </div>
        )}
```

with:

```tsx
        {/* Workspace de gestão de conteúdo (projetos, clusters, calendário, artigos) — o chat do agente agora vive na tela Início, não mais aqui dentro. */}
        {hasContentAgent && (
          <div className="px-3 mb-3">
            <button
              onClick={() => { setWorkspace('content'); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
              title="Gerenciar clusters, calendário e artigos de conteúdo"
            >
              <FileText className="w-4 h-4" /> Gerenciar Conteúdo
            </button>
          </div>
        )}
```

- [ ] **Step 8: Add the "Início" nav item**

In the `<nav>` block, add a new first entry before the existing "Produtos" button:

```tsx
        <nav className="mt-2 px-3 flex flex-col gap-1 flex-1">
          <button
            onClick={() => { setMainView('home'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'home' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
          >
            <Sparkles className="w-4 h-4" /> Início
          </button>
          <button
            onClick={() => { setMainView('products'); setIsSidebarOpen(false); }}
```

(The rest of the `nav` block — Categorias, the divider, Histórico, Indique e Ganhe — stays exactly as it is; only the opening `<nav>` tag and the first button are new.)

- [ ] **Step 9: Render `AgentHomeScreen` for the new mainView**

Find the ternary chain that picks what `<main>` renders and add `'home'` as the first branch:

```tsx
        <main className="flex-1 overflow-y-auto w-full p-6 pb-20 md:pb-6 bg-[#f7f9fb]">
          {mainView === 'categories' ? (
```

becomes:

```tsx
        <main className="flex-1 overflow-y-auto w-full p-6 pb-20 md:pb-6 bg-[#f7f9fb]">
          {mainView === 'home' ? (
            <AgentHomeScreen
              uid={user.uid}
              credits={credits}
              products={products}
              hasContentAgent={hasContentAgent}
              hasOperationsAgent={hasOperationsAgent}
              onOpenIntegrations={() => setMainView('integrations')}
              onManageContent={() => setWorkspace('content')}
            />
          ) : mainView === 'categories' ? (
```

- [ ] **Step 10: Collapsible sidebar — add the state and toggle**

In `src/App.tsx`, near the other sidebar-related state (`isSidebarOpen`), add:

```tsx
  // Rail colapsada por padrão — a tela Início (chat) é o ponto de entrada
  // agora, e a sidebar não deve competir por espaço com ela. Afeta só
  // desktop (md:); no mobile a sidebar já era um overlay controlado por
  // isSidebarOpen, sem conceito de "colapsada".
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
```

- [ ] **Step 11: Collapsible sidebar — apply the width and hide labels when collapsed**

Change the `<aside>` opening tag:

```tsx
      <aside className={`
        fixed inset-y-0 left-0 w-[260px] bg-[#141311] text-white flex-shrink-0 flex flex-col z-40 
        shadow-[4px_0_24px_rgba(0,0,0,0.05)] pt-4 transition-transform duration-300 md:static md:translate-x-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
```

to:

```tsx
      <aside className={`
        fixed inset-y-0 left-0 w-[260px] ${sidebarCollapsed ? 'md:w-[76px]' : 'md:w-[260px]'} bg-[#141311] text-white flex-shrink-0 flex flex-col z-40 
        shadow-[4px_0_24px_rgba(0,0,0,0.05)] pt-4 transition-[width,transform] duration-300 md:static md:translate-x-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
```

Add a collapse toggle button right after the logo header block (`<div className="h-16 px-5 ...">...</div>`, before the "Gerenciar Conteúdo" button from Step 7):

```tsx
        <div className="hidden md:block px-3 mb-2">
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <Menu className="w-4 h-4" />
            {!sidebarCollapsed && <span className="text-xs font-medium">Recolher</span>}
          </button>
        </div>
```

Then, in the nav buttons added/edited in Steps 7–8 and the existing Categorias/Histórico/Indique e Ganhe buttons, wrap each button's text label so it only renders when expanded — for example, the "Início" button from Step 8:

```tsx
          <button
            onClick={() => { setMainView('home'); setIsSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${mainView === 'home' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#FF5B03] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}
            title="Início"
          >
            <Sparkles className="w-4 h-4 shrink-0" /> {!sidebarCollapsed && 'Início'}
          </button>
```

Apply the same `title="..."` + `{!sidebarCollapsed && '...'}` pattern to every other nav button in this sidebar (Gerenciar Conteúdo, Produtos, Categorias, Histórico, Indique e Ganhe, and the footer's Tutorial/Integrações/Empresa buttons) — each currently reads `<Icon className="w-4 h-4" /> Label text`; change to `<Icon className="w-4 h-4 shrink-0" /> {!sidebarCollapsed && 'Label text'}` and add a `title="Label text"` prop to the `<button>` for accessibility and so a collapsed-rail user still gets a tooltip. The referral "ping" badge (`{!referralNavSeen && (...)}`) and the credits/video-queue widgets stay as they are — when collapsed, hide the whole video-queue widget block (wrap its existing `{activeVideoJob && (() => {...})()}` condition with an additional `!sidebarCollapsed &&`, since its content is text-heavy and doesn't reduce to icon-only sensibly) rather than trying to compress it.

- [ ] **Step 12: Type-check**

```bash
npm run lint
```

Expected: only the 3 pre-existing baseline errors. If `Sparkles` or `Menu` show as "possibly unused" anywhere, that means one of the edits above didn't land — double check Steps 8–11 against the current file.

- [ ] **Step 13: Manual verification in the browser**

```bash
npm run dev
```

Open the app, log in, and check:
- The app lands on the new "Início" home screen by default, sidebar collapsed to icon rail.
- Clicking the rail toggle expands the sidebar (labels appear); clicking again collapses it.
- "Início" nav item is highlighted when on the home screen; clicking "Produtos"/"Categorias"/etc. still works exactly as before.
- If `modules.contentAgent` is on for the logged-in account: "Gerenciar Conteúdo" opens `ContentApp` (project/cluster/calendar pages), with no floating chat button anymore.
- If `modules.operationsAgent` is on: the "Operações" card on the home screen shows a real pending-action count (or a "Conectar plataforma" link if nothing is connected).
- Sending a message on the home screen streams a response, and any proposed write shows an approval card with working Aprovar/Rejeitar buttons.
- The "Logs" button in the home screen opens the same diagnostics panel the old `OperationsApp` had.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(agent): mount the unified home screen, retire OperationsApp and ContentAgentPanel"
```

---

### Task 6: Deploy checklist (manual, not automatable from here)

**Files:** none.

- [ ] **Step 1: Deploy the updated Firestore rules**

```bash
firebase deploy --only firestore:rules
```

This applies Task 1 Step 11's rule cleanup. Do this only after confirming (via the backend plan's own Task 5) that nothing is still writing to the old `content_agent_threads`/`content_agent_actions` paths.

- [ ] **Step 2: Confirm the backend plan's endpoints are live in the target environment**

This plan is useless without `docs/superpowers/plans/2026-08-31-unified-agent-backend.md` deployed first — re-run that plan's Task 5 (manual end-to-end verification) against the same environment this frontend is about to ship to, if that hasn't already been done.

- [ ] **Step 3: Cross-browser / responsive pass**

Check the new home screen at a phone width (375px) and a tablet width (768px) in addition to desktop — the context-card grid (`grid sm:grid-cols-3`) and the sidebar's mobile overlay behavior (unchanged from before, `isSidebarOpen`) are the two things most likely to need a follow-up fix if something looks broken.
