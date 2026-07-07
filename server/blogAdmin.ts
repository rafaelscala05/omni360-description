// API autenticada do módulo Blog: unicidade global do slug (blogSlugs) e ciclo
// de vida de domínios customizados (blogDomains) — coleções raiz server-only.
import type express from 'express';
import { randomUUID } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { adminDb } from './firebaseAdmin';
import { slugify } from '../src/modules/content/blog/slug';

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<import('firebase-admin/auth').DecodedIdToken>;
}

function sendError(res: express.Response, err: unknown): void {
  const e = err as { status?: number; message?: string };
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status === 500) console.error('blog admin error:', err);
  return void res.status(status).json({ error: e.message ?? 'Erro interno' });
}

function settingsRef(uid: string, projectId: string) {
  return adminDb.collection('users').doc(uid)
    .collection('contentProjects').doc(projectId)
    .collection('blog').doc('settings');
}

// Domínio: só hostnames simples (sem esquema/porta/caminho).
function normalizeDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d)) {
    throw Object.assign(new Error('Domínio inválido'), { status: 400 });
  }
  return d;
}

export function registerBlogAdminRoutes(app: express.Application, deps: Deps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/blog/projects/:projectId/claim-slug', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const slug = slugify(String((req.body as { slug?: string }).slug ?? ''));
      if (slug.length < 3) {
        return res.status(400).json({ error: 'Slug deve ter pelo menos 3 caracteres' });
      }
      const { projectId } = req.params;
      const slugRef = adminDb.collection('blogSlugs').doc(slug);
      await adminDb.runTransaction(async (tx) => {
        const existing = await tx.get(slugRef);
        if (existing.exists) {
          const d = existing.data() as { uid: string; projectId: string };
          if (d.uid !== decoded.uid || d.projectId !== projectId) {
            throw Object.assign(new Error('Este endereço já está em uso'), { status: 409 });
          }
          return; // já é dele
        }
        // Libera o slug anterior deste blog, se houver.
        const settingsSnap = await tx.get(settingsRef(decoded.uid, projectId));
        const prev = settingsSnap.exists ? (settingsSnap.data() as { slug?: string }).slug : undefined;
        if (prev && prev !== slug) tx.delete(adminDb.collection('blogSlugs').doc(prev));
        tx.set(slugRef, { uid: decoded.uid, projectId });
        tx.set(settingsRef(decoded.uid, projectId), { slug, updatedAt: new Date().toISOString() }, { merge: true });
      });
      res.json({ slug });
    } catch (err) { sendError(res, err); }
  });

  app.post('/api/blog/projects/:projectId/domains', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(String((req.body as { domain?: string }).domain ?? ''));
      const { projectId } = req.params;
      const ref = adminDb.collection('blogDomains').doc(domain);
      const verificationToken = `alfred-verify=${randomUUID()}`;
      try {
        // create() falha com ALREADY_EXISTS se o doc já existir — evita corrida
        // TOCTOU entre a checagem de existência e a gravação (get + set não é atômico).
        await ref.create({ uid: decoded.uid, projectId, verified: false, verificationToken, createdAt: new Date().toISOString() });
        return res.json({ domain, verificationToken });
      } catch (err) {
        const isAlreadyExists = (err as { code?: number }).code === 6;
        if (!isAlreadyExists) throw err;
        const snap = await ref.get();
        const d = snap.data() as { uid: string; verificationToken: string } | undefined;
        if (d && d.uid === decoded.uid) {
          return res.json({ domain, verificationToken: d.verificationToken });
        }
        return res.status(409).json({ error: 'Domínio já registrado por outra conta' });
      }
    } catch (err) { sendError(res, err); }
  });

  app.post('/api/blog/projects/:projectId/domains/:domain/verify', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const ref = adminDb.collection('blogDomains').doc(domain);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as { uid: string }).uid !== decoded.uid) {
        return res.status(404).json({ error: 'Domínio não encontrado' });
      }
      const { verificationToken } = snap.data() as { verificationToken: string };
      let records: string[][] = [];
      try {
        records = await resolveTxt(`_alfred-verify.${domain}`);
      } catch {
        return res.json({ verified: false, detail: `Registro TXT _alfred-verify.${domain} não encontrado (a propagação de DNS pode levar até algumas horas).` });
      }
      const found = records.some((chunks) => chunks.join('') === verificationToken);
      if (!found) return res.json({ verified: false, detail: 'Registro TXT encontrado, mas o valor não confere.' });
      await ref.update({ verified: true });
      res.json({ verified: true });
    } catch (err) { sendError(res, err); }
  });

  app.delete('/api/blog/projects/:projectId/domains/:domain', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const ref = adminDb.collection('blogDomains').doc(domain);
      const snap = await ref.get();
      if (snap.exists && (snap.data() as { uid: string }).uid === decoded.uid) await ref.delete();
      res.json({ ok: true });
    } catch (err) { sendError(res, err); }
  });
}
