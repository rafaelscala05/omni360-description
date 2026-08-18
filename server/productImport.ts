// Extração determinística de dados de produto a partir de HTML: tenta JSON-LD
// (schema.org/Product) primeiro, cai para Open Graph / meta tags de preço.
// Nunca lança — HTML malformado ou campos ausentes só resultam em campos
// vazios no retorno; quem decide o que fazer com isso é o chamador.
import * as cheerio from 'cheerio';

export interface ExtractedProductFields {
  title?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  brand?: string;
}

function firstImage(image: unknown): string | undefined {
  if (typeof image === 'string') return image;
  if (Array.isArray(image) && typeof image[0] === 'string') return image[0];
  if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
    return (image as { url: string }).url;
  }
  return undefined;
}

function parsePrice(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function extractFromJsonLd($: cheerio.CheerioAPI): ExtractedProductFields | null {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const script of scripts) {
    const raw = $(script).contents().text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const node = candidate as Record<string, unknown>;
      const type = node['@type'];
      const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      if (!isProduct) continue;

      const offers = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const brand = node.brand as { name?: string } | string | undefined;

      return {
        title: typeof node.name === 'string' ? node.name : undefined,
        description: typeof node.description === 'string' ? node.description : undefined,
        imageUrl: firstImage(node.image),
        price: parsePrice(offer?.price ?? offer?.lowPrice),
        brand: typeof brand === 'string' ? brand : brand?.name,
      };
    }
  }
  return null;
}

function extractFromOpenGraph($: cheerio.CheerioAPI): ExtractedProductFields {
  const meta = (name: string) => $(`meta[property="${name}"]`).attr('content')?.trim();
  return {
    title: meta('og:title'),
    description: meta('og:description'),
    imageUrl: meta('og:image'),
    price: parsePrice(meta('product:price:amount') ?? $('[itemprop="price"]').attr('content')),
  };
}

function dropEmpty(fields: ExtractedProductFields): ExtractedProductFields {
  const out: ExtractedProductFields = {};
  if (fields.title) out.title = fields.title;
  if (fields.description) out.description = fields.description;
  if (typeof fields.price === 'number') out.price = fields.price;
  if (fields.imageUrl) out.imageUrl = fields.imageUrl;
  if (fields.brand) out.brand = fields.brand;
  return out;
}

export function parseProductFromHtml(html: string): ExtractedProductFields {
  const $ = cheerio.load(html);
  const fromJsonLd = extractFromJsonLd($);
  const fromOg = extractFromOpenGraph($);
  // JSON-LD é a fonte primária; OG só preenche o que faltou.
  return dropEmpty({ ...fromOg, ...fromJsonLd });
}
