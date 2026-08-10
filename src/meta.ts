// Dispara eventos no Meta Pixel (client) e na Conversions API (server), com o
// mesmo event_id nos dois canais para o Meta deduplicar. Nunca deve derrubar
// o fluxo do produto: qualquer falha aqui é só logada.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

// ID público do Meta Pixel — não é segredo, fica visível no HTML de qualquer
// jeito. Hardcoded para não depender da env var estar disponível no build do
// App Hosting (VITE_* precisa existir em build-time, não só runtime).
const PIXEL_ID = '1541685420840320';

let pixelInitialized = false;
let currentUid: string | null = null;
let currentEmail: string | null = null;
let currentFirstName: string | null = null;
let currentLastName: string | null = null;
let currentPhone: string | null = null;
let currentCity: string | null = null;

const COUNTRY = 'br';

export function metaSetUser(uid: string, email?: string | null, displayName?: string | null): void {
  currentUid = uid;
  currentEmail = email ?? null;
  if (displayName) {
    const [first, ...rest] = displayName.trim().split(/\s+/);
    currentFirstName = first || null;
    currentLastName = rest.length > 0 ? rest.join(' ') : null;
  } else {
    currentFirstName = null;
    currentLastName = null;
  }
}

export function metaSetProfile(profile: { phone?: string | null; city?: string | null }): void {
  if (profile.phone !== undefined) currentPhone = profile.phone || null;
  if (profile.city !== undefined) currentCity = profile.city || null;
}

export function metaInit(): void {
  try {
    if (pixelInitialized || !PIXEL_ID || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('init', PIXEL_ID);
    const eventId = crypto.randomUUID();
    window.fbq('track', 'PageView', {}, { eventID: eventId });
    pixelInitialized = true;
    sendToCapi('PageView', eventId);
  } catch (err) {
    console.warn('meta pixel init failed', err);
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// _fbp/_fbc são setados pelo fbevents.js, carregado async (index.html) — na
// primeira chamada de um page load, o cookie muitas vezes ainda não existe no
// instante em que um evento dispara. Faz polling curto antes de desistir, pra
// não perder o fbp/fbc de eventos disparados logo no mount (ex. ViewContent
// da página de preços). Resolve na hora se o cookie já existir.
function waitForCookie(name: string, timeoutMs = 600, intervalMs = 50): Promise<string | undefined> {
  return new Promise((resolve) => {
    const existing = readCookie(name);
    if (existing) {
      resolve(existing);
      return;
    }
    const start = Date.now();
    const poll = () => {
      const value = readCookie(name);
      if (value || Date.now() - start >= timeoutMs) {
        resolve(value);
        return;
      }
      setTimeout(poll, intervalMs);
    };
    setTimeout(poll, intervalMs);
  });
}

interface MetaEventPayload {
  event_name: string;
  event_id: string;
  event_source_url: string;
  custom_data?: Record<string, unknown>;
  user_data?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    city?: string;
    country?: string;
    external_id?: string;
  };
  fbp?: string;
  fbc?: string;
}

function buildUserData(): MetaEventPayload['user_data'] {
  const userData: NonNullable<MetaEventPayload['user_data']> = { country: COUNTRY };
  if (currentEmail) userData.email = currentEmail;
  if (currentFirstName) userData.first_name = currentFirstName;
  if (currentLastName) userData.last_name = currentLastName;
  if (currentPhone) userData.phone = currentPhone;
  if (currentCity) userData.city = currentCity;
  if (currentUid) userData.external_id = currentUid;
  return userData;
}

async function sendToCapi(eventName: string, eventId: string, customData?: Record<string, unknown>): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const [fbp, fbc] = await Promise.all([waitForCookie('_fbp'), waitForCookie('_fbc')]);
    const payload: MetaEventPayload = {
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      custom_data: customData,
      user_data: buildUserData(),
      fbp,
      fbc,
    };
    fetch('/api/meta/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.warn('meta CAPI request failed', err);
    });
  } catch (err) {
    console.warn('meta CAPI send failed', err);
  }
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

    const customData: Record<string, unknown> = { ...params };
    if (typeof params.sku === 'string' && params.sku) {
      customData.content_ids = [params.sku];
      customData.content_type = 'product';
    }

    sendToCapi(eventName, eventId, customData);
  } catch (err) {
    console.warn('meta track failed', err);
  }
}
