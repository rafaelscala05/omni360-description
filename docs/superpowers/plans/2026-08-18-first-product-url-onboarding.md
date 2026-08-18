# Onboarding do primeiro produto via URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao usuário mobile um caminho de zero-a-primeiro-produto-enriquecido sem planilha: colar a URL de um produto (ou preencher manualmente) → produto criado com Título/Categoria/Imagem obrigatórios → wizard guiado por Descrição, Atributos e Imagem ambientada com IA.

**Architecture:** Um endpoint novo (`POST /api/product-import/scrape`) faz fetch SSRF-guardado + parse determinístico (JSON-LD/OG) com fallback de IA server-side para lacunas. Um modal novo no client (`ProductUrlImportModal`) orquestra a criação do produto e, na sequência, reaproveita os handlers de geração por crédito que `App.tsx`/`ImageSearchModal` já têm — nenhuma lógica de IA nova no cliente.

**Tech Stack:** React 19 + TypeScript, Express + `tsx`, Firebase (Auth/Firestore client SDK + Admin SDK server-side), `@google/genai` (Vertex AI, server-side) / Firebase AI Logic (client-side, já existente), `cheerio` para parsing HTML, `motion/react` para transições.

**Spec:** `docs/superpowers/specs/2026-08-18-first-product-url-onboarding-design.md`

## Global Constraints

- Sem suíte de testes automatizada no repo (`CLAUDE.md`) — verificação é `npm run lint` (`tsc --noEmit`) + scripts `verify-*.mjs` para lógica pura + checklist manual via `npm run dev`.
- Todo texto de UI, prompts de IA e nomes de campo são pt-BR.
- Nenhuma escrita de Firestore nova no cliente para produtos — a persistência continua sendo o `saveToCloud`/autosave já existente em `App.tsx`.
- Título, Categoria e Imagem são obrigatórios para criar o produto (via scrape ou manual); a etapa de Descrição custa 1 crédito (`CREDIT_ACTIONS.generateSeoSingle`), a de Atributos é grátis, a de Imagem ambientada custa 1 crédito (`CREDIT_ACTIONS.ambientImage`).
- Erros de scrape/SSRF nunca travam o fluxo — sempre caem no formulário manual, nunca em uma tela de erro sem saída.
- Extensões de segurança (`assertSafeUrl`) vão para `server/safeUrl.ts` e são reutilizadas por qualquer módulo que precise (consolidação de `contentAgent.ts` incluída no escopo). Helpers de chamada Gemini server-side seguem o padrão existente (privados por módulo, sem extração de helper compartilhado).

---

## Task 1: `server/safeUrl.ts` — `assertSafeUrl` e `fetchHtmlSafely` genéricos

**Files:**
- Modify: `server/safeUrl.ts`

**Interfaces:**
- Produces: `assertSafeUrl(rawUrl: string): Promise<URL>`, `fetchHtmlSafely(rawUrl: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<string>` — usados por `server/productImport.ts` (Task 3) e `server/contentAgent.ts` (Task 2).
- `assertSafeImageUrl(rawUrl: string): Promise<void>` mantém a mesma assinatura externa (nenhum consumidor existente quebra).

- [ ] **Step 1: Fatorar a validação comum e adicionar as duas funções novas**

Substituir o corpo de `assertSafeImageUrl` (linhas 36-51) e adicionar as novas exports logo abaixo dele:

```ts
// Valida protocolo (só http/s) e resolve TODOS os endereços do host, rejeitando
// se qualquer um for interno — defesa contra SSRF/DNS rebinding. Compartilhada
// por qualquer fetch de URL fornecida pelo cliente (imagem ou página HTML).
async function assertSafeDestination(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Protocolo não permitido'), { status: 400 });
  }
  const results = await lookup(url.hostname, { all: true });
  if (!results.length || results.some((r) => isPrivateIp(r.address))) {
    throw Object.assign(new Error('Destino não permitido'), { status: 400 });
  }
  return url;
}

// Valida uma URL de imagem fornecida pelo cliente antes de o servidor buscá-la.
export async function assertSafeImageUrl(rawUrl: string): Promise<void> {
  await assertSafeDestination(rawUrl);
}

// Valida uma URL de página (produto/site) fornecida pelo cliente antes do scrape.
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  return assertSafeDestination(rawUrl);
}

// Busca o HTML de uma URL já validada por assertSafeUrl, com timeout e limite
// de tamanho. redirect: 'follow' (não 'error') é intencional — mesma escolha
// já aceita em scanWebsite (server/contentAgent.ts): produtos reais têm
// redirecionamentos comuns (http->https, www, slug canônico) e bloquear todos
// tornaria o scraping inútil na prática. O DNS já foi checado no destino
// inicial; hops de redirecionamento não são revalidados (risco aceito,
// idêntico ao já existente em scanWebsite).
export async function fetchHtmlSafely(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<string> {
  const url = await assertSafeUrl(rawUrl);
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxBytes = opts?.maxBytes ?? 2 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlfredBot/1.0)' },
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`Não foi possível acessar a página (${resp.status})`), { status: 502 });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw Object.assign(new Error('Página muito grande.'), { status: 400 });
    }
    return buf.toString('utf-8');
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw Object.assign(new Error('Tempo esgotado ao acessar a página'), { status: 504 });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros em `server/safeUrl.ts` (os 5 erros pré-existentes em `App.tsx`/`ProductEditModal.tsx` continuam, não são desta task).

- [ ] **Step 3: Commit**

```bash
git add server/safeUrl.ts
git commit -m "feat(server): add generic assertSafeUrl/fetchHtmlSafely to safeUrl.ts"
```

---

## Task 2: Consolidar `server/contentAgent.ts` para usar o `safeUrl.ts` compartilhado

**Files:**
- Modify: `server/contentAgent.ts`

**Interfaces:**
- Consumes: `assertSafeUrl`, `fetchHtmlSafely` de `server/safeUrl.ts` (Task 1).

- [ ] **Step 1: Remover a validação SSRF duplicada e trocar o fetch manual de `scanWebsite` por `fetchHtmlSafely`**

Remover `isPrivateIp` (linhas 274-283) e `assertSafeUrl` (linhas 285-300) locais. Remover os imports agora não usados `net` (linha 11) e `{ lookup } from 'dns/promises'` (linha 13) — confirmar antes que não há outro uso de `net.`/`lookup(` no arquivo (não há, conferido). Adicionar:

```ts
import { assertSafeUrl, fetchHtmlSafely } from './safeUrl';
```

Em `scanWebsite` (linhas 314-334), substituir o bloco de fetch manual:

```ts
async function scanWebsite(rawUrl: string): Promise<ScannedConfig> {
  const url = await assertSafeUrl(rawUrl);
  const html = await fetchHtmlSafely(rawUrl);

  // Extract a compact, readable digest of the page.
  const $ = cheerio.load(html);
  // ... (resto da função permanece idêntico, a partir de `$('script, style, noscript, svg').remove();`)
```

(Remove por completo o bloco `const controller = new AbortController(); ... } finally { clearTimeout(timer); }` que existia entre a linha da assinatura e o `cheerio.load` — `fetchHtmlSafely` já cobre timeout/abort/limite de tamanho.)

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 3: Verificação manual de regressão**

Via `npm run dev`, abrir o wizard do Content Agent (Agência de Criação de Conteúdo → novo projeto → "Preencher com IA a partir do site") e confirmar que `scanWebsite` ainda preenche os campos a partir de uma URL real — comportamento não pode ter mudado.

- [ ] **Step 4: Commit**

```bash
git add server/contentAgent.ts
git commit -m "refactor(server): consolidate contentAgent SSRF guard into safeUrl.ts"
```

---

## Task 3: `server/productImport.ts` — extração pura (JSON-LD/OG) + script de verificação

**Files:**
- Create: `server/productImport.ts`
- Create: `scripts/verify-product-import.mjs`

**Interfaces:**
- Produces: `parseProductFromHtml(html: string): ExtractedProductFields` (função pura, exportada) — consumida pela rota na Task 4 e pelo script de verificação.
- `interface ExtractedProductFields { title?: string; description?: string; price?: number; imageUrl?: string; brand?: string; }`

- [ ] **Step 1: Escrever o script de verificação (falhando) contra fixtures de HTML**

```js
// Verificação da extração pura de server/productImport.ts (JSON-LD/OG). Não
// sobe servidor, não faz fetch de rede. Rodar com:
// npx tsx scripts/verify-product-import.mjs
import { parseProductFromHtml } from '../server/productImport.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok' : 'FALHA'}  ${label}${
      ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`
    }`,
  );
}

