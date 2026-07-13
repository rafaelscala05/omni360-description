import { auth } from '../firebase';

// Client wrappers for the server-side Tiny ERP proxy (/api/tiny/*). Tokens never
// live in the browser — the OAuth flow runs server-side and per-user access/refresh
// tokens are persisted there. These types mirror server/tinyAgent.ts.

export interface TinyStatus {
  connected: boolean;
  validated: boolean;
  lastValidatedAt: string | null;
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

export interface TinyPushProduct {
  tinyId: string;
  sku?: string;
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
  campos: { descricao: boolean; seo: boolean; fiscal: boolean };
}

export interface TinyPushResult {
  tinyId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'fiscal', string>;
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

export async function tinyImport(
  offset = 0,
  limit = 50,
): Promise<{ offset: number; limit: number; total: number; count: number; hasMore: boolean; produtos: TinyNormalizedProduct[] }> {
  const resp = await fetch('/api/tiny/import', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ offset, limit }),
  });
  return handle(resp);
}

export async function tinyPush(produtos: TinyPushProduct[]): Promise<{ resultados: TinyPushResult[] }> {
  const resp = await fetch('/api/tiny/push', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos }),
  });
  return handle(resp);
}
