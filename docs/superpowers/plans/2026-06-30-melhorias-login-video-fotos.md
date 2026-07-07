# Melhorias Login, Vídeo e Fotos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar login com email/senha, persistência e notificação de job de vídeo, acesso condicional à aba de vídeo por módulo, e seletor de aspect ratio nas fotos.

**Architecture:** Quatro áreas independentes no mesmo monorepo React/Express. Todas as mudanças são no frontend (src/) exceto a leitura de módulos que já existe no Firestore. Sem novos endpoints de servidor necessários.

**Tech Stack:** React 19, TypeScript, Firebase Auth, Firestore, Tailwind CSS v4, Vite

## Global Constraints

- Todo texto da UI em pt-BR
- Seguir padrões existentes de Firestore (doc paths, onSnapshot)
- Não criar novos arquivos de serviço — modificar os existentes
- `enableCategoryImagePrompts` usa localStorage; aspect ratio também usará localStorage para consistência
- Não há testes automatizados — validação manual no dev server (`npm run dev`)

---

### Task 1: Login com Email/Senha

**Files:**
- Modify: `src/components/LoginLanding.tsx`
- Modify: `src/App.tsx` (adicionar handlers `handleEmailLogin`, `handleEmailRegister`, `handlePasswordReset`)

**Interfaces:**
- Produz: `onEmailLogin(email, password)`, `onEmailRegister(email, password)`, `onPasswordReset(email)` como props do `LoginLanding`

- [ ] **Step 1: Atualizar props de LoginLanding**

Em `src/components/LoginLanding.tsx`, alterar a interface:

```tsx
interface LoginLandingProps {
  onGoogleLogin: () => void;
  onEmailLogin: (email: string, password: string) => Promise<void>;
  onEmailRegister: (email: string, password: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
}
```

- [ ] **Step 2: Reescrever o componente LoginLanding com formulário email/senha**

Substituir o conteúdo da coluna direita em `src/components/LoginLanding.tsx`:

```tsx
import React, { useState } from 'react';
import { Sparkles, Search, FileSpreadsheet, Image as ImageIcon, CheckCircle, ArrowRight, ShieldCheck, Zap, Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';

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
              <button onClick={() => { setMode('login'); setError(null); setResetSent(false); }} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 mx-auto">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
            )}
            <h2 className="text-3xl font-black text-gray-900 mb-2">
              {mode === 'login' ? 'Bem-vindo(a)' : mode === 'register' ? 'Criar conta' : 'Recuperar senha'}
            </h2>
            <p className="text-gray-500 text-sm">
              {mode === 'login' ? 'Faça login para acessar suas ferramentas de IA.' : mode === 'register' ? 'Crie sua conta para começar.' : 'Enviaremos um link para redefinir sua senha.'}
            </p>
          </div>

          {resetSent ? (
            <div className="text-center p-6 bg-green-50 rounded-2xl border border-green-200">
              <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-3" />
              <p className="font-bold text-green-900 mb-1">Email enviado!</p>
              <p className="text-sm text-green-700">Verifique sua caixa de entrada e clique no link para redefinir sua senha.</p>
              <button onClick={() => { setMode('login'); setResetSent(false); }} className="mt-4 text-sm text-green-700 underline">Voltar ao login</button>
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
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Enviar link de recuperação'}
                </button>
              </form>

              <div className="mt-4 text-center space-y-2">
                {mode === 'login' && (
                  <>
                    <button onClick={() => { setMode('reset'); setError(null); }} className="text-sm text-blue-600 hover:text-blue-800 transition-colors">
                      Esqueci minha senha
                    </button>
                    <p className="text-sm text-gray-500">
                      Não tem conta?{' '}
                      <button onClick={() => { setMode('register'); setError(null); }} className="font-bold text-blue-600 hover:text-blue-800 transition-colors">
                        Criar conta
                      </button>
                    </p>
                  </>
                )}
                {mode === 'register' && (
                  <p className="text-sm text-gray-500">
                    Já tem conta?{' '}
                    <button onClick={() => { setMode('login'); setError(null); }} className="font-bold text-blue-600 hover:text-blue-800 transition-colors">
                      Fazer login
                    </button>
                  </p>
                )}
              </div>
            </>
          )}

          {mode === 'login' && (
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
```

