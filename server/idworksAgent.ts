// IdWorks ERP integration. All calls to <account>.api-idworks.com.br happen
// here, never in the browser. Auth is per-user (accountName + credentials,
// exchanged for a short-lived JWT) rather than the OAuth2 flow Tiny/Bling use —
// credentials are stored server-side via the Admin SDK and never returned to
// the client. See docs/superpowers/specs/2026-08-24-idworks-integration-design.md
// ("Pendências" #1) for why the POST /auth/token body shape is kept as an open
// record: the exact field names aren't publicly documented.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// Minimum spacing between calls. IdWorks' rate limit isn't publicly documented;
// 200ms (~5 req/s) is a conservative default — see .env.example.
const IDWORKS_PACE_MS = Number(process.env.IDWORKS_PACE_MS) || 200;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolves the public base URL (proto://host) behind the reverse proxy — req.protocol/
// req.get('host') alone reflect the internal hop, not what the client actually used.
// Mirrors server/tinyAgent.ts's publicBaseUrl (and server/blogPublic.ts's
// resolvedHost/proto handling it was itself mirrored from).
export function publicBaseUrl(req: express.Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || '';
  return `${proto}://${host}`;
}

export const SECRET_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('idworks');
export const STATUS_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('settings').doc('idworks');

interface IdworksCredentials {
  accountName: string;
  // Exact field names for POST /auth/token are NOT publicly documented (see
  // spec "Pendências" #1 — tested against the public demo account and got a
  // generic API Gateway error, not a field-validation error). Kept as an open
  // record so the connect route can accept whatever the real account needs
  // (e.g. { login, password } or { clientId, clientSecret }) without a type
  // change once confirmed.
  credentials: Record<string, string>;
}

// --- Auth token lifecycle ---------------------------------------------------

// Isolated on purpose — the one function to fix once IdWorks confirms the
// real POST /auth/token contract (spec "Pendências" #1).
async function obtainToken(accountName: string, credentials: Record<string, string>): Promise<{ token: string; expiresAt: number }> {
  // Confirmed contract (via the IdWorks OpenAPI spec + empirical probing of the
  // `teste` demo account): POST /user/signin/local is PUBLIC (no JWT), body
  // { email, password } (email = login/CPF/CNPJ, auto-detected), returns
  // { success, token: JWT, body }. The help-site's "POST /auth/token" is not the
  // real path — probing it returns the AWS gateway error "Missing Authentication
  // Token", while the required-properties error from /user/signin/local confirms
  // the email/password schema. `credentials` carries `email` and `password`.
  const base = `https://${accountName}.api-idworks.com.br/1.0`;
  const res = await fetch(`${base}/user/signin/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: credentials.email ?? '',
      password: credentials.password ?? '',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Falha ao autenticar na IdWorks (${res.status}): ${text.slice(0, 300)}`), { status: res.status === 401 || res.status === 403 ? 401 : 502 });
  }
  const json: any = await res.json().catch(() => ({}));
  const token = json?.token ?? json?.access_token ?? json?.jwt;
  if (!token || typeof token !== 'string') {
    throw Object.assign(new Error('Resposta de autenticação da IdWorks sem token.'), { status: 502 });
  }
  // JWT exp isn't guaranteed to be readable without a library; fall back to a
  // conservative 15-minute cache when we can't parse it, forcing frequent
  // reauth over risking a stale token.
  let expiresAt = Date.now() + 15 * 60 * 1000;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload?.exp === 'number') expiresAt = payload.exp * 1000;
  } catch { /* keep the conservative fallback */ }
  return { token, expiresAt };
}

