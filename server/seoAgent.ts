// SEO audits (SE Ranking) for the "Agência de Criação de Conteúdo" (Alfred)
// module. Mirrors the structure of server/contentAgent.ts (credit debit,
// Firestore helpers, route registration) but scoped to site audits.
//
// Crawl (technical site audit) and Domain Analysis run as two independent
// stages — see SeoAudit in src/modules/content/types.ts. Domain Analysis is a
// handful of fast SE Ranking calls resolved synchronously inside triggerAudit;
// the crawl is slow/async and tracked separately via refreshAudit polling,
// with an explicit cancelAudit escape hatch so a stuck/slow crawl never blocks
// the rest of the flow.

import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost, type CreditAction } from '../src/credits';
import type { ContentProject, SeoAudit, SeoAuditIssue } from '../src/modules/content/types';
import * as seRanking from './seRankingClient';
import { loadStoreContext, extractSeedKeywords, discoverKeywordPool } from './keywordDiscovery';

// ---------------------------------------------------------------------------
// Credit debit (Admin SDK) — same shape as contentAgent.ts's debitCreditsAdmin.
// ---------------------------------------------------------------------------

async function getCreditCosts(): Promise<Record<string, number>> {
  try {
    const snap = await adminDb.collection('config').doc('credits').get();
    const data = snap.exists ? snap.data() : null;
    return (data?.costs as Record<string, number>) ?? {};
  } catch {
    return {};
  }
}

async function debitCreditsAdmin(uid: string, action: CreditAction, productName: string): Promise<void> {
  const costs = await getCreditCosts();
  const cost = resolveCreditCost(costs, action.key);
  const userRef = adminDb.collection('users').doc(uid);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('Usuário não encontrado.');
    const current = snap.data()?.credits ?? 0;
    if (current < cost) throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { status: 402 });

    tx.update(userRef, { credits: current - cost });
    const logRef = userRef.collection('credit_logs').doc();
    tx.set(logRef, {
      actionType: action.label,
      actionKey: action.key,
      productName,
      sku: 'N/A',
      userName: '',
      creditsConsumed: cost,
      timestamp: new Date().toISOString(),
    });
  });
}

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

function projectRef(uid: string, projectId: string) {
  return adminDb.collection('users').doc(uid).collection('contentProjects').doc(projectId);
}

async function loadProject(uid: string, projectId: string): Promise<ContentProject> {
  const snap = await projectRef(uid, projectId).get();
  if (!snap.exists) throw Object.assign(new Error('Projeto não encontrado'), { status: 404 });
  return { id: snap.id, ...(snap.data() as Omit<ContentProject, 'id'>) };
}

function auditsCol(uid: string, projectId: string) {
  return projectRef(uid, projectId).collection('seoAudits');
}

// Firestore (Admin SDK) rejects `undefined` field values outright, at ANY
// depth — several SE Ranking responses (e.g. a domain with no overview data
// yet, or a keyword missing cpc/difficulty) legitimately produce them nested
// inside domainOverview/domainHistory/domainKeywords/keywordPool, so every
// object written here is deep-sanitized first. Exported: contentAgent.ts
// persists ClusterKeyword objects with the same SE Ranking-shaped optional
// fields (cpc/dificuldade/competicao/posicao/trafego/origem) and needs the
// same sanitization before writing clusters.
export function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => omitUndefined(v)) as unknown as T;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = omitUndefined(v);
    }
    return out as T;
  }
  return value;
}

async function loadAudit(uid: string, projectId: string, auditDocId: string): Promise<SeoAudit> {
  const snap = await auditsCol(uid, projectId).doc(auditDocId).get();
  if (!snap.exists) throw Object.assign(new Error('Auditoria não encontrada'), { status: 404 });
  return { id: snap.id, ...(snap.data() as Omit<SeoAudit, 'id'>) };
}

// Picks the first "Referências/concorrentes" entry (onboarding step Estratégia)
// that looks like a real domain/URL, for the SE Ranking gap comparison. Free-text
// entries that aren't domains (brand names, etc.) are ignored.
const DOMAIN_LIKE = /^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;

