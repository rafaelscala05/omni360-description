// Bling ERP (API v3) integration. All calls to api.bling.com.br happen here,
// never in the browser. Auth is OAuth2 (authorization-code): omni360 is a single
// published app (global client_id/secret in env) and each merchant authorizes it.
// The token exchange uses HTTP Basic auth (client_id:client_secret in the header),
// unlike Tiny which sends them in the body. There is no v2/provider layer — Bling
// is v3-only — so this module also hosts the push route. Per-user access/refresh
// tokens are persisted server-side via the Admin SDK and never returned to the client.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const BLING_BASE = 'https://api.bling.com.br/Api/v3';
const OAUTH_AUTH = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const OAUTH_TOKEN = 'https://www.bling.com.br/Api/v3/oauth/token';

const CLIENT_ID = process.env.BLING_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.BLING_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.BLING_REDIRECT_URI ?? '';
// Product scopes; the exact scope string is configured on the Bling app. Left
// empty by default so Bling applies the app's default scopes.
const SCOPES = process.env.BLING_SCOPES ?? '';

// Bling allows ~3 req/s. Space product-detail calls during import to stay under it.
export const PACE_MS = Math.max(0, Number(process.env.BLING_PACE_MS ?? 350));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolves the public base URL (proto://host) behind the reverse proxy. Mirrors
// server/tinyAgent.ts.publicBaseUrl.
export function publicBaseUrl(req: express.Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || '';
  return `${proto}://${host}`;
}

export const SECRET_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('bling');
export const STATUS_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('settings').doc('bling');
// Reverse map for the shared app-level webhook: companyId -> uid.
export const COMPANY_REF = (companyId: string) =>
  adminDb.collection('bling_companies').doc(String(companyId));
const STATE_REF = (state: string) => adminDb.collection('oauth_states').doc(state);

interface BlingSecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// --- OAuth token lifecycle -------------------------------------------------

// Bling requires the client credentials in an HTTP Basic header (NOT the body).
async function exchangeToken(params: Record<string, string>): Promise<BlingSecret> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(params),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) {
    const msg = json?.error_description || json?.error || `Falha OAuth (${res.status})`;
    throw Object.assign(new Error(msg), { status: 401 });
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Renew a little early; expires_in is in seconds.
    expiresAt: Date.now() + Math.max(0, (Number(json.expires_in) || 3600) - 60) * 1000,
  };
}

async function persistSecret(uid: string, secret: BlingSecret): Promise<void> {
  await SECRET_REF(uid).set({ ...secret, version: 'v3', updatedAt: FieldValue.serverTimestamp() });
}

// Best-effort decode of a companyId claim from the access token JWT payload.
// Bling access tokens are JWTs; the exact claim name may vary, so we scan a few
// likely keys. Returns '' when nothing is found (the user can still set it
// manually via the webhook config route).
function companyIdFromToken(accessToken: string): string {
  try {
    const seg = accessToken.split('.')[1];
    if (!seg) return '';
    const json = JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const raw = json.companyId ?? json.company_id ?? json.cnpj ?? json.sub ?? '';
    return raw ? String(raw) : '';
  } catch {
    return '';
  }
}

export async function getValidAccessToken(uid: string, forceRefresh = false): Promise<string> {
  const snap = await SECRET_REF(uid).get();
  if (!snap.exists) throw Object.assign(new Error('Bling não conectado.'), { status: 401 });
  const secret = snap.data() as BlingSecret;

  if (!forceRefresh && secret.expiresAt > Date.now()) return secret.accessToken;

  try {
    const refreshed = await exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
    });
    await persistSecret(uid, refreshed);
    return refreshed.accessToken;
  } catch {
    await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
    throw Object.assign(new Error('Sessão Bling expirada. Reconecte a conta.'), { status: 401 });
  }
}

// --- HTTP client -----------------------------------------------------------

