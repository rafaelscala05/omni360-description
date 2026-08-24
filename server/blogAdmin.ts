// API autenticada do módulo Blog: unicidade global do slug (blogSlugs) e ciclo
// de vida de domínios customizados (blogDomains) — coleções raiz server-only.
//
// A posse do domínio é delegada à Cloudflare (server/cloudflareSaas.ts): o
// cliente cria um CNAME para o fallback origin, e a Cloudflare só encaminha
// tráfego depois de validar o hostname e emitir o certificado. Isso substitui o
// TXT _alfred-verify próprio, que provava a mesma coisa, pedia um registro a
// mais ao cliente e não tinha relação com o request de fato chegar ou não.
import type express from 'express';
import { randomBytes } from 'crypto';
import { adminDb } from './firebaseAdmin';
import { slugify } from '../src/modules/content/blog/slug';
import type { BlogDomainDoc } from '../src/modules/content/blog/types';
import {
  isCloudflareConfigured, cnameTarget, createCustomHostname, getCustomHostname, deleteCustomHostname,
} from './cloudflareSaas';

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

// Verificação do método 'proxy': sem CNAME pra checar, a prova é uma sondagem
// real — se o gateway do cliente está de fato encaminhando /blog pro Alfred
// com o token certo, a resposta carrega o marcador que blogPublic.ts seta.
async function probeProxyDomain(domain: string, token: string): Promise<{ verified: boolean; detail?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`https://${domain}/blog/`, {
      headers: { 'X-Blog-Domain-Token': token },
      signal: controller.signal,
    });
    if (resp.headers.get('x-alfred-blog') === 'proxy-ok') return { verified: true };
    return {
      verified: false,
      detail: `O domínio respondeu (HTTP ${resp.status}), mas a requisição não chegou ao Alfred. Confira se o gateway encaminha /blog para https://alfreds.com.br com o header X-Blog-Domain-Token.`,
    };
  } catch (err) {
    return {
      verified: false,
      detail: `Não foi possível alcançar https://${domain}/blog/. Confira se o DNS já propagou e se o gateway está configurado (${(err as Error).message}).`,
    };
  } finally {
    clearTimeout(timeout);
  }
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
    let reservedNow = false;
    let ref: FirebaseFirestore.DocumentReference | null = null;
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(String((req.body as { domain?: string }).domain ?? ''));
      const method = (req.body as { method?: string }).method === 'proxy' ? 'proxy' : 'cname';
      const { projectId } = req.params;

      if (method === 'proxy') {
        // Sem Cloudflare envolvida: reserva o doc com um token novo. Não há
        // chamada externa depois que possa falhar, então não precisa do
        // rollback usado no ramo 'cname' abaixo.
        ref = adminDb.collection('blogDomains').doc(domain);
        const proxyToken = randomBytes(24).toString('base64url');
        try {
          await ref.create({
            uid: decoded.uid, projectId, method: 'proxy', proxyToken, verified: false, createdAt: new Date().toISOString(),
          });
        } catch (err) {
          if ((err as { code?: number }).code !== 6) throw err;
          const d = (await ref.get()).data() as BlogDomainDoc | undefined;
          if (!d || d.uid !== decoded.uid) {
            return res.status(409).json({ error: 'Domínio já registrado por outra conta' });
          }
          // Já é dele: devolve o token existente — reenviar o form não pode
          // invalidar uma config que o cliente já aplicou no gateway dele.
          return res.json({ domain, method: 'proxy', proxyToken: d.proxyToken });
        }
        return res.json({ domain, method: 'proxy', proxyToken });
      }

      if (!isCloudflareConfigured()) {
        throw Object.assign(
          new Error('Domínios próprios ainda não estão disponíveis. Fale com o suporte.'),
          { status: 503 },
        );
      }
      ref = adminDb.collection('blogDomains').doc(domain);

      // Reserva o domínio antes de falar com a Cloudflare. create() falha com
      // ALREADY_EXISTS se o doc já existir — evita a corrida TOCTOU entre a
      // checagem de existência e a gravação (get + set não é atômico).
      try {
        await ref.create({ uid: decoded.uid, projectId, method: 'cname', verified: false, createdAt: new Date().toISOString() });
        reservedNow = true;
      } catch (err) {
        if ((err as { code?: number }).code !== 6) throw err;
        const d = (await ref.get()).data() as BlogDomainDoc | undefined;
        if (!d || d.uid !== decoded.uid) {
          return res.status(409).json({ error: 'Domínio já registrado por outra conta' });
        }
        // Já é dele: se o hostname existe na borda, devolve o estado atual em
        // vez de recriar. Se não existe, o doc é resto de uma tentativa que
        // falhou na Cloudflare — segue adiante e cria agora.
        const existing = await getCustomHostname(domain);
        if (existing) {
          return res.json({
            domain, method: 'cname', cnameTarget: cnameTarget(), verified: existing.verified, detail: existing.detail,
          });
        }
      }

      const created = await createCustomHostname(domain);
      await ref.update({ cloudflareHostnameId: created.id });
      return res.json({
        domain, method: 'cname', cnameTarget: cnameTarget(), verified: created.verified, detail: created.detail,
      });
    } catch (err) {
      // Se a Cloudflare recusou depois da reserva, não deixa doc órfão para
      // trás — senão o usuário não consegue nem tentar de novo nem remover.
      if (reservedNow && ref) await ref.delete().catch(() => {});
      sendError(res, err);
    }
  });

  app.get('/api/blog/projects/:projectId/domains/:domain', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const snap = await adminDb.collection('blogDomains').doc(domain).get();
      if (!snap.exists || (snap.data() as BlogDomainDoc).uid !== decoded.uid) {
        return res.status(404).json({ error: 'Domínio não encontrado' });
      }
      const d = snap.data() as BlogDomainDoc;
      if (d.method === 'proxy') {
        return res.json({ domain, method: 'proxy', verified: d.verified, proxyToken: d.proxyToken });
      }
      return res.json({ domain, method: 'cname', verified: d.verified, cnameTarget: cnameTarget() });
    } catch (err) { sendError(res, err); }
  });

  // "Verificar" agora só consulta a borda: quem decide se o domínio serve é a
  // Cloudflare, então o status dela é a fonte da verdade para `verified`.
  app.post('/api/blog/projects/:projectId/domains/:domain/verify', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const ref = adminDb.collection('blogDomains').doc(domain);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as BlogDomainDoc).uid !== decoded.uid) {
        return res.status(404).json({ error: 'Domínio não encontrado' });
      }
      const existing = snap.data() as BlogDomainDoc;

      if (existing.method === 'proxy') {
        if (!existing.proxyToken) {
          return res.status(500).json({ error: 'Domínio sem token — remova e adicione novamente.' });
        }
        const result = await probeProxyDomain(domain, existing.proxyToken);
        await ref.update({ verified: result.verified });
        return res.json(result);
      }

      const status = await getCustomHostname(domain);
      if (!status) {
        return res.json({
          verified: false,
          detail: 'Domínio não encontrado na borda. Remova e adicione novamente.',
        });
      }
      await ref.update({
        verified: status.verified,
        // Reconcilia o id em domínios criados antes deste campo existir.
        ...(existing.cloudflareHostnameId ? {} : { cloudflareHostnameId: status.id }),
      });
      res.json({ verified: status.verified, detail: status.detail });
    } catch (err) { sendError(res, err); }
  });

  app.post('/api/blog/projects/:projectId/domains/:domain/rotate-token', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const ref = adminDb.collection('blogDomains').doc(domain);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as BlogDomainDoc).uid !== decoded.uid) {
        return res.status(404).json({ error: 'Domínio não encontrado' });
      }
      if ((snap.data() as BlogDomainDoc).method !== 'proxy') {
        return res.status(400).json({ error: 'Rotação de token só se aplica a domínios do tipo "Caminho /blog"' });
      }
      const proxyToken = randomBytes(24).toString('base64url');
      // Zera verified: o token antigo já não vale, e o cliente precisa
      // reconfigurar o gateway com o novo antes de verificar de novo.
      await ref.update({ proxyToken, verified: false });
      res.json({ domain, method: 'proxy', proxyToken });
    } catch (err) { sendError(res, err); }
  });

  app.delete('/api/blog/projects/:projectId/domains/:domain', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const ref = adminDb.collection('blogDomains').doc(domain);
      const snap = await ref.get();
      if (snap.exists && (snap.data() as BlogDomainDoc).uid === decoded.uid) {
        const { cloudflareHostnameId } = snap.data() as BlogDomainDoc;
        if (cloudflareHostnameId && isCloudflareConfigured()) {
          // Hostname órfão continua contando na cota. Se a remoção na borda
          // falhar, ainda assim apaga o nosso doc (o usuário pediu para sair) e
          // registra o id para limpeza manual.
          await deleteCustomHostname(cloudflareHostnameId).catch((e) => {
            console.error(`blog domain: falha ao remover custom hostname ${cloudflareHostnameId} (${domain}):`, e);
          });
        }
        await ref.delete();
      }
      res.json({ ok: true });
    } catch (err) { sendError(res, err); }
  });
}
