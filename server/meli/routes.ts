import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { meliConfigured } from './config';
import { completeAuthorization, createAuthorizationUrl, MELI_SECRET_REF, MELI_SELLER_REGISTRY_REF, MELI_STATUS_REF, oauthPopupHtml, type VerifyFirebaseToken } from './oauth';
import { createSyncJob, MELI_JOBS_REF, recordAudit, scheduleSyncJob } from './sync';
import type { MeliConnectionSecret, MeliListingStatus } from './types';
import { sanitizeError } from './utils';
import { createAnalysis, getLatestAnalysis, scheduleAnalysis } from './analysis';
import { createProposal, decideChange, editChange, getLatestProposal, getProposal } from './proposals';
import { getMeliOperationalMetrics } from './operations';
import { createMutationRun, createRollbackProposal, getMutationRun, scheduleMutation } from './mutations';

interface Deps { verifyFirebaseToken: VerifyFirebaseToken }

const allowedStatuses = new Set<MeliListingStatus>(['active', 'paused', 'closed']);
const LISTINGS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');

function statusCode(error: any): number {
  const status = Number(error?.status);
  return status >= 400 && status < 600 ? status : 500;
}

export function registerMeliRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  const verifyMeliModule = async (req: express.Request) => {
    const auth = await verifyFirebaseToken(req);
    const user = await adminDb.collection('users').doc(auth.uid).get();
    if (user.data()?.modules?.meliListingOptimizer !== true) {
      throw Object.assign(new Error('Módulo de otimização MELI não habilitado para esta conta.'), { status: 403 });
    }
    return auth;
  };

  app.post('/api/integrations/meli/oauth/start', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
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
        mode: 'scope_dependent',
      });
      return res.status(200).send(oauthPopupHtml('Conta conectada.', true));
    } catch (error) {
      const message = sanitizeError(error);
      // Never log code/state or the callback URL: both are credentials. The
      // sanitized provider message and status are sufficient to diagnose PKCE,
      // redirect URI, invalid_grant and operator-account failures.
      console.warn('[meli-oauth] callback failed', {
        status: statusCode(error),
        errorType: error instanceof Error ? error.name : 'UnknownError',
        message,
      });
      return res.status(400).send(oauthPopupHtml(message, false));
    }
  });

  app.get('/api/integrations/meli/connections', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
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
        mode: secret?.scopes?.some((scope) => String(scope).toLowerCase() === 'write') ? 'assisted_write' : 'audit_only',
        lastSyncedAt: status.lastSyncedAt || null,
      }] });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.delete('/api/integrations/meli/connections/:connectionId', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      if (req.params.connectionId !== 'primary') return res.status(404).json({ message: 'Conexão não encontrada.' });
      const existing = await MELI_SECRET_REF(uid).get();
      const sellerId = existing.data()?.sellerId ? String(existing.data()?.sellerId) : null;
      const batch = adminDb.batch();
      batch.delete(MELI_SECRET_REF(uid));
      batch.set(MELI_STATUS_REF(uid), {
        connected: false,
        validated: false,
        status: 'revoked',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      if (sellerId) batch.delete(MELI_SELLER_REGISTRY_REF(sellerId));
      await batch.commit();
      await recordAudit(uid, 'meli.connection.disconnected', 'meli_connection', 'primary');
      return res.json({ ok: true });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/sync', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const requested = Array.isArray(req.body?.statuses) ? req.body.statuses : [];
      const statuses = requested.filter((value: unknown): value is MeliListingStatus => allowedStatuses.has(value as MeliListingStatus));
      const job = await createSyncJob(uid, { statuses: statuses.length ? statuses : undefined });
      scheduleSyncJob(uid, job.id);
      return res.status(202).json({ job });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/listings/:itemId/sync', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const job = await createSyncJob(uid, { itemId: req.params.itemId });
      scheduleSyncJob(uid, job.id);
      return res.status(202).json({ job });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/listings', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
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
      const { uid } = await verifyMeliModule(req);
      const snap = await LISTINGS_REF(uid).doc(req.params.itemId.toUpperCase()).get();
      if (!snap.exists) return res.status(404).json({ message: 'Anúncio não encontrado.' });
      return res.json({ listing: snap.data() });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/listings/:itemId/analyses', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const analysis = await createAnalysis(uid, req.params.itemId);
      scheduleAnalysis(uid, analysis.id);
      await recordAudit(uid, 'meli.analysis.requested', 'meli_listing_analysis', analysis.id, { listingId: analysis.listingId });
      return res.status(202).json({ analysis });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/listings/:itemId/analyses/latest', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const analysis = await getLatestAnalysis(uid, req.params.itemId);
      if (!analysis) return res.status(404).json({ message: 'Nenhuma análise encontrada para este anúncio.' });
      return res.json({ analysis });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/listings/:itemId/proposals', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const analysisId = typeof req.body?.analysisId === 'string' ? req.body.analysisId : undefined;
      return res.status(201).json(await createProposal(uid, req.params.itemId, analysisId));
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/listings/:itemId/proposals/latest', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const result = await getLatestProposal(uid, req.params.itemId);
      if (!result) return res.status(404).json({ message: 'Nenhuma proposta encontrada para este anúncio.' });
      return res.json(result);
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/proposals/:proposalId', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const result = await getProposal(uid, req.params.proposalId);
      if (!result) return res.status(404).json({ message: 'Proposta não encontrada.' });
      return res.json(result);
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.patch('/api/meli/proposals/:proposalId/changes/:changeId', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const approvalStatus = req.body?.approvalStatus;
      if (approvalStatus !== 'approved' && approvalStatus !== 'rejected') {
        return res.status(422).json({ message: 'approvalStatus deve ser approved ou rejected.' });
      }
      return res.json(await decideChange(uid, req.params.proposalId, req.params.changeId, approvalStatus, req.body?.confirmed === true));
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.put('/api/meli/proposals/:proposalId/changes/:changeId', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'newValue')) {
        return res.status(422).json({ message: 'newValue é obrigatório.' });
      }
      return res.json(await editChange(uid, req.params.proposalId, req.params.changeId, req.body.newValue));
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/proposals/:proposalId/apply', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const run = await createMutationRun(uid, req.params.proposalId, req.body?.idempotencyKey);
      scheduleMutation(uid, run.id);
      return res.status(202).json({ mutationRun: run });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.post('/api/meli/proposals/:proposalId/rollback-proposal', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      return res.status(201).json(await createRollbackProposal(uid, req.params.proposalId));
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/mutations/:runId', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const run = await getMutationRun(uid, req.params.runId);
      if (!run) return res.status(404).json({ message: 'Execução de publicação não encontrada.' });
      return res.json({ mutationRun: run });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/jobs/:jobId', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      const snap = await MELI_JOBS_REF(uid).doc(req.params.jobId).get();
      if (!snap.exists) return res.status(404).json({ message: 'Job não encontrado.' });
      return res.json({ job: snap.data() });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });

  app.get('/api/meli/operations/metrics', async (req, res) => {
    try {
      const { uid } = await verifyMeliModule(req);
      return res.json({ metrics: await getMeliOperationalMetrics(uid) });
    } catch (error) {
      return res.status(statusCode(error)).json({ message: sanitizeError(error) });
    }
  });
}
