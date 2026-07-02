# Alfreds — Site de Marketing + Nova Entrada do App

**Data:** 2026-07-02
**Autor:** Rafael + Claude (brainstorming)
**Status:** Aprovado para plano de implementação

---

## 1. Contexto e objetivo

Hoje o Alfreds não tem site de marketing. A única "vitrine" é uma tela de login split-screen (`src/components/LoginLanding.tsx`). Precisamos de:

1. Um **site público de aquisição** (home + páginas de apoio) que venda o Alfreds a lojistas.
2. Uma **nova entrada do app** (login/cadastro) alinhada à marca, substituindo a `LoginLanding` atual.

Referências analisadas: **IndexaAI** (espelho do núcleo de cadastro/produto) e **Niara** (espelho do módulo de conteúdo/SEO). Extraímos delas as mecânicas de conversão já provadas; a identidade visual é própria do Alfreds.

## 2. Posicionamento e narrativa

**Alfreds é um esquadrão de Agentes de IA para e-commerce que trabalham por você.** Não é "mais uma ferramenta/painel que você opera" — são agentes que executam o trabalho pesado do seu e-commerce. O logo orbital (nós girando em torno do "A") representa literalmente essa constelação de agentes.

Hoje há **dois agentes disponíveis** (e a arquitetura permite adicionar mais no futuro):

| Agente | O que faz | Cor-tema | Logo |
|--------|-----------|----------|------|
| **Agente de Produto** | Importa planilha/EAN, enriquece dados (GTIN, NCM, dimensões), gera SEO (título/descrição/keywords), ambienta imagens, gera vídeo, organiza categorias, integra (Wake). | Laranja `#FF5B03` | `logo-alfreds-produtos.png` |
| **Agente de Conteúdo** | Entende a marca, mapeia autoridade, produz artigos/clusters, calendário editorial, SEO de conteúdo. | Preto `#141311` | `logo-alfreds-conteudo.png` |

> Nota técnica: essa dualidade **já existe no app** — `App.tsx` = Agente de Produto; `src/modules/content/ContentApp.tsx` = Agente de Conteúdo (atrás de `hasContentAgent`). O site apenas externaliza essa arquitetura.

**Mensagem-âncora (hero):** "Uma equipe de Agentes de IA para cuidar do seu e-commerce." Subhead ancora nos benefícios (catálogo pronto para vender, conteúdo que ranqueia) e na baixa fricção (10 créditos grátis, sem cartão).

**Regras de copy (aplicar em todas as seções):**
- Sempre falar de "agentes que trabalham por você", não de "funcionalidades de um software".
- Nomear os dois agentes com suas cores. Produto = laranja, Conteúdo = preto.
- Deixar a porta aberta para "novos agentes em breve" (reforça a visão de plataforma/esquadrão).
- Prova em número sempre que possível (tempo economizado, % de conversão, itens cadastrados).

## 3. Sistema de marca

### Paleta (Adobe — "Paternatal")
| Token | Hex | Uso |
|-------|-----|-----|
| `porcelain` | `#E8E0D5` | Fundo claro/quente das seções neutras. Assinatura que diferencia das refs. |
| `ink` | `#141311` | Fundo escuro; cor-tema do **Agente de Conteúdo**; texto principal no claro. |
| `orange` | `#FF5B03` | Cor-tema do **Agente de Produto**; CTA primário da marca; acento de destaque. |
| `blue` | `#3053FF` | Azul elétrico — acento tech/conectivo, links, estados, "agentes futuros". |
| `periwinkle` | `#828ED1` | Secundário suave — gradientes, superfícies, detalhes. |

**Temas por contexto:**
- **Marca/geral:** porcelana + ink + laranja como acento principal.
- **Seções do Agente de Produto:** laranja dominante sobre porcelana ou ink.
- **Seções do Agente de Conteúdo:** ink/preto dominante, logo preto, azul/periwinkle como acento (evita conflito com o laranja).
- **Ritmo:** alternar seções claras (porcelana) e escuras (ink) — foge do "tudo escuro" (Niara) e "tudo branco" (IndexaAI).

### Logos
- `logo-alfreds-produtos.png` — versão laranja (uso geral e Agente de Produto).
- `logo-alfreds-conteudo.png` — versão preta (Agente de Conteúdo e fundos claros).
- Copiar os arquivos para `src/assets/brand/` no início da implementação.

### Tipografia
- **Display:** manter/evoluir **Bricolage Grotesque** (já no projeto, `--font-display`) para headlines grandes de alto contraste. Pesos 700–800, tracking apertado (`-0.02em`), tamanhos generosos (padrão das duas refs).
- **Corpo:** **Inter** (já no projeto).
- **Padrão "frase-chave colorida"** (roubado da Niara): headlines com a palavra-chave em laranja (ou na cor do agente). Ex.: "Uma equipe de **Agentes de IA** para o seu e-commerce."