// JSON-LD Product completo
const jsonLdHtml = `<html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"Tênis Esportivo Pro",
   "description":"Tênis leve para corrida","image":"https://loja.exemplo/img/tenis.jpg",
   "brand":{"@type":"Brand","name":"Alfred Sport"},
   "offers":{"@type":"Offer","price":"299.90","priceCurrency":"BRL"}}
  </script>
</head><body></body></html>`;
check('extrai JSON-LD completo', parseProductFromHtml(jsonLdHtml), {
  title: 'Tênis Esportivo Pro',
  description: 'Tênis leve para corrida',
  price: 299.9,
  imageUrl: 'https://loja.exemplo/img/tenis.jpg',
  brand: 'Alfred Sport',
});

// JSON-LD dentro de um array @graph / lista de scripts, com @type em array
const jsonLdArrayHtml = `<html><head>
  <script type="application/ld+json">[{"@type":["Product"],"name":"Camiseta Básica","image":["https://loja.exemplo/img/camiseta.jpg"]}]</script>
</head><body></body></html>`;
check('extrai JSON-LD quando @type é array e o payload é uma lista', parseProductFromHtml(jsonLdArrayHtml), {
  title: 'Camiseta Básica',
  imageUrl: 'https://loja.exemplo/img/camiseta.jpg',
});

// Sem JSON-LD, cai para Open Graph
const ogHtml = `<html><head>
  <meta property="og:title" content="Mochila Urbana" />
  <meta property="og:description" content="Mochila resistente à água" />
  <meta property="og:image" content="https://loja.exemplo/img/mochila.jpg" />
  <meta property="product:price:amount" content="189.9" />
</head><body></body></html>`;
check('extrai via Open Graph quando não há JSON-LD', parseProductFromHtml(ogHtml), {
  title: 'Mochila Urbana',
  description: 'Mochila resistente à água',
  price: 189.9,
  imageUrl: 'https://loja.exemplo/img/mochila.jpg',
});

// JSON-LD malformado não deve lançar exceção — cai para OG ou fica vazio
const brokenHtml = `<html><head>
  <script type="application/ld+json">{ isto não é json }</script>
  <meta property="og:title" content="Produto Recuperado" />
</head><body></body></html>`;
check('JSON-LD quebrado não derruba a extração, cai para OG', parseProductFromHtml(brokenHtml), {
  title: 'Produto Recuperado',
});

// Nenhum dado estruturado — retorna objeto vazio, nunca lança
check('sem JSON-LD nem OG retorna vazio', parseProductFromHtml('<html><head></head><body>oi</body></html>'), {});

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e confirmar que falha (módulo ainda não existe)**

Run: `npx tsx scripts/verify-product-import.mjs`
Expected: erro de módulo não encontrado (`server/productImport.ts` não existe ainda).

- [ ] **Step 3: Implementar `parseProductFromHtml`**

```ts
// Extração determinística de dados de produto a partir de HTML: tenta JSON-LD
// (schema.org/Product) primeiro, cai para Open Graph / meta tags de preço.
// Nunca lança — HTML malformado ou campos ausentes só resultam em campos
// vazios no retorno; quem decide o que fazer com isso é o chamador.
import * as cheerio from 'cheerio';

export interface ExtractedProductFields {
  title?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  brand?: string;
}

function firstImage(image: unknown): string | undefined {
  if (typeof image === 'string') return image;
  if (Array.isArray(image) && typeof image[0] === 'string') return image[0];
  if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
    return (image as { url: string }).url;
  }
  return undefined;
}

function parsePrice(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function extractFromJsonLd($: cheerio.CheerioAPI): ExtractedProductFields | null {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const script of scripts) {
    const raw = $(script).contents().text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const node = candidate as Record<string, unknown>;
      const type = node['@type'];
      const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      if (!isProduct) continue;

      const offers = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const brand = node.brand as { name?: string } | string | undefined;

      return {
        title: typeof node.name === 'string' ? node.name : undefined,
        description: typeof node.description === 'string' ? node.description : undefined,
        imageUrl: firstImage(node.image),
        price: parsePrice(offer?.price ?? offer?.lowPrice),
        brand: typeof brand === 'string' ? brand : brand?.name,
      };
    }
  }
  return null;
}

function extractFromOpenGraph($: cheerio.CheerioAPI): ExtractedProductFields {
  const meta = (name: string) => $(`meta[property="${name}"]`).attr('content')?.trim();
  return {
    title: meta('og:title'),
    description: meta('og:description'),
    imageUrl: meta('og:image'),
    price: parsePrice(meta('product:price:amount') ?? $('[itemprop="price"]').attr('content')),
  };
}

function dropEmpty(fields: ExtractedProductFields): ExtractedProductFields {
  const out: ExtractedProductFields = {};
  if (fields.title) out.title = fields.title;
  if (fields.description) out.description = fields.description;
  if (typeof fields.price === 'number') out.price = fields.price;
  if (fields.imageUrl) out.imageUrl = fields.imageUrl;
  if (fields.brand) out.brand = fields.brand;
  return out;
}

export function parseProductFromHtml(html: string): ExtractedProductFields {
  const $ = cheerio.load(html);
  const fromJsonLd = extractFromJsonLd($);
  const fromOg = extractFromOpenGraph($);
  // JSON-LD é a fonte primária; OG só preenche o que faltou.
  return dropEmpty({ ...fromOg, ...fromJsonLd });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsx scripts/verify-product-import.mjs`
Expected: `Todas as verificações passaram.`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add server/productImport.ts scripts/verify-product-import.mjs
git commit -m "feat(server): add pure JSON-LD/OG product extraction with verify script"
```

---

## Task 4: `server/productImport.ts` — rota `POST /api/product-import/scrape`

**Files:**
- Modify: `server/productImport.ts` (adiciona a rota ao arquivo criado na Task 3)

**Interfaces:**
- Consumes: `parseProductFromHtml` (Task 3), `assertSafeUrl`/`fetchHtmlSafely` (Task 1).
- Produces: `registerProductImportRoutes(app: express.Application, deps: { verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }> }): void` — consumida por `server.ts` (Task 5).
- Resposta HTTP: `{ product: ExtractedProductFields, source: 'structured' | 'hybrid' | 'ai' | 'failed' }`.

- [ ] **Step 1: Adicionar o cliente Gemini server-side (mesmo padrão privado de `contentAgent.ts`) e o handler da rota**

Acrescentar ao topo de `server/productImport.ts` (abaixo dos imports/tipos da Task 3):

```ts
import type express from 'express';
import { GoogleGenAI } from '@google/genai';
import firebaseAppletConfig from '../firebase-applet-config.json';
import { assertSafeUrl, fetchHtmlSafely } from './safeUrl';

const TEXT_MODEL = 'gemini-2.5-flash';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

function getClient(): GoogleGenAI {
  if (!VERTEX_PROJECT) {
    throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor'), { status: 500 });
  }
  return new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('temporarily');
      if (is503 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function parseJson<T = unknown>(text: string): T {
  let cleaned = (text || '').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned || '{}');
  } catch {
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('A IA não retornou um JSON válido.');
  }
}

