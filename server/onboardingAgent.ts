// Backend for the onboarding wizard: CNPJ lookup (public cnpj.ws API, no key)
// and the onboarding-complete/company-save endpoints. Credit grants happen only
// here (Admin SDK, idempotent) — never trust the client to self-grant credits.

import type express from 'express';
import { adminDb, FieldValue } from './firebaseAdmin';
import { recordEvent } from './crmEvents';
import type { CompanyData, OnboardingContact, OnboardingStep1 } from '../src/types/onboarding';
import { ONBOARDING_BONUS } from '../src/types/onboarding';
import { REFERRAL_ONBOARDING_BONUS } from '../src/types/referral';

const CNPJ_BASE_URL = 'https://publica.cnpj.ws/cnpj';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// cnpj.ws's public tier is rate-limited (~3 req/min) — retry only on 429/5xx,
// never on 404 (CNPJ not found) or 422 (malformed CNPJ).
async function fetchCnpj(cnpj: string, attempt = 0): Promise<RawCnpjResponse> {
  const resp = await fetch(`${CNPJ_BASE_URL}/${cnpj}`);
  if ((resp.status === 429 || resp.status >= 500) && attempt < 3) {
    await sleep(1000 * 2 ** attempt + Math.random() * 300);
    return fetchCnpj(cnpj, attempt + 1);
  }
  if (resp.status === 404) {
    throw Object.assign(new Error('CNPJ não encontrado'), { status: 404 });
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`cnpj.ws falhou (${resp.status}): ${text.slice(0, 200)}`), { status: 502 });
  }
  return resp.json() as Promise<RawCnpjResponse>;
}

interface RawCnpjResponse {
  razao_social?: string;
  estabelecimento?: {
    nome_fantasia?: string;
    situacao_cadastral?: string;
    data_inicio_atividade?: string;
    atividade_principal?: { descricao?: string };
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cep?: string;
    ddd1?: string;
    telefone1?: string;
    email?: string;
    cidade?: { nome?: string };
    estado?: { sigla?: string };
  };
}

function mapToCompanyData(cnpj: string, raw: RawCnpjResponse): CompanyData {
  const est = raw.estabelecimento ?? {};
  return {
    cnpj,
    razaoSocial: raw.razao_social ?? '',
    nomeFantasia: est.nome_fantasia ?? '',
    situacaoCadastral: est.situacao_cadastral ?? '',
    dataInicioAtividade: est.data_inicio_atividade ?? '',
    atividadePrincipal: est.atividade_principal?.descricao ?? '',
    endereco: {
      logradouro: est.logradouro ?? '',
      numero: est.numero ?? '',
      complemento: est.complemento ?? '',
      bairro: est.bairro ?? '',
      cidade: est.cidade?.nome ?? '',
      uf: est.estado?.sigla ?? '',
      cep: est.cep ?? '',
    },
    telefone: est.ddd1 && est.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : (est.telefone1 ?? ''),
    email: est.email ?? '',
    source: 'cnpj.ws',
  };
}

interface OnboardingDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string; email?: string; name?: string }>;
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  console.error('onboarding endpoint error:', err);
  res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno' });
}

export function registerOnboardingRoutes(app: express.Application, deps: OnboardingDeps): void {
  const { verifyFirebaseToken } = deps;

  app.post('/api/onboarding/lookup-cnpj', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const digits = String(req.body?.cnpj ?? '').replace(/\D/g, '');
      if (digits.length !== 14) {
        throw Object.assign(new Error('CNPJ inválido — informe 14 dígitos'), { status: 422 });
      }
      const raw = await fetchCnpj(digits);
      res.json({ company: mapToCompanyData(digits, raw) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/onboarding/complete', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const step1 = req.body?.step1 as OnboardingStep1;
      const contact = req.body?.contact as OnboardingContact;
      if (!step1 || !contact) {
        throw Object.assign(new Error('Dados de onboarding incompletos'), { status: 422 });
      }

      const userRef = adminDb.collection('users').doc(decoded.uid);
      const referralRef = adminDb.collection('referrals').doc(decoded.uid);

      const result = await adminDb.runTransaction(async (tx) => {
        // Firestore transactions require ALL reads before ANY write — resolve
        // both docs up front, then decide what to write.
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });

        if (userSnap.data()?.onboarding?.completed === true) {
          return { alreadyCompleted: true };
        }

        const referredBy = userSnap.data()?.referredBy as string | undefined;
        const referralSnap = referredBy ? await tx.get(referralRef) : null;
        const shouldPayReferrer =
          !!referredBy && !!referralSnap?.exists && referralSnap.data()?.onboardingCreditsGranted !== true;

        const now = FieldValue.serverTimestamp();
        tx.update(userRef, {
          onboarding: { completed: true, completedAt: now, step1, contact },
          credits: FieldValue.increment(ONBOARDING_BONUS),
        });
        const logRef = userRef.collection('credit_logs').doc();
        tx.set(logRef, {
          type: 'bonus',
          actionType: 'Bônus de Onboarding',
          actionKey: 'onboarding_bonus',
          productName: 'N/A',
          sku: 'N/A',
          userName: decoded.name ?? decoded.email ?? '',
          creditsConsumed: 0,
          creditsAdded: ONBOARDING_BONUS,
          timestamp: new Date().toISOString(),
        });

        // Referral milestone: if this user was referred, and the referrer hasn't
        // already been paid the onboarding bonus for them, pay it now.
        if (shouldPayReferrer && referredBy) {
          const referrerRef = adminDb.collection('users').doc(referredBy);
          tx.update(referrerRef, { credits: FieldValue.increment(REFERRAL_ONBOARDING_BONUS) });
          const referrerLogRef = referrerRef.collection('credit_logs').doc();
          tx.set(referrerLogRef, {
            type: 'bonus',
            actionType: 'Indicação — amigo completou onboarding',
            actionKey: 'referral_onboarding_bonus',
            productName: 'N/A',
            sku: 'N/A',
            userName: '',
            creditsConsumed: 0,
            creditsAdded: REFERRAL_ONBOARDING_BONUS,
            timestamp: new Date().toISOString(),
          });
          tx.update(referralRef, {
            status: 'onboarding_completed',
            onboardingCreditsGranted: true,
            onboardingGrantedAt: now,
          });
        }

        return { alreadyCompleted: false };
      });

      if (!result.alreadyCompleted) {
        void recordEvent(decoded.uid, 'onboarding_completed', {
          role: step1.role,
          industry: step1.industry,
          companySize: step1.companySize,
        });
      }

      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/onboarding/company', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const company = req.body?.company as CompanyData;
      if (!company) throw Object.assign(new Error('Dados da empresa ausentes'), { status: 422 });
      await adminDb.collection('users').doc(decoded.uid).update({
        company: { ...company, updatedAt: FieldValue.serverTimestamp(), source: 'manual' },
      });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}
