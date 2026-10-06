# Alfreds — Guia de Marca & Design System

> Padrão visual do Alfreds, extraído do site de marketing e do app. Use este documento como fonte da verdade para novas telas, páginas e materiais.

---

## 1. Marca & posicionamento

**Alfreds é um esquadrão de Agentes de IA para e-commerce que trabalham por você.**

Não é "mais uma ferramenta/painel que você opera" — são agentes que executam o trabalho pesado do e-commerce. O logo orbital (nós girando em torno do "A") representa essa constelação de agentes.

**Agentes disponíveis hoje:** Agente de Produto e Agente de Conteúdo.
**Em desenvolvimento:** Agente de Força de Vendas, Agente Operacional.

**Frase-âncora:** _"Uma equipe de Agentes de IA para cuidar do seu e-commerce."_

---

## 2. Logo

Arquivos em `src/assets/brand/`:

| Arquivo | Versão | Uso |
|---------|--------|-----|
| `logo-alfreds-produtos.png` | Laranja | Uso geral da marca, Agente de Produto, sobre fundos claros **e escuros** |
| `logo-alfreds-conteudo.png` | Preto | Agente de Conteúdo, sobre fundos claros (porcelana/branco) |

**Regras**
- Sobre fundo **escuro (ink)** use sempre a versão **laranja** (a preta some).
- Altura mínima confortável: `h-7` (nav) a `h-9` (heróis/sidebar).
- Não distorça, não recolora, não adicione sombra dura ao logo.
- No rodapé/superfícies claras a versão preta é preferível.

---

## 3. Paleta de cores

Tokens oficiais (Tailwind v4, definidos em `src/index.css` no bloco `@theme`):

| Token | Hex | Classe Tailwind | Papel |
|-------|-----|-----------------|-------|
| **Orange** | `#FF5B03` | `orange` / `primary` | **Cor de ação universal** (CTAs, links, acentos, destaques). Cor do Agente de Produto. |
| **Ink** | `#141311` | `ink` | Fundo escuro, texto principal no claro. Cor do Agente de Conteúdo. |
| **Porcelain** | `#E8E0D5` | `porcelain` | Fundo claro/quente (creme). Assinatura que diferencia de SaaS branco genérico. |
| **Blue** | `#3053FF` | `blue` | Acento do Agente de Força de Vendas; cor tech/conectiva secundária. |
| **Periwinkle** | `#828ED1` | `periwinkle` | Acento do Agente Operacional; superfícies/detalhes suaves. |
| Sidebar | `#141311` | `sidebar` | Fundo da sidebar do app. |
| Sidebar ativo | `#26221d` | `sidebar-active` | Item de navegação ativo (app). |
| Surface | `#f7f9fb` | `surface-bg` | Fundo neutro de superfícies internas (app). |

**Princípios**
- **Dominância + acento**: fundos porcelana/ink dominam; **laranja** aparece com parcimônia como acento de ação.
- **Laranja = ação.** Qualquer botão/link primário é laranja, em qualquer contexto (inclusive nas superfícies do Agente de Conteúdo).
- Cinzas neutros (slate) são permitidos apenas em UI de dados densa (tabelas do app), nunca como cor de marca.
- Estados semânticos (sucesso/erro/aviso) usam verde/vermelho/âmbar padrão — não são cores de marca.

---

## 4. Cor por agente

Cada agente tem uma cor de identidade. A **ação** continua sempre laranja.

| Agente | Cor de identidade | Acento (texto/tile) | Logo |
|--------|-------------------|---------------------|------|
| **Produto** | Laranja `#FF5B03` | `text-orange` / `bg-orange/10` | laranja |
| **Conteúdo** | Ink `#141311` | card escuro; acento de leitura em `text-orange` | preto |
| **Força de Vendas** *(em breve)* | Blue `#3053FF` | `text-blue` / `bg-blue/10` | — (ícone) |
| **Operacional** *(em breve)* | Periwinkle `#828ED1` | `text-periwinkle` / `bg-periwinkle/15` | — (ícone) |

Agentes "em breve" usam **borda tracejada**, selo **"Em breve"** e rótulo **"Em desenvolvimento"** no lugar do CTA.

