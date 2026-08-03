// Backend for "Indique e Ganhe": referral code issuance, the referred user's
// list view, and the signup-milestone credit grant. The onboarding-milestone
// grant lives in server/onboardingAgent.ts (it needs the onboarding-complete
// transaction anyway). Credit grants are Admin SDK only and idempotent —
// never trust the client to self-grant credits.

import type express from 'express';
import crypto from 'crypto';
import { adminDb, FieldValue } from './firebaseAdmin';
import type { Referral } from '../src/types/referral';
import { REFERRAL_SIGNUP_BONUS, REFERRED_SIGNUP_BONUS } from '../src/types/referral';

interface ReferralDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string; email?: string; name?: string }>;
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  console.error('referral endpoint error:', err);
  res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno' });
}

// Short, URL-safe, collision-unlikely code derived from the uid + randomness —
// no need for a global-uniqueness check since it's looked up by exact match.
function generateReferralCode(): string {
  return crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

async function ensureReferralCode(uid: string): Promise<string> {
  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  const existing = snap.data()?.referralCode as string | undefined;
  if (existing) return existing;

  const code = generateReferralCode();
  await userRef.update({ referralCode: code });
  return code;
}

export function registerReferralRoutes(app: express.Application, deps: ReferralDeps): void {
  const { verifyFirebaseToken } = deps;

  // Public (no auth) — powers the "Você está sendo indicado por X" popup on
  // /entrar, shown before the visitor has an account. Only exposes the
  // referrer's display name, never anything else from their user doc.
  app.get('/api/referrals/resolve/:code', async (req, res) => {
    try {
      const code = String(req.params.code ?? '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'Código ausente' });

      const snap = await adminDb.collection('users').where('referralCode', '==', code).limit(1).get();
      if (snap.empty) return res.status(404).json({ error: 'Código não encontrado' });

      const data = snap.docs[0].data();
      const name = data.displayName || (data.email ? String(data.email).split('@')[0] : null) || 'um amigo';
      res.json({ name });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/referrals/me', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const referralCode = await ensureReferralCode(decoded.uid);

      const snap = await adminDb
        .collection('referrals')
        .where('referrerUid', '==', decoded.uid)
        .orderBy('createdAt', 'desc')
        .get();

      const referrals: Referral[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          referrerUid: data.referrerUid,
          referrerCode: data.referrerCode,
          referredUid: data.referredUid,
          referredEmail: data.referredEmail ?? '',
          status: data.status,
          signupCreditsGranted: !!data.signupCreditsGranted,
          onboardingCreditsGranted: !!data.onboardingCreditsGranted,
          signupGrantedAt: data.signupGrantedAt?.toDate?.().toISOString() ?? null,
          onboardingGrantedAt: data.onboardingGrantedAt?.toDate?.().toISOString() ?? null,
          createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date().toISOString(),
        };
      });

      res.json({ referralCode, referrals });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/referrals/register-signup', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const referralCode = String(req.body?.referralCode ?? '').trim().toUpperCase();
      if (!referralCode) return res.json({ ok: false, reason: 'missing_code' });

      const referrerQuery = await adminDb
        .collection('users')
        .where('referralCode', '==', referralCode)
        .limit(1)
        .get();
      if (referrerQuery.empty) return res.json({ ok: false, reason: 'invalid_code' });

      const referrerDoc = referrerQuery.docs[0];
      const referrerUid = referrerDoc.id;
      if (referrerUid === decoded.uid) return res.json({ ok: false, reason: 'self_referral' });

      const referralRef = adminDb.collection('referrals').doc(decoded.uid);
      const userRef = adminDb.collection('users').doc(decoded.uid);
      const referrerRef = adminDb.collection('users').doc(referrerUid);

      const result = await adminDb.runTransaction(async (tx) => {
        const referralSnap = await tx.get(referralRef);
        if (referralSnap.exists) return { ok: true, alreadyRegistered: true };

        const now = FieldValue.serverTimestamp();
        tx.set(referralRef, {
          referrerUid,
          referrerCode: referralCode,
          referredUid: decoded.uid,
          referredEmail: decoded.email ?? '',
          status: 'signed_up',
          signupCreditsGranted: true,
          onboardingCreditsGranted: false,
          signupGrantedAt: now,
          onboardingGrantedAt: null,
          createdAt: now,
        });
        tx.update(userRef, {
          referredBy: referrerUid,
          referredByCode: referralCode,
          credits: FieldValue.increment(REFERRED_SIGNUP_BONUS),
        });
        const referredLogRef = userRef.collection('credit_logs').doc();
        tx.set(referredLogRef, {
          type: 'bonus',
          actionType: 'Bônus por cadastro via indicação',
          actionKey: 'referred_signup_bonus',
          productName: 'N/A',
          sku: 'N/A',
          userName: '',
          creditsConsumed: 0,
          creditsAdded: REFERRED_SIGNUP_BONUS,
          timestamp: new Date().toISOString(),
        });

        tx.update(referrerRef, { credits: FieldValue.increment(REFERRAL_SIGNUP_BONUS) });
        const logRef = referrerRef.collection('credit_logs').doc();
        tx.set(logRef, {
          type: 'bonus',
          actionType: 'Indicação — amigo se cadastrou',
          actionKey: 'referral_signup_bonus',
          productName: 'N/A',
          sku: 'N/A',
          userName: '',
          creditsConsumed: 0,
          creditsAdded: REFERRAL_SIGNUP_BONUS,
          timestamp: new Date().toISOString(),
        });

        return { ok: true, alreadyRegistered: false };
      });

      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });
}
