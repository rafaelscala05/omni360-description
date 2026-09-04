import { auth } from '../firebase';
import type { PushLogEntry } from '../types/integrations';

// Client wrappers for the server-side Tiny ERP proxy (/api/tiny/*). Tokens never
// live in the browser — the OAuth flow runs server-side and per-user access/refresh
// tokens are persisted there. These types mirror server/tinyAgent.ts.

export interface TinyStatus {
  connected: boolean;
  validated: boolean;
  version?: 'v2' | 'v3' | null;
  lastValidatedAt: string | null;
  syncMode?: 'polling' | 'webhook';
  cnpj?: string;
  webhookUrl?: string | null;
  webhookStats?: { lastReceivedAt: string | null; totalReceived: number };
}

export interface TinyNormalizedProduct {
  tinyId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  precoPor?: number;
  precoDe?: number;
  categorias: string[];
  imagens: string[];
  raw: unknown;
}

// Only the fields the push is allowed to write. Fiscal/logistics data
// (NCM, CEST, GTIN, pesos, dimensões) is intentionally absent: the ERP owns it.
export interface TinyPushProduct {
  tinyId: string;
  sku?: string;
  nome?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  imagens?: string[];
}

// Per-group outcome: 'ok' (sent — differed from Tiny), 'sem alteração' (local data
// matches Tiny already), 'sem dado local' (nothing local to send), or an error message.
export interface TinyPushResult {
  /** What the ERP actually received (see server/pushLog.ts). */
  enviado?: PushLogEntry[];
  tinyId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'titulo' | 'descricao' | 'seo' | 'imagens', string>;
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

export async function tinyStatus(): Promise<TinyStatus> {
  const resp = await fetch('/api/tiny/status', { headers: await authHeaders() });
  return handle(resp);
}

// v2 connect: validate and persist a static integration token server-side.
export async function tinyV2Validate(token: string): Promise<{ valid: boolean; message: string }> {
  const resp = await fetch('/api/tiny/v2/validate', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ token }),
  });
  return handle(resp);
}

// Opens the Tiny consent screen in a popup and resolves once it posts back the
// OAuth result (or the popup is closed).
export async function tinyConnect(): Promise<{ ok: boolean }> {
  const { url } = await handle<{ url: string }>(
    await fetch('/api/tiny/oauth/start', { headers: await authHeaders() }),
  );
  const popup = window.open(url, 'tiny-oauth', 'width=560,height=720');
  if (!popup) throw new Error('Bloqueio de popup. Permita popups para conectar o Tiny.');

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
      // The callback page is served from our own origin — reject spoofed messages.
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.source === 'tiny-oauth') finish(!!ev.data.ok);
    };
    window.addEventListener('message', onMessage);
    // Fallback: if the popup closes without posting a message, resolve so the UI
    // can re-check status from the server.
    const poll = setInterval(() => { if (popup.closed) finish(false); }, 800);
  });
}

export async function tinyDisconnect(): Promise<void> {
  await fetch('/api/tiny/disconnect', { method: 'DELETE', headers: await authHeaders() });
}

export interface TinyImportJob {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';
  mode: 'full' | 'update';
  offset: number;
  total: number;
  imported: number;
  lastSyncAt: string | null;
  error?: string | null;
  autoSync: { enabled: boolean; everyHours: number };
}

export async function tinyImportStart(mode: 'full' | 'update' = 'full'): Promise<{ job: TinyImportJob }> {
  const resp = await fetch('/api/tiny/import/start', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ mode }),
  });
  return handle(resp);
}

export async function tinyImportStatus(): Promise<{ job: TinyImportJob }> {
  const resp = await fetch('/api/tiny/import/status', { headers: await authHeaders() });
  return handle(resp);
}

export async function tinyImportCancel(): Promise<void> {
  await fetch('/api/tiny/import/cancel', { method: 'POST', headers: await authHeaders() });
}

export async function tinyImportSetAutosync(enabled: boolean, everyHours: number): Promise<void> {
  await fetch('/api/tiny/import/autosync', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ enabled, everyHours }),
  });
}

export async function tinyPush(produtos: TinyPushProduct[], sobrescreverTitulo?: boolean): Promise<{ resultados: TinyPushResult[] }> {
  const resp = await fetch('/api/tiny/push', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos, sobrescreverTitulo }),
  });
  return handle(resp);
}

export interface TinyWebhookConfig {
  webhookUrl: string;
  cnpj: string;
  syncMode: 'polling' | 'webhook';
}

export async function tinyWebhookConfig(params: {
  cnpj?: string; syncMode?: 'polling' | 'webhook'; regenerateSecret?: boolean;
}): Promise<TinyWebhookConfig> {
  const resp = await fetch('/api/tiny/webhook/config', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(params),
  });
  return handle(resp);
}
