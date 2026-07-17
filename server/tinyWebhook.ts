// Tiny ERP product webhook (API v2 "envio de produtos"): receives one product
// per POST (parent + nested variações), synchronously, and must answer with
// the mapping array Tiny expects. This module normalizes the payload into the
// shared TinyNormalizedProduct shape so it can reuse tinyImportWorker's upsert.
// Docs: https://tiny.com.br/api-docs/api2-webhooks-envio-produtos
import { num } from './tinyV2';
import type { TinyNormalizedProduct } from './tinyAgent';

function collectWebhookImages(p: any): string[] {
  const urls: string[] = [];
  if (Array.isArray(p?.anexos)) {
    for (const a of p.anexos) {
      const u = a?.url;
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  return Array.from(new Set(urls));
}

function normalizeWebhookParent(p: any): TinyNormalizedProduct {
  const seo = p?.seo ?? {};
  const arvore = p?.descricaoArvoreCategoria || p?.descricaoCategoria;
  return {
    tinyId: String(p?.id),
    sku: p?.codigo ?? '',
    nome: p?.nome ?? '',
    descricaoHtml: p?.descricaoComplementar || undefined,
    seoTitle: seo?.title || undefined,
    seoDescription: seo?.description || undefined,
    seoKeywords: seo?.keywords || undefined,
    linkVideo: seo?.linkVideo || undefined,
    slug: seo?.slug || undefined,
    ncm: p?.ncm || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: num(p?.pesoLiquido),
    pesoBruto: num(p?.pesoBruto),
    largura: num(p?.larguraEmbalagem),
    altura: num(p?.alturaEmbalagem),
    comprimento: num(p?.comprimentoEmbalagem),
    precoPor: num(p?.preco),
    precoDe: num(p?.precoPromocional),
    estoque: num(p?.estoqueAtual),
    estoqueMinimo: num(p?.estoqueMinimo),
    estoqueMaximo: num(p?.estoqueMaximo),
    localizacao: p?.localizacao || undefined,
    marca: p?.marca || undefined,
    garantia: p?.garantia || undefined,
    sobEncomenda: p?.sobEncomenda || undefined,
    cest: p?.cest || undefined,
    diasPreparacao: num(p?.diasPreparacao),
    obs: p?.obs || undefined,
    unidadePorCaixa: p?.unidadePorCaixa || undefined,
    codigoFornecedor: p?.codigoFornecedor || undefined,
    unidade: p?.unidade || undefined,
    categorias: arvore ? [String(arvore)] : [],
    imagens: collectWebhookImages(p),
    raw: p,
  };
}

// Tiny doesn't send a display name per variação — reuse its own codigo so the
// row is identifiable in the product list.
function normalizeWebhookVariacao(v: any, parentCodigo: string): TinyNormalizedProduct {
  const grade = Array.isArray(v?.grade)
    ? v.grade.map((g: any) => `${g?.chave}: ${g?.valor}`).filter(Boolean).join(', ')
    : undefined;
  return {
    tinyId: String(v?.id),
    sku: v?.codigo ?? '',
    nome: v?.codigo ?? '',
    gtin: v?.gtin || undefined,
    precoPor: num(v?.preco),
    precoDe: num(v?.precoPromocional),
    estoque: num(v?.estoqueAtual),
    codigoPai: parentCodigo || undefined,
    variacaoGrade: grade || undefined,
    categorias: [],
    imagens: collectWebhookImages(v),
    raw: v,
  };
}

export function normalizeWebhookPayload(dados: any): { parent: TinyNormalizedProduct; variacoes: TinyNormalizedProduct[] } {
  const parent = normalizeWebhookParent(dados);
  const variacoes = Array.isArray(dados?.variacoes)
    ? dados.variacoes.map((v: any) => normalizeWebhookVariacao(v, parent.sku))
    : [];
  return { parent, variacoes };
}
