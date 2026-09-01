// Resolves which platforms a given user is actually linked to, and builds the
// ToolCtx handed to every tool.
//
// This is what makes the agent answer "verificar em qual e-commerce ele está
// vinculado" structurally: unconnected providers never enter the model's tool
// list, so the model cannot hallucinate a call into a platform the account has
// no credentials for. It says "Tiny não está conectado" because the tool is
// genuinely absent, not because a prompt told it to.

import { adminDb } from '../firebaseAdmin';
import { getV2Token } from '../tinyV2';
import type { ToolCtx, ToolProvider } from './types';

const WAKE_SECRET = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('wake');

export interface Connections {
  wake: boolean;
  tiny: boolean;
  providers: ToolProvider[];
}

async function wakeToken(uid: string): Promise<string | null> {
  const snap = await WAKE_SECRET(uid).get();
  const token = snap.exists ? snap.data()?.token : null;
  return typeof token === 'string' && token ? token : null;
}

export async function resolveConnections(uid: string): Promise<Connections> {
  const [wake, tiny] = await Promise.all([
    wakeToken(uid).catch(() => null),
    // The operational agent is v2-only: getV2Token returns null for accounts on
    // the v3/OAuth path, which correctly leaves tiny.* out of the tool list.
    getV2Token(uid).catch(() => null),
  ]);

  const providers: ToolProvider[] = [];
  if (wake) providers.push('wake');
  if (tiny) providers.push('tiny');
  // Documentation lookup is always available — it reads docs, never the store.
  providers.push('docs');

  return { wake: !!wake, tiny: !!tiny, providers };
}

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

const notConnected = (nome: string) =>
  Object.assign(new Error(`${nome} não está conectado nesta conta.`), { status: 400 });

export function buildContext(uid: string, opts: { dryRun?: boolean } = {}): ToolCtx {
  return {
    uid,
    dryRun: opts.dryRun ?? process.env.AGENT_DRY_RUN === 'true',
    async wakeToken() {
      const t = await wakeToken(uid);
      if (!t) throw notConnected('Wake');
      return t;
    },
    async tinyToken() {
      const t = await getV2Token(uid);
      if (!t) throw notConnected('Tiny (v2)');
      return t;
    },
  };
}
