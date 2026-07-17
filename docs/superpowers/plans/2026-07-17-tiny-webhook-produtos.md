# Tiny Webhook de Produtos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um modo de sincronização "Webhook" à integração Tiny v2, que recebe produtos
via `POST /api/tiny/webhook/:uid/:secret` (chamado pelo Tiny), cadastra-os no Firestore reusando o
pipeline de upsert já usado pelo import em background, e responde no formato de mapeamento que a
API do Tiny exige.

**Architecture:** Novo módulo `server/tinyWebhook.ts` com uma rota pública (recebe o payload,
normaliza pai + variações, chama `upsertProduct` — exportado de `tinyImportWorker.ts` — e responde
com o array de mapeamento) e uma rota autenticada de configuração (CNPJ, modo de sync, geração de
secret). `TinyNormalizedProduct` ganha campos opcionais só preenchidos pelo webhook. `TinyConnector.tsx`
ganha um toggle Polling/Webhook (só quando `version === 'v2'`) e um painel com URL/CNPJ/estatísticas.

**Tech Stack:** Express (rotas), Firebase Admin SDK / Firestore (`adminDb`), React 19 (frontend),
sem framework de testes automatizados — verificação manual via `npm run lint`, `tsx` para funções
puras e `curl`/dev server para rotas (conforme `CLAUDE.md`: "There are no automated tests").

## Global Constraints

- Sem testes automatizados no repo — validar com `npm run lint` (tsc --noEmit) e testes manuais via dev server.
- Todo texto de UI/logs em pt-BR, seguindo o padrão do resto do app.
- Nunca logar o token/secret completo — só confirmar presença/tamanho quando necessário depurar.
- `npm run lint` deve ficar limpo ao final de cada task que toca `.ts`/`.tsx`.
- Reaproveitar tipos/rotinas existentes (`TinyNormalizedProduct`, `upsertProduct`, `STATUS_REF`) em vez de duplicar.

---

### Task 1: Estender `TinyNormalizedProduct` com os campos extras do webhook

**Files:**
- Modify: `server/tinyAgent.ts:151-171` (interface `TinyNormalizedProduct`)

**Interfaces:**
- Produces: `TinyNormalizedProduct` com os novos campos opcionais `estoque`, `estoqueMinimo`,
  `estoqueMaximo`, `localizacao`, `marca`, `garantia`, `sobEncomenda`, `cest`, `diasPreparacao`,
  `obs`, `unidadePorCaixa`, `codigoFornecedor`, `unidade`, `linkVideo`, `slug`, `codigoPai`,
  `variacaoGrade` — usados pelas Tasks 2 e 3.

- [ ] **Step 1: Adicionar os campos na interface**

Em `server/tinyAgent.ts`, localizar:

```ts
export interface TinyNormalizedProduct {
  tinyId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  precoPor?: number;
  precoDe?: number;
  categorias: string[];
  imagens: string[];
  raw: unknown;
}
```

Substituir por:

```ts
export interface TinyNormalizedProduct {
  tinyId: string;
  sku: string;
  nome: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ncm?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  largura?: number;
  altura?: number;
  comprimento?: number;
  precoPor?: number;
  precoDe?: number;
  categorias: string[];
  imagens: string[];
  // Campos extras — só preenchidos pelo normalizador do webhook (server/tinyWebhook.ts);
  // v2/v3 (polling) deixam undefined, sem regressão no upsert.
  estoque?: number;
  estoqueMinimo?: number;
  estoqueMaximo?: number;
  localizacao?: string;
  marca?: string;
  garantia?: string;
  sobEncomenda?: string;
  cest?: string;
  diasPreparacao?: number;
  obs?: string;
  unidadePorCaixa?: string;
  codigoFornecedor?: string;
  unidade?: string;
  linkVideo?: string;
  slug?: string;
  // Só preenchidos em produtos-filho (variações) vindos do webhook.
  codigoPai?: string;
  variacaoGrade?: string;
  raw: unknown;
}
```

- [ ] **Step 2: Verificar que o projeto ainda compila**

Run: `npm run lint`
Expected: sem erros (campos são todos opcionais, nenhum código existente quebra).

- [ ] **Step 3: Commit**

```bash
git add server/tinyAgent.ts
git commit -m "feat(tiny): estende TinyNormalizedProduct com campos do webhook de produtos"
```

---

### Task 2: Exportar e estender `upsertProduct` em `tinyImportWorker.ts`

**Files:**
- Modify: `server/tinyImportWorker.ts:48-90` (função `upsertProduct`)

**Interfaces:**
- Consumes: `TinyNormalizedProduct` (Task 1).
- Produces: `export async function upsertProduct(uid: string, t: TinyNormalizedProduct, source?: string): Promise<string>` — retorna o `id` do documento Firestore criado/atualizado. Usado por `processSlice` (já existente, sem mudança de chamada) e pela Task 4 (`tinyWebhook.ts`).

- [ ] **Step 1: Substituir a função por uma versão exportada, com retorno de id e novos campos**

Em `server/tinyImportWorker.ts`, localizar o bloco:

