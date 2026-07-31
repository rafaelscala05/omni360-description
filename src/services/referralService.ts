// Client service for "Indique e Ganhe" (referral). Same Bearer-token fetch
// pattern as onboardingService.ts / contentService.ts.

import { auth } from '../firebase';
import type { Referral } from '../types/referral';

async function callJson<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const token = await user.getIdToken();
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const getMyReferrals = () =>
  callJson<{ referralCode: string; referrals: Referral[] }>('/api/referrals/me', 'GET');

export const registerReferralSignup = (referralCode: string) =>
  callJson<{ ok: boolean; reason?: string; alreadyRegistered?: boolean }>(
    '/api/referrals/register-signup',
    'POST',
    { referralCode },
  );

// Public — used on /entrar (pre-login) to show "Você está sendo indicado por
// X". No auth token, since the visitor doesn't have an account yet.
export async function resolveReferrer(code: string): Promise<{ name: string } | null> {
  const resp = await fetch(`/api/referrals/resolve/${encodeURIComponent(code)}`);
  if (!resp.ok) return null;
  return resp.json() as Promise<{ name: string }>;
}
