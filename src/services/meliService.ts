import { auth } from '../firebase';

export type MeliConnectionStatus = 'active' | 'reauthorization_required' | 'revoked' | 'disconnected';
export type MeliListingStatus = 'active' | 'paused' | 'closed';

export interface MeliConnection {
  id: 'primary';
  connected: boolean;
  configured: boolean;
  sellerId: string | null;
  siteId: string | null;
  scopes: string[];
  status: MeliConnectionStatus;
  mode: 'audit_only';
  lastSyncedAt: string | null;
}

export interface MeliListing {
  itemId: string;
  title: string;
  status: string;
  thumbnail: string | null;
  permalink: string | null;
  categoryId: string;
  condition: string | null;
  soldQuantity: number;
  availableQuantity: number;
  descriptionPlainText: string;
  attributes: Array<{ id?: string; name?: string; value_name?: string; value_id?: string }>;
  saleTerms: Array<{ id?: string; name?: string; value_name?: string; value_id?: string }>;
  pictures: Array<{ id?: string; url?: string; secure_url?: string }>;
  variations: unknown[];
  performance: { score?: number; level_wording?: string; buckets?: unknown[] } | null;
  catalogQuality: any | null;
  userProductId: string | null;
  catalogProductId: string | null;
  lastSyncedAt: string;
  analysisSummary?: {
    analysisId: string;
    status: string;
    alfredsScore: number;
    riskLevel: MeliRiskLevel;
    findingCount: number;
    completedAt: string;
    contentHash: string;
  };
  proposalSummary?: {
    proposalId: string;
    version: number;
    status: MeliProposalStatus;
    changeCount: number;
    updatedAt: string;
  };
}

export type MeliRiskLevel = 'low' | 'medium' | 'high' | 'blocked';
export type MeliFindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'blocked';

export interface MeliAnalysisFinding {
  code: string;
  fieldPath: string;
  severity: MeliFindingSeverity;
  message: string;
  evidence: string[];
  source: string;
  confidence: number;
  requiresConfirmation: boolean;
}

export interface MeliAnalysis {
  id: string;
  listingId: string;
  contentHash: string;
  officialScore: number | null;
  alfredsScore: number | null;
  scoreComponents: {
    title: number;
    description: number;
    technicalCompleteness: number;
    consistency: number;
    images: number;
  } | null;
  riskLevel: MeliRiskLevel;
  summary: string;
  findings: MeliAnalysisFinding[];
  questions: Array<{ fieldPath: string; question: string; reason: string }>;
  suggestions: {
    title: string | null;
    descriptionPlainText: string | null;
    attributes: Array<{ id: string; valueName: string; valueId: string | null; reason: string; evidence: string[] }>;
    saleTerms: Array<{ id: string; valueName: string; valueId: string | null; reason: string; evidence: string[] }>;
    picturePlan: Array<{ pictureId: string | null; action: string; reason: string }>;
  };
  imageDiagnostics: Array<{
    pictureId: string;
    order: number;
    url: string | null;
    width: number | null;
    height: number | null;
    action: string;
    issues: string[];
    strengths: string[];
    confidence: number;
  }>;
  aiStatus: 'pending' | 'completed' | 'failed' | 'not_configured';
  aiError: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stale';
  createdAt: string;
  completedAt: string | null;
}

