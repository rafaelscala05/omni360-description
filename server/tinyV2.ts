// Tiny ERP API v2 client. The legacy API authenticates with a static integration
// token (POST form, formato=json) and wraps everything in { retorno: {...} }.
// Used as an alternative to the v3 (OAuth) client via server/tinyProvider.ts.
import { SECRET_REF, sleep, type TinyNormalizedProduct, type TinyPushProduct } from './tinyAgent';

const V2_BASE = 'https://api.tiny.com.br/api2';
const PAGE_SIZE = 100; // v2 lists 100 records per page

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

// ISO → dd/mm/yyyy hh:mm:ss (the format v2 date filters expect).
function toBrDateTime(isoStr?: string | null): string {
  const d = isoStr ? new Date(isoStr) : new Date(0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function getV2Token(uid: string): Promise<string | null> {
  const snap = await SECRET_REF(uid).get();
  const d = snap.data();
  return d?.version === 'v2' && d?.token ? String(d.token) : null;
}

// Low-level v2 call with an explicit token (used by validate before the token is
// persisted). Retries on network/5xx and on Tiny's rate-limit error.
export async function tinyV2CallRaw(token: string, endpoint: string, params: Record<string, string>, attempt = 0): Promise<any> {
  const body = new URLSearchParams({ token, formato: 'json', ...params });
  let res: Response;
  try {
    res = await fetch(`${V2_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e: any) {
    if (attempt < 3) { await sleep(2 ** attempt * 700); return tinyV2CallRaw(token, endpoint, params, attempt + 1); }
    throw Object.assign(new Error('Falha de rede ao chamar o Tiny (v2).'), { status: 502 });
  }

  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 5000 * 2 ** attempt));
    return tinyV2CallRaw(token, endpoint, params, attempt + 1);
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  const retorno = json?.retorno ?? {};

  // v2 signals rate limiting inside retorno (HTTP 200). Back off and retry.
  const errMsg = Array.isArray(retorno?.erros)
    ? retorno.erros.map((e: any) => e?.erro ?? e).join('; ')
    : (retorno?.erros?.erro ?? '');
  const rateLimited = String(retorno?.codigo_erro) === '6' || /requisi|limit/i.test(String(errMsg));
  if (retorno?.status === 'Erro' && rateLimited && attempt < 4) {
    await sleep(Math.min(60000, 5000 * 2 ** attempt));
    return tinyV2CallRaw(token, endpoint, params, attempt + 1);
  }

  if (retorno?.status && retorno.status !== 'OK') {
    // "No records" (codigo_erro 20) is not a failure — it's an empty result.
    const noRecords = String(retorno?.codigo_erro) === '20' || /n[ãa]o.*(retornou|encontrad)|nenhum registro|no records/i.test(String(errMsg));
    if (noRecords) return { ...retorno, produtos: [] };
    const status = /token|inv[áa]lid|autoriz|acesso negado/i.test(String(errMsg)) ? 401 : 400;
    throw Object.assign(new Error(errMsg || `Tiny v2 respondeu status ${retorno.status}`), { status });
  }
  return retorno;
}

async function tinyV2Call(uid: string, endpoint: string, params: Record<string, string>): Promise<any> {
  const token = await getV2Token(uid);
  if (!token) throw Object.assign(new Error('Tiny (v2) não conectado.'), { status: 401 });
  return tinyV2CallRaw(token, endpoint, params);
}

// Validates a token by fetching one page of products.
export async function validateV2Token(token: string): Promise<boolean> {
  await tinyV2CallRaw(token, 'produtos.pesquisa.php', { pesquisa: '', pagina: '1' });
  return true;
}

// --- Normalization ---------------------------------------------------------

function collectV2Images(p: any): string[] {
  const urls: string[] = [];
  const push = (u: any) => { if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u); };
  if (Array.isArray(p?.imagens_externas)) p.imagens_externas.forEach((im: any) => push(im?.url ?? im?.imagem_externa ?? im));
  if (Array.isArray(p?.anexos)) p.anexos.forEach((a: any) => push(a?.anexo ?? a?.url ?? a));
  return Array.from(new Set(urls));
}

export function normalizeV2Product(p: any): TinyNormalizedProduct {
  const seo = p?.seo ?? p ?? {};
  const categoria = typeof p?.categoria === 'string' ? p.categoria : (p?.categoria?.nome ?? p?.categoria?.descricao);
  return {
    tinyId: String(p?.id),
    sku: p?.codigo ?? '',
    nome: p?.nome ?? '',
    descricaoHtml: p?.descricao_complementar || undefined,
    seoTitle: seo?.seo_title || undefined,
    seoDescription: seo?.seo_description || undefined,
    seoKeywords: seo?.seo_keywords || undefined,
    ncm: p?.ncm || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: num(p?.peso_liquido),
    pesoBruto: num(p?.peso_bruto),
    largura: num(p?.largura_embalagem),
    altura: num(p?.altura_embalagem),
    comprimento: num(p?.comprimento_embalagem),
    precoPor: num(p?.preco),
    precoDe: num(p?.preco_promocional),
    categorias: categoria ? [String(categoria)] : [],
    imagens: collectV2Images(p),
    raw: p,
  };
}

// --- Provider surface (called by tinyProvider) -----------------------------

export async function listV2Page(
  uid: string,
  opts: { offset: number; mode: 'full' | 'update'; sinceISO?: string | null },
): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  if (opts.mode === 'update') {
    // lista.atualizacoes.produtos is a queue: each call drains pending changes and
    // marks them processed, so always read the head and finish when it's empty.
    const r = await tinyV2Call(uid, 'lista.atualizacoes.produtos', {
      dataAlteracao: toBrDateTime(opts.sinceISO), pagina: '1',
    });
    const arr: any[] = Array.isArray(r?.produtos) ? r.produtos : [];
    const items = arr.map((x) => ({ id: String(x?.produto?.id ?? x?.id) })).filter((x) => x.id && x.id !== 'undefined');
    return { items, total: 0, done: items.length === 0 };
  }

  const pagina = Math.floor(opts.offset / PAGE_SIZE) + 1;
  const r = await tinyV2Call(uid, 'produtos.pesquisa.php', { pesquisa: '', situacao: 'A', pagina: String(pagina) });
  const arr: any[] = Array.isArray(r?.produtos) ? r.produtos : [];
  const items = arr.map((x) => ({ id: String(x?.produto?.id ?? x?.id) })).filter((x) => x.id && x.id !== 'undefined');
  const numPaginas = Number(r?.numero_paginas ?? 1);
  return {
    items,
    total: numPaginas * PAGE_SIZE, // approximate (last page may be partial)
    done: items.length < PAGE_SIZE || pagina >= numPaginas,
  };
}

export async function getV2Product(uid: string, id: string): Promise<TinyNormalizedProduct> {
  const r = await tinyV2Call(uid, 'produto.obter.php', { id });
  return normalizeV2Product(r?.produto ?? {});
}

// Updates a product via produto.alterar.php. nome is required by the API, so we
// echo the current name; images merge with the existing external images.
export async function updateV2Product(uid: string, id: string, prod: TinyPushProduct): Promise<void> {
  const current = (await tinyV2Call(uid, 'produto.obter.php', { id }))?.produto ?? {};
  const produto: Record<string, any> = { sequencia: 1, id, nome: current?.nome };

  if (prod.campos.descricao && prod.descricaoHtml) produto.descricao_complementar = prod.descricaoHtml;

  if (prod.campos.seo) {
    const seo: Record<string, any> = {};
    if (prod.seoTitle) seo.seo_title = prod.seoTitle;
    if (prod.seoDescription) seo.seo_description = prod.seoDescription;
    if (prod.seoKeywords) seo.seo_keywords = prod.seoKeywords;
    if (Object.keys(seo).length) produto.seo = seo;
  }

  if (prod.campos.fiscal) {
    if (prod.ncm) produto.ncm = prod.ncm;
    if (prod.gtin) produto.gtin = prod.gtin;
    if (prod.pesoLiquido != null) produto.peso_liquido = prod.pesoLiquido;
    if (prod.pesoBruto != null) produto.peso_bruto = prod.pesoBruto;
    if (prod.largura != null) produto.largura_embalagem = prod.largura;
    if (prod.altura != null) produto.altura_embalagem = prod.altura;
    if (prod.comprimento != null) produto.comprimento_embalagem = prod.comprimento;
  }

  if (prod.campos.imagens && prod.imagens?.length) {
    const merged = Array.from(new Set([...collectV2Images(current), ...prod.imagens]));
    produto.imagens_externas = merged.map((url) => ({ url }));
  }

  const payload = JSON.stringify({ produtos: [{ produto }] });
  await tinyV2Call(uid, 'produto.alterar.php', { produto: payload });
}
