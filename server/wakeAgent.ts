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
  atributos: { nome: string; valor: string }[];
  raw: unknown; // aggregated raw payload — used for backup/versioning
}

async function aggregateProduct(token: string, p: any): Promise<WakeNormalizedProduct> {
  const id = String(p.produtoId ?? p.produtoVarianteId);
  const q = `?tipoIdentificador=ProdutoId`;
  // The images endpoint rejects ProdutoId (422); it requires Sku or
  // ProdutoVarianteId. We key it by produtoVarianteId, always present here.
  const varianteId = String(p.produtoVarianteId ?? id);
  const [informacoes, categorias, imagens, seo, metaTag] = await Promise.all([
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/informacoes${q}`).catch(() => []),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/categorias${q}`).catch(() => []),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${varianteId}/imagens?tipoIdentificador=ProdutoVarianteId`).catch(() => []),
    fbitsFetch<any>(token, 'GET', `/produtos/${id}/seo${q}`).catch(() => null),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/seo/metaTag${q}`).catch(() => []),
  ]);
  const infoBloco = Array.isArray(informacoes)
    ? (informacoes.find((i) => i?.tipoInformacao === 'Informacoes') ?? informacoes[0])
    : undefined;
  // The SEO GET returns metatags (lowercase); the dedicated metaTag endpoint
  // returns the same array. Read both, lowercase-keyed.
  const metaByName = (n: string): string | undefined =>
    (Array.isArray(metaTag) ? metaTag.find((m) => (m?.name ?? '').toLowerCase() === n)?.content : undefined)
    ?? (Array.isArray(seo?.metatags) ? seo.metatags.find((m: any) => (m?.name ?? '').toLowerCase() === n)?.content : undefined);
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
    atributos: Array.isArray(p.atributos)
      ? p.atributos
          .map((a: any) => ({ nome: a?.nome, valor: a?.valor }))
          .filter((a: { nome?: string; valor?: string }) => a.nome && a.valor)
      : [],
    raw: { produto: p, informacoes, categorias, imagens, seo, metaTag },
  };
}

// --- Push ------------------------------------------------------------------

