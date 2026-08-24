// Serving público SSR do blog nativo. Resolve o tenant por slug (/b/{slug}/...)
// ou por Host/X-Forwarded-Host (domínio customizado verificado), lê o conteúdo
// via Admin SDK e renderiza com os templates de blogTemplates.ts.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { renderHome, renderCategory, renderPost, renderNotFound, escapeHtml, type BlogRenderContext } from './blogTemplates';
import type { BlogSettings, BlogPost, BlogCategory, BlogDomainDoc } from '../src/modules/content/blog/types';
import { ensureHtml } from '../src/modules/content/markdown';
import { PLACEHOLDER_CATEGORIES, PLACEHOLDER_POSTS } from '../src/modules/content/blog/placeholderContent';

const POSTS_PER_PAGE = 10;
const CACHE_TTL_MS = 60_000;

// Cache em memória por URL renderizada (chave: host + path + query).
const htmlCache = new Map<string, { body: string; contentType: string; status: number; expires: number }>();

function cacheGet(key: string) {
  const hit = htmlCache.get(key);
  if (hit && hit.expires > Date.now()) return hit;
  htmlCache.delete(key);
  return null;
}
function cacheSet(key: string, body: string, contentType: string, status = 200) {
  if (htmlCache.size > 500) htmlCache.clear(); // proteção simples de memória
  htmlCache.set(key, { body, contentType, status, expires: Date.now() + CACHE_TTL_MS });
}

interface Tenant { uid: string; projectId: string; settings: BlogSettings; }

// Resolve o host efetivo priorizando X-Forwarded-Host (proxy do cliente),
// com fallback para Host. Usado de forma consistente na cache key, no
// contexto de renderização e na resolução de domínio customizado, para
// evitar colisão de cache entre tenants atrás de um mesmo proxy reverso.
function resolvedHost(req: express.Request): string {
  // BLOG_PROXY_SECRET, quando configurado, restringe X-Forwarded-Host ao proxy
  // conhecido (o Worker da Cloudflare, que injeta o mesmo segredo). Sem isso
  // qualquer um chama o hosted.app forjando o header e escolhe o tenant que
  // quiser. Não configurado, o comportamento antigo continua valendo — é o que
  // mantém funcionando o proxy reverso em /blog montado pelo próprio cliente,
  // que não tem como conhecer o segredo.
  const secret = process.env.BLOG_PROXY_SECRET;
  const trusted = !secret || req.headers['x-blog-proxy-secret'] === secret;
  const forwarded = trusted ? (req.headers['x-forwarded-host'] as string) : '';
  const raw = forwarded || req.headers.host || '';
  return raw.split(',')[0].trim().toLowerCase();
}

// Cache de resolução de domínio (tenant por host), TTL 60s, com limite de
// entradas — bounds Firestore reads para hosts que não são de blog.
const DOMAIN_CACHE_TTL_MS = 60_000;
const domainCache = new Map<string, { tenant: Tenant | null; expires: number }>();

function domainCacheGet(host: string): { tenant: Tenant | null } | undefined {
  const hit = domainCache.get(host);
  if (hit && hit.expires > Date.now()) return hit;
  domainCache.delete(host);
  return undefined;
}
function domainCacheSet(host: string, tenant: Tenant | null) {
  if (domainCache.size > 500) domainCache.clear(); // proteção simples de memória
  domainCache.set(host, { tenant, expires: Date.now() + DOMAIN_CACHE_TTL_MS });
}

function blogRef(t: { uid: string; projectId: string }) {
  return adminDb.collection('users').doc(t.uid).collection('contentProjects').doc(t.projectId);
}

async function loadTenantBySlug(slug: string): Promise<Tenant | null> {
  const slugSnap = await adminDb.collection('blogSlugs').doc(slug).get();
  if (!slugSnap.exists) return null;
  const { uid, projectId } = slugSnap.data() as { uid: string; projectId: string };
  return loadTenant(uid, projectId);
}

async function loadTenantByDomain(host: string): Promise<Tenant | null> {
  const snap = await adminDb.collection('blogDomains').doc(host).get();
  if (!snap.exists) return null;
  const d = snap.data() as BlogDomainDoc;
  if (!d.verified) return null;
  return loadTenant(d.uid, d.projectId);
}

