# Blog: domínio via proxy de caminho (`/blog`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client keep their existing site (cPanel or anywhere else) and forward only the `/blog` path to the Alfred, authenticated per domain, instead of CNAMEing the whole (sub)domain via Cloudflare for SaaS.

**Architecture:** `blogDomains/{domain}` gains a `method: 'cname' | 'proxy'` field. `cname` is the existing Cloudflare Custom Hostname flow, untouched. `proxy` skips Cloudflare entirely: registration generates a random `proxyToken`; any external forwarder (a Cloudflare Worker Route on the client's own zone, a cPanel/Nginx reverse proxy, a third-party API Gateway) sends requests to `https://alfreds.com.br/blog...` with `X-Blog-Domain-Token: <token>`; `server/blogPublic.ts` resolves the tenant directly from that token — never from `Host`/`X-Forwarded-Host` — and verification is an active HTTP probe from the server instead of a Cloudflare status check.

**Tech Stack:** TypeScript, Express, Firebase Admin SDK (Firestore), Node `crypto` (`randomBytes`), native `fetch`.

**Spec:** `docs/superpowers/specs/2026-08-24-blog-proxy-domain-design.md`

## Global Constraints

- No automated test suite in this project (per `CLAUDE.md`). Verification per task is `npm run lint` (`tsc --noEmit`) plus the manual `curl`/dev-server checks described in each task.
- Never touch the existing `method: 'cname'` code path (Cloudflare Custom Hostname API, `BLOG_PROXY_SECRET`, `X-Forwarded-Host`) — it must keep working exactly as today.
- `proxyToken` is generated with `crypto.randomBytes(24).toString('base64url')` and is only ever returned over the authenticated `/api/blog/...` routes — never mirrored into the client-readable `BlogSettings` Firestore doc.
- The response header `X-Alfred-Blog: proxy-ok` is the single source of truth the verify probe checks for — it must be set on every response served through the token path, regardless of theme/template.
- All new user-facing strings are in Brazilian Portuguese, matching the rest of the app.

---

### Task 1: Data model — `BlogDomainDoc.method`/`proxyToken`, `BlogSettings.proxyDomains`

**Files:**
- Modify: `src/modules/content/blog/types.ts:172-239`

**Interfaces:**
- Produces: `BlogDomainDoc.method?: 'cname' | 'proxy'`, `BlogDomainDoc.proxyToken?: string` (consumed by Tasks 2 and 3)
- Produces: `BlogSettings.proxyDomains?: string[]` (consumed by Task 5)

- [ ] **Step 1: Read the current file to confirm line numbers before editing**

Run: `sed -n '170,240p' src/modules/content/blog/types.ts` — confirm it still matches the blocks quoted below.

- [ ] **Step 2: Add `proxyDomains` to `BlogSettings`**

Replace:
```ts
  customDomains: string[];    // espelho de blogDomains para exibição na UI
  verifiedDomains?: string[]; // subconjunto de customDomains já verificados (exibição)
  createdAt: string;
  updatedAt: string;
}
```
with:
```ts
  customDomains: string[];    // espelho de blogDomains para exibição na UI
  verifiedDomains?: string[]; // subconjunto de customDomains já verificados (exibição)
  proxyDomains?: string[];    // subconjunto de customDomains registrado com method 'proxy' (exibição)
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Add `method`/`proxyToken` to `BlogDomainDoc`**

Replace:
```ts
// Coleção raiz blogDomains/{domain} — server-only.
export interface BlogDomainDoc {
  uid: string;
  projectId: string;
  // Espelha o status do custom hostname na Cloudflare — quem de fato decide se
  // o request chega. Só `true` com hostname e certificado ativos.
  verified: boolean;
  cloudflareHostnameId?: string;
  // Legado: TXT _alfred-verify, usado antes da borda na Cloudflare provar a
  // posse. Mantido só para não quebrar docs antigos; nada mais lê.
  verificationToken?: string;
  createdAt: string;
}
```
with:
```ts
// Coleção raiz blogDomains/{domain} — server-only.
export interface BlogDomainDoc {
  uid: string;
  projectId: string;
  // 'cname': domínio (ou subdomínio) inteiro delegado ao Alfred via Cloudflare
  // for SaaS (server/cloudflareSaas.ts). 'proxy': só o caminho /blog é
  // encaminhado por um gateway externo (Worker Route na zona do próprio
  // cliente, reverse proxy no cPanel, API Gateway de terceiro), autenticado
  // por proxyToken. Ausente nos docs criados antes deste campo = 'cname'.
  method?: 'cname' | 'proxy';
  // Espelha o status do custom hostname na Cloudflare — quem de fato decide se
  // o request chega. Só `true` com hostname e certificado ativos. Método
  // 'proxy': setado pela sondagem HTTP em server/blogAdmin.ts em vez da
  // Cloudflare.
  verified: boolean;
  cloudflareHostnameId?: string;
  // Método 'proxy': segredo gerado no cadastro, único por domínio. O gateway
  // externo manda em X-Blog-Domain-Token; server/blogPublic.ts resolve o
  // tenant por ele em vez de por Host/X-Forwarded-Host.
  proxyToken?: string;
  // Legado: TXT _alfred-verify, usado antes da borda na Cloudflare provar a
  // posse. Mantido só para não quebrar docs antigos; nada mais lê.
  verificationToken?: string;
  createdAt: string;
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint` — expect no new errors (both fields are optional, no existing call site breaks).

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/blog/types.ts
git commit -m "feat(blog): add proxy method fields to BlogDomainDoc/BlogSettings"
```

---

### Task 2: Server API — register/get/verify/rotate for `method: 'proxy'` (`server/blogAdmin.ts`)

**Files:**
- Modify: `server/blogAdmin.ts`

**Interfaces:**
- Consumes: `BlogDomainDoc.method`, `BlogDomainDoc.proxyToken` (Task 1)
- Produces (HTTP, consumed by Task 4):
  - `POST /api/blog/projects/:projectId/domains` body `{ domain: string; method?: 'cname' | 'proxy' }` → `{ domain, method: 'proxy', proxyToken }` or `{ domain, method: 'cname', cnameTarget, verified, detail? }`
  - `GET /api/blog/projects/:projectId/domains/:domain` → `{ domain, method: 'cname', verified, cnameTarget }` or `{ domain, method: 'proxy', verified, proxyToken }`
  - `POST /api/blog/projects/:projectId/domains/:domain/verify` → unchanged shape `{ verified: boolean; detail?: string }`, now also correct for `method: 'proxy'`
  - `POST /api/blog/projects/:projectId/domains/:domain/rotate-token` → `{ domain, method: 'proxy', proxyToken }`

- [ ] **Step 1: Read the current file**

Run: `cat -n server/blogAdmin.ts` — confirm it matches the blocks quoted below (no changes since this plan was written).

- [ ] **Step 2: Add the `randomBytes` import**

Replace:
```ts
import type express from 'express';
import { adminDb } from './firebaseAdmin';
```
with:
```ts
import type express from 'express';
import { randomBytes } from 'crypto';
import { adminDb } from './firebaseAdmin';
```

- [ ] **Step 3: Add the HTTP probe helper for `method: 'proxy'` verification**

Add this function right after `normalizeDomain` (before `export function registerBlogAdminRoutes`):
```ts
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
```

- [ ] **Step 4: Branch `POST /domains` by `method`**

Replace:
```ts
  app.post('/api/blog/projects/:projectId/domains', async (req, res) => {
    let reservedNow = false;
    let ref: FirebaseFirestore.DocumentReference | null = null;
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(String((req.body as { domain?: string }).domain ?? ''));
      const { projectId } = req.params;
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
        await ref.create({ uid: decoded.uid, projectId, verified: false, createdAt: new Date().toISOString() });
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
            domain, cnameTarget: cnameTarget(), verified: existing.verified, detail: existing.detail,
          });
        }
      }

      const created = await createCustomHostname(domain);
      await ref.update({ cloudflareHostnameId: created.id });
      return res.json({
        domain, cnameTarget: cnameTarget(), verified: created.verified, detail: created.detail,
      });
    } catch (err) {
      // Se a Cloudflare recusou depois da reserva, não deixa doc órfão para
      // trás — senão o usuário não consegue nem tentar de novo nem remover.
      if (reservedNow && ref) await ref.delete().catch(() => {});
      sendError(res, err);
    }
  });
```
with:
```ts
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
```

- [ ] **Step 5: Add `GET /domains/:domain`**

Add right after the `POST /domains` handler (before the `/verify` route):
```ts
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
```

- [ ] **Step 6: Branch `/verify` by `method`**

Replace:
```ts
  app.post('/api/blog/projects/:projectId/domains/:domain/verify', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const domain = normalizeDomain(req.params.domain);
      const ref = adminDb.collection('blogDomains').doc(domain);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as BlogDomainDoc).uid !== decoded.uid) {
        return res.status(404).json({ error: 'Domínio não encontrado' });
      }
      const status = await getCustomHostname(domain);
      if (!status) {
        return res.json({
          verified: false,
          detail: 'Domínio não encontrado na borda. Remova e adicione novamente.',
        });
      }
      const existing = snap.data() as BlogDomainDoc;
      await ref.update({
        verified: status.verified,
        // Reconcilia o id em domínios criados antes deste campo existir.
        ...(existing.cloudflareHostnameId ? {} : { cloudflareHostnameId: status.id }),
      });
      res.json({ verified: status.verified, detail: status.detail });
    } catch (err) { sendError(res, err); }
  });
```
with:
```ts
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
```

- [ ] **Step 7: Add `POST /domains/:domain/rotate-token`**

Add right after the `/verify` handler (before `DELETE /domains/:domain`):
```ts
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
```

- [ ] **Step 8: Confirm `DELETE /domains/:domain` needs no change**

Run: `sed -n '/domains\/:domain.*app.delete\|app.delete.*domains/,+20p' server/blogAdmin.ts` (or just re-read the file). Confirm the Cloudflare cleanup branch is already gated on `cloudflareHostnameId` being present — proxy-method docs never set that field, so `deleteCustomHostname` is never called for them and the handler is already correct as-is. No edit needed.

- [ ] **Step 9: Verify**

Run: `npm run lint` — expect no new errors.

- [ ] **Step 10: Commit**

```bash
git add server/blogAdmin.ts
git commit -m "feat(blog): server API for method 'proxy' domains (register/get/verify/rotate)"
```

---

### Task 3: Request-time resolution and auth in `server/blogPublic.ts`

**Files:**
- Modify: `server/blogPublic.ts`

**Interfaces:**
- Consumes: `BlogDomainDoc.method`/`proxyToken` (Task 1), `Tenant` interface (already defined in this file), `loadTenant(uid, projectId): Promise<Tenant | null>` (already defined in this file)
- Produces: response header `X-Alfred-Blog: proxy-ok` on every request served through a valid `X-Blog-Domain-Token`, consumed by `probeProxyDomain` in Task 2

- [ ] **Step 1: Read the current file**

Run: `cat -n server/blogPublic.ts` — confirm it matches the blocks below.

- [ ] **Step 2: Add the token cache and resolver**

Replace:
```ts
function domainCacheSet(host: string, tenant: Tenant | null) {
  if (domainCache.size > 500) domainCache.clear(); // proteção simples de memória
  domainCache.set(host, { tenant, expires: Date.now() + DOMAIN_CACHE_TTL_MS });
}

function blogRef(t: { uid: string; projectId: string }) {
```
with:
```ts
function domainCacheSet(host: string, tenant: Tenant | null) {
  if (domainCache.size > 500) domainCache.clear(); // proteção simples de memória
  domainCache.set(host, { tenant, expires: Date.now() + DOMAIN_CACHE_TTL_MS });
}

// Cache de resolução por token (método 'proxy'), mesmo padrão do domainCache
// acima — token não muda o suficiente pra justificar um índice dedicado, só
// bounds de Firestore reads.
interface ProxyResolved { tenant: Tenant; domain: string; }
const proxyTokenCache = new Map<string, { resolved: ProxyResolved | null; expires: number }>();

function proxyTokenCacheGet(token: string): { resolved: ProxyResolved | null } | undefined {
  const hit = proxyTokenCache.get(token);
  if (hit && hit.expires > Date.now()) return hit;
  proxyTokenCache.delete(token);
  return undefined;
}
function proxyTokenCacheSet(token: string, resolved: ProxyResolved | null) {
  if (proxyTokenCache.size > 500) proxyTokenCache.clear();
  proxyTokenCache.set(token, { resolved, expires: Date.now() + DOMAIN_CACHE_TTL_MS });
}

// Resolve o tenant pelo token do header X-Blog-Domain-Token — nunca pelo Host,
// que pra tráfego 'proxy' vale sempre alfreds.com.br (único jeito do App
// Hosting aceitar a requisição vinda de um gateway externo).
async function loadTenantByProxyToken(token: string): Promise<ProxyResolved | null> {
  const cached = proxyTokenCacheGet(token);
  if (cached) return cached.resolved;
  const snap = await adminDb.collection('blogDomains')
    .where('proxyToken', '==', token).where('verified', '==', true).limit(1).get();
  let result: ProxyResolved | null = null;
  if (!snap.empty) {
    const docSnap = snap.docs[0];
    const d = docSnap.data() as BlogDomainDoc;
    const tenant = await loadTenant(d.uid, d.projectId);
    if (tenant) result = { tenant, domain: docSnap.id };
  }
  proxyTokenCacheSet(token, result);
  return result;
}

function blogRef(t: { uid: string; projectId: string }) {
```

- [ ] **Step 3: Thread an optional `domainOverride` through `serveBlogPath`**

Replace:
```ts
async function serveBlogPath(
  t: Tenant,
  path: string,
  baseUrl: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const cacheKey = `${resolvedHost(req)}|${baseUrl}|${path}|${req.query.page ?? ''}`;
```
with:
```ts
async function serveBlogPath(
  t: Tenant,
  path: string,
  baseUrl: string,
  req: express.Request,
  res: express.Response,
  domainOverride?: string,
): Promise<void> {
  // domainOverride vem do método 'proxy': o Host real da requisição é sempre
  // alfreds.com.br ali, então cai no resolvedHost(req) normal quebraria a
  // cache key (colidiria entre domínios de clientes diferentes).
  const cacheKey = `${domainOverride ?? resolvedHost(req)}|${baseUrl}|${path}|${req.query.page ?? ''}`;
```

- [ ] **Step 4: Use the override in place of the Firestore-loaded verified domain**

Replace:
```ts
  const [realCategories, realPosts, verifiedDomain] = await Promise.all([loadCategories(t), loadPublishedPosts(t), loadVerifiedDomain(t)]);
```
with:
```ts
  const [realCategories, realPosts, verifiedDomain] = await Promise.all([
    loadCategories(t),
    loadPublishedPosts(t),
    domainOverride ? Promise.resolve(domainOverride) : loadVerifiedDomain(t),
  ]);
```

- [ ] **Step 5: Check the token before the `platformHosts` shortcut in `registerBlogPublic`**

Replace:
```ts
  app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const host = resolvedHost(req);
    if (!host || platformHosts.has(host)) return next();
    // Evita capturar assets/API por engano em hosts desconhecidos.
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    try {
```
with:
```ts
  app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next();
    // Evita capturar assets/API por engano.
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();

    // Método 'proxy': o Host da requisição é sempre alfreds.com.br (está em
    // platformHosts), então essa checagem precisa vir ANTES do atalho de
    // platformHosts abaixo, ou o tráfego nunca chega a ser resolvido.
    const proxyToken = req.headers['x-blog-domain-token'] as string | undefined;
    if (proxyToken) {
      try {
        const resolved = await loadTenantByProxyToken(proxyToken);
        if (resolved) {
          res.setHeader('X-Alfred-Blog', 'proxy-ok');
          const isProxyPrefix = req.path === '/blog' || req.path.startsWith('/blog/');
          const path = isProxyPrefix ? req.path.slice('/blog'.length) || '/' : req.path;
          await serveBlogPath(resolved.tenant, path, '/blog', req, res, resolved.domain);
          return;
        }
      } catch (err) {
        console.error('blog proxy token error:', err);
        // cai pro fluxo normal abaixo — token ruim não deve derrubar a plataforma
      }
    }

    const host = resolvedHost(req);
    if (!host || platformHosts.has(host)) return next();
    try {
```

- [ ] **Step 6: Verify**

Run: `npm run lint` — expect no new errors.

- [ ] **Step 7: Manual end-to-end check with the dev server**

Run: `npm run dev` in one terminal. In another:
```bash
# 1) sem token — deve seguir pro app normal (200, HTML da landing)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/blog/

# 2) com token que não existe — mesmo resultado (não quebra nada)
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Blog-Domain-Token: token-invalido" http://localhost:3000/blog/
```
Expected: both `200` (falling through to the normal app, not a 500). A real token round-trip (blog HTML + `X-Alfred-Blog: proxy-ok` header) is only testable after Task 2's registration endpoint exists and a domain has been registered with `method: 'proxy'` and `verified: true` set manually in Firestore for this manual check — do that check as part of Task 4's end-to-end step instead, once the client can register one.

- [ ] **Step 8: Commit**

```bash
git add server/blogPublic.ts
git commit -m "feat(blog): resolve tenant by X-Blog-Domain-Token before Host-based lookup"
```

---

### Task 4: Client service wrappers (`src/services/blogService.ts`)

**Files:**
- Modify: `src/services/blogService.ts`

**Interfaces:**
- Consumes: HTTP contracts from Task 2
- Produces: `addBlogDomain(projectId, domain, method?)`, `getBlogDomain(projectId, domain)`, `rotateBlogDomainToken(projectId, domain)` (consumed by Task 5)

- [ ] **Step 1: Widen `callJson`'s method union**

Replace:
```ts
async function callJson<T>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
```
with:
```ts
async function callJson<T>(url: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
```

- [ ] **Step 2: Extend `addBlogDomain` and add `getBlogDomain`/`rotateBlogDomainToken`**

Replace:
```ts
export const addBlogDomain = (projectId: string, domain: string) =>
  callJson<{ domain: string; cnameTarget: string; verified: boolean; detail?: string }>(
    `/api/blog/projects/${projectId}/domains`, 'POST', { domain },
  );

export const verifyBlogDomain = (projectId: string, domain: string) =>
  callJson<{ verified: boolean; detail?: string }>(
    `/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify`, 'POST',
  );

export const removeBlogDomain = (projectId: string, domain: string) =>
  callJson<{ ok: true }>(`/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}`, 'DELETE');
```
with:
```ts
type CnameDomainResult = { domain: string; method: 'cname'; cnameTarget: string; verified: boolean; detail?: string };
type ProxyDomainResult = { domain: string; method: 'proxy'; proxyToken: string; verified?: boolean };

export const addBlogDomain = (projectId: string, domain: string, method: 'cname' | 'proxy' = 'cname') =>
  callJson<CnameDomainResult | ProxyDomainResult>(
    `/api/blog/projects/${projectId}/domains`, 'POST', { domain, method },
  );

export const getBlogDomain = (projectId: string, domain: string) =>
  callJson<CnameDomainResult | ProxyDomainResult>(
    `/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}`, 'GET',
  );

export const rotateBlogDomainToken = (projectId: string, domain: string) =>
  callJson<ProxyDomainResult>(
    `/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}/rotate-token`, 'POST',
  );

export const verifyBlogDomain = (projectId: string, domain: string) =>
  callJson<{ verified: boolean; detail?: string }>(
    `/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify`, 'POST',
  );

export const removeBlogDomain = (projectId: string, domain: string) =>
  callJson<{ ok: true }>(`/api/blog/projects/${projectId}/domains/${encodeURIComponent(domain)}`, 'DELETE');
```