- [ ] **Step 3: Adicionar handlers de email/senha em App.tsx**

Em `src/App.tsx`, adicionar imports:
```ts
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
```
(já importa de 'firebase/auth', só adicionar as 3 funções)

Adicionar após `handleLogin` (linha ~479):
```ts
const handleEmailLogin = async (email: string, password: string) => {
  await signInWithEmailAndPassword(auth, email, password);
  trackLogin('email');
};

const handleEmailRegister = async (email: string, password: string) => {
  await createUserWithEmailAndPassword(auth, email, password);
  trackLogin('email_register');
};

const handlePasswordReset = async (email: string) => {
  await sendPasswordResetEmail(auth, email);
};
```

- [ ] **Step 4: Atualizar uso de LoginLanding em App.tsx**

Localizar (linha ~2099):
```tsx
return <LoginLanding onLogin={handleLogin} />;
```
Substituir por:
```tsx
return (
  <LoginLanding
    onGoogleLogin={handleLogin}
    onEmailLogin={handleEmailLogin}
    onEmailRegister={handleEmailRegister}
    onPasswordReset={handlePasswordReset}
  />
);
```

- [ ] **Step 5: Validar no browser**

Rodar `npm run dev`, acessar http://localhost:3000. Verificar:
- Botão Google funciona
- Formulário email/senha aparece
- Toggle "Criar conta" / "Esqueci senha" funciona
- Erros de credencial inválida aparecem em pt-BR
- Novo usuário criado com email/senha recebe 10 créditos

- [ ] **Step 6: Commit**

```bash
git add src/components/LoginLanding.tsx src/App.tsx
git commit -m "feat(auth): adiciona login com email/senha via Firebase Auth"
```

---

### Task 2: Módulo condicional de vídeo + persistência do jobId no Firestore

**Files:**
- Modify: `src/App.tsx` (ler `modules.video`, callback `onVideoJobStarted`, prop `hasVideoModule`)
- Modify: `src/components/modals/ProductEditModal.tsx` (prop `hasVideoModule`, esconder tab vídeo)
- Modify: `src/components/modals/VideoGenerationTab.tsx` (chamar `onVideoJobStarted` quando job inicia)

**Interfaces:**
- `hasVideoModule: boolean` — prop nova em ProductEditModal
- `onVideoJobStarted?: (productId: string, jobId: string) => void` — prop nova em VideoGenerationTab

- [ ] **Step 1: Ler modules.video no onSnapshot de App.tsx**

No `onSnapshot` (linha ~327):
```ts
unsubscribeCredits = onSnapshot(userRef, (snap) => {
  if (snap.exists()) {
    setCredits(snap.data().credits ?? 0);
    setHasContentAgent(snap.data().modules?.contentAgent === true);
    setHasVideoModule(snap.data().modules?.video === true); // ADICIONAR
  }
});
```

Adicionar estado no topo do componente App (junto com `hasContentAgent`):
```ts
const [hasVideoModule, setHasVideoModule] = useState<boolean>(false);
```

- [ ] **Step 2: Callback onVideoJobStarted em App.tsx**

Adicionar função de persistência no Firestore após `handleLogin` (junto com outros handlers de produto):
```ts
const handleVideoJobStarted = async (productId: string, jobId: string) => {
  // Atualiza memória local imediatamente
  setProducts((prev) =>
    prev.map((p) =>
      p._id === productId
        ? { ...p, _videoJobId: jobId, _videoStatus: 'queued' as const }
        : p,
    ),
  );
  // Persiste no Firestore para sobreviver ao reload
  if (user) {
    const productRef = doc(db, `users/${user.uid}/products/${productId}`);
    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(productRef, { _videoJobId: jobId, _videoStatus: 'queued' });
    } catch (err) {
      console.error('Erro ao persistir jobId do vídeo:', err);
    }
  }
};
```