// Preenche description/title quando o parsing estruturado não trouxe o
// suficiente, a partir de um digest de texto da página (mesmo padrão de
// scanWebsite em contentAgent.ts).
async function fillGapsWithAi(html: string, url: string): Promise<{ title?: string; description?: string }> {
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const title = $('title').first().text().trim();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
  const digest = [`URL: ${url}`, title && `Título da página: ${title}`, `Conteúdo: ${bodyText}`].filter(Boolean).join('\n');

  const prompt = [
    'A partir do conteúdo de página de produto abaixo, infira nome e uma descrição curta do produto.',
    'Responda ESTRITAMENTE em JSON: {"title":"...","description":"..."}',
    'Se não for possível inferir algum campo, deixe como string vazia. Português do Brasil.',
    '',
    digest,
  ].join('\n');

  const ai = getClient();
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
  );
  const parsed = parseJson<{ title?: string; description?: string }>(resp.text ?? '{}');
  return { title: parsed.title || undefined, description: parsed.description || undefined };
}

interface ProductImportDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

function sendError(res: express.Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  console.error('product-import endpoint error:', err);
  res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno' });
}

// Rate limit simples por uid (mitigação contra abuso do endpoint como proxy de
// scraping). Em memória: não sobrevive a restart/múltiplas instâncias — risco
// aceito, não há evidência de deploy multi-instância neste projeto hoje.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const requestLog = new Map<string, number[]>();

function checkRateLimit(uid: string): void {
  const now = Date.now();
  const timestamps = (requestLog.get(uid) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    throw Object.assign(new Error('Muitas tentativas. Tente novamente mais tarde.'), { status: 429 });
  }
  timestamps.push(now);
  requestLog.set(uid, timestamps);
}

export function registerProductImportRoutes(app: express.Application, deps: ProductImportDeps): void {
  app.post('/api/product-import/scrape', async (req, res) => {
    try {
      const { uid } = await deps.verifyFirebaseToken(req);
      checkRateLimit(uid);

      const rawUrl = String(req.body?.url ?? '').trim();
      if (!rawUrl) {
        throw Object.assign(new Error('URL é obrigatória'), { status: 422 });
      }
      await assertSafeUrl(rawUrl);

      let html: string;
      try {
        html = await fetchHtmlSafely(rawUrl);
      } catch (fetchErr) {
        console.warn('product-import: fetch falhou', (fetchErr as Error).message);
        return res.json({ product: {}, source: 'failed' });
      }

      const structured = parseProductFromHtml(html);
      const needsAiGaps = !structured.title || !structured.description || structured.description.length < 40;

      if (!needsAiGaps) {
        return res.json({ product: structured, source: 'structured' });
      }

      try {
        const gaps = await fillGapsWithAi(html, rawUrl);
        const merged = {
          ...structured,
          title: structured.title || gaps.title,
          description: structured.description || gaps.description,
        };
        const source = Object.keys(structured).length > 0 ? 'hybrid' : 'ai';
        return res.json({ product: merged, source });
      } catch (aiErr) {
        console.warn('product-import: preenchimento por IA falhou', (aiErr as Error).message);
        // Estruturado parcial ainda é útil — devolve o que temos.
        return res.json({ product: structured, source: Object.keys(structured).length > 0 ? 'structured' : 'failed' });
      }
    } catch (err) {
      sendError(res, err);
    }
  });
}
```

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 3: Verificação manual do endpoint**

Com `npm run dev` rodando e um usuário autenticado no app (pegar o ID token do `localStorage`/DevTools ou via `auth.currentUser.getIdToken()` no console do browser), rodar:

```bash
curl -X POST http://localhost:3000/api/product-import/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -d '{"url":"https://exemplo-loja-real.com/produto/123"}'
```

Expected: JSON `{ product: {...}, source: '...' }` com HTTP 200. Testar também com `"url":"http://169.254.169.254/"` — deve retornar 400 "URL inválida"/"Destino não permitido".

- [ ] **Step 4: Commit**

```bash
git add server/productImport.ts
git commit -m "feat(server): add POST /api/product-import/scrape route"
```

---

## Task 5: Registrar a rota em `server.ts`

**Files:**
- Modify: `server.ts:29-31` (imports), `server.ts:155-156` (registro)

- [ ] **Step 1: Importar e registrar**

Em `server.ts`, junto aos imports existentes (perto da linha 29):

```ts
import { registerProductImportRoutes } from "./server/productImport";
```

Junto ao bloco de registro de onboarding/referral (linha 154-156):

```ts
  registerOnboardingRoutes(app, { verifyFirebaseToken });
  registerReferralRoutes(app, { verifyFirebaseToken });
  registerProductImportRoutes(app, { verifyFirebaseToken });
```

- [ ] **Step 2: Checar tipos e subir o servidor**

Run: `npm run lint`
Expected: sem erros novos.

Run: `npm run dev` (deixar rodando) e confirmar no log que o servidor sobe sem exceção de import.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat(server): register product-import routes"
```

---

## Task 6: `firestore.rules` — permitir `productOnboarding`

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Adicionar o campo a `isValidUser()`**

Igual ao padrão já usado para `phone` (adicionado recentemente):

```
      return (!('email' in data) || data.email is string || data.email == null) &&
             (!('displayName' in data) || data.displayName is string || data.displayName == null) &&
             (!('phone' in data) || data.phone is string || data.phone == null) &&
             (!('productOnboarding' in data) || data.productOnboarding is map) &&
             (!('credits' in data) || data.credits is number) &&
             (!('lastSync' in data) || data.lastSync is string);
```

- [ ] **Step 2: Commit**

```bash
git add firestore.rules
git commit -m "feat(firestore): allow productOnboarding field on user doc"
```

(Deploy das rules não faz parte deste plano — segue o processo normal do time para publicar `firestore.rules`.)

---

## Task 7: `src/services/apiClient.ts` — extrair `callJson` compartilhado

**Files:**
- Create: `src/services/apiClient.ts`
- Modify: `src/services/onboardingService.ts`

**Interfaces:**
- Produces: `callJson<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T>` — consumida por `onboardingService.ts` e, na Task 8, por `productImportService.ts`.

- [ ] **Step 1: Criar `apiClient.ts` com o conteúdo hoje duplicado só em `onboardingService.ts`**

```ts
// Helper HTTP compartilhado para chamar as rotas /api/* autenticadas do
// servidor a partir do client — anexa o Firebase ID token e normaliza erros.
import { auth } from '../firebase';

export async function callJson<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const token = await user.getIdToken();
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}
```

- [ ] **Step 2: Apontar `onboardingService.ts` para o helper compartilhado**

Em `src/services/onboardingService.ts`, remover a definição local de `callJson` (linhas 7-21) e adicionar:

```ts
import { callJson } from './apiClient';
```

(As três funções `lookupCnpj`/`completeOnboarding`/`saveCompanyProfile` continuam idênticas, só passam a chamar o `callJson` importado.)

- [ ] **Step 3: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 4: Verificação manual de regressão**

Via `npm run dev`, abrir o wizard de onboarding de conta (perfil/empresa) e confirmar que a consulta de CNPJ e o "Finalizar" ainda funcionam.

- [ ] **Step 5: Commit**

```bash
git add src/services/apiClient.ts src/services/onboardingService.ts
git commit -m "refactor(client): extract shared callJson into apiClient.ts"
```

---

## Task 8: `src/services/productImportService.ts` e `src/services/uploadService.ts`

**Files:**
- Create: `src/services/productImportService.ts`
- Create: `src/services/uploadService.ts`

**Interfaces:**
- Consumes: `callJson` (Task 7).
- Produces: `scrapeProductUrl(url: string): Promise<{ product: ScrapedProductFields; source: 'structured' | 'hybrid' | 'ai' | 'failed' }>`, `uploadProductImage(file: File): Promise<string>` — ambas consumidas pelos componentes de UI (Tasks 13-14).

