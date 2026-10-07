import React, { useEffect, useMemo, useRef, useState } from 'react';
import { reanimar } from '../../modules/agent/movimento';
import { Link } from 'react-router-dom';
import { CheckCircle, Mail, Lock, Phone, Eye, EyeOff, ArrowLeft, Gift, X } from 'lucide-react';
import logoAlfreds from '../../assets/brand/logo-alfreds-produtos.png';
import AlfredLogo from '../../components/alfredLogo/AlfredLogo';
import { OBJETIVO_INFO } from '../../modules/onboarding/mission/objetivos';
import type { Objetivo } from '../../modules/agent/capacidades';
import { resolveReferrer } from '../../services/referralService';
import { REFERRED_SIGNUP_BONUS } from '../../types/referral';
import { guardarObjetivoDoSite, objetivoValido } from '../objetivoSite';
import { usePageMeta } from '../usePageMeta';

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
    'auth/user-not-found': 'Não há conta com este e-mail. Confira o endereço ou crie uma conta.',
    'auth/wrong-password': 'Senha incorreta. Tente de novo ou redefina a senha.',
    'auth/invalid-credential': 'E-mail ou senha incorretos. Tente de novo ou redefina a senha.',
    'auth/email-already-in-use': 'Este e-mail já tem conta. Entre com ele ou redefina a senha.',
    'auth/weak-password': 'A senha precisa de pelo menos 6 caracteres.',
    'auth/invalid-email': 'Este e-mail não é válido. Confira o endereço.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet. Confira a rede e tente de novo.',
  };
  return map[code] ?? 'Não deu para concluir agora. Tente de novo.';
}

const PRIMEIRO_PASSO: Record<Objetivo, string> = {
  produto: 'Cole o link de um produto ou suba a planilha.',
  meli: 'Conecte a sua conta do Mercado Livre.',
  conteudo: 'Informe o endereço do seu site.',
};

/** Painel de apoio: muda com o objetivo da página de origem e com o modo. */
function textoPainel(mode: AuthMode, objetivo: Objetivo | null): { titulo: string; passos: { titulo: string; texto: string }[] } {
  if (mode === 'login') {
    return {
      titulo: 'Sua semana está esperando por você.',
      passos: [
        { titulo: 'O Alfred leu as suas fontes', texto: 'Catálogo, ERP, anúncios e site.' },
        { titulo: 'Montou as tarefas da semana', texto: 'O que falta, o que está parado, o que pode vender mais.' },
        { titulo: 'E espera o seu ok para gravar', texto: 'Nada vai para a loja sem a sua aprovação.' },
      ],
    };
  }
  const titulo =
    objetivo === 'produto'
      ? 'Vamos começar pelas descrições dos seus produtos.'
      : objetivo === 'meli'
        ? 'Vamos começar pelos seus anúncios do Mercado Livre.'
        : objetivo === 'conteudo'
          ? 'Vamos começar pelo seu blog.'
          : 'Em cinco minutos, o Alfred começa a trabalhar na sua loja.';
  return {
    titulo,
    passos: [
      objetivo
        ? { titulo: 'Objetivo já marcado', texto: OBJETIVO_INFO[objetivo].titulo + '. Dá para trocar depois.' }
        : { titulo: 'Escolha o que resolver primeiro', texto: 'Descrições, Mercado Livre ou blog.' },
      { titulo: 'Mostre a sua loja', texto: objetivo ? PRIMEIRO_PASSO[objetivo] : 'Cole um link, suba a planilha ou conecte o ERP.' },
      { titulo: 'Aprove o primeiro resultado', texto: 'Nada é gravado sem o seu ok.' },
    ],
  };
}

const inputCls =
  'w-full pl-11 pr-4 min-h-[50px] rounded-[16px] text-[16px] text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)] bg-[var(--ag-surface-solid)] border border-[var(--ag-hairline-2)] focus:outline-none focus:ring-2 focus:ring-[var(--ag-accent)] focus:border-transparent transition';

