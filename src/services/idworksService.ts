import { auth } from '../firebase';

// Client wrappers for the server-side IdWorks ERP proxy (/api/idworks/*). Tokens never
// live in the browser — credentials are persisted server-side via the Admin SDK and never
// returned to the client. These types mirror server/idworksAgent.ts and server/idworksImportWorker.ts.

export interface IdworksStatus {
  connected: boolean;
  validated: boolean;
  accountName: string | null;
  lastValidatedAt: string | null;
  syncMode?: 'polling' | 'webhook';
  webhookUrl?: string | null;
  webhookStats?: { lastReceivedAt: string | null; totalReceived: number };
}

export interface IdworksNormalizedProduct {
  idworksId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  descricaoCurta?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  slug?: string;
  linkVideo?: string;
  ncm?: string;
  ncmExTipi?: string;
  cest?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  marca?: string;
  categorias: string[];
  imagens: string[];
  codigoPai?: string;
  raw: unknown;
}

export interface IdworksPushProduct {
  idworksId: string;
  sku?: string;
  descricaoHtml?: string;
  descricaoCurta?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  slug?: string;
  linkVideo?: string;
  ncm?: string;
  ncmExTipi?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
}

export interface IdworksPushResult {
  idworksId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
}

export interface IdworksImportJob {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';
  mode: 'full' | 'update';
  offset: number;
  total: number;
  imported: number;
  lastSyncAt: string | null;
  error?: string | null;
  autoSync: { enabled: boolean; everyHours: number };
}

export interface IdworksWebhookConfig {
  webhookUrl: string;
  headerName: string;
  headerValue: string;
  syncMode: 'polling' | 'webhook';
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function handle<T>(resp: Response): Promise<T> {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any)?.message ?? `Erro ${resp.status}`);
  return data as T;
}

export async function idworksStatus(): Promise<IdworksStatus> {
  const resp = await fetch('/api/idworks/status', { headers: await authHeaders() });
  return handle(resp);
}

export async function idworksConnect(accountName: string, credentials: Record<string, string>): Promise<{ valid: boolean; message: string }> {
  const resp = await fetch('/api/idworks/connect', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ accountName, credentials }),
  });
  return handle(resp);
}

export async function idworksDisconnect(): Promise<void> {
  await fetch('/api/idworks/disconnect', { method: 'DELETE', headers: await authHeaders() });
}

export async function idworksImportStart(mode: 'full' | 'update' = 'full'): Promise<{ job: IdworksImportJob }> {
  const resp = await fetch('/api/idworks/import/start', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ mode }),
  });
  return handle(resp);
}

export async function idworksImportStatus(): Promise<{ job: IdworksImportJob }> {
  const resp = await fetch('/api/idworks/import/status', { headers: await authHeaders() });
  return handle(resp);
}

export async function idworksImportCancel(): Promise<void> {
  await fetch('/api/idworks/import/cancel', { method: 'POST', headers: await authHeaders() });
}

export async function idworksImportSetAutosync(enabled: boolean, everyHours: number): Promise<void> {
  await fetch('/api/idworks/import/autosync', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ enabled, everyHours }),
  });
}

export async function idworksPush(produtos: IdworksPushProduct[]): Promise<{ resultados: IdworksPushResult[] }> {
  const resp = await fetch('/api/idworks/push', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos }),
  });
  return handle(resp);
}

export async function idworksWebhookConfig(params: { syncMode?: 'polling' | 'webhook'; regenerateSecret?: boolean }): Promise<IdworksWebhookConfig> {
  const resp = await fetch('/api/idworks/webhook/config', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(params),
  });
  return handle(resp);
}