- [ ] **Step 1: `productImportService.ts`**

```ts
import { callJson } from './apiClient';

export interface ScrapedProductFields {
  title?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  brand?: string;
}

export interface ScrapeProductUrlResult {
  product: ScrapedProductFields;
  source: 'structured' | 'hybrid' | 'ai' | 'failed';
}

export async function scrapeProductUrl(url: string): Promise<ScrapeProductUrlResult> {
  return callJson('/api/product-import/scrape', 'POST', { url });
}
```

- [ ] **Step 2: `uploadService.ts`**

Mesmo padrão já usado em `src/modules/content/blog/PostEditor.tsx:20-39` (base64 → `POST /api/upload` → `{ url }`), extraído para reuso:

```ts
import { auth } from '../firebase';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadProductImage(file: File): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const dataUrl = await readFileAsDataUrl(file);
  const token = await user.getIdToken();
  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageBase64: dataUrl, filename: file.name }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  }
  const data = (await resp.json()) as { url: string };
  return data.url;
}
```

- [ ] **Step 3: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 4: Commit**

```bash
git add src/services/productImportService.ts src/services/uploadService.ts
git commit -m "feat(client): add productImportService and uploadService"
```

---

## Task 9: `src/services/productService.ts` — extrair `suggestProductAttributes` e refatorar `ProductEditModal`

**Files:**
- Modify: `src/services/productService.ts`
- Modify: `src/components/modals/ProductEditModal.tsx:410-491`

**Interfaces:**
- Consumes: `generateProductAttributes`, `generateAttributesFromImage` (já existentes em `productService.ts`).
- Produces: `suggestProductAttributes(product: Partial<Product>, effectiveAttributes: AttributeDefinition[]): Promise<{ attributes: Record<string, AttributeValue>; suggestedNewAttributes: AttributeDefinition[] }>` — consumida por `ProductEditModal.tsx` (este task) e pelo wizard novo (Task 15).

- [ ] **Step 1: Adicionar `suggestProductAttributes` a `productService.ts`**

Combina os dois caminhos (texto + imagem) que hoje vivem inline em `ProductEditModal.handleAnalyze` (linhas 410-491), preservando o comportamento exato: cada chamada falha independentemente sem derrubar a outra; imagem sobrescreve texto em caso de conflito de chave; `source` usa o valor válido do tipo `AttributeValue['source']` (`'manual' | 'ai' | 'imported'` — `'ai'`, não os `'text_ai'`/`'image_ai'` inválidos que o código atual usa, que são um bug pré-existente fora do escopo desta task):

```ts
export async function suggestProductAttributes(
  product: Partial<Product>,
  effectiveAttributes: AttributeDefinition[],
): Promise<{ attributes: Record<string, AttributeValue>; suggestedNewAttributes: AttributeDefinition[] }> {
  const attributes: Record<string, AttributeValue> = {};
  let suggestedNewAttributes: AttributeDefinition[] = [];

  try {
    const textResult = await generateProductAttributes(product, effectiveAttributes);
    if (textResult.attributes) {
      Object.keys(textResult.attributes).forEach((key) => {
        attributes[key] = { value: textResult.attributes[key].value, confirmed: false, aiSuggested: true, source: 'ai' };
      });
    }
    if (textResult.suggestedNewAttributes) {
      suggestedNewAttributes = [...suggestedNewAttributes, ...textResult.suggestedNewAttributes];
    }
  } catch (e) {
    console.error('Erro na análise de texto:', e);
  }

  const imageUrl = product._selectedImage || product['URL imagem 1'];
  if (imageUrl) {
    try {
      let base64 = imageUrl;
      if (!base64.startsWith('data:')) {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const blob = await response.blob();
          base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      }
      if (base64.startsWith('data:')) {
        const imageResult = await generateAttributesFromImage(base64, effectiveAttributes, product);
        if (imageResult.attributes) {
          Object.keys(imageResult.attributes).forEach((key) => {
            attributes[key] = { value: imageResult.attributes[key].value, confirmed: false, aiSuggested: true, source: 'ai' };
          });
        }
        if (imageResult.suggestedNewAttributes) {
          suggestedNewAttributes = [...suggestedNewAttributes, ...imageResult.suggestedNewAttributes];
        }
      }
    } catch (e) {
      console.error('Erro na análise de imagem:', e);
    }
  }

  const uniqueSuggested = suggestedNewAttributes.reduce<AttributeDefinition[]>((acc, curr) => {
    if (!acc.find((a) => a.key === curr.key)) acc.push(curr);
    return acc;
  }, []);

  return { attributes, suggestedNewAttributes: uniqueSuggested };
}
```

(Adicionar `AttributeValue` ao import de tipos no topo de `productService.ts`, junto de `AttributeDefinition`/`Product` que já são importados lá.)

- [ ] **Step 2: Refatorar `ProductEditModal.handleAnalyze` para usar a função extraída**

Substituir o corpo de `handleAnalyze` (linhas 410-491 de `src/components/modals/ProductEditModal.tsx`) por:

```ts
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setSuggestedAttributes([]);
    const result = await suggestProductAttributes(editedProduct, effectiveAttributes);
    setSuggestedAttributes(result.suggestedNewAttributes);

    const hasUpdates = Object.keys(result.attributes).length > 0;
    if (hasUpdates) {
      setEditedProduct((prev) => ({ ...prev, attributes: { ...(prev.attributes || {}), ...result.attributes } }));
      const hasImage = !!(editedProduct._selectedImage || editedProduct['URL imagem 1']);
      trackAttributesGenerated({ source: hasImage ? 'image' : 'text', sku: editedProduct['Código (SKU)'] as string });
    } else if (result.suggestedNewAttributes.length === 0) {
      alert('A IA não encontrou novos atributos.');
    }
    setIsAnalyzing(false);
  };
```

Adicionar `suggestProductAttributes` ao import de `productService` já existente no topo do arquivo, e remover os imports de `generateProductAttributes`/`generateAttributesFromImage` que deixam de ser usados diretamente neste arquivo (checar antes que não há outro uso deles em `ProductEditModal.tsx` — não há, ambos só apareciam dentro do `handleAnalyze` que acabou de ser substituído).

- [ ] **Step 3: Checar tipos**

Run: `npm run lint`
Expected: os mesmos 5 erros pré-existentes (incluindo os `'text_ai'`/`'image_ai'` que ainda existem em `App.tsx:1448` e no `handleSyncToCategory`/resto de `ProductEditModal.tsx` fora do trecho tocado) — nenhum erro NOVO. Se o número de erros cair (porque removemos duas das quatro ocorrências de `source: 'text_ai'|'image_ai'` inválidas), está correto e esperado.

- [ ] **Step 4: Verificação manual de regressão**

Via `npm run dev`, abrir um produto existente no `ProductEditModal`, aba "Atributos", clicar "Analisar" e confirmar que os atributos sugeridos por texto e (se houver imagem) por imagem continuam aparecendo, e que "A IA não encontrou novos atributos." ainda aparece quando cabível.

- [ ] **Step 5: Commit**

```bash
git add src/services/productService.ts src/components/modals/ProductEditModal.tsx
git commit -m "refactor(client): extract suggestProductAttributes, reuse in ProductEditModal"
```

---

## Task 10: Eventos de telemetria — `CLIENT_EVENT_NAMES` e `src/analytics.ts`

**Files:**
- Modify: `src/types/crm.ts:197-209`
- Modify: `src/analytics.ts`

**Interfaces:**
- Produces: `trackProductUrlImportStarted(): void`, `trackProductUrlImportResult(params: { source: 'structured' | 'hybrid' | 'ai' | 'failed' | 'manual' }): void`, `trackOnboardingStepCompleted(params: { step: 'description' | 'attributes' | 'image'; skipped: boolean }): void` — consumidas pelo modal (Tasks 13-14).

