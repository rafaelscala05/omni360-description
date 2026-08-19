import { callJson } from './apiClient';

export interface ScrapedProductFields {
  title?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  brand?: string;
  category?: string[];
}

export interface ScrapeProductUrlResult {
  product: ScrapedProductFields;
  source: 'structured' | 'hybrid' | 'ai' | 'failed';
}

export async function scrapeProductUrl(url: string): Promise<ScrapeProductUrlResult> {
  return callJson('/api/product-import/scrape', 'POST', { url });
}
