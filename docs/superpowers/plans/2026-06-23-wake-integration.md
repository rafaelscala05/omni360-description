# Integração Wake Commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma seção "Integrações" ao Agente de Ecommerce com um conector Wake Commerce que importa produtos (com backup/versionamento) e envia dados enriquecidos de volta via PUT/POST, usando um token por usuário e proxy server-side.

**Architecture:** Token por usuário enviado uma vez ao servidor, persistido via Admin SDK em doc read-only e nunca devolvido ao browser. Todas as chamadas à `api.fbits.net` passam por endpoints `/api/wake/*` no Express (`server/wakeAgent.ts`), autenticados pelo Firebase ID token. Frontend consome via `src/services/wakeService.ts` e renderiza em `src/components/integrations/`.

**Tech Stack:** Express + tsx (backend), React 19 + Tailwind v4 (frontend), Firebase Admin SDK (Firestore named DB), `fetch` nativo (Node 20).

## Global Constraints

- **Sem framework de testes.** Validação de cada task = `npm run lint` (tsc --noEmit) + checagem manual no dev server (`npm run dev`, porta 3000). (CLAUDE.md)
- **UI/prompts/campos em pt-BR.** (CLAUDE.md)
- **Nenhuma chamada Gemini/Wake no browser.** Todo acesso externo passa pelo Express. (CLAUDE.md)
- **Token nunca retorna ao cliente.** Persistido server-side via Admin SDK em `users/{uid}/integration_secrets/wake` (rules: read/write `if false`).
- **Base Wake:** `https://api.fbits.net`. Header `Authorization`. Identificador `tipoIdentificador=ProdutoId`. Paginação `quantidadeRegistros` máx 50.
- **Auth dos endpoints:** `verifyFirebaseToken(req)` (já existe em `server.ts:22`). Cliente envia `Authorization: Bearer ${idToken}`.
- **Padrão de registro de rotas:** `registerWakeRoutes(app, { verifyFirebaseToken })`, espelhando `registerVideoRoutes` (`server.ts:171`).

---

## File Structure

**Novos**
- `server/wakeAgent.ts` — cliente `fbitsFetch` + rotas `/api/wake/*` (validate, status, import, push, disconnect).
- `src/services/wakeService.ts` — wrappers `fetch` autenticados para `/api/wake/*` + tipos compartilhados.
- `src/components/integrations/IntegrationsView.tsx` — layout da seção; cards Wake + Tiny (placeholder).
- `src/components/integrations/WakeConnector.tsx` — card Wake (conectar/validar, importar, enviar, desconectar).

**Editar**
- `server.ts` — import + `registerWakeRoutes(app, { verifyFirebaseToken })`.
- `src/types/models.ts` — campos internos `_wakeProductId`, `_wakeInformacaoId`, `_wakeVersionId`.
- `src/App.tsx` — item de sidebar "Integrações"; `mainView === 'integrations'`; handlers de import/push.
- `firestore.rules` — `integration_secrets` (admin-only) + `products/{id}/wake_versions`.

---

## Task 1: Tipos do modelo

**Files:**
- Modify: `src/types/models.ts` (bloco "Internal fields", após `_id`)

**Interfaces:**
- Produces: `Product._wakeProductId?: string`, `Product._wakeInformacaoId?: number`, `Product._wakeVersionId?: string`.

- [ ] **Step 1: Adicionar campos internos**

Em `src/types/models.ts`, dentro de `interface Product`, na seção `// Internal fields`, adicionar:

```typescript
  // Wake Commerce integration
  _wakeProductId?: string;      // produtoId na Wake — chave de merge
  _wakeInformacaoId?: number;   // informacaoId do bloco de descrição na Wake
  _wakeVersionId?: string;      // id da última versão salva em wake_versions
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run lint`
Expected: PASS (sem novos erros).

- [ ] **Step 3: Commit**

```bash
git add src/types/models.ts
git commit -m "feat(wake): campos de integração no modelo Product"
```

---

## Task 2: Cliente fbits + rotas validate/status/disconnect

**Files:**
- Create: `server/wakeAgent.ts`
- Modify: `server.ts` (import + registro)