- [ ] **Step 1: Adicionar os 3 nomes de evento ao allowlist**

Em `src/types/crm.ts`, dentro do array `CLIENT_EVENT_NAMES` (linha 197), adicionar:

```ts
  'category_hierarchy_generated',
  'product_url_import_started',
  'product_url_import_result',
  'onboarding_step_completed',
] as const;
```

- [ ] **Step 2: Adicionar os trackers em `src/analytics.ts`**

Seguindo exatamente o padrão dos trackers existentes (GA4 + `crmTrack`, sem Meta/TikTok pois não são eventos de otimização de anúncio):

```ts
// Extra: Onboarding de primeiro produto via URL
export function trackProductUrlImportStarted() {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_url_import_started');
  crmTrack('product_url_import_started');
}

export function trackProductUrlImportResult(params: { source: 'structured' | 'hybrid' | 'ai' | 'failed' | 'manual' }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'product_url_import_result', params);
  crmTrack('product_url_import_result', params);
}

export function trackOnboardingStepCompleted(params: { step: 'description' | 'attributes' | 'image'; skipped: boolean }) {
  const a = getAnalyticsInstance();
  if (a) logEvent(a, 'onboarding_step_completed', params);
  crmTrack('onboarding_step_completed', params);
}
```

- [ ] **Step 3: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 4: Commit**

```bash
git add src/types/crm.ts src/analytics.ts
git commit -m "feat(client): add telemetry events for product URL onboarding"
```

---

## Task 11: `src/components/onboarding/ProductFormFields.tsx` — formulário compartilhado (Título/Categoria/Imagem/Preço)

**Files:**
- Create: `src/components/onboarding/ProductFormFields.tsx`

**Interfaces:**
- Produces: componente `<ProductFormFields />`, usado pelos passos `review` e `manual` (Task 13).

```ts
export interface ProductFormValue {
  title: string;
  categoryId: string;
  imageUrl: string;
  price: string;
  description: string;
}

interface Props {
  value: ProductFormValue;
  onChange: (value: ProductFormValue) => void;
  categories: Category[];
  onUploadImage: (file: File) => Promise<void>;
  isUploadingImage: boolean;
}
```

- [ ] **Step 1: Implementar o componente**

```tsx
import React, { useRef } from 'react';
import { Upload, Link as LinkIcon } from 'lucide-react';
import type { Category } from '../../types/models';

export interface ProductFormValue {
  title: string;
  categoryId: string;
  imageUrl: string;
  price: string;
  description: string;
}

interface Props {
  value: ProductFormValue;
  onChange: (value: ProductFormValue) => void;
  categories: Category[];
  onUploadImage: (file: File) => Promise<void>;
  isUploadingImage: boolean;
}

const ProductFormFields: React.FC<Props> = ({ value, onChange, categories, onUploadImage, isUploadingImage }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<ProductFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Imagem *</label>
        {value.imageUrl ? (
          <div className="flex items-center gap-3">
            <img src={value.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-orange-600 font-semibold hover:text-orange-700"
            >
              Trocar imagem
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingImage}
              className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm font-semibold text-slate-500 hover:border-orange-400 hover:text-orange-600 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {isUploadingImage ? 'Enviando...' : 'Anexar foto'}
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUploadImage(file);
            e.target.value = '';
          }}
        />
        <div className="flex items-center gap-2 mt-1">
          <LinkIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="url"
            value={value.imageUrl}
            onChange={(e) => set({ imageUrl: e.target.value })}
            placeholder="ou cole a URL de uma imagem"
            className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Título do produto *</label>
        <input
          type="text"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Ex: Tênis Esportivo Pro"
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Categoria *</label>
        <select
          value={value.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all appearance-none cursor-pointer"
        >
          <option value="">Selecione uma categoria...</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.path.join(' > ')}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Preço (opcional)</label>
        <input
          type="text"
          value={value.price}
          onChange={(e) => set({ price: e.target.value })}
          placeholder="Ex: 199,90"
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
        />
      </div>
    </div>
  );
};

export default ProductFormFields;
export function isProductFormValid(value: ProductFormValue): boolean {
  return !!(value.title.trim() && value.categoryId && value.imageUrl.trim());
}
```

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/ProductFormFields.tsx
git commit -m "feat(client): add shared ProductFormFields for URL onboarding"
```

---

## Task 12: `src/components/onboarding/EnrichmentStepCard.tsx` — passo genérico de enriquecimento

**Files:**
- Create: `src/components/onboarding/EnrichmentStepCard.tsx`

**Interfaces:**
- Produces: `<EnrichmentStepCard />`, reutilizado pelos passos `enrich-description` e `enrich-attributes` (Task 14).

```ts
interface Props {
  icon: React.ElementType;
  title: string;
  description: string;
  costLabel: string; // ex.: "1 crédito" ou "Grátis"
  isRunning: boolean;
  isDone: boolean;
  error: string | null;
  onRun: () => void;
  onSkip: () => void;
}
```

- [ ] **Step 1: Implementar**

```tsx
import React from 'react';
import { Check, Loader2 } from 'lucide-react';

interface Props {
  icon: React.ElementType;
  title: string;
  description: string;
  costLabel: string;
  isRunning: boolean;
  isDone: boolean;
  error: string | null;
  onRun: () => void;
  onSkip: () => void;
}

const EnrichmentStepCard: React.FC<Props> = ({ icon: Icon, title, description, costLabel, isRunning, isDone, error, onRun, onSkip }) => {
  return (
    <div className="text-center py-4">
      <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4 ${isDone ? 'bg-emerald-50' : 'bg-orange-50'}`}>
        {isDone ? <Check className="w-7 h-7 text-emerald-500" /> : <Icon className="w-7 h-7 text-orange-500" />}
      </div>
      <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>
      {!isDone && <p className="text-xs text-slate-400 mt-2 font-semibold uppercase tracking-wide">{costLabel}</p>}
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{error}</p>}

      {!isDone && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={onSkip}
            disabled={isRunning}
            className="px-5 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            Pular
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors disabled:opacity-50"
          >
            {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
            {isRunning ? 'Gerando...' : 'Gerar'}
          </button>
        </div>
      )}
    </div>
  );
};

export default EnrichmentStepCard;
```

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/EnrichmentStepCard.tsx
git commit -m "feat(client): add generic EnrichmentStepCard for onboarding wizard"
```

---

## Task 13: `src/components/onboarding/ProductUrlImportModal.tsx` — passos intro/loading/review/manual

**Files:**
- Create: `src/components/onboarding/ProductUrlImportModal.tsx`

**Interfaces:**
- Consumes: `scrapeProductUrl` (Task 8), `uploadProductImage` (Task 8), `<ProductFormFields />`/`isProductFormValid` (Task 11), `trackProductUrlImportStarted`/`trackProductUrlImportResult` (Task 10).
- Produces: componente `<ProductUrlImportModal />` com a props abaixo — a Task 14 completa os passos de enriquecimento dentro deste mesmo arquivo, e a Task 15 o consome de `App.tsx`.

```ts
export type WizardStep =
  | 'intro' | 'loading' | 'review' | 'manual'
  | 'enrich-description' | 'enrich-attributes' | 'enrich-image' | 'done';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  initialStep?: WizardStep;               // usado para retomar após o ImageSearchModal (Task 15)
  initialProduct?: Product | null;        // idem
  onProductCreated: (product: Product) => void;
  onGenerateDescription: (id: string) => Promise<void>;
  onSuggestAttributes: (id: string) => Promise<boolean>;
  onOpenImageSearch: (id: string) => void; // delega para App.tsx abrir o ImageSearchModal
  onFinish: () => void;                    // fecha e volta ao dashboard
  descriptionCreditCost: number;
  currentCredits: number;
}
```

- [ ] **Step 1: Implementar o shell + passos `intro`/`loading`/`review`/`manual`**

```tsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Link as LinkIcon, PenLine, Camera, Tag, FolderTree } from 'lucide-react';
import type { Category, Product } from '../../types/models';
import { scrapeProductUrl, type ScrapeProductUrlResult } from '../../services/productImportService';
import { uploadProductImage } from '../../services/uploadService';
import { trackProductUrlImportStarted, trackProductUrlImportResult } from '../../analytics';
import ProductFormFields, { isProductFormValid, type ProductFormValue } from './ProductFormFields';

