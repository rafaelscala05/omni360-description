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

## 6. Layout & ritmo de seções

- Container: `max-w-6xl mx-auto px-6`; seções com `py-20 md:py-28`.
- **Alternância claro/escuro**: seções alternam `porcelana` (claro) e `ink` (escuro) para criar ritmo e profundidade. Foge do "tudo branco" (IndexaAI) e "tudo escuro" (Niara).
- Wrapper padrão: componente `Section` com `tone="light" | "dark"`.
  - `light` → `bg-porcelain text-ink`
  - `dark` → `bg-ink text-porcelain`
- Cantos generosos: cards `rounded-2xl`/`rounded-3xl`; botões `rounded-xl`.
- Sombras suaves (`shadow-sm`/`shadow-lg` no hover), nunca sombras duras.

---

## 7. Componentes & padrões

Todos em `src/marketing/components/`.

- **Hero** — eyebrow + headline com frase-chave colorida + subtítulo + **dual-CTA** (`Começar grátis` laranja preenchido + secundário outline) + microcopy `10 créditos grátis · sem cartão`. Fundo com **glow radial laranja** e **reveal** na montagem.
- **AgentCard** — variantes `product | content | sales | ops`; suporta estado `comingSoon`. Card claro (branco) ou escuro (ink); logo (agentes ativos) ou ícone em tile (agentes futuros).
- **FeatureShowcase** — **lista numerada à esquerda + screenshot sincronizado à direita** (troca ao clicar no item). Screenshots reais do app em `src/assets/marketing/`; fallback elegante "Prévia em breve" (painel pontilhado).
- **SegmentGrid** — cards com **ícone** em tile `bg-orange/10 text-orange` + título + dor.
- **CaseCard** — métrica grande em laranja + label + descrição. Métricas ilustrativas devem dizer "exemplo ilustrativo" até haver dados reais.
- **IntegrationsGrid** — em **seção escura**; logos reais em branco sobre tiles `bg-white/[0.04] border-white/10`; selo "Em breve" onde aplicável. Logos coloridos/escuros (ex.: Tiny) são invertidos para branco (`filter: brightness(0) invert(1)`).
- **MarketingNav** — sticky, logo à esquerda; agentes agrupados em **submenu "Agentes"** (dropdown); `Entrar` + CTA `Começar grátis` laranja.
- **FAQ** — acordeão; **FinalCTA** — headline + botão laranja; **TrustSection** — ícones + texto em seção escura; **MarketingFooter** — logo preto + colunas.

**App interno** — sidebar `ink` com logo laranja; ações/estados ativos em laranja; mesma marca do site.

---

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
