import crypto from 'crypto';
import type express from 'express';
import { adminDb } from '../firebaseAdmin';
import { MELI_API_BASE, MELI_AUTH_BASE, MELI_CLIENT_ID, MELI_CLIENT_SECRET, MELI_PKCE_ENABLED, MELI_REDIRECT_URI, meliConfigured } from './config';
import { decryptSecret, encryptSecret } from './crypto';
import type { MeliConnectionSecret } from './types';
import { sanitizeError } from './utils';

export const MELI_SECRET_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('integration_secrets').doc('meli');
export const MELI_STATUS_REF = (uid: string) =>
  adminDb.collection('users').doc(uid).collection('settings').doc('meli');
const OAUTH_STATE_REF = (state: string) => adminDb.collection('oauth_states').doc(`meli_${state}`);

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  user_id: number | string;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

async function exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${MELI_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MELI_CLIENT_ID, client_secret: MELI_CLIENT_SECRET, ...params }),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
    throw Object.assign(
      new Error(payload?.message || payload?.error_description || payload?.error || `OAuth MELI respondeu ${response.status}`),
      { status: response.status >= 500 ? 502 : 401 },
    );
  }
  return payload as TokenResponse;
}

async function persistTokens(uid: string, tokens: TokenResponse, siteId: string, existingCreatedAt?: string): Promise<void> {
  const now = new Date().toISOString();
  const secret: MeliConnectionSecret = {
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: encryptSecret(tokens.refresh_token),
    tokenExpiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) - 120) * 1000,
    scopes: String(tokens.scope || '').split(/\s+/).filter(Boolean),
    sellerId: String(tokens.user_id),
    siteId,
    status: 'active',
    refreshLeaseId: null,
    refreshLeaseUntil: null,
    createdAt: existingCreatedAt || now,
    updatedAt: now,
  };
  await MELI_SECRET_REF(uid).set(secret);
  await MELI_STATUS_REF(uid).set({
    connected: true,
    validated: true,
    sellerId: secret.sellerId,
    siteId,
    scopes: secret.scopes,
    status: 'active',
    mode: 'audit_only',
    updatedAt: now,
  }, { merge: true });
}

