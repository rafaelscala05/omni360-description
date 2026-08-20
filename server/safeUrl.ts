// SSRF guards for server-side fetches of client-supplied URLs.
//
// Extracted from server.ts so the operational agent (server/agent/tools/*) can
// reuse the exact same validation when it downloads a banner image the user
// attached in the chat. server.ts still owns /api/upload and imports from here.

import net from 'net';
import { lookup } from 'dns/promises';

// Bloqueia ranges privados/loopback/link-local para evitar SSRF (ex.: acessar o
// endpoint de metadados 169.254.169.254 ou serviços internos da VPC).
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||                          // 10.0.0.0/8
      a === 127 ||                         // loopback
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) ||          // 192.168.0.0/16
      (a === 169 && b === 254) ||          // link-local (metadata)
      a === 0
    );
  }
  const v6 = ip.toLowerCase();
  // ::1 (loopback), fc00::/7 (ULA), fe80::/10 (link-local) e IPv4-mapeado.
  if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) {
    return true;
  }
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return false;
}

// Valida protocolo (só http/s) e resolve TODOS os endereços do host, rejeitando
// se qualquer um for interno — defesa contra SSRF/DNS rebinding. Compartilhada
// por qualquer fetch de URL fornecida pelo cliente (imagem ou página HTML).
async function assertSafeDestination(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Protocolo não permitido'), { status: 400 });
  }
  const results = await lookup(url.hostname, { all: true });
  if (!results.length || results.some((r) => isPrivateIp(r.address))) {
    throw Object.assign(new Error('Destino não permitido'), { status: 400 });
  }
  return url;
}

// Valida uma URL de imagem fornecida pelo cliente antes de o servidor buscá-la.
export async function assertSafeImageUrl(rawUrl: string): Promise<void> {
  await assertSafeDestination(rawUrl);
}

// Valida uma URL de página (produto/site) fornecida pelo cliente antes do scrape.
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  return assertSafeDestination(rawUrl);
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AlfredBot/1.0)';
// Vários sites (Mercado Livre incluso) liberam o crawler do Google do desafio
// anti-bot que aplicam a qualquer outro cliente, porque dependem dele para
// indexação/Shopping — ou seja, o mesmo conteúdo que mostram ao Googlebot já é
// destinado a ser público. Usado só como retry, nunca como primeira tentativa.
const GOOGLEBOT_USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// Assinaturas comuns de página de desafio anti-bot (Akamai/Cloudflare/PerimeterX/
// Incapsula/Datadome e a verificação própria do Mercado Livre). Checado tanto na
// URL final (após redirecionamentos) quanto no corpo, porque alguns desses
// desafios respondem 200 com HTML mínimo em vez de redirecionar.
const BOT_CHALLENGE_URL_PATTERN = /account-verification|\/challenge(-platform)?\/|captcha|\/_Incapsula_Resource|cf_chl_|checkpoint\.|are-you-a-robot|sorry\/index/i;
const BOT_CHALLENGE_BODY_PATTERN = /suspicious-traffic|cf-browser-verification|Attention Required! \| Cloudflare|px-captcha|Checking your browser before accessing|verifican?do sua conex[ãa]o|distil_r_blocked|_Incapsula_Resource/i;

function looksLikeBotChallenge(finalUrl: string, html: string): boolean {
  return BOT_CHALLENGE_URL_PATTERN.test(finalUrl) || BOT_CHALLENGE_BODY_PATTERN.test(html);
}

async function fetchHtmlOnce(
  url: URL,
  userAgent: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`Não foi possível acessar a página (${resp.status})`), { status: 502 });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw Object.assign(new Error('Página muito grande.'), { status: 400 });
    }
    return { html: buf.toString('utf-8'), finalUrl: resp.url || url.toString() };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw Object.assign(new Error('Tempo esgotado ao acessar a página'), { status: 504 });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Busca o HTML de uma URL já validada por assertSafeUrl, com timeout e limite
// de tamanho. redirect: 'follow' (não 'error') é intencional — mesma escolha
// já aceita em scanWebsite (server/contentAgent.ts): produtos reais têm
// redirecionamentos comuns (http->https, www, slug canônico) e bloquear todos
// tornaria o scraping inútil na prática. O DNS já foi checado no destino
// inicial; hops de redirecionamento não são revalidados (risco aceito,
// idêntico ao já existente em scanWebsite).
//
// Se a primeira tentativa (identificada como AlfredBot) esbarrar num desafio
// anti-bot, refaz UMA vez com UA de Googlebot antes de desistir — várias
// plataformas liberam o Googlebot do desafio (ver GOOGLEBOT_USER_AGENT acima).
export async function fetchHtmlSafely(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<string> {
  const url = await assertSafeUrl(rawUrl);
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxBytes = opts?.maxBytes ?? 2 * 1024 * 1024;

  const first = await fetchHtmlOnce(url, DEFAULT_USER_AGENT, timeoutMs, maxBytes);
  if (!looksLikeBotChallenge(first.finalUrl, first.html)) {
    return first.html;
  }

  try {
    const retry = await fetchHtmlOnce(url, GOOGLEBOT_USER_AGENT, timeoutMs, maxBytes);
    return retry.html;
  } catch {
    // Retry falhou (ex.: timeout) — devolve o que a primeira tentativa trouxe,
    // mesmo sendo a página de desafio; quem chama já trata extração vazia.
    return first.html;
  }
}

/** Wake's image payloads want a bare base64 string plus a format enum. */
export type ImageFormat = 'PNG' | 'JPG' | 'JPEG' | 'GIF' | 'WEBP';

export interface FetchedImage {
  base64: string;
  formato: ImageFormat;
  contentType: string;
  bytes: number;
}

const FORMAT_BY_TYPE: Record<string, ImageFormat> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
};

/**
 * Downloads an image the user attached in chat (already on Firebase Storage) and
 * returns it as base64 — the form Wake's banner endpoints expect. Redirects are
 * refused so a safe host cannot bounce us to an internal one after the DNS check.
 */
export async function fetchImageAsBase64(
  rawUrl: string,
  maxBytes = 8 * 1024 * 1024,
  /** Formatos que o destino aceita. A Wake, por exemplo, só recebe PNG/JPG/JPEG. */
  aceitos?: readonly ImageFormat[],
): Promise<FetchedImage> {
  await assertSafeImageUrl(rawUrl);
  const res = await fetch(rawUrl, { redirect: 'error' });
  if (!res.ok) {
    throw Object.assign(new Error(`Não consegui baixar a imagem (HTTP ${res.status}).`), { status: 400 });
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const formato = FORMAT_BY_TYPE[contentType];
  if (!formato) {
    throw Object.assign(new Error(`Formato de imagem não suportado: ${contentType || 'desconhecido'}.`), { status: 400 });
  }
  if (aceitos && !aceitos.includes(formato)) {
    throw Object.assign(
      new Error(`Esta imagem é ${formato} e o destino aceita apenas ${aceitos.join(', ')}. Converta o arquivo antes de enviar.`),
      { status: 400 },
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw Object.assign(
      new Error(`Imagem muito grande (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB; máximo ${maxBytes / 1024 / 1024} MB).`),
      { status: 400 },
    );
  }
  return { base64: buf.toString('base64'), formato, contentType, bytes: buf.byteLength };
}
