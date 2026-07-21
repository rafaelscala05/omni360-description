import { auth } from '../firebase';

// Client wrappers for the server-side Bling ERP proxy (/api/bling/*). Tokens never
// live in the browser — OAuth runs server-side and per-user access/refresh tokens
// are persisted there. These types mirror server/blingAgent.ts.

export interface BlingStatus {
  connected: boolean;
  validated: boolean;
  version?: 'v3' | null;
  lastValidatedAt: string | null;
  companyId?: string;
  syncMode?: 'polling' | 'webhook';
  webhookUrl?: string | null;
  webhookStats?: { lastReceivedAt: string | null; totalReceived: number };
}

export interface BlingPushProduct {
  blingId: string;
  sku?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  cest?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  imagens?: string[];
  campos: { descricao: boolean; seo: boolean; fiscal: boolean; imagens: boolean };
}

export interface BlingPushResult {
  blingId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', string>;
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

export async function blingStatus(): Promise<BlingStatus> {
  const resp = await fetch('/api/bling/status', { headers: await authHeaders() });
  return handle(resp);
}

// Opens the Bling consent screen in a popup and resolves once it posts back the
// OAuth result (or the popup is closed).
export async function blingConnect(): Promise<{ ok: boolean }> {
  const { url } = await handle<{ url: string }>(
    await fetch('/api/bling/oauth/start', { headers: await authHeaders() }),
  );
  const popup = window.open(url, 'bling-oauth', 'width=560,height=720');
  if (!popup) throw new Error('Bloqueio de popup. Permita popups para conectar o Bling.');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      resolve({ ok });
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.source === 'bling-oauth') finish(!!ev.data.ok);
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => { if (popup.closed) finish(false); }, 800);
  });
}

export async function blingDisconnect(): Promise<void> {
  await fetch('/api/bling/disconnect', { method: 'DELETE', headers: await authHeaders() });
}

export interface BlingImportJob {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';
  mode: 'full' | 'update';
  offset: number;
  total: number;
  imported: number;
  lastSyncAt: string | null;
  error?: string | null;
  autoSync: { enabled: boolean; everyHours: number };
}

export async function blingImportStart(mode: 'full' | 'update' = 'full'): Promise<{ job: BlingImportJob }> {
  const resp = await fetch('/api/bling/import/start', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ mode }),
  });
  return handle(resp);
}

export async function blingImportStatus(): Promise<{ job: BlingImportJob }> {
  const resp = await fetch('/api/bling/import/status', { headers: await authHeaders() });
  return handle(resp);
}

export async function blingImportCancel(): Promise<void> {
  await fetch('/api/bling/import/cancel', { method: 'POST', headers: await authHeaders() });
}

export async function blingImportSetAutosync(enabled: boolean, everyHours: number): Promise<void> {
  await fetch('/api/bling/import/autosync', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ enabled, everyHours }),
  });
}

export async function blingPush(produtos: BlingPushProduct[]): Promise<{ resultados: BlingPushResult[] }> {
  const resp = await fetch('/api/bling/push', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos }),
  });
  return handle(resp);
}

export interface BlingWebhookConfig {
  webhookUrl: string;
  companyId: string;
  syncMode: 'polling' | 'webhook';
}

export async function blingWebhookConfig(params: {
  companyId?: string; syncMode?: 'polling' | 'webhook';
}): Promise<BlingWebhookConfig> {
  const resp = await fetch('/api/bling/webhook/config', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(params),
  });
  return handle(resp);
}