## 4. Arquitetura de informação (páginas)

Site público (logout) + app (login). Páginas públicas:

1. **Home** (`/`) — a peça central.
2. **Agente de Produto** (`/agente-de-produto`) — página dedicada, tema laranja.
3. **Agente de Conteúdo** (`/agente-de-conteudo`) — página dedicada, tema preto.
4. **Preços** (`/precos`) — modelo de créditos + pacotes.
5. **Casos & Segmentos** (`/casos`) — cases com métrica + soluções por segmento.
6. **Contato / Falar com especialista** (`/contato`).
7. **Entrada do app** (`/entrar`) — novo login/cadastro (substitui `LoginLanding`).

Quando o usuário está autenticado, as rotas do app atual seguem como hoje (o `App.tsx` logado).

## 5. Home — seção a seção

1. **Nav sticky** — logo Alfreds + links (Agente de Produto, Agente de Conteúdo, Preços, Casos) + `Entrar` + CTA `Começar grátis` (laranja).
2. **Hero** — headline com frase-chave em laranja; subhead de benefício; **dual-CTA** (`Começar grátis` laranja + `Ver os agentes em ação` outline); microcopy "10 créditos grátis · sem cartão"; visual do herói com **motion orbital** (os dois agentes girando em torno do "A", ecoando o logo).
3. **O problema** — a dor do lojista (cadastro manual, catálogo pobre, conteúdo que não ranqueia) → "Conheça o esquadrão."
4. **Conheça os agentes** — dois cards grandes lado a lado: **Agente de Produto (laranja)** e **Agente de Conteúdo (preto)**, cada um com 1 frase + CTA para a página dedicada. Espaço reservado para "novos agentes em breve".
5. **Como funciona em 3 passos** — Conecte (planilha/EAN/site) → Os agentes trabalham → Catálogo e conteúdo prontos para vender.
6. **Agente de Produto em detalhe** — bloco tema laranja com o padrão **lista numerada + screenshot real sincronizado** (roubado da Niara): Enriquecimento, SEO, Ambientação de imagens, Vídeo, Categorias/Integrações. Usar telas reais do app.
7. **Agente de Conteúdo em detalhe** — bloco tema preto, mesmo padrão: Perfil da marca, Mapa de autoridade, Clusters, Produção de artigos, Calendário. Telas reais do módulo de conteúdo.
8. **Por segmento** — Loja online / Marketplace-Seller / Indústria (padrão IndexaAI).
9. **Cases com métricas** — cards com número duro (tempo de cadastro, % conversão, itens processados). **Placeholders honestos** ("exemplo ilustrativo") até termos dados reais.
10. **Integrações** — Wake, planilha/Excel, marketplaces (integrações reais, não logos de clientes).
11. **Preços (resumo)** — destaque do modelo de créditos + link para `/precos`.
12. **Segurança & confiança** — dados privados, chaves no servidor, uso responsável de IA/LGPD (padrão Niara).
13. **FAQ** — 6–9 perguntas.
14. **CTA final** — "Comece com 10 créditos grátis" (laranja).
15. **Footer** — navegação, institucional, contato.

> **Sem faixa de logos de clientes** nesta rodada (ainda não há clientes/autorização). A prova social virá dos cases (placeholder) e das integrações reais. Reavaliar quando houver logos autorizados.

## 6. Páginas de apoio

- **Agente de Produto / Agente de Conteúdo:** herói temático (cor + logo do agente) → problema específico → módulos em detalhe com screenshots → mini-cases → FAQ do agente → CTA. Reusam os componentes da home.
- **Preços:** explicação do modelo de créditos, pacotes, o que cada operação de IA consome, tier "falar com especialista" para volume/indústria, FAQ de cobrança. Transparência como diferencial (Niara publica preço; IndexaAI esconde).
- **Casos & Segmentos:** grid de cases + seções por segmento.
- **Contato:** formulário "falar com especialista" (não submete dados sensíveis a terceiros; endpoint próprio a definir) + caminho self-serve (`Começar grátis`).

## 7. Nova entrada do app (`/entrar`)

Reescrever a experiência da atual `LoginLanding` mantendo a lógica de auth (Google + email/senha + reset, Firebase) e o bônus de 10 créditos, mas:
- Alinhada à nova marca (porcelana/ink/laranja, logo novo, tipografia display).
- Continuidade narrativa com o site (mesma promessa "esquadrão de agentes").
- Painel lateral mostra os dois agentes, não uma lista de features soltas.

A lógica de `mapFirebaseError` e os handlers (`onGoogleLogin`, `onEmailLogin`, `onEmailRegister`, `onPasswordReset`) são preservados; muda a camada visual.

## 8. Direção visual e componentes