```ts
// Writes one normalized product to Firestore. "Source" fields always update;
// enriched fields (description/SEO) only fill when empty, preserving local work.
async function upsertProduct(uid: string, t: TinyNormalizedProduct): Promise<void> {
  const existingSnap = await PRODUCTS(uid).where('_tinyProductId', '==', t.tinyId).limit(1).get();
  const existing = existingSnap.docs[0];
  const ref = existing ? existing.ref : PRODUCTS(uid).doc(`tiny_${t.tinyId}`);
  const cur: Record<string, any> = existing?.data() ?? {};

  const data: Record<string, any> = {
    // Source-of-truth fields: always refreshed from Tiny.
    'Código (SKU)': t.sku || undefined,
    'Descrição': t.nome || undefined,
    'Categoria': t.categorias[0] || undefined,
    'Preço': t.precoPor,
    'Preço promocional': t.precoDe,
    'GTIN/EAN': t.gtin || undefined,
    'NCM (Classificação fiscal)': t.ncm || undefined,
    'Peso líquido (Kg)': t.pesoLiquido,
    'Peso bruto (Kg)': t.pesoBruto,
    'Largura embalagem': t.largura,
    'Altura Embalagem': t.altura,
    'Comprimento embalagem': t.comprimento,
    _tinyProductId: t.tinyId,
    ownerId: uid,
    createdAt: cur.createdAt || iso(),
    updatedAt: iso(),
  };
  t.imagens.slice(0, 6).forEach((url, i) => { data[`URL imagem ${i + 1}`] = url; });

  // Enriched fields: only fill when the current value is empty.
  const fillIfEmpty = (key: string, val?: string) => {
    if (val && !cur[key]) data[key] = val;
  };
  fillIfEmpty('Descrição complementar', t.descricaoHtml);
  fillIfEmpty('Título SEO', t.seoTitle);
  fillIfEmpty('Descrição SEO', t.seoDescription);
  fillIfEmpty('Palavras chave SEO', t.seoKeywords);

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('tiny_versions').add({
    source: 'tiny-bg-import',
    raw: t.raw && typeof t.raw === 'object' ? stripUndefined(t.raw as any) : null,
    importedAt: iso(),
  }).catch(() => { /* backup is best-effort */ });
}
```

Substituir por:

```ts
// Writes one normalized product to Firestore. "Source" fields always update;
// enriched fields (description/SEO) only fill when empty, preserving local work.
// Returns the Firestore doc id — the webhook handler uses it as idMapeamento.
export async function upsertProduct(uid: string, t: TinyNormalizedProduct, source = 'tiny-bg-import'): Promise<string> {
  const existingSnap = await PRODUCTS(uid).where('_tinyProductId', '==', t.tinyId).limit(1).get();
  const existing = existingSnap.docs[0];
  const ref = existing ? existing.ref : PRODUCTS(uid).doc(`tiny_${t.tinyId}`);
  const cur: Record<string, any> = existing?.data() ?? {};

  const data: Record<string, any> = {
    // Source-of-truth fields: always refreshed from Tiny.
    'Código (SKU)': t.sku || undefined,
    'Descrição': t.nome || undefined,
    'Categoria': t.categorias[0] || undefined,
    'Preço': t.precoPor,
    'Preço promocional': t.precoDe,
    'GTIN/EAN': t.gtin || undefined,
    'NCM (Classificação fiscal)': t.ncm || undefined,
    'Peso líquido (Kg)': t.pesoLiquido,
    'Peso bruto (Kg)': t.pesoBruto,
    'Largura embalagem': t.largura,
    'Altura Embalagem': t.altura,
    'Comprimento embalagem': t.comprimento,
    'Estoque': t.estoque,
    'Estoque mínimo': t.estoqueMinimo,
    'Estoque máximo': t.estoqueMaximo,
    'Localização': t.localizacao || undefined,
    'Marca': t.marca || undefined,
    'Garantia': t.garantia || undefined,
    'Sob encomenda': t.sobEncomenda || undefined,
    'CEST': t.cest || undefined,
    'Dias para preparação': t.diasPreparacao,
    'Observações': t.obs || undefined,
    'Unidade por caixa': t.unidadePorCaixa || undefined,
    'Cód do fornecedor': t.codigoFornecedor || undefined,
    'Unidade': t.unidade || undefined,
    'Código do pai': t.codigoPai || undefined,
    'Variações': t.variacaoGrade || undefined,
    _tinyProductId: t.tinyId,
    ownerId: uid,
    createdAt: cur.createdAt || iso(),
    updatedAt: iso(),
  };
  t.imagens.slice(0, 6).forEach((url, i) => { data[`URL imagem ${i + 1}`] = url; });

  // Enriched fields: only fill when the current value is empty.
  const fillIfEmpty = (key: string, val?: string) => {
    if (val && !cur[key]) data[key] = val;
  };
  fillIfEmpty('Descrição complementar', t.descricaoHtml);
  fillIfEmpty('Título SEO', t.seoTitle);
  fillIfEmpty('Descrição SEO', t.seoDescription);
  fillIfEmpty('Palavras chave SEO', t.seoKeywords);
  fillIfEmpty('Link do vídeo', t.linkVideo);
  fillIfEmpty('Slug', t.slug);

  await ref.set(stripUndefined(data), { merge: true });
  await ref.collection('tiny_versions').add({
    source,
    raw: t.raw && typeof t.raw === 'object' ? stripUndefined(t.raw as any) : null,
    importedAt: iso(),
  }).catch(() => { /* backup is best-effort */ });

  return ref.id;
}
```

