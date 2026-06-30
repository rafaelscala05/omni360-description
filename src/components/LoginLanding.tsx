import React, { useState } from 'react';
import { Sparkles, Search, FileSpreadsheet, Image as ImageIcon, CheckCircle, ShieldCheck, Zap, Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';

interface LoginLandingProps {
  onGoogleLogin: () => void;
  onEmailLogin: (email: string, password: string) => Promise<void>;
  onEmailRegister: (email: string, password: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
}

type AuthMode = 'login' | 'register' | 'reset';

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

export default function LoginLanding({ onGoogleLogin, onEmailLogin, onEmailRegister, onPasswordReset }: LoginLandingProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const features = [
    { title: "Importação Inteligente", description: "Importe sua planilha Excel de produtos em segundos e deixe a IA cuidar do resto.", icon: <FileSpreadsheet className="w-6 h-6 text-blue-600" />, color: "bg-blue-50" },
    { title: "Enriquecimento de Dados", description: "Buscamos informações técnicas reais e detalhadas na internet para completar o cadastro dos seus produtos.", icon: <Search className="w-6 h-6 text-purple-600" />, color: "bg-purple-50" },
    { title: "Geração SEO com IA", description: "Criamos títulos, descrições e palavras-chave otimizadas para o Google automaticamente, aumentando suas vendas.", icon: <Sparkles className="w-6 h-6 text-amber-600" />, color: "bg-amber-50" },
    { title: "Ambientação Profissional", description: "Gere imagens realistas do seu produto em cenários profissionais e lifestyle para atrair mais clientes.", icon: <ImageIcon className="w-6 h-6 text-green-600" />, color: "bg-green-50" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await onEmailLogin(email, password);
      } else if (mode === 'register') {
        await onEmailRegister(email, password);
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
      <div className="hidden lg:flex lg:w-3/5 bg-slate-50 relative p-12 flex-col justify-center">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-200 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 -right-24 w-96 h-96 bg-purple-200 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-primary p-2.5 rounded-xl shadow-lg shadow-blue-200">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h2 className="font-display text-2xl font-extrabold text-gray-900 tracking-tight">Alfreds - Agente de Ecommerce</h2>
          </div>
          <h1 className="text-5xl font-black text-gray-900 leading-tight mb-4">
            Transforme seus produtos em <span className="text-primary">vendas automáticas</span>
          </h1>
          <p className="text-lg text-gray-600 mb-12 leading-relaxed">Um agente para aprimorar os produtos do seu e-commerce.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className={`${feature.color} w-12 h-12 rounded-xl flex items-center justify-center mb-4`}>{feature.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex items-center gap-8 text-gray-400">
            <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" /><span className="text-sm font-medium">Seguro & Privado</span></div>
            <div className="flex items-center gap-2"><Zap className="w-5 h-5" /><span className="text-sm font-medium">Processamento Real-time</span></div>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="w-full lg:w-2/5 flex flex-col justify-center items-center p-8 bg-white border-l border-gray-100 relative">
        <div className="absolute top-8 right-8 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-md h-8 w-8 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">Alfreds</span>
          </div>
        </div>

        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            {mode !== 'login' && (
              <button onClick={() => switchMode('login')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 mx-auto transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
            )}
            <h2 className="text-3xl font-black text-gray-900 mb-2">
              {mode === 'login' ? 'Bem-vindo(a)' : mode === 'register' ? 'Criar conta' : 'Recuperar senha'}
            </h2>
            <p className="text-gray-500 text-sm">
              {mode === 'login'
                ? 'Faça login para acessar suas ferramentas de IA.'
                : mode === 'register'
                ? 'Crie sua conta para começar.'
                : 'Enviaremos um link para redefinir sua senha.'}
            </p>
          </div>

          {resetSent ? (
            <div className="text-center p-6 bg-green-50 rounded-2xl border border-green-200">
              <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-3" />
              <p className="font-bold text-green-900 mb-1">Email enviado!</p>
              <p className="text-sm text-green-700">Verifique sua caixa de entrada e clique no link para redefinir sua senha.</p>
              <button onClick={() => switchMode('login')} className="mt-4 text-sm text-green-700 underline">Voltar ao login</button>
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
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

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
                        className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
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
                  className="w-full py-3.5 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                      className="text-sm text-blue-600 hover:text-blue-800 transition-colors block mx-auto"
                    >
                      Esqueci minha senha
                    </button>
                    <p className="text-sm text-gray-500">
                      Não tem conta?{' '}
                      <button onClick={() => switchMode('register')} className="font-bold text-blue-600 hover:text-blue-800 transition-colors">
                        Criar conta
                      </button>
                    </p>
                  </>
                )}
                {mode === 'register' && (
                  <p className="text-sm text-gray-500">
                    Já tem conta?{' '}
                    <button onClick={() => switchMode('login')} className="font-bold text-blue-600 hover:text-blue-800 transition-colors">
                      Fazer login
                    </button>
                  </p>
                )}
              </div>
            </>
          )}

          {mode === 'login' && !resetSent && (
            <div className="mt-8 p-5 bg-blue-50 rounded-2xl border border-blue-100">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-900 uppercase tracking-widest">Bônus de Boas-vindas</span>
              </div>
              <p className="text-sm text-blue-800 leading-relaxed">
                Novos usuários recebem <strong>10 créditos gratuitos</strong> para testar a geração SEO e ambientação de imagens hoje mesmo.
              </p>
            </div>
          )}
        </div>

        <div className="absolute bottom-8 text-gray-400 text-xs">
          © {new Date().getFullYear()} Alfreds. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
}