async function loadTenant(uid: string, projectId: string): Promise<Tenant | null> {
  const snap = await blogRef({ uid, projectId }).collection('blog').doc('settings').get();
  if (!snap.exists) return null;
  const settings = snap.data() as BlogSettings;
  if (!settings.enabled) return null;
  return { uid, projectId, settings };
}

async function loadCategories(t: Tenant): Promise<BlogCategory[]> {
  const snap = await blogRef(t).collection('blogCategories').orderBy('name').get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<BlogCategory, 'id'>), id: d.id }));
}

async function loadPublishedPosts(t: Tenant): Promise<BlogPost[]> {
  const snap = await blogRef(t)
    .collection('blogPosts')
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .get();
  // ensureHtml: posts publicados antes da conversão no publish guardam
  // Markdown cru no campo html — converte na hora de servir.
  return snap.docs.map((d) => {
    const data = d.data() as Omit<BlogPost, 'id'>;
    return { ...data, html: ensureHtml(data.html), id: d.id };
  });
}

async function loadVerifiedDomain(t: Tenant): Promise<string | null> {
  const snap = await adminDb.collection('blogDomains')
    .where('uid', '==', t.uid).where('projectId', '==', t.projectId).where('verified', '==', true).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

function makeCtx(
  t: Tenant,
  categories: BlogCategory[],
  baseUrl: string,
  req: express.Request,
  verifiedDomain: string | null,
  demoQuery?: string,
): BlogRenderContext {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = resolvedHost(req);
  // Se existe domínio customizado verificado e o request atual não veio por
  // ele, o canonical deve apontar para o domínio (fonte canônica), mesmo
  // servindo pela URL /b/{slug} da plataforma. O domínio serve na raiz, então
  // o prefixo de caminho do canonical fica vazio.
  if (verifiedDomain && verifiedDomain !== host) {
    return {
      settings: t.settings,
      categories,
      baseUrl,
      canonicalBase: `https://${verifiedDomain}`,
      canonicalPathPrefix: '',
      demoQuery,
    };
  }
  return { settings: t.settings, categories, baseUrl, canonicalBase: `${proto}://${host}`, demoQuery };
}

// Router compartilhado entre /b/{slug} e domínios customizados.
// `path` já vem sem o prefixo (/, /{postSlug}, /categoria/{catSlug}, /sitemap.xml, /feed.xml).
async function serveBlogPath(
  t: Tenant,
  path: string,
  baseUrl: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const cacheKey = `${resolvedHost(req)}|${baseUrl}|${path}|${req.query.page ?? ''}`;
  // ?preview=1 (aba Aparência do admin) ignora e não alimenta o cache, para
  // o dono ver as mudanças de tema imediatamente.
  const isPreview = req.query.preview === '1';
  const hit = isPreview ? null : cacheGet(cacheKey);
  if (hit) {
    res.status(hit.status).type(hit.contentType).setHeader('Cache-Control', 'public, max-age=60').send(hit.body);
    return;
  }

  const send = (body: string, contentType = 'html', status = 200) => {
    if (!isPreview) cacheSet(cacheKey, body, contentType, status);
    res.status(status).type(contentType)
      .setHeader('Cache-Control', isPreview ? 'no-store' : 'public, max-age=60')
      .send(body);
  };

  const [realCategories, realPosts, verifiedDomain] = await Promise.all([loadCategories(t), loadPublishedPosts(t), loadVerifiedDomain(t)]);
  // Sem posts publicados, o preview (?preview=1, usado pelo iframe da aba
  // Aparência) mostra conteúdo fictício para o usuário ver como home,
  // categoria e artigo ficam no template escolhido — nunca em requests reais.
  const usingPlaceholder = isPreview && realPosts.length === 0;
  const categories = usingPlaceholder ? PLACEHOLDER_CATEGORIES : realCategories;
  const posts = usingPlaceholder ? PLACEHOLDER_POSTS : realPosts;
  const ctx = makeCtx(t, categories, baseUrl, req, verifiedDomain, usingPlaceholder ? 'preview=1' : undefined);

  if (path === '/sitemap.xml') {
    const urls = [
      `${ctx.canonicalBase}${baseUrl}/`,
      ...categories.map((c) => `${ctx.canonicalBase}${baseUrl}/categoria/${encodeURIComponent(c.slug)}`),
      ...posts.map((p) => `${ctx.canonicalBase}${baseUrl}/${encodeURIComponent(p.slug)}`),
    ];
    return send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
        .map((u) => `<url><loc>${escapeHtml(u)}</loc></url>`).join('')}</urlset>`,
      'application/xml',
    );
  }

  if (path === '/feed.xml') {
    const items = posts.slice(0, 20).map((p) => `
      <item>
        <title>${escapeHtml(p.title)}</title>
        <link>${ctx.canonicalBase}${baseUrl}/${encodeURIComponent(p.slug)}</link>
        <guid>${ctx.canonicalBase}${baseUrl}/${encodeURIComponent(p.slug)}</guid>
        <pubDate>${p.publishedAt ? new Date(p.publishedAt).toUTCString() : ''}</pubDate>
        <description>${escapeHtml(p.excerpt)}</description>
      </item>`).join('');
    return send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeHtml(t.settings.title)}</title><link>${ctx.canonicalBase}${baseUrl}/</link><description>${escapeHtml(t.settings.description)}</description>${items}</channel></rss>`,
      'application/xml',
    );
  }

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const paginate = (list: BlogPost[]) => ({
    slice: list.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE),
    hasMore: list.length > page * POSTS_PER_PAGE,
  });

  if (path === '/' || path === '') {
    const { slice, hasMore } = paginate(posts);
    return send(renderHome(ctx, slice, { page, hasMore }));
  }

  const catMatch = path.match(/^\/categoria\/([^/]+)$/);
  if (catMatch) {
    const catSlug = decodeURIComponent(catMatch[1]);
    const category = categories.find((c) => c.slug === catSlug);
    if (!category) return send(renderNotFound(ctx, 'Categoria não encontrada.'), 'html', 404);
    const filtered = posts.filter((p) => (p.categoryIds ?? []).includes(category.id));
    const { slice, hasMore } = paginate(filtered);
    return send(renderCategory(ctx, category, slice, { page, hasMore }));
  }

  const postMatch = path.match(/^\/([^/]+)$/);
  if (postMatch) {
    const postSlug = decodeURIComponent(postMatch[1]);
    const post = posts.find((p) => p.slug === postSlug);
    if (!post) return send(renderNotFound(ctx, 'Post não encontrado.'), 'html', 404);
    return send(renderPost(ctx, post));
  }

  return send(renderNotFound(ctx, 'Página não encontrada.'), 'html', 404);
}

