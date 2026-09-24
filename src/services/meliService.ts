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
  pictures: Array<{ id?: string; url?: string; secure_url?: string }>;
  variations: unknown[];
  performance: { score?: number; level_wording?: string; buckets?: unknown[] } | null;
  catalogQuality: any | null;
  userProductId: string | null;
  catalogProductId: string | null;
  lastSyncedAt: string;
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
    const poll = window.setInterval(() => {
      if (popup.closed) finish({ ok: false, message: 'A janela de autorização foi fechada antes da conclusão.' });
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