**Interfaces:**
- Consumes: `verifyFirebaseToken` (de `server.ts`), `adminDb` (de `server/firebaseAdmin`).
- Produces: `registerWakeRoutes(app, { verifyFirebaseToken })`; rotas `POST /api/wake/validate`, `GET /api/wake/status`, `DELETE /api/wake/disconnect`; helper `fbitsFetch(token, method, path, body?)`.

- [ ] **Step 1: Criar `server/wakeAgent.ts` com cliente e rotas base**

```typescript
import type express from 'express';
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const WAKE_BASE = 'https://api.fbits.net';
const SECRET_PATH = (uid: string) => adminDb.collection('users').doc(uid).collection('integration_secrets').doc('wake');
const STATUS_PATH = (uid: string) => adminDb.collection('users').doc(uid).collection('settings').doc('wake');

interface WakeError { resultadoOperacao?: boolean; codigo?: number; mensagem?: string; }

// Cliente HTTP da Wake com backoff em 429/5xx. O header Authorization usa o
// token cru — a Wake (fbits) aceita o token diretamente nesse header.
export async function fbitsFetch<T = any>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${WAKE_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    return fbitsFetch<T>(token, method, path, body, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Token Wake inválido ou sem permissão.'), { status: 401 });
  }

  const text = await res.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }

  if (!res.ok) {
    const msg = (json as WakeError)?.mensagem || `Wake respondeu ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

async function getUserToken(uid: string): Promise<string | null> {
  const snap = await SECRET_PATH(uid).get();
  return snap.exists ? (snap.data()?.token ?? null) : null;
}

interface Deps { verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>; }

export function registerWakeRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Valida e persiste o token (server-side, via Admin SDK).
  app.post('/api/wake/validate', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token: string | undefined = req.body?.token?.trim();
      if (!token) return res.status(400).json({ valid: false, message: 'Token obrigatório.' });

      // GET de 1 registro só para confirmar credenciais.
      await fbitsFetch(token, 'GET', '/produtos?quantidadeRegistros=1&pagina=1');

      await SECRET_PATH(uid).set({ token, updatedAt: FieldValue.serverTimestamp() });
      await STATUS_PATH(uid).set({
        connected: true,
        validated: true,
        connectedAt: FieldValue.serverTimestamp(),
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ valid: true, message: 'Conectado com sucesso.' });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 400).json({ valid: false, message: e?.message ?? 'Falha na validação.' });
    }
  });

  // Estado não-sensível (nunca o token).
  app.get('/api/wake/status', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const snap = await STATUS_PATH(uid).get();
      const hasToken = (await SECRET_PATH(uid).get()).exists;
      const d = snap.data() ?? {};
      return res.json({
        connected: hasToken,
        validated: hasToken && d.validated === true,
        lastValidatedAt: d.lastValidatedAt?.toDate?.()?.toISOString?.() ?? null,
      });
    } catch (e: any) {
      return res.status(401).json({ connected: false, validated: false, message: e?.message });
    }
  });

  app.delete('/api/wake/disconnect', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      await SECRET_PATH(uid).delete().catch(() => {});
      await STATUS_PATH(uid).set({ connected: false, validated: false }, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(401).json({ ok: false, message: e?.message });
    }
  });
}
```

- [ ] **Step 2: Registrar em `server.ts`**

Após a linha `import { registerVideoRoutes } from "./server/videoAgent";` (`server.ts:13`), adicionar:

```typescript
import { registerWakeRoutes } from "./server/wakeAgent";
```

Após `registerVideoRoutes(app, { verifyFirebaseToken });` (`server.ts:171`), adicionar:

```typescript
  registerWakeRoutes(app, { verifyFirebaseToken });
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Verificar boot do servidor**

Run: `npm run dev` (deixar subir e abortar). Confirmar que loga sem erro de import/rotas.
Expected: servidor sobe na porta 3000 sem exceção.

- [ ] **Step 5: Commit**

```bash
git add server/wakeAgent.ts server.ts
git commit -m "feat(wake): cliente fbits + rotas validate/status/disconnect"
```

---

## Task 3: Endpoint de importação

**Files:**
- Modify: `server/wakeAgent.ts` (adicionar rota + normalizador)

**Interfaces:**
- Consumes: `fbitsFetch`, `getUserToken`.
- Produces: `POST /api/wake/import`; tipo de retorno `WakeImportResult` (ver código).

- [ ] **Step 1: Adicionar normalizador e rota de import**

