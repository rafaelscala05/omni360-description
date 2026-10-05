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
- No app com agente a logo é **viva**: `AlfredLogo` (`src/components/alfredLogo/`) — esfera geodésica em Canvas 2D que lê as cores dos tokens `--ag-sphere-*` e reage ao ponteiro; `ativo` aceita o estado "agente respondendo". Fora do escopo `.alfreds` valem as cores da marca (`PALETA_PADRAO`).

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
| Surface | `#f7f9fb` | `surface-bg` | Fundo neutro de superfícies internas (telas antigas do app). |

> O app com agente **não** usa mais essa paleta direto: usa os tokens `--ag-*` do escopo `.alfreds` (ver seção 15), que reaproveitam laranja, azul e porcelana/ink da marca.

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

**App interno** — para quem tem módulo de agente, o app é a superfície "Liquid Glass" descrita na seção 15 (trilho de vidro no desktop, tab bar de vidro no telefone, tema claro/escuro). A sidebar `ink` com logo laranja só existe para contas **sem** agente. Ações/estados ativos continuam laranja nos dois casos.

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

---

## 15. App com agente — "Liquid Glass" (`.alfreds`)

A tela do agente e tudo que o app converteu para ela (Alfred, Atividade, Ferramentas, Fontes, Produtos, Categorias, Mercado Livre, Operações, Conteúdo) usa um sistema próprio, no espírito do UI kit da Apple: superfícies translúcidas com blur + saturação, hairlines de 1px, cantos generosos e uma aurora sutil ao fundo. Definido em `src/index.css` sob a classe **`.alfreds`** (não `:root`: o escopo existe para o resto do app continuar claro). O marketing (seções 1–14) **não** usa isto.

### 15.1 Regra de ouro
**Nenhuma cor literal.** Tudo vem de tokens `--ag-*`. O tema escuro é só a troca desses tokens em `.alfreds[data-tema='escuro']` — um `text-slate-800` solto fica ilegível no escuro. Classes no formato `bg-(--ag-fill)`. O tema é local à superfície do agente, vive num store único (`src/modules/agent/theme.ts`, `localStorage`) e é lido por Alfred, Atividade, Ferramentas, tab bar, trilho e barra "Próximo passo". Componentes montados fora da árvore (modais, `LogsPanel`) reabrem o escopo `.alfreds` com o tema por prop.

### 15.2 Tokens (claro → escuro)

| Grupo | Token | Claro | Escuro |
|-------|-------|-------|--------|
| Fundo | `--ag-bg` / `--ag-bg-2` | `#eef1f7` / `#f9fafc` | `#07080c` / `#0d1017` |
| Superfície | `--ag-surface` (+ `-a`, `-solid`) | `255 255 255` @ .72 · `#fff` | `148 163 184` @ .10 · `#14171f` |
| Elevado | `--ag-raised` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.06)` |
| **Folha** | `--ag-folha` | `rgba(255,255,255,.62)` | `rgba(22,25,34,.72)` |
| Hairline | `--ag-hairline` / `-2` | `rgba(15,23,42,.09/.16)` | `rgba(255,255,255,.10/.18)` |
| Texto | `--ag-text` / `-2` / `-3` | `#0b0d12` / `#59626f` / `#8b94a3` | `#f2f5f9` / `#a2adbd` / `#6d7787` |
| Fill | `--ag-fill` / `-2` | `rgba(15,23,42,.05/.09)` | `rgba(255,255,255,.07/.13)` |
| Ação | `--ag-accent` (+ `-soft`, `-ink`) | `#ff5b03` · `#fff` | `#ff7a33` · `#1a0d04` |
| Azul | `--ag-blue` | `#3053ff` | `#7e94ff` |
| OK | `--ag-ok` | `#12a150` | `#3ddc84` |
| Aviso | `--ag-warn` | `#c2610a` | `#f5b544` |
| Perigo | `--ag-danger` | `#dc2626` | `#ff6b6b` |
| Véu | `--ag-scrim` | `rgba(5,7,12,.45)` | `rgba(0,0,0,.6)` |
| Aurora | `--ag-aurora-1/2/3` | laranja · azul · periwinkle (.26/.22/.22) | mesmas cores (.34/.32/.24) |
| Esfera | `--ag-sphere-node/-link/-link-a/-sat/-blend` | `#ff5b03` / `#141311` @ .23 / `#e8e0d5` / `normal` | `#ff7a33` / `#e8e0d5` @ .36 / `#e8e0d5` / aditivo |
| Sombra | `--ag-shadow-sm` / `--ag-shadow` / `--ag-shadow-lg` | suaves, azuladas | mais densas |

`--ag-folha` é a folha de conteúdo do desktop **e** a aba ativa do trilho que encosta nela: a mesma cor nas duas (translúcida, **sem blur**), senão a emenda aparece.

**Derivados** (também em `.alfreds`, reavaliados por escopo): `--ag-accent-line`, `--ag-blue-line`, `--ag-ok-line`, `--ag-warn-line`, `--ag-danger-line`, `--ag-violet-line` (borda tingida — o `*-soft` some como traço sobre o vidro); `--ag-violet`/`-soft`; `--ag-fill-solid`, `--ag-accent-tint`, `--ag-danger-tint` (**fundos opacos**, obrigatórios em tudo que é `sticky`, senão as linhas que rolam aparecem por baixo).

