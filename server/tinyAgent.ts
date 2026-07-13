// Tiny ERP (Olist) v3 integration. All calls to api.tiny.com.br happen here,
// never in the browser. Auth is OAuth2 (Keycloak, realm "tiny"): omni360 is a
// single published app (global client_id/secret in env) and each user authorizes
// via the authorization-code flow. Per-user access/refresh tokens are persisted
// server-side via the Admin SDK and never returned to the client.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const TINY_BASE = 'https://api.tiny.com.br/public-api/v3';
const OAUTH_AUTH = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth';
const OAUTH_TOKEN = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';

const CLIENT_ID = process.env.TINY_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.TINY_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.TINY_REDIRECT_URI ?? '';

const SECRET_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('tiny');
const STATUS_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('settings').doc('tiny');
const STATE_REF = (state: string) => adminDb.collection('oauth_states').doc(state);

interface TinySecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// --- OAuth token lifecycle -------------------------------------------------

async function exchangeToken(params: Record<string, string>): Promise<TinySecret> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    ...params,
  });
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) {
    const msg = json?.error_description || json?.error || `Falha OAuth (${res.status})`;
    throw Object.assign(new Error(msg), { status: 401 });
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Renew a little early; Keycloak expires_in is in seconds.
    expiresAt: Date.now() + Math.max(0, (Number(json.expires_in) || 300) - 60) * 1000,
  };
}

async function persistSecret(uid: string, secret: TinySecret): Promise<void> {
  await SECRET_REF(uid).set({ ...secret, updatedAt: FieldValue.serverTimestamp() });
}

// Returns a valid access token for the user, refreshing it if it is expired or
// about to expire. Marks the integration disconnected and throws (401) when the
// refresh fails so the caller surfaces a "reconnect" state.
async function getValidAccessToken(uid: string, forceRefresh = false): Promise<string> {
  const snap = await SECRET_REF(uid).get();
  if (!snap.exists) throw Object.assign(new Error('Tiny não conectado.'), { status: 401 });
  const secret = snap.data() as TinySecret;

  if (!forceRefresh && secret.expiresAt > Date.now()) return secret.accessToken;

  try {
    const refreshed = await exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
    });
    await persistSecret(uid, refreshed);
    return refreshed.accessToken;
  } catch (e: any) {
    await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
    throw Object.assign(new Error('Sessão Tiny expirada. Reconecte a conta.'), { status: 401 });
  }
}

// --- HTTP client -----------------------------------------------------------

