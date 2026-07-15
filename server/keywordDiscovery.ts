// Shared keyword-discovery helpers used by both the SEO audit (seoAgent.ts —
// enriches the pool right after Domain Analysis with "possible keywords") and
// cluster generation (contentAgent.ts — fallback when no audit pool exists
// yet). Extracted to its own module to avoid a circular import between those
// two files.

import { adminDb } from './firebaseAdmin';
import type { ContentProject } from '../src/modules/content/types';
import * as seRanking from './seRankingClient';
import type { KeywordCandidate } from './seRankingClient';

export interface StoreContext {
  text: string;            // compact summary for the Gemini prompt
  seedKeywords: string[];  // candidate terms to expand via SE Ranking (product/category names + SEO keywords)
}

// Pulls a compact summary of the user's product catalog + categories so the AI
// can ground content in what the store actually sells (cross-module data share),
// and a list of seed terms used to discover real keyword volume via SE Ranking.
export async function loadStoreContext(uid: string): Promise<StoreContext> {
  const userRef = adminDb.collection('users').doc(uid);
  const [prodSnap, catSnap] = await Promise.all([
    userRef.collection('products').limit(40).get(),
    userRef.collection('categories').limit(60).get(),
  ]);
  const products = prodSnap.docs
    .map((d) => {
      const p = d.data() as Record<string, unknown>;
      return (p['Nome'] || p['Descrição'] || p['Título SEO'] || '') as string;
    })
    .filter(Boolean)
    .slice(0, 40);
  const categories = catSnap.docs.map((d) => (d.data() as { name?: string }).name).filter(Boolean) as string[];

  // "Palavras chave SEO" is a free-text field (comma/semicolon separated).
  const productKeywords = prodSnap.docs.flatMap((d) => {
    const raw = (d.data() as Record<string, unknown>)['Palavras chave SEO'];
    return typeof raw === 'string' ? raw.split(/[,;]/).map((k) => k.trim()).filter(Boolean) : [];
  });

  const parts: string[] = [];
  if (products.length) parts.push(`Produtos do catálogo: ${products.join('; ')}`);
  if (categories.length) parts.push(`Categorias: ${categories.join('; ')}`);

  return { text: parts.join('\n'), seedKeywords: [...categories, ...productKeywords] };
}

// Builds the final seed list used for SE Ranking keyword discovery: the
// user-curated palavrasChave from onboarding come first (highest signal),
// then category names, then terms mined from the product catalog. Deduped
// and capped to bound both our runtime and SE Ranking's per-call API cost.
export function extractSeedKeywords(project: ContentProject, store: StoreContext, cap = 8): string[] {
  const ordered = [...(project.config.palavrasChave ?? []), ...store.seedKeywords];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ordered) {
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= cap) break;
  }
  return out;
}

// Runs `fn` over `items` with at most `limit` in flight at once — SE Ranking
// rate-limits ("too many requests") when all seeds fire their 3 calls each
// simultaneously (e.g. 8 seeds × 3 = 24 concurrent requests).
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Expands each seed into real, volume-tagged candidates via SE Ranking
// (related = topic expansion, longtail = subtopics, similar = variants).
// Long-tail results have no volume/intent, so they're backfilled in bulk.
export async function discoverKeywordPool(seeds: string[]): Promise<KeywordCandidate[]> {
  const withVolume: KeywordCandidate[] = [];
  const needsVolume: string[] = [];

  await mapWithConcurrency(seeds, 2, async (seed) => {
    try {
      const [related, similar, longtail] = await Promise.all([
        seRanking.getRelatedKeywords(seed),
        seRanking.getSimilarKeywords(seed),
        seRanking.getLongTailKeywords(seed),
      ]);
      withVolume.push(...related, ...similar);
      needsVolume.push(...longtail);
    } catch (e) {
      console.error(`SE Ranking: falha ao expandir a seed "${seed}":`, e);
    }
  });

  if (needsVolume.length) {
    try {
      const metrics = await seRanking.getKeywordsMetrics(needsVolume);
      for (const termo of needsVolume) {
        withVolume.push({ termo, volume: metrics[termo], intencao: 'informacional' });
      }
    } catch (e) {
      console.error('SE Ranking: falha ao buscar volume das long-tails:', e);
    }
  }

  return seRanking.mergeKeywordCandidates([withVolume]);
}
