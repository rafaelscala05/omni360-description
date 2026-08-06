// Ingestão de eventos do CRM. Escreve em users/{uid}/events e atualiza o resumo
// denormalizado users/{uid}.crm no mesmo batch.
//
// NUNCA derruba o fluxo do produto: toda falha aqui é só logada, mesmo padrão de
// server/metaEvents.ts. Um evento perdido é aceitável — o reconciliador
// (server/crmReconcile.ts) recompõe o estado a partir do Firestore.

import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { applyEventToSummary, computeHealth, emptySummary } from './crmStage';
import { CLIENT_EVENT_NAMES, type CrmEventSource, type CrmSummary } from '../src/types/crm';

const userRef = (uid: string) => adminDb.collection('users').doc(uid);

export async function recordEvent(
  uid: string,
  name: string,
  props: Record<string, unknown> = {},
  source: CrmEventSource = 'server',
): Promise<void> {
  try {
    if (!uid || !name) return;
    const ts = new Date().toISOString();
    const ref = userRef(uid);
    const snap = await ref.get();
    if (!snap.exists) return;

    const data = snap.data() ?? {};
    const current = (data.crm as CrmSummary | undefined) ?? emptySummary(ts);
    let next = applyEventToSummary(current, name, ts);
    const { score, band } = computeHealth(next, new Date(ts), {
      credits: Number(data.credits ?? 0),
      hasPurchased: data.hasPurchased === true,
    });
    next = { ...next, healthScore: score, healthBand: band };

    const batch = adminDb.batch();
    batch.set(ref.collection('events').doc(), { name, ts, source, props });
    batch.set(ref, { crm: next }, { merge: true });
    await batch.commit();
  } catch (err) {
    console.error('crm recordEvent falhou:', err);
  }
}

// Recalcula só o health (usado pelo scheduler: a recência decai com o tempo,
// mesmo sem nenhum evento novo).
export async function refreshHealth(uid: string): Promise<void> {
  try {
    const ref = userRef(uid);
    const snap = await ref.get();
    const data = snap.data();
    const crm = data?.crm as CrmSummary | undefined;
    if (!crm) return;
    const { score, band } = computeHealth(crm, new Date(), {
      credits: Number(data?.credits ?? 0),
      hasPurchased: data?.hasPurchased === true,
    });
    if (score === crm.healthScore && band === crm.healthBand) return;
    await ref.set({ crm: { ...crm, healthScore: score, healthBand: band } }, { merge: true });
  } catch (err) {
    console.error('crm refreshHealth falhou:', err);
  }
}

export function registerCrmEventRoutes(
  app: express.Application,
  deps: { verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }> },
): void {
  // Beacon do client, autenticado como usuário comum (NÃO admin). Cobre só o que
  // é genuinamente client-side: import/export de planilha (SheetJS roda no
  // browser) e login. Sempre responde 200 — telemetria nunca quebra o app.
  app.post('/api/events', (req, res) => {
    res.status(200).json({ received: true });
    void (async () => {
      try {
        const { uid } = await deps.verifyFirebaseToken(req);
        const name = String(req.body?.name ?? '');
        if (!(CLIENT_EVENT_NAMES as readonly string[]).includes(name)) return;
        const props = (req.body?.props ?? {}) as Record<string, unknown>;
        await recordEvent(uid, name, props, 'client');
      } catch (err) {
        console.error('beacon /api/events falhou:', err);
      }
    })();
  });
}