Nota: `updateDoc` já pode estar nos imports. Verificar e adicionar se necessário na linha 11:
```ts
import { collection, doc, writeBatch, getDocs, setDoc, getDoc, deleteDoc, getDocFromServer, runTransaction, onSnapshot, updateDoc } from 'firebase/firestore';
```

- [ ] **Step 3: Passar hasVideoModule e onVideoJobStarted para ProductEditModal**

Localizar o JSX do ProductEditModal (~linha 3043). Adicionar as 2 props:
```tsx
<ProductEditModal
  ...props existentes...
  hasVideoModule={hasVideoModule}
  onVideoJobStarted={handleVideoJobStarted}
  onVideoGenerated={(productId, videoUrl, jobId) => {
    setProducts((prev) =>
      prev.map((p) =>
        p._id === productId
          ? { ...p, _videoUrl: videoUrl, _videoJobId: jobId, _videoStatus: 'done' as const }
          : p,
      ),
    );
  }}
/>
```

- [ ] **Step 4: Adicionar props em ProductEditModal**

Em `src/components/modals/ProductEditModal.tsx`, na interface `ProductEditModalProps` (~linha 213):
```ts
interface ProductEditModalProps {
  ...props existentes...
  hasVideoModule?: boolean;
  onVideoJobStarted?: (productId: string, jobId: string) => void;
}
```

Na desestruturação da função (~linha 229), adicionar:
```ts
export default function ProductEditModal({
  ...params existentes...,
  hasVideoModule = false,
  onVideoJobStarted,
}: ProductEditModalProps) {
```

- [ ] **Step 5: Esconder tab vídeo se módulo desativado**

Na lista `tabs` (~linha 492):
```ts
const tabs = [
  { id: 'geral', label: 'Geral', icon: Layout, done: false },
  { id: 'atributos', label: 'Atributos', icon: Tag, done: statusFlags.atributosGerados },
  { id: 'ia', label: 'Conteúdo', icon: Sparkles, done: statusFlags.descricaoGerada },
  { id: 'imagem', label: 'Imagens', icon: ImageIcon, done: statusFlags.imagensGeradas },
  ...(hasVideoModule ? [{ id: 'video' as const, label: 'Vídeo', icon: Video, done: !!editedProduct._videoUrl }] : []),
  { id: 'simular', label: 'Simular Produto', icon: Eye, done: false },
] as const;
```

Atenção: o `as const` com array condicional pode precisar de ajuste de tipo. Usar:
```ts
type TabId = 'geral' | 'atributos' | 'ia' | 'imagem' | 'video' | 'simular';
const tabs: Array<{ id: TabId; label: string; icon: any; done: boolean }> = [
  { id: 'geral', label: 'Geral', icon: Layout, done: false },
  { id: 'atributos', label: 'Atributos', icon: Tag, done: statusFlags.atributosGerados },
  { id: 'ia', label: 'Conteúdo', icon: Sparkles, done: statusFlags.descricaoGerada },
  { id: 'imagem', label: 'Imagens', icon: ImageIcon, done: statusFlags.imagensGeradas },
  ...(hasVideoModule ? [{ id: 'video' as TabId, label: 'Vídeo', icon: Video, done: !!editedProduct._videoUrl }] : []),
  { id: 'simular', label: 'Simular Produto', icon: Eye, done: false },
];
```

- [ ] **Step 6: Passar onVideoJobStarted para VideoGenerationTab**