### 15.3 Cor com significado
- **Origem da tarefa** (`--ag-orig-*`): produto `#ff5b03`, conteúdo `#7c3aed`, Mercado Livre `#c9a800`, operações `#0e7c86` (escuro: `#ff7a33`, `#a78bfa`, `#facc15`, `#2dd4bf`). Só em pontos de 8px e rótulos, **nunca como fundo** — cor forte aqui é reservada para "precisa de você".
- **Aspecto do produto** (`--ag-asp-*`, `src/modules/agent/aspectos.tsx`): descrição azul `#3053ff`, atributos violeta `#7c3aed`, imagem (foto/ambientada/imagens) teal `#0e7c86`, vídeo rosa `#d6336c` (escuro: `#8ea0ff`, `#b89bfb`, `#3cc4cf`, `#f47fb0`). Cada aspecto tem **um ícone e uma cor** iguais na aba Produtos, na tabela completa e no modal. A cor diz *qual* aspecto; **fundo tingido × neutro** diz *feito × falta* (`estiloAspecto`). Âmbar/laranja continua só para "falta e é obrigatório" (descrição, foto).
- Amarelo do Mercado Livre e o cabeçalho escuro do onboarding ficam literais de propósito (marca / escuro nos dois temas); idem as cores que o usuário escolhe em Aparência do blog.

### 15.4 Materiais e utilitários
- `.ag-glass` — vidro padrão (`blur(24px) saturate(180%)` + hairline). `.ag-glass-strong` — mais opaco, para texto longo.
- `.ag-sheen` — realce interno de 1px no topo + `--ag-shadow` (é o que dá brilho de vidro).
- `.ag-aurora` — fundo com duas manchas desfocadas à deriva (laranja/azul); `.ag-deriva` — deriva lenta da esfera desfocada da Visão geral.
- `.ag-tela-x` — **margem lateral única** de toda tela do agente: 12px no telefone, 16px a partir de 640px (a mesma do composer). Nunca `px-*` próprio por tela e nunca a tela inteira centralizada numa largura máxima; a largura de leitura limita o bloco de dentro.
- `.ag-scroll` (barra discreta), `.ag-scroll-x` (sem barra), `.ag-recolhe` (modo foco do composer no telefone), `.ag-shimmer`, `.ag-indeterminado`.

### 15.5 Shell
- **Desktop com agente:** `TrilhoDesktop` (três portas — Alfred, Atividade, Ferramentas — e avatar da Conta) em vidro; ao lado, a **folha** de conteúdo (`FolhaConteudo`). Em Ferramentas há uma segunda coluna sempre recolhida (só ícones) com os agentes (`ColunaFerramentas`).
- **Telefone:** `AppTabBar` de vidro com as mesmas três portas; some **só enquanto o composer está focado**. Campo com `text-[16px]` fixo (senão o Safari/iOS dá zoom).
- **Conta** (créditos, histórico, missões, integrações, empresa, indicação, ajuda, sair) é um componente só (`ContaMenu`): popover no trilho, folha que sobe da base no telefone.
- **Layout responsivo do Alfred:** semana | conversa | atividade em 3 colunas a partir de 1280px (≥1100px de contêiner); abaixo disso alterna Semana/Conversa. Atividade: abas "Para você · Rodando · Feito" abaixo de 960px, três colunas acima.
- Telas antigas só entram no tema depois de convertidas para tokens (`telaComTokens` no `App.tsx`); as demais ficam no claro (`data-tema='claro'`).

### 15.6 Armadilhas (aprendidas em produção)
- `divide-*` e qualquer `border-*` sem `borderColor` explícito **não funcionam** com tokens (a cor cai em `currentColor` e vira traço preto sobre o vidro) — use `borderTop`/`borderColor` por linha.
- Enfeites animados (`.ag-live`, `.ag-aurora`, halos) são `pointer-events: none`, senão engolem clique.
- `.ag-recolhe` precisa de `overflow: hidden` para recolher, o que corta o halo da esfera se o bloco não tiver folga no topo.
- Auto-scroll da thread usa `scrollTop` na própria área, nunca `scrollIntoView`.

### 15.7 Movimento
Mola estilo sheet da Apple: `.ag-rise` (entrada de mensagens/cards, 0.42s `cubic-bezier(.22,1,.36,1)`), `.ag-sheet-in` (0.34s `cubic-bezier(.32,.72,0,1)`). Halo pulsante `.ag-live`; núcleo do agente com brilho em repouso e, respondendo, anéis de voz em cadência irregular (`.ag-nucleo-brilho`, `.ag-onda`, `.ag-eq-barra` — períodos não múltiplos para o olho não achar o loop). Tudo respeita `prefers-reduced-motion`.

### 15.8 Tipografia no app
Títulos de tela em `font-display` (Bricolage Grotesque) ~30px; corpo Inter. Ações em pílula; cartões em `ag-glass`.

