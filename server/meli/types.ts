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
  mode: 'audit_only';
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
  rawItem: unknown;
  contentHash: string;
  sourceLastUpdatedAt: string | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
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
}
