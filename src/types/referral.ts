// Types for "Indique e Ganhe" (referral). Shared between client (ReferralPage)
// and server (server/referralAgent.ts).

export type ReferralStatus = 'signed_up' | 'onboarding_completed';

export interface Referral {
  id: string; // doc id === referredUid
  referrerUid: string;
  referrerCode: string;
  referredUid: string;
  referredEmail: string;
  status: ReferralStatus;
  signupCreditsGranted: boolean;
  onboardingCreditsGranted: boolean;
  signupGrantedAt: string | null;
  onboardingGrantedAt: string | null;
  createdAt: string;
}

export const REFERRAL_SIGNUP_BONUS = 30;
export const REFERRAL_ONBOARDING_BONUS = 70;
// Bônus para quem se cadastra pelo link (o indicado), separado do bônus do indicador acima.
export const REFERRED_SIGNUP_BONUS = 30;
