// Client service for the onboarding wizard. Server calls follow the same
// Bearer-token pattern as contentService.ts's callJson.

import { auth } from '../firebase';
import type { CompanyData, OnboardingContact, OnboardingStep1 } from '../types/onboarding';

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

export const lookupCnpj = (cnpj: string) =>
  callJson<{ company: CompanyData }>('/api/onboarding/lookup-cnpj', 'POST', { cnpj });

export const completeOnboarding = (step1: OnboardingStep1, contact: OnboardingContact) =>
  callJson<{ alreadyCompleted: boolean }>('/api/onboarding/complete', 'POST', { step1, contact });

export const saveCompanyProfile = (company: CompanyData) =>
  callJson<{ ok: true }>('/api/onboarding/company', 'POST', { company });
