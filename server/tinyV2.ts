// Tiny ERP API v2 client. The legacy API authenticates with a static integration
// token (POST form, formato=json) and wraps everything in { retorno: {...} }.
// Used as an alternative to the v3 (OAuth) client via server/tinyProvider.ts.
import { SECRET_REF, sleep, NOME_MAX, type TinyNormalizedProduct, type TinyPushProduct, type TinyPushSteps } from './tinyAgent';

const V2_BASE = 'https://api.tiny.com.br/api2';
const PAGE_SIZE = 100; // v2 lists 100 records per page

export const num = (v: unknown): number | undefined => {
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

  // Per-record errors (produto.alterar/incluir) live in registros[].registro.erros.
  // They come back BOTH with the top-level status already "Erro" (and an empty
  // top-level `erros`) and with status "OK" — so always collect them before
  // deciding what to throw, or the only thing the user sees is the useless
  // "Tiny v2 status Erro (cod ?)".
  const registros: any[] = Array.isArray(retorno?.registros) ? retorno.registros : [];
  const regErros: string[] = [];
  for (const r of registros) {
    const reg = r?.registro ?? r;
    if (reg?.status && reg.status !== 'OK') {
      const es = Array.isArray(reg?.erros) ? reg.erros.map((e: any) => e?.erro ?? e).join('; ') : (reg?.erros?.erro ?? `status ${reg.status}`);
      const cod = reg?.codigo_erro ?? retorno?.codigo_erro;
      regErros.push(cod ? `[cod ${cod}] ${es}` : String(es));
    }
  }

  if (retorno?.status && retorno.status !== 'OK') {
    // "No records" (codigo_erro 20) is not a failure — it's an empty result.
    const noRecords = String(retorno?.codigo_erro) === '20' || /n[ãa]o.*(retornou|encontrad)|nenhum registro|no records/i.test(String(errMsg));
    if (noRecords) return { ...retorno, produtos: [] };
    // Log the full response so a generic Tiny message ("erro inesperado") can be
    // correlated with the request in the server logs.
    console.error(`[tiny-v2] ${endpoint} status=${retorno.status} codigo_erro=${retorno.codigo_erro} retorno=${JSON.stringify(retorno).slice(0, 1500)}`);
    const motivo = String(errMsg) || regErros.join(' | ');
    const status = /token|inv[áa]lid|autoriz|acesso negado/i.test(motivo) ? 401 : 400;
    const detail = motivo
      ? (errMsg ? `[cod ${retorno.codigo_erro ?? '?'}] ${errMsg}` : motivo)
      : `Tiny v2 status ${retorno.status} (cod ${retorno.codigo_erro ?? '?'})`;
    throw Object.assign(new Error(detail), { status });
  }

  if (regErros.length) {
    console.error(`[tiny-v2] ${endpoint} erros por registro: ${JSON.stringify(retorno).slice(0, 1500)}`);
    throw Object.assign(new Error(`[registro] ${regErros.join(' | ')}`), { status: 400 });
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
  if (Array.isArray(p?.imagens_externas)) p.imagens_externas.forEach((im: any) => push(im?.imagem_externa?.url ?? im?.url ?? im?.imagem_externa ?? im));
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

// Updates a product via produto.alterar.php, sending only the fields whose local
// value actually differs from what Tiny currently has. produto.alterar is NOT a
// partial update — it validates the whole record — so required fields
// (unidade/preco/origem/situacao/tipo) are always echoed from the current product;
// only nome/descricao_complementar/seo/imagens are conditionally overridden.
// Skips the API call entirely when nothing differs.
//
// Fiscal/logistics data (ncm, gtin, cest, peso_liquido, peso_bruto, dimensões) is
// deliberately NEVER sent: the ERP is the system of record for it, the local values
// come from spreadsheets/AI enrichment, and writing ncm makes Tiny re-derive the
// cest — so a description push was silently rewriting the product's tax data.
export async function updateV2Product(uid: string, id: string, prod: TinyPushProduct, sobrescreverTitulo = true): Promise<TinyPushSteps> {
  const current = (await tinyV2Call(uid, 'produto.obter.php', { id }))?.produto ?? {};
  const cur = normalizeV2Product(current);
  const steps: TinyPushSteps = {
    titulo: 'sem dado local', descricao: 'sem dado local', seo: 'sem dado local', imagens: 'sem dado local',
  };
  const strDiffers = (a?: string, b?: string) => (a ?? '').trim() !== (b ?? '').trim();

  const produto: Record<string, any> = {
    sequencia: 1,
    id,
    codigo: current?.codigo,
    nome: current?.nome,
    unidade: current?.unidade,
    preco: current?.preco,
    origem: current?.origem,
    situacao: current?.situacao,
    tipo: current?.tipo,
  };

  if (prod.nome) {
    if (!sobrescreverTitulo) {
      steps.titulo = 'sobrescrita desativada';
    } else if (prod.nome.trim().length > NOME_MAX) {
      // produto.alterar rejects the whole record when nome exceeds Tiny's limit.
      // Skip just the title so the rest of the push still goes through.
      steps.titulo = `título com ${prod.nome.trim().length} caracteres — o Tiny aceita no máximo ${NOME_MAX}`;
    } else {
      steps.titulo = strDiffers(prod.nome, cur.nome) ? 'ok' : 'sem alteração';
      if (steps.titulo === 'ok') produto.nome = prod.nome;
    }
  }

  if (prod.descricaoHtml) {
    steps.descricao = strDiffers(prod.descricaoHtml, cur.descricaoHtml) ? 'ok' : 'sem alteração';
    if (steps.descricao === 'ok') produto.descricao_complementar = prod.descricaoHtml;
  }

  let seoChanged = false;
  if (prod.seoTitle && strDiffers(prod.seoTitle, cur.seoTitle)) seoChanged = true;
  if (prod.seoDescription && strDiffers(prod.seoDescription, cur.seoDescription)) seoChanged = true;
  if (prod.seoKeywords && strDiffers(prod.seoKeywords, cur.seoKeywords)) seoChanged = true;
  if (prod.seoTitle || prod.seoDescription || prod.seoKeywords) steps.seo = seoChanged ? 'ok' : 'sem alteração';
  if (seoChanged) {
    // v2's produto.alterar validates the whole record — send every sibling
    // key (seeded from Tiny's own current value) so an unrelated field isn't
    // blanked just because only one SEO sub-field changed.
    const seo: Record<string, any> = {
      seo_title: (prod.seoTitle && strDiffers(prod.seoTitle, cur.seoTitle)) ? prod.seoTitle : cur.seoTitle,
      seo_description: (prod.seoDescription && strDiffers(prod.seoDescription, cur.seoDescription)) ? prod.seoDescription : cur.seoDescription,
      seo_keywords: (prod.seoKeywords && strDiffers(prod.seoKeywords, cur.seoKeywords)) ? prod.seoKeywords : cur.seoKeywords,
    };
    Object.keys(seo).forEach((k) => { if (!seo[k]) delete seo[k]; });
    if (Object.keys(seo).length) produto.seo = seo;
  }

  let imagensChanged = false;
  if (prod.imagens?.length) {
    // Send ONLY images the product doesn't already have. Re-sending Tiny's own
    // hosted images (e.g. s3 tiny-anexos URLs, imported earlier) as "external"
    // makes produto.alterar fail with an internal error (cod 35).
    const currentUrls = new Set(collectV2Images(current));
    const novas = prod.imagens.filter((u) => !currentUrls.has(u));
    imagensChanged = novas.length > 0;
    steps.imagens = imagensChanged ? 'ok' : 'sem alteração';
    // Tiny's structure is imagens_externas[].imagem_externa.url — each URL must be
    // wrapped in an `imagem_externa` object, or produto.alterar fails with cod 35.
    if (imagensChanged) produto.imagens_externas = novas.map((url) => ({ imagem_externa: { url } }));
  }

  const hasAnyChange = steps.titulo === 'ok' || steps.descricao === 'ok' || steps.seo === 'ok' || steps.imagens === 'ok';
  if (!hasAnyChange) return steps;

  Object.keys(produto).forEach((k) => { if (produto[k] === undefined || produto[k] === null) delete produto[k]; });

  const payload = JSON.stringify({ produtos: [{ produto }] });
  console.log(`[tiny-v2] produto.alterar id=${id} payload=${payload.slice(0, 1500)}`);
  await tinyV2Call(uid, 'produto.alterar.php', { produto: payload });
  return steps;
}