Padrões a adotar (validados nas refs):
- Tipografia display gigante + frase-chave colorida.
- Logos de clientes logo abaixo do hero.
- **Screenshots reais do produto** em cards com sombra suave / borda tênue (não descrever features — mostrar).
- **Lista numerada de módulos sincronizada com screenshot** (padrão de maior conversão da Niara).
- Dual-CTA (preenchido na cor do agente + outline) com microcopy de baixa fricção.
- Motion contido: orbital no hero, reveal on-scroll, hover nos cards.
- Alternância clara/escura entre seções para ritmo.

Componentes reutilizáveis a criar: `MarketingNav`, `Hero`, `LogoStrip`, `AgentCard`, `HowItWorks`, `FeatureShowcase` (lista numerada + screenshot), `SegmentGrid`, `CaseCard`, `IntegrationsGrid`, `PricingSummary`, `TrustSection`, `FAQ`, `FinalCTA`, `MarketingFooter`. Todos parametrizados por `theme` (produto/conteúdo/marca).

A escolha fina de escala tipográfica, sombras, raios e detalhes de motion será feita na fase de construção via skill `frontend-design`, com passada de referência visual no Chrome quando útil.

## 9. Abordagem técnica

- **Roteamento:** hoje o SPA não tem router — `App.tsx` renderiza `LoginLanding` quando `!user` e o app quando logado. Introduzir **`react-router-dom`** com:
  - Rotas públicas (`/`, `/agente-de-produto`, `/agente-de-conteudo`, `/precos`, `/casos`, `/contato`, `/entrar`) servidas quando deslogado (e navegáveis por qualquer visitante).
  - App autenticado atrás de guarda de rota (comportamento atual preservado).
  - `/entrar` acessível diretamente e via CTAs do site.
- **Estrutura de arquivos:** `src/marketing/` com `pages/` (uma por rota) e `components/` (os reutilizáveis acima). Assets de marca em `src/assets/brand/`.
- **Design tokens:** adicionar as 5 cores da paleta ao `@theme` em `src/index.css` (`--color-porcelain`, `--color-ink`, `--color-orange`, `--color-blue`, `--color-periwinkle`) e usar via Tailwind. **Migrar `--color-primary` de `#004ac6` para o laranja da marca (`#FF5B03`)** — o app interno passa a usar o novo padrão de cor também. Validar contraste/legibilidade dos elementos internos que usavam azul (botões, estados) e ajustar onde o laranja prejudicar a leitura.
- **SEO on-page:** títulos/desc* por rota, Open Graph, dados estruturados. (A skill `seo` pode auditar depois.)
- **Sem backend novo** nesta rodada além do endpoint de contato (a definir; pode ser um simples POST que registra lead no Firestore).

## 10. Plano de ação (faseado)

| Fase | Entrega | Detalhe |
|------|---------|---------|
| **0 — Fundação** | Tokens + roteamento + assets + `frontend-design` | Adicionar cores ao tema, copiar logos, instalar/configurar `react-router-dom`, definir a estética fina (tipografia/motion/sombra) e o kit de componentes-base. |
| **1 — Home** | Landing completa (16 blocos) | Com screenshots reais dos dois agentes. |
| **2 — Páginas dos agentes** | `/agente-de-produto` + `/agente-de-conteudo` | Reuso dos componentes, temas laranja/preto. |
| **3 — Apoio** | `/precos`, `/casos`, `/contato` | Preços transparente por créditos; endpoint de lead. |
| **4 — Entrada do app** | Novo `/entrar` | Substitui `LoginLanding`, preserva auth e 10 créditos. |
| **5 — Copy & SEO final** | Textos definitivos, cases reais, meta tags | Refino de conteúdo + SEO on-page do próprio site. |

## 11. Fora de escopo (YAGNI, por ora)

- Blog/CMS próprio do site de marketing (só link para o que existir).
- Internacionalização (site em pt-BR apenas).
- Terceiro agente (só reservar o espaço visual "em breve").
- Checkout/pagamento novo (usa o fluxo de créditos já existente).

## 12. Critérios de sucesso

- Visitante entende em <5s que Alfreds é um **time de agentes** e quais são os dois disponíveis.
- Cada agente tem identidade de cor inequívoca (Produto=laranja, Conteúdo=preto).
- CTA `Começar grátis` leva ao novo `/entrar` sem quebrar a auth atual.
- App interno segue funcionando (nada regride ao introduzir o router).
- Visual não se confunde com "template AI-SaaS" genérico.

## 13. Decisões (resolvidas)

1. **Cases:** usar **placeholders honestos** ("exemplo ilustrativo") — ainda não há dados reais.
2. **Logos de clientes:** **não incluir** faixa de prova social por ora (sem clientes/autorização). Reavaliar depois.
3. **Contato/lead:** gravar lead no **Firestore** (POST simples), sem CRM externo por ora.
4. **`--color-primary`:** **migrar o app interno** de azul (`#004ac6`) para o laranja da marca (`#FF5B03`) — padrão único de cor no site e no app.