export type WizardStep =
  | 'intro' | 'loading' | 'review' | 'manual'
  | 'enrich-description' | 'enrich-attributes' | 'enrich-image' | 'done';

export interface ProductUrlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  initialStep?: WizardStep;
  initialProduct?: Product | null;
  onProductCreated: (product: Product) => void;
  onGenerateDescription: (id: string) => Promise<void>;
  onSuggestAttributes: (id: string) => Promise<boolean>;
  onOpenImageSearch: (id: string) => void;
  onFinish: () => void;
  descriptionCreditCost: number;
  currentCredits: number;
}

const emptyForm: ProductFormValue = { title: '', categoryId: '', imageUrl: '', price: '', description: '' };

function buildProduct(form: ProductFormValue, categories: Category[]): Product {
  const category = categories.find((c) => c.id === form.categoryId);
  return {
    _id: `prod_url_${Date.now()}`,
    _statusDescricao: 'Sem descrição',
    _statusSEO: 'Sem SEO',
    _isDirty: true,
    _selectedImage: form.imageUrl,
    'Descrição': form.title,
    'Descrição complementar': form.description || undefined,
    'Categoria': category?.path.join(' > '),
    categoryId: form.categoryId || undefined,
    categoryPath: category?.path,
    'Preço': form.price || undefined,
    'URL imagem externa 1': form.imageUrl,
  };
}