// Tiny API client with exponential backoff on 429/5xx and one automatic token
// refresh on 401. Rate limits are per-account and low, so import/push loops call
// this sequentially.
async function tinyFetch<T = any>(
  uid: string,
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
  didRefresh = false,
): Promise<T> {
  const token = await getValidAccessToken(uid, didRefresh);
  const res = await fetch(`${TINY_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if ((res.status === 401 || res.status === 403) && !didRefresh) {
    return tinyFetch<T>(uid, method, path, body, attempt, true);
  }

  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 700;
    await new Promise((r) => setTimeout(r, wait));
    return tinyFetch<T>(uid, method, path, body, attempt + 1, didRefresh);
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }

  if (!res.ok) {
    const msg = json?.mensagem || json?.message
      || (Array.isArray(json?.erros) ? json.erros.map((e: any) => e?.mensagem || e).join('; ') : undefined)
      || `Tiny respondeu ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

// --- Import normalization --------------------------------------------------

export interface TinyNormalizedProduct {
  tinyId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  precoPor?: number;
  precoDe?: number;
  categorias: string[];
  imagens: string[];
  raw: unknown;
}

function normalizeProduct(p: any): TinyNormalizedProduct {
  const dim = p?.dimensoes ?? {};
  const seo = p?.seo ?? {};
  const keywords = Array.isArray(seo?.keywords) ? seo.keywords.filter(Boolean).join(', ') : undefined;
  const caminho = p?.categoria?.caminhoCompleto;
  const categorias = caminho
    ? String(caminho).split(/\s*>\s*|\s*\/\s*/).filter(Boolean)
    : [p?.categoria?.nome].filter(Boolean);
  return {
    tinyId: String(p?.id),
    sku: p?.sku ?? '',
    nome: p?.descricao ?? '',
    descricaoHtml: p?.descricaoComplementar || undefined,
    seoTitle: seo?.titulo || undefined,
    seoDescription: seo?.descricao || undefined,
    seoKeywords: keywords || undefined,
    ncm: p?.ncm || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: dim?.pesoLiquido,
    pesoBruto: dim?.pesoBruto,
    largura: dim?.largura,
    altura: dim?.altura,
    comprimento: dim?.comprimento,
    precoPor: p?.precos?.preco,
    precoDe: p?.precos?.precoPromocional,
    categorias,
    imagens: Array.isArray(p?.anexos) ? p.anexos.map((a: any) => a?.url).filter(Boolean) : [],
    raw: p,
  };
}

// --- Push ------------------------------------------------------------------

export interface TinyPushProduct {
  tinyId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  // Images are import-only: the Tiny v3 API cannot write product images.
  campos: { descricao: boolean; seo: boolean; fiscal: boolean };
}

export interface TinyPushResult {
  tinyId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal', string>;
}

// Builds a valid AtualizarProdutoRequestModel body from the current product,
// echoing the fields the API expects and overriding only the selected ones. Tiny
// PUT semantics are treated as a full update, so existing values are preserved.
function buildProductPutBody(current: any, prod: TinyPushProduct): Record<string, unknown> {
  const dim = current?.dimensoes ?? {};
  const seo = current?.seo ?? {};
  const precos = current?.precos ?? {};
  const estoque = current?.estoque ?? {};

  const body: Record<string, any> = {
    sku: current?.sku,
    descricao: current?.descricao,
    descricaoComplementar: current?.descricaoComplementar,
    unidade: current?.unidade,
    ncm: current?.ncm,
    gtin: current?.gtin,
    marca: current?.marca?.id ? { id: current.marca.id } : undefined,
    categoria: current?.categoria?.id ? { id: current.categoria.id } : undefined,
    precos: (precos.preco != null || precos.precoPromocional != null || precos.precoCusto != null)
      ? { preco: precos.preco, precoPromocional: precos.precoPromocional, precoCusto: precos.precoCusto }
      : undefined,
    // Echo the current stock config so an atomic PUT can't reset it. quantidade is
    // read-only on the response and not part of the request model, so it's omitted.
    estoque: {
      controlar: estoque.controlar,
      sobEncomenda: estoque.sobEncomenda,
      minimo: estoque.minimo,
      maximo: estoque.maximo,
      diasPreparacao: estoque.diasPreparacao,
      localizacao: estoque.localizacao,
    },
    dimensoes: {
      largura: dim.largura,
      altura: dim.altura,
      comprimento: dim.comprimento,
      diametro: dim.diametro,
      pesoLiquido: dim.pesoLiquido,
      pesoBruto: dim.pesoBruto,
    },
    seo: {
      titulo: seo.titulo,
      descricao: seo.descricao,
      keywords: Array.isArray(seo.keywords) ? seo.keywords : undefined,
      slug: seo.slug,
      linkVideo: seo.linkVideo,
    },
  };

  if (prod.campos.descricao && prod.descricaoHtml) {
    body.descricaoComplementar = prod.descricaoHtml;
  }
  if (prod.campos.seo) {
    if (prod.seoTitle) body.seo.titulo = prod.seoTitle;
    if (prod.seoDescription) body.seo.descricao = prod.seoDescription;
    if (prod.seoKeywords) {
      body.seo.keywords = prod.seoKeywords.split(',').map((k) => k.trim()).filter(Boolean);
    }
  }
  if (prod.campos.fiscal) {
    if (prod.ncm) body.ncm = prod.ncm;
    if (prod.gtin) body.gtin = prod.gtin;
    if (prod.pesoLiquido != null) body.dimensoes.pesoLiquido = prod.pesoLiquido;
    if (prod.pesoBruto != null) body.dimensoes.pesoBruto = prod.pesoBruto;
    if (prod.largura != null) body.dimensoes.largura = prod.largura;
    if (prod.altura != null) body.dimensoes.altura = prod.altura;
    if (prod.comprimento != null) body.dimensoes.comprimento = prod.comprimento;
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
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Tiny</title></head>
<body style="font-family:system-ui;padding:2rem;text-align:center;color:#334155">
<p>${message}</p>
<script>
  try { window.opener && window.opener.postMessage({ source: 'tiny-oauth', ok: ${ok} }, '*'); } catch (e) {}
  setTimeout(function(){ window.close(); }, 1500);
</script>
</body></html>`;
}

export function registerTinyRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Start the OAuth flow: build the authorization URL bound to a random state
  // that maps back to this user (the callback is not Firebase-authenticated).
  app.get('/api/tiny/oauth/start', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      if (!CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).json({ message: 'Integração Tiny não configurada no servidor.' });
      }
      const state = `${uid.slice(0, 6)}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      // expiresAt lets the callback reject stale states and doubles as the field a
      // Firestore TTL policy on `oauth_states` can use to sweep abandoned docs.
      await STATE_REF(state).set({
        uid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const url = `${OAUTH_AUTH}?${new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        // offline_access yields a refresh token that outlives the SSO session,
        // so background import/push keeps working without manual reconnects.
        scope: 'openid offline_access',
        state,
      })}`;
      return res.json({ url });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao iniciar OAuth.' });
    }
  });

  // OAuth redirect target. Validated by the state doc, not by a Firebase token.
  app.get('/api/tiny/oauth/callback', async (req, res) => {
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
      await STATUS_REF(uid).set({
        connected: true,
        validated: true,
        connectedAt: FieldValue.serverTimestamp(),
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.status(200).send(closePopupHtml('Conta Tiny conectada com sucesso. Pode fechar esta janela.', true));
    } catch (e: any) {
      return res.status(400).send(closePopupHtml(`Falha ao conectar: ${e?.message ?? 'erro'}`, false));
    }
  });

  app.get('/api/tiny/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const [statusSnap, secretSnap] = await Promise.all([STATUS_REF(uid).get(), SECRET_REF(uid).get()]);
      const hasToken = secretSnap.exists;
      const d = statusSnap.data() ?? {};
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });

  app.delete('/api/tiny/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await SECRET_REF(uid).delete().catch(() => {});
      await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  // Paginated product import (offset-based). Lists a page, then fetches each
  // product's full detail for description/SEO/fiscal/images.
  app.post('/api/tiny/import', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const limit = Math.min(Number(req.body?.limit ?? 50), 100);
      const offset = Math.max(Number(req.body?.offset ?? 0), 0);

      const page = await tinyFetch<any>(uid, 'GET', `/produtos?situacao=A&limit=${limit}&offset=${offset}`);
      const itens: any[] = Array.isArray(page?.itens) ? page.itens : [];
      const total = Number(page?.paginacao?.total ?? 0);

      const produtos: TinyNormalizedProduct[] = [];
      for (const item of itens) {
        const detail = await tinyFetch<any>(uid, 'GET', `/produtos/${item.id}`).catch(() => item);
        produtos.push(normalizeProduct(detail));
      }
      return res.json({
        offset, limit, total,
        count: produtos.length,
        hasMore: offset + itens.length < total,
        produtos,
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha na importação.' });
    }
  });

  // Push enriched fields back to Tiny via an atomic PUT /produtos/{id}. Per-product
  // error handling: one failure does not abort the batch. Images are not pushed
  // (unsupported by the Tiny v3 write API).
  app.post('/api/tiny/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const produtos: TinyPushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      const resultados: TinyPushResult[] = [];

      for (const prod of produtos) {
        const steps: TinyPushResult['steps'] = { descricao: 'skip', seo: 'skip', fiscal: 'skip' };
        if (!prod.tinyId) {
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: false, steps: {
            descricao: 'Sem ID Tiny', seo: 'Sem ID Tiny', fiscal: 'Sem ID Tiny',
          } });
          continue;
        }
        try {
          const current = await tinyFetch<any>(uid, 'GET', `/produtos/${prod.tinyId}`);
          const body = buildProductPutBody(current, prod);
          await tinyFetch(uid, 'PUT', `/produtos/${prod.tinyId}`, body);
          if (prod.campos.descricao) steps.descricao = prod.descricaoHtml ? 'ok' : 'sem descrição';
          if (prod.campos.seo) steps.seo = (prod.seoTitle || prod.seoDescription || prod.seoKeywords) ? 'ok' : 'sem SEO';
          if (prod.campos.fiscal) steps.fiscal = 'ok';
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          if (prod.campos.descricao) steps.descricao = msg;
          if (prod.campos.seo) steps.seo = msg;
          if (prod.campos.fiscal) steps.fiscal = msg;
        }
        const ok = (['descricao', 'seo', 'fiscal'] as const)
          .every((k) => steps[k] === 'ok' || steps[k] === 'skip' || steps[k].startsWith('sem '));
        resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok, steps });
      }
      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