export default function AuthPage({ onGoogleLogin, onEmailLogin, onEmailRegister, onPasswordReset }: AuthPageProps) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const objetivo = objetivoValido(params.get('objetivo'));
  const [mode, setMode] = useState<AuthMode>(params.get('modo') === 'criar' || objetivo ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Erro de login: o formulário treme (curto, horizontal) além da mensagem.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (error) reanimar(formRef.current, 'ag-shake');
  }, [error]);
  const [resetSent, setResetSent] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [showReferralPopup, setShowReferralPopup] = useState(false);

  // Objetivo da página do site: a Tela 0 do onboarding já abre com ele marcado.
  useEffect(() => {
    if (objetivo) guardarObjetivoDoSite(objetivo);
  }, [objetivo]);

  // Indique e Ganhe: if this visit came from a referral link (?ref=CODE),
  // resolve the referrer's name and greet the visitor with it. The code
  // itself is captured/persisted separately in App.tsx (onAuthStateChanged),
  // this is purely the friendly "you were invited by X" popup.
  useEffect(() => {
    const code = params.get('ref');
    if (!code) return;
    resolveReferrer(code)
      .then((result) => {
        if (result) {
          setReferrerName(result.name);
          setShowReferralPopup(true);
        }
      })
      .catch(() => {});
  }, [params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await onEmailLogin(email, password);
      } else if (mode === 'register') {
        if (phone.replace(/\D/g, '').length < 10) {
          setError('Informe o telefone com DDD, como (11) 91234-5678.');
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

  usePageMeta({
    title: mode === 'register' ? 'Criar conta grátis | Alfreds' : 'Entrar | Alfreds',
    description: 'Entre no Alfreds ou crie sua conta grátis com 10 créditos para testar.',
  });

  const painel = textoPainel(mode === 'reset' ? 'login' : mode, objetivo);
  const corObjetivo = objetivo === 'meli' ? 'var(--ag-orig-meli)' : objetivo === 'conteudo' ? 'var(--ag-orig-conteudo)' : 'var(--ag-orig-produto)';

  return (
    <div className="alfreds relative isolate min-h-screen font-sans antialiased" data-tema="claro" style={{ background: 'var(--ag-bg)' }}>
      <div aria-hidden className="ag-aurora -z-10 pointer-events-none" style={{ position: 'fixed', inset: 0 }} />

      <header className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
        <Link to="/" aria-label="Alfreds, voltar ao site">
          <img src={logoAlfreds} alt="Alfreds" className="h-7 w-auto" />
        </Link>
        <Link to="/" className="inline-flex items-center gap-1.5 rounded-full px-3.5 min-h-[40px] text-[14px] font-medium text-[var(--ag-text-2)] hover:bg-[var(--ag-fill)]">
          <ArrowLeft className="w-4 h-4" /> Voltar ao site
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 grid gap-10 lg:grid-cols-[1fr_440px] lg:gap-16 lg:items-center lg:min-h-[calc(100vh-10rem)]">
        {/* Apoio: no telefone vira só uma linha acima do formulário. */}
        <section className="hidden lg:block">
          <AlfredLogo size={120} rotulo="Alfred" />
          <h1 className="mt-8 max-w-lg font-display text-[48px] font-semibold leading-[1.02] tracking-[-0.04em] text-[var(--ag-text)] text-balance">
            {painel.titulo}
          </h1>
          <ol className="mt-10 flex flex-col gap-5 max-w-md">
            {painel.passos.map((p, i) => (
              <li key={p.titulo} className="flex gap-4">
                <span
                  className="w-8 h-8 rounded-full grid place-items-center shrink-0 text-[14px] font-semibold"
                  style={i === 0 && objetivo && mode === 'register' ? { background: corObjetivo, color: '#141311' } : { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-[16px] font-semibold text-[var(--ag-text)]">{p.titulo}</p>
                  <p className="text-[14.5px] text-[var(--ag-text-2)]">{p.texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="w-full max-w-[440px] mx-auto">
          <div className="lg:hidden flex items-center gap-3 mb-5">
            <AlfredLogo size={44} interativo={false} />
            <p className="font-display text-[22px] font-semibold leading-tight tracking-tight text-[var(--ag-text)]">{painel.titulo}</p>
          </div>

          <div className="ag-glass-strong ag-sheen rounded-[30px] p-6 sm:p-8">
            {mode !== 'login' && (
              <button
                onClick={() => switchMode('login')}
                className="-ml-2 mb-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13.5px] text-[var(--ag-text-2)] hover:bg-[var(--ag-fill)]"
              >
                <ArrowLeft className="w-4 h-4" /> Já tenho conta
              </button>
            )}
            <h2 className="font-display text-[30px] font-semibold tracking-[-0.03em] text-[var(--ag-text)]">
              {mode === 'login' ? 'Bem-vindo de volta' : mode === 'register' ? 'Crie sua conta grátis' : 'Redefinir senha'}
            </h2>
            <p className="mt-1 text-[15px] text-[var(--ag-text-2)]">
              {mode === 'login'
                ? 'Entre para ver o que o Alfred preparou.'
                : mode === 'register'
                  ? '10 créditos para testar. Sem cartão.'
                  : 'Enviamos um link para você criar uma senha nova.'}
            </p>

            {mode === 'register' && referrerName && (
              <div className="mt-5 flex items-center gap-2.5 rounded-[16px] px-3.5 py-3" style={{ background: 'var(--ag-accent-soft)' }}>
                <Gift className="w-4 h-4 shrink-0" style={{ color: 'var(--ag-accent)' }} />
                <p className="text-[14px] text-[var(--ag-text)]">
                  Convite de <strong>{referrerName}</strong>: você ganha <strong>+{REFERRED_SIGNUP_BONUS} créditos</strong> ao criar a conta.
                </p>
              </div>
            )}

            {resetSent ? (
              <div className="mt-6 text-center rounded-[20px] p-6" style={{ background: 'var(--ag-ok-soft)' }}>
                <CheckCircle className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--ag-ok)' }} />
                <p className="font-semibold text-[var(--ag-text)] mb-1">Link enviado</p>
                <p className="text-[14px] text-[var(--ag-text-2)]">Abra o e-mail e siga o link para criar uma senha nova.</p>
                <button onClick={() => switchMode('login')} className="mt-4 text-[14px] font-semibold text-[var(--ag-text)] underline underline-offset-4">
                  Voltar para entrar
                </button>
              </div>
            ) : (
              <>
                {mode !== 'reset' && (
                  <>
                    <button
                      onClick={onGoogleLogin}
                      className="mt-6 w-full flex items-center justify-center gap-3 min-h-[52px] px-4 rounded-full text-[15.5px] font-semibold transition active:scale-[.98] hover:brightness-[0.98]"
                      style={{ background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', border: '1px solid var(--ag-hairline-2)', boxShadow: 'var(--ag-shadow-sm)' }}
                    >
                      <img src="https://www.google.com/favicon.ico" alt="" className="w-5 h-5" />
                      Continuar com o Google
                    </button>
                    <div className="flex items-center gap-3 my-5">
                      <div className="flex-1 h-px" style={{ background: 'var(--ag-hairline-2)' }} />
                      <span className="text-[12.5px] text-[var(--ag-text-3)]">ou com e-mail</span>
                      <div className="flex-1 h-px" style={{ background: 'var(--ag-hairline-2)' }} />
                    </div>
                  </>
                )}

                <form ref={formRef} onSubmit={handleSubmit} className={`space-y-4 ${mode === 'reset' ? 'mt-6' : ''}`}>
                  <div>
                    <label htmlFor="auth-email" className="block text-[14px] font-medium text-[var(--ag-text)] mb-1.5">E-mail</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ag-text-3)]" />
                      <input
                        id="auth-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="voce@sualoja.com.br"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {mode === 'register' && (
                    <div>
                      <label htmlFor="auth-tel" className="block text-[14px] font-medium text-[var(--ag-text)] mb-1.5">Celular com WhatsApp</label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ag-text-3)]" />
                        <input
                          id="auth-tel"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          required
                          value={phone}
                          onChange={(e) => setPhone(maskPhone(e.target.value))}
                          placeholder="(11) 91234-5678"
                          maxLength={15}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}

                  {mode !== 'reset' && (
                    <div>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <label htmlFor="auth-senha" className="block text-[14px] font-medium text-[var(--ag-text)]">Senha</label>
                        {mode === 'login' && (
                          <button type="button" onClick={() => switchMode('reset')} className="text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">
                            Esqueci a senha
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ag-text-3)]" />
                        <input
                          id="auth-senha"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={mode === 'register' ? 'Pelo menos 6 caracteres' : '••••••••'}
                          className={`${inputCls} !pr-12`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full text-[var(--ag-text-3)] hover:text-[var(--ag-text)]"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {error && (
                    <p role="alert" className="text-[14px] rounded-[14px] px-3.5 py-2.5" style={{ background: 'var(--ag-danger-soft)', color: 'var(--ag-danger)' }}>
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[52px] px-4 rounded-full text-[15.5px] font-semibold text-white transition active:scale-[.98] hover:brightness-[1.06] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ background: 'var(--ag-accent)' }}
                  >
                    {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta grátis' : 'Enviar link'}
                  </button>
                </form>

                {mode === 'login' && (
                  <p className="mt-6 text-center text-[14.5px] text-[var(--ag-text-2)]">
                    Ainda não tem conta?{' '}
                    <button onClick={() => switchMode('register')} className="font-semibold text-[var(--ag-accent)] hover:underline underline-offset-4">
                      Criar conta grátis
                    </button>
                  </p>
                )}
                {mode === 'register' && (
                  <p className="mt-5 text-center text-[12.5px] leading-relaxed text-[var(--ag-text-3)]">
                    Ao criar a conta, você concorda com os{' '}
                    <Link to="/termos-de-servico" className="underline underline-offset-2">Termos de Serviço</Link> e a{' '}
                    <Link to="/politica-de-privacidade" className="underline underline-offset-2">Política de Privacidade</Link>.
                  </p>
                )}
              </>
            )}
          </div>

          {mode === 'login' && !resetSent && (
            <p className="mt-4 text-center text-[13.5px] text-[var(--ag-text-2)]">
              Primeira vez aqui? A conta nova começa com <strong className="text-[var(--ag-text)]">10 créditos grátis</strong>.
            </p>
          )}
        </section>
      </main>

      {showReferralPopup && referrerName && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'var(--ag-scrim)' }}>
          <div className="alfreds ag-aurora relative max-w-sm w-full rounded-[30px] p-7 ag-rise" data-tema="escuro" style={{ boxShadow: 'var(--ag-shadow-lg)' }}>
            <button
              onClick={() => setShowReferralPopup(false)}
              aria-label="Fechar"
              className="absolute right-4 top-4 w-9 h-9 grid place-items-center rounded-full"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
            >
              <X className="w-4 h-4" />
            </button>
            <span className="w-12 h-12 rounded-[16px] grid place-items-center mb-4" style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}>
              <Gift className="w-6 h-6" />
            </span>
            <h3 className="font-display text-[24px] font-semibold tracking-tight text-[var(--ag-text)] mb-2">{referrerName} te convidou</h3>
            <p className="text-[15px] leading-relaxed text-[var(--ag-text-2)] mb-6">
              Crie a sua conta pelo convite e comece com <strong className="text-[var(--ag-text)]">+{REFERRED_SIGNUP_BONUS} créditos</strong> além dos grátis.
            </p>
            <button
              onClick={() => { setShowReferralPopup(false); switchMode('register'); }}
              className="w-full min-h-[50px] rounded-full text-[15px] font-semibold text-white"
              style={{ background: 'var(--ag-accent)' }}
            >
              Criar minha conta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