async function getValidToken(uid: string, forceRefresh: boolean): Promise<{ token: string; accountName: string }> {
  const snap = await SECRET_REF(uid).get();
  const d = snap.data();
  if (!d?.accountName || !d?.credentials) {
    throw Object.assign(new Error('IdWorks não conectado.'), { status: 401 });
  }
  if (!forceRefresh && d.jwt && typeof d.jwtExpiresAt === 'number' && d.jwtExpiresAt > Date.now() + 30_000) {
    return { token: d.jwt, accountName: d.accountName };
  }
  const { token, expiresAt } = await obtainToken(d.accountName, d.credentials);
  await SECRET_REF(uid).set({ jwt: token, jwtExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { token, accountName: d.accountName };
}

// --- HTTP client -------------------------------------------------------------

// IdWorks API client: paces calls, retries 429/5xx with backoff, and retries
// once on 401 after a forced re-auth.
export async function idworksFetch<T>(uid: string, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, attempt = 0): Promise<T> {
  const { token, accountName } = await getValidToken(uid, false);
  await sleep(IDWORKS_PACE_MS);
  const base = `https://${accountName}.api-idworks.com.br/1.0`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (attempt < 3) { await sleep(2 ** attempt * 700); return idworksFetch<T>(uid, method, path, body, attempt + 1); }
    throw Object.assign(new Error('Falha de rede ao chamar a IdWorks.'), { status: 502 });
  }
  if (res.status === 401 && attempt < 1) {
    await getValidToken(uid, true); // force a fresh token, then retry once
    return idworksFetch<T>(uid, method, path, body, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 2000 * 2 ** attempt));
    return idworksFetch<T>(uid, method, path, body, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`IdWorks ${method} ${path} falhou (${res.status}): ${text.slice(0, 300)}`), { status: res.status });
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- Import normalization ----------------------------------------------------

export interface IdworksNormalizedProduct {
  idworksId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  descricaoCurta?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  slug?: string;
  linkVideo?: string;
  ncm?: string;
  ncmExTipi?: string;
  cest?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  marca?: string;
  categorias: string[];
  imagens: string[];
  codigoPai?: string;
  raw: unknown;
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeProduct(sku: any): IdworksNormalizedProduct {
  const categoria = sku?.CategoryTree || sku?.Category;
  return {
    idworksId: String(sku?.IDSku ?? ''),
    sku: sku?.IDSkuCompany ?? '',
    nome: sku?.SkuName ?? '',
    descricaoHtml: sku?.EcommerceDescription || undefined,
    descricaoCurta: sku?.EcommerceDescriptionShort || undefined,
    seoTitle: sku?.EcommerceTitle || undefined,
    seoDescription: sku?.EcommerceMetaTagDescription || undefined,
    seoKeywords: sku?.EcommerceKeyWords || undefined,
    slug: sku?.EcommerceLinkId || undefined,
    linkVideo: sku?.EcommerceVideoUrl || undefined,
    ncm: sku?.SkuNCM || undefined,
    ncmExTipi: sku?.SkuNCMExTipi || undefined,
    cest: sku?.SkuCest || undefined,
    gtin: sku?.BarCode || undefined,
    pesoLiquido: num(sku?.SkuWeightNet),
    pesoBruto: num(sku?.SkuWeight),
    largura: num(sku?.SkuWidth),
    altura: num(sku?.SkuHeight),
    comprimento: num(sku?.SkuLength),
    marca: sku?.Brand || undefined,
    categorias: categoria ? [String(categoria)] : [],
    imagens: sku?.MainImageURL ? [String(sku.MainImageURL)] : [],
    codigoPai: sku?.IDProduct ? String(sku.IDProduct) : undefined,
    raw: sku,
  };
}

// --- Push -------------------------------------------------------------------

export interface IdworksPushProduct {
  idworksId: string;
  sku?: string;
  descricaoHtml?: string;
  descricaoCurta?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  slug?: string;
  linkVideo?: string;
  ncm?: string;
  ncmExTipi?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
}

export interface IdworksPushSteps {
  descricao: string;
  seo: string;
  fiscal: string;
  imagens: string;
}

export interface IdworksPushResult {
  idworksId: string;
  sku?: string;
  ok: boolean;
  steps: IdworksPushSteps;
}

export function buildSkuUpdateBody(current: any, prod: IdworksPushProduct): { body: Record<string, any>; steps: IdworksPushSteps } {
  const cur = normalizeProduct(current);
  const steps: IdworksPushSteps = { descricao: 'sem dado local', seo: 'sem dado local', fiscal: 'sem dado local', imagens: 'sem dado local' };
  const body: Record<string, any> = {};
  const strDiffers = (a?: string, b?: string) => (a ?? '').trim() !== (b ?? '').trim();

  if (prod.campos.descricao) {
    const hasLocal = !!prod.descricaoHtml || !!prod.descricaoCurta;
    if (hasLocal) {
      let changed = false;
      if (prod.descricaoHtml && strDiffers(prod.descricaoHtml, cur.descricaoHtml)) { body.EcommerceDescription = prod.descricaoHtml; changed = true; }
      if (prod.descricaoCurta && strDiffers(prod.descricaoCurta, cur.descricaoCurta)) { body.EcommerceDescriptionShort = prod.descricaoCurta; changed = true; }
      steps.descricao = changed ? 'ok' : 'sem alteração';
    }
  }

  if (prod.campos.seo) {
    const hasLocal = !!prod.seoTitle || !!prod.seoDescription || !!prod.seoKeywords || !!prod.slug || !!prod.linkVideo;
    if (hasLocal) {
      let changed = false;
      if (prod.seoTitle && strDiffers(prod.seoTitle, cur.seoTitle)) { body.EcommerceTitle = prod.seoTitle; changed = true; }
      if (prod.seoDescription && strDiffers(prod.seoDescription, cur.seoDescription)) { body.EcommerceMetaTagDescription = prod.seoDescription; changed = true; }
      if (prod.seoKeywords && strDiffers(prod.seoKeywords, cur.seoKeywords)) { body.EcommerceKeyWords = prod.seoKeywords; changed = true; }
      if (prod.slug && strDiffers(prod.slug, cur.slug)) { body.EcommerceLinkId = prod.slug; changed = true; }
      if (prod.linkVideo && strDiffers(prod.linkVideo, cur.linkVideo)) { body.EcommerceVideoUrl = prod.linkVideo; changed = true; }
      steps.seo = changed ? 'ok' : 'sem alteração';
    }
  }

  if (prod.campos.fiscal) {
    const hasLocal = !!prod.ncm || !!prod.cest || prod.pesoLiquido != null || prod.pesoBruto != null || prod.largura != null || prod.altura != null || prod.comprimento != null;
    if (hasLocal) {
      let changed = false;
      if (prod.ncm && strDiffers(prod.ncm, cur.ncm)) { body.SkuNCM = prod.ncm; changed = true; }
      if (prod.ncmExTipi && strDiffers(prod.ncmExTipi, cur.ncmExTipi)) { body.SkuNCMExTipi = prod.ncmExTipi; changed = true; }
      if (prod.cest && strDiffers(prod.cest, cur.cest)) { body.SkuCest = prod.cest; changed = true; }
      if (prod.pesoLiquido != null && prod.pesoLiquido !== cur.pesoLiquido) { body.SkuWeightNet = prod.pesoLiquido; changed = true; }
      if (prod.pesoBruto != null && prod.pesoBruto !== cur.pesoBruto) { body.SkuWeight = prod.pesoBruto; changed = true; }
      if (prod.largura != null && prod.largura !== cur.largura) { body.SkuWidth = prod.largura; changed = true; }
      if (prod.altura != null && prod.altura !== cur.altura) { body.SkuHeight = prod.altura; changed = true; }
      if (prod.comprimento != null && prod.comprimento !== cur.comprimento) { body.SkuLength = prod.comprimento; changed = true; }
      steps.fiscal = changed ? 'ok' : 'sem alteração';
    }
  }

  // Images are NOT part of SkuUpdateBody — they go through a separate
  // POST /sku/image/{idsku} call, handled by the caller (registerIdworksRoutes'
  // push route), not by this function. `steps.imagens` is set there.

  return { body, steps };
}

// --- Routes ------------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerIdworksRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.post('/api/idworks/connect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const accountName: string | undefined = req.body?.accountName?.trim();
      const credentials: Record<string, string> | undefined = req.body?.credentials;
      if (!accountName || !credentials || typeof credentials !== 'object') {
        return res.status(400).json({ valid: false, message: 'Informe a conta (subdomínio) e as credenciais da IdWorks.' });
      }
      await obtainToken(accountName, credentials); // throws with .status on failure
      await SECRET_REF(uid).set({ accountName, credentials, updatedAt: FieldValue.serverTimestamp() });
      await STATUS_REF(uid).set({
        connected: true, validated: true, accountName,
        connectedAt: FieldValue.serverTimestamp(), lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({ valid: true, message: 'Conectado com sucesso.' });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 400).json({ valid: false, message: e?.message ?? 'Falha na conexão.' });
    }
  });

  app.get('/api/idworks/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await STATUS_REF(uid).get();
      const d = snap.data() ?? {};
      return res.json({
        connected: !!d.connected,
        validated: !!d.validated,
        accountName: d.accountName ?? null,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString() ?? null,
        syncMode: d.syncMode ?? 'polling',
        webhookUrl: d.webhookUrl ?? null,
        webhookStats: d.webhookStats ?? { lastReceivedAt: null, totalReceived: 0 },
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao ler status.' });
    }
  });

  app.delete('/api/idworks/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await SECRET_REF(uid).delete();
      await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
      return res.status(204).end();
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao desconectar.' });
    }
  });

  const MAX_PUSH_BATCH = 50;
  app.post('/api/idworks/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const produtos: IdworksPushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      if (produtos.length > MAX_PUSH_BATCH) {
        return res.status(400).json({ message: `Selecione no máximo ${MAX_PUSH_BATCH} produtos por envio.` });
      }
      const resultados: IdworksPushResult[] = [];
      for (const prod of produtos) {
        if (!prod.idworksId) {
          resultados.push({ idworksId: prod.idworksId, sku: prod.sku, ok: false, steps: { descricao: 'Sem ID IdWorks', seo: 'Sem ID IdWorks', fiscal: 'Sem ID IdWorks', imagens: 'Sem ID IdWorks' } });
          continue;
        }
        try {
          const currentArr = await idworksFetch<any[]>(uid, 'GET', `/sku/${prod.idworksId}`);
          const current = Array.isArray(currentArr) ? currentArr[0] : currentArr;
          const { body, steps } = buildSkuUpdateBody(current, prod);
          if (Object.keys(body).length) await idworksFetch(uid, 'PUT', `/sku/${prod.idworksId}`, body);

          if (prod.campos.imagens && prod.imagens?.length) {
            const currentImages = new Set(normalizeProduct(current).imagens);
            const novas = prod.imagens.filter((u) => !currentImages.has(u));
            if (novas.length) {
              for (const url of novas) await idworksFetch(uid, 'POST', `/sku/image/${prod.idworksId}`, { Url: url });
              steps.imagens = 'ok';
            } else {
              steps.imagens = 'sem alteração';
            }
          }

          resultados.push({ idworksId: prod.idworksId, sku: prod.sku, ok: true, steps });
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          resultados.push({ idworksId: prod.idworksId, sku: prod.sku, ok: false, steps: { descricao: msg, seo: msg, fiscal: msg, imagens: msg } });
        }
      }
      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
