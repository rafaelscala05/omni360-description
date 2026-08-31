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
