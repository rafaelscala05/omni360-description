// Bling ERP app-level product webhook (API v3). Unlike Tiny (one secret URL per
// user), Bling has a SINGLE callback URL per application, shared by every merchant
// that authorized the app. Each event carries a companyId; the user is resolved
// via the bling_companies reverse map. Every request is HMAC-SHA256 signed
// (X-Bling-Signature-256: sha256=<hex>, over the raw body, keyed with the app
// client_secret). We answer 2xx within 5s and process (fetch detail + upsert) in
// the background, deduped per eventId. Docs: https://developer.bling.com.br/webhooks
import express from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { blingFetch, normalizeProduct, STATUS_REF, COMPANY_REF } from './blingAgent';
import { upsertProduct } from './blingImportWorker';

const CLIENT_SECRET = process.env.BLING_CLIENT_SECRET ?? '';
const EVENT_REF = (eventId: string) => adminDb.collection('bling_webhook_events').doc(String(eventId));
const PRODUCTS = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

// Constant-time compare of the received signature against the expected HMAC.
function validSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !CLIENT_SECRET) return false;
  const received = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = crypto.createHmac('sha256', CLIENT_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Runs after the 2xx response. Fetches the product detail (created/updated) or
// flags the local doc as deleted, then updates webhook stats.
async function processEvent(uid: string, event: string, productId: string): Promise<void> {
  try {
    if (event.endsWith('.deleted') || event.endsWith('.excluir') || event === 'produto.deleted') {
      const snap = await PRODUCTS(uid).where('_blingProductId', '==', String(productId)).limit(1).get();
      const doc = snap.docs[0];
      if (doc) await doc.ref.set({ _blingDeleted: true, updatedAt: new Date().toISOString() }, { merge: true });
    } else {
      const detail = await blingFetch<any>(uid, 'GET', `/produtos/${productId}`).catch(() => null);
      if (detail?.data) await upsertProduct(uid, normalizeProduct(detail.data), 'bling-webhook');
    }
    await STATUS_REF(uid).set({
      webhookStats: {
        lastReceivedAt: new Date().toISOString(),
        totalReceived: FieldValue.increment(1),
      },
    }, { merge: true });
  } catch (e: any) {
    console.error(`[bling-webhook] falha ao processar uid=${uid} produto=${productId}: ${e?.message}`);
  }
}

export function registerBlingWebhookRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Authenticated: enable/disable webhook mode; returns the fixed callback URL and
  // lets the user set the companyId manually (from the Bling panel / first event)
  // in case it couldn't be captured from the token at connect time.
  app.post('/api/bling/webhook/config', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const body = req.body ?? {};
      const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (body.syncMode === 'polling' || body.syncMode === 'webhook') update.syncMode = body.syncMode;

      const statusSnap = await STATUS_REF(uid).get();
      const cur = statusSnap.data() ?? {};

      if (typeof body.companyId === 'string' && body.companyId.trim()) {
        const companyId = body.companyId.trim();
        update.companyId = companyId;
        // Repoint the reverse map (drop an old companyId if it changed).
        if (cur.companyId && cur.companyId !== companyId) {
          await COMPANY_REF(cur.companyId).delete().catch(() => {});
        }
        await COMPANY_REF(companyId).set({ uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      await STATUS_REF(uid).set(update, { merge: true });

      const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
      const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || '';
      return res.json({
        webhookUrl: `${proto}://${host}/api/bling/webhook`,
        companyId: update.companyId ?? cur.companyId ?? '',
        syncMode: update.syncMode ?? cur.syncMode ?? 'polling',
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao salvar configuração do webhook.' });
    }
  });

  // Public single callback for all merchants. Raw body for the HMAC check.
  app.post('/api/bling/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!validSignature(raw, req.headers['x-bling-signature-256'] as string | undefined)) {
      console.warn('[bling-webhook] assinatura inválida');
      return res.status(401).json({ message: 'Assinatura inválida.' });
    }

    let payload: any;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { payload = null; }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ message: 'Payload inválido.' });
    }

    const eventId = String(payload.eventId ?? payload.id ?? '');
    const event = String(payload.event ?? '');
    const companyId = String(payload.companyId ?? '');
    // The `data` envelope usually carries just the product id.
    const productId = String(payload?.data?.id ?? payload?.data?.produto?.id ?? '');

    // Resolve the user; unknown company -> 2xx (ignore silently, not our merchant).
    const companySnap = companyId ? await COMPANY_REF(companyId).get() : null;
    const uid = companySnap?.exists ? (companySnap.data()?.uid as string) : '';
    if (!uid) {
      console.warn(`[bling-webhook] companyId sem mapa: ${companyId || '(vazio)'}`);
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Dedup by eventId (Bling retries for up to 3 days, unordered).
    if (eventId) {
      const evRef = EVENT_REF(eventId);
      const created = await adminDb.runTransaction(async (tx) => {
        const s = await tx.get(evRef);
        if (s.exists) return false;
        tx.set(evRef, { uid, event, companyId, receivedAt: FieldValue.serverTimestamp() });
        return true;
      }).catch(() => true);
      if (!created) return res.status(200).json({ ok: true, duplicate: true });
    }

    // Answer within the 5s window; process in background.
    res.status(200).json({ ok: true });

    if (productId) {
      processEvent(uid, event, productId).catch((e) => console.error('[bling-webhook] processEvent:', e?.message));
    }
  });
}