Localizar onde VideoGenerationTab é usado em ProductEditModal (~linha 1040):
```tsx
{activeTab === 'video' && (
  <VideoGenerationTab
    product={editedProduct}
    uid={uid}
    getIdToken={getIdToken!}
    onVideoGenerated={onVideoGenerated!}
    onNavigateToTab={setActiveTab}
    onVideoJobStarted={onVideoJobStarted}  // ADICIONAR
  />
)}
```

- [ ] **Step 7: Chamar onVideoJobStarted em VideoGenerationTab quando job inicia**

Em `src/components/modals/VideoGenerationTab.tsx`, na interface `VideoGenerationTabProps` (~linha 11):
```ts
export interface VideoGenerationTabProps {
  ...props existentes...
  onVideoJobStarted?: (productId: string, jobId: string) => void;
}
```

Na desestruturação:
```ts
export default function VideoGenerationTab({
  product, uid, getIdToken, onVideoGenerated, onNavigateToTab, onVideoJobStarted,
}: VideoGenerationTabProps) {
```

Em `handleStartJob` (~linha 148), após `setJobId(id)`:
```ts
setJobId(id);
onVideoJobStarted?.(product._id, id);  // ADICIONAR
setStage('generate');
```

- [ ] **Step 8: Validar no browser**

