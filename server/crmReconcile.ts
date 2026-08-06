// Reconciliação do CRM: deriva os marcos da jornada a partir do estado ATUAL do
// Firestore, sem depender de eventos.
//
// É o que popula o CRM para os usuários que já existiam antes da base de eventos
// (que não têm evento nenhum, mas têm produtos, credit_logs e integrações), e
// funciona como rede de segurança contínua contra beacon perdido.
//
// Idempotente: rodar duas vezes produz o mesmo resultado. Preserva os campos que
// só o admin controla (pipelineStatus, tags).

import { adminDb } from './firebaseAdmin';
import {
  GENERATION_ACTION_KEYS,
  computeHealth,
  emptySummary,
  isoWeek,
  resolveStage,
} from './crmStage';
import type { CrmStage, CrmSummary } from '../src/types/crm';

const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

function earliest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

// Timestamps no projeto são gravados ora como string ISO (credit_logs, products),
// ora como Timestamp do Firestore (serverTimestamp em onboarding/integrações).
function toIso(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const ts = value as { toDate?: () => Date } | undefined;
  if (ts?.toDate) {
    const d = ts.toDate();
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

export async function reconcileUser(uid: string): Promise<CrmSummary | null> {
  const ref = adminDb.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};

  const now = new Date();
  const nowIso = now.toISOString();
  const existing = data.crm as CrmSummary | undefined;

  const accountCreated =
    existing?.firstSeenAt ?? toIso(data.onboarding?.completedAt) ?? toIso(data.lastSync) ?? nowIso;

  const milestones: Partial<Record<CrmStage, string>> = {
    ...(existing?.milestones ?? {}),
    signed_up: existing?.milestones?.signed_up ?? accountCreated,
  };

  const counters = {
    products: 0,
    descriptions: existing?.counters.descriptions ?? 0,
    images: existing?.counters.images ?? 0,
    exports: existing?.counters.exports ?? 0,
    erpSyncs: existing?.counters.erpSyncs ?? 0,
    aiOps30d: 0,
  };

  const weeks = new Set<string>(existing?.activeWeeks ?? []);
  let lastSeenAt = existing?.lastSeenAt ?? accountCreated;
  let firstSeenAt = existing?.firstSeenAt ?? accountCreated;

  // --- Produtos: comprovam "Subiu Produtos" ---
  const productsSnap = await ref.collection('products').select('createdAt').get();
  counters.products = productsSnap.size;
  if (productsSnap.size > 0) {
    let first: string | undefined;
    for (const doc of productsSnap.docs) {
      const created = toIso(doc.get('createdAt'));
      if (created) first = earliest(first, created);
    }
    milestones.products_uploaded = earliest(milestones.products_uploaded, first ?? accountCreated);
  }

  // --- credit_logs: comprovam "Gerou Descrição ou Imagem" e alimentam contadores.
  // É a fonte autoritativa da jornada: cada operação de IA debita crédito de
  // forma transacional, então este log não pode ser burlado sem custo.
  const logsSnap = await ref.collection('credit_logs').get();
  const cutoff30d = new Date(now.getTime() - 30 * 86400000).toISOString();
  let hasPurchased = data.hasPurchased === true;

  for (const doc of logsSnap.docs) {
    const log = doc.data() as {
      actionKey?: string;
      timestamp?: string;
      type?: string;
      creditsAdded?: number;
    };
    const ts = toIso(log.timestamp);
    if (!ts) continue;

    if (log.type === 'purchase') hasPurchased = true;

    // Só consumo conta como "uso": bônus e compra não são atividade do cliente
    // na ferramenta.
    const isConsumption = !!log.actionKey && log.type !== 'bonus' && log.type !== 'purchase';
    if (!isConsumption) continue;

    if (ts > lastSeenAt) lastSeenAt = ts;
    firstSeenAt = earliest(firstSeenAt, ts) ?? firstSeenAt;
    const week = isoWeek(ts);
    if (week) weeks.add(week);
    if (ts >= cutoff30d) counters.aiOps30d += 1;

    if (log.actionKey && GENERATION_ACTION_KEYS.includes(log.actionKey)) {
      milestones.content_generated = earliest(milestones.content_generated, ts);
    }
  }

  // --- Integrações ERP: comprovam "Integrou ou Exportou" ---
  const [tiny, bling, wake] = await Promise.all([
    ref.collection('settings').doc('tiny').get(),
    ref.collection('settings').doc('bling').get(),
    ref.collection('settings').doc('wake').get(),
  ]);
  const connectedAt = [tiny, bling, wake]
    .filter((s) => s.exists && s.get('connected') === true)
    .map((s) => toIso(s.get('connectedAt')) ?? accountCreated)
    .sort()[0];
  if (connectedAt) {
    milestones.integrated_or_exported = earliest(milestones.integrated_or_exported, connectedAt);
  }

  // --- 'active': ≥2 semanas distintas de uso após integrar/exportar ---
  const activeWeeks = [...weeks].sort();
  if (milestones.integrated_or_exported && !milestones.active) {
    const since = isoWeek(milestones.integrated_or_exported);
    const after = activeWeeks.filter((w) => w >= since);
    if (after.length >= 2) milestones.active = after[1];
  }

  const stage = resolveStage(milestones);
  const base = existing ?? emptySummary(accountCreated);
  let summary: CrmSummary = {
    ...base,
    stage,
    stageEnteredAt: milestones[stage] ?? base.stageEnteredAt,
    firstSeenAt,
    lastSeenAt,
    milestones,
    counters,
    activeWeeks,
    // Campos que só o admin controla — nunca sobrescrever na reconciliação.
    pipelineStatus: base.pipelineStatus,
    pipelineUpdatedAt: base.pipelineUpdatedAt,
    pipelineUpdatedBy: base.pipelineUpdatedBy,
    tags: base.tags,
    updatedAt: nowIso,
  };

  const { score, band } = computeHealth(summary, now, {
    credits: Number(data.credits ?? 0),
    hasPurchased,
  });
  summary = { ...summary, healthScore: score, healthBand: band };

  await ref.set({ crm: summary }, { merge: true });
  return summary;
}

export async function reconcileAll(): Promise<{ processed: number; failed: number }> {
  const usersSnap = await adminDb.collection('users').select().get();
  let processed = 0;
  let failed = 0;
  // Sequencial de propósito: reconciliação é trabalho de fundo, e serializar
  // evita estourar a cota de leitura do Firestore numa base grande.
  for (const doc of usersSnap.docs) {
    try {
      await reconcileUser(doc.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(`crm reconcile falhou para ${doc.id}:`, err);
    }
  }
  return { processed, failed };
}

// Mesmo padrão de startTinyScheduler / startContentScheduler.
export function startCrmScheduler(): void {
  const run = () => {
    void reconcileAll()
      .then(({ processed, failed }) => {
        console.log(`crm reconcile: ${processed} usuários, ${failed} falhas`);
      })
      .catch((err) => console.error('crm scheduler falhou:', err));
  };
  setTimeout(run, 60_000); // 1min após o boot, para não competir com o startup
  setInterval(run, RECONCILE_INTERVAL_MS);
}
