// Thin HTTP client for the SE Ranking Data API (https://api.seranking.com).
// Used by server/seoAgent.ts (site audits) and server/contentAgent.ts (keyword
// research for cluster generation). No SDK — direct fetch, mirrors the style of
// server/wakeAgent.ts / tinyProvider.ts.
//
// Auth: `Authorization: Token <SE_RANKING_API_KEY>` header.
// Region: this app is pt-BR only, so `source` defaults to 'br' everywhere.

import type { SearchIntent, DomainOverviewStats, DomainHistoryPoint, DomainKeywordDetail } from '../src/modules/content/types';

const BASE_URL = 'https://api.seranking.com/v1';
const DEFAULT_SOURCE = 'br';

function apiKey(): string {
  const key = process.env.SE_RANKING_API_KEY;
  if (!key) {
    throw Object.assign(new Error('SE_RANKING_API_KEY não configurada no servidor'), { status: 500 });
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seRankingFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  { query, body }: { query?: Record<string, string>; body?: unknown } = {},
  attempt = 0,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Token ${apiKey()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  // Rate limit / transient server errors — retry with backoff + jitter (mirrors
  // tinyFetch). SE Ranking reports rate limiting as a 500 with a "too many
  // requests" body, not a 429, so both are treated the same way here. Jitter
  // spreads out retries from concurrent callers instead of having them all
  // collide on the same next attempt.
  if ((resp.status === 429 || resp.status >= 500) && attempt < 4) {
    const retryAfter = Number(resp.headers.get('retry-after'));
    const base = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    const wait = base + Math.random() * 500;
    await sleep(wait);
    return seRankingFetch<T>(method, path, { query, body }, attempt + 1);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(
      new Error(`SE Ranking API falhou (${resp.status} ${path}): ${text.slice(0, 300)}`),
      { status: resp.status >= 400 && resp.status < 500 ? 400 : 502 },
    );
  }
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Site audit
// ---------------------------------------------------------------------------

export interface AuditSettingsOverride {
  max_pages?: number;
  source_site?: 0 | 1;
  source_sitemap?: 1 | 0;
}

export async function createStandardAudit(domain: string, settings?: AuditSettingsOverride): Promise<{ id: number }> {
  return seRankingFetch<{ id: number }>('POST', '/site-audit/audits/standard', {
    body: {
      domain,
      title: `Auditoria SEO — ${domain}`,
      // Teto menor que o default (1000) da SE Ranking, para controlar duração/custo.
      settings: { max_pages: 300, ...settings },
    },
  });
}

export type SeRankingAuditRawStatus = 'queued' | 'processing' | 'finished' | 'failed' | 'error';

export interface AuditStatusResponse {
  status: SeRankingAuditRawStatus;
  total_pages?: number;
  total_errors?: number;
  total_warnings?: number;
  total_passed?: number;
}

export async function getAuditStatus(auditId: number): Promise<AuditStatusResponse> {
  return seRankingFetch<AuditStatusResponse>('GET', '/site-audit/audits/status', {
    query: { audit_id: String(auditId) },
  });
}

interface AuditReportProp {
  code: string;
  status: 'error' | 'warning' | 'notice' | 'passed';
  name: string;
  value: number;
}

interface AuditReportSection {
  uid: string;
  name: string;
  props: Record<string, AuditReportProp>;
}

export interface AuditReportResponse {
  score_percent: number;
  total_pages: number;
  total_errors: number;
  total_warnings: number;
  total_notices: number;
  total_passed: number;
  is_finished: boolean;
  sections: AuditReportSection[];
}

export async function getAuditReport(auditId: number): Promise<AuditReportResponse> {
  return seRankingFetch<AuditReportResponse>('GET', '/site-audit/audits/report', {
    query: { audit_id: String(auditId) },
  });
}

// Flattens the report's sections into the top N issues by severity (error first,
// then warning), sorted by occurrence count — used to build a compact prompt
// summary and the "principais problemas" list shown in the UI.
export function topIssuesFromReport(
  report: AuditReportResponse,
  limit = 10,
): Array<{ code: string; title: string; severity: 'error' | 'warning' | 'notice'; count: number }> {
  const all: Array<{ code: string; title: string; severity: 'error' | 'warning' | 'notice'; count: number }> = [];
  const sections = Array.isArray(report.sections) ? report.sections : [];
  for (const section of sections) {
    for (const prop of Object.values(section.props ?? {})) {
      if (prop && (prop.status === 'error' || prop.status === 'warning' || prop.status === 'notice') && prop.value > 0) {
        all.push({ code: prop.code, title: prop.name, severity: prop.status, count: prop.value });
      }
    }
  }
  const rank = { error: 0, warning: 1, notice: 2 } as const;
  all.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
  return all.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Keyword research
// ---------------------------------------------------------------------------

// SE Ranking keywords can carry multiple intent codes (I/N/T/C/L); the app's
// ClusterKeyword only stores one, so we pick a single primary by priority —
// transactional/commercial signal matters most for content-marketing planning.
const INTENT_PRIORITY: ReadonlyArray<{ code: string; intencao: SearchIntent }> = [
  { code: 'T', intencao: 'transacional' },
  { code: 'C', intencao: 'comercial' },
  { code: 'N', intencao: 'navegacional' },
  { code: 'L', intencao: 'transacional' }, // busca local: sem categoria própria no app, tratada como near-transactional
  { code: 'I', intencao: 'informacional' },
];

function primaryIntent(intents: string[] | undefined): SearchIntent {
  const set = new Set((intents ?? []).map((i) => i.toUpperCase()));
  for (const { code, intencao } of INTENT_PRIORITY) if (set.has(code)) return intencao;
  return 'informacional';
}

export interface KeywordCandidate {
  termo: string;
  volume?: number;
  intencao: SearchIntent;
}

interface RawKeywordItem {
  keyword: string;
  volume?: number;
  intents?: string[];
}

interface KeywordListResponse {
  total: number;
  keywords: RawKeywordItem[];
}

export interface KeywordDiscoveryOptions {
  source?: string;
  limit?: number;
}

export async function getRelatedKeywords(keyword: string, opts: KeywordDiscoveryOptions = {}): Promise<KeywordCandidate[]> {
  const resp = await seRankingFetch<KeywordListResponse>('GET', '/keywords/related', {
    query: {
      source: opts.source ?? DEFAULT_SOURCE,
      keyword,
      limit: String(opts.limit ?? 15),
      sort: 'volume',
      sort_order: 'desc',
    },
  });
  return (resp.keywords ?? []).map((k) => ({ termo: k.keyword, volume: k.volume, intencao: primaryIntent(k.intents) }));
}

export async function getSimilarKeywords(keyword: string, opts: KeywordDiscoveryOptions = {}): Promise<KeywordCandidate[]> {
  const resp = await seRankingFetch<KeywordListResponse>('GET', '/keywords/similar', {
    query: {
      source: opts.source ?? DEFAULT_SOURCE,
      keyword,
      limit: String(opts.limit ?? 8),
      sort: 'volume',
      sort_order: 'desc',
    },
  });
  return (resp.keywords ?? []).map((k) => ({ termo: k.keyword, volume: k.volume, intencao: primaryIntent(k.intents) }));
}

// Long-tail endpoint only returns keyword strings (no volume/intent) — callers
// must backfill volume via getKeywordsMetrics for anything kept from this list.
export async function getLongTailKeywords(keyword: string, opts: KeywordDiscoveryOptions = {}): Promise<string[]> {
  const resp = await seRankingFetch<{ total: number; keywords: string[] }>('GET', '/keywords/longtail', {
    query: {
      source: opts.source ?? DEFAULT_SOURCE,
      keyword,
      limit: String(opts.limit ?? 15),
    },
  });
  return resp.keywords ?? [];
}

// Bulk metrics for up to 5000 known terms — returns only volume (that's the
// only field this app currently uses), keyed by the exact term string.
export async function getKeywordsMetrics(keywords: string[], source = DEFAULT_SOURCE): Promise<Record<string, number>> {
  if (!keywords.length) return {};
  const resp = await seRankingFetch<RawKeywordItem[]>('POST', '/keywords/export', {
    query: { source },
    body: { keywords },
  });
  const out: Record<string, number> = {};
  for (const item of resp ?? []) {
    if (typeof item.volume === 'number') out[item.keyword] = item.volume;
  }
  return out;
}

// Deduplicates candidates by normalized term across one or more lists, keeping
// the entry with the highest known volume, sorted by volume desc and capped.
export function mergeKeywordCandidates(lists: KeywordCandidate[][], cap = 150): KeywordCandidate[] {
  const byTerm = new Map<string, KeywordCandidate>();
  for (const list of lists) {
    for (const k of list) {
      const key = k.termo.trim().toLowerCase();
      if (!key) continue;
      const existing = byTerm.get(key);
      if (!existing || (k.volume ?? 0) > (existing.volume ?? 0)) byTerm.set(key, k);
    }
  }
  return Array.from(byTerm.values())
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, cap);
}

// ---------------------------------------------------------------------------
// Domain analysis — what the domain itself already ranks for (grounds the
// cluster pool in real organic performance, not just AI-guessed expansions).
// ---------------------------------------------------------------------------

interface RawDomainOverview {
  keywords_count?: number;
  traffic_sum?: number;
  price_sum?: number;
  top1_5?: number;
  top6_10?: number;
  top11_20?: number;
  top21_50?: number;
  top51_100?: number;
}

export async function getDomainOverview(domain: string, source = DEFAULT_SOURCE): Promise<DomainOverviewStats> {
  const resp = await seRankingFetch<RawDomainOverview>('GET', '/domain/overview/db', {
    query: { source, domain, with_subdomains: '1' },
  });
  return {
    keywordsCount: resp.keywords_count,
    trafficEstimate: resp.traffic_sum,
    priceEstimate: resp.price_sum,
    positions: {
      top1_5: resp.top1_5,
      top6_10: resp.top6_10,
      top11_20: resp.top11_20,
      top21_50: resp.top21_50,
      top51_100: resp.top51_100,
    },
  };
}

interface RawDomainHistoryPoint {
  year?: number;
  month?: number;
  keywords_count?: number;
  traffic_sum?: number;
}

export async function getDomainHistory(domain: string, source = DEFAULT_SOURCE): Promise<DomainHistoryPoint[]> {
  const resp = await seRankingFetch<{ history?: RawDomainHistoryPoint[] } | RawDomainHistoryPoint[]>(
    'GET',
    '/domain/overview/history',
    { query: { source, domain, type: 'organic', with_subdomains: '1' } },
  );
  const items = Array.isArray(resp) ? resp : (resp.history ?? []);
  return items.map((h) => ({ year: h.year, month: h.month, keywordsCount: h.keywords_count, trafficEstimate: h.traffic_sum }));
}

// Compares the oldest vs. newest available monthly snapshot to summarize
// whether the domain's organic footprint is growing or shrinking.
export function summarizeDomainTrend(history: DomainHistoryPoint[]): string | null {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const fk = first.keywordsCount ?? 0;
  const lk = last.keywordsCount ?? 0;
  if (fk === 0) return `${lk} palavras-chave rankeadas atualmente (histórico insuficiente para comparação de tendência).`;
  const pct = Math.round(((lk - fk) / fk) * 100);
  const trend = pct > 0 ? `cresceu ${pct}%` : pct < 0 ? `caiu ${Math.abs(pct)}%` : 'ficou estável';
  return `Volume de palavras-chave rankeadas ${trend} nos últimos ${history.length} meses (${fk} → ${lk}).`;
}

interface RawDomainKeywordItem {
  keyword: string;
  position?: number;
  volume?: number;
  traffic?: number;
  cpc?: number;
  difficulty?: number;
  intents?: string[];
}

function normalizeDomainKeywordList(resp: { keywords?: RawDomainKeywordItem[] } | RawDomainKeywordItem[]): RawDomainKeywordItem[] {
  return Array.isArray(resp) ? resp : (resp.keywords ?? []);
}

// Use toKeywordCandidates() to get the slimmer shape (termo/volume/intencao)
// the cluster generator needs from the full DomainKeywordDetail records.
function toDetail(k: RawDomainKeywordItem): DomainKeywordDetail {
  return {
    termo: k.keyword,
    posicao: k.position,
    volume: k.volume,
    trafego: k.traffic,
    cpc: k.cpc,
    dificuldade: k.difficulty,
    intencao: primaryIntent(k.intents),
  };
}

export function toKeywordCandidates(details: DomainKeywordDetail[]): KeywordCandidate[] {
  return details.map((d) => ({ termo: d.termo, volume: d.volume, intencao: d.intencao }));
}

// Real keywords this domain currently ranks for in organic search — the
// primary source for the cluster keyword pool (grounded in actual visibility,
// not a guess). Sorted by volume, capped.
export async function getDomainKeywords(domain: string, source = DEFAULT_SOURCE, limit = 100): Promise<DomainKeywordDetail[]> {
  const resp = await seRankingFetch<{ keywords?: RawDomainKeywordItem[] } | RawDomainKeywordItem[]>('GET', '/domain/keywords', {
    query: { source, domain, type: 'organic' },
  });
  return normalizeDomainKeywordList(resp)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit)
    .map(toDetail);
}

// Keywords a competitor domain ranks for that this domain does not (diff=1) —
// the clearest signal of untapped content opportunity.
export async function getDomainKeywordGaps(
  domain: string,
  competitorDomain: string,
  source = DEFAULT_SOURCE,
  limit = 50,
): Promise<DomainKeywordDetail[]> {
  const resp = await seRankingFetch<{ keywords?: RawDomainKeywordItem[] } | RawDomainKeywordItem[]>(
    'GET',
    '/domain/keywords/comparison',
    { query: { source, domain, compare: competitorDomain, diff: '1', type: 'organic' } },
  );
  return normalizeDomainKeywordList(resp)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit)
    .map(toDetail);
}
