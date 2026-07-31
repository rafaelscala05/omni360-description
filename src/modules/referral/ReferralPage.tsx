import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Gift, Copy, Check, Users, ArrowRight, RefreshCw, UserPlus, Sparkles } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Referral } from '../../types/referral';
import { REFERRAL_ONBOARDING_BONUS, REFERRAL_SIGNUP_BONUS } from '../../types/referral';
import { getMyReferrals } from '../../services/referralService';

interface Props {
  user: User;
}

const statusBadge = (status: Referral['status']) => {
  if (status === 'onboarding_completed') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold">Onboarding completo</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-600 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold">Cadastrado</span>;
};

const creditsEarned = (r: Referral) =>
  (r.signupCreditsGranted ? REFERRAL_SIGNUP_BONUS : 0) + (r.onboardingCreditsGranted ? REFERRAL_ONBOARDING_BONUS : 0);

const ReferralPage: React.FC<Props> = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState('');
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyReferrals();
        if (cancelled) return;
        setReferralCode(data.referralCode);
        setReferrals(data.referrals);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar indicações');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user.uid]);

  const link = referralCode ? `${window.location.origin}/entrar?ref=${referralCode}` : '';

  const handleCopy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalEarned = referrals.reduce((sum, r) => sum + creditsEarned(r), 0);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#141311] to-[#1e3a8a] p-7 md:p-8 mb-6 text-white shadow-lg">
        <div className="absolute -right-10 -top-10 w-52 h-52 rounded-full bg-[#FF5B03]/30 blur-3xl" />
        <div className="absolute -left-16 bottom-0 w-40 h-40 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3 mb-6">
          <div className="bg-white/10 backdrop-blur p-2.5 rounded-2xl ring-1 ring-white/20">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Indique e Ganhe</h1>
            <p className="text-sm text-white/70">Compartilhe seu link e ganhe créditos por cada amigo que entrar.</p>
          </div>
        </div>

        {/* Milestone path */}
        <div className="relative flex items-center gap-2 md:gap-4 text-sm">
          <div className="flex-1 bg-white/10 backdrop-blur rounded-2xl p-4 ring-1 ring-white/10">
            <UserPlus className="w-4 h-4 text-white/70 mb-2" />
            <p className="font-semibold">Amigo se cadastra</p>
            <p className="text-white/60 text-xs mt-0.5">com seu link</p>
            <p className="mt-2 font-display text-lg font-bold text-[#FFB08A]">+{REFERRAL_SIGNUP_BONUS} créditos</p>
          </div>
          <ArrowRight className="w-4 h-4 text-white/40 shrink-0" />
          <div className="flex-1 bg-white/10 backdrop-blur rounded-2xl p-4 ring-1 ring-white/10">
            <Sparkles className="w-4 h-4 text-white/70 mb-2" />
            <p className="font-semibold">Amigo completa o onboarding</p>
            <p className="text-white/60 text-xs mt-0.5">cadastro de empresa e contato</p>
            <p className="mt-2 font-display text-lg font-bold text-[#FFB08A]">+{REFERRAL_ONBOARDING_BONUS} créditos</p>
          </div>
        </div>
      </div>

      {/* Referral link — voucher-style card with perforated divider */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mb-6 flex flex-col sm:flex-row overflow-hidden">
        <div className="flex-1 p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Seu link de indicação</p>
          {loading ? (
            <div className="h-9 flex items-center text-slate-400 text-sm gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Gerando link…</div>
          ) : (
            <p className="font-mono text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 truncate">{link}</p>
          )}
        </div>
        <div className="relative flex items-center justify-center px-5 py-4 sm:py-0 sm:border-l border-t sm:border-t-0 border-dashed border-slate-200">
          <button
            onClick={handleCopy}
            disabled={!link}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-50 rounded-xl shadow-sm transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copiado!' : 'Copiar link'}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-6">{error}</div>}

      {/* Referrals list */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900">
            <Users className="w-4 h-4 text-slate-400" />
            <h2 className="font-display font-bold">Suas indicações</h2>
          </div>
          {!loading && referrals.length > 0 && (
            <span className="text-xs font-semibold text-slate-500">{totalEarned} créditos ganhos no total</span>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Carregando…</div>
        ) : referrals.length === 0 ? (
          <div className="p-10 text-center">
            <Gift className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Você ainda não indicou ninguém.</p>
            <p className="text-xs text-slate-400 mt-1">Copie seu link acima e compartilhe com amigos.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {referrals.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center justify-between px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{r.referredEmail || 'Amigo indicado'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{new Date(r.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {statusBadge(r.status)}
                  <span className="text-sm font-bold text-slate-700 w-16 text-right">+{creditsEarned(r)}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReferralPage;
