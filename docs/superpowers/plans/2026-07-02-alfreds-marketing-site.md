# Alfreds — Site de Marketing + Nova Entrada do App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um site de marketing público (home + páginas dos dois agentes + preços/casos/contato) e uma nova entrada de app (login/cadastro), posicionando o Alfreds como um esquadrão de Agentes de IA para e-commerce.

**Architecture:** SPA React 19 + Vite existente ganha `react-router-dom`. Rotas públicas (`/`, `/agente-de-produto`, `/agente-de-conteudo`, `/precos`, `/casos`, `/contato`, `/entrar`) são servidas para visitantes; o app autenticado atual continua atrás de uma guarda de rota. Todo o marketing vive em `src/marketing/` com componentes reutilizáveis parametrizados por tema (produto/conteúdo/marca). Design tokens da paleta oficial entram no `@theme` do Tailwind v4.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4 (`@theme` em `src/index.css`), `react-router-dom` (novo), Firebase Auth/Firestore (existente), lucide-react (ícones, existente), Bricolage Grotesque + Inter (fontes existentes).

## Global Constraints

- **Idioma:** todo texto de UI, copy e nomes de campo em **pt-BR**.
- **Sem testes automatizados no projeto.** Verificação de cada task = `npm run lint` (que é `tsc --noEmit`) sem erros **+** verificação visual no browser via dev server (`npm run dev`, porta 3000). Nunca alegar "funciona" sem rodar o typecheck e olhar a tela.
- **Paleta oficial (verbatim):** porcelana `#E8E0D5`, ink `#141311`, laranja `#FF5B03`, azul `#3053FF`, periwinkle `#828ED1`.
- **Cor por agente:** Agente de Produto = laranja `#FF5B03` + `logo-alfreds-produtos.png`; Agente de Conteúdo = preto `#141311` + `logo-alfreds-conteudo.png`.
- **`--color-primary` migra de `#004ac6` para `#FF5B03`** (site e app interno usam o mesmo padrão).
- **Copy:** falar sempre de "agentes que trabalham por você", nunca "funcionalidades de um software". Nomear os dois agentes com suas cores. Reservar espaço "novos agentes em breve". Prova em número quando possível.
- **Cases = placeholders honestos** ("exemplo ilustrativo"). **Sem faixa de logos de clientes.**
- **Fontes:** display = `font-display` (Bricolage Grotesque, já configurada); corpo = Inter.
- **Não quebrar o app autenticado existente** ao introduzir o router.
- Spec de referência: `docs/superpowers/specs/2026-07-02-alfreds-marketing-site-design.md`.

---

## File Structure

**Criar:**
- `src/assets/brand/logo-alfreds-produtos.png` — logo laranja (copiado de Downloads)
- `src/assets/brand/logo-alfreds-conteudo.png` — logo preto (copiado de Downloads)
- `src/marketing/theme.ts` — tokens de tema por agente (cores, logo) + tipos
- `src/marketing/components/MarketingNav.tsx`
- `src/marketing/components/MarketingFooter.tsx`
- `src/marketing/components/Hero.tsx`
- `src/marketing/components/AgentCard.tsx`
- `src/marketing/components/HowItWorks.tsx`
- `src/marketing/components/FeatureShowcase.tsx` — lista numerada + screenshot sincronizado
- `src/marketing/components/SegmentGrid.tsx`
- `src/marketing/components/CaseCard.tsx`
- `src/marketing/components/IntegrationsGrid.tsx`
- `src/marketing/components/PricingSummary.tsx`
- `src/marketing/components/TrustSection.tsx`
- `src/marketing/components/FAQ.tsx`
- `src/marketing/components/FinalCTA.tsx`
- `src/marketing/components/Section.tsx` — wrapper de seção (fundo claro/escuro, padding)
- `src/marketing/pages/HomePage.tsx`
- `src/marketing/pages/ProductAgentPage.tsx`
- `src/marketing/pages/ContentAgentPage.tsx`
- `src/marketing/pages/PricingPage.tsx`
- `src/marketing/pages/CasesPage.tsx`
- `src/marketing/pages/ContactPage.tsx`
- `src/marketing/pages/AuthPage.tsx` — nova entrada (envolve a lógica de auth)
- `src/marketing/content.ts` — todo o copy/dados (features, FAQ, cases placeholder, segmentos)
- `src/marketing/leadService.ts` — grava lead de contato no Firestore

**Modificar:**
- `src/index.css` — tokens de cor no `@theme`, migrar `--color-primary`
- `src/App.tsx` — extrair o app autenticado e envolver tudo em rotas
- `src/main.tsx` — envolver `<App/>` em `<BrowserRouter>`
- `index.html` — `<title>`/meta description alinhados à nova marca
- `package.json` — dependência `react-router-dom`

**Remover (ao final, após migração):**
- `src/components/LoginLanding.tsx` — substituído por `AuthPage.tsx` (só remover quando `AuthPage` estiver em produção)

---

## Task 1: Dependência de roteamento + assets de marca

**Files:**
- Modify: `package.json`
- Create: `src/assets/brand/logo-alfreds-produtos.png`, `src/assets/brand/logo-alfreds-conteudo.png`

**Interfaces:**
- Produces: `react-router-dom` disponível; imports `@/assets/brand/*.png` resolvíveis pelo Vite.

- [ ] **Step 1: Instalar react-router-dom**

```bash
cd /Users/rafaelscala/omni360-description
npm install react-router-dom
```

- [ ] **Step 2: Copiar os logos para dentro do projeto**

```bash
mkdir -p src/assets/brand
cp "/Users/rafaelscala/Downloads/Alfreds Logo/logo-alfreds-produtos.png" src/assets/brand/logo-alfreds-produtos.png
cp "/Users/rafaelscala/Downloads/Alfreds Logo/logo-alfreds-conteudo.png" src/assets/brand/logo-alfreds-conteudo.png
```

- [ ] **Step 3: Verificar que os arquivos existem**