Nenhuma outra mudança é necessária — a chamada existente em `processSlice` (`await upsertProduct(uid, detail);`) continua válida porque `source` tem default.

- [ ] **Step 2: Verificar que compila**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server/tinyImportWorker.ts
git commit -m "feat(tiny): exporta upsertProduct e mapeia campos extras do webhook"
```

---

### Task 3: Normalizador do payload do webhook (`normalizeWebhookPayload`)

**Files:**
- Create: `server/tinyWebhook.ts` (parte 1 — só a normalização pura, sem rotas ainda)
- Modify: `server/tinyV2.ts:9-13` (exportar o helper `num`)

**Interfaces:**
- Consumes: `TinyNormalizedProduct` (Task 1), `num` de `tinyV2.ts`.
- Produces: `export function normalizeWebhookPayload(dados: any): { parent: TinyNormalizedProduct; variacoes: TinyNormalizedProduct[] }` — usado pela Task 4.

- [ ] **Step 1: Exportar o helper `num` em `tinyV2.ts`**

Em `server/tinyV2.ts`, localizar:

```ts
const num = (v: unknown): number | undefined => {
```

Trocar por:

```ts
export const num = (v: unknown): number | undefined => {
```

- [ ] **Step 2: Criar `server/tinyWebhook.ts` com a normalização**

```ts
// Tiny ERP product webhook (API v2 "envio de produtos"): receives one product
// per POST (parent + nested variações), synchronously, and must answer with
// the mapping array Tiny expects. This module normalizes the payload into the
// shared TinyNormalizedProduct shape so it can reuse tinyImportWorker's upsert.
// Docs: https://tiny.com.br/api-docs/api2-webhooks-envio-produtos
import { num } from './tinyV2';
import type { TinyNormalizedProduct } from './tinyAgent';

function collectWebhookImages(p: any): string[] {
  const urls: string[] = [];
  if (Array.isArray(p?.anexos)) {
    for (const a of p.anexos) {
      const u = a?.url;
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  return Array.from(new Set(urls));
}

function normalizeWebhookParent(p: any): TinyNormalizedProduct {
  const seo = p?.seo ?? {};
  const arvore = p?.descricaoArvoreCategoria || p?.descricaoCategoria;
  return {
    tinyId: String(p?.id),
    sku: p?.codigo ?? '',
    nome: p?.nome ?? '',
    descricaoHtml: p?.descricaoComplementar || undefined,
    seoTitle: seo?.title || undefined,
    seoDescription: seo?.description || undefined,
    seoKeywords: seo?.keywords || undefined,
    linkVideo: seo?.linkVideo || undefined,
    slug: seo?.slug || undefined,
    ncm: p?.ncm || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: num(p?.pesoLiquido),
    pesoBruto: num(p?.pesoBruto),
    largura: num(p?.larguraEmbalagem),
    altura: num(p?.alturaEmbalagem),
    comprimento: num(p?.comprimentoEmbalagem),
    precoPor: num(p?.preco),
    precoDe: num(p?.precoPromocional),
    estoque: num(p?.estoqueAtual),
    estoqueMinimo: num(p?.estoqueMinimo),
    estoqueMaximo: num(p?.estoqueMaximo),
    localizacao: p?.localizacao || undefined,
    marca: p?.marca || undefined,
    garantia: p?.garantia || undefined,
    sobEncomenda: p?.sobEncomenda || undefined,
    cest: p?.cest || undefined,
    diasPreparacao: num(p?.diasPreparacao),
    obs: p?.obs || undefined,
    unidadePorCaixa: p?.unidadePorCaixa || undefined,
    codigoFornecedor: p?.codigoFornecedor || undefined,
    unidade: p?.unidade || undefined,
    categorias: arvore ? [String(arvore)] : [],
    imagens: collectWebhookImages(p),
    raw: p,
  };
}

// Tiny doesn't send a display name per variação — reuse its own codigo so the
// row is identifiable in the product list.
function normalizeWebhookVariacao(v: any, parentCodigo: string): TinyNormalizedProduct {
  const grade = Array.isArray(v?.grade)
    ? v.grade.map((g: any) => `${g?.chave}: ${g?.valor}`).filter(Boolean).join(', ')
    : undefined;
  return {
    tinyId: String(v?.id),
    sku: v?.codigo ?? '',
    nome: v?.codigo ?? '',
    gtin: v?.gtin || undefined,
    precoPor: num(v?.preco),
    precoDe: num(v?.precoPromocional),
    estoque: num(v?.estoqueAtual),
    codigoPai: parentCodigo || undefined,
    variacaoGrade: grade || undefined,
    categorias: [],
    imagens: collectWebhookImages(v),
    raw: v,
  };
}

export function normalizeWebhookPayload(dados: any): { parent: TinyNormalizedProduct; variacoes: TinyNormalizedProduct[] } {
  const parent = normalizeWebhookParent(dados);
  const variacoes = Array.isArray(dados?.variacoes)
    ? dados.variacoes.map((v: any) => normalizeWebhookVariacao(v, parent.sku))
    : [];
  return { parent, variacoes };
}
```

- [ ] **Step 3: Verificar a normalização com o payload de exemplo do Tiny**

Criar um arquivo temporário `verify-tiny-webhook.mjs` na raiz do projeto (não será commitado):

```js
import { normalizeWebhookPayload } from './server/tinyWebhook.ts';

const dados = {
  id: '441393295',
  nome: 'Exemplo de produto pai',
  codigo: 'ex-pai',
  unidade: 'UN',
  preco: '150.0000',
  precoPromocional: '120.0000',
  ncm: '1001.10.10',
  gtin: '789116565465',
  pesoLiquido: '1.000',
  pesoBruto: '1.500',
  estoqueMinimo: '2.00',
  estoqueMaximo: '50.00',
  estoqueAtual: 10,
  descricaoComplementar: '<p>Descrição complementar do produto</p>',
  marca: 'Tiny',
  cest: '10.003.00',
  sobEncomenda: 'N',
  alturaEmbalagem: '21.0',
  larguraEmbalagem: '26.0',
  comprimentoEmbalagem: '1.0',
  descricaoCategoria: 'categoria filho 1',
  descricaoArvoreCategoria: 'categoria pai > categoria filho 1',
  variacoes: [
    {
      id: '441393302',
      codigo: 'ex-pai-1',
      gtin: '789116565465',
      preco: '150.0000',
      precoPromocional: '120.0000',
      estoqueAtual: 3,
      grade: [{ chave: 'Cor', valor: 'Azul' }, { chave: 'Tamanho', valor: 'P' }],
      anexos: [],
    },
  ],
  anexos: [
    { url: 'https://s3-sa-east-1.amazonaws.com/tinylocal-testes/erp/x/y.jpeg', nome: 'foto.jpeg', tipo: 'jpeg' },
  ],
  seo: { title: '', description: '', keywords: '', linkVideo: '', slug: '' },
};

const { parent, variacoes } = normalizeWebhookPayload(dados);

const checks = [
  ['parent.tinyId', parent.tinyId, '441393295'],
  ['parent.sku', parent.sku, 'ex-pai'],
  ['parent.categorias[0]', parent.categorias[0], 'categoria pai > categoria filho 1'],
  ['parent.imagens.length', parent.imagens.length, 1],
  ['parent.marca', parent.marca, 'Tiny'],
  ['parent.estoque', parent.estoque, 10],
  ['variacoes.length', variacoes.length, 1],
  ['variacoes[0].tinyId', variacoes[0].tinyId, '441393302'],
  ['variacoes[0].codigoPai', variacoes[0].codigoPai, 'ex-pai'],
  ['variacoes[0].variacaoGrade', variacoes[0].variacaoGrade, 'Cor: Azul, Tamanho: P'],
];

let failed = false;
for (const [label, got, want] of checks) {
  if (got !== want) { failed = true; console.error(`FALHOU ${label}: esperado ${JSON.stringify(want)}, obtido ${JSON.stringify(got)}`); }
}
if (failed) { console.error('verify-tiny-webhook: FALHOU'); process.exit(1); }
console.log('verify-tiny-webhook: OK, todas as asserções passaram');
```

Run: `npx tsx verify-tiny-webhook.mjs`
Expected output: `verify-tiny-webhook: OK, todas as asserções passaram`

Depois de confirmar, apagar o arquivo temporário:

```bash
rm verify-tiny-webhook.mjs
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add server/tinyWebhook.ts server/tinyV2.ts
git commit -m "feat(tiny): normalizador do payload do webhook de produtos (pai + variações)"
```

---

### Task 4: Rotas do webhook (recebimento público + configuração autenticada)

**Files:**
- Modify: `server/tinyWebhook.ts` (adicionar as rotas, no mesmo arquivo da Task 3)

**Interfaces:**
- Consumes: `normalizeWebhookPayload` (Task 3), `upsertProduct` (Task 2), `STATUS_REF` (de `tinyAgent.ts`).
- Produces: `export function registerTinyWebhookRoutes(app: express.Express, deps: { verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }> }): void` — chamada pela Task 5 em `server.ts`.

- [ ] **Step 1: Adicionar as rotas ao final de `server/tinyWebhook.ts`**

Adicionar os imports no topo do arquivo (junto aos já existentes):

```ts
import type express from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { STATUS_REF } from './tinyAgent';
import { upsertProduct } from './tinyImportWorker';
```

Adicionar ao final do arquivo:

```ts
// --- Routes ------------------------------------------------------------

const digitsOnly = (s: string): string => s.replace(/\D/g, '');

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerTinyWebhookRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Authenticated: set CNPJ / sync mode, (re)generate the webhook secret.
  app.post('/api/tiny/webhook/config', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const body = req.body ?? {};
      const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (typeof body.cnpj === 'string') update.cnpj = digitsOnly(body.cnpj);
      if (body.syncMode === 'polling' || body.syncMode === 'webhook') update.syncMode = body.syncMode;

      const statusSnap = await STATUS_REF(uid).get();
      const cur = statusSnap.data() ?? {};
      let secret = cur.webhookSecret as string | undefined;
      if (!secret || body.regenerateSecret === true) {
        secret = crypto.randomBytes(24).toString('hex');
        update.webhookSecret = secret;
      }

      await STATUS_REF(uid).set(update, { merge: true });

      const webhookUrl = `${req.protocol}://${req.get('host')}/api/tiny/webhook/${uid}/${secret}`;
      return res.json({
        webhookUrl,
        cnpj: update.cnpj ?? cur.cnpj ?? '',
        syncMode: update.syncMode ?? cur.syncMode ?? 'polling',
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao salvar configuração do webhook.' });
    }
  });

  // Public: Tiny calls this synchronously when the merchant sends products to
  // the e-commerce. No documented auth from Tiny's side, so the URL carries a
  // per-user secret and we cross-check the cnpj in the envelope. `type: () =>
  // true` makes this route parse the body as JSON regardless of the
  // Content-Type header Tiny sends (undocumented) — body-parser no-ops if the
  // global express.json() already consumed the body.
  app.post('/api/tiny/webhook/:uid/:secret', express.json({ type: () => true }), async (req, res) => {
    const { uid, secret } = req.params;
    try {
      const statusSnap = await STATUS_REF(uid).get();
      const settings = statusSnap.data() ?? {};
      if (settings.syncMode !== 'webhook' || !settings.webhookSecret || settings.webhookSecret !== secret) {
        console.warn(`[tiny-webhook] rejeitado uid=${uid}: secret inválido ou syncMode != webhook`);
        return res.status(403).json({ message: 'Webhook não habilitado ou secret inválido.' });
      }

      const cnpjRecebido = digitsOnly(String(req.body?.cnpj ?? ''));
      const cnpjEsperado = digitsOnly(String(settings.cnpj ?? ''));
      if (!cnpjEsperado || cnpjRecebido !== cnpjEsperado) {
        console.warn(`[tiny-webhook] rejeitado uid=${uid}: cnpj não confere`);
        return res.status(403).json({ message: 'CNPJ não confere.' });
      }

      const dados = req.body?.dados;
      if (!dados || typeof dados !== 'object') {
        return res.status(400).json({ message: 'Payload inválido: campo dados ausente.' });
      }

      const { parent, variacoes } = normalizeWebhookPayload(dados);
      const items = [parent, ...variacoes];
      const resultados: Array<{ idMapeamento: string; skuMapeamento: string; error?: string }> = [];

      for (const item of items) {
        try {
          const docId = await upsertProduct(uid, item, 'tiny-webhook');
          resultados.push({ idMapeamento: docId, skuMapeamento: item.sku || '' });
        } catch (e: any) {
          console.error(`[tiny-webhook] falha ao salvar tinyId=${item.tinyId} uid=${uid}: ${e?.message}`);
          resultados.push({ idMapeamento: item.tinyId, skuMapeamento: item.sku || '', error: e?.message ?? 'Falha ao salvar produto.' });
        }
      }

      await STATUS_REF(uid).set({
        webhookStats: {
          lastReceivedAt: new Date().toISOString(),
          totalReceived: FieldValue.increment(items.length),
        },
      }, { merge: true });

      console.log(`[tiny-webhook] uid=${uid} recebeu ${items.length} item(ns) (produto ${parent.tinyId})`);
      return res.status(200).json(resultados);
    } catch (e: any) {
      console.error(`[tiny-webhook] erro inesperado uid=${uid}: ${e?.message}`);
      return res.status(500).json({ message: 'Erro ao processar webhook.' });
    }
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server/tinyWebhook.ts
git commit -m "feat(tiny): rotas de recebimento e configuração do webhook de produtos"
```

---

### Task 5: Registrar as rotas e estender `/api/tiny/status`

**Files:**
- Modify: `server.ts:20-21` (imports) e `server.ts:178` (registro de rotas)
- Modify: `server/tinyAgent.ts:414-432` (rota `GET /api/tiny/status`)

**Interfaces:**
- Consumes: `registerTinyWebhookRoutes` (Task 4).
- Produces: `GET /api/tiny/status` retorna, quando `version === 'v2'`, os campos extras
  `syncMode`, `cnpj`, `webhookUrl`, `webhookStats` — consumidos pelo frontend na Task 6.

- [ ] **Step 1: Registrar a rota em `server.ts`**

Localizar:

```ts
import { registerTinyImportRoutes, startTinyScheduler } from "./server/tinyImportWorker";
import { registerTinyProviderRoutes } from "./server/tinyProvider";
```

Adicionar logo abaixo:

```ts
import { registerTinyWebhookRoutes } from "./server/tinyWebhook";
```

Localizar:

```ts
  registerTinyRoutes(app, { verifyFirebaseToken });
  registerTinyProviderRoutes(app, { verifyFirebaseToken });
  registerTinyImportRoutes(app, { verifyFirebaseToken });
```

Adicionar logo abaixo:

```ts
  registerTinyWebhookRoutes(app, { verifyFirebaseToken });
```

- [ ] **Step 2: Estender `GET /api/tiny/status` em `server/tinyAgent.ts`**

Localizar:

```ts
  app.get('/api/tiny/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const [statusSnap, secretSnap] = await Promise.all([STATUS_REF(uid).get(), SECRET_REF(uid).get()]);
      const hasToken = secretSnap.exists;
      const d = statusSnap.data() ?? {};
      const sec = secretSnap.data() ?? {};
      // Infer the version for legacy secrets that predate the version field.
      const version = sec.version ?? d.apiVersion ?? (sec.accessToken ? 'v3' : sec.token ? 'v2' : null);
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        version,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });
```

Substituir por:

```ts
  app.get('/api/tiny/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const [statusSnap, secretSnap] = await Promise.all([STATUS_REF(uid).get(), SECRET_REF(uid).get()]);
      const hasToken = secretSnap.exists;
      const d = statusSnap.data() ?? {};
      const sec = secretSnap.data() ?? {};
      // Infer the version for legacy secrets that predate the version field.
      const version = sec.version ?? d.apiVersion ?? (sec.accessToken ? 'v3' : sec.token ? 'v2' : null);
      const webhookExtra = version === 'v2' ? {
        syncMode: d.syncMode === 'webhook' ? 'webhook' : 'polling',
        cnpj: d.cnpj ?? '',
        webhookUrl: d.webhookSecret ? `${req.protocol}://${req.get('host')}/api/tiny/webhook/${uid}/${d.webhookSecret}` : null,
        webhookStats: {
          lastReceivedAt: d.webhookStats?.lastReceivedAt ?? null,
          totalReceived: d.webhookStats?.totalReceived ?? 0,
        },
      } : {};
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        version,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
        ...webhookExtra,
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Testar as rotas com o dev server (sem precisar de login)**

Run: `npm run dev` (em background)

Aguardar o servidor subir (log "Server running..." ou similar), depois:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/tiny/webhook/config -H "Content-Type: application/json" -d '{}'
```
Expected: `401` (sem token de autenticação).

```bash
curl -s -X POST http://localhost:3000/api/tiny/webhook/uid-inexistente/secret-qualquer \
  -H "Content-Type: application/json" \
  -d '{"cnpj":"12345678000199","dados":{}}'
```
Expected: JSON `{"message":"Webhook não habilitado ou secret inválido."}` com HTTP 403 (confirmar com `-w`/`-i` se quiser ver o status).

Encerrar o dev server depois de confirmar.

- [ ] **Step 5: Commit**

```bash
git add server.ts server/tinyAgent.ts
git commit -m "feat(tiny): registra rotas do webhook e expõe syncMode/cnpj/webhookUrl no status"
```

---

### Task 6: Frontend — `tinyService.ts`

**Files:**
- Modify: `src/services/tinyService.ts:7-12` (`TinyStatus`), adicionar nova função ao final do arquivo

**Interfaces:**
- Produces: `TinyStatus` estendido; `export function tinyWebhookConfig(params: { cnpj?: string; syncMode?: 'polling' | 'webhook'; regenerateSecret?: boolean }): Promise<{ webhookUrl: string; cnpj: string; syncMode: 'polling' | 'webhook' }>` — usado pela Task 7.

- [ ] **Step 1: Estender `TinyStatus`**

Localizar:

```ts
export interface TinyStatus {
  connected: boolean;
  validated: boolean;
  version?: 'v2' | 'v3' | null;
  lastValidatedAt: string | null;
}
```

Substituir por:

```ts
export interface TinyStatus {
  connected: boolean;
  validated: boolean;
  version?: 'v2' | 'v3' | null;
  lastValidatedAt: string | null;
  syncMode?: 'polling' | 'webhook';
  cnpj?: string;
  webhookUrl?: string | null;
  webhookStats?: { lastReceivedAt: string | null; totalReceived: number };
}
```

- [ ] **Step 2: Adicionar `tinyWebhookConfig` ao final do arquivo**

```ts
export interface TinyWebhookConfig {
  webhookUrl: string;
  cnpj: string;
  syncMode: 'polling' | 'webhook';
}

export async function tinyWebhookConfig(params: {
  cnpj?: string; syncMode?: 'polling' | 'webhook'; regenerateSecret?: boolean;
}): Promise<TinyWebhookConfig> {
  const resp = await fetch('/api/tiny/webhook/config', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(params),
  });
  return handle(resp);
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/services/tinyService.ts
git commit -m "feat(tiny): tipos e chamada de API do webhook no frontend"
```

---

### Task 7: Frontend — UI do modo Webhook em `TinyConnector.tsx`

**Files:**
- Modify: `src/components/integrations/TinyConnector.tsx`

**Interfaces:**
- Consumes: `tinyWebhookConfig`, `TinyStatus.{syncMode,cnpj,webhookUrl,webhookStats}` (Task 6).

- [ ] **Step 1: Atualizar os imports**

Localizar:

```tsx
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info, KeyRound } from 'lucide-react';
import {
  tinyStatus, tinyConnect, tinyV2Validate, tinyDisconnect, tinyPush,
  tinyImportStart, tinyImportStatus, tinyImportCancel, tinyImportSetAutosync,
  type TinyStatus, type TinyImportJob, type TinyPushProduct, type TinyPushResult,
} from '../../services/tinyService';
```

Substituir por:

```tsx
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info, KeyRound, Copy } from 'lucide-react';
import {
  tinyStatus, tinyConnect, tinyV2Validate, tinyDisconnect, tinyPush,
  tinyImportStart, tinyImportStatus, tinyImportCancel, tinyImportSetAutosync, tinyWebhookConfig,
  type TinyStatus, type TinyImportJob, type TinyPushProduct, type TinyPushResult,
} from '../../services/tinyService';
```

- [ ] **Step 2: Adicionar estado e handlers do modo webhook**

Localizar (perto do topo do componente, junto aos outros `useState`):

```tsx
  const [pushing, setPushing] = useState(false);
```

Adicionar logo antes dessa linha:

```tsx
  const [cnpjInput, setCnpjInput] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
```

Localizar:

```tsx
  const connected = status?.validated;
```

Adicionar logo depois:

```tsx
  useEffect(() => { setCnpjInput(status?.cnpj ?? ''); }, [status?.cnpj]);

  const handleSyncModeChange = async (mode: 'polling' | 'webhook') => {
    setSavingWebhook(true);
    setError(null);
    try {
      await tinyWebhookConfig({ syncMode: mode });
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao mudar o modo de sincronização.');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleSaveCnpj = async () => {
    if (cnpjInput === (status?.cnpj ?? '')) return;
    setSavingWebhook(true);
    setError(null);
    try {
      await tinyWebhookConfig({ cnpj: cnpjInput });
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o CNPJ.');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleRegenerateWebhookSecret = async () => {
    if (!window.confirm('Regerar a URL do webhook? A URL atual, se já configurada no painel do Tiny, vai parar de funcionar.')) return;
    setSavingWebhook(true);
    setError(null);
    try {
      await tinyWebhookConfig({ regenerateSecret: true });
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao regerar a URL do webhook.');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    if (status?.webhookUrl) navigator.clipboard.writeText(status.webhookUrl).catch(() => {});
  };
```

- [ ] **Step 3: Adicionar o toggle Polling/Webhook e esconder o bloco de importação em modo webhook**

Localizar:

```tsx
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
              {status?.version && (
                <span className="text-emerald-800 font-semibold uppercase text-[10px] bg-emerald-100 rounded px-1.5 py-0.5">
                  {status.version}
                </span>
              )}
              {status?.lastValidatedAt && (
                <span className="text-emerald-600/70 text-xs">
                  · {new Date(status.lastValidatedAt).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>

          {/* Import (background) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
```

Substituir por:

```tsx
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
              {status?.version && (
                <span className="text-emerald-800 font-semibold uppercase text-[10px] bg-emerald-100 rounded px-1.5 py-0.5">
                  {status.version}
                </span>
              )}
              {status?.lastValidatedAt && (
                <span className="text-emerald-600/70 text-xs">
                  · {new Date(status.lastValidatedAt).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>

          {status?.version === 'v2' && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600">Modo de sincronização</label>
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-sm">
                {(['polling', 'webhook'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleSyncModeChange(m)}
                    disabled={savingWebhook}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50 ${
                      (status?.syncMode ?? 'polling') === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {m === 'polling' ? 'Polling' : 'Webhook'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status?.version === 'v2' && status?.syncMode === 'webhook' && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-800">Recebimento via Webhook</h4>
                <p className="text-xs text-slate-500">
                  Configure essa URL em Tiny → Configurações → aba E-commerce → Integrações → aba Webhook.
                  Produtos enviados por lá (inclusive variações) são cadastrados aqui automaticamente.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">CNPJ da conta Tiny</label>
                <input
                  type="text"
                  value={cnpjInput}
                  onChange={(e) => setCnpjInput(e.target.value)}
                  onBlur={handleSaveCnpj}
                  placeholder="Apenas números"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">URL do webhook</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={status?.webhookUrl ?? ''}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600"
                  />
                  <button
                    onClick={handleCopyWebhookUrl}
                    disabled={!status?.webhookUrl}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <Copy className="w-4 h-4" /> Copiar
                  </button>
                  <button
                    onClick={handleRegenerateWebhookSecret}
                    disabled={savingWebhook}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Regerar
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500 inline-flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {status?.webhookStats && status.webhookStats.totalReceived > 0
                  ? `Último recebido: ${status.webhookStats.lastReceivedAt ? new Date(status.webhookStats.lastReceivedAt).toLocaleString('pt-BR') : '—'} · Total recebido: ${status.webhookStats.totalReceived}`
                  : 'Nenhum produto recebido ainda.'}
              </p>
            </div>
          )}

          {/* Import (background) — só faz sentido em modo polling */}
          {!(status?.version === 'v2' && status?.syncMode === 'webhook') && (
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
```

- [ ] **Step 4: Fechar a condicional aberta no Step 3**

Localizar o fim do bloco de importação (mesmo `<div>` aberto acima), que hoje termina assim:

```tsx
              (puxa só o que mudou no Tiny)
            </label>
          </div>

          {/* Push */}
```

Substituir por:

```tsx
              (puxa só o que mudou no Tiny)
            </label>
          </div>
          )}

          {/* Push */}
```

- [ ] **Step 5: Verificar que compila**

Run: `npm run lint`
Expected: sem erros (checar com atenção o balanceamento de JSX — parênteses/chaves do bloco condicional dos Steps 3–4).

- [ ] **Step 6: Testar visualmente no dev server**

Run: `npm run dev`

No navegador, logar no app, ir na aba de integrações Tiny, conectar (ou já estar conectado) via v2,
alternar para "Webhook" e confirmar:
- O bloco de importação desaparece.
- O painel de Webhook aparece com CNPJ vazio e uma URL gerada (contendo `/api/tiny/webhook/<uid>/<secret>`).
- Digitar um CNPJ e sair do campo (blur) salva sem erro (`status.cnpj` reflete no reload).
- "Copiar" copia a URL; "Regerar" pede confirmação e troca a URL.
- Alternar de volta para "Polling" faz o bloco de importação reaparecer.

- [ ] **Step 7: Commit**

```bash
git add src/components/integrations/TinyConnector.tsx
git commit -m "feat(tiny): UI do modo de sincronização Webhook no TinyConnector"
```

---

### Task 8: Verificação end-to-end com payload real do Tiny

**Files:** nenhum (apenas verificação manual)

- [ ] **Step 1: Preparar o ambiente**

Com o app rodando (`npm run dev`) e logado, na aba Tiny (v2 conectado):
1. Alternar para modo "Webhook".
2. Preencher o CNPJ com um valor de teste, ex. `12345678000199` (deixar salvar no blur).
3. Copiar a URL do webhook (ela contém o `uid` real do usuário logado e o secret gerado).

- [ ] **Step 2: Simular uma chamada do Tiny com o payload de exemplo**

Substituir `<URL_COPIADA>` pela URL do Step 1 e rodar:

```bash
curl -s -i -X POST '<URL_COPIADA>' \
  -H "Content-Type: application/json" \
  -d '{
    "cnpj": "12345678000199",
    "idEcommerce": 1,
    "tipo": "produto",
    "versao": "1.0.0",
    "dados": {
      "id": "441393295",
      "nome": "Exemplo de produto pai",
      "codigo": "ex-pai",
      "unidade": "UN",
      "preco": "150.0000",
      "precoPromocional": "120.0000",
      "ncm": "1001.10.10",
      "gtin": "789116565465",
      "pesoLiquido": "1.000",
      "pesoBruto": "1.500",
      "descricaoComplementar": "<p>Descrição complementar do produto</p>",
      "marca": "Tiny",
      "descricaoArvoreCategoria": "categoria pai > categoria filho 1",
      "seo": { "title": "", "description": "", "keywords": "", "linkVideo": "", "slug": "" },
      "anexos": [{ "url": "https://s3-sa-east-1.amazonaws.com/tinylocal-testes/erp/x/y.jpeg", "nome": "foto.jpeg", "tipo": "jpeg" }],
      "variacoes": [
        {
          "id": "441393302",
          "codigo": "ex-pai-1",
          "gtin": "789116565465",
          "preco": "150.0000",
          "precoPromocional": "120.0000",
          "estoqueAtual": 3,
          "grade": [{ "chave": "Cor", "valor": "Azul" }, { "chave": "Tamanho", "valor": "P" }],
          "anexos": []
        }
      ]
    }
  }'
```

Expected: HTTP `200` com corpo JSON tipo:

```json
[
  {"idMapeamento":"<id do doc pai>","skuMapeamento":"ex-pai"},
  {"idMapeamento":"<id do doc filho>","skuMapeamento":"ex-pai-1"}
]
```

- [ ] **Step 3: Conferir no app**

Recarregar a lista de produtos no app e confirmar:
- Existe um produto com `Código (SKU) = ex-pai`, descrição/marca/categoria preenchidos.
- Existe um produto filho com `Código (SKU) = ex-pai-1` e `Código do pai = ex-pai`.
- O painel do webhook mostra `Total recebido: 2` e um `Último recebido` recente.

- [ ] **Step 4: Testar os casos de rejeição**

```bash
# secret errado
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$(echo '<URL_COPIADA>' | sed 's/.$/x/')" \
  -H "Content-Type: application/json" -d '{"cnpj":"12345678000199","dados":{}}'
```
Expected: `403`

```bash
# cnpj errado, secret certo
curl -s -o /dev/null -w "%{http_code}\n" -X POST '<URL_COPIADA>' \
  -H "Content-Type: application/json" -d '{"cnpj":"00000000000000","dados":{}}'
```
Expected: `403`

- [ ] **Step 5: Rodar o lint final**

Run: `npm run lint`
Expected: sem erros.

Nenhum commit nesta task — é só validação do que já foi commitado nas Tasks 1–7.