// Bling API client: exponential backoff on 429/5xx and one automatic token
// refresh on 401. Import/push loops call this sequentially.
export async function blingFetch<T = any>(
  uid: string,
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
  didRefresh = false,
): Promise<T> {
  const token = await getValidAccessToken(uid, didRefresh);
  const res = await fetch(`${BLING_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if ((res.status === 401 || res.status === 403) && !didRefresh) {
    return blingFetch<T>(uid, method, path, body, attempt, true);
  }

  const maxAttempts = res.status === 429 ? 6 : 3;
  if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
    const retryAfter = Number(res.headers.get('retry-after'));
    let wait: number;
    if (Number.isFinite(retryAfter) && retryAfter > 0) wait = retryAfter * 1000;
    else if (res.status === 429) wait = Math.min(30000, 2000 * 2 ** attempt);
    else wait = 2 ** attempt * 700;
    if (res.status === 429) {
      console.warn(`[bling] 429 em ${method} ${path} — aguardando ${wait}ms (tentativa ${attempt + 1}/${maxAttempts})`);
    }
    await sleep(wait);
    return blingFetch<T>(uid, method, path, body, attempt + 1, didRefresh);
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }

  if (!res.ok) {
    const err = json?.error;
    const msg = err?.description || err?.message
      || (Array.isArray(err?.fields) ? err.fields.map((f: any) => f?.msg || f).join('; ') : undefined)
      || json?.message
      || `Bling respondeu ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

// --- Import normalization --------------------------------------------------

export interface BlingNormalizedProduct {
  blingId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  precoPor?: number;
  precoDe?: number;
  marca?: string;
  categorias: string[];
  imagens: string[];
  raw: unknown;
}

// Accepts a Bling v3 product object (the `data` payload of GET /produtos/{id}).
export function normalizeProduct(p: any): BlingNormalizedProduct {
  const dim = p?.dimensoes ?? {};
  const trib = p?.tributacao ?? {};
  const externas: any[] = p?.midia?.imagens?.externas ?? [];
  const internas: any[] = p?.midia?.imagens?.internas ?? [];
  const imagens = [...externas, ...internas]
    .map((i) => i?.link ?? i?.url)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
  const catNome = p?.categoria?.descricao ?? p?.categoria?.nome;
  return {
    blingId: String(p?.id),
    sku: p?.codigo ?? '',
    nome: p?.nome ?? '',
    descricaoHtml: p?.descricaoComplementar || undefined,
    ncm: trib?.ncm || undefined,
    cest: trib?.cest || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: typeof p?.pesoLiquido === 'number' ? p.pesoLiquido : undefined,
    pesoBruto: typeof p?.pesoBruto === 'number' ? p.pesoBruto : undefined,
    largura: dim?.largura || undefined,
    altura: dim?.altura || undefined,
    comprimento: dim?.profundidade || undefined,
    precoPor: typeof p?.preco === 'number' ? p.preco : undefined,
    precoDe: typeof p?.precoCusto === 'number' ? p.precoCusto : undefined,
    marca: p?.marca || undefined,
    categorias: catNome ? [String(catNome)] : [],
    imagens: Array.from(new Set(imagens)),
    raw: p,
  };
}

// --- Push ------------------------------------------------------------------

export interface BlingPushProduct {
  blingId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: { descricao: boolean; seo: boolean; fiscal: boolean; imagens: boolean };
}

export interface BlingPushResult {
  blingId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
}

// Builds a valid PUT /produtos/{id} body from the current product, echoing the
// fields Bling expects and overriding only the selected groups. Bling PUT is a
// full update, so existing values are preserved. NOTE: Bling v3 has no rich SEO
// block on the product, so the `seo` group is a no-op here (reported separately
// in the push route) — no regression.
export function buildProductPutBody(current: any, prod: BlingPushProduct): Record<string, unknown> {
  const dim = current?.dimensoes ?? {};
  const trib = current?.tributacao ?? {};

  const body: Record<string, any> = {
    nome: current?.nome,
    codigo: current?.codigo,
    tipo: current?.tipo,
    situacao: current?.situacao,
    formato: current?.formato,
    unidade: current?.unidade,
    preco: current?.preco,
    descricaoCurta: current?.descricaoCurta,
    descricaoComplementar: current?.descricaoComplementar,
    gtin: current?.gtin,
    pesoLiquido: current?.pesoLiquido,
    pesoBruto: current?.pesoBruto,
    marca: current?.marca,
    categoria: current?.categoria?.id ? { id: current.categoria.id } : undefined,
    dimensoes: {
      largura: dim.largura,
      altura: dim.altura,
      profundidade: dim.profundidade,
      unidadeMedida: dim.unidadeMedida,
    },
    tributacao: {
      ncm: trib.ncm,
      cest: trib.cest,
      origem: trib.origem,
    },
  };

  if (prod.campos.descricao && prod.descricaoHtml) {
    body.descricaoComplementar = prod.descricaoHtml;
  }
  if (prod.campos.fiscal) {
    if (prod.ncm) body.tributacao.ncm = prod.ncm;
    if (prod.cest) body.tributacao.cest = prod.cest;
    if (prod.gtin) body.gtin = prod.gtin;
    if (prod.pesoLiquido != null) body.pesoLiquido = prod.pesoLiquido;
    if (prod.pesoBruto != null) body.pesoBruto = prod.pesoBruto;
    if (prod.largura != null) body.dimensoes.largura = prod.largura;
    if (prod.altura != null) body.dimensoes.altura = prod.altura;
    if (prod.comprimento != null) body.dimensoes.profundidade = prod.comprimento;
  }
  if (prod.campos.imagens && prod.imagens?.length) {
    // Merge with the current external images (dedup by link) so existing photos
    // aren't lost.
    const currentExternas: any[] = current?.midia?.imagens?.externas ?? [];
    const byLink = new Map<string, { link: string }>();
    for (const a of currentExternas) {
      const link = a?.link ?? a?.url;
      if (link) byLink.set(link, { link });
    }
    for (const link of prod.imagens) {
      if (link && !byLink.has(link)) byLink.set(link, { link });
    }
    body.midia = { ...(current?.midia ?? {}), imagens: { ...(current?.midia?.imagens ?? {}), externas: Array.from(byLink.values()) } };
  }

  // Drop empty nested objects and undefined keys so we never send nulls the API rejects.
  const prune = (obj: Record<string, any>) => {
    Object.keys(obj).forEach((k) => {
      if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        prune(obj[k]);
        if (Object.keys(obj[k]).length === 0) delete obj[k];
      }
      if (obj[k] === undefined) delete obj[k];
    });
  };
  prune(body);
  return body;
}

// --- Routes ----------------------------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

function closePopupHtml(message: string, ok: boolean): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Bling</title></head>
<body style="font-family:system-ui;padding:2rem;text-align:center;color:#334155">
<p>${message}</p>
<script>
  try { window.opener && window.opener.postMessage({ source: 'bling-oauth', ok: ${ok} }, '*'); } catch (e) {}
  setTimeout(function(){ window.close(); }, 1500);
</script>
</body></html>`;
}

export function registerBlingRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  app.get('/api/bling/oauth/start', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      if (!CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).json({ message: 'Integração Bling não configurada no servidor.' });
      }
      const state = `${uid.slice(0, 6)}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      await STATE_REF(state).set({
        uid,
        provider: 'bling',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const params: Record<string, string> = {
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        state,
      };
      if (SCOPES) params.scope = SCOPES;
      const url = `${OAUTH_AUTH}?${new URLSearchParams(params)}`;
      return res.json({ url });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao iniciar OAuth.' });
    }
  });

  app.get('/api/bling/oauth/callback', async (req, res) => {
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    const oauthErr = req.query.error ? String(req.query.error_description || req.query.error) : '';
    try {
      if (oauthErr) throw new Error(oauthErr);
      if (!state || !code) throw new Error('Parâmetros OAuth ausentes.');

      const stateSnap = await STATE_REF(state).get();
      if (!stateSnap.exists) throw new Error('Sessão de autorização inválida ou expirada.');
      const stateData = stateSnap.data() ?? {};
      const uid = stateData.uid as string;
      await STATE_REF(state).delete().catch(() => {});
      if (typeof stateData.expiresAt === 'number' && stateData.expiresAt < Date.now()) {
        throw new Error('Sessão de autorização expirada. Tente novamente.');
      }

      const secret = await exchangeToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      });
      await persistSecret(uid, secret);

      // Capture companyId (best-effort) and register the reverse map so the
      // shared app-level webhook can resolve this user.
      const companyId = companyIdFromToken(secret.accessToken);
      if (companyId) {
        await COMPANY_REF(companyId).set({ uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      await STATUS_REF(uid).set({
        connected: true,
        validated: true,
        apiVersion: 'v3',
        companyId: companyId || FieldValue.delete(),
        connectedAt: FieldValue.serverTimestamp(),
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.status(200).send(closePopupHtml('Conta Bling conectada com sucesso. Pode fechar esta janela.', true));
    } catch (e: any) {
      return res.status(400).send(closePopupHtml(`Falha ao conectar: ${e?.message ?? 'erro'}`, false));
    }
  });

  app.get('/api/bling/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const [statusSnap, secretSnap] = await Promise.all([STATUS_REF(uid).get(), SECRET_REF(uid).get()]);
      const hasToken = secretSnap.exists;
      const d = statusSnap.data() ?? {};
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        version: 'v3',
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
        companyId: d.companyId ?? '',
        syncMode: d.syncMode === 'webhook' ? 'webhook' : 'polling',
        webhookUrl: `${publicBaseUrl(req)}/api/bling/webhook`,
        webhookStats: {
          lastReceivedAt: d.webhookStats?.lastReceivedAt ?? null,
          totalReceived: d.webhookStats?.totalReceived ?? 0,
        },
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });

  app.delete('/api/bling/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const statusSnap = await STATUS_REF(uid).get();
      const companyId = statusSnap.data()?.companyId as string | undefined;
      if (companyId) await COMPANY_REF(companyId).delete().catch(() => {});
      await SECRET_REF(uid).delete().catch(() => {});
      await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  // Push enriched fields back to Bling.
  app.post('/api/bling/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const secretSnap = await SECRET_REF(uid).get();
      if (!secretSnap.exists) return res.status(400).json({ message: 'Bling não conectado.' });

      const produtos: BlingPushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      const resultados: BlingPushResult[] = [];

      for (const prod of produtos) {
        const steps: BlingPushResult['steps'] = { descricao: 'skip', seo: 'skip', fiscal: 'skip', imagens: 'skip' };
        if (!prod.blingId) {
          resultados.push({ blingId: prod.blingId, sku: prod.sku, ok: false, steps: {
            descricao: 'Sem ID Bling', seo: 'Sem ID Bling', fiscal: 'Sem ID Bling', imagens: 'Sem ID Bling',
          } });
          continue;
        }
        try {
          const current = (await blingFetch<any>(uid, 'GET', `/produtos/${prod.blingId}`))?.data ?? {};
          await blingFetch(uid, 'PUT', `/produtos/${prod.blingId}`, buildProductPutBody(current, prod));
          if (prod.campos.descricao) steps.descricao = prod.descricaoHtml ? 'ok' : 'sem descrição';
          // Bling v3 has no rich SEO block on the product — nothing is pushed.
          if (prod.campos.seo) steps.seo = 'não suportado no Bling v3';
          if (prod.campos.fiscal) steps.fiscal = 'ok';
          if (prod.campos.imagens) steps.imagens = prod.imagens?.length ? 'ok' : 'sem imagens';
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          if (prod.campos.descricao) steps.descricao = msg;
          if (prod.campos.seo) steps.seo = msg;
          if (prod.campos.fiscal) steps.fiscal = msg;
          if (prod.campos.imagens) steps.imagens = msg;
        }
        const ok = (['descricao', 'seo', 'fiscal', 'imagens'] as const)
          .every((k) => steps[k] === 'ok' || steps[k] === 'skip' || steps[k].startsWith('sem ') || steps[k].startsWith('não suportado'));
        resultados.push({ blingId: prod.blingId, sku: prod.sku, ok, steps });
      }
      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
