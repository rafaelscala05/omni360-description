# Onboarding do primeiro produto via URL

**Data:** 2026-08-18
**Status:** proposto (aguardando revisão)

## 1. Problema

Campanhas de performance trazem usuários majoritariamente mobile. Depois do
cadastro, o único caminho para adicionar produtos hoje é upload de planilha
Excel (`handleFileUpload`, `src/App.tsx:984`) — escolher um `.xlsx`/`.xls` do
dispositivo, ou baixar um template e editá-lo antes. Esse fluxo pressupõe
desktop e não existe nenhuma forma de cadastrar um produto avulso. Resultado:
o usuário mobile chega ao dashboard vazio, não tem planilha, e abandona antes
de ver qualquer valor do produto.

Não existe hoje detecção de mobile, nem um caminho de "adicionar 1 produto".
`ProductEditModal` é edit-only (nunca aberto em modo "criar").

## 2. Objetivo e critério de sucesso

Dar ao usuário mobile um caminho de zero-a-primeiro-produto-enriquecido sem
precisar de planilha: colar a URL de um produto (do próprio site dele, ou de
um concorrente/anúncio) → sistema extrai os dados → usuário é guiado, em um
wizard curto, pelos três recursos centrais do produto (descrição, atributos,
imagem ambientada com IA).

Métrica: taxa de usuários que chegam a "primeiro produto com pelo menos uma
geração de IA aplicada" dentro da primeira sessão, segmentada por
mobile vs desktop e por origem (URL import vs planilha). Instrumentado via
eventos novos (seção 9); a CRM já deriva o marco "generated content" de
`credit_logs`, então nenhuma mudança é necessária lá — só o funil de entrada
precisa de eventos próprios para diferenciar da planilha.

## 3. Decisões (veredito do conselho)

