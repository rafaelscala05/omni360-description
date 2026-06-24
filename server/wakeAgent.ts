// Wake Commerce (fbits) integration. All calls to api.fbits.net happen here,
// never in the browser. Each user has their own token, persisted server-side via
// the Admin SDK in a read-only doc and never returned to the client.
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const WAKE_BASE = 'https://api.fbits.net';
const SECRET_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('wake');
const STATUS_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('settings').doc('wake');

interface WakeError { resultadoOperacao?: boolean; codigo?: number; mensagem?: string; }

// HTTP client for the Wake API with exponential backoff on 429/5xx. The
// Authorization header carries the raw token — Wake (fbits) accepts the token
// directly in that header.
export async function fbitsFetch<T = any>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${WAKE_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    return fbitsFetch<T>(token, method, path, body, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Token Wake inválido ou sem permissão.'), { status: 401 });
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }

  if (!res.ok) {
    const msg = (json as WakeError)?.mensagem || `Wake respondeu ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

async function getUserToken(uid: string): Promise<string | null> {
  const snap = await SECRET_REF(uid).get();
  return snap.exists ? (snap.data()?.token ?? null) : null;
}

// --- Import normalization --------------------------------------------------

export interface WakeNormalizedProduct {
  produtoId: string;
  sku: string;
  nome: string;
  precoPor?: number;
  precoDe?: number;
  ean?: string;
  informacaoId?: number;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  categorias: string[];
  imagens: string[];
  raw: unknown; // aggregated raw payload — used for backup/versioning
}

async function aggregateProduct(token: string, p: any): Promise<WakeNormalizedProduct> {
  const id = String(p.produtoId ?? p.produtoVarianteId);
  const q = `?tipoIdentificador=ProdutoId`;
  const [informacoes, categorias, imagens, seo, metaTag] = await Promise.all([
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/informacoes${q}`).catch(() => []),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/categorias${q}`).catch(() => []),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/imagens${q}`).catch(() => []),
    fbitsFetch<any>(token, 'GET', `/produtos/${id}/seo${q}`).catch(() => null),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/seo/metaTag${q}`).catch(() => []),
  ]);
  const infoBloco = Array.isArray(informacoes)
    ? (informacoes.find((i) => i?.tipoInformacao === 'Informacoes') ?? informacoes[0])
    : undefined;
  const metaByName = (n: string): string | undefined =>
    (Array.isArray(metaTag) ? metaTag.find((m) => (m?.name ?? '').toLowerCase() === n)?.content : undefined)
    ?? (Array.isArray(seo?.metaTags) ? seo.metaTags.find((m: any) => (m?.name ?? '').toLowerCase() === n)?.content : undefined);
  return {
    produtoId: id,
    sku: p.sku ?? '',
    nome: p.nome ?? '',
    precoPor: p.precoPor,
    precoDe: p.precoDe,
    ean: p.ean,
    informacaoId: infoBloco?.informacaoId,
    descricaoHtml: infoBloco?.texto,
    seoTitle: seo?.title,
    seoDescription: metaByName('description'),
    seoKeywords: metaByName('keywords'),
    categorias: Array.isArray(categorias)
      ? categorias.map((c: any) => c?.nome ?? c?.nomeCategoria).filter(Boolean)
      : [],
    imagens: Array.isArray(imagens)
      ? imagens.map((im: any) => im?.url ?? im?.urlImagem).filter(Boolean)
      : [],
    raw: { produto: p, informacoes, categorias, imagens, seo, metaTag },
  };
}

// --- Push ------------------------------------------------------------------

export interface WakePushProduct {
  produtoId: string;
  sku?: string;
  informacaoId?: number;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  atributos?: { nome: string; valor: string }[];
  imagensBase64?: { base64: string; formato: 'JPG' | 'PNG' }[];
  campos: { descricao: boolean; seo: boolean; atributos: boolean; imagens: boolean };
}

export interface WakePushResult {
  produtoId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'atributos' | 'imagens', string>;
}

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerWakeRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Validate and persist the token (server-side, via Admin SDK).
  app.post('/api/wake/validate', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token: string | undefined = req.body?.token?.trim();
      if (!token) return res.status(400).json({ valid: false, message: 'Token obrigatório.' });

      // A single-record GET just to confirm the credentials work.
      await fbitsFetch(token, 'GET', '/produtos?quantidadeRegistros=1&pagina=1');

      await SECRET_REF(uid).set({ token, updatedAt: FieldValue.serverTimestamp() });
      await STATUS_REF(uid).set({
        connected: true,
        validated: true,
        connectedAt: FieldValue.serverTimestamp(),
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ valid: true, message: 'Conectado com sucesso.' });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 400)
        .json({ valid: false, message: e?.message ?? 'Falha na validação.' });
    }
  });

  // Non-sensitive status (never the token).
  app.get('/api/wake/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await STATUS_REF(uid).get();
      const hasToken = (await SECRET_REF(uid).get()).exists;
      const d = snap.data() ?? {};
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });

  app.delete('/api/wake/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await SECRET_REF(uid).delete().catch(() => {});
      await STATUS_REF(uid).set({ connected: false, validated: false }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });

  // Paginated product import with aggregation of info/categories/images/seo.
  app.post('/api/wake/import', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token = await getUserToken(uid);
      if (!token) return res.status(400).json({ message: 'Wake não conectada.' });

      const pagina = Number(req.body?.pagina ?? 1);
      const quantidadeRegistros = Math.min(Number(req.body?.quantidadeRegistros ?? 50), 50);
      const lista = await fbitsFetch<any[]>(
        token, 'GET',
        `/produtos?pagina=${pagina}&quantidadeRegistros=${quantidadeRegistros}&camposAdicionais=Atributo&camposAdicionais=Informacao`,
      );
      const arr = Array.isArray(lista) ? lista : [];
      const produtos: WakeNormalizedProduct[] = [];
      for (const p of arr) {
        produtos.push(await aggregateProduct(token, p));
      }
      return res.json({ pagina, count: produtos.length, hasMore: arr.length === quantidadeRegistros, produtos });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha na importação.' });
    }
  });

  // Push enriched fields back to Wake. Per-product error handling: one failure
  // does not abort the batch.
  app.post('/api/wake/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token = await getUserToken(uid);
      if (!token) return res.status(400).json({ message: 'Wake não conectada.' });

      const produtos: WakePushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      const resultados: WakePushResult[] = [];

      for (const prod of produtos) {
        const id = prod.produtoId;
        const q = `?tipoIdentificador=ProdutoId`;
        const steps: WakePushResult['steps'] = { descricao: 'skip', seo: 'skip', atributos: 'skip', imagens: 'skip' };

        // 1) Description -> product information block
        if (prod.campos.descricao && prod.descricaoHtml) {
          try {
            let infoId = prod.informacaoId;
            if (!infoId) {
              const infos = await fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/informacoes${q}`).catch(() => []);
              infoId = (Array.isArray(infos)
                ? (infos.find((i) => i?.tipoInformacao === 'Informacoes') ?? infos[0])
                : undefined)?.informacaoId;
            }
            if (infoId) {
              await fbitsFetch(token, 'PUT', `/produtos/${id}/informacoes/${infoId}${q}`, {
                texto: prod.descricaoHtml, exibirSite: true, tipoInformacao: 'Informacoes',
              });
              steps.descricao = 'ok';
            } else {
              steps.descricao = 'Sem bloco de informação para atualizar';
            }
          } catch (e: any) { steps.descricao = e?.message ?? 'erro'; }
        }

        // 2) SEO + metatags
        if (prod.campos.seo && (prod.seoTitle || prod.seoDescription || prod.seoKeywords)) {
          try {
            const metaTags: { name: string; content: string }[] = [];
            if (prod.seoDescription) metaTags.push({ name: 'description', content: prod.seoDescription });
            if (prod.seoKeywords) metaTags.push({ name: 'keywords', content: prod.seoKeywords });
            await fbitsFetch(token, 'POST', `/produtos/${id}/seo${q}`, { title: prod.seoTitle, metaTags });
            steps.seo = 'ok';
          } catch (e: any) { steps.seo = e?.message ?? 'erro'; }
        }

        // 3) Attributes -> PUT product
        if (prod.campos.atributos && prod.atributos?.length) {
          try {
            await fbitsFetch(token, 'PUT', `/produtos/${id}${q}`, {
              listaAtributos: prod.atributos.map((a) => ({ nome: a.nome, valor: a.valor, exibir: true })),
            });
            steps.atributos = 'ok';
          } catch (e: any) { steps.atributos = e?.message ?? 'erro'; }
        }

        // 4) Ambient images
        if (prod.campos.imagens && prod.imagensBase64?.length) {
          try {
            await fbitsFetch(token, 'POST', `/produtos/${id}/imagens${q}`, prod.imagensBase64.map((img, i) => ({
              base64: img.base64, formato: img.formato, exibirMiniatura: false, estampa: false, ordem: 100 + i,
            })));
            steps.imagens = 'ok';
          } catch (e: any) { steps.imagens = e?.message ?? 'erro'; }
        }

        const ok = (['descricao', 'seo', 'atributos', 'imagens'] as const)
          .every((k) => steps[k] === 'ok' || steps[k] === 'skip');
        resultados.push({ produtoId: id, sku: prod.sku, ok, steps });
      }

      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
