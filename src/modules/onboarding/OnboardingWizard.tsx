import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ChevronRight, ChevronLeft, Check, RefreshCw, Search, PenLine, X, Gift } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { CompanyData, OnboardingContact, OnboardingStep1 } from '../../types/onboarding';
import { COMPANY_SIZE_OPTIONS, ONBOARDING_BONUS } from '../../types/onboarding';
import { completeOnboarding, lookupCnpj, saveCompanyProfile } from '../../services/onboardingService';
import ProfileSummary from './ProfileSummary';

interface Props {
  user: User;
  onClose: () => void;
  onCompleted: () => void;
}

const STEPS = ['Perfil', 'Empresa', 'Contato'];

const maskCnpj = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
};

const emptyCompany = (cnpj: string): CompanyData => ({
  cnpj,
  razaoSocial: '',
  nomeFantasia: '',
  situacaoCadastral: '',
  dataInicioAtividade: '',
  atividadePrincipal: '',
  endereco: { logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' },
  telefone: '',
  email: '',
  source: 'manual',
});

const OnboardingWizard: React.FC<Props> = ({ user, onClose, onCompleted }) => {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Step 1 — Perfil
  const [role, setRole] = useState('');
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [ecommerceUrl, setEcommerceUrl] = useState('');

  // Step 2 — Empresa
  const [cnpj, setCnpj] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [company, setCompany] = useState<CompanyData | null>(null);

  // Step 3 — Contato
  const [sameEmail, setSameEmail] = useState<boolean | null>(null);
  const [corporateEmail, setCorporateEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const go = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); setError(null); };

  const canAdvance =
    step === 0 ? !!(role.trim() && industry.trim() && companySize) :
    step === 1 ? !!company?.razaoSocial?.trim() :
    !!(firstName.trim() && lastName.trim() && whatsapp.trim() && (sameEmail === true || corporateEmail.trim()));

  const handleLookup = async () => {
    const digits = cnpj.replace(/\D/g, '');
    if (digits.length !== 14) { setError('Informe um CNPJ com 14 dígitos'); return; }
    setLookingUp(true);
    setError(null);
    try {
      const { company: found } = await lookupCnpj(digits);
      setCompany(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível consultar o CNPJ');
    } finally {
      setLookingUp(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      const step1: OnboardingStep1 = { role: role.trim(), industry: industry.trim(), companySize, ecommerceUrl: ecommerceUrl.trim() };
      const contact: OnboardingContact = {
        whatsapp: whatsapp.trim(),
        corporateEmail: sameEmail ? (user.email ?? '') : corporateEmail.trim(),
        sameAsAccountEmail: !!sameEmail,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
      if (company) await saveCompanyProfile(company);
      await completeOnboarding(step1, contact);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao concluir onboarding');
    } finally {
      setSaving(false);
    }
  };

  const input = (val: string, set: (v: string) => void, ph?: string, disabled?: boolean) => (
    <input
      value={val}
      disabled={disabled}
      onChange={(e) => set(e.target.value)}
      placeholder={ph}
      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03] transition-all disabled:bg-slate-50 disabled:text-slate-400"
    />
  );

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="max-w-2xl w-full my-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#141311] to-[#1e3a8a] p-6 mb-6 text-white shadow-lg">
          <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-[#FF5B03]/30 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="bg-white/10 backdrop-blur p-2.5 rounded-2xl ring-1 ring-white/20">
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight">Complete seu cadastro</h2>
              <p className="text-sm text-white/70">Ganhe {ONBOARDING_BONUS} créditos ao finalizar.</p>
            </div>
          </div>
          {!done && (
            <div className="relative flex items-center gap-2 mt-5">
              {STEPS.map((s, i) => (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full transition-colors ${i <= step ? 'bg-white' : 'bg-white/20'}`} />
                  <span className={`mt-1.5 block text-[10px] font-medium ${i <= step ? 'text-white' : 'text-white/40'}`}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 md:p-8 overflow-hidden">
          {done ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <Check className="w-7 h-7 text-emerald-500" />
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">Cadastro concluído!</h3>
              <p className="text-sm text-slate-500 mt-1">+{ONBOARDING_BONUS} créditos já estão na sua conta.</p>
              <button
                onClick={onCompleted}
                className="mt-6 flex items-center gap-1.5 mx-auto px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors"
              >
                Continuar
              </button>
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={step}
                  custom={dir}
                  initial={{ opacity: 0, x: dir * 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * -24 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  {step === 0 && (
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Qual sua função? *</label>
                        {input(role, setRole, 'Ex.: Sócio, Gerente de E-commerce...')}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Área de atuação da empresa *</label>
                        {input(industry, setIndustry, 'Ex.: Moda, Eletrônicos, Alimentos...')}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Quantos funcionários? *</label>
                        <div className="flex flex-wrap gap-2">
                          {COMPANY_SIZE_OPTIONS.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setCompanySize(opt)}
                              className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-all ${companySize === opt ? 'border-[#FF5B03] bg-[#FF5B03] text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-[#FF5B03] hover:text-[#FF5B03]'}`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">URL do e-commerce</label>
                        {input(ecommerceUrl, setEcommerceUrl, 'suaempresa.com.br')}
                      </div>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">CNPJ *</label>
                        <div className="flex gap-2">
                          <input
                            value={cnpj}
                            onChange={(e) => setCnpj(maskCnpj(e.target.value))}
                            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                            placeholder="00.000.000/0001-00"
                            className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                          />
                          <button
                            onClick={handleLookup}
                            disabled={lookingUp || cnpj.replace(/\D/g, '').length !== 14}
                            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-50 rounded-xl shadow-sm transition-colors whitespace-nowrap"
                          >
                            {lookingUp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            Buscar
                          </button>
                        </div>
                        {!company && (
                          <button
                            type="button"
                            onClick={() => setCompany(emptyCompany(cnpj.replace(/\D/g, '')))}
                            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#FF5B03] transition-colors"
                          >
                            <PenLine className="w-3.5 h-3.5" /> Não encontrei — preencher manualmente
                          </button>
                        )}
                      </div>

                      {company && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 border-t border-slate-100 pt-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Razão social *</label>
                            {input(company.razaoSocial, (v) => setCompany({ ...company, razaoSocial: v }), 'Razão social')}
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nome fantasia</label>
                            {input(company.nomeFantasia, (v) => setCompany({ ...company, nomeFantasia: v }), 'Nome fantasia')}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Cidade</label>
                              {input(company.endereco.cidade, (v) => setCompany({ ...company, endereco: { ...company.endereco, cidade: v } }))}
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1.5">UF</label>
                              {input(company.endereco.uf, (v) => setCompany({ ...company, endereco: { ...company.endereco, uf: v.toUpperCase().slice(0, 2) } }))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nome *</label>
                        {input(firstName, setFirstName, 'Nome')}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Sobrenome *</label>
                        {input(lastName, setLastName, 'Sobrenome')}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">WhatsApp *</label>
                        <input
                          value={whatsapp}
                          onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
                          placeholder="(00) 00000-0000"
                          className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">O e-mail corporativo é o mesmo do cadastro ({user.email})? *</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setSameEmail(true); setCorporateEmail(''); }}
                            className={`rounded-xl border px-4 py-1.5 text-sm font-medium transition-all ${sameEmail === true ? 'border-[#FF5B03] bg-[#FF5B03] text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-[#FF5B03] hover:text-[#FF5B03]'}`}
                          >
                            Sim
                          </button>
                          <button
                            type="button"
                            onClick={() => setSameEmail(false)}
                            className={`rounded-xl border px-4 py-1.5 text-sm font-medium transition-all ${sameEmail === false ? 'border-[#FF5B03] bg-[#FF5B03] text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-[#FF5B03] hover:text-[#FF5B03]'}`}
                          >
                            Não
                          </button>
                        </div>
                      </div>
                      {sameEmail === false && (
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1.5">E-mail corporativo *</label>
                          {input(corporateEmail, setCorporateEmail, 'contato@suaempresa.com.br')}
                        </div>
                      )}
                      <div className="pt-2">
                        <ProfileSummary
                          step1={{ role, industry, companySize, ecommerceUrl }}
                          company={company}
                          contact={{
                            whatsapp,
                            corporateEmail: sameEmail ? (user.email ?? '') : corporateEmail,
                            sameAsAccountEmail: !!sameEmail,
                            firstName,
                            lastName,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

              <div className="flex items-center justify-between mt-8">
                <button
                  onClick={() => (step === 0 ? onClose() : go(step - 1))}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Agora não' : 'Voltar'}
                </button>
                {step < STEPS.length - 1 ? (
                  <button
                    disabled={!canAdvance}
                    onClick={() => go(step + 1)}
                    className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-40 rounded-xl shadow-sm transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" /> Próximo
                  </button>
                ) : (
                  <button
                    disabled={!canAdvance || saving}
                    onClick={handleFinish}
                    className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
                  >
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Concluir e ganhar {ONBOARDING_BONUS} créditos
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