export function registerBlogPublic(app: express.Application): void {
  // Rotas na plataforma: /b/{blogSlug}/...
  app.get(['/b/:blogSlug', '/b/:blogSlug/*'], async (req, res) => {
    try {
      const tenant = await loadTenantBySlug(req.params.blogSlug);
      if (!tenant) {
        return res.status(404).type('html').send(renderNotFound(null, 'Blog não encontrado.'));
      }
      const sub = req.path.slice(`/b/${req.params.blogSlug}`.length) || '/';
      await serveBlogPath(tenant, sub, `/b/${req.params.blogSlug}`, req, res);
    } catch (err) {
      console.error('blog public error:', err);
      res.status(500).type('html').send(renderNotFound(null, 'Erro interno.'));
    }
  });

  // Domínio customizado: qualquer GET cujo Host esteja registrado e verificado
  // em blogDomains. Aceita também o prefixo /blog (reverse proxy do cliente).
  const platformHosts = new Set(
    [process.env.APP_URL, `localhost:${process.env.PORT || '3000'}`]
      .filter(Boolean)
      .map((u) => String(u).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()),
  );

  app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const host = resolvedHost(req);
    if (!host || platformHosts.has(host)) return next();
    // Evita capturar assets/API por engano em hosts desconhecidos.
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    try {
      let tenant: Tenant | null;
      const cached = domainCacheGet(host);
      if (cached) {
        tenant = cached.tenant;
      } else {
        tenant = await loadTenantByDomain(host);
        domainCacheSet(host, tenant);
      }
      if (!tenant) return next();
      const isProxyPrefix = req.path === '/blog' || req.path.startsWith('/blog/');
      const path = isProxyPrefix ? req.path.slice('/blog'.length) || '/' : req.path;
      const baseUrl = isProxyPrefix ? '/blog' : '';
      await serveBlogPath(tenant, path, baseUrl, req, res);
    } catch (err) {
      console.error('blog domain error:', err);
      next();
    }
  });
}