Run: `ls -la src/assets/brand/`
Expected: os dois `.png` listados com tamanho > 0.

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: sem erros (a lib traz seus próprios tipos).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/assets/brand/
git commit -m "chore(marketing): add react-router-dom e assets de marca"
```

---

## Task 2: Design tokens da paleta oficial

**Files:**
- Modify: `src/index.css:5-11`

**Interfaces:**
- Produces: classes Tailwind `bg-porcelain`, `bg-ink`, `text-orange`, `bg-orange`, `text-blue`, `bg-periwinkle` etc.; `--color-primary` = laranja.

- [ ] **Step 1: Substituir o bloco `@theme`**

Em `src/index.css`, trocar o bloco `@theme { ... }` por:

```css
@theme {
  --color-primary: #FF5B03;
  --color-porcelain: #E8E0D5;
  --color-ink: #141311;
  --color-orange: #FF5B03;
  --color-blue: #3053FF;
  --color-periwinkle: #828ED1;
  --color-sidebar: #141311;
  --color-sidebar-active: #26221d;
  --color-surface-bg: #f7f9fb;
  --font-display: "Bricolage Grotesque", "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Verificação visual do app existente**

Run: `npm run dev` e abrir `http://localhost:3000`. Fazer login e conferir que os elementos que usavam `primary`/`sidebar` agora aparecem em laranja/ink sem quebra de legibilidade evidente. Anotar telas onde o laranja prejudica leitura (ajuste fino fica na Task 12).
Expected: app carrega, cores novas aplicadas, nada ilegível.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(marketing): tokens de cor da paleta oficial + primary laranja"
```

---

## Task 3: Tema por agente (`theme.ts`)

**Files:**
- Create: `src/marketing/theme.ts`

**Interfaces:**
- Produces:
  - `type AgentTheme = 'product' | 'content' | 'brand'`
  - `interface ThemeTokens { name: string; accent: string; accentClass: string; onAccentClass: string; bgClass: string; textClass: string; logo: string; }`
  - `const THEMES: Record<AgentTheme, ThemeTokens>`
  - `function getTheme(t: AgentTheme): ThemeTokens`

- [ ] **Step 1: Criar o arquivo**

```typescript
import logoProduto from '@/assets/brand/logo-alfreds-produtos.png';
import logoConteudo from '@/assets/brand/logo-alfreds-conteudo.png';

export type AgentTheme = 'product' | 'content' | 'brand';

export interface ThemeTokens {
  /** Nome de exibição do contexto */
  name: string;
  /** Hex do acento */
  accent: string;
  /** Classe de fundo do acento (botões cheios) */
  accentBgClass: string;
  /** Classe de texto do acento */
  accentTextClass: string;
  /** Classe de texto legível sobre o acento */
  onAccentClass: string;
  /** Logo apropriado para o contexto */
  logo: string;
}

export const THEMES: Record<AgentTheme, ThemeTokens> = {
  brand: {
    name: 'Alfreds',
    accent: '#FF5B03',
    accentBgClass: 'bg-orange',
    accentTextClass: 'text-orange',
    onAccentClass: 'text-white',
    logo: logoProduto,
  },
  product: {
    name: 'Agente de Produto',
    accent: '#FF5B03',
    accentBgClass: 'bg-orange',
    accentTextClass: 'text-orange',
    onAccentClass: 'text-white',
    logo: logoProduto,
  },
  content: {
    name: 'Agente de Conteúdo',
    accent: '#141311',
    accentBgClass: 'bg-ink',
    accentTextClass: 'text-ink',
    onAccentClass: 'text-white',
    logo: logoConteudo,
  },
};

export function getTheme(t: AgentTheme): ThemeTokens {
  return THEMES[t];
}
```

- [ ] **Step 2: Confirmar alias `@`**

Run: `grep -n "@" vite.config.ts tsconfig.json`
Expected: existe alias `@ -> src`. **Se não existir**, adicionar em `vite.config.ts` (`resolve.alias`) e `tsconfig.json` (`compilerOptions.paths`): `"@/*": ["src/*"]`. Se preferir não configurar alias, usar imports relativos (`../assets/...`) em todos os arquivos deste plano.

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: sem erros (imports de png exigem que `src/vite-env.d.ts` declare módulos de imagem — Vite já declara via `vite/client`; confirmar que `vite-env.d.ts` tem `/// <reference types="vite/client" />`).

- [ ] **Step 4: Commit**

```bash
git add src/marketing/theme.ts
git commit -m "feat(marketing): tokens de tema por agente"
```

---

## Task 4: Wrapper de seção + roteamento base (esqueleto navegável)

Esta task extrai o app autenticado atual e cria o esqueleto de rotas com páginas vazias, para tudo compilar e navegar antes de encher as seções.

**Files:**
- Modify: `src/App.tsx:2193-2195` (troca do `LoginLanding` por `<Outlet/>`-driven), `src/main.tsx`
- Create: `src/marketing/components/Section.tsx`, `src/marketing/pages/HomePage.tsx` (stub), demais páginas stub, `src/marketing/MarketingLayout.tsx`

**Interfaces:**
- Consumes: `getTheme` da Task 3.
- Produces:
  - `Section` component: `{ tone?: 'light' | 'dark'; id?: string; className?: string; children }`
  - Rotas registradas; app autenticado preservado sob guarda.

- [ ] **Step 1: Criar `Section.tsx`**

```tsx
import React from 'react';

interface SectionProps {
  tone?: 'light' | 'dark';
  id?: string;
  className?: string;
  children: React.ReactNode;
}

/** Faixa de conteúdo full-width com fundo claro (porcelana) ou escuro (ink). */
export default function Section({ tone = 'light', id, className = '', children }: SectionProps) {
  const toneClass = tone === 'dark' ? 'bg-ink text-porcelain' : 'bg-porcelain text-ink';
  return (
    <section id={id} className={`w-full ${toneClass} ${className}`}>
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Criar stubs de páginas**

Criar cada arquivo em `src/marketing/pages/` com um stub mínimo (repetir o padrão trocando o nome):

```tsx
// HomePage.tsx (e análogos: ProductAgentPage, ContentAgentPage, PricingPage, CasesPage, ContactPage)
export default function HomePage() {
  return <div className="p-10 font-display text-2xl">HomePage (stub)</div>;
}
```

- [ ] **Step 3: Criar `MarketingLayout.tsx`** (nav + outlet + footer virão nas próximas tasks; por ora só o outlet)

```tsx
import { Outlet } from 'react-router-dom';

export default function MarketingLayout() {
  return (
    <div className="min-h-screen bg-porcelain text-ink font-sans">
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 4: Envolver App em Router no `main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 5: Introduzir rotas no `App.tsx`**

Localizar o gate `if (!user) { return <LoginLanding .../> }` (por volta de `src/App.tsx:2193`). Extrair todo o JSX do app autenticado (o `return (...)` grande) para um componente interno `AuthenticatedApp` (mesmo arquivo) e substituir o corpo do `return` de `App` por rotas:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import MarketingLayout from './marketing/MarketingLayout';
import HomePage from './marketing/pages/HomePage';
import ProductAgentPage from './marketing/pages/ProductAgentPage';
import ContentAgentPage from './marketing/pages/ContentAgentPage';
import PricingPage from './marketing/pages/PricingPage';
import CasesPage from './marketing/pages/CasesPage';
import ContactPage from './marketing/pages/ContactPage';
import AuthPage from './marketing/pages/AuthPage'; // criado na Task 11; usar LoginLanding temporariamente se ainda não existir

// Dentro do componente App, após todos os hooks:
if (!isAuthReady) {
  return /* ...loading atual inalterado... */;
}

return (
  <Routes>
    <Route element={<MarketingLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/agente-de-produto" element={<ProductAgentPage />} />
      <Route path="/agente-de-conteudo" element={<ContentAgentPage />} />
      <Route path="/precos" element={<PricingPage />} />
      <Route path="/casos" element={<CasesPage />} />
      <Route path="/contato" element={<ContactPage />} />
    </Route>
    <Route path="/entrar" element={user ? <Navigate to="/app" replace /> : <AuthPageOrLogin />} />
    <Route path="/app/*" element={user ? <AuthenticatedApp /* props existentes */ /> : <Navigate to="/entrar" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
```

Notas de execução:
- `AuthenticatedApp` recebe via props (ou closure, já que é componente interno no mesmo escopo) todo o estado/handlers que o JSX extraído usa. Mais simples: manter `AuthenticatedApp` como função interna que fecha sobre as variáveis do `App` (sem props), preservando o comportamento atual.
- Enquanto `AuthPage` (Task 11) não existe, definir `AuthPageOrLogin` = a `LoginLanding` atual, adaptando os callbacks já presentes no `App`. Na Task 11 troca-se por `AuthPage`.
- Ajustar qualquer redirect pós-login existente para `navigate('/app')`.

- [ ] **Step 6: Typecheck**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 7: Verificação visual (navegação)**

Run: `npm run dev`. Visitar deslogado: `/`, `/precos`, `/agente-de-produto` → mostram os stubs. Visitar `/app` deslogado → redireciona a `/entrar`. Logar → cai em `/app` com o app atual funcionando. 
Expected: rotas públicas abrem; app autenticado intacto; sem loop de redirect.

- [ ] **Step 8: Commit**

```bash
git add src/main.tsx src/App.tsx src/marketing/
git commit -m "feat(marketing): roteamento base + esqueleto de páginas"
```

---

## Task 5: Nav e Footer de marketing

**Files:**
- Create: `src/marketing/components/MarketingNav.tsx`, `src/marketing/components/MarketingFooter.tsx`
- Modify: `src/marketing/MarketingLayout.tsx`

**Interfaces:**
- Consumes: `getTheme('brand')`.
- Produces: `MarketingNav`, `MarketingFooter` (sem props); usados pelo layout.

- [ ] **Step 1: Criar `MarketingNav.tsx`**

```tsx
import { Link, NavLink } from 'react-router-dom';
import { getTheme } from '../theme';

const links = [
  { to: '/agente-de-produto', label: 'Agente de Produto' },
  { to: '/agente-de-conteudo', label: 'Agente de Conteúdo' },
  { to: '/precos', label: 'Preços' },
  { to: '/casos', label: 'Casos' },
];

export default function MarketingNav() {
  const brand = getTheme('brand');
  return (
    <header className="sticky top-0 z-40 bg-porcelain/90 backdrop-blur border-b border-ink/10">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-center">
          <img src={brand.logo} alt="Alfreds" className="h-7 w-auto" />
        </Link>
        <ul className="hidden md:flex items-center gap-6 text-sm font-medium">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} className={({ isActive }) => `hover:text-orange transition-colors ${isActive ? 'text-orange' : 'text-ink/70'}`}>
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Link to="/entrar" className="text-sm font-semibold text-ink/80 hover:text-ink">Entrar</Link>
          <Link to="/entrar" className="text-sm font-bold px-4 py-2 rounded-xl bg-orange text-white hover:brightness-95 transition">Começar grátis</Link>
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Criar `MarketingFooter.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { getTheme } from '../theme';

export default function MarketingFooter() {
  const brand = getTheme('content'); // logo preto sobre fundo claro do footer
  return (
    <footer className="bg-porcelain border-t border-ink/10">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-8 md:grid-cols-4 text-sm">
        <div className="md:col-span-2">
          <img src={brand.logo} alt="Alfreds" className="h-8 w-auto mb-3" />
          <p className="text-ink/60 max-w-xs">Um esquadrão de Agentes de IA que trabalham pelo seu e-commerce.</p>
        </div>
        <div>
          <p className="font-bold mb-3">Agentes</p>
          <ul className="space-y-2 text-ink/70">
            <li><Link to="/agente-de-produto" className="hover:text-orange">Agente de Produto</Link></li>
            <li><Link to="/agente-de-conteudo" className="hover:text-orange">Agente de Conteúdo</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-bold mb-3">Empresa</p>
          <ul className="space-y-2 text-ink/70">
            <li><Link to="/precos" className="hover:text-orange">Preços</Link></li>
            <li><Link to="/casos" className="hover:text-orange">Casos</Link></li>
            <li><Link to="/contato" className="hover:text-orange">Contato</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink/10 py-6 text-center text-xs text-ink/50">
        © {new Date().getFullYear()} Alfreds. Todos os direitos reservados.
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Inserir no layout**

Em `MarketingLayout.tsx`, envolver `<Outlet/>` com `<MarketingNav/>` acima e `<MarketingFooter/>` abaixo.

- [ ] **Step 4: Typecheck + visual**

Run: `npm run lint` (sem erros) e `npm run dev` → nav sticky com logo laranja, links, CTA laranja; footer com logo preto. Navegação entre páginas funciona.

- [ ] **Step 5: Commit**

```bash
git add src/marketing/
git commit -m "feat(marketing): nav sticky e footer"
```

---

## Task 6: Conteúdo/dados centralizados (`content.ts`)

Centraliza todo o copy para as seções (DRY), aplicando as regras de copy do Global Constraints.

**Files:**
- Create: `src/marketing/content.ts`

**Interfaces:**
- Produces (usados pelas Tasks 7–11):
  - `interface FeatureItem { title: string; description: string; screenshot?: string; }`
  - `interface FaqItem { q: string; a: string; }`
  - `interface CaseItem { metric: string; label: string; description: string; }`
  - `interface SegmentItem { title: string; pain: string; }`
  - `const productFeatures: FeatureItem[]`
  - `const contentFeatures: FeatureItem[]`
  - `const homeFaq: FaqItem[]`
  - `const cases: CaseItem[]`
  - `const segments: SegmentItem[]`
  - `const howItWorks: { step: number; title: string; description: string }[]`

- [ ] **Step 1: Criar `content.ts`**

```typescript
export interface FeatureItem { title: string; description: string; screenshot?: string; }
export interface FaqItem { q: string; a: string; }
export interface CaseItem { metric: string; label: string; description: string; }
export interface SegmentItem { title: string; pain: string; }

export const howItWorks = [
  { step: 1, title: 'Conecte', description: 'Suba sua planilha, informe um EAN ou aponte o site da sua loja. Sem integração complicada.' },
  { step: 2, title: 'Os agentes trabalham', description: 'O Agente de Produto e o Agente de Conteúdo executam o trabalho pesado enquanto você cuida de vender.' },
  { step: 3, title: 'Pronto para vender', description: 'Catálogo enriquecido, com SEO, imagens, vídeos e conteúdo que ranqueia — pronto para publicar.' },
];

export const productFeatures: FeatureItem[] = [
  { title: 'Enriquecimento de dados', description: 'O agente busca GTIN/EAN, NCM, peso e dimensões reais e completa o cadastro por você.' },
  { title: 'SEO automático', description: 'Título, descrição e palavras-chave otimizados para o Google, no seu tom de marca.' },
  { title: 'Ambientação de imagens', description: 'Gera fotos realistas do produto em cenários profissionais e lifestyle.' },
  { title: 'Geração de vídeo', description: 'Cria vídeos curtos do produto para acelerar a conversão.' },
  { title: 'Categorias e integrações', description: 'Organiza a árvore de categorias e sincroniza com a sua plataforma (ex.: Wake).' },
];

export const contentFeatures: FeatureItem[] = [
  { title: 'Perfil da marca', description: 'O agente entende seu negócio, tom de voz e público a partir do seu site.' },
  { title: 'Mapa de autoridade', description: 'Descobre os temas que a sua marca precisa dominar para ganhar tráfego.' },
  { title: 'Clusters de conteúdo', description: 'Estrutura pautas em clusters pilar-e-satélite com links internos.' },
  { title: 'Produção de artigos', description: 'Escreve artigos otimizados para SEO respeitando a voz da sua marca.' },
  { title: 'Calendário editorial', description: 'Planeja e agenda a produção para manter consistência sem esforço.' },
];

export const segments: SegmentItem[] = [
  { title: 'Loja online', description: 'Catálogo grande, tempo curto: os agentes cadastram e enriquecem em escala.', pain: 'Catálogo grande, tempo curto: os agentes cadastram e enriquecem em escala.' } as unknown as SegmentItem,
  { title: 'Marketplace / Seller', pain: 'Padronize dados e conteúdo para performar em cada canal de venda.' },
  { title: 'Indústria', pain: 'Transforme fichas técnicas em cadastros e conteúdo prontos para o varejo.' },
];

export const cases: CaseItem[] = [
  { metric: '—', label: 'Tempo de cadastro', description: 'Exemplo ilustrativo — substituir por caso real quando disponível.' },
  { metric: '—', label: 'Itens processados', description: 'Exemplo ilustrativo — substituir por caso real quando disponível.' },
  { metric: '—', label: 'Ganho de conversão', description: 'Exemplo ilustrativo — substituir por caso real quando disponível.' },
];

export const homeFaq: FaqItem[] = [
  { q: 'O que é o Alfreds?', a: 'É um esquadrão de Agentes de IA para e-commerce. Hoje temos o Agente de Produto e o Agente de Conteúdo, e novos agentes estão a caminho.' },
  { q: 'Preciso de cartão para começar?', a: 'Não. Novos usuários recebem 10 créditos grátis para testar os agentes.' },
  { q: 'Como funciona a cobrança?', a: 'Por créditos: cada operação de IA consome uma quantidade de créditos. Você compra pacotes conforme o uso.' },
  { q: 'Meus dados ficam seguros?', a: 'Sim. As chaves de IA ficam no servidor e seus dados não são compartilhados com terceiros.' },
  { q: 'Com quais plataformas integra?', a: 'Importação por planilha/Excel, EAN e integração com plataformas como a Wake.' },
  { q: 'Vou perder o controle do conteúdo?', a: 'Não. Os agentes trabalham no seu tom de marca e você revisa e aprova antes de publicar.' },
];
```

> Nota: corrigir o item `segments[0]` para o formato `{ title, pain }` limpo ao escrever (o cast acima é só ilustrativo do risco — usar `{ title: 'Loja online', pain: 'Catálogo grande, tempo curto: os agentes cadastram e enriquecem em escala.' }`).

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: sem erros. Garantir que `segments` seja `SegmentItem[]` sem casts.

- [ ] **Step 3: Commit**

```bash
git add src/marketing/content.ts
git commit -m "feat(marketing): copy e dados centralizados"
```

---

## Task 7: Componentes reutilizáveis de seção (parte 1 — Hero, AgentCard, HowItWorks, FinalCTA)

**Files:**
- Create: `src/marketing/components/Hero.tsx`, `AgentCard.tsx`, `HowItWorks.tsx`, `FinalCTA.tsx`

**Interfaces:**
- Consumes: `getTheme`, `AgentTheme` (Task 3); `howItWorks` (Task 6); `Section` (Task 4).
- Produces:
  - `Hero`: `{ theme?: AgentTheme; eyebrow?: string; titleLead: string; titleAccent: string; titleTail?: string; subtitle: string; primaryCta: {label:string; to:string}; secondaryCta?: {label:string; to:string}; microcopy?: string; }`
  - `AgentCard`: `{ theme: 'product'|'content'; title: string; description: string; to: string; }`
  - `HowItWorks`: sem props (usa `howItWorks`)
  - `FinalCTA`: `{ theme?: AgentTheme; title: string; ctaLabel: string; ctaTo: string; }`

- [ ] **Step 1: `Hero.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { AgentTheme, getTheme } from '../theme';

interface HeroProps {
  theme?: AgentTheme;
  eyebrow?: string;
  titleLead: string;
  titleAccent: string;
  titleTail?: string;
  subtitle: string;
  primaryCta: { label: string; to: string };
  secondaryCta?: { label: string; to: string };
  microcopy?: string;
}

export default function Hero({ theme = 'brand', eyebrow, titleLead, titleAccent, titleTail, subtitle, primaryCta, secondaryCta, microcopy }: HeroProps) {
  const t = getTheme(theme);
  const dark = theme === 'content';
  return (
    <section className={`relative overflow-hidden ${dark ? 'bg-ink text-porcelain' : 'bg-porcelain text-ink'}`}>
      <div className="max-w-5xl mx-auto px-6 py-24 md:py-32 text-center">
        {eyebrow && <span className={`inline-block mb-5 text-xs font-bold uppercase tracking-widest ${t.accentTextClass}`}>{eyebrow}</span>}
        <h1 className="font-display font-extrabold tracking-tight text-4xl md:text-6xl leading-[1.05]">
          {titleLead} <span className={t.accentTextClass}>{titleAccent}</span>{titleTail ? ` ${titleTail}` : ''}
        </h1>
        <p className={`mt-6 text-lg md:text-xl max-w-2xl mx-auto ${dark ? 'text-porcelain/70' : 'text-ink/70'}`}>{subtitle}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to={primaryCta.to} className={`px-6 py-3.5 rounded-xl font-bold ${t.accentBgClass} ${t.onAccentClass} hover:brightness-95 transition`}>{primaryCta.label}</Link>
          {secondaryCta && (
            <Link to={secondaryCta.to} className={`px-6 py-3.5 rounded-xl font-bold border ${dark ? 'border-porcelain/30 text-porcelain hover:bg-porcelain/10' : 'border-ink/20 text-ink hover:bg-ink/5'} transition`}>{secondaryCta.label}</Link>
          )}
        </div>
        {microcopy && <p className={`mt-4 text-sm ${dark ? 'text-porcelain/50' : 'text-ink/50'}`}>{microcopy}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: `AgentCard.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { getTheme } from '../theme';
import { ArrowRight } from 'lucide-react';

interface AgentCardProps {
  theme: 'product' | 'content';
  title: string;
  description: string;
  to: string;
}

export default function AgentCard({ theme, title, description, to }: AgentCardProps) {
  const t = getTheme(theme);
  const dark = theme === 'content';
  return (
    <Link to={to} className={`group block rounded-3xl p-8 border transition hover:-translate-y-1 ${dark ? 'bg-ink text-porcelain border-ink' : 'bg-white text-ink border-orange/30'}`}>
      <img src={t.logo} alt={t.name} className="h-8 w-auto mb-6" />
      <h3 className="font-display text-2xl font-extrabold mb-2">{title}</h3>
      <p className={`${dark ? 'text-porcelain/70' : 'text-ink/60'} mb-6`}>{description}</p>
      <span className={`inline-flex items-center gap-1.5 font-bold ${t.accentTextClass}`}>
        Conhecer o agente <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
      </span>
    </Link>
  );
}
```

Nota: para o Agente de Conteúdo (tema preto sobre fundo escuro), o texto do CTA `text-ink` fica ilegível; usar `text-orange` como acento de leitura em superfícies escuras. Ajuste: quando `dark`, sobrescrever para `text-orange`. Implementar com `const ctaClass = dark ? 'text-orange' : t.accentTextClass;` e usar `ctaClass`.

- [ ] **Step 3: `HowItWorks.tsx`**

```tsx
import { howItWorks } from '../content';

export default function HowItWorks() {
  return (
    <div className="grid gap-8 md:grid-cols-3">
      {howItWorks.map((s) => (
        <div key={s.step} className="relative">
          <div className="w-12 h-12 rounded-2xl bg-orange text-white font-display font-extrabold text-xl flex items-center justify-center mb-4">{s.step}</div>
          <h3 className="font-display text-xl font-bold mb-2">{s.title}</h3>
          <p className="text-ink/60">{s.description}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `FinalCTA.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { AgentTheme, getTheme } from '../theme';

interface FinalCTAProps { theme?: AgentTheme; title: string; ctaLabel: string; ctaTo: string; }

export default function FinalCTA({ theme = 'brand', title, ctaLabel, ctaTo }: FinalCTAProps) {
  const t = getTheme(theme);
  return (
    <div className="text-center">
      <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-8 max-w-2xl mx-auto">{title}</h2>
      <Link to={ctaTo} className={`inline-block px-8 py-4 rounded-xl font-bold text-lg ${t.accentBgClass} ${t.onAccentClass} hover:brightness-95 transition`}>{ctaLabel}</Link>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run lint`
Expected: sem erros. Confirmar que o ajuste `ctaClass` do AgentCard foi aplicado.

- [ ] **Step 6: Commit**

```bash
git add src/marketing/components/
git commit -m "feat(marketing): componentes Hero, AgentCard, HowItWorks, FinalCTA"
```

---

## Task 8: Componentes reutilizáveis de seção (parte 2 — FeatureShowcase, SegmentGrid, CaseCard, IntegrationsGrid, PricingSummary, TrustSection, FAQ)

**Files:**
- Create: `FeatureShowcase.tsx`, `SegmentGrid.tsx`, `CaseCard.tsx`, `IntegrationsGrid.tsx`, `PricingSummary.tsx`, `TrustSection.tsx`, `FAQ.tsx` (todos em `src/marketing/components/`)

**Interfaces:**
- Consumes: `FeatureItem`, `SegmentItem`, `CaseItem`, `FaqItem` (Task 6); `getTheme` (Task 3).
- Produces:
  - `FeatureShowcase`: `{ theme: 'product'|'content'; eyebrow: string; title: string; features: FeatureItem[]; }`
  - `SegmentGrid`: `{ segments: SegmentItem[] }`
  - `CaseCard`: `{ item: CaseItem }`
  - `IntegrationsGrid`: sem props
  - `PricingSummary`: sem props
  - `TrustSection`: sem props
  - `FAQ`: `{ items: FaqItem[] }`

- [ ] **Step 1: `FeatureShowcase.tsx`** (lista numerada + área de screenshot; screenshot pode ser placeholder até a Task 10)

```tsx
import { useState } from 'react';
import { FeatureItem } from '../content';
import { getTheme } from '../theme';

interface FeatureShowcaseProps {
  theme: 'product' | 'content';
  eyebrow: string;
  title: string;
  features: FeatureItem[];
}

export default function FeatureShowcase({ theme, eyebrow, title, features }: FeatureShowcaseProps) {
  const t = getTheme(theme);
  const [active, setActive] = useState(0);
  const dark = theme === 'content';
  const accentText = dark ? 'text-orange' : t.accentTextClass;
  return (
    <div className="grid gap-10 md:grid-cols-2 md:items-center">
      <div>
        <span className={`text-xs font-bold uppercase tracking-widest ${accentText}`}>{eyebrow}</span>
        <h2 className="font-display text-3xl md:text-4xl font-extrabold mt-3 mb-8">{title}</h2>
        <ul className="space-y-1">
          {features.map((f, i) => (
            <li key={f.title}>
              <button
                onClick={() => setActive(i)}
                className={`w-full text-left py-4 border-t ${dark ? 'border-porcelain/15' : 'border-ink/10'} ${i === active ? '' : 'opacity-60 hover:opacity-100'} transition`}
              >
                <p className="font-display font-bold text-lg flex items-center gap-3">
                  <span className={accentText}>{String(i + 1).padStart(2, '0')}</span> {f.title}
                </p>
                {i === active && <p className={`mt-2 ${dark ? 'text-porcelain/70' : 'text-ink/60'}`}>{f.description}</p>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className={`rounded-3xl aspect-[4/3] border ${dark ? 'border-porcelain/15 bg-porcelain/5' : 'border-ink/10 bg-white'} overflow-hidden flex items-center justify-center`}>
        {features[active].screenshot
          ? <img src={features[active].screenshot} alt={features[active].title} className="w-full h-full object-cover" />
          : <span className={`text-sm ${dark ? 'text-porcelain/40' : 'text-ink/30'}`}>Screenshot: {features[active].title}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `SegmentGrid.tsx`**

```tsx
import { SegmentItem } from '../content';

export default function SegmentGrid({ segments }: { segments: SegmentItem[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {segments.map((s) => (
        <div key={s.title} className="rounded-2xl border border-ink/10 bg-white p-6">
          <h3 className="font-display text-xl font-bold mb-2">{s.title}</h3>
          <p className="text-ink/60">{s.pain}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `CaseCard.tsx`**

```tsx
import { CaseItem } from '../content';

export default function CaseCard({ item }: { item: CaseItem }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6">
      <p className="font-display text-4xl font-extrabold text-orange">{item.metric}</p>
      <p className="font-bold mt-1">{item.label}</p>
      <p className="text-ink/50 text-sm mt-2">{item.description}</p>
    </div>
  );
}
```

- [ ] **Step 4: `IntegrationsGrid.tsx`** (nomes de integrações reais como texto/badge, sem logos de clientes)

```tsx
const integrations = ['Planilha / Excel', 'EAN / GTIN', 'Wake Commerce', 'Marketplaces'];

export default function IntegrationsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      {integrations.map((name) => (
        <div key={name} className="rounded-xl border border-ink/10 bg-white px-5 py-6 text-center font-bold text-ink/70">{name}</div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `PricingSummary.tsx`**

```tsx
import { Link } from 'react-router-dom';

export default function PricingSummary() {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-4">Preço transparente por créditos</h2>
      <p className="text-ink/60 mb-2">Você paga só pelo que usar. Cada operação de IA consome créditos — sem mensalidade escondida.</p>
      <p className="text-ink/60 mb-8">Novos usuários começam com <strong className="text-orange">10 créditos grátis</strong>.</p>
      <Link to="/precos" className="inline-block px-6 py-3 rounded-xl font-bold bg-orange text-white hover:brightness-95 transition">Ver planos e créditos</Link>
    </div>
  );
}
```

- [ ] **Step 6: `TrustSection.tsx`**

```tsx
import { ShieldCheck, Server, Lock } from 'lucide-react';

const items = [
  { icon: ShieldCheck, title: 'Dados privados', text: 'Seus dados não são compartilhados com terceiros.' },
  { icon: Server, title: 'Chaves no servidor', text: 'As chaves de IA nunca ficam expostas no navegador.' },
  { icon: Lock, title: 'Uso responsável de IA', text: 'Você revisa e aprova tudo antes de publicar.' },
];

export default function TrustSection() {
  return (
    <div className="grid gap-8 md:grid-cols-3">
      {items.map(({ icon: Icon, title, text }) => (
        <div key={title} className="flex gap-4">
          <div className="w-11 h-11 rounded-xl bg-orange/10 text-orange flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
          <div>
            <h3 className="font-bold mb-1">{title}</h3>
            <p className="text-porcelain/70 text-sm">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Nota: `TrustSection` é usada em `Section tone="dark"`; por isso o texto usa `text-porcelain/70`.

- [ ] **Step 7: `FAQ.tsx`**

```tsx
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FaqItem } from '../content';

export default function FAQ({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="max-w-3xl mx-auto divide-y divide-ink/10">
      {items.map((it, i) => (
        <div key={it.q}>
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between py-5 text-left">
            <span className="font-display font-bold text-lg">{it.q}</span>
            <ChevronDown className={`w-5 h-5 transition ${open === i ? 'rotate-180' : ''}`} />
          </button>
          {open === i && <p className="pb-5 text-ink/60">{it.a}</p>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Typecheck**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/marketing/components/
git commit -m "feat(marketing): componentes de showcase, segmentos, casos, integrações, preços, confiança e FAQ"
```

---

## Task 9: Montar a Home

**Files:**
- Modify: `src/marketing/pages/HomePage.tsx`

**Interfaces:**
- Consumes: todos os componentes das Tasks 5, 7, 8 + `Section` (Task 4) + `content.ts` (Task 6).

- [ ] **Step 1: Compor a HomePage**

```tsx
import Hero from '../components/Hero';
import Section from '../components/Section';
import AgentCard from '../components/AgentCard';
import HowItWorks from '../components/HowItWorks';
import FeatureShowcase from '../components/FeatureShowcase';
import SegmentGrid from '../components/SegmentGrid';
import CaseCard from '../components/CaseCard';
import IntegrationsGrid from '../components/IntegrationsGrid';
import PricingSummary from '../components/PricingSummary';
import TrustSection from '../components/TrustSection';
import FAQ from '../components/FAQ';
import FinalCTA from '../components/FinalCTA';
import { productFeatures, contentFeatures, segments, cases, homeFaq } from '../content';

export default function HomePage() {
  return (
    <>
      <Hero
        eyebrow="Agentes de IA para e-commerce"
        titleLead="Uma equipe de"
        titleAccent="Agentes de IA"
        titleTail="para cuidar do seu e-commerce."
        subtitle="Enquanto você foca em vender, os agentes do Alfreds cuidam do cadastro, do SEO, das imagens e do conteúdo da sua loja."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Ver os agentes em ação', to: '/agente-de-produto' }}
        microcopy="10 créditos grátis · sem cartão"
      />

      {/* Problema */}
      <Section tone="light">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-4">Cadastro manual e conteúdo parado <span className="text-orange">travam suas vendas</span>.</h2>
          <p className="text-ink/60 text-lg">Planilhas infinitas, descrições pobres e um blog que ninguém atualiza. O Alfreds coloca um esquadrão de agentes para resolver isso por você.</p>
        </div>
      </Section>

      {/* Conheça os agentes */}
      <Section tone="light">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold">Conheça o esquadrão</h2>
          <p className="text-ink/60 mt-3">Dois agentes disponíveis hoje. Novos agentes chegando em breve.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <AgentCard theme="product" title="Agente de Produto" description="Cadastra, enriquece, gera SEO, imagens e vídeos do seu catálogo." to="/agente-de-produto" />
          <AgentCard theme="content" title="Agente de Conteúdo" description="Planeja, escreve e otimiza o conteúdo que faz sua marca ranquear." to="/agente-de-conteudo" />
        </div>
        <p className="text-center text-ink/40 mt-8 text-sm">🔜 Novos agentes em breve</p>
      </Section>

      {/* Como funciona */}
      <Section tone="dark">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Como funciona</h2></div>
        <HowItWorks />
      </Section>

      {/* Agente de Produto em detalhe */}
      <Section tone="light">
        <FeatureShowcase theme="product" eyebrow="Agente de Produto" title="Seu catálogo pronto para performar." features={productFeatures} />
      </Section>

      {/* Agente de Conteúdo em detalhe */}
      <Section tone="dark">
        <FeatureShowcase theme="content" eyebrow="Agente de Conteúdo" title="Conteúdo que ranqueia, na voz da sua marca." features={contentFeatures} />
      </Section>

      {/* Segmentos */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Feito para o seu tipo de operação</h2></div>
        <SegmentGrid segments={segments} />
      </Section>

      {/* Cases */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Resultados</h2></div>
        <div className="grid gap-6 md:grid-cols-3">{cases.map((c) => <CaseCard key={c.label} item={c} />)}</div>
      </Section>

      {/* Integrações */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Integrações</h2></div>
        <IntegrationsGrid />
      </Section>

      {/* Preços */}
      <Section tone="light"><PricingSummary /></Section>

      {/* Confiança */}
      <Section tone="dark">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Segurança e confiança</h2></div>
        <TrustSection />
      </Section>

      {/* FAQ */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Perguntas frequentes</h2></div>
        <FAQ items={homeFaq} />
      </Section>

      {/* CTA final */}
      <Section tone="light"><FinalCTA title="Comece com 10 créditos grátis e coloque os agentes para trabalhar." ctaLabel="Começar grátis" ctaTo="/entrar" /></Section>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Verificação visual completa**

Run: `npm run dev` → abrir `/`. Rolar a home inteira: hero laranja, cards dos dois agentes (produto laranja / conteúdo preto), showcases alternando claro/escuro, FAQ abrindo/fechando, todos os CTAs levam a `/entrar` ou às páginas dos agentes.
Expected: home renderiza ponta a ponta, responsiva no mobile (reduzir a janela), sem overflow horizontal.

- [ ] **Step 4: Commit**

```bash
git add src/marketing/pages/HomePage.tsx
git commit -m "feat(marketing): home completa"
```

---

## Task 10: Páginas dos agentes + capturar screenshots reais

**Files:**
- Modify: `src/marketing/pages/ProductAgentPage.tsx`, `src/marketing/pages/ContentAgentPage.tsx`, `src/marketing/content.ts` (adicionar campos `screenshot`)
- Create: `src/assets/marketing/*.png` (screenshots do app)

**Interfaces:**
- Consumes: `Hero`, `FeatureShowcase`, `FAQ`, `FinalCTA`, `Section`, `content.ts`.

- [ ] **Step 1: Capturar screenshots reais do app**

Rodar o app logado (`npm run dev`), e capturar telas dos dois agentes (editor de produto/enriquecimento/SEO/ambientação; e perfil de marca/clusters/artigos/calendário do módulo de conteúdo). Salvar otimizadas em `src/assets/marketing/` (ex.: `produto-enriquecimento.png`, `conteudo-clusters.png`, ...). Se ainda não houver telas boas, deixar sem `screenshot` (o `FeatureShowcase` já mostra placeholder legível).

- [ ] **Step 2: Ligar screenshots ao conteúdo**

Em `content.ts`, importar as imagens e preencher o campo `screenshot` de cada `FeatureItem` correspondente. Ex.:

```typescript
import produtoEnriquecimento from '@/assets/marketing/produto-enriquecimento.png';
// ...
export const productFeatures: FeatureItem[] = [
  { title: 'Enriquecimento de dados', description: '...', screenshot: produtoEnriquecimento },
  // ...
];
```

- [ ] **Step 3: `ProductAgentPage.tsx`**

```tsx
import Hero from '../components/Hero';
import Section from '../components/Section';
import FeatureShowcase from '../components/FeatureShowcase';
import FinalCTA from '../components/FinalCTA';
import { productFeatures } from '../content';

export default function ProductAgentPage() {
  return (
    <>
      <Hero
        theme="product"
        eyebrow="Agente de Produto"
        titleLead="Seu catálogo"
        titleAccent="pronto para vender"
        titleTail="— no automático."
        subtitle="O Agente de Produto cadastra, enriquece com dados reais, gera SEO, imagens e vídeos do seu catálogo enquanto você foca em crescer."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Ver preços', to: '/precos' }}
        microcopy="10 créditos grátis · sem cartão"
      />
      <Section tone="light">
        <FeatureShowcase theme="product" eyebrow="O que o agente faz" title="Do EAN ao produto pronto." features={productFeatures} />
      </Section>
      <Section tone="light"><FinalCTA theme="product" title="Coloque o Agente de Produto para trabalhar hoje." ctaLabel="Começar grátis" ctaTo="/entrar" /></Section>
    </>
  );
}
```

- [ ] **Step 4: `ContentAgentPage.tsx`** (tema preto)

```tsx
import Hero from '../components/Hero';
import Section from '../components/Section';
import FeatureShowcase from '../components/FeatureShowcase';
import FinalCTA from '../components/FinalCTA';
import { contentFeatures } from '../content';

export default function ContentAgentPage() {
  return (
    <>
      <Hero
        theme="content"
        eyebrow="Agente de Conteúdo"
        titleLead="Conteúdo que"
        titleAccent="ranqueia"
        titleTail="— na voz da sua marca."
        subtitle="O Agente de Conteúdo entende seu negócio, mapeia oportunidades e produz artigos otimizados para SEO, sem afogar sua equipe no operacional."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Ver preços', to: '/precos' }}
        microcopy="10 créditos grátis · sem cartão"
      />
      <Section tone="dark">
        <FeatureShowcase theme="content" eyebrow="O que o agente faz" title="Da estratégia ao artigo publicado." features={contentFeatures} />
      </Section>
      <Section tone="dark"><FinalCTA theme="content" title="Coloque o Agente de Conteúdo para trabalhar hoje." ctaLabel="Começar grátis" ctaTo="/entrar" /></Section>
    </>
  );
}
```

Nota: `FinalCTA` com `theme="content"` usa `bg-ink` sobre `Section tone="dark"` (invisível). Ajuste: na página de conteúdo, passar um CTA legível — usar `theme="product"` no `FinalCTA` (botão laranja) OU adicionar variante. Decisão do plano: **usar botão laranja** (`theme="product"`) nos CTAs sobre fundo escuro, mantendo o laranja como cor de ação universal e o preto como cor de identidade do agente.

- [ ] **Step 5: Typecheck + visual**

Run: `npm run lint` (sem erros) e `npm run dev` → `/agente-de-produto` (laranja) e `/agente-de-conteudo` (preto) renderizam com screenshots reais ou placeholders. Confirmar contraste do CTA no tema escuro (botão laranja visível).

- [ ] **Step 6: Commit**

```bash
git add src/marketing/ src/assets/marketing/ src/marketing/content.ts
git commit -m "feat(marketing): páginas dos agentes de produto e conteúdo com screenshots"
```

---

## Task 11: Nova entrada do app (`AuthPage`)

Reaproveita a lógica de auth existente (hoje em `LoginLanding` + handlers do `App`), com visual da nova marca.

**Files:**
- Create: `src/marketing/pages/AuthPage.tsx`
- Modify: `src/App.tsx` (passar handlers de auth ao `AuthPage`; trocar `AuthPageOrLogin` por `AuthPage`)

**Interfaces:**
- Consumes: handlers já existentes no `App`: `onGoogleLogin`, `onEmailLogin(email,password)`, `onEmailRegister(email,password)`, `onPasswordReset(email)` (mesmas assinaturas que `LoginLanding` recebe hoje). `mapFirebaseError` pode ser copiada de `LoginLanding.tsx`.
- Produces: `AuthPage` recebendo as mesmas props de `LoginLanding`.

- [ ] **Step 1: Criar `AuthPage.tsx`**

Reusar integralmente a lógica de estado/submit de `src/components/LoginLanding.tsx` (mode login/register/reset, `mapFirebaseError`, form handlers), trocando a camada visual para a nova marca: coluna esquerda em `bg-ink text-porcelain` apresentando os **dois agentes** (usar `AgentCard` ou blocos simples com os dois logos), coluna direita com o formulário; logo `logo-alfreds-produtos.png` no topo; botão primário `bg-orange`; bloco de bônus "10 créditos grátis". Assinatura de props idêntica à de `LoginLanding`:

```tsx
interface AuthPageProps {
  onGoogleLogin: () => void;
  onEmailLogin: (email: string, password: string) => Promise<void>;
  onEmailRegister: (email: string, password: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
}
```

Copiar o corpo de `LoginLanding` como base e ajustar: classes `blue-600`→`orange`, `bg-slate-50`→`bg-ink`, textos alinhados a "esquadrão de agentes", coluna esquerda listando Agente de Produto (laranja) e Agente de Conteúdo (preto) em vez das 4 features antigas.

- [ ] **Step 2: Ligar no `App.tsx`**

Trocar, na rota `/entrar`, o `AuthPageOrLogin` (temporário da Task 4) por `<AuthPage onGoogleLogin={...} onEmailLogin={...} onEmailRegister={...} onPasswordReset={...} />` usando exatamente os mesmos handlers hoje passados a `LoginLanding`. Após login bem-sucedido, `navigate('/app')`.

- [ ] **Step 3: Typecheck + visual (fluxo real de auth)**

Run: `npm run lint` (sem erros) e `npm run dev`:
- `/entrar` mostra o novo visual (ink + laranja, dois agentes na lateral).
- Login com Google e com email/senha funcionam e caem em `/app`.
- "Esqueci minha senha" envia email; erros aparecem traduzidos.
Expected: auth 100% funcional, visual novo.

- [ ] **Step 4: Commit**

```bash
git add src/marketing/pages/AuthPage.tsx src/App.tsx
git commit -m "feat(marketing): nova entrada do app alinhada à marca"
```

- [ ] **Step 5: Remover `LoginLanding` (após confirmar AuthPage em uso)**

```bash
git rm src/components/LoginLanding.tsx
```
Ajustar o import removido em `App.tsx`. Rodar `npm run lint` (sem erros) e commitar:

```bash
git add -A && git commit -m "chore(marketing): remove LoginLanding legado"
```

---

## Task 12: Preços, Casos, Contato (com lead no Firestore) + polish de contraste do app interno

**Files:**
- Modify: `src/marketing/pages/PricingPage.tsx`, `CasesPage.tsx`, `ContactPage.tsx`
- Create: `src/marketing/leadService.ts`
- Modify: telas internas do app onde o laranja prejudicou legibilidade (anotadas na Task 2, Step 3)

**Interfaces:**
- Consumes: `db` de `src/firebase.ts` (mesmo usado no app); `Section`, `Hero`, `FAQ`, `PricingSummary`, `SegmentGrid`, `CaseCard`.
- Produces: `saveLead(data: { nome: string; email: string; mensagem: string }): Promise<void>`.

- [ ] **Step 1: `leadService.ts`**

```typescript
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface LeadInput { nome: string; email: string; mensagem: string; }

/** Grava um lead de contato no Firestore (coleção `leads`). */
export async function saveLead(data: LeadInput): Promise<void> {
  await addDoc(collection(db, 'leads'), { ...data, createdAt: serverTimestamp() });
}
```

Nota de execução: conferir/ajustar `firestore.rules` para permitir `create` em `leads` (create público, sem read). Ex.: `match /leads/{id} { allow create: if true; allow read, update, delete: if false; }`. Incluir a regra e fazer deploy conforme o fluxo do projeto.

- [ ] **Step 2: `PricingPage.tsx`**

Hero (`theme="brand"`) + explicação do modelo de créditos + tabela do que cada operação de IA consome (usar os valores reais de `src/credits.ts`) + tier "Falar com especialista" (link `/contato`) + `FAQ` de cobrança (subconjunto de `homeFaq` ou perguntas próprias). Reusar `PricingSummary` não é obrigatório aqui; montar a página com `Section` e conteúdo próprio.

- [ ] **Step 3: `CasesPage.tsx`**

Hero + grid de `CaseCard` (placeholders honestos) + `SegmentGrid` + `FinalCTA` (botão laranja).

- [ ] **Step 4: `ContactPage.tsx`**

Formulário controlado (nome, email, mensagem) que chama `saveLead`; estado de sucesso ("Recebemos seu contato"); tratamento de erro. **Não** enviar dados sensíveis; apenas os três campos. Botão `bg-orange`.

```tsx
import { useState } from 'react';
import Section from '../components/Section';
import { saveLead } from '../leadService';

export default function ContactPage() {
  const [form, setForm] = useState({ nome: '', email: '', mensagem: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try { await saveLead(form); setStatus('done'); }
    catch { setStatus('error'); }
  }
  // ...render: Section + form controlado + estados...
}
```

- [ ] **Step 5: Polish do app interno**

Revisar as telas anotadas na Task 2 (onde `primary` virou laranja e ficou ruim). Ajustar caso a caso — ex.: manter texto sobre laranja em branco, trocar fundos laranja-claros por `orange/10`, garantir contraste AA. Não repintar tudo: só corrigir o que regrediu.

- [ ] **Step 6: Typecheck + visual**

Run: `npm run lint` (sem erros) e `npm run dev`: `/precos`, `/casos`, `/contato` renderizam; enviar um lead de teste e conferir no Firestore que o documento foi criado na coleção `leads`. Revisar o app interno logado — nada ilegível.

- [ ] **Step 7: Commit**

```bash
git add src/marketing/ firestore.rules src/
git commit -m "feat(marketing): páginas de preços, casos e contato com lead no Firestore"
```

---

## Task 13: Metadados/SEO on-page e ajuste do `index.html`

**Files:**
- Modify: `index.html`
- Create: `src/marketing/usePageMeta.ts` (hook simples para title/description por rota)

**Interfaces:**
- Produces: `usePageMeta({ title, description }: { title: string; description: string })` que ajusta `document.title` e a meta description ao montar a rota.

- [ ] **Step 1: Atualizar `index.html`**

Trocar `<title>` para `Alfreds — Agentes de IA para E-commerce` e a meta description para "Um esquadrão de Agentes de IA que cuidam do cadastro, SEO, imagens e conteúdo do seu e-commerce." Adicionar tags Open Graph básicas (og:title, og:description, og:type=website).

- [ ] **Step 2: Criar `usePageMeta.ts`**

```typescript
import { useEffect } from 'react';

export function usePageMeta({ title, description }: { title: string; description: string }) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', description);
  }, [title, description]);
}
```

- [ ] **Step 3: Aplicar nas páginas**

Chamar `usePageMeta` no topo de cada página de marketing com título/descrição próprios (ex.: HomePage → "Alfreds — Agentes de IA para E-commerce"; ProductAgentPage → "Agente de Produto | Alfreds"; etc.).

- [ ] **Step 4: Typecheck + visual**

Run: `npm run lint` (sem erros) e `npm run dev` → navegar entre rotas e confirmar que a aba do navegador muda o título por página.

- [ ] **Step 5: Commit**

```bash
git add index.html src/marketing/
git commit -m "feat(marketing): metadados e SEO on-page por rota"
```

---

## Task 14: Refino visual final com frontend-design

**Files:**
- Modify: componentes em `src/marketing/components/` conforme necessário

- [ ] **Step 1: Invocar a skill frontend-design**

Usar `frontend-design` para elevar a estética: escala tipográfica do display, sombras/raios, motion (orbital no hero ecoando o logo, reveal on-scroll, hover states), densidade e respiro. Passada de referência visual no Chrome (IndexaAI/Niara) quando útil para calibrar.

- [ ] **Step 2: Aplicar melhorias**

Implementar os ajustes mantendo os contratos de props dos componentes (não quebrar as páginas). Foco: hero da home, transições claro/escuro entre seções, o `FeatureShowcase`.

- [ ] **Step 3: Typecheck + visual + responsivo**

Run: `npm run lint` (sem erros) e `npm run dev`: revisar todas as rotas em desktop e mobile (sem overflow horizontal), motion suave, contraste AA.

- [ ] **Step 4: Commit**

```bash
git add src/marketing/
git commit -m "feat(marketing): refino visual final (frontend-design)"
```

---

## Self-Review (feito na redação deste plano)

**Cobertura do spec:**
- Posicionamento "esquadrão de agentes" + regras de copy → Global Constraints + Task 6.
- Cores por agente (produto laranja / conteúdo preto) → Tasks 2, 3, 7, 10.
- Home 15 blocos → Task 9 (todas as seções presentes; faixa de logos de clientes intencionalmente ausente).
- Páginas de agentes → Task 10. Preços/Casos/Contato → Task 12. Nova entrada → Task 11.
- Roteamento no SPA sem quebrar o app → Task 4. Tokens → Task 2. Lead no Firestore → Task 12. `--color-primary` laranja → Task 2. SEO → Task 13. Refino → Task 14.

**Placeholders:** nenhum "TODO/TBD" no plano; screenshots reais são etapa explícita (Task 10) com fallback legível já implementado no `FeatureShowcase`.

**Consistência de tipos:** `AgentTheme`/`ThemeTokens`/`getTheme` (Task 3) usados uniformemente; `FeatureItem/FaqItem/CaseItem/SegmentItem` (Task 6) batem com o consumo nas Tasks 7–10; handlers de auth de `AuthPage` idênticos aos de `LoginLanding`. Corrigido: `segments[0]` deve ser `{ title, pain }` limpo (sem cast); CTA sobre fundo escuro usa botão laranja (`theme="product"`); AgentCard/FeatureShowcase usam `text-orange` como acento legível em superfícies escuras.