Em `server/wakeAgent.ts`, antes de `registerWakeRoutes`, adicionar tipos e helper:

```typescript
export interface WakeNormalizedProduct {
  produtoId: string;
  sku: string;
  nome: string;
  precoPor?: number;
  precoDe?: number;
  ean?: string;
  informacaoId?: number;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  categorias: string[];
  imagens: string[];
  raw: unknown; // payload cru agregado — usado para backup/versionamento
}

async function aggregateProduct(token: string, p: any): Promise<WakeNormalizedProduct> {
  const id = String(p.produtoId ?? p.produtoVarianteId);
  const q = `?tipoIdentificador=ProdutoId`;
  const [informacoes, categorias, imagens, seo, metaTag] = await Promise.all([
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/informacoes${q}`).catch(() => []),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/categorias${q}`).catch(() => []),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/imagens${q}`).catch(() => []),
    fbitsFetch<any>(token, 'GET', `/produtos/${id}/seo${q}`).catch(() => null),
    fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/seo/metaTag${q}`).catch(() => []),
  ]);
  const infoBloco = Array.isArray(informacoes) ? informacoes.find((i) => i?.tipoInformacao === 'Informacoes') ?? informacoes[0] : undefined;
  const metaByName = (n: string) => (Array.isArray(metaTag) ? metaTag.find((m) => (m?.name ?? '').toLowerCase() === n)?.content : undefined)
    ?? (Array.isArray(seo?.metaTags) ? seo.metaTags.find((m: any) => (m?.name ?? '').toLowerCase() === n)?.content : undefined);
  return {
    produtoId: id,
    sku: p.sku ?? '',
    nome: p.nome ?? '',
    precoPor: p.precoPor,
    precoDe: p.precoDe,
    ean: p.ean,
    informacaoId: infoBloco?.informacaoId,
    descricaoHtml: infoBloco?.texto,
    seoTitle: seo?.title,
    seoDescription: metaByName('description'),
    seoKeywords: metaByName('keywords'),
    categorias: Array.isArray(categorias) ? categorias.map((c: any) => c?.nome ?? c?.nomeCategoria).filter(Boolean) : [],
    imagens: Array.isArray(imagens) ? imagens.map((im: any) => im?.url ?? im?.urlImagem).filter(Boolean) : [],
    raw: { produto: p, informacoes, categorias, imagens, seo, metaTag },
  };
}
```

Dentro de `registerWakeRoutes`, adicionar:

```typescript
  app.post('/api/wake/import', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token = await getUserToken(uid);
      if (!token) return res.status(400).json({ message: 'Wake não conectada.' });

      const pagina = Number(req.body?.pagina ?? 1);
      const quantidadeRegistros = Math.min(Number(req.body?.quantidadeRegistros ?? 50), 50);
      const lista = await fbitsFetch<any[]>(
        token, 'GET',
        `/produtos?pagina=${pagina}&quantidadeRegistros=${quantidadeRegistros}&camposAdicionais=Atributo&camposAdicionais=Informacao`,
      );
      const arr = Array.isArray(lista) ? lista : [];
      const produtos: WakeNormalizedProduct[] = [];
      for (const p of arr) {
        produtos.push(await aggregateProduct(token, p));
      }
      return res.json({ pagina, count: produtos.length, hasMore: arr.length === quantidadeRegistros, produtos });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha na importação.' });
    }
  });
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/wakeAgent.ts
git commit -m "feat(wake): endpoint de importação paginada com agregação"
```

---

## Task 4: Endpoint de envio (push)

**Files:**
- Modify: `server/wakeAgent.ts`

**Interfaces:**
- Consumes: `fbitsFetch`, `getUserToken`.
- Produces: `POST /api/wake/push`; payload `{ produtos: WakePushProduct[] }`; retorno `{ resultados: WakePushResult[] }`.

- [ ] **Step 1: Adicionar tipos e rota de push**

Em `server/wakeAgent.ts`, adicionar tipos antes de `registerWakeRoutes`:

