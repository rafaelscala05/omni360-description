// Client service for the onboarding wizard. Server calls follow the same
// Bearer-token pattern as contentService.ts's callJson.

import { callJson } from './apiClient';
import type { CompanyData, OnboardingContact, OnboardingStep1 } from '../types/onboarding';

export const lookupCnpj = (cnpj: string) =>
  callJson<{ company: CompanyData }>('/api/onboarding/lookup-cnpj', 'POST', { cnpj });

export const completeOnboarding = (step1: OnboardingStep1, contact: OnboardingContact) =>
  callJson<{ alreadyCompleted: boolean }>('/api/onboarding/complete', 'POST', { step1, contact });

export const saveCompanyProfile = (company: CompanyData) =>
  callJson<{ ok: true }>('/api/onboarding/company', 'POST', { company });
