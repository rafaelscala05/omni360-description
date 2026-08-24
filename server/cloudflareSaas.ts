// Isola a Custom Hostnames API da Cloudflare (Cloudflare for SaaS). Mesmo papel
// que whatsappProvider.ts cumpre para a Meta: o resto do código fala em domínio
// e status, nunca no formato da API.
//
// O desenho: o cliente aponta um CNAME do domínio dele para
// CLOUDFLARE_SAAS_CNAME_TARGET (o fallback origin da zona). A Cloudflare emite o
// certificado por hostname e encaminha para o Worker, que reescreve o Host para o
// endereço do App Hosting e carrega o domínio original em X-Forwarded-Host —
// que é o que server/blogPublic.ts usa para resolver o tenant.
//
// Sem as variáveis abaixo o módulo fica inerte e as rotas de domínio respondem
// 503 com mensagem explícita; o resto do Blog (posts, categorias, /b/{slug})
// funciona inteiro.

const API = 'https://api.cloudflare.com/client/v4';

export interface CustomHostname {
  id: string;
  hostname: string;
  status: string;     // 'pending' | 'pending_validation' | 'active' | 'blocked' | ...
  sslStatus: string;  // 'initializing' | 'pending_validation' | 'active' | ...
  verified: boolean;  // hostname e certificado ativos — só então serve tráfego
  detail?: string;    // motivo legível quando ainda não está ativo
}

export function isCloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);
}

// Alvo do CNAME que o cliente cria. É o único registro de DNS pedido a ele.
export function cnameTarget(): string {
  return process.env.CLOUDFLARE_SAAS_CNAME_TARGET ?? '';
}

function requireConfig(): { token: string; zoneId: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    throw Object.assign(
      new Error('Integração Cloudflare não configurada (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID).'),
      { status: 503 },
    );
  }
  return { token, zoneId };
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: T;
}

async function cfFetch<T>(path: string, init: RequestInit = {}): Promise<CfEnvelope<T>> {
  const { token, zoneId } = requireConfig();
  const resp = await fetch(`${API}/zones/${zoneId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await resp.json().catch(() => ({}))) as CfEnvelope<T>;
  if (!resp.ok || body.success === false) {
    const message = body.errors?.map((e) => e.message).join('; ') || `Cloudflare respondeu ${resp.status}`;
    // 409 da Cloudflare = hostname já existe (em qualquer conta). Propaga como
    // conflito para a UI poder diferenciar de erro nosso.
    throw Object.assign(new Error(message), { status: resp.status === 409 ? 409 : 502 });
  }
  return body;
}

// Formato bruto do custom hostname na API — só os campos que a gente lê.
interface CfHostname {
  id: string;
  hostname: string;
  status: string;
  verification_errors?: string[];
  ssl?: {
    status?: string;
    validation_errors?: Array<{ message: string }>;
  };
}

function toCustomHostname(raw: CfHostname): CustomHostname {
  const sslStatus = raw.ssl?.status ?? 'unknown';
  const verified = raw.status === 'active' && sslStatus === 'active';
  // A Cloudflare separa o erro de posse do hostname do erro de emissão do
  // certificado. Os dois viram a mesma frase para quem está olhando a tela.
  const problems = [
    ...(raw.verification_errors ?? []),
    ...(raw.ssl?.validation_errors ?? []).map((e) => e.message),
  ].filter(Boolean);
  let detail: string | undefined;
  if (!verified) {
    detail = problems.length > 0
      ? problems.join('; ')
      : 'Aguardando o CNAME propagar e o certificado ser emitido. Isso costuma levar alguns minutos.';
  }
  return { id: raw.id, hostname: raw.hostname, status: raw.status, sslStatus, verified, detail };
}

// Cria o custom hostname. `ssl.method: 'http'` é o que permite o onboarding com
// um CNAME só: a validação acontece pela própria conexão HTTP assim que o
// registro propaga, sem TXT adicional para o cliente criar.
export async function createCustomHostname(hostname: string): Promise<CustomHostname> {
  const body = await cfFetch<CfHostname>('/custom_hostnames', {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  });
  return toCustomHostname(body.result);
}

export async function getCustomHostname(hostname: string): Promise<CustomHostname | null> {
  const body = await cfFetch<CfHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  const match = (body.result ?? []).find((h) => h.hostname === hostname);
  return match ? toCustomHostname(match) : null;
}

// Remove pelo id. Hostname órfão continua contando na cota, então o DELETE do
// domínio no nosso lado sempre tenta apagar aqui também.
export async function deleteCustomHostname(id: string): Promise<void> {
  await cfFetch(`/custom_hostnames/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