```typescript
export interface WakePushProduct {
  produtoId: string;
  sku?: string;
  informacaoId?: number;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  atributos?: { nome: string; valor: string }[];
  imagensBase64?: { base64: string; formato: 'JPG' | 'PNG' }[];
  campos: { descricao: boolean; seo: boolean; atributos: boolean; imagens: boolean };
}
export interface WakePushResult {
  produtoId: string; sku?: string; ok: boolean;
  steps: Record<'descricao' | 'seo' | 'atributos' | 'imagens', 'ok' | 'skip' | string>;
}
```

Dentro de `registerWakeRoutes`:

```typescript
  app.post('/api/wake/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token = await getUserToken(uid);
      if (!token) return res.status(400).json({ message: 'Wake não conectada.' });

      const produtos: WakePushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      const resultados: WakePushResult[] = [];

      for (const prod of produtos) {
        const id = prod.produtoId;
        const q = `?tipoIdentificador=ProdutoId`;
        const steps: WakePushResult['steps'] = { descricao: 'skip', seo: 'skip', atributos: 'skip', imagens: 'skip' };

        // 1) Descrição -> informações
        if (prod.campos.descricao && prod.descricaoHtml) {
          try {
            let infoId = prod.informacaoId;
            if (!infoId) {
              const infos = await fbitsFetch<any[]>(token, 'GET', `/produtos/${id}/informacoes${q}`).catch(() => []);
              infoId = (Array.isArray(infos) ? (infos.find((i) => i?.tipoInformacao === 'Informacoes') ?? infos[0]) : undefined)?.informacaoId;
            }
            if (infoId) {
              await fbitsFetch(token, 'PUT', `/produtos/${id}/informacoes/${infoId}${q}`, {
                texto: prod.descricaoHtml, exibirSite: true, tipoInformacao: 'Informacoes',
              });
              steps.descricao = 'ok';
            } else {
              steps.descricao = 'Sem bloco de informação para atualizar';
            }
          } catch (e: any) { steps.descricao = e?.message ?? 'erro'; }
        }

        // 2) SEO + metatags
        if (prod.campos.seo && (prod.seoTitle || prod.seoDescription || prod.seoKeywords)) {
          try {
            const metaTags: any[] = [];
            if (prod.seoDescription) metaTags.push({ name: 'description', content: prod.seoDescription });
            if (prod.seoKeywords) metaTags.push({ name: 'keywords', content: prod.seoKeywords });
            await fbitsFetch(token, 'POST', `/produtos/${id}/seo${q}`, { title: prod.seoTitle, metaTags });
            steps.seo = 'ok';
          } catch (e: any) { steps.seo = e?.message ?? 'erro'; }
        }

        // 3) Atributos -> PUT produto
        if (prod.campos.atributos && prod.atributos?.length) {
          try {
            await fbitsFetch(token, 'PUT', `/produtos/${id}${q}`, {
              listaAtributos: prod.atributos.map((a) => ({ nome: a.nome, valor: a.valor, exibir: true })),
            });
            steps.atributos = 'ok';
          } catch (e: any) { steps.atributos = e?.message ?? 'erro'; }
        }

        // 4) Imagens ambientadas
        if (prod.campos.imagens && prod.imagensBase64?.length) {
          try {
            await fbitsFetch(token, 'POST', `/produtos/${id}/imagens${q}`, prod.imagensBase64.map((img, i) => ({
              base64: img.base64, formato: img.formato, exibirMiniatura: false, estampa: false, ordem: 100 + i,
            })));
            steps.imagens = 'ok';
          } catch (e: any) { steps.imagens = e?.message ?? 'erro'; }
        }

        const ok = (['descricao', 'seo', 'atributos', 'imagens'] as const)
          .every((k) => steps[k] === 'ok' || steps[k] === 'skip');
        resultados.push({ produtoId: id, sku: prod.sku, ok, steps });
      }

      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/wakeAgent.ts
git commit -m "feat(wake): endpoint de envio (descrição, SEO, atributos, imagens)"
```

---

## Task 5: Serviço cliente `wakeService.ts`

**Files:**
- Create: `src/services/wakeService.ts`

**Interfaces:**
- Consumes: `auth` (de `../firebase`).
- Produces: `wakeValidate`, `wakeStatus`, `wakeImport`, `wakePush`, `wakeDisconnect`; tipos `WakeStatus`, `WakeNormalizedProduct`, `WakePushProduct`, `WakePushResult`.

- [ ] **Step 1: Criar serviço**