async function fetchCurrentUser(accessToken: string): Promise<{ id: number | string; site_id?: string }> {
  const response = await fetch(`${MELI_API_BASE}/users/me`, {
    headers: { accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Não foi possível validar /users/me (${response.status}).`);
  return response.json() as Promise<{ id: number | string; site_id?: string }>;
}

export async function createAuthorizationUrl(uid: string): Promise<string> {
  if (!meliConfigured()) throw Object.assign(new Error('Integração MELI não configurada no servidor.'), { status: 503 });
  const state = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  await OAUTH_STATE_REF(state).set({
    uid,
    expiresAt: Date.now() + 10 * 60 * 1000,
    codeVerifier: MELI_PKCE_ENABLED ? encryptSecret(verifier) : null,
    createdAt: new Date().toISOString(),
  });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: MELI_CLIENT_ID,
    redirect_uri: MELI_REDIRECT_URI,
    state,
  });
  if (MELI_PKCE_ENABLED) {
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${MELI_AUTH_BASE}/authorization?${params.toString()}`;
}

export async function completeAuthorization(code: string, state: string): Promise<{ uid: string; sellerId: string; siteId: string }> {
  const ref = OAUTH_STATE_REF(state);
  const snap = await ref.get();
  await ref.delete().catch(() => undefined);
  if (!snap.exists) throw new Error('Estado OAuth inválido ou já utilizado.');
  const stored = snap.data() as { uid?: string; expiresAt?: number; codeVerifier?: ReturnType<typeof encryptSecret> | null };
  if (!stored.uid || !stored.expiresAt || stored.expiresAt < Date.now()) throw new Error('Estado OAuth expirado. Inicie a conexão novamente.');

  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: MELI_REDIRECT_URI,
  };
  if (stored.codeVerifier) params.code_verifier = decryptSecret(stored.codeVerifier);
  const tokens = await exchangeToken(params);
  const me = await fetchCurrentUser(tokens.access_token);
  if (String(me.id) !== String(tokens.user_id)) throw new Error('O usuário do token não corresponde ao usuário autenticado.');
  const existing = await MELI_SECRET_REF(stored.uid).get();
  await persistTokens(stored.uid, tokens, me.site_id || 'MLB', existing.data()?.createdAt);
  return { uid: stored.uid, sellerId: String(me.id), siteId: me.site_id || 'MLB' };
}

const refreshPromises = new Map<string, Promise<string>>();

async function refreshAccessToken(uid: string, force: boolean): Promise<string> {
  const existing = refreshPromises.get(uid);
  if (existing) return existing;
  const promise = refreshAccessTokenWithLease(uid, force).finally(() => refreshPromises.delete(uid));
  refreshPromises.set(uid, promise);
  return promise;
}

async function refreshAccessTokenWithLease(uid: string, force: boolean): Promise<string> {
  const ref = MELI_SECRET_REF(uid);
  const leaseId = crypto.randomUUID();
  const acquired = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('Conta Mercado Livre não conectada.'), { status: 401 });
    const data = snap.data() as MeliConnectionSecret;
    if (!force && data.tokenExpiresAt > Date.now() + 30_000) return 'fresh';
    if (data.refreshLeaseUntil && data.refreshLeaseUntil > Date.now()) return 'wait';
    tx.update(ref, { refreshLeaseId: leaseId, refreshLeaseUntil: Date.now() + 30_000 });
    return 'acquired';
  });

  if (acquired === 'fresh') {
    const snap = await ref.get();
    return decryptSecret((snap.data() as MeliConnectionSecret).accessToken);
  }
  if (acquired === 'wait') {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const snap = await ref.get();
      const data = snap.data() as MeliConnectionSecret;
      if (data.tokenExpiresAt > Date.now() + 30_000 && !data.refreshLeaseId) return decryptSecret(data.accessToken);
    }
    throw Object.assign(new Error('Renovação MELI em andamento. Tente novamente em instantes.'), { status: 409 });
  }

  try {
    const snap = await ref.get();
    const current = snap.data() as MeliConnectionSecret;
    const refreshed = await exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: decryptSecret(current.refreshToken),
    });
    const me = await fetchCurrentUser(refreshed.access_token);
    await persistTokens(uid, refreshed, me.site_id || current.siteId, current.createdAt);
    return refreshed.access_token;
  } catch (error: any) {
    const definitive = error?.status === 401;
    if (definitive) {
      await Promise.all([
        ref.set({ status: 'reauthorization_required', refreshLeaseId: null, refreshLeaseUntil: null, updatedAt: new Date().toISOString() }, { merge: true }),
        MELI_STATUS_REF(uid).set({ connected: false, validated: false, status: 'reauthorization_required', lastError: sanitizeError(error) }, { merge: true }),
      ]);
      throw Object.assign(new Error('Sessão do Mercado Livre expirada. Reconecte a conta.'), { status: 401 });
    }
    await ref.set({ refreshLeaseId: null, refreshLeaseUntil: null, updatedAt: new Date().toISOString() }, { merge: true });
    throw Object.assign(new Error(`Não foi possível renovar a sessão MELI: ${sanitizeError(error)}`), { status: 503 });
  }
}

export async function getValidAccessToken(uid: string, forceRefresh = false): Promise<string> {
  const snap = await MELI_SECRET_REF(uid).get();
  if (!snap.exists) throw Object.assign(new Error('Conta Mercado Livre não conectada.'), { status: 401 });
  const secret = snap.data() as MeliConnectionSecret;
  if (secret.status !== 'active') throw Object.assign(new Error('A conta Mercado Livre precisa ser reconectada.'), { status: 401 });
  if (!forceRefresh && secret.tokenExpiresAt > Date.now() + 30_000) return decryptSecret(secret.accessToken);
  return refreshAccessToken(uid, forceRefresh);
}

export function oauthPopupHtml(message: string, ok: boolean): string {
  const safeMessage = JSON.stringify(message).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Mercado Livre</title><body style="font-family:system-ui;padding:32px"><p>${ok ? 'Conta conectada. Esta janela pode ser fechada.' : 'Não foi possível conectar a conta.'}</p><script>window.opener?.postMessage({source:'meli-oauth',ok:${ok},message:${safeMessage}},window.location.origin);setTimeout(()=>window.close(),900);</script></body></html>`;
}

export type VerifyFirebaseToken = (req: express.Request) => Promise<{ uid: string }>;
