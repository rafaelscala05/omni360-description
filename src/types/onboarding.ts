// Types for the onboarding wizard (perfil do usuário + dados da empresa + contato).
// Shared between client (wizard UI) and server (server/onboardingAgent.ts).

export interface OnboardingStep1 {
  role: string;
  industry: string;
  companySize: string;
  ecommerceUrl: string;
}

export interface OnboardingContact {
  whatsapp: string;
  corporateEmail: string;
  sameAsAccountEmail: boolean;
  firstName: string;
  lastName: string;
}

export interface CompanyAddress {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export interface CompanyData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  situacaoCadastral: string;
  dataInicioAtividade: string;
  atividadePrincipal: string;
  endereco: CompanyAddress;
  telefone: string;
  email: string;
  updatedAt?: string;
  source: 'cnpj.ws' | 'manual';
}

export interface OnboardingState {
  completed: boolean;
  completedAt: string | null;
  step1: OnboardingStep1;
  contact: OnboardingContact;
}

export const ONBOARDING_BONUS = 30;

export const COMPANY_SIZE_OPTIONS = [
  '1 (apenas eu)',
  '2 a 10',
  '11 a 50',
  '51 a 200',
  'Mais de 200',
] as const;
