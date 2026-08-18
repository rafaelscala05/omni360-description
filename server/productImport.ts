// Extração determinística de dados de produto a partir de HTML: tenta JSON-LD
// (schema.org/Product) primeiro, cai para Open Graph / meta tags de preço.
// Nunca lança — HTML malformado ou campos ausentes só resultam em campos
// vazios no retorno; quem decide o que fazer com isso é o chamador.
import * as cheerio from 'cheerio';
import type express from 'express';
import { GoogleGenAI } from '@google/genai';
import firebaseAppletConfig from '../firebase-applet-config.json';
import { assertSafeUrl, fetchHtmlSafely } from './safeUrl';

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

// ---------------------------------------------------------------------------
// Rota POST /api/product-import/scrape
// ---------------------------------------------------------------------------

const TEXT_MODEL = 'gemini-2.5-flash';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

function getClient(): GoogleGenAI {
  if (!VERTEX_PROJECT) {
    throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor'), { status: 500 });
  }
  return new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('temporarily');
      if (is503 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function parseJson<T = unknown>(text: string): T {
  let cleaned = (text || '').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned || '{}');
  } catch {
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('A IA não retornou um JSON válido.');
  }
}

// Preenche description/title quando o parsing estruturado não trouxe o
// suficiente, a partir de um digest de texto da página (mesmo padrão de
// scanWebsite em contentAgent.ts).
async function fillGapsWithAi(html: string, url: string): Promise<{ title?: string; description?: string }> {
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const title = $('title').first().text().trim();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
  const digest = [`URL: ${url}`, title && `Título da página: ${title}`, `Conteúdo: ${bodyText}`].filter(Boolean).join('\n');

  const prompt = [
    'A partir do conteúdo de página de produto abaixo, infira nome e uma descrição curta do produto.',
    'Responda ESTRITAMENTE em JSON: {"title":"...","description":"..."}',
    'Se não for possível inferir algum campo, deixe como string vazia. Português do Brasil.',
    '',
    digest,
  ].join('\n');

  const ai = getClient();
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
  );
  const parsed = parseJson<{ title?: string; description?: string }>(resp.text ?? '{}');
  return { title: parsed.title || undefined, description: parsed.description || undefined };
}

interface ProductImportDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  console.error('product-import endpoint error:', err);
  res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno' });
}

// Rate limit simples por uid (mitigação contra abuso do endpoint como proxy de
// scraping). Em memória: não sobrevive a restart/múltiplas instâncias — risco
// aceito, não há evidência de deploy multi-instância neste projeto hoje.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const requestLog = new Map<string, number[]>();

function checkRateLimit(uid: string): void {
  const now = Date.now();
  const timestamps = (requestLog.get(uid) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    throw Object.assign(new Error('Muitas tentativas. Tente novamente mais tarde.'), { status: 429 });
  }
  timestamps.push(now);
  requestLog.set(uid, timestamps);
}

export function registerProductImportRoutes(app: express.Application, deps: ProductImportDeps): void {
  app.post('/api/product-import/scrape', async (req, res) => {
    try {
      const { uid } = await deps.verifyFirebaseToken(req);
      checkRateLimit(uid);

      const rawUrl = String(req.body?.url ?? '').trim();
      if (!rawUrl) {
        throw Object.assign(new Error('URL é obrigatória'), { status: 422 });
      }
      await assertSafeUrl(rawUrl);

      let html: string;
      try {
        html = await fetchHtmlSafely(rawUrl);
      } catch (fetchErr) {
        console.warn('product-import: fetch falhou', (fetchErr as Error).message);
        return res.json({ product: {}, source: 'failed' });
      }

      const structured = parseProductFromHtml(html);
      const needsAiGaps = !structured.title || !structured.description || structured.description.length < 40;

      if (!needsAiGaps) {
        return res.json({ product: structured, source: 'structured' });
      }

      try {
        const gaps = await fillGapsWithAi(html, rawUrl);
        const merged = {
          ...structured,
          title: structured.title || gaps.title,
          description: structured.description || gaps.description,
        };
        const source = Object.keys(structured).length > 0 ? 'hybrid' : 'ai';
        return res.json({ product: merged, source });
      } catch (aiErr) {
        console.warn('product-import: preenchimento por IA falhou', (aiErr as Error).message);
        // Estruturado parcial ainda é útil — devolve o que temos.
        return res.json({ product: structured, source: Object.keys(structured).length > 0 ? 'structured' : 'failed' });
      }
    } catch (err) {
      sendError(res, err);
    }
  });
}
