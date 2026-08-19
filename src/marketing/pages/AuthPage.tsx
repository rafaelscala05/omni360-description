import React, { useEffect, useState } from 'react';
import { CheckCircle, Mail, Lock, Phone, Eye, EyeOff, ArrowLeft, Sparkles, Gift, X } from 'lucide-react';
import logoAlfreds from '../../assets/brand/logo-alfreds-produtos.png';
import { THEMES } from '../theme';
import { resolveReferrer } from '../../services/referralService';
import { REFERRED_SIGNUP_BONUS } from '../../types/referral';

interface AuthPageProps {
  onGoogleLogin: () => void;
  onEmailLogin: (email: string, password: string) => Promise<void>;
  onEmailRegister: (email: string, password: string, phone: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
}

type AuthMode = 'login' | 'register' | 'reset';

const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
};

function mapFirebaseError(code: string): string {
  const map: Record<string, string> = {
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/email-already-in-use': 'Este email já está cadastrado.',
    'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
    'auth/invalid-email': 'Email inválido.',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.',
  };
  return map[code] ?? 'Ocorreu um erro. Tente novamente.';
}

export default function AuthPage({ onGoogleLogin, onEmailLogin, onEmailRegister, onPasswordReset }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [showReferralPopup, setShowReferralPopup] = useState(false);

  // Indique e Ganhe: if this visit came from a referral link (?ref=CODE),
  // resolve the referrer's name and greet the visitor with it. The code
  // itself is captured/persisted separately in App.tsx (onAuthStateChanged),
  // this is purely the friendly "you were invited by X" popup.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (!code) return;
    resolveReferrer(code)
      .then((result) => {
        if (result) {
          setReferrerName(result.name);
          setShowReferralPopup(true);
        }
      })
      .catch(() => {});
  }, []);

  const agents = [
    { theme: THEMES.product, description: 'Importa sua planilha, enriquece dados e gera descrições e SEO com IA para cada produto.' },
    { theme: THEMES.content, description: 'Cria conteúdo, imagens ambientadas e vídeos para dar vida às suas campanhas.' },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await onEmailLogin(email, password);
      } else if (mode === 'register') {
        if (phone.replace(/\D/g, '').length < 10) {
          setError('Informe um telefone válido com DDD.');
          setLoading(false);
          return;
        }
        await onEmailRegister(email, password, phone);
      } else {
        await onPasswordReset(email);
        setResetSent(true);
      }
    } catch (err: any) {
      setError(mapFirebaseError(err?.code ?? ''));
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setResetSent(false);
  }

  return (
    <div className="min-h-screen flex bg-white font-sans overflow-hidden">
      {/* Left Column */}
      <div className="hidden lg:flex lg:w-3/5 bg-ink text-porcelain relative p-12 flex-col justify-center">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-orange rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 -right-24 w-96 h-96 bg-orange/50 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <img src={logoAlfreds} alt="Alfreds" className="h-9 w-auto" />
          </div>
          <h1 className="text-5xl font-black leading-tight mb-4">
            Seu <span className="text-orange">esquadrão de Agentes de IA</span> para o e-commerce
          </h1>
          <p className="text-lg text-porcelain/70 mb-12 leading-relaxed">
            Agentes especializados que trabalham por você: da importação da planilha à criação de conteúdo e imagens.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {agents.map((agent) => (
              <div key={agent.theme.name} className="bg-porcelain/5 p-6 rounded-2xl border border-porcelain/10 hover:border-orange/40 transition-colors">
                <img src={agent.theme.logo} alt={agent.theme.name} className="h-7 w-auto mb-4" />
                <h3 className="font-bold text-porcelain mb-2">{agent.theme.name}</h3>
                <p className="text-sm text-porcelain/60 leading-relaxed">{agent.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex items-center gap-8 text-porcelain/50">
            <div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-orange" /><span className="text-sm font-medium">Seguro & Privado</span></div>
            <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-orange" /><span className="text-sm font-medium">Processamento Real-time</span></div>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="w-full lg:w-2/5 flex flex-col justify-center items-center p-8 bg-white border-l border-gray-100 relative">
        <div className="absolute top-8 right-8 lg:hidden">
          <img src={logoAlfreds} alt="Alfreds" className="h-7 w-auto" />
        </div>

        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            {mode !== 'login' && (
              <button onClick={() => switchMode('login')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 mx-auto transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
            )}
            <h2 className="text-3xl font-black text-ink mb-2">
              {mode === 'login' ? 'Bem-vindo(a)' : mode === 'register' ? 'Criar conta' : 'Recuperar senha'}
            </h2>
            <p className="text-gray-500 text-sm">
              {mode === 'login'
                ? 'Faça login para acessar seus Agentes de IA.'
                : mode === 'register'
                ? 'Crie sua conta para começar.'
                : 'Enviaremos um link para redefinir sua senha.'}
            </p>
          </div>

          {mode === 'register' && referrerName && (
            <div className="flex items-center gap-2 mb-6 bg-ink rounded-xl px-3 py-2.5 border border-orange/20">
              <Gift className="w-4 h-4 text-orange shrink-0" />
              <p className="text-sm text-porcelain">
                Você foi indicado por <strong>{referrerName}</strong> — ganhe <strong className="text-orange">+{REFERRED_SIGNUP_BONUS} créditos</strong> de bônus ao criar sua conta.
              </p>
            </div>
          )}

          {resetSent ? (
            <div className="text-center p-6 bg-orange/5 rounded-2xl border border-orange/20">
              <CheckCircle className="w-8 h-8 text-orange mx-auto mb-3" />
              <p className="font-bold text-ink mb-1">Email enviado!</p>
              <p className="text-sm text-ink/70">Verifique sua caixa de entrada e clique no link para redefinir sua senha.</p>
              <button onClick={() => switchMode('login')} className="mt-4 text-sm text-orange underline">Voltar ao login</button>
            </div>
          ) : (
            <>
              {mode === 'login' && (
                <>
                  <button
                    onClick={onGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white border border-gray-300 rounded-xl shadow-sm text-gray-700 font-bold hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98] mb-4"
                  >
                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                    Entrar com o Google
                  </button>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400 font-medium">ou</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                </>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Telefone</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="tel"
                        inputMode="numeric"
                        required
                        value={phone}
                        onChange={(e) => setPhone(maskPhone(e.target.value))}
                        placeholder="(11) 91234-5678"
                        maxLength={15}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                )}

                {mode !== 'reset' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
                        className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange focus:border-transparent transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 bg-orange text-white rounded-xl font-bold hover:bg-orange/90 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Enviar link de recuperação'}
                </button>
              </form>

              <div className="mt-4 text-center space-y-2">
                {mode === 'login' && (
                  <>
                    <button
                      onClick={() => switchMode('reset')}
                      className="text-sm text-orange hover:text-orange/80 transition-colors block mx-auto"
                    >
                      Esqueci minha senha
                    </button>
                    <p className="text-sm text-gray-500">
                      Não tem conta?{' '}
                      <button onClick={() => switchMode('register')} className="font-bold text-orange hover:text-orange/80 transition-colors">
                        Criar conta
                      </button>
                    </p>
                  </>
                )}
                {mode === 'register' && (
                  <p className="text-sm text-gray-500">
                    Já tem conta?{' '}
                    <button onClick={() => switchMode('login')} className="font-bold text-orange hover:text-orange/80 transition-colors">
                      Fazer login
                    </button>
                  </p>
                )}
              </div>
            </>
          )}

          {mode === 'login' && !resetSent && (
            <div className="mt-8 p-5 bg-ink rounded-2xl border border-orange/20">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-orange" />
                <span className="text-xs font-bold text-orange uppercase tracking-widest">Bônus de Boas-vindas</span>
              </div>
              <p className="text-sm text-porcelain leading-relaxed">
                Novos usuários recebem <strong>10 créditos gratuitos</strong> para testar a geração SEO e ambientação de imagens hoje mesmo.
              </p>
            </div>
          )}
        </div>

        <div className="absolute bottom-8 text-gray-400 text-xs">
          © {new Date().getFullYear()} Alfreds. Todos os direitos reservados.
        </div>
      </div>

      {showReferralPopup && referrerName && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-sm w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#141311] to-[#1e3a8a] p-7 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowReferralPopup(false)}
              className="absolute right-4 top-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-[#FF5B03]/30 blur-2xl" />
            <div className="relative">
              <div className="bg-white/10 backdrop-blur w-12 h-12 rounded-2xl ring-1 ring-white/20 flex items-center justify-center mb-4">
                <Gift className="w-6 h-6" />
              </div>
              <h3 className="font-display text-xl font-bold tracking-tight mb-2">Você foi indicado!</h3>
              <p className="text-sm text-white/70 leading-relaxed mb-4">
                <strong className="text-white">{referrerName}</strong> te convidou para conhecer o Alfreds. Crie sua conta gratuita e comece a usar agora.
              </p>
              <div className="flex items-center gap-2 mb-6 bg-white/10 rounded-xl px-3 py-2.5 ring-1 ring-white/10">
                <Gift className="w-4 h-4 text-[#FFB08A] shrink-0" />
                <p className="text-sm text-white/90">
                  Crie sua conta pelo link e ganhe <strong className="text-[#FFB08A]">+{REFERRED_SIGNUP_BONUS} créditos</strong> de bônus.
                </p>
              </div>
              <button
                onClick={() => { setShowReferralPopup(false); switchMode('register'); }}
                className="w-full flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors"
              >
                Criar minha conta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