1. Testar com usuário sem `modules.video` no Firestore — tab Vídeo não aparece
2. Setar `modules.video: true` no Firestore Console para um usuário de teste — tab Vídeo aparece
3. Iniciar geração de vídeo, fechar o modal, reabrir o produto — deve mostrar o stage 'generate' com spinner
4. Confirmar que `_videoJobId` foi salvo no Firestore do produto

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/modals/ProductEditModal.tsx src/components/modals/VideoGenerationTab.tsx
git commit -m "feat(video): acesso condicional por módulo e persistência do jobId no Firestore"
```

---

### Task 3: Notificação toast quando vídeo fica pronto

**Files:**
- Modify: `src/App.tsx` (estado `videoReadyNotification`, lógica no `onVideoGenerated`, componente toast inline)

- [ ] **Step 1: Adicionar estado de notificação em App.tsx**

Perto dos outros estados (~linha 209):
```ts
const [videoReadyNotification, setVideoReadyNotification] = useState<{
  productId: string;
  productName: string;
  videoUrl: string;
} | null>(null);
```

- [ ] **Step 2: Disparar notificação em onVideoGenerated**

Localizar o callback `onVideoGenerated` passado para `ProductEditModal` (~linha 3071). Atualizar:
```tsx
onVideoGenerated={(productId, videoUrl, jobId) => {
  const prod = products.find(p => p._id === productId);
  const name = prod?.['Descrição'] ?? prod?.['Título SEO'] ?? 'Produto';
  setVideoReadyNotification({ productId, productName: name, videoUrl });
  // Auto-dismiss após 12 segundos
  setTimeout(() => setVideoReadyNotification(null), 12000);
  setProducts((prev) =>
    prev.map((p) =>
      p._id === productId
        ? { ...p, _videoUrl: videoUrl, _videoJobId: jobId, _videoStatus: 'done' as const }
        : p,
    ),
  );
}}
```

- [ ] **Step 3: Renderizar o toast no JSX de App.tsx**

Logo antes do `</div>` de fechamento final (~final do return), adicionar:
```tsx
{/* Toast: Vídeo pronto */}
{videoReadyNotification && (
  <div className="fixed bottom-6 right-6 z-[200] max-w-sm w-full animate-in slide-in-from-bottom-4 duration-300">
    <div className="bg-white border border-green-200 rounded-2xl shadow-xl p-4 flex items-start gap-3">
      <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.883v6.234a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">Vídeo pronto!</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{videoReadyNotification.productName}</p>
        <button
          onClick={() => {
            const prod = products.find(p => p._id === videoReadyNotification.productId);
            if (prod) {
              setPreviewProduct(prod);
              setPreviewInitialTab('video');
            }
            setVideoReadyNotification(null);
          }}
          className="mt-2 text-xs font-bold text-violet-600 hover:text-violet-800 transition-colors"
        >
          Ver vídeo →
        </button>
      </div>
      <button
        onClick={() => setVideoReadyNotification(null)}
        className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verificar que previewInitialTab é estado existente**

Buscar `previewInitialTab` em App.tsx. Se não existir, verificar como a aba inicial do ProductEditModal é controlada e adaptar. Geralmente é:
```ts
const [previewInitialTab, setPreviewInitialTab] = useState<ProductModalTab>('geral');
```

- [ ] **Step 5: Validar no browser**

Simular vídeo pronto: temporariamente chamar `setVideoReadyNotification({ productId: 'test', productName: 'Produto Teste', videoUrl: '' })` no console do browser, ou aguardar job real completar. Verificar que o toast aparece, "Ver vídeo →" abre o modal na aba correta, e o X fecha o toast.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(video): toast de notificação quando vídeo fica pronto"
```

---

### Task 4: Seletor de Aspect Ratio nas Fotos

**Files:**
- Modify: `src/App.tsx` (estado `defaultAspectRatio` em localStorage, UI nas configurações de imagem)
- Modify: `src/components/ImageSearchModal.tsx` (selector de ratio na UI + passar para generateImage)
- Modify: `src/services/aiService.ts` (aceitar `aspectRatio` em `generateImage` e incluir no prompt)

**Interfaces:**
- `generateImage(base64Data, mimeType, prompt, aspectRatio?: string): Promise<string>` — assinatura atualizada
- `aspectRatio` valores: `'1:1'`, `'4:3'`, `'3:4'`, `'16:9'`, `'9:16'`

- [ ] **Step 1: Atualizar generateImage em aiService.ts para aceitar aspectRatio**

Em `src/services/aiService.ts`, linha 145, atualizar a assinatura:
```ts
export async function generateImage(base64Data: string, mimeType: string, prompt: string, aspectRatio: string = '1:1'): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: IMAGE_MODEL,
    generationConfig: {
      responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE],
    },
    safetySettings: IMAGE_SAFETY_SETTINGS,
  });

  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const aspectInstruction = `Output the image in ${aspectRatio} aspect ratio.`;
  const fullPrompt = `${prompt}\n\n${aspectInstruction}`;
  
  const result = await withRetry(() =>
    model.generateContent([
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: cleanBase64 } },
      { text: fullPrompt },
    ] as any),
  );

  const imageData = extractImage(result);
  if (!imageData) throw new Error('O modelo não retornou uma imagem. Tente novamente.');
  return `data:image/png;base64,${imageData}`;
}
```

- [ ] **Step 2: Estado defaultAspectRatio em App.tsx**

Perto dos outros estados de settings (~linha 709):
```ts
const [defaultAspectRatio, setDefaultAspectRatio] = useState<string>(
  () => localStorage.getItem('defaultAspectRatio') ?? '1:1'
);