function extractCompetitorDomain(referencias: string[] | undefined): string | undefined {
  for (const raw of referencias ?? []) {
    const term = raw.trim();
    if (DOMAIN_LIKE.test(term)) {
      return term.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Domain Analysis — synchronous, independent of the crawl.
// ---------------------------------------------------------------------------

type DomainAnalysisFields = Pick<
  SeoAudit,
  | 'domainStatus'
  | 'domainErrorMessage'
  | 'domainOverview'
  | 'domainHistory'
  | 'domainTrend'
  | 'competitorDomain'
  | 'domainKeywords'
  | 'domainGapKeywords'
  | 'keywordPool'
>;

// Best-effort per call (a missing competitor or a brand-new domain with no
// organic footprint yet shouldn't fail the whole thing) — only marked "failed"
// if something genuinely unexpected blows up the whole batch. Besides the raw
// SE Ranking data (shown to the user in full), also enriches keywordPool with
// "possible keywords" expanded from the product catalog (loadStoreContext +
// discoverKeywordPool) — a brand-new domain may only rank for a handful of
// terms, which alone isn't enough to build 4-6 real clusters.
async function runDomainAnalysis(
  uid: string,
  project: ContentProject,
  domain: string,
  competitorDomain: string | undefined,
): Promise<DomainAnalysisFields> {
  try {
    const [overview, history, domainKeywords, gapKeywords, store] = await Promise.all([
      seRanking.getDomainOverview(domain).catch((e) => { console.error('SE Ranking domain overview falhou:', e); return null; }),
      seRanking.getDomainHistory(domain).catch((e) => { console.error('SE Ranking domain history falhou:', e); return []; }),
      seRanking.getDomainKeywords(domain).catch((e) => { console.error('SE Ranking domain keywords falhou:', e); return []; }),
      competitorDomain
        ? seRanking.getDomainKeywordGaps(domain, competitorDomain).catch((e) => { console.error('SE Ranking domain gap falhou:', e); return []; })
        : Promise.resolve([]),
      loadStoreContext(uid).catch((e) => { console.error('loadStoreContext falhou:', e); return { text: '', seedKeywords: [] }; }),
    ]);

    const seeds = extractSeedKeywords(project, store);
    const possibleKeywords = seeds.length
      ? await discoverKeywordPool(seeds).catch((e) => { console.error('SE Ranking: expansão de possíveis palavras-chave falhou:', e); return []; })
      : [];

    return {
      domainStatus: 'finished',
      domainOverview: overview ?? undefined,
      domainHistory: history,
      domainTrend: seRanking.summarizeDomainTrend(history) ?? undefined,
      competitorDomain,
      domainKeywords,
      domainGapKeywords: gapKeywords,
      keywordPool: seRanking.mergeKeywordCandidates([domainKeywords, gapKeywords, possibleKeywords], 200),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('SE Ranking: Domain Analysis falhou por completo:', e);
    return { domainStatus: 'failed', domainErrorMessage: msg.slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Crawl (site-audit) — async, polled, cancelable.
//
// Desativado por ora ("não vai fazer sentido eu utilizar agora") — flip para
// true para religar. Enquanto false, triggerAudit nunca chama createStandardAudit
// nem grava seRankingAuditId/crawlStatus; refresh/cancelAudit continuam
// definidas mas viram no-ops (current.crawlStatus fica undefined).
// ---------------------------------------------------------------------------

const CRAWL_ENABLED = false;

function mapCrawlStatus(raw: seRanking.SeRankingAuditRawStatus): 'processing' | 'finished' | 'failed' {
  if (raw === 'finished') return 'finished';
  if (raw === 'failed' || raw === 'error') return 'failed';
  return 'processing';
}

// ---------------------------------------------------------------------------
// Trigger — fires the crawl (fire-and-poll) and Domain Analysis (awaited,
// resolves within this call) independently of each other.
// ---------------------------------------------------------------------------

async function triggerAudit(uid: string, project: ContentProject): Promise<SeoAudit> {
  const domain = (project.config.siteUrl || '').trim();
  if (!domain) {
    throw Object.assign(new Error('Configure a URL do site do cliente antes de rodar a auditoria.'), { status: 400 });
  }
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const competitorDomain = extractCompetitorDomain(project.config.referencias);

  const [crawl, domainAnalysis] = await Promise.all([
    CRAWL_ENABLED ? seRanking.createStandardAudit(cleanDomain) : Promise.resolve(null),
    runDomainAnalysis(uid, project, cleanDomain, competitorDomain),
  ]);

  const now = new Date().toISOString();
  const ref = auditsCol(uid, project.id).doc();
  const audit: SeoAudit = {
    id: ref.id,
    domain: cleanDomain,
    ...(crawl ? { seRankingAuditId: crawl.id, crawlStatus: 'processing' as const } : {}),
    ...domainAnalysis,
    createdAt: now,
    updatedAt: now,
  };
  const { id, ...data } = audit;
  await ref.set(omitUndefined(data));
  return audit;
}

// Polls the crawl only — Domain Analysis is already resolved by triggerAudit,
// so this never touches domain* fields.
async function refreshAudit(uid: string, projectId: string, auditDocId: string): Promise<SeoAudit> {
  const current = await loadAudit(uid, projectId, auditDocId);
  if (current.crawlStatus !== 'processing') return current;

  const statusResp = await seRanking.getAuditStatus(current.seRankingAuditId);
  const mapped = mapCrawlStatus(statusResp.status);
  if (mapped === 'processing') return current;

  const ref = auditsCol(uid, projectId).doc(auditDocId);
  const now = new Date().toISOString();

  if (mapped === 'failed') {
    const updated: Partial<SeoAudit> = { crawlStatus: 'failed', crawlErrorMessage: 'A auditoria técnica falhou no SE Ranking.', updatedAt: now };
    await ref.update(updated);
    return { ...current, ...updated };
  }

  try {
    const report = await seRanking.getAuditReport(current.seRankingAuditId);
    const topIssues: SeoAuditIssue[] = seRanking.topIssuesFromReport(report, 30);
    const updated: Partial<SeoAudit> = {
      crawlStatus: 'finished',
      healthScore: report.score_percent,
      pagesCrawled: report.total_pages,
      totalErrors: report.total_errors,
      totalWarnings: report.total_warnings,
      totalNotices: report.total_notices,
      totalPassed: report.total_passed,
      topIssues,
      updatedAt: now,
    };
    await ref.update(omitUndefined(updated));
    return { ...current, ...updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('seoAgent: falha ao buscar o relatório da auditoria:', e);
    const updated: Partial<SeoAudit> = { crawlStatus: 'failed', crawlErrorMessage: msg.slice(0, 300), updatedAt: now };
    await ref.update(updated);
    return { ...current, ...updated };
  }
}

// Local escape hatch: stops polling and marks the crawl as canceled in our own
// record, regardless of what SE Ranking keeps doing server-side (we simply
// stop waiting on/caring about that result). Domain Analysis is unaffected —
// it either already finished or failed independently.
async function cancelAudit(uid: string, projectId: string, auditDocId: string): Promise<SeoAudit> {
  const current = await loadAudit(uid, projectId, auditDocId);
  if (current.crawlStatus !== 'processing') return current;

  const ref = auditsCol(uid, projectId).doc(auditDocId);
  const updated: Partial<SeoAudit> = { crawlStatus: 'canceled', updatedAt: new Date().toISOString() };
  await ref.update(updated);
  return { ...current, ...updated };
}

// Used by contentAgent.ts to ground the cluster-generation prompt and seed the
// cluster keyword pool. Only requires Domain Analysis to be done — the crawl
// (slower, sometimes canceled) is purely supplementary context.
export async function getLatestFinishedAudit(uid: string, projectId: string): Promise<SeoAudit | null> {
  const snap = await auditsCol(uid, projectId)
    .where('domainStatus', '==', 'finished')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<SeoAudit, 'id'>) };
}

export function auditSummaryText(audit: SeoAudit): string {
  const parts: string[] = [];
  if (audit.crawlStatus === 'finished') {
    const issues = (audit.topIssues ?? [])
      .slice(0, 6)
      .map((i) => `${i.title} (${i.severity}, ${i.count} páginas)`)
      .join('; ');
    parts.push(`Domínio: ${audit.domain}. Health score: ${audit.healthScore ?? '?'}/100. Páginas rastreadas: ${audit.pagesCrawled ?? '?'}.`);
    if (issues) parts.push(`Principais problemas técnicos: ${issues}.`);
  } else {
    parts.push(`Domínio: ${audit.domain}.`);
  }
  if (audit.domainOverview?.keywordsCount != null) {
    parts.push(`O domínio já rankeia para ~${audit.domainOverview.keywordsCount} palavras-chave (tráfego orgânico estimado: ${audit.domainOverview.trafficEstimate ?? '?'}).`);
  }
  if (audit.domainTrend) parts.push(audit.domainTrend);
  if (audit.competitorDomain) parts.push(`Comparado com o concorrente ${audit.competitorDomain} para identificar lacunas de conteúdo.`);
  if (audit.keywordPool?.length) parts.push(`${audit.keywordPool.length} palavras-chave reais disponíveis (domínio + lacunas + expansão do catálogo).`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface SeoDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string; email?: string; name?: string }>;
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  const status = e.status ?? 500;
  if (e.message === 'INSUFFICIENT_CREDITS') {
    return res.status(402).json({ error: 'Créditos insuficientes' });
  }
  console.error('seo endpoint error:', err);
  return res.status(status).json({ error: e.message ?? 'Erro interno' });
}

export function registerSeoRoutes(app: express.Application, deps: SeoDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/content/projects/:id/seo-audit', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const project = await loadProject(decoded.uid, req.params.id);
      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.seoAudit, project.config.nomeEmpresa);
      const audit = await triggerAudit(decoded.uid, project);
      res.json({ audit });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:id/seo-audit/:auditId/refresh', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const audit = await refreshAudit(decoded.uid, req.params.id, req.params.auditId);
      res.json({ audit });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/content/projects/:id/seo-audit/:auditId/cancel', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const audit = await cancelAudit(decoded.uid, req.params.id, req.params.auditId);
      res.json({ audit });
    } catch (err) {
      sendError(res, err);
    }
  });
}