const ProductUrlImportModal: React.FC<ProductUrlImportModalProps> = ({
  isOpen, onClose, categories, initialStep, initialProduct,
  onProductCreated, onGenerateDescription, onSuggestAttributes, onOpenImageSearch, onFinish,
  descriptionCreditCost, currentCredits,
}) => {
  const [step, setStep] = useState<WizardStep>(initialStep ?? 'intro');
  const [product, setProduct] = useState<Product | null>(initialProduct ?? null);
  const [url, setUrl] = useState('');
  const [form, setForm] = useState<ProductFormValue>(emptyForm);
  const [manualReason, setManualReason] = useState<'chosen' | 'fallback' | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAnalyzeUrl = async () => {
    if (!url.trim()) return;
    setStep('loading');
    setError(null);
    trackProductUrlImportStarted();
    let result: ScrapeProductUrlResult;
    try {
      result = await scrapeProductUrl(url.trim());
    } catch (e) {
      trackProductUrlImportResult({ source: 'failed' });
      setManualReason('fallback');
      setForm(emptyForm);
      setStep('manual');
      return;
    }
    trackProductUrlImportResult({ source: result.source });
    if (result.source === 'failed' || !result.product.title) {
      setManualReason('fallback');
      setForm({ ...emptyForm, imageUrl: result.product.imageUrl ?? '' });
      setStep('manual');
      return;
    }
    setForm({
      title: result.product.title ?? '',
      categoryId: '',
      imageUrl: result.product.imageUrl ?? '',
      price: result.product.price != null ? String(result.product.price) : '',
      description: result.product.description ?? '',
    });
    setStep('review');
  };

  const handleUploadImage = async (file: File) => {
    setIsUploadingImage(true);
    try {
      const uploadedUrl = await uploadProductImage(file);
      setForm((prev) => ({ ...prev, imageUrl: uploadedUrl }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar imagem.');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleCreateProduct = () => {
    const created = buildProduct(form, categories);
    setProduct(created);
    onProductCreated(created);
    setStep('enrich-description');
  };

  const renderIntro = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { icon: Camera, label: 'Imagem', hint: 'obrigatória' },
          { icon: Tag, label: 'Título', hint: '' },
          { icon: FolderTree, label: 'Categoria', hint: '' },
        ].map(({ icon: Icon, label, hint }) => (
          <div key={label} className="bg-slate-50 rounded-xl p-3">
            <Icon className="w-5 h-5 mx-auto text-orange-500 mb-1.5" />
            <p className="text-xs font-bold text-slate-700">{label}</p>
            {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500 text-center">O resto — descrição, atributos e imagens ambientadas — a IA faz por você.</p>

      <div className="space-y-2">
        <div className="relative">
          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Cole o link do produto"
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <button
          type="button"
          onClick={handleAnalyzeUrl}
          disabled={!url.trim()}
          className="w-full py-3 px-4 bg-[#FF5B03] text-white rounded-xl font-bold hover:bg-[#E14E00] transition-all disabled:opacity-50"
        >
          Analisar produto
        </button>
      </div>

      <button
        type="button"
        onClick={() => { setManualReason('chosen'); setForm(emptyForm); setStep('manual'); }}
        className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
      >
        <PenLine className="w-4 h-4" /> Quero inserir manualmente meu produto
      </button>
    </div>
  );

  const renderLoading = () => (
    <div className="text-center py-10">
      <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
      <p className="text-sm text-slate-500">Lendo a página do seu produto...</p>
    </div>
  );

  const renderForm = (isManual: boolean) => (
    <div className="space-y-4">
      {isManual && manualReason === 'fallback' && (
        <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Não conseguimos ler essa página automaticamente — sem problema, preencha à mão.
        </p>
      )}
      <ProductFormFields
        value={form}
        onChange={setForm}
        categories={categories}
        onUploadImage={handleUploadImage}
        isUploadingImage={isUploadingImage}
      />
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <button
        type="button"
        onClick={handleCreateProduct}
        disabled={!isProductFormValid(form)}
        className="w-full py-3.5 px-4 bg-[#FF5B03] text-white rounded-xl font-bold hover:bg-[#E14E00] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Criar produto
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="max-w-lg w-full my-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#141311] to-[#1e3a8a] p-6 mb-6 text-white shadow-lg">
          <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <h2 className="font-display text-xl font-bold tracking-tight">Cadastre seu primeiro produto</h2>
          <p className="text-sm text-white/70">Cole o link ou preencha na mão — a IA cuida do resto.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 md:p-8 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
              {step === 'intro' && renderIntro()}
              {step === 'loading' && renderLoading()}
              {step === 'review' && renderForm(false)}
              {step === 'manual' && renderForm(true)}
              {/* enrich-description / enrich-attributes / enrich-image / done: Task 14 */}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default ProductUrlImportModal;
```

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros (o componente ainda não trata os passos `enrich-*`/`done` — isso é intencional, completado na Task 14 antes deste componente ser conectado ao `App.tsx` na Task 15).

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/ProductUrlImportModal.tsx
git commit -m "feat(client): add ProductUrlImportModal intro/loading/review/manual steps"
```

---

## Task 14: `ProductUrlImportModal.tsx` — passos de enriquecimento e tela final

**Files:**
- Modify: `src/components/onboarding/ProductUrlImportModal.tsx` (Task 13)

**Interfaces:**
- Consumes: `<EnrichmentStepCard />` (Task 12), `trackOnboardingStepCompleted` (Task 10).

- [ ] **Step 1: Adicionar os passos de enriquecimento e a tela final**

Adicionar ao topo do arquivo:

```ts
import { FileText, Tags, Image as ImageIcon, PartyPopper } from 'lucide-react';
import EnrichmentStepCard from './EnrichmentStepCard';
import { trackOnboardingStepCompleted } from '../../analytics';
```

Adicionar estado de execução dentro do componente (junto aos `useState` já existentes):

```ts
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
```

Adicionar os handlers (dentro do componente, próximos a `handleCreateProduct`):

```ts
  const handleGenerateDescription = async () => {
    if (!product) return;
    setIsRunningStep(true);
    setStepError(null);
    try {
      await onGenerateDescription(product._id);
      trackOnboardingStepCompleted({ step: 'description', skipped: false });
      setStep('enrich-attributes');
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Erro ao gerar descrição.');
    } finally {
      setIsRunningStep(false);
    }
  };

  const handleSuggestAttributes = async () => {
    if (!product) return;
    setIsRunningStep(true);
    setStepError(null);
    try {
      await onSuggestAttributes(product._id);
      trackOnboardingStepCompleted({ step: 'attributes', skipped: false });
      setStep('enrich-image');
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Erro ao sugerir atributos.');
    } finally {
      setIsRunningStep(false);
    }
  };

  const skipStep = (step: 'description' | 'attributes' | 'image', next: WizardStep) => {
    trackOnboardingStepCompleted({ step, skipped: true });
    setStep(next);
  };
```

Adicionar os blocos de render dentro do `<AnimatePresence>`, logo após `{step === 'manual' && renderForm(true)}`:

```tsx
              {step === 'enrich-description' && (
                <EnrichmentStepCard
                  icon={FileText}
                  title="Gerar descrição com IA"
                  description="Criamos uma descrição de venda a partir do título, categoria e imagem do produto."
                  costLabel={`${descriptionCreditCost} crédito${descriptionCreditCost === 1 ? '' : 's'} · você tem ${currentCredits}`}
                  isRunning={isRunningStep}
                  isDone={false}
                  error={stepError}
                  onRun={handleGenerateDescription}
                  onSkip={() => skipStep('description', 'enrich-attributes')}
                />
              )}
              {step === 'enrich-attributes' && (
                <EnrichmentStepCard
                  icon={Tags}
                  title="Sugerir atributos"
                  description="A IA analisa o texto e a imagem do produto e sugere atributos da categoria."
                  costLabel="Grátis"
                  isRunning={isRunningStep}
                  isDone={false}
                  error={stepError}
                  onRun={handleSuggestAttributes}
                  onSkip={() => skipStep('attributes', 'enrich-image')}
                />
              )}
              {step === 'enrich-image' && (
                <EnrichmentStepCard
                  icon={ImageIcon}
                  title="Gerar imagens ambientadas"
                  description="Coloque seu produto em cenários realistas gerados por IA."
                  costLabel="1 crédito por imagem"
                  isRunning={false}
                  isDone={false}
                  error={null}
                  onRun={() => product && onOpenImageSearch(product._id)}
                  onSkip={() => skipStep('image', 'done')}
                />
              )}
              {step === 'done' && (
                <div className="text-center py-6">
                  <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                    <PartyPopper className="w-7 h-7 text-emerald-500" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900">Seu primeiro produto está pronto!</h3>
                  <p className="text-sm text-slate-500 mt-1">Você já pode continuar editando ou importar mais produtos.</p>
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <button
                      type="button"
                      onClick={onFinish}
                      className="px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors"
                    >
                      Ver produto
                    </button>
                  </div>
                </div>
              )}
```

- [ ] **Step 2: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/ProductUrlImportModal.tsx
git commit -m "feat(client): add enrichment and done steps to ProductUrlImportModal"
```

---

## Task 15: `App.tsx` — handlers de criação/enriquecimento e coordenação com `ImageSearchModal`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `suggestProductAttributes` (Task 9), `getEffectiveAttributes` (já importado em `App.tsx`).
- Produces: `handleProductCreatedFromOnboarding(product: Product): void`, `handleGenerateDescriptionForOnboarding(id: string): Promise<void>`, `handleSuggestAttributesForOnboarding(id: string): Promise<boolean>`, `handleOpenImageSearchFromOnboarding(id: string): void` — passados como props ao `<ProductUrlImportModal />` na Task 16.

- [ ] **Step 1: Novo estado, perto de `isOnboardingWizardOpen` (linha 232)**

```ts
  const [isProductUrlImportOpen, setIsProductUrlImportOpen] = useState(false);
  const [productUrlImportResumeStep, setProductUrlImportResumeStep] = useState<'done' | null>(null);
  const [productUrlImportProductId, setProductUrlImportProductId] = useState<string | null>(null);
```

- [ ] **Step 2: Handlers, perto de `handleEnrichSingle`/`startGenerateSingle` (após a linha 2000)**

```ts
  const handleProductCreatedFromOnboarding = (product: Product) => {
    setProducts((prev) => [...prev, product]);
    setProductUrlImportProductId(product._id);
  };

  // Reusa exatamente o mesmo caminho de geração de descrição por crédito que
  // a tabela de produtos já usa (startGenerateSingle) — sem duplicar
  // ensureCredits/consumeCredit/tracking.
  const handleGenerateDescriptionForOnboarding = async (id: string) => {
    await startGenerateSingle(id);
  };

  // Sugestão de atributos é grátis hoje (não passa por ensureCredits/consumeCredit) —
  // mesma função extraída em productService.ts que ProductEditModal usa.
  const handleSuggestAttributesForOnboarding = async (id: string): Promise<boolean> => {
    const product = products.find((p) => p._id === id);
    if (!product) return false;
    const effectiveAttributes = product.categoryId ? getEffectiveAttributes(product.categoryId, existingCategories) : [];
    const result = await suggestProductAttributes(product, effectiveAttributes);
    const hasUpdates = Object.keys(result.attributes).length > 0;
    if (hasUpdates) {
      setProducts((prev) =>
        prev.map((p) => (p._id === id ? { ...p, attributes: { ...(p.attributes || {}), ...result.attributes }, _isDirty: true } : p)),
      );
      const hasImage = !!(product._selectedImage || product['URL imagem 1']);
      trackAttributesGenerated({ source: hasImage ? 'image' : 'text', sku: product['Código (SKU)'] as string });
    }
    return hasUpdates;
  };

  // Abre o ImageSearchModal já existente para o produto do wizard e lembra de
  // reabrir o wizard (no passo "done") quando ele for fechado.
  const handleOpenImageSearchFromOnboarding = (id: string) => {
    const product = products.find((p) => p._id === id);
    if (!product) return;
    setCurrentImageSearchProduct(product);
    setIsImageSearchModalOpen(true);
    setProductUrlImportResumeStep('done');
    setIsProductUrlImportOpen(false);
  };
```

Adicionar `suggestProductAttributes` ao import já existente de `./services/productService` (linha 31).

- [ ] **Step 3: Coordenar o fechamento do `ImageSearchModal` para retomar o wizard**

Localizar o `onClose={() => setIsImageSearchModalOpen(false)}` do `<ImageSearchModal />` (linha 4177) e trocar por:

```tsx
            onClose={() => {
              setIsImageSearchModalOpen(false);
              if (productUrlImportResumeStep) {
                setIsProductUrlImportOpen(true);
              }
            }}
```

- [ ] **Step 4: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(client): add onboarding product-creation and enrichment handlers to App.tsx"
```

---

## Task 16: `App.tsx` — auto-abrir, flag de onboarding, CTA do estado vazio e render do modal

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ProductUrlImportModal` (Tasks 13-14), todos os handlers da Task 15.

- [ ] **Step 1: Ler a flag `productOnboarding.promptShown` no listener existente**

No `onSnapshot(userRef, ...)` (linha 385 em diante, junto de `setOnboardingCompleted`), adicionar:

```ts
              setProductOnboardingPromptShown(snap.data().productOnboarding?.promptShown === true);
```

E o `useState` correspondente perto de `onboardingCompleted` (linha 230):

```ts
  const [productOnboardingPromptShown, setProductOnboardingPromptShown] = useState<boolean>(false);
```

- [ ] **Step 2: Efeito de auto-abertura, uma vez, quando o dashboard carrega vazio**

Adicionar próximo aos outros `useEffect` relacionados a `user`/`isAuthReady` (perto da linha 429, logo após o `useEffect` de `onAuthStateChanged`):

```ts
  useEffect(() => {
    if (!isAuthReady || !user || productOnboardingPromptShown || products.length !== 0) return;
    setIsProductUrlImportOpen(true);
    setProductOnboardingPromptShown(true);
    updateDoc(doc(db, `users/${user.uid}`), { productOnboarding: { promptShown: true } }).catch((err) =>
      console.error('Erro ao marcar productOnboarding.promptShown:', err),
    );
  }, [isAuthReady, user, productOnboardingPromptShown, products.length]);
```

- [ ] **Step 3: Trocar a CTA primária do estado vazio (`App.tsx:3330-3357`)**

Substituir o bloco inteiro `{products.length === 0 ? (...) : paginatedProducts.length === 0 ? (...`, mantendo intactos os outros dois ramos do ternário (`paginatedProducts.length === 0` e o `.map` de produtos, que começam em `App.tsx:3358`) e reaproveitando o `onClick={downloadBlankTemplate}` e `onClick={() => fileInputRef.current?.click()}` já existentes — só invertendo qual ação é primária:

```tsx
                          {products.length === 0 ? (
                            <tr>
                              <td colSpan={20}>
                                <div className="p-16 flex flex-col items-center justify-center text-center w-full">
                                  <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center mb-4">
                                    <LinkIcon className="w-8 h-8 text-slate-400" />
                                  </div>
                                  <h3 className="font-display text-2xl font-bold text-slate-900 mb-2 text-center">Pronto para começar?</h3>
                                  <p className="text-sm text-slate-500 mb-8 max-w-sm text-center">
                                    Cole o link de um produto e deixe a IA preencher o resto para você.
                                  </p>
                                  <button
                                    onClick={() => setIsProductUrlImportOpen(true)}
                                    className="px-8 py-3 bg-[#FF5B03] text-white rounded-xl shadow-lg shadow-orange-200 font-bold hover:bg-[#E14E00] transition-all hover:scale-105 active:scale-95 flex items-center gap-2 mb-4"
                                  >
                                    <LinkIcon className="w-5 h-5" /> Colar link do produto
                                  </button>
                                  <p className="text-xs text-slate-400 mb-2">ou importe uma planilha</p>
                                  <div className="flex flex-col sm:flex-row items-center gap-3">
                                    <button
                                      onClick={() => fileInputRef.current?.click()}
                                      className="px-6 py-3 bg-white text-slate-700 rounded-xl border border-slate-200 font-semibold hover:bg-slate-50 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm"
                                    >
                                      <Upload className="w-4 h-4" /> Importar Arquivo
                                    </button>
                                    <button
                                      onClick={downloadBlankTemplate}
                                      className="px-6 py-3 bg-white text-slate-700 rounded-xl border border-slate-200 font-semibold hover:bg-slate-50 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm"
                                    >
                                      <Download className="w-4 h-4 text-slate-500" /> Baixar Planilha Padrão
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : paginatedProducts.length === 0 ? (
```

No import de `lucide-react` no topo do arquivo (`App.tsx:2`), adicionar `Link as LinkIcon` e remover `FileSpreadsheet` — ele só era usado neste bloco (confirmado, único uso em todo `App.tsx`) e deixa de aparecer.

- [ ] **Step 4: Renderizar o modal**

Perto do cluster de modais existente (após o `<CategoryImportModal />`, por volta da linha 4207, antes de `{isOnboardingWizardOpen && ...}`):

```tsx
      {isProductUrlImportOpen && (
        <Suspense fallback={null}>
          <ProductUrlImportModal
            isOpen={isProductUrlImportOpen}
            onClose={() => setIsProductUrlImportOpen(false)}
            categories={existingCategories}
            initialStep={productUrlImportResumeStep ?? undefined}
            initialProduct={products.find((p) => p._id === productUrlImportProductId) ?? null}
            onProductCreated={handleProductCreatedFromOnboarding}
            onGenerateDescription={handleGenerateDescriptionForOnboarding}
            onSuggestAttributes={handleSuggestAttributesForOnboarding}
            onOpenImageSearch={handleOpenImageSearchFromOnboarding}
            onFinish={() => { setIsProductUrlImportOpen(false); setProductUrlImportResumeStep(null); }}
            descriptionCreditCost={getCreditCost(CREDIT_ACTIONS.generateSeoSingle.key)}
            currentCredits={credits}
          />
        </Suspense>
      )}
```

Adicionar o import lazy no topo do arquivo, junto dos outros (perto da linha 25):

```ts
const ProductUrlImportModal = lazy(() => import('./components/onboarding/ProductUrlImportModal'));
```

- [ ] **Step 5: Checar tipos**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 6: Verificação manual completa (checklist da spec)**

Via `npm run dev`, em emulação mobile (Chrome DevTools):
- [ ] Conta nova (ou zerar produtos de uma conta de teste) → modal abre sozinho uma vez.
- [ ] Fechar o modal → CTA "Colar link do produto" aparece como ação primária do estado vazio; planilha vira ação secundária.
- [ ] Caminho URL: colar uma URL de produto real → `review` pré-preenchido → "Criar produto" habilita só com Título+Categoria+Imagem.
- [ ] Caminho "Quero inserir manualmente" a partir do `intro`, sem digitar URL nenhuma → `manual` com campos em branco.
- [ ] Upload de imagem via input de arquivo (câmera/galeria) preenche a thumbnail.
- [ ] Descrição: crédito debita, produto aparece com `_statusDescricao` atualizado.
- [ ] Atributos: não debita crédito, produto ganha `attributes`.
- [ ] Imagem: abre `ImageSearchModal`, ao fechar volta ao wizard no passo `done`.
- [ ] "Ver produto" fecha o wizard e o produto está na tabela, editável normalmente em `ProductEditModal`.
- [ ] `assertSafeUrl` rejeita `http://169.254.169.254/` e `http://localhost/` (testado na Task 4, reconfirmar aqui end-to-end pela UI).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(client): wire ProductUrlImportModal into App.tsx (auto-open, empty-state CTA)"
```

---

## Self-Review

**Cobertura da spec:** timing/auto-abrir (Task 16), entrada manual como escolha de primeira classe (Task 13), explicação de 3 itens (Task 13), extração determinística+IA (Tasks 1, 3, 4), modal separado do `ProductEditModal` (Tasks 11-14), reuso dos handlers de crédito existentes (Task 15), fallback manual nunca dead-end (Task 13), Título/Categoria/Imagem obrigatórios (Task 11), upload de imagem via `/api/upload` (Task 8/11), telemetria (Task 10), consolidação do SSRF guard (Tasks 1-2), regra do Firestore (Task 6), correção do custo de créditos da etapa de Atributos (grátis, Task 14-15) — todos cobertos.

**Placeholders:** nenhum "TBD"/"implementar depois" — todo passo de código tem o código completo; passos de UI sem suíte automatizada usam checklist manual explícito (consistente com `CLAUDE.md`).

**Consistência de tipos:** `ScrapedProductFields`/`ExtractedProductFields` usam os mesmos nomes de campo (`title`, `description`, `price`, `imageUrl`, `brand`) do servidor (Task 3-4) ao cliente (Task 8); `WizardStep` é o mesmo union em todas as referências (Tasks 13-16); `suggestProductAttributes` tem a mesma assinatura em `productService.ts` (Task 9), `App.tsx` (Task 15) e no uso implícito de `ProductEditModal` (Task 9); `AttributeValue['source']` usa `'ai'` (valor válido) em todo código novo, nunca repete o bug pré-existente `'text_ai'`/`'image_ai'`.