export type MeliProposalStatus = 'draft' | 'awaiting_review' | 'partially_approved' | 'approved' | 'rejected' | 'stale';
export type MeliChangeRisk = 'low' | 'medium' | 'high' | 'blocked';
export type MeliApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface MeliProposal {
  id: string;
  listingId: string;
  analysisId: string;
  baseSnapshotId: string | null;
  baseContentHash: string;
  version: number;
  status: MeliProposalStatus;
  summary: string;
  impactScope: {
    userProductId: string | null;
    familyId: string | null;
    catalogProductId: string | null;
    variationCount: number;
    relatedItemIds: string[];
    catalogControlledFields: string[];
    warnings: string[];
  };
  changeCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeliProposalChange {
  id: string;
  proposalId: string;
  fieldPath: string;
  resource: 'item' | 'description';
  changeType: 'add' | 'replace' | 'remove' | 'reorder';
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  evidence: string[];
  confidence: number;
  riskLevel: MeliChangeRisk;
  requiresConfirmation: boolean;
  approvalStatus: MeliApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface MeliProposalResult { proposal: MeliProposal; changes: MeliProposalChange[] }

export interface MeliOperationalMetrics {
  listings: { total: number; byStatus: Record<string, number> };
  jobs: { total: number; byStatus: Record<string, number> };
  analyses: { total: number; byStatus: Record<string, number> };
  proposals: { total: number; byStatus: Record<string, number> };
  webhooks: { total: number; byStatus: Record<string, number>; byTopic: Record<string, number> };
  apiToday: { calls: number; retries: number; rateLimited: number; averageLatencyMs: number };
  limiter: { active: number; limit: number; queued: number; cooldownUntil: number };
  generatedAt: string;
}

export interface MeliSyncJob {
  id: string;
  status: 'queued' | 'running' | 'retry_scheduled' | 'waiting_for_consistency' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  progress: number;
  lastStep: string;
  error: string | null;
}

async function headers(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` };
}

async function handle<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as any)?.message || `Erro ${response.status}`);
  return payload as T;
}

export async function meliConnection(): Promise<MeliConnection> {
  const response = await fetch('/api/integrations/meli/connections', { headers: await headers() });
  const payload = await handle<{ connections: MeliConnection[] }>(response);
  return payload.connections[0];
}

export interface MeliOAuthResult {
  ok: boolean;
  message?: string;
}

export async function connectMeli(): Promise<MeliOAuthResult> {
  const response = await fetch('/api/integrations/meli/oauth/start', { method: 'POST', headers: await headers() });
  const { url } = await handle<{ url: string }>(response);
  const popup = window.open(url, 'meli-oauth', 'width=600,height=760');
  if (!popup) throw new Error('O navegador bloqueou o popup. Permita popups para conectar o Mercado Livre.');

  return new Promise((resolve) => {
    let settled = false;
    let checkingClosedPopup = false;
    const finish = (result: MeliOAuthResult) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      window.removeEventListener('message', onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== 'meli-oauth') return;
      finish({
        ok: Boolean(event.data.ok),
        message: typeof event.data.message === 'string' ? event.data.message : undefined,
      });
    };
    window.addEventListener('message', onMessage);
    const poll = window.setInterval(async () => {
      if (!popup.closed || checkingClosedPopup || settled) return;
      checkingClosedPopup = true;
      try {
        // Some OAuth providers isolate the popup with Cross-Origin-Opener-Policy,
        // which can suppress window.opener/postMessage even though the callback
        // completed. The backend connection is the source of truth.
        const connection = await meliConnection();
        if (connection.connected) {
          finish({ ok: true, message: 'Conta conectada com sucesso.' });
          return;
        }
        finish({ ok: false, message: 'A janela de autorização foi fechada antes da conclusão.' });
      } catch {
        finish({ ok: false, message: 'Não foi possível confirmar a conexão após o fechamento da janela.' });
      }
    }, 800);
  });
}

export async function disconnectMeli(): Promise<void> {
  const response = await fetch('/api/integrations/meli/connections/primary', { method: 'DELETE', headers: await headers() });
  await handle(response);
}

export async function startMeliSync(statuses: MeliListingStatus[]): Promise<MeliSyncJob> {
  const response = await fetch('/api/meli/sync', {
    method: 'POST', headers: await headers(), body: JSON.stringify({ statuses }),
  });
  return (await handle<{ job: MeliSyncJob }>(response)).job;
}

export async function getMeliJob(jobId: string): Promise<MeliSyncJob> {
  const response = await fetch(`/api/meli/jobs/${encodeURIComponent(jobId)}`, { headers: await headers() });
  return (await handle<{ job: MeliSyncJob }>(response)).job;
}

export async function listMeliListings(filters: { status?: string; search?: string } = {}): Promise<{ listings: MeliListing[]; total: number }> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  params.set('limit', '200');
  const response = await fetch(`/api/meli/listings?${params.toString()}`, { headers: await headers() });
  return handle(response);
}

export async function startMeliAnalysis(itemId: string): Promise<MeliAnalysis> {
  const response = await fetch(`/api/meli/listings/${encodeURIComponent(itemId)}/analyses`, {
    method: 'POST', headers: await headers(),
  });
  return (await handle<{ analysis: MeliAnalysis }>(response)).analysis;
}

export async function getLatestMeliAnalysis(itemId: string): Promise<MeliAnalysis | null> {
  const response = await fetch(`/api/meli/listings/${encodeURIComponent(itemId)}/analyses/latest`, { headers: await headers() });
  if (response.status === 404) return null;
  return (await handle<{ analysis: MeliAnalysis }>(response)).analysis;
}

export async function createMeliProposal(itemId: string, analysisId?: string): Promise<MeliProposalResult> {
  const response = await fetch(`/api/meli/listings/${encodeURIComponent(itemId)}/proposals`, {
    method: 'POST', headers: await headers(), body: JSON.stringify({ analysisId }),
  });
  return handle(response);
}

export async function getLatestMeliProposal(itemId: string): Promise<MeliProposalResult | null> {
  const response = await fetch(`/api/meli/listings/${encodeURIComponent(itemId)}/proposals/latest`, { headers: await headers() });
  if (response.status === 404) return null;
  return handle(response);
}

export async function decideMeliProposalChange(
  proposalId: string,
  changeId: string,
  approvalStatus: Exclude<MeliApprovalStatus, 'pending'>,
  confirmed = false,
): Promise<MeliProposalResult> {
  const response = await fetch(`/api/meli/proposals/${encodeURIComponent(proposalId)}/changes/${encodeURIComponent(changeId)}`, {
    method: 'PATCH', headers: await headers(), body: JSON.stringify({ approvalStatus, confirmed }),
  });
  return handle(response);
}

export async function getMeliOperationalMetrics(): Promise<MeliOperationalMetrics> {
  const response = await fetch('/api/meli/operations/metrics', { headers: await headers() });
  return (await handle<{ metrics: MeliOperationalMetrics }>(response)).metrics;
}
