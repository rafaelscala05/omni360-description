import crypto from 'node:crypto';
import express from 'express';
import { adminDb } from './firebaseAdmin';
import { MELI_CLIENT_ID } from './meli/config';
import { MELI_SELLER_REGISTRY_REF } from './meli/oauth';
import { createScopeSyncJobs, createSyncJob, recordAudit, scheduleSyncJob } from './meli/sync';
import { sanitizeError } from './meli/utils';

export interface MeliWebhookNotification {
  topic: 'items' | 'user_products' | 'user_products_families';
  userId: string;
  resource: string;
  applicationId: string;
  sent: string;
  actions: string[];
  sourceId: string | null;
}

const TOPICS = new Set(['items', 'user_products', 'user_products_families']);

export function parseMeliWebhookNotification(payload: unknown): MeliWebhookNotification | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  const topic = typeof value.topic === 'string' ? value.topic : '';
  const userId = value.user_id != null ? String(value.user_id) : '';
  const resource = typeof value.resource === 'string' ? value.resource : '';
  const applicationId = value.application_id != null ? String(value.application_id) : '';
  const sent = typeof value.sent === 'string' ? value.sent : '';
  if (!TOPICS.has(topic) || !userId || !resource.startsWith('/') || !applicationId || !sent) return null;
  if (resource.length > 300 || userId.length > 40 || applicationId.length > 40 || sent.length > 64) return null;
  return {
    topic: topic as MeliWebhookNotification['topic'], userId, resource, applicationId, sent,
    actions: Array.isArray(value.actions) ? value.actions.map(String).slice(0, 10) : [],
    sourceId: typeof value.id === 'string' ? value.id : typeof value._id === 'string' ? value._id : null,
  };
}

function eventId(notification: MeliWebhookNotification): string {
  return crypto.createHash('sha256').update([
    notification.applicationId, notification.topic, notification.userId,
    notification.resource, notification.sent, notification.sourceId || '',
  ].join('|')).digest('hex');
}

function resourceTarget(notification: MeliWebhookNotification): { itemId?: string; userProductId?: string; familyId?: string } | null {
  if (notification.topic === 'items') {
    const match = notification.resource.match(/^\/items\/([A-Z]{2,4}\d+)$/i);
    return match ? { itemId: match[1].toUpperCase() } : null;
  }
  if (notification.topic === 'user_products') {
    const match = notification.resource.match(/^\/user-products\/([A-Z0-9_-]+)$/i);
    return match ? { userProductId: match[1] } : null;
  }
  const match = notification.resource.match(/^\/sites\/[A-Z]{3}\/user-products-families\/([A-Z0-9_-]+)$/i);
  return match ? { familyId: match[1] } : null;
}

async function processNotification(notification: MeliWebhookNotification): Promise<void> {
  if (MELI_CLIENT_ID && notification.applicationId !== MELI_CLIENT_ID) return;
  const registry = await MELI_SELLER_REGISTRY_REF(notification.userId).get();
  if (!registry.exists || registry.data()?.status !== 'active' || !registry.data()?.uid) {
    await adminDb.collection('meli_webhook_orphans').doc(eventId(notification)).set({
      ...notification, status: 'unmapped_seller', receivedAt: new Date().toISOString(),
    }, { merge: true });
    return;
  }
  const uid = String(registry.data()?.uid);
  const ref = adminDb.collection('users').doc(uid).collection('meli_webhook_events').doc(eventId(notification));
  const accepted = await adminDb.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return false;
    tx.create(ref, {
      ...notification, id: ref.id, status: 'received', receivedAt: new Date().toISOString(),
      processedAt: null, jobIds: [], error: null,
    });
    return true;
  });
  if (!accepted) return;

  try {
    const target = resourceTarget(notification);
    if (!target) {
      await ref.set({ status: 'ignored', processedAt: new Date().toISOString(), error: 'Formato de resource não reconhecido.' }, { merge: true });
      return;
    }
    const jobs = target.itemId
      ? [await createSyncJob(uid, { itemId: target.itemId })]
      : await createScopeSyncJobs(uid, target.userProductId ? { userProductId: target.userProductId } : { familyId: target.familyId });
    jobs.forEach((job) => scheduleSyncJob(uid, job.id));
    const status = jobs.length ? 'processing' : 'ignored';
    await Promise.all([
      ref.set({ status, jobIds: jobs.map((job) => job.id), processedAt: new Date().toISOString() }, { merge: true }),
      recordAudit(uid, 'meli.webhook.processed', 'meli_webhook_event', ref.id, {
        topic: notification.topic, resource: notification.resource, jobIds: jobs.map((job) => job.id), status,
      }),
    ]);
  } catch (error) {
    await ref.set({ status: 'failed', error: sanitizeError(error), processedAt: new Date().toISOString() }, { merge: true });
  }
}

export function registerMercadoLivreWebhookRoutes(app: express.Express): void {
  app.post('/api/mercadolivre/webhook', (req, res) => {
    const notification = parseMeliWebhookNotification(req.body);
    if (!notification) return res.status(400).json({ message: 'Notificação inválida.' });
    res.status(200).end();
    setImmediate(() => void processNotification(notification));
  });
}
