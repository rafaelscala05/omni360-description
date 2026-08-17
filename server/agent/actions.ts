// Lifecycle of a pending write action: propose → approve → execute → audit.
//
// This module is the ONLY place that calls a tool's execute(). The model loop
// (loop.ts) can reach preview() but has no path to execute(), so "every action
// is authorised by the user" holds structurally rather than by prompt.
//
// The approval is also idempotent by construction: executeAction flips the
// status inside a transaction and refuses anything not in 'pending', so a
// double-clicked button or a retried request cannot run the same write twice.

import { adminDb } from '../firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost } from '../../src/credits';
import { getTool } from './registry';
import { buildContext } from './connections';
import type { ActionPreview, AgentAction, ToolProvider } from './types';

const actionsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_actions');
const auditCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_audit');

// A Firestore document caps at 1 MiB. Previews carry request bodies (HTML
// descriptions, attribute lists), so refuse to persist anything near the limit
// rather than failing opaquely at write time.
const MAX_PAYLOAD_BYTES = 600 * 1024;

function assertPersistable(preview: ActionPreview): void {
  const bytes = Buffer.byteLength(JSON.stringify(preview));
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw Object.assign(
      new Error(`A prévia desta ação ficou grande demais (${Math.round(bytes / 1024)} KB). Divida a operação em partes menores.`),
      { status: 400 },
    );
  }
}

/** Firestore rejects undefined; previews legitimately contain optional fields. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

export async function createAction(input: {
  uid: string;
  threadId: string;
  tool: string;
  provider: ToolProvider;
  args: Record<string, unknown>;
  preview: ActionPreview;
  callId?: string;
}): Promise<AgentAction> {
  assertPersistable(input.preview);
  const ref = actionsCol(input.uid).doc();
  const action: AgentAction = {
    id: ref.id,
    threadId: input.threadId,
    tool: input.tool,
    provider: input.provider,
    args: stripUndefined(input.args),
    preview: stripUndefined(input.preview),
    status: 'pending',
    callId: input.callId,
    createdAt: new Date().toISOString(),
  };
  await ref.set(stripUndefined(action));
  return action;
}

export async function getAction(uid: string, actionId: string): Promise<AgentAction> {
  const snap = await actionsCol(uid).doc(actionId).get();
  if (!snap.exists) throw Object.assign(new Error('Ação não encontrada.'), { status: 404 });
  return snap.data() as AgentAction;
}

/**
 * Claims a pending action for execution. Runs in a transaction so two concurrent
 * approvals cannot both proceed — the loser sees the already-resolved status.
 */
async function claim(uid: string, actionId: string): Promise<AgentAction> {
  const ref = actionsCol(uid).doc(actionId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('Ação não encontrada.'), { status: 404 });
    const action = snap.data() as AgentAction;
    if (action.status !== 'pending') {
      throw Object.assign(
        new Error(`Esta ação já foi ${action.status === 'executed' ? 'executada' : action.status === 'rejected' ? 'rejeitada' : 'processada'}.`),
        { status: 409 },
      );
    }
    // Mark it resolved up-front; the outcome is written after the call returns.
    tx.update(ref, { status: 'executed', resolvedAt: new Date().toISOString() });
    return action;
  });
}

async function debitCredit(uid: string, tool: string): Promise<void> {
  const action = CREDIT_ACTIONS.agentAction;
  const configSnap = await adminDb.collection('config').doc('credits').get().catch(() => null);
  const costs = (configSnap?.data()?.costs as Record<string, number>) ?? {};
  const cost = resolveCreditCost(costs, action.key);
  const userRef = adminDb.collection('users').doc(uid);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('Usuário não encontrado.');
    const current = snap.data()?.credits ?? 0;
    if (current < cost) throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { status: 402 });
    tx.update(userRef, { credits: current - cost });
    tx.set(userRef.collection('credit_logs').doc(), {
      actionType: action.label,
      actionKey: action.key,
      productName: tool,
      sku: 'N/A',
      userName: '',
      creditsConsumed: cost,
      timestamp: new Date().toISOString(),
    });
  });
}

export interface ExecuteOutcome {
  action: AgentAction;
  result?: unknown;
  error?: string;
}

/**
 * Runs an approved action. Credits are debited BEFORE the outbound call so an
 * account without balance never touches the remote API; if the call then fails,
 * the action is marked failed and the debit stands — same trade-off the rest of
 * the app makes for AI operations.
 */
export async function executeAction(uid: string, actionId: string): Promise<ExecuteOutcome> {
  const action = await claim(uid, actionId);
  const ref = actionsCol(uid).doc(actionId);
  const tool = getTool(action.tool);

  if (!tool || tool.mode !== 'write' || !tool.execute) {
    const error = `Ferramenta "${action.tool}" não está disponível para execução.`;
    await ref.update({ status: 'failed', error });
    return { action: { ...action, status: 'failed' }, error };
  }

  const ctx = buildContext(uid);
  try {
    await debitCredit(uid, action.tool);
    const result = await tool.execute(ctx, action.args as never, action.preview);
    const stored = stripUndefined(result);
    await ref.update({ status: 'executed', result: stored, dryRun: ctx.dryRun });
    await auditCol(uid).add({
      actionId,
      threadId: action.threadId,
      tool: action.tool,
      provider: action.provider,
      resumo: action.preview.resumo,
      alvo: action.preview.alvo,
      args: action.args,
      result: stored,
      dryRun: ctx.dryRun,
      at: new Date().toISOString(),
    });
    return { action: { ...action, status: 'executed', result: stored }, result };
  } catch (e: any) {
    const error = e?.message ?? 'Falha ao executar a ação.';
    await ref.update({ status: 'failed', error });
    await auditCol(uid).add({
      actionId,
      threadId: action.threadId,
      tool: action.tool,
      provider: action.provider,
      resumo: action.preview.resumo,
      erro: error,
      at: new Date().toISOString(),
    });
    return { action: { ...action, status: 'failed', error }, error };
  }
}

export async function rejectAction(uid: string, actionId: string, motivo?: string): Promise<AgentAction> {
  const ref = actionsCol(uid).doc(actionId);
  const action = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('Ação não encontrada.'), { status: 404 });
    const a = snap.data() as AgentAction;
    if (a.status !== 'pending') {
      throw Object.assign(new Error('Esta ação já foi processada.'), { status: 409 });
    }
    tx.update(ref, {
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
      ...(motivo ? { error: motivo } : {}),
    });
    return a;
  });
  return { ...action, status: 'rejected' };
}

/** Pending actions block the thread from advancing — the loop checks this. */
export async function pendingActions(uid: string, threadId: string): Promise<AgentAction[]> {
  const snap = await actionsCol(uid)
    .where('threadId', '==', threadId)
    .where('status', '==', 'pending')
    .get();
  return snap.docs.map((d) => d.data() as AgentAction);
}