```typescript
import { auth } from '../firebase';

export interface WakeStatus { connected: boolean; validated: boolean; lastValidatedAt: string | null; }
export interface WakeNormalizedProduct {
  produtoId: string; sku: string; nome: string;
  precoPor?: number; precoDe?: number; ean?: string;
  informacaoId?: number; descricaoHtml?: string;
  seoTitle?: string; seoDescription?: string; seoKeywords?: string;
  categorias: string[]; imagens: string[]; raw: unknown;
}
export interface WakePushProduct {
  produtoId: string; sku?: string; informacaoId?: number;
  descricaoHtml?: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string;
  atributos?: { nome: string; valor: string }[];
  imagensBase64?: { base64: string; formato: 'JPG' | 'PNG' }[];
  campos: { descricao: boolean; seo: boolean; atributos: boolean; imagens: boolean };
}
export interface WakePushResult {
  produtoId: string; sku?: string; ok: boolean;
  steps: Record<'descricao' | 'seo' | 'atributos' | 'imagens', string>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado.');
  const token = await user.getIdToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function handle<T>(resp: Response): Promise<T> {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any)?.message ?? `Erro ${resp.status}`);
  return data as T;
}

export async function wakeValidate(token: string): Promise<{ valid: boolean; message: string }> {
  const resp = await fetch('/api/wake/validate', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ token }) });
  return handle(resp);
}
export async function wakeStatus(): Promise<WakeStatus> {
  const resp = await fetch('/api/wake/status', { headers: await authHeaders() });
  return handle(resp);
}
export async function wakeDisconnect(): Promise<void> {
  await fetch('/api/wake/disconnect', { method: 'DELETE', headers: await authHeaders() });
}
export async function wakeImport(pagina = 1, quantidadeRegistros = 50): Promise<{ pagina: number; count: number; hasMore: boolean; produtos: WakeNormalizedProduct[] }> {
  const resp = await fetch('/api/wake/import', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ pagina, quantidadeRegistros }) });
  return handle(resp);
}
export async function wakePush(produtos: WakePushProduct[]): Promise<{ resultados: WakePushResult[] }> {
  const resp = await fetch('/api/wake/push', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ produtos }) });
  return handle(resp);
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/wakeService.ts
git commit -m "feat(wake): serviço cliente para os endpoints /api/wake"
```

---

## Task 6: Componentes de UI (IntegrationsView + WakeConnector)

**Files:**
- Create: `src/components/integrations/WakeConnector.tsx`
- Create: `src/components/integrations/IntegrationsView.tsx`

**Interfaces:**
- Consumes: `wakeService`; props `{ onImport: (produtos: WakeNormalizedProduct[]) => Promise<void>; getPushPayload: () => WakePushProduct[]; }`.
- Produces: `IntegrationsView` (default export) consumido por `App.tsx`.

- [ ] **Step 1: Criar `WakeConnector.tsx`**

Componente com estados: carregando status, formulário de token (não conectado), painel conectado (importar/enviar/desconectar), progresso e relatório. Usa `wakeValidate/wakeStatus/wakeImport/wakePush/wakeDisconnect`. Botão "Enviar para Wake" `disabled={!status.validated}`. Cobre importação por páginas (loop enquanto `hasMore`) chamando `props.onImport` a cada lote, e envio chamando `wakePush(props.getPushPayload())`. (Implementação completa em pt-BR, ícones `lucide-react`: `Plug, Check, RefreshCw, Upload, CloudUpload, X, Loader2`.)

- [ ] **Step 2: Criar `IntegrationsView.tsx`**

Layout com título "Integrações", card Wake (renderiza `<WakeConnector />`) e card "ERP Tiny" desabilitado com badge "Em breve". Repassa props para `WakeConnector`.

