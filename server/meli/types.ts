export type MeliConnectionStatus = 'active' | 'reauthorization_required' | 'revoked';
export type MeliListingStatus = 'active' | 'paused' | 'closed';
export type MeliJobStatus =
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'waiting_for_consistency'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface EncryptedValue {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface MeliConnectionSecret {
  accessToken: EncryptedValue;
  refreshToken: EncryptedValue;
  tokenExpiresAt: number;
  scopes: string[];
  sellerId: string;
  siteId: string;
  status: MeliConnectionStatus;
  refreshLeaseId?: string | null;
  refreshLeaseUntil?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeliConnectionView {
  id: 'primary';
  connected: boolean;
  configured: boolean;
  sellerId: string | null;
  siteId: string | null;
  scopes: string[];
  status: MeliConnectionStatus | 'disconnected';
  mode: 'audit_only' | 'assisted_write';
  lastSyncedAt: string | null;
}

export interface MeliListingRecord {
  itemId: string;
  sellerId: string;
  siteId: string;
  userProductId: string | null;
  familyId: string | null;
  catalogProductId: string | null;
  categoryId: string;
  domainId: string | null;
  status: string;
  title: string;
  condition: string | null;
  soldQuantity: number;
  availableQuantity: number;
  permalink: string | null;
  thumbnail: string | null;
  descriptionPlainText: string;
  attributes: unknown[];
  saleTerms: unknown[];
  variations: unknown[];
  pictures: unknown[];
  shipping: unknown;
  performance: unknown | null;
  catalogQuality: unknown | null;
  userProduct?: unknown | null;
  userProductFamily?: unknown | null;
  relatedItemIds?: string[];
  rawItem: unknown;
  contentHash: string;
  sourceLastUpdatedAt: string | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
  analysisSummary?: {
    analysisId: string;
    status: string;
    alfredsScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'blocked';
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
  proposalVersion?: number;
}

export interface MeliSyncJob {
  id: string;
  kind: 'account_sync' | 'listing_sync';
  status: MeliJobStatus;
  requestedStatuses: MeliListingStatus[];
  itemId?: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  progress: number;
  lastStep: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  processingLeaseId?: string | null;
  processingLeaseUntil?: number | null;
}

export type MeliFindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'blocked';
export type MeliFindingSource = 'listing' | 'category_schema' | 'meli_performance' | 'image' | 'operator' | 'ai';

export interface MeliAnalysisFinding {
  code: string;
  fieldPath: string;
  severity: MeliFindingSeverity;
  message: string;
  evidence: string[];
  source: MeliFindingSource;
  confidence: number;
  requiresConfirmation: boolean;
}

export interface MeliAnalysisQuestion {
  fieldPath: string;
  question: string;
  reason: string;
}

export interface MeliScoreComponents {
  title: number;
  description: number;
  technicalCompleteness: number;
  consistency: number;
  images: number;
}

export interface MeliImageDiagnostic {
  pictureId: string;
  order: number;
  url: string | null;
  width: number | null;
  height: number | null;
  perceptualHash: string | null;
  action: 'keep' | 'reorder' | 'remove' | 'replace' | 'create' | 'needs_review';
  issues: string[];
  strengths: string[];
  confidence: number;
}

export interface MeliAnalysisRecord {
  id: string;
  listingId: string;
  snapshotId: string | null;
  contentHash: string;
  rulesetVersion: string;
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  officialScore: number | null;
  alfredsScore: number | null;
  scoreComponents: MeliScoreComponents | null;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  summary: string;
  findings: MeliAnalysisFinding[];
  questions: MeliAnalysisQuestion[];
  suggestions: {
    title: string | null;
    descriptionPlainText: string | null;
    discardedDescription?: { value: string; reason: string } | null;
    attributes: Array<{ id: string; valueName: string; valueId: string | null; reason: string; evidence: string[] }>;
    saleTerms: Array<{ id: string; valueName: string; valueId: string | null; reason: string; evidence: string[] }>;
    picturePlan: Array<{ pictureId: string | null; action: MeliImageDiagnostic['action']; targetOrder?: number | null; reason: string }>;
  };
  imageDiagnostics: MeliImageDiagnostic[];
  aiStatus: 'pending' | 'completed' | 'failed' | 'not_configured';
  aiError: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stale';
  createdAt: string;
  completedAt: string | null;
  processingLeaseId?: string | null;
  processingLeaseUntil?: number | null;
}

export type MeliProposalStatus =
  | 'draft'
  | 'awaiting_review'
  | 'partially_approved'
  | 'approved'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'stale';
export type MeliChangeRisk = 'low' | 'medium' | 'high' | 'blocked';
export type MeliApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface MeliProposalImpactScope {
  userProductId: string | null;
  familyId: string | null;
  catalogProductId: string | null;
  variationCount: number;
  relatedItemIds: string[];
  catalogControlledFields: string[];
  warnings: string[];
}

export interface MeliListingChange {
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
  editedBy?: string | null;
  editedAt?: string | null;
  createdAt: string;
}

export interface MeliListingProposal {
  id: string;
  listingId: string;
  analysisId: string;
  baseSnapshotId: string | null;
  baseContentHash: string;
  version: number;
  status: MeliProposalStatus;
  summary: string;
  impactScope: MeliProposalImpactScope;
  createdByType: 'user' | 'ai' | 'rule';
  changeCount: number;
  approvedCount: number;
  rejectedCount: number;
  rollbackOfProposalId?: string | null;
  lastMutationRunId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MeliMutationStatus = 'queued' | 'running' | 'verifying' | 'succeeded' | 'partial' | 'failed' | 'rolled_back';

export interface MeliMutationRun {
  id: string;
  proposalId: string;
  listingId: string;
  idempotencyKey: string;
  status: MeliMutationStatus;
  sanitizedRequest: Record<string, unknown>;
  sanitizedResponse: Record<string, unknown> | null;
  warnings: string[];
  differences: string[];
  approvedChangeIds: string[];
  appliedChangeIds: string[];
  verifiedChangeIds: string[];
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  processingLeaseId?: string | null;
  processingLeaseUntil?: number | null;
  createdAt: string;
  updatedAt: string;
}