export interface WakePushProduct {
  produtoId: string;
  sku?: string;
  nome?: string;
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

// Builds a valid body for PUT /produtos from the current product, echoing the
// fields the API requires/validates and swapping in the merged attribute list.
// Existing attributes are preserved; new values override matching names.
function buildProductPutBody(current: any, novos: { nome: string; valor: string }[], novaNome?: string): Record<string, unknown> {
  // Preserve the full existing attribute objects (tipoAtributo, isFiltro, …);
  // only override the value when a new attribute matches by name.
  const byName = new Map<string, Record<string, unknown>>();
  for (const a of (Array.isArray(current?.atributos) ? current.atributos : [])) {
    if (a?.nome) byName.set(a.nome, { ...a, exibir: a.exibir ?? true });
  }
  // Override existing values / add new attributes. Callers must ensure each
  // attribute already exists as a definition (POST /atributos) before the PUT,
  // since the product PUT is atomic and rejects unknown attributes.
  for (const a of novos) {
    const existing = byName.get(a.nome) ?? {};
    byName.set(a.nome, { ...existing, nome: a.nome, valor: a.valor, exibir: true });
  }

  const pick = (k: string) => (current?.[k] !== undefined && current?.[k] !== null ? current[k] : undefined);
  const body: Record<string, unknown> = {
    sku: current?.sku,
    nome: current?.nome,
    nomeProdutoPai: novaNome ?? pick('nomeProdutoPai'),
    fabricante: pick('fabricante'),
    precoCusto: pick('precoCusto'),
    precoDe: pick('precoDe'),
    precoPor: current?.precoPor, // required
    fatorMultiplicadorPreco: pick('fatorMultiplicadorPreco'),
    peso: pick('peso'),
    altura: pick('altura'),
    comprimento: pick('comprimento'),
    largura: pick('largura'),
    ean: pick('ean'),
    prazoEntrega: pick('prazoEntrega'),
    freteGratis: pick('freteGratis'),
    exibirSite: pick('exibirSite'),
    marketplace: pick('marketplace'),
    spot: pick('spot'),
    condicao: pick('condicao'),
    garantia: pick('garantia'),
    estoque: Array.isArray(current?.estoque) ? current.estoque : [],
    listaAtacado: Array.isArray(current?.listaAtacado) ? current.listaAtacado : [],
    listaAtributos: Array.from(byName.values()),
  };
  // Drop undefined keys so we never send nulls the API may reject.
  Object.keys(body).forEach((k) => { if (body[k] === undefined) delete body[k]; });
  return body;
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
        const steps: WakePushResult['steps'] = { descricao: 'skip', seo: 'skip', atributos: 'skip', imagens: 'skip' };

        // Writes are keyed by SKU — the only identifier accepted across all
        // write endpoints (produto, informacoes, seo, imagens). ProdutoId is
        // rejected by the images endpoint, so we never use it here.
        if (!prod.sku) {
          resultados.push({ produtoId: prod.produtoId, sku: prod.sku, ok: false, steps: {
            descricao: 'Sem SKU', seo: 'Sem SKU', atributos: 'Sem SKU', imagens: 'Sem SKU',
          } });
          continue;
        }
        const id = encodeURIComponent(prod.sku);
        const q = `?tipoIdentificador=Sku`;

        // 1) Description -> product information block
        if (prod.campos.descricao && prod.descricaoHtml) {
          try {
            // Fetch the current info block to preserve its title/visibility and
            // resolve the id when the import didn't capture it.
            const infos = await fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/informacoes${q}`).catch(() => []);
            const block = Array.isArray(infos)
              ? (infos.find((i) => i?.informacaoId === prod.informacaoId)
                 ?? infos.find((i) => i?.tipoInformacao === 'Informacoes')
                 ?? infos[0])
              : undefined;
            const infoId = block?.informacaoId ?? prod.informacaoId;
            if (infoId) {
              await fbitsFetch(token, 'PUT', `/produtos/${id}/informacoes/${infoId}${q}`, {
                titulo: block?.titulo ?? 'Informações',
                texto: prod.descricaoHtml,
                exibirSite: block?.exibirSite ?? true,
                tipoInformacao: block?.tipoInformacao ?? 'Informacoes',
              });
              steps.descricao = 'ok';
            } else {
              steps.descricao = 'Sem bloco de informação para atualizar';
            }
          } catch (e: any) { steps.descricao = e?.message ?? 'erro'; }
        }

        // 2) SEO + metatags — PUT (update/replace) to avoid duplicating metatags.
        // Preserve the existing tagCanonical by reading the current SEO first.
        if (prod.campos.seo && (prod.seoTitle || prod.seoDescription || prod.seoKeywords)) {
          try {
            const metaTags: { name: string; content: string }[] = [];
            if (prod.seoDescription) metaTags.push({ name: 'description', content: prod.seoDescription });
            if (prod.seoKeywords) metaTags.push({ name: 'keywords', content: prod.seoKeywords });
            const currentSeo = await fbitsFetch<any>(token, 'GET', `/produtos/${id}/seo${q}`).catch(() => null);
            await fbitsFetch(token, 'PUT', `/produtos/${id}/seo${q}`, {
              tagCanonical: currentSeo?.tagCanonical ?? undefined,
              title: prod.seoTitle,
              metaTags,
            });
            steps.seo = 'ok';
          } catch (e: any) { steps.seo = e?.message ?? 'erro'; }
        }

        // 3) Attributes -> full-product PUT. The product PUT is atomic and
        // requires a valid body (price, stock, etc.), so we fetch the current
        // product and echo its fields, only swapping in the merged attributes.
        if (prod.campos.atributos && prod.atributos?.length) {
          try {
            // Fetch stock + attributes so the atomic PUT body stays valid.
            const current = await fbitsFetch<any>(
              token, 'GET',
              `/produtos/${id}${q}&camposAdicionais=Estoque&camposAdicionais=Atributo`,
            );
            // Create the definition for any attribute the product doesn't have
            // yet (Wake rejects unknown attributes in the product PUT). POST is
            // a no-op error if the definition already exists globally.
            const existentes = new Set(
              (Array.isArray(current?.atributos) ? current.atributos : []).map((a: any) => a?.nome),
            );
            for (const a of prod.atributos) {
              if (!existentes.has(a.nome)) {
                await fbitsFetch(token, 'POST', '/atributos', {
                  nome: a.nome, tipo: 'Comparacao', tipoExibicao: 'Div', prioridade: 0,
                }).catch(() => { /* já existe globalmente — segue */ });
              }
            }
            const body = buildProductPutBody(current, prod.atributos, prod.nome);
            await fbitsFetch(token, 'PUT', `/produtos/${id}${q}`, body);
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