---

## 5. Tipografia

Fontes carregadas via Google Fonts (`src/index.css`):

- **Display — Bricolage Grotesque** (`font-display`), pesos 500–800. Para títulos, herói, números-destaque. Tracking apertado (`-0.02em` já aplicado na classe `.font-display`).
- **Corpo — Inter**, pesos 400–700. Para textos, labels, UI.

**Escala de referência (marketing)**
- Herói: `text-4xl md:text-6xl font-extrabold leading-[1.05]`
- Título de seção (h2): `text-3xl md:text-4xl font-extrabold`
- Número-destaque (métricas/passos): `font-display font-extrabold` grande (`text-4xl`+)
- Corpo: `text-lg` (destaque) / base; texto secundário em `text-ink/60` (claro) ou `text-porcelain/60` (escuro)
- Eyebrow/rótulo: `text-xs font-bold uppercase tracking-widest` na cor do acento

**Padrão "frase-chave colorida":** headlines destacam a palavra-chave na cor do acento.
Ex.: "Uma equipe de **Agentes de IA**…", "Conteúdo que **ranqueia**…", "De ~~dias~~ para **horas**".

---

## 6. Layout & ritmo de seções (site)

> Desde 2026-10-05 o site de marketing (`src/marketing/*`) e a tela de login usam o **mesmo design system do Alfred** (tokens `--ag-*`, vidro, aurora — ver `src/index.css`), não mais o porcelana/ink. Quem cria a conta encontra do outro lado a mesma tela que viu no site.

- O layout inteiro é escopo `.alfreds` com `data-tema="claro"` fixo e a aurora presa à janela (`MarketingLayout.tsx`). `.ag-aurora` define `position: relative` fora das camadas do Tailwind — para fixá-la, use estilo inline (`position: fixed`), a classe `fixed` perde.
- `Section` (`components/ui.tsx`): `tone="light"` é transparente (a aurora aparece); `tone="dark"` reabre `.alfreds[data-tema="escuro"]`, então o conteúdo segue os mesmos tokens. `colado` tira o respiro do topo.
- Cores de origem do app como identidade de cada frente: Produto `--ag-orig-produto`, Mercado Livre `--ag-orig-meli`, Conteúdo `--ag-orig-conteudo`, Operações `--ag-orig-operacoes`; aspectos (`--ag-asp-*`) nas listas de recursos.
- Container `max-w-6xl px-4 sm:px-6`; cartões `ag-glass`/`ag-glass-strong ag-sheen` com raio 22–30px; botões em pílula (`Cta`).

## 7. Componentes & padrões (site)

Todos em `src/marketing/components/`.

- **Hero** — selo de origem opcional, título display em caixa de sentença (sem palavra colorida), apoio, CTA laranja + secundário de vidro, microcopy. `lado` vira coluna; `alinhar="topo"` quando a peça ao lado muda de altura.
- **SemanaDemo** — o hero da home: a "Sua semana" do app jogável ("Fazer com Alfred" → etapas → antes/depois → "Aprovar e gravar"). É o elemento-assinatura; o resto da página fica quieto.
- **DemoObjetivo / HeroObjetivo** — antes e depois de cada objetivo (fotos ambientadas reais em `src/assets/marketing/demo-tenis-*`).
- **PlanoDemo**, **OperacoesDemo** — o card de Plano do chat e um recorte do Centro de Operações, sempre com "dados fictícios" à vista.
- **IntegrationsGrid** — vive numa faixa escura (o logo da Wake é branco).
- **FAQ**, **FinalCTA** (com a esfera `AlfredLogo`), **MarketingNav** (vidro flutuante + menu no telefone), **MarketingFooter**.

**Páginas de conversão = objetivos do onboarding.** `/descricoes-de-produto`, `/mercado-livre` e `/blog-com-ia` (`ObjetivoPage.tsx`, copy em `content.ts`) seguem os três objetivos da Tela 0. O CTA leva a `/entrar?modo=criar&objetivo=X`; a tela de login guarda o X (`objetivoSite.ts`) e o `ObjetivosPicker` abre com ele marcado. `/blog` não serve: é o prefixo do proxy dos blogs dos clientes (`server/blogPublic.ts`).