- [ ] **Step 3: Verificar tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/integrations/
git commit -m "feat(wake): UI da seção Integrações (Wake + Tiny placeholder)"
```

---

## Task 7: Sidebar, view e handlers em App.tsx

**Files:**
- Modify: `src/App.tsx` (import de ícone `Plug` e `IntegrationsView`; tipo de `mainView`; item de sidebar; render da view; handlers `handleWakeImport`, `buildWakePushPayload`)
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `IntegrationsView`, `wakeService` types.
- Produces: `mainView === 'integrations'` navegável; merge por `_wakeProductId`; backup em `users/{uid}/products/{id}/wake_versions`.

- [ ] **Step 1: Adicionar `Plug` ao import de `lucide-react` e importar `IntegrationsView`**

Em `src/App.tsx:2`, incluir `Plug` na lista de ícones. Adicionar `import IntegrationsView from './components/integrations/IntegrationsView';`.

- [ ] **Step 2: Estender o tipo de `mainView`**

Localizar `useState` de `mainView` (busca: `setMainView`) e adicionar `'integrations'` à união de tipos.

- [ ] **Step 3: Adicionar item de sidebar acima de Configurações**

No bloco `App.tsx:2170-2177` (o `<div>` que contém "Configurações"), inserir **antes** do botão de Configurações um botão "Integrações" (ícone `Plug`) que faz `setMainView('integrations'); setIsSidebarOpen(false);`, seguindo o estilo dos botões de `<nav>`.

- [ ] **Step 4: Implementar `handleWakeImport`**

Função que recebe `produtos: WakeNormalizedProduct[]`, e para cada um:
1. acha produto existente por `_wakeProductId === produtoId`;
2. salva snapshot cru em `users/${uid}/products/${id}/wake_versions/{autoId}` = `{ source: 'wake-import', raw, importedAt: new Date().toISOString() }`;
3. mapeia campos Wake→Product (ver spec §4.1), setando `_wakeProductId`, `_wakeInformacaoId`, status flags;
4. cria/atualiza via os helpers existentes de produto (mesmo caminho do upload de planilha).

- [ ] **Step 5: Implementar `buildWakePushPayload`**

Constrói `WakePushProduct[]` a partir dos produtos selecionados que tenham `_wakeProductId`, mapeando `Descrição complementar`→`descricaoHtml`, `Título SEO`/`Descrição SEO`/`Palavras chave SEO`→seo, atributos de categoria→`atributos`, `_ambientImages`→`imagensBase64` (convertendo via util existente). `campos` conforme seleção da UI.

- [ ] **Step 6: Renderizar a view**

Onde `mainView` é comutado (busca: `mainView === 'categories'`), adicionar ramo `mainView === 'integrations'` que renderiza `<IntegrationsView onImport={handleWakeImport} getPushPayload={buildWakePushPayload} />`.

- [ ] **Step 7: Atualizar `firestore.rules`**

Dentro de `match /users/{userId}`, adicionar:

```
      match /integration_secrets/{docId} {
        allow read, write: if false; // somente Admin SDK
      }
```

Dentro de `match /products/{productId}` (transformar em bloco com sub-match) ou logo após, adicionar:

```
      match /products/{productId}/wake_versions/{versionId} {
        allow read, write: if isOwner(userId);
      }
```

- [ ] **Step 8: Verificar tipos e build**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 9: Verificação manual**

Run: `npm run dev`. Abrir o app, confirmar item "Integrações" na sidebar acima de Configurações, abrir a seção, ver cards Wake e Tiny. (Sem token real, validar apenas a navegação e o estado "não conectado".)
Expected: navegação e UI corretas.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx firestore.rules
git commit -m "feat(wake): seção Integrações na sidebar + import/push + versionamento"
```

---

## Self-Review

- **Cobertura do spec:** §1 objetivos → Tasks 2–7; §2 endpoints Wake → Tasks 2–4; §3 token/proxy → Task 2; §4 import/mapeamento/backup → Tasks 3,7; §5 push → Tasks 4,7; §6 UI/navegação → Tasks 6,7; §7 erros → Tasks 2 (backoff), 4 (por-produto); §8 arquivos → todas; ERP Tiny placeholder → Task 6. ✔
- **Placeholders:** Steps com código mostram o código; Tasks 6/7 descrevem componentes/handlers grandes em prosa direcionada (arquivos novos de UI e edições no monolito de 2700 linhas) — implementados na execução seguindo os tipos definidos nas Tasks 1/5. Sem "TBD".
- **Consistência de tipos:** `WakeNormalizedProduct`, `WakePushProduct`, `WakePushResult` idênticos entre `server/wakeAgent.ts` (Tasks 3/4) e `src/services/wakeService.ts` (Task 5). `_wakeProductId`/`_wakeInformacaoId`/`_wakeVersionId` definidos na Task 1 e usados na Task 7. ✔
