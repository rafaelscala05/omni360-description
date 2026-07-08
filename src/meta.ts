// Dispara eventos no Meta Pixel (client) e na Conversions API (server), com o
// mesmo event_id nos dois canais para o Meta deduplicar. Nunca deve derrubar
// o fluxo do produto: qualquer falha aqui é só logada.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID;

let pixelInitialized = false;
let currentUid: string | null = null;
let currentEmail: string | null = null;

export function metaSetUser(uid: string, email?: string | null): void {
  currentUid = uid;
  currentEmail = email ?? null;
}

export function metaInit(): void {
  try {
    if (pixelInitialized || !PIXEL_ID || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
    pixelInitialized = true;
  } catch (err) {
    console.warn('meta pixel init failed', err);
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

interface MetaEventPayload {
  event_name: string;
  event_id: string;
  custom_data?: Record<string, unknown>;
  user_data?: { email?: string };
  fbp?: string;
  fbc?: string;
}

export function metaTrack(
  eventName: string,
  params: Record<string, unknown> = {},
  isStandard = false,
): void {
  try {
    if (typeof window === 'undefined') return;
    metaInit();

    const eventId = crypto.randomUUID();

    if (window.fbq) {
      window.fbq(isStandard ? 'track' : 'trackCustom', eventName, params, { eventID: eventId });
    }

    const payload: MetaEventPayload = {
      event_name: eventName,
      event_id: eventId,
      custom_data: params,
      user_data: currentEmail ? { email: currentEmail } : undefined,
      fbp: readCookie('_fbp'),
      fbc: readCookie('_fbc'),
    };

    fetch('/api/meta/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.warn('meta CAPI request failed', err);
    });
  } catch (err) {
    console.warn('meta track failed', err);
  }
}