useEffect(() => {
  localStorage.setItem('defaultAspectRatio', defaultAspectRatio);
}, [defaultAspectRatio]);
```

- [ ] **Step 3: UI de seleção de aspect ratio nas Configurações (aba Imagens)**

Em App.tsx, localizar `{settingsTab === 'images' && (` (~linha 3222). No início do `<div className="max-w-2xl space-y-6">`, adicionar ANTES do checkbox existente:

```tsx
{/* Aspect Ratio Padrão */}
<div>
  <label className="block text-sm font-bold text-gray-900 mb-1">Aspecto Ratio Padrão das Imagens</label>
  <p className="text-xs text-gray-500 mb-3">Define o formato padrão das fotos ambientadas geradas. Pode ser alterado individualmente em cada geração.</p>
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
    {[
      { value: '1:1', label: '1:1 — Quadrado', desc: 'Amazon, Shopee, Mercado Livre' },
      { value: '4:3', label: '4:3 — Paisagem', desc: 'Marketplace tradicional, banners' },
      { value: '3:4', label: '3:4 — Retrato', desc: 'Mobile-first, Pinterest, Moda' },
      { value: '16:9', label: '16:9 — Wide', desc: 'Banners, hero images' },
      { value: '9:16', label: '9:16 — Vertical', desc: 'Stories, Reels, TikTok' },
    ].map(({ value, label, desc }) => (
      <button
        key={value}
        type="button"
        onClick={() => setDefaultAspectRatio(value)}
        className={`p-3 rounded-xl border-2 text-left transition-all ${
          defaultAspectRatio === value
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300 bg-white'
        }`}
      >
        <p className={`text-sm font-bold ${defaultAspectRatio === value ? 'text-blue-700' : 'text-gray-900'}`}>{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </button>
    ))}
  </div>
</div>

<hr className="border-gray-100" />
```

- [ ] **Step 4: Passar defaultAspectRatio para ImageSearchModal**

Localizar uso de `<ImageSearchModal` em App.tsx (~linha 3520). Adicionar prop:
```tsx
<ImageSearchModal
  ...props existentes...
  defaultAspectRatio={defaultAspectRatio}
/>
```

- [ ] **Step 5: Atualizar ImageSearchModalProps e adicionar selector**

Em `src/components/ImageSearchModal.tsx`, na interface (~linha 13):
```ts
interface ImageSearchModalProps {
  ...props existentes...
  defaultAspectRatio?: string;
}
```

No componente, adicionar estado de aspect ratio:
```ts
export default function ImageSearchModal({ ..., defaultAspectRatio = '1:1' }: ImageSearchModalProps) {
  ...
  const [aspectRatio, setAspectRatio] = useState<string>(defaultAspectRatio);
  ...
```

- [ ] **Step 6: Adicionar selector de ratio na UI de geração do ImageSearchModal**

Localizar onde as imagens ambientadas são geradas/exibidas no ImageSearchModal. Adicionar ANTES do botão de gerar imagens (buscar por "Gerar" ou "generate" no componente):

```tsx
{/* Aspect Ratio Selector */}
<div className="mb-4">
  <div className="flex items-center gap-2 mb-2">
    <label className="text-sm font-bold text-gray-800">Formato da imagem</label>
    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
      Padrão configurável em Configurações → Imagens
    </span>
  </div>
  <div className="flex flex-wrap gap-2">
    {[
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
    ].map(({ value, label }) => (
      <button
        key={value}
        type="button"
        onClick={() => setAspectRatio(value)}
        className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
          aspectRatio === value
            ? 'border-blue-500 bg-blue-600 text-white'
            : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 7: Usar aspectRatio nas chamadas a generateImage**

Em todas as chamadas a `generateImage` dentro de `ImageSearchModal.tsx`, adicionar o parâmetro `aspectRatio`:
```ts
const result = await generateImage(base64Data, mimeType, prompt, aspectRatio);
```

Buscar todas as chamadas a `generateImage(` no arquivo e adicionar o parâmetro.

- [ ] **Step 8: Validar no browser**

1. Abrir Configurações → Imagens — verificar seletor de aspect ratio com 5 opções, padrão 1:1
2. Mudar para 3:4, fechar configurações, abrir ImageSearchModal de um produto com imagem
3. Verificar que o modal mostra o ratio 3:4 selecionado e a hint "Padrão configurável em Configurações → Imagens"
4. Gerar uma imagem e confirmar que a imagem gerada tem proporção diferente de 1:1 (resultado pode variar — o modelo pode não respeitar exatamente, mas o prompt é enviado)

- [ ] **Step 9: Commit**

```bash
git add src/services/aiService.ts src/App.tsx src/components/ImageSearchModal.tsx
git commit -m "feat(fotos): seletor de aspect ratio com padrão configurável nas imagens"
```
