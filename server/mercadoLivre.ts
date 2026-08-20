// Leitura de produto de catálogo do Mercado Livre via API oficial.
//
// Por que isso existe: o scrape direto (server/productImport.ts + safeUrl.ts)
// bate num desafio anti-bot do ML que valida a origem da conexão, não só o
// User-Agent — confirmado que nem o UA de Googlebot passa quando a requisição
// sai da rede do Cloud Run (ver histórico do commit que removeu o retry
// diagnóstico). A API oficial não tem esse problema.
//
// O que a API permite sem autorização de vendedor (só client_credentials, um
// token de aplicação): GET /products/{id} — o registro de "produto de
// catálogo" do ML (agregação canônica de um item entre vários vendedores),
// que é exatamente o que uma URL no formato .../p/MLB<id> referencia. Testado
// e confirmado: GET /items/{id} (uma oferta específica de um vendedor) volta
// 403 sem autorização desse vendedor — por isso não tentamos isso aqui, só o
// endpoint de catálogo.

const CLIENT_ID = process.env.MERCADOLIVRE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.MERCADOLIVRE_CLIENT_SECRET ?? '';
const API_BASE = 'https://api.mercadolibre.com';

export interface MercadoLivreProductFields {
  title?: string;
  description?: string;
  imageUrl?: string;
  brand?: string;
  category?: string[];
}

// URLs de catálogo têm o formato .../p/MLB12345678 (o "/p/" é o que distingue
// um produto de catálogo de uma oferta individual — só o primeiro tem GET
// /products/{id} acessível sem autorização de vendedor).
const CATALOG_URL_PATTERN = /mercadoli(?:vre|bre)\.com(?:\.[a-z]{2})?\/(?:[^/]+\/)?p\/(MLB\d+)/i;
const MERCADO_LIVRE_HOST_PATTERN = /(^|\.)mercadoli(?:vre|bre)\.com(?:\.[a-z]{2})?$/i;

export function extractCatalogProductId(url: string): string | null {
  const match = url.match(CATALOG_URL_PATTERN);
  return match ? match[1] : null;
}

// Scraping o domínio do Mercado Livre nunca é confiável a partir da rede do
// Cloud Run (bloqueio por reputação de IP, não só User-Agent — ver
// server/safeUrl.ts). Pra qualquer URL desse domínio, o import deve usar só a
// API oficial (fetchCatalogProduct) e, se não achar, ir direto pro
// preenchimento manual — nunca tentar o scraper genérico.
export function isMercadoLivreUrl(rawUrl: string): boolean {
  try {
    return MERCADO_LIVRE_HOST_PATTERN.test(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw Object.assign(new Error('Integração com Mercado Livre não configurada no servidor'), { status: 500 });
  }
  const resp = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!resp.ok) {
    throw Object.assign(new Error(`Falha ao autenticar com o Mercado Livre (${resp.status})`), { status: 502 });
  }
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  // Renova 5min antes de expirar (token dura 6h) pra nunca usar um token vencido.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return cachedToken.value;
}

async function mlFetch<T>(path: string): Promise<T | null> {
  const token = await getAppToken();
  const resp = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw Object.assign(new Error(`Mercado Livre respondeu ${resp.status} em ${path}`), { status: 502 });
  }
  return (await resp.json()) as T;
}

interface CatalogProductResponse {
  name?: string;
  short_description?: { content?: string } | null;
  pictures?: { url?: string }[];
  attributes?: { id?: string; value_name?: string }[];
}

interface DomainDiscoveryResult {
  category_id?: string;
}

interface CategoryResponse {
  path_from_root?: { name?: string }[];
}

// A resposta de /products/{id} não traz o caminho de categoria (só domain_id,
// tipo "MLB-PILLOWS", que não é o breadcrumb que a UI espera) — resolve via
// domain_discovery (que casa o título com um domínio+categoria) e depois pega
// o path_from_root da categoria. Nunca lança: sem categoria, o produto ainda
// é útil (usuário escolhe/cria a categoria na revisão).
async function resolveCategoryPath(title: string): Promise<string[] | undefined> {
  try {
    const results = await mlFetch<DomainDiscoveryResult[]>(
      `/sites/MLB/domain_discovery/search?q=${encodeURIComponent(title)}`,
    );
    const categoryId = results?.[0]?.category_id;
    if (!categoryId) return undefined;
    const category = await mlFetch<CategoryResponse>(`/categories/${categoryId}`);
    const names = category?.path_from_root?.map((c) => c.name).filter((n): n is string => !!n);
    return names?.length ? names : undefined;
  } catch {
    return undefined;
  }
}

// Preço não vem nessa resposta — /products/{id} é o registro canônico do
// catálogo, compartilhado entre vendedores; o preço é da oferta individual
// (buy_box_winner), que exige autorização do vendedor pra ler. Usuário
// completa o preço à mão, igual já acontece quando o scrape não acha preço.
export async function fetchCatalogProduct(catalogProductId: string): Promise<MercadoLivreProductFields | null> {
  const product = await mlFetch<CatalogProductResponse>(`/products/${catalogProductId}`);
  if (!product) return null;

  const title = product.name || undefined;
  const brand = product.attributes?.find((a) => a.id === 'BRAND')?.value_name;
  const category = title ? await resolveCategoryPath(title) : undefined;

  return {
    title,
    description: product.short_description?.content || undefined,
    imageUrl: product.pictures?.[0]?.url,
    brand,
    category,
  };
}