- **Timing:** modal se auto-abre uma única vez quando `products.length === 0`
  no primeiro carregamento autenticado, mas é dispensável ("Pular por
  agora"). Se dispensado, a CTA primária do estado vazio passa a ser "Colar
  link do produto" (a planilha vira ação secundária) — a oportunidade nunca
  desaparece, só para de interromper.
- **Extração:** fetch server-side (SSRF-guardado) → parser determinístico
  (JSON-LD `Product` / Open Graph) primeiro → Gemini só preenche o que não
  veio estruturado (descrição/categoria). Não é uma chamada cega de
  "grounding" — é o padrão que `contentAgent.ts` já usa para `scanWebsite`,
  estendido.
- **Modal:** componente novo, não mexe em `ProductEditModal`. Produz um
  `Product` normal que entra no mesmo `products` state / `saveToCloud` que
  já existe — depois de criado, é um produto como qualquer outro.
- **Enriquecimento:** wizard (stepper), reaproveitando o padrão visual dos
  `OnboardingWizard.tsx` existentes. Sem chat/conversacional — evitaria
  confusão com o Agente Operacional (que é outro produto, com outro
  propósito) e é infraestrutura nova sem necessidade.
- **Fallback:** scraping fraco ou site bloqueado nunca é um dead-end de
  erro — cai num formulário manual mínimo dentro do mesmo modal.
- **Entrada manual como escolha, não só fallback:** o passo inicial mostra,
  além do campo de URL, um botão "Quero inserir manualmente meu produto" —
  quem já sabe o que quer cadastrar não precisa passar pelo scraping.
- **Explicação simples do funcionamento:** o passo inicial traz um resumo
  de 3 itens ("Anexe Imagem, Título e Categoria — nós fazemos o resto"),
  deixando explícito o que o sistema espera do usuário e o que ele ganha em
  troca.
- **Imagem, Título e Categoria passam a ser obrigatórios** para criar o
  produto (via scraping ou manual) — sem os três, o produto não avança pro
  wizard de enriquecimento. Antes só o nome era obrigatório; a imagem em
  especial é essencial porque a geração de descrição e a imagem ambientada
  dependem dela.
- **Créditos:** o scrape em si é grátis; cada etapa de enriquecimento usa o
  fluxo de crédito já existente (`ensureCredits`/`consumeCredit`), com o
  custo mostrado antes de cada ação.

## 4. Arquitetura

```
Passo inicial: "Anexe Imagem, Título e Categoria — nós fazemos o resto"
      │
      ├── Usuário cola URL ──────────────────┐
      │                                       ▼
      │                     POST /api/product-import/scrape  (server/productImport.ts, novo)
      │                           1. assertSafeUrl(url)        — server/safeUrl.ts, estendido
      │                           2. fetchHtmlSafely(url)      — fetch com timeout/limite/redirect:'error'
      │                           3. parse determinístico       — cheerio: JSON-LD Product, senão OG tags
      │                           4. lacunas → Gemini (server)  — mesmo padrão de generateText/generateJson
      │                                                            que contentAgent.ts já usa
      │                                       │
      │                                       ▼
      │                     { product: Partial<ProductFields>, source: 'structured'|'ai'|'hybrid', warnings? }
      │                                       │
      └── "Quero inserir manualmente" ────────┤
                                               ▼
                          ProductUrlImportModal (novo, src/components/onboarding/)
                                step "review" (scrape) OU "manual" (direto ou fallback)
                                — Título, Categoria e Imagem obrigatórios em ambos
                                  (imagem via upload de arquivo — /api/upload já existe —
                                   ou colar URL externa)
                                               ▼
onProductCreated(product) → App.tsx injeta em `products` state
      │  (mesmo formato que handleFileUpload já produz; persistência
      │   continua sendo saveToCloud, sem escrita nova no Firestore)
      ▼
Wizard de enriquecimento (mesmo modal, 3 passos)
  1. Descrição   → reusa startGenerateSingle (App.tsx) tal como já existe
  2. Atributos   → reusa o handler de generateProductAttributes já existente
  3. Imagem      → abre ImageSearchModal já existente para o produto criado
      ▼
Tela final: "produto pronto" + CTA "ver produto" / "importar mais (planilha)"
```

Princípio central: **nada de infraestrutura de geração de IA nova no
cliente**. O wizard só orquestra os mesmos handlers de crédito/geração que
`App.tsx` e `ImageSearchModal` já têm — o único código novo de verdade é (a)
o endpoint de scrape e (b) a casca do modal/wizard.

## 5. Backend

### 5.1 `server/safeUrl.ts` (estendido)

Hoje só tem guards para imagem (`assertSafeImageUrl`, `fetchImageAsBase64`).
Adicionar:

```ts
export async function assertSafeUrl(rawUrl: string): Promise<void>
export async function fetchHtmlSafely(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<string>
```

Mesma lógica de `assertSafeImageUrl` (protocolo http/s, resolução DNS
completa via `dns/promises.lookup(..., { all: true })`, rejeita qualquer IP
privado/loopback/link-local/metadata) fatorada para reuso — sem
type-checking de `content-type` de imagem. `fetchHtmlSafely` usa
`redirect: 'error'` (mesmo motivo do image fetch: um host seguro no DNS
check não pode redirecionar pra um host interno depois), timeout via
`AbortController` (padrão 15s) e corta em `maxBytes` (padrão 2MB de HTML).

**Consolidação incluída no escopo:** `contentAgent.ts` tem uma
`assertSafeUrl` local duplicada (linhas 285-300) com a mesma lógica. Como
estamos estendendo exatamente esse arquivo com a mesma responsabilidade,
`contentAgent.ts` passa a importar de `safeUrl.ts` em vez de manter uma
terceira cópia — elimina duplicação de código de segurança, que é
justamente o tipo de coisa que não deveria divergir silenciosamente entre
dois arquivos.

### 5.2 `server/productImport.ts` (novo)

```ts
export function registerProductImportRoutes(
  app: express.Application,
  deps: { verifyFirebaseToken: (req) => Promise<DecodedIdToken> }
): void
```

`POST /api/product-import/scrape`
- Auth: `deps.verifyFirebaseToken(req)` (mesmo padrão de todo módulo de rota
  existente — `onboardingAgent.ts`, `crmEvents.ts`).
- Body: `{ url: string }`.
- Rate limit: bucket em memória por `uid`, 20 requisições/hora — mitigação
  simples contra abuso (usar o endpoint como proxy de scraping). Aceitável
  não sobreviver a restart/múltiplas instâncias dado que não há evidência de
  deploy multi-instância no repo hoje; documentado como limitação conhecida.
- Fluxo:
  1. `assertSafeUrl(url)` → 400 genérico ("URL inválida") se falhar, sem
     detalhar o motivo (não vazar lógica de detecção de SSRF).
  2. `fetchHtmlSafely(url)` → se falhar/timeout, responde
     `{ product: {}, source: 'failed' }` (200, não erro — o cliente decide
     cair no formulário manual).
  3. `cheerio.load(html)`:
     - Procura `<script type="application/ld+json">` com
       `@type` (ou array contendo) `"Product"` → extrai `name`, `image`
       (string ou array), `description`, `offers.price`/`offers.lowPrice`,
       `sku`, `brand.name`.
     - Se JSON-LD ausente/incompleto, completa via meta tags:
       `og:title`, `og:image`, `og:description`,
       `product:price:amount`/`itemprop="price"`.
  4. Se `description` ainda vazia ou muito curta (<40 chars): monta o mesmo
     tipo de "digest" que `scanWebsite` já monta (título + headings + corpo
     truncado ~6000 chars) e chama Gemini server-side (mesmo padrão privado
     `generateText`/`generateJson` de `contentAgent.ts`, replicado neste
     módulo — sem extrair um helper compartilhado agora; é o mesmo padrão
     stylistic já usado por módulo, não uma questão de segurança como o
     `assertSafeUrl`) pedindo um JSON `{ description, category_guess }`.
  5. Resposta:
     ```ts
     {
       product: {
         'Descrição'?: string,
         'Preço'?: number,
         'URL imagem externa 1'?: string,
         'Descrição complementar'?: string,
         'Marca'?: string,
       },
       source: 'structured' | 'hybrid' | 'ai' | 'failed',
       warnings?: string[],   // ex.: ["imagem não encontrada"]
     }
     ```
     Nunca lança erro para "scrape pobre" — sempre 200 com o que foi
     possível extrair; o cliente decide se é suficiente para pular pro
     `review` ou cair no `manual`.

Registrado em `server.ts` junto aos demais `registerXRoutes(app, { verifyFirebaseToken })`, antes do catch-all `/api/*` 404.

## 6. Frontend

### 6.1 `src/services/apiClient.ts` (novo, pequena extração)

`callJson<T>(url, method, body?)` hoje vive só dentro de
`onboardingService.ts` (token via `auth.currentUser.getIdToken()`, headers,
tratamento de erro). Extrair para um módulo compartilhado e apontar
`onboardingService.ts` e o novo `productImportService.ts` para ele —
evita a terceira cópia colada do mesmo helper de 15 linhas.

### 6.2 `src/services/productImportService.ts` (novo)

```ts
export async function scrapeProductUrl(url: string): Promise<ScrapedProductResult> {
  return callJson('/api/product-import/scrape', 'POST', { url });
}
```

### 6.3 `src/components/onboarding/ProductUrlImportModal.tsx` (novo)

Reaproveita a linguagem visual de `modules/onboarding/OnboardingWizard.tsx`:
header com gradiente escuro, `STEPS` como barra de progresso segmentada,
`motion/react` `AnimatePresence`/`motion.div` para transição entre passos.

Estados (`step`):
`'intro' → 'loading' → ('review' | 'manual') → 'enrich-description' → 'enrich-attributes' → 'enrich-image' → 'done'`

`manual` é alcançado por dois caminhos: diretamente do `intro` (usuário
escolheu inserir manualmente) ou como fallback do `review` (scrape falhou
ou insuficiente) — é a mesma tela nos dois casos, só muda a mensagem de
contexto no topo.

- **`intro`** — passo de entrada, com duas partes:
  1. Explicação simples do funcionamento, sempre visível, 3 itens com
     ícone: "📷 Imagem (obrigatória) · 🏷️ Título · 📁 Categoria — o resto
     (descrição, atributos, imagens ambientadas) a IA faz por você."
  2. Duas formas de começar: campo de URL + botão "Analisar produto", **ou**
     um botão secundário "Quero inserir manualmente meu produto" que vai
     direto pro passo `manual` com os campos em branco.
- **`loading`** — spinner com copy tipo "Lendo a página do seu produto...".
- **`review`** (quando `source !== 'failed'` e há nome extraído) — campos
  pré-preenchidos e editáveis: **Título*** , **Categoria*** (select — reusa
  o padrão de `ProductEditModal.tsx:668-674` contra `existingCategories`),
  **Imagem*** (thumbnail extraída, com opção de trocar — ver abaixo),
  preço e descrição curta (opcionais, vieram do scrape). Botão "Criar
  produto" fica desabilitado até os 3 campos obrigatórios (*) estarem
  preenchidos. Se o scrape não trouxe imagem, o campo já nasce vazio e
  precisa ser preenchido manualmente antes de avançar.
- **`manual`** (escolha direta ou fallback de scrape) — mesmo formulário do
  `review`: **Título***, **Categoria***, **Imagem*** obrigatórios; preço
  opcional. Quando chega como fallback, mostra a mensagem "Não conseguimos
  ler essa página automaticamente — sem problema, preencha à mão." Nunca
  uma tela de erro sem saída.
  - **Campo Imagem** (obrigatório nos dois passos acima): dois modos —
    anexar arquivo do dispositivo (`<input type="file" accept="image/*" capture="environment">`,
    natural no mobile — tira foto ou escolhe da galeria) que sobe via o
    `POST /api/upload` já existente (mesmo padrão de
    `blog/PostEditor.tsx:28-38`: lê como base64, `POST` com
    `{ imageBase64, filename }`, recebe `{ url }`), ou colar uma URL de
    imagem externa. O botão "Criar produto"/avançar só habilita com uma
    imagem definida (upload concluído ou URL preenchida).
- **`enrich-description`** — copy explicando a ação + custo em créditos
  visível ("Isso usa 1 crédito. Você tem 9."), botão "Gerar" que chama, via
  prop, exatamente o handler que `App.tsx` já usa hoje
  (`startGenerateSingle`) — o modal não duplica a lógica de
  `ensureCredits`/`consumeCredit`/tracking, só invoca. Botão "Pular" sempre
  disponível.
- **`enrich-attributes`** — mesma mecânica, mas essa etapa é **grátis**: a
  sugestão de atributos por IA (`generateProductAttributes`/
  `generateAttributesFromImage`, hoje usada em `ProductEditModal`'s
  "Analisar") não passa por `ensureCredits`/`consumeCredit` no código atual
  — copy reflete isso ("Grátis"), sem menção a custo.
- **`enrich-image`** — em vez de reimplementar geração ambientada, abre o
  `ImageSearchModal` já existente para o produto recém-criado (reuso
  direto, é o componente que já faz `runGenerateAmbient`). Ao fechar,
  volta pro wizard no passo `done`.
- **`done`** — "Seu primeiro produto está pronto!" com CTAs "Ver produto" e
  "Importar mais produtos" (abre o fluxo de planilha existente) — nunca
  termina em beco sem saída, sempre reconecta ao resto do app.

Props do componente: recebe do `App.tsx` os handlers de geração já
existentes (injeção, não reimplementação) e um `onProductCreated(product)`
que insere no `products` state exatamente como `handleFileUpload` faz hoje.

Criação do objeto `Product`: mesma convenção de `_id` usada no import em
massa (`` `prod_${index}_${Date.now()}` ``), aqui `` `prod_url_${Date.now()}` ``,
com `_isDirty: true` — persiste depois via o `saveToCloud`/autosave que já
existe, sem escrita de Firestore nova no cliente.

### 6.4 Wiring em `App.tsx`

- Novo estado local: `isProductUrlImportOpen`.
- Novo campo lido do snapshot do usuário (mesmo listener que já lê
  `credits`, `onboarding.completed` etc., `App.tsx:381-393`):
  `productOnboarding?.promptShown === true`.
- Efeito: quando `isAuthReady && products.length === 0 && !promptShown`,
  abre o modal automaticamente **uma vez** e grava
  `updateDoc(userRef, { productOnboarding: { promptShown: true } })`
  imediatamente (independe de o usuário completar o fluxo — não deve
  reaparecer sozinho depois, a CTA manual cobre o resto).
- Estado vazio (`App.tsx:3330-3357`): CTA primária passa a ser "Colar link
  do produto" (abre o modal manualmente); "Importar Arquivo"/"Baixar
  Planilha Padrão" viram uma seção secundária abaixo ("ou importe uma
  planilha").
- Render do modal perto do cluster de modais existente
  (`App.tsx` ~4193-4220, ao lado de `CategoryImportModal`/`OnboardingWizard`).

## 7. Extração determinística — por que reduz risco

`generateDescriptionText`/`generateProductAttributes` já toleram um
`Product` quase vazio (`effectiveAttributes = []` quando não há
`categoryId`, ambas funções caem num modo "sugestão livre" — sem crash nem
caso especial necessário). Isso significa que o scrape não precisa ser
perfeito: mesmo extraindo só nome + imagem via JSON-LD/OG (o caso mais
comum em e-commerce, sem custo de IA nenhum), o produto já está pronto para
passar pelo wizard de enriquecimento normalmente.

## 8. Segurança

- `assertSafeUrl`/`fetchHtmlSafely` cobrem SSRF (DNS rebinding, IPs
  privados/metadata, protocolos não-http) — mesma barra do fetch de
  imagem já existente.
- Rate limit por uid no endpoint de scrape (seção 5.2).
- Erros de rede/SSRF nunca vazam detalhe pro cliente (mensagem genérica).
- Nenhum dado do usuário é enviado à IA além do HTML público da própria URL
  que ele forneceu — mesmo modelo de dados que `scanWebsite` já usa hoje.

## 9. Telemetria

Adicionar a `CLIENT_EVENT_NAMES` (`src/types/crm.ts:197-209`):

- `product_url_import_started` — `{ }`
- `product_url_import_success` — `{ source: 'structured'|'hybrid'|'ai' }`
- `product_url_import_fallback_manual` — `{ reason: 'scrape_failed'|'insufficient_data' }`
- `product_onboarding_step_completed` — `{ step: 'description'|'attributes'|'image', skipped: boolean }`

Enviados via o mesmo beacon `POST /api/events` (`crmTrack`, `src/analytics.ts`)
que os demais eventos client-side já usam — sem infra nova, só registrar os
nomes no allowlist e adicionar as funções de tracking correspondentes em
`analytics.ts`, seguindo o padrão de `trackDescriptionGenerated` etc.

## 10. Firestore rules

`isValidUser()` (`firestore.rules`) precisa aceitar o novo campo:

```
(!('productOnboarding' in data) || data.productOnboarding is map)
```

(seguindo o mesmo padrão usado para `phone`, adicionado recentemente).

## 11. Tratamento de erros / fallback

| Situação | Comportamento |
|---|---|
| Timeout (15s) no fetch | `source: 'failed'` → modal cai em `manual` (com contexto de fallback) |
| Site bloqueia (403/429/anti-bot) | idem |
| JSON-LD/OG ausentes, Gemini também não extrai nome | idem |
| URL aponta pra IP privado/interno | 400 genérico, mensagem "URL inválida" |
| Crédito insuficiente numa etapa de enriquecimento | mesmo alerta que `ensureCredits` já mostra hoje + oferece pular ou abrir `CreditPurchaseModal` |
| Falha ao gerar (erro de IA) numa etapa | mesma tratativa de erro que os handlers existentes já têm (não é território novo) |

## 12. Fora de escopo (MVP)

- Fluxo conversacional/chat (rejeitado no veredito do conselho).
- Detecção de variações/kits a partir da página raspada — produto simples
  único.
- Garantia de qualidade de extração para sites fora do padrão
  pt-BR/e-commerce comuns.
- Unificar `ProductEditModal` para suportar modo "criar" — o novo modal é
  deliberadamente separado; uma futura unificação é uma decisão à parte.
- Extrair um helper Gemini compartilhado no servidor — mantém o padrão
  atual (helper privado por módulo), consistente com `contentAgent.ts`.

## 13. Validação (sem suíte de testes automatizada no repo)

Checklist manual, via `npm run dev`:

- [ ] Scrape em 3-5 URLs reais de plataformas diferentes (Shopify, VTEX,
      WooCommerce, e um site SPA pesado em JS para forçar o fallback).
- [ ] `assertSafeUrl` rejeita `http://169.254.169.254/...` e
      `http://localhost/...` / IP privado.
- [ ] Fluxo completo em emulação mobile (Chrome DevTools) — popup, criação,
      3 passos de enriquecimento, tela final.
- [ ] Caminho "Quero inserir manualmente" a partir do `intro` (sem passar
      por URL nenhuma) chega ao `manual` com campos em branco.
- [ ] Botão "Criar produto" permanece desabilitado sem Título, Categoria ou
      Imagem preenchidos, em `review` e em `manual`.
- [ ] Upload de imagem via `<input type="file" capture="environment">` no
      mobile (foto/galeria) funciona fim a fim via `/api/upload`.
- [ ] Crédito debita corretamente em cada etapa e bloqueia corretamente em
      0 créditos (usando `CREDIT_ACTIONS` já configurados).
- [ ] Produto criado aparece na tabela normal, editável no `ProductEditModal`
      como qualquer outro produto após o wizard fechar.
- [ ] `npm run lint` limpo (checagem de tipos).

Se a lógica de parsing (JSON-LD/OG → `Partial<Product>`) for mantida como
função pura exportada em `server/productImport.ts`, considerar um script
`scripts/verify-product-url-import.mjs` no mesmo estilo de
`verify-crm-stage.mjs`, rodando contra HTML fixture (não URLs reais) —
opcional, não bloqueia o MVP.
