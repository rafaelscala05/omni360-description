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

// Valida uma URL de imagem fornecida pelo cliente antes de o servidor buscá-la.
// Só permite http/https e resolve o host para garantir que não aponta para a
// rede interna (defesa contra SSRF). Lança em caso de URL não permitida.
export async function assertSafeImageUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Protocolo não permitido'), { status: 400 });
  }
  // Resolve TODOS os endereços do host e rejeita se qualquer um for interno.
  const results = await lookup(url.hostname, { all: true });
  if (!results.length || results.some((r) => isPrivateIp(r.address))) {
    throw Object.assign(new Error('Destino não permitido'), { status: 400 });
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
