import { auth } from '../firebase';

// Client wrappers for the server-side Wake proxy (/api/wake/*). The token never
// lives in the browser — it is sent once to /api/wake/validate and persisted
// server-side. These types mirror server/wakeAgent.ts.

export interface WakeStatus {
  connected: boolean;
  validated: boolean;
  lastValidatedAt: string | null;
}

export interface WakeNormalizedProduct {
  produtoId: string;
  sku: string;
  nome: string;
  precoPor?: number;
  precoDe?: number;
  ean?: string;
  informacaoId?: number;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  categorias: string[];
  imagens: string[];
  raw: unknown;
}

export interface WakePushProduct {
  produtoId: string;
  sku?: string;
  informacaoId?: number;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  atributos?: { nome: string; valor: string }[];
  imagensBase64?: { base64: string; formato: 'JPG' | 'PNG' }[];
  campos: { descricao: boolean; seo: boolean; atributos: boolean; imagens: boolean };
}

export interface WakePushResult {
  produtoId: string;
  sku?: string;
  ok: boolean;
  steps: Record<'descricao' | 'seo' | 'atributos' | 'imagens', string>;
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

export async function wakeValidate(token: string): Promise<{ valid: boolean; message: string }> {
  const resp = await fetch('/api/wake/validate', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ token }),
  });
  return handle(resp);
}

export async function wakeStatus(): Promise<WakeStatus> {
  const resp = await fetch('/api/wake/status', { headers: await authHeaders() });
  return handle(resp);
}

export async function wakeDisconnect(): Promise<void> {
  await fetch('/api/wake/disconnect', { method: 'DELETE', headers: await authHeaders() });
}

export async function wakeImport(
  pagina = 1,
  quantidadeRegistros = 50,
): Promise<{ pagina: number; count: number; hasMore: boolean; produtos: WakeNormalizedProduct[] }> {
  const resp = await fetch('/api/wake/import', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ pagina, quantidadeRegistros }),
  });
  return handle(resp);
}

export async function wakePush(produtos: WakePushProduct[]): Promise<{ resultados: WakePushResult[] }> {
  const resp = await fetch('/api/wake/push', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos }),
  });
  return handle(resp);
}
