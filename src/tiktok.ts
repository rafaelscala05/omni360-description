// Dispara eventos no TikTok Pixel (client) e na Events API (server), com o
// mesmo event_id nos dois canais para o TikTok deduplicar. Nunca deve derrubar
// o fluxo do produto: qualquer falha aqui é só logada.

declare global {
  interface Window {
    ttq?: {
      track: (...args: unknown[]) => void;
      page: (...args: unknown[]) => void;
      load: (...args: unknown[]) => void;
      identify: (...args: unknown[]) => void;
    };
  }
}

// ID público do TikTok Pixel — não é segredo, fica visível no HTML de qualquer
// jeito. Hardcoded para não depender da env var estar disponível no build do
// App Hosting (VITE_* precisa existir em build-time, não só runtime).
const PIXEL_ID = 'D9GCICRC77UBS5FSLDFG';

let pixelInitialized = false;
let currentEmail: string | null = null;

// TikTok exige que email/phone/external_id passados para ttq.identify() já
// cheguem hasheados em SHA-256 pelo client — diferente do fbq, que aceita PII
// em texto puro e deixa o hash por conta do Meta.
async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function tiktokSetUser(uid: string, email?: string | null): void {
  currentEmail = email ?? null;
  void identifyUser(uid, currentEmail);
}

async function identifyUser(uid: string, email: string | null): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.ttq) return;
    const identify: Record<string, string> = { external_id: await sha256Hex(uid) };
    if (email) identify.email = await sha256Hex(email);
    window.ttq.identify(identify);
  } catch (err) {
    console.warn('tiktok identify failed', err);
  }
}

export function tiktokInit(): void {
  try {
    if (pixelInitialized || !PIXEL_ID || typeof window === 'undefined' || !window.ttq) return;
    window.ttq.load(PIXEL_ID);
    window.ttq.page();
    pixelInitialized = true;
  } catch (err) {
    console.warn('tiktok pixel init failed', err);
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// ttclid só vem na URL de clique do anúncio (TikTok não seta cookie sozinho),
// então precisa ser persistido no primeiro load para eventos futuros na sessão.
function readTtclid(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromUrl = new URLSearchParams(window.location.search).get('ttclid');
  if (fromUrl) {
    sessionStorage.setItem('_ttclid', fromUrl);
    return fromUrl;
  }
  return sessionStorage.getItem('_ttclid') ?? undefined;
}

interface TiktokEventPayload {
  event_name: string;
  event_id: string;
  custom_data?: Record<string, unknown>;
  user_data?: { email?: string };
  ttp?: string;
  ttclid?: string;
  url?: string;
}

export function tiktokTrack(eventName: string, params: Record<string, unknown> = {}): void {
  try {
    if (typeof window === 'undefined') return;
    tiktokInit();

    const eventId = crypto.randomUUID();

    if (window.ttq) {
      window.ttq.track(eventName, params, { event_id: eventId });
    }

    const payload: TiktokEventPayload = {
      event_name: eventName,
      event_id: eventId,
      custom_data: params,
      user_data: currentEmail ? { email: currentEmail } : undefined,
      ttp: readCookie('_ttp'),
      ttclid: readTtclid(),
      url: window.location.href,
    };

    fetch('/api/tiktok/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.warn('tiktok Events API request failed', err);
    });
  } catch (err) {
    console.warn('tiktok track failed', err);
  }
}