- [ ] **Step 3: Verify**

Run: `npm run lint` — expect a type error in `src/modules/content/blog/BlogDomains.tsx` (its `instructions` state and `handleAdd` still assume the old `addBlogDomain` shape) — that's expected and gets fixed in Task 5. Confirm the error is scoped to that file only.

- [ ] **Step 4: Commit**

```bash
git add src/services/blogService.ts
git commit -m "feat(blog): client wrappers for method-aware domain registration"
```

---

### Task 5: UI — method selector, token display, config snippets (`BlogDomains.tsx`)

**Files:**
- Modify: `src/modules/content/blog/BlogDomains.tsx` (full-file rewrite — the method branching touches most of the component)

**Interfaces:**
- Consumes: `addBlogDomain`, `getBlogDomain`, `rotateBlogDomainToken`, `verifyBlogDomain`, `removeBlogDomain` (Task 4), `BlogSettings.proxyDomains` (Task 1)

- [ ] **Step 1: Read the current file**

Run: `cat -n src/modules/content/blog/BlogDomains.tsx` — confirm it's unchanged since this plan was written (198 lines, default export `BlogDomains`).

- [ ] **Step 2: Replace the entire file**

Replace the full contents of `src/modules/content/blog/BlogDomains.tsx` with:

```tsx
import React, { useState } from 'react';
import { Plus, Trash2, RefreshCw, Check, Copy, ShieldCheck, Clock, KeyRound } from 'lucide-react';
import type { BlogSettings } from './types';
import {
  addBlogDomain, verifyBlogDomain, removeBlogDomain, saveBlogSettings, getBlogDomain, rotateBlogDomainToken,
} from '../../../services/blogService';

interface Props {
  uid: string;
  projectId: string;
  settings: BlogSettings;
}

type Instructions =
  | { kind: 'cname'; domain: string; cnameTarget: string; detail?: string }
  | { kind: 'proxy'; domain: string; proxyToken: string };

const cloudflareWorkerSnippet = (token: string) => `export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'alfreds.com.br';
    const headers = new Headers(request.headers);
    headers.set('Host', 'alfreds.com.br');
    headers.set('X-Blog-Domain-Token', '${token}');
    return fetch(new Request(url, { method: request.method, headers, body: request.body, redirect: 'manual' }));
  },
};`;

const reverseProxySnippet = (token: string) => `location /blog {
  proxy_pass https://alfreds.com.br;
  proxy_set_header Host alfreds.com.br;
  proxy_set_header X-Blog-Domain-Token "${token}";
}`;

const BlogDomains: React.FC<Props> = ({ uid, projectId, settings }) => {
  const [domain, setDomain] = useState('');
  const [method, setMethod] = useState<'cname' | 'proxy'>('cname');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<Instructions | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyDetail, setVerifyDetail] = useState<Record<string, string>>({});
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState<string | null>(null);

  const verifiedDomains = settings.verifiedDomains ?? [];
  const proxyDomains = settings.proxyDomains ?? [];

  const handleAdd = async () => {
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      const result = await addBlogDomain(projectId, trimmed, method);
      await saveBlogSettings(uid, projectId, {
        // Evita duplicar o domínio (e a key do React) ao readicionar um domínio já existente.
        customDomains: Array.from(new Set([...settings.customDomains, trimmed])),
        ...(result.method === 'proxy'
          ? { proxyDomains: Array.from(new Set([...proxyDomains, trimmed])) }
          : {}),
      });
      setInstructions(
        result.method === 'proxy'
          ? { kind: 'proxy', domain: result.domain, proxyToken: result.proxyToken }
          : { kind: 'cname', domain: result.domain, cnameTarget: result.cnameTarget, detail: result.detail },
      );
      setDomain('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao adicionar domínio');
    } finally {
      setAdding(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleVerify = async (d: string) => {
    setVerifying(d);
    setVerifyDetail((prev) => ({ ...prev, [d]: '' }));
    try {
      const result = await verifyBlogDomain(projectId, d);
      if (result.verified) {
        await saveBlogSettings(uid, projectId, { verifiedDomains: Array.from(new Set([...verifiedDomains, d])) });
      } else {
        // `verified` espelha o estado atual (Cloudflare ou sondagem), então
        // pode voltar a ser falso — tira da lista para a UI não continuar
        // mostrando "Verificado" num domínio que parou de servir.
        if (verifiedDomains.includes(d)) {
          await saveBlogSettings(uid, projectId, { verifiedDomains: verifiedDomains.filter((x) => x !== d) });
        }
        setVerifyDetail((prev) => ({ ...prev, [d]: result.detail || 'Verificação pendente. Confira a configuração e tente novamente.' }));
      }
    } catch (e) {
      setVerifyDetail((prev) => ({ ...prev, [d]: e instanceof Error ? e.message : 'Erro ao verificar' }));
    } finally {
      setVerifying(null);
    }
  };

  const handleRemove = async (d: string) => {
    if (!window.confirm(`Remover o domínio "${d}"?`)) return;
    setRemovingDomain(d);
    try {
      await removeBlogDomain(projectId, d);
      await saveBlogSettings(uid, projectId, {
        customDomains: settings.customDomains.filter((x) => x !== d),
        verifiedDomains: verifiedDomains.filter((x) => x !== d),
        proxyDomains: proxyDomains.filter((x) => x !== d),
      });
      if (instructions?.domain === d) setInstructions(null);
    } finally {
      setRemovingDomain(null);
    }
  };

  const handleShowToken = async (d: string) => {
    setLoadingToken(d);
    try {
      const result = await getBlogDomain(projectId, d);
      if (result.method === 'proxy') {
        setInstructions({ kind: 'proxy', domain: d, proxyToken: result.proxyToken });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao buscar token');
    } finally {
      setLoadingToken(null);
    }
  };

  const handleRotateToken = async (d: string) => {
    if (!window.confirm(`Gerar um novo token para "${d}"? O token atual para de funcionar e o domínio volta a ficar pendente.`)) return;
    setLoadingToken(d);
    try {
      const result = await rotateBlogDomainToken(projectId, d);
      setInstructions({ kind: 'proxy', domain: d, proxyToken: result.proxyToken });
      if (verifiedDomains.includes(d)) {
        await saveBlogSettings(uid, projectId, { verifiedDomains: verifiedDomains.filter((x) => x !== d) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar novo token');
    } finally {
      setLoadingToken(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Adicionar domínio</h3>
        {error && <div className="mb-3 text-sm text-red-400 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex gap-2 mb-3.5">
          <button
            onClick={() => setMethod('cname')}
            className={`flex-1 text-sm font-medium px-3.5 py-2 rounded-xl border transition-colors ${
              method === 'cname' ? 'border-[#FF5B03] bg-[#FF5B03]/5 text-[#FF5B03]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Domínio ou subdomínio dedicado
          </button>
          <button
            onClick={() => setMethod('proxy')}
            className={`flex-1 text-sm font-medium px-3.5 py-2 rounded-xl border transition-colors ${
              method === 'proxy' ? 'border-[#FF5B03] bg-[#FF5B03]/5 text-[#FF5B03]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Caminho /blog no meu site atual
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3.5">
          {method === 'cname'
            ? 'O domínio (ou subdomínio) informado passa a servir o blog inteiro na raiz.'
            : 'Só o caminho /blog do domínio informado é encaminhado para cá — o resto do site continua onde está.'}
        </p>

        <div className="flex items-center gap-3">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={method === 'cname' ? 'blog.suaempresa.com.br' : 'suaempresa.com.br'}
            className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !domain.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors shrink-0"
          >
            {adding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
          </button>
        </div>
      </div>

      {instructions?.kind === 'cname' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-1">Configuração de DNS para {instructions.domain}</h3>
          <p className="text-sm text-slate-500 mb-4">
            Crie o registro abaixo no seu provedor de DNS e depois clique em "Verificar". É o único
            registro necessário.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <p className="text-xs font-semibold text-slate-500 mb-2">Registro CNAME</p>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="text-xs text-slate-400">Nome</span>
              <code className="text-slate-800 break-all">{instructions.domain}</code>
              <span />
              <span className="text-xs text-slate-400">Valor</span>
              <code className="text-slate-800 break-all">{instructions.cnameTarget}</code>
              <button
                onClick={() => handleCopy(instructions.cnameTarget, 'cname')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'cname' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-3">
            O certificado HTTPS é emitido automaticamente, mas só depois que o CNAME estiver no ar —
            costuma levar alguns minutos. Se já existir um registro A ou CNAME com esse mesmo nome,
            remova antes, senão a emissão fica travada.
          </p>
        </div>
      )}

      {instructions?.kind === 'proxy' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">Configuração do caminho /blog para {instructions.domain}</h3>
            <p className="text-sm text-slate-500">
              Esse token autentica só este domínio — não reaproveite em outro lugar. Configure o
              encaminhamento de <code>/blog</code> usando um dos exemplos abaixo e depois clique em
              "Verificar" na lista.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 mb-1">Token do domínio</p>
                <code className="text-slate-800 break-all text-sm">{instructions.proxyToken}</code>
              </div>
              <button
                onClick={() => handleCopy(instructions.proxyToken, 'token')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'token' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-500">Cloudflare Worker Route (se o domínio estiver na Cloudflare)</p>
              <button
                onClick={() => handleCopy(cloudflareWorkerSnippet(instructions.proxyToken), 'worker')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'worker' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <pre className="bg-slate-900 text-slate-100 text-xs rounded-xl p-3.5 overflow-x-auto"><code>{cloudflareWorkerSnippet(instructions.proxyToken)}</code></pre>
            <p className="text-xs text-slate-500 mt-1.5">Crie uma Worker Route escopada a {instructions.domain}/blog* — não use o wildcard da zona inteira.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-500">Reverse proxy genérico (Nginx, Apache/cPanel, API Gateway)</p>
              <button
                onClick={() => handleCopy(reverseProxySnippet(instructions.proxyToken), 'proxy')}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md shrink-0"
                title="Copiar"
              >
                {copied === 'proxy' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <pre className="bg-slate-900 text-slate-100 text-xs rounded-xl p-3.5 overflow-x-auto"><code>{reverseProxySnippet(instructions.proxyToken)}</code></pre>
            <p className="text-xs text-slate-500 mt-1.5">Sintaxe de exemplo em Nginx — adapte pro seu gateway mantendo os dois headers.</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Domínios configurados</h3>
        {settings.customDomains.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum domínio adicionado ainda.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {settings.customDomains.map((d) => {
              const isVerified = verifiedDomains.includes(d);
              const isProxy = proxyDomains.includes(d);
              return (
                <div key={d} className="py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-slate-900 truncate">{d}</span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                        {isProxy ? '/blog' : 'domínio'}
                      </span>
                      {isVerified ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                          <ShieldCheck className="w-3 h-3" /> Verificado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                          <Clock className="w-3 h-3" /> Pendente
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isProxy && (
                        <button
                          onClick={() => handleShowToken(d)}
                          disabled={loadingToken === d}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
                          title="Ver token e instruções"
                        >
                          {loadingToken === d ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                          Token
                        </button>
                      )}
                      <button
                        onClick={() => handleVerify(d)}
                        disabled={verifying === d}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
                      >
                        {verifying === d ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        Verificar
                      </button>
                      <button
                        onClick={() => handleRemove(d)}
                        disabled={removingDomain === d}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 rounded-lg transition-colors"
                        title="Remover"
                      >
                        {removingDomain === d ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  {verifyDetail[d] && (
                    <p className="text-xs text-red-400 mt-1.5">{verifyDetail[d]}</p>
                  )}
                  {isProxy && (
                    <button
                      onClick={() => handleRotateToken(d)}
                      disabled={loadingToken === d}
                      className="text-xs text-slate-400 hover:text-slate-700 mt-1.5 underline disabled:opacity-60"
                    >
                      Gerar novo token
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default BlogDomains;
```

- [ ] **Step 3: Verify**

Run: `npm run lint` — expect zero errors now (this was the file flagged at the end of Task 4).

- [ ] **Step 4: Manual end-to-end check with the dev server**

Run: `npm run dev`, log in, open a project's Blog → Domínios tab.
1. Switch to "Caminho /blog no meu site atual", type a test domain (e.g. `teste-proxy.example.com`), click Adicionar. Confirm the token panel with both snippets renders and both "Copiar" buttons work.
2. In a separate terminal, simulate the gateway your test domain would use:
   ```bash
   TOKEN="<cole o token mostrado na tela>"
   curl -s -D - -o /dev/null -H "Host: alfreds.com.br" -H "X-Blog-Domain-Token: $TOKEN" http://localhost:3000/blog/
   ```
   Expected: `HTTP/1.1 200` and header `X-Alfred-Blog: proxy-ok` in the response (confirms Task 3's routing works end-to-end against a real, non-verified-yet token — `loadTenantByProxyToken` requires `verified: true` though, so this specific curl will actually fall through to the normal app with `200` and NO `X-Alfred-Blog` header until verified; to see the header, manually set `verified: true` on the Firestore doc first, or click "Verificar" once a real reachable domain is wired up).
3. Click "Verificar" in the domain list; with no real gateway behind the test domain, confirm it shows the Portuguese "não foi possível alcançar" error detail, not a crash.
4. Click "Gerar novo token", confirm a new token appears and the domain shows "Pendente" again.
5. Click Remover, confirm the row disappears and the token panel closes if it was open.
6. Add a `cname`-method domain (existing flow) and confirm nothing about that panel changed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/blog/BlogDomains.tsx
git commit -m "feat(blog): UI for /blog path-proxy domains — method selector, token, snippets"
```

---

## Depois do plano (fora deste escopo)

Configurar de fato `omni360agencia.com.br` (migrar a zona pra Cloudflare, criar a Worker Route, registrar o domínio com `method: 'proxy'` na UI) é um passo de infraestrutura separado, feito depois que este plano estiver implementado e deployado — não faz parte das tarefas acima.
