// IdWorks ERP inbound webhook receiver. Mirrors tinyWebhook.ts's per-user
// secret-URL pattern (no HMAC on IdWorks' side, so the URL secret is the only
// auth surface): a config route mints/rotates the secret and hands back the
// callback URL, and the public route validates it, dedupes, then upserts the
// changed SKU. Docs describe the envelope only in prose ("Topic, AccountName,
// ModificationTimestamp, and resource identifiers with relative URLs") — see
// parseWebhookEnvelope below and docs/superpowers/specs/2026-08-24-idworks-integration-design.md
// ("Pendências" #2) for why the exact field names are a best-effort guess.
import express from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { idworksFetch, normalizeProduct, STATUS_REF, publicBaseUrl } from './idworksAgent';
import { upsertProduct } from './idworksImportWorker';

const EVENT_REF = (dedupKey: string) => adminDb.collection('idworks_webhook_events').doc(dedupKey);
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

// The exact JSON field names IdWorks sends are not shown anywhere in the
// public docs (only described in prose: "Topic, AccountName,
// ModificationTimestamp, and resource identifiers with relative URLs"). This
// function is the single place to fix once a real webhook payload is
// captured (spec "Pendências" #2) — it tries the documented field names and
// a couple of plausible casings, and fails loudly (400) if none match, so a
// wrong guess surfaces immediately in the logs instead of silently no-op'ing.
function parseWebhookEnvelope(body: any): { topic: string; idSku: string | null; modifiedAt: string | null } {
  const topic = body?.Topic ?? body?.topic ?? '';
  const idSku = body?.IDSku ?? body?.idSku ?? body?.Id ?? body?.ResourceId ?? body?.id ?? null;
  const modifiedAt = body?.ModificationTimestamp ?? body?.modificationTimestamp ?? null;
  return { topic: String(topic), idSku: idSku != null ? String(idSku) : null, modifiedAt: modifiedAt != null ? String(modifiedAt) : null };
}

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerIdworksWebhookRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Authenticated: set sync mode, (re)generate the webhook secret.
  app.post('/api/idworks/webhook/config', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const statusSnap = await STATUS_REF(uid).get();
      const cur = statusSnap.data() ?? {};
      const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (req.body?.syncMode === 'polling' || req.body?.syncMode === 'webhook') update.syncMode = req.body.syncMode;

      let secret = cur.webhookSecret as string | undefined;
      if (!secret || req.body?.regenerateSecret === true) {
        secret = crypto.randomBytes(24).toString('hex');
        update.webhookSecret = secret;
      }
      await STATUS_REF(uid).set(update, { merge: true });

      const webhookUrl = `${publicBaseUrl(req)}/api/idworks/webhook/${uid}/${secret}`;
      const headerValue = `Bearer ${secret}`;
      return res.json({ webhookUrl, headerName: 'Authorization', headerValue, syncMode: update.syncMode ?? cur.syncMode ?? 'polling' });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao salvar configuração do webhook.' });
    }
  });

  // Public: IdWorks calls this when a SKU changes. No documented auth from
  // IdWorks' side, so the URL carries a per-user secret. `type: () => true`
  // forces JSON parsing regardless of the Content-Type header IdWorks sends
  // (undocumented) — mirrors tinyWebhook.ts's route-level parser.
  app.post('/api/idworks/webhook/:uid/:secret', express.json({ type: () => true }), async (req, res) => {
    const { uid, secret } = req.params;
    try {
      const statusSnap = await STATUS_REF(uid).get();
      const settings = statusSnap.data() ?? {};
      if (!settings.webhookSecret || settings.webhookSecret !== secret) {
        console.warn(`[idworks-webhook] rejeitado uid=${uid}: secret inválido`);
        return res.status(403).json({ message: 'Secret inválido.' });
      }

      const { topic, idSku, modifiedAt } = parseWebhookEnvelope(req.body);
      if (!idSku) {
        console.warn(`[idworks-webhook] payload sem referência de SKU uid=${uid} body=${JSON.stringify(req.body).slice(0, 500)}`);
        return res.status(200).json({ ok: true }); // ack anyway — don't make IdWorks retry a shape we can't parse
      }

      const dedupKey = crypto.createHash('sha256').update(`${topic}:${idSku}:${modifiedAt ?? ''}`).digest('hex');
      const dedupRef = EVENT_REF(dedupKey);
      const dedupSnap = await dedupRef.get();
      if (dedupSnap.exists) return res.status(200).json({ ok: true });
      await dedupRef.set({ uid, topic, idSku, createdAt: FieldValue.serverTimestamp() });

      // Deletion topics: mark instead of fetching (the SKU may 404 once removed).
      if (/delete/i.test(topic)) {
        const productsSnap = await PRODUCTS(uid).where('_idworksProductId', '==', idSku).limit(1).get();
        if (!productsSnap.empty) {
          await productsSnap.docs[0].ref.set({ _idworksDeleted: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      } else {
        const detail = await idworksFetch<any[]>(uid, 'GET', `/sku/${idSku}`);
        const normalized = normalizeProduct(Array.isArray(detail) ? detail[0] : detail);
        await upsertProduct(uid, normalized, 'idworks-webhook');
      }

      await STATUS_REF(uid).set({
        webhookStats: { lastReceivedAt: new Date().toISOString(), totalReceived: FieldValue.increment(1) },
      }, { merge: true });

      return res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error(`[idworks-webhook] erro uid=${uid}: ${e?.message}\n${e?.stack ?? ''}`);
      return res.status(500).json({ message: 'Erro ao processar webhook.' });
    }
  });
}
