import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { meliConfigured } from './config';
import { completeAuthorization, createAuthorizationUrl, MELI_SECRET_REF, MELI_STATUS_REF, oauthPopupHtml, type VerifyFirebaseToken } from './oauth';
import { createSyncJob, MELI_JOBS_REF, recordAudit, runSyncJob } from './sync';
import type { MeliConnectionSecret, MeliListingStatus } from './types';
import { sanitizeError } from './utils';

interface Deps { verifyFirebaseToken: VerifyFirebaseToken }

const allowedStatuses = new Set<MeliListingStatus>(['active', 'paused', 'closed']);
const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');

function statusCode(error: any): number {
  const status = Number(error?.status);
  return status >= 400 && status < 600 ? status : 500;
}

export function registerMeliRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/integrations/meli/oauth/start', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      return res.json({ url: await createAuthorizationUrl(uid) });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/integrations/meli/oauth/callback', async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!code || !state) throw Object.assign(new Error('Callback OAuth sem code ou state.'), { status: 400 });
      const connected = await completeAuthorization(code, state);
      await recordAudit(connected.uid, 'meli.connection.created', 'meli_connection', 'primary', {
        sellerId: connected.sellerId,
        siteId: connected.siteId,
        mode: 'audit_only',
      });
      return res.status(200).send(oauthPopupHtml('Conta conectada.', true));
    } catch (error) {
      return res.status(400).send(oauthPopupHtml(sanitizeError(error), false));
    }
  });

  app.get('/api/integrations/meli/connections', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const [secretSnap, statusSnap] = await Promise.all([MELI_SECRET_REF(uid).get(), MELI_STATUS_REF(uid).get()]);
      const secret = secretSnap.data() as MeliConnectionSecret | undefined;
      const status = statusSnap.data() || {};
      return res.json({ connections: [{
        id: 'primary',
        connected: Boolean(secret && secret.status === 'active'),
        configured: meliConfigured(),
        sellerId: secret?.sellerId || null,
        siteId: secret?.siteId || null,
        scopes: secret?.scopes || [],
        status: secret?.status || 'disconnected',
        mode: 'audit_only',
        lastSyncedAt: status.lastSyncedAt || null,
      }] });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.delete('/api/integrations/meli/connections/:connectionId', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      if (req.params.connectionId !== 'primary') return res.status(404).json({ message: 'Conexão não encontrada.' });
      await MELI_SECRET_REF(uid).delete();
      await MELI_STATUS_REF(uid).set({
        connected: false,
        validated: false,
        status: 'revoked',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await recordAudit(uid, 'meli.connection.disconnected', 'meli_connection', 'primary');
      return res.json({ ok: true });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/sync', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const requested = Array.isArray(req.body?.statuses) ? req.body.statuses : [];
      const statuses = requested.filter((value: unknown): value is MeliListingStatus => allowedStatuses.has(value as MeliListingStatus));
      const job = await createSyncJob(uid, { statuses: statuses.length ? statuses : undefined });
      setImmediate(() => void runSyncJob(uid, job.id));
      return res.status(202).json({ job });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/listings/:itemId/sync', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const job = await createSyncJob(uid, { itemId: req.params.itemId });
      setImmediate(() => void runSyncJob(uid, job.id));
      return res.status(202).json({ job });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/listings', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const snap = await LISTINGS_REF(uid).get();
      const all = snap.docs.map((doc) => doc.data() as any)
        .filter((item) => !status || item.status === status)
        .filter((item) => !search || String(item.title || '').toLowerCase().includes(search) || String(item.itemId || '').toLowerCase().includes(search))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return res.json({ listings: all.slice(0, limit), total: all.length });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/listings/:itemId', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await LISTINGS_REF(uid).doc(req.params.itemId.toUpperCase()).get();
      if (!snap.exists) return res.status(404).json({ message: 'Anúncio não encontrado.' });
      return res.json({ listing: snap.data() });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/jobs/:jobId', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await MELI_JOBS_REF(uid).doc(req.params.jobId).get();
      if (!snap.exists) return res.status(404).json({ message: 'Job não encontrado.' });
      return res.json({ job: snap.data() });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });
}