**Honestidade nas peças:** nenhum número de custo por ação fixo no site (o custo real vive em `config/credits` e muda sem deploy) — só o preço do crédito (R$ 0,50, mínimo 10, `CreditPurchaseModal`) e "o custo aparece antes de confirmar".

## 8. Botões & CTAs

- **Primário (ação):** `bg-orange text-white rounded-xl font-bold hover:brightness-95` (+ `hover:-translate-y-0.5`).
- **Secundário (outline):** borda + texto na cor da superfície (`border-ink/20 text-ink` no claro; `border-porcelain/30 text-porcelain` no escuro).
- **Sobre fundo escuro, a ação continua laranja** (nunca `bg-ink` sobre `bg-ink`).
- Microcopy de baixa fricção abaixo do CTA quando fizer sentido ("10 créditos grátis · sem cartão").

---

## 9. Iconografia

- Biblioteca: **lucide-react**. `strokeWidth` ~1.5–1.75 para leveza.
- Ícones de destaque ficam em **tiles arredondados** na cor do contexto (`bg-orange/10 text-orange`, `bg-blue/10 text-blue`, etc.).
- Tamanho comum: `w-6 h-6` em tiles `w-12 h-12 rounded-xl`.

---

## 10. Motion

- **Contido e proposital.** CSS/Tailwind, sem libs pesadas.
- Herói: glow radial + reveal (opacity/translate, `duration-700`).
- Cards: `hover:-translate-y-1 hover:shadow-lg`.
- CTAs: `hover:brightness-95`, seta `group-hover:translate-x-1`.
- Dropdown: fade + translate (`duration-200`), abre em hover **e** focus-within.

---

## 11. Regras de contraste (não quebrar)

Aprendizados aplicados no site — respeite sempre:

1. **Nunca `text-ink`/`bg-ink` sobre fundo `ink`.** Em superfícies escuras, texto = `porcelain` (e variações de opacidade); acento/ação = **laranja**.
2. Em cards **brancos**, dê cor **explícita** ao texto (`text-ink`) — não confie na herança da seção (uma seção escura cascateia `text-porcelain` e apaga texto sem cor).
3. Logos claros → fundo escuro; logos escuros → fundo claro. Inverta quando necessário para legibilidade.
4. Contraste mínimo AA para texto.

---

## 12. Voz & copy

- **Português (Brasil).** Direto, confiante, sem jargão.
- Fale de **agentes que trabalham por você**, não de "funcionalidades de um software".
- Nomeie os agentes com suas cores/identidade.
- **Prova em número** sempre que possível (tempo economizado, % de conversão, itens processados) — com honestidade ("exemplo ilustrativo" quando não houver dado real).
- Reserve espaço para o futuro: "Em breve", "Outros agentes a caminho".
- Baixa fricção: "grátis", "sem cartão", "10 créditos grátis".

---

## 13. Do's & Don'ts

**Do**
- Alternar seções claras/escuras para ritmo.
- Usar laranja como único idioma de ação.
- Mostrar telas reais do produto (screenshots), não só descrever.
- Manter tipografia display grande e com respiro.

**Don't**
- Reintroduzir azul (`#004ac6`/`blue-600`) como cor de marca — foi migrado para laranja.
- Usar gradientes roxos sobre branco / estética "AI-SaaS genérica".
- Sombras duras, cantos retos, tipografia tímida.
- Texto sem cor explícita em cards sobre seções escuras.

---

## 14. Referência rápida de tokens

```css
/* src/index.css → @theme */
--color-primary:        #FF5B03;  /* = orange, ação */
--color-orange:         #FF5B03;  /* Agente de Produto */
--color-ink:            #141311;  /* Agente de Conteúdo, fundo escuro */
--color-porcelain:      #E8E0D5;  /* fundo claro */
--color-blue:           #3053FF;  /* Agente de Força de Vendas */
--color-periwinkle:     #828ED1;  /* Agente Operacional */
--color-sidebar:        #141311;
--color-sidebar-active: #26221d;
--color-surface-bg:     #f7f9fb;
--font-display: "Bricolage Grotesque", "Inter", sans-serif;  /* corpo: Inter */
```
