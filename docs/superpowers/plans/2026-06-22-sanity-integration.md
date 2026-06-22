# Sanity Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar integração Sanity à seção de Integrações do módulo Alfred, permitindo publicar artigos aprovados diretamente como documentos `post` com Portable Text.

**Architecture:** O padrão segue exatamente o da integração WordPress existente — credenciais públicas (`sanityProjectId`, `sanityDataset`) ficam em `project.config` no Firestore; o API token fica em `/secrets/sanity` (write-only pelo client, lido apenas pelo servidor via Admin SDK). O endpoint `/publish` existente detecta qual plataforma usar com base em qual integração está configurada (Sanity tem prioridade se ambas estiverem preenchidas). A conversão Markdown → Portable Text é feita no servidor sem dependências externas.

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4, Firestore (Admin SDK + client SDK), Sanity REST API v2021-10-21

## Global Constraints

- Todo texto de UI em português do Brasil (pt-BR)
- Tokens secretos nunca são lidos pelo client — somente escritos (`saveWordpressSecret` é o modelo)
- Sem dependências npm adicionais — a conversão Portable Text é feita manualmente
- Seguir exatamente o visual e padrão de código dos cards WordPress existentes em `IntegrationsView.tsx`
- Sem testes automatizados — validação manual no dev server (`npm run dev`)

---

### Task 1: Estender tipos e config (types.ts + contentService.ts)

**Files:**
- Modify: `src/modules/content/types.ts:10-25` — adicionar campos Sanity em `ContentProjectConfig` e nova interface `SanitySecret`
- Modify: `src/services/contentService.ts:108-115` — adicionar `saveSanitySecret`

**Interfaces:**
- Produces:
  - `ContentProjectConfig.sanityProjectId: string`
  - `ContentProjectConfig.sanityDataset: string`
  - `SanitySecret { apiToken: string }`
  - `saveSanitySecret(uid: string, projectId: string, apiToken: string): Promise<void>`

- [ ] **Step 1: Adicionar campos Sanity em `ContentProjectConfig` e `SanitySecret`**

Em `src/modules/content/types.ts`, localizar a interface `ContentProjectConfig` (linha ~10) e adicionar após `wordpressUser`:

```typescript
  // Sanity publishing. The API token is sensitive — stored in a separate
  // secrets subdoc (secrets/sanity), never readable by the client.
  sanityProjectId: string;
  sanityDataset: string;
```

Ainda no mesmo arquivo, após a interface `WordpressSecret` (linha ~43), adicionar:

```typescript
// Sensitive secret, stored at `.../contentProjects/{id}/secrets/sanity`.
// Firestore rules forbid client reads; only the Admin SDK (server) reads it.
export interface SanitySecret {
  apiToken: string;
}
```

- [ ] **Step 2: Adicionar `saveSanitySecret` em contentService.ts**

Em `src/services/contentService.ts`, após a função `saveWordpressSecret` (linha ~115), adicionar:

```typescript
// Stores the sensitive Sanity API Token in a separate subdoc the
// client can write but never read back (Firestore rules: read=false).
export async function saveSanitySecret(uid: string, projectId: string, apiToken: string): Promise<void> {
  await setDoc(doc(db, `users/${uid}/contentProjects/${projectId}/secrets/sanity`), {
    apiToken,
    updatedAt: serverTimestamp(),
  });
}
```

- [ ] **Step 3: Verificar que o TypeScript compila sem erros**

```bash
npm run lint
```

Esperado: zero erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/content/types.ts src/services/contentService.ts
git commit -m "feat(content): add Sanity config fields and saveSanitySecret"
```

---

### Task 2: Card Sanity na IntegrationsView

**Files:**
- Modify: `src/modules/content/IntegrationsView.tsx` — adicionar estado e card Sanity

**Interfaces:**
- Consumes:
  - `ContentProject.config.sanityProjectId: string`
  - `ContentProject.config.sanityDataset: string`
  - `updateProjectConfig(uid, projectId, config): Promise<void>` — já existe
  - `saveSanitySecret(uid, projectId, apiToken): Promise<void>` — Task 1

- [ ] **Step 1: Adicionar imports e estado Sanity**

Em `src/modules/content/IntegrationsView.tsx`, linha 4, adicionar `saveSanitySecret` ao import de contentService:

```typescript
import { updateProjectConfig, saveWordpressSecret, saveSanitySecret } from '../../services/contentService';
```

Após as declarações de estado WordPress (linha ~19), adicionar:

```typescript
  const [sanityProjectId, setSanityProjectId] = useState(project.config.sanityProjectId ?? '');
  const [sanityDataset, setSanityDataset] = useState(project.config.sanityDataset ?? 'production');
  const [sanityToken, setSanityToken] = useState('');
  const [savingSanity, setSavingSanity] = useState(false);
  const [savedSanity, setSavedSanity] = useState(false);
  const [errorSanity, setErrorSanity] = useState<string | null>(null);
```

- [ ] **Step 2: Adicionar handler `handleSaveSanity`**

Após o `handleSave` do WordPress (linha ~42), adicionar:

```typescript
  const handleSaveSanity = async () => {
    setSavingSanity(true);
    setErrorSanity(null);
    setSavedSanity(false);
    try {
      await updateProjectConfig(uid, project.id, {
        ...project.config,
        sanityProjectId: sanityProjectId.trim(),
        sanityDataset: sanityDataset.trim() || 'production',
      });
      if (sanityToken.trim()) {
        await saveSanitySecret(uid, project.id, sanityToken.trim());
        setSanityToken('');
      }
      setSavedSanity(true);
    } catch (e) {
      setErrorSanity(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSavingSanity(false);
    }
  };

  const sanityConnected = !!project.config.sanityProjectId;
```

- [ ] **Step 3: Adicionar card Sanity no JSX**

Após o fechamento `</div>` do card WordPress (linha ~101), antes do fechamento do container principal, adicionar:

```tsx
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 mt-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-2.5 rounded-xl">
              <Plug className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Sanity</h3>
              <p className="text-xs text-slate-500">Publica os artigos aprovados como documentos no Sanity Studio.</p>
            </div>
          </div>
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${sanityConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {sanityConnected ? 'Conectado' : 'Não conectado'}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Project ID</label>
            <input
              value={sanityProjectId}
              onChange={(e) => setSanityProjectId(e.target.value)}
              placeholder="abc123xy"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]"
            />
            <p className="text-xs text-slate-400 mt-1">Encontre em <strong>sanity.io/manage → Project → Settings</strong>.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Dataset</label>
            <input
              value={sanityDataset}
              onChange={(e) => setSanityDataset(e.target.value)}
              placeholder="production"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">API Token</label>
            <input
              type="password"
              value={sanityToken}
              onChange={(e) => setSanityToken(e.target.value)}
              placeholder={sanityConnected ? '•••• (deixe vazio para manter)' : 'skTokenAbc...'}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6]"
            />
            <p className="text-xs text-slate-400 mt-1">Gere em <strong>sanity.io/manage → API → Tokens</strong> com permissão <strong>Editor</strong>. Guardado com segurança; usado apenas pelo servidor.</p>
          </div>
        </div>

        {errorSanity && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{errorSanity}</div>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          {savedSanity && (
            <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
              <Check className="w-4 h-4" /> Salvo
            </span>
          )}
          <button
            onClick={handleSaveSanity}
            disabled={savingSanity}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {savingSanity ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar integração
          </button>
        </div>
      </div>
```

- [ ] **Step 4: Verificar TypeScript**

```bash
npm run lint
```

Esperado: zero erros.

- [ ] **Step 5: Testar no dev server**

```bash
npm run dev
```

Navegar até o módulo Alfred → Integrações. Verificar:
- Card Sanity aparece abaixo do WordPress
- Badge "Não conectado" visível
- Campos Project ID, Dataset (pré-preenchido "production") e API Token funcionam
- Botão "Salvar integração" chama `handleSaveSanity` sem erros no console
- Após salvar com Project ID preenchido, badge muda para "Conectado" ao recarregar

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/IntegrationsView.tsx
git commit -m "feat(content): add Sanity integration card in IntegrationsView"
```

---

### Task 3: Conversão Markdown → Portable Text e `publishToSanity` no servidor

**Files:**
- Modify: `server/contentAgent.ts` — adicionar `markdownToPortableText`, `publishToSanity`, e atualizar o endpoint `/publish`

**Interfaces:**
- Consumes:
  - `project.config.sanityProjectId: string` — Task 1
  - `project.config.sanityDataset: string` — Task 1
  - `/secrets/sanity` Firestore subdoc com `{ apiToken: string }` — Task 1
  - `article.articleFinal: string` (markdown)
  - `article.titulo: string`
  - `article.slug?: string`
  - `article.metaDescription?: string`
  - `article.imageUrl?: string`
  - `debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName })` — já existe
- Produces:
  - `publishToSanity(uid, projectId, articleId): Promise<string>` — retorna URL do documento

**Portable Text block shape usada:**
```typescript
interface PTSpan { _type: 'span'; _key: string; text: string; marks: string[] }
interface PTBlock { _type: 'block'; _key: string; style: string; children: PTSpan[]; markDefs: [] }
```

- [ ] **Step 1: Adicionar `markdownToPortableText` em contentAgent.ts**

Localizar a função `markdownToHtml` (linha ~603) e adicionar logo abaixo:

```typescript
// Converts a subset of Markdown to Sanity Portable Text blocks.
// Handles: headings (#, ##, ###), bold (**text**), paragraphs.
function markdownToPortableText(md: string): PTBlock[] {
  type PTSpan = { _type: 'span'; _key: string; text: string; marks: string[] };
  type PTBlock = { _type: 'block'; _key: string; style: string; children: PTSpan[]; markDefs: [] };

  let key = 0;
  const nextKey = () => `k${key++}`;

  // Strip SLUG:/META: lines (same as markdownToHtml)
  const cleaned = md
    .replace(/SLUG:.*$/im, '')
    .replace(/META:.*$/im, '')
    .trim();

  const blocks: PTBlock[] = [];

  for (const rawLine of cleaned.split(/\n{2,}/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Heading detection
    let style = 'normal';
    let text = line;
    if (line.startsWith('### ')) { style = 'h3'; text = line.slice(4); }
    else if (line.startsWith('## ')) { style = 'h2'; text = line.slice(3); }
    else if (line.startsWith('# ')) { style = 'h1'; text = line.slice(2); }

    // Bold spans: split by **...**
    const children: PTSpan[] = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = boldRegex.exec(text)) !== null) {
      if (match.index > last) {
        children.push({ _type: 'span', _key: nextKey(), text: text.slice(last, match.index), marks: [] });
      }
      children.push({ _type: 'span', _key: nextKey(), text: match[1], marks: ['strong'] });
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      children.push({ _type: 'span', _key: nextKey(), text: text.slice(last), marks: [] });
    }
    if (!children.length) {
      children.push({ _type: 'span', _key: nextKey(), text, marks: [] });
    }

    blocks.push({ _type: 'block', _key: nextKey(), style, children, markDefs: [] });
  }

  return blocks;
}
```

- [ ] **Step 2: Adicionar `publishToSanity` em contentAgent.ts**

Logo após `publishToWordpress` (linha ~685), adicionar:

```typescript
async function publishToSanity(uid: string, projectId: string, articleId: string): Promise<string> {
  const project = await loadProject(uid, projectId);
  const { sanityProjectId, sanityDataset } = project.config;
  if (!sanityProjectId) {
    throw Object.assign(new Error('Project ID do Sanity não configurado'), { status: 400 });
  }
  const dataset = sanityDataset || 'production';

  const secretSnap = await projectRef(uid, projectId).collection('secrets').doc('sanity').get();
  const apiToken = secretSnap.exists ? (secretSnap.data() as { apiToken?: string }).apiToken : undefined;
  if (!apiToken) throw Object.assign(new Error('API Token do Sanity ausente'), { status: 400 });

  const artRef = projectRef(uid, projectId).collection('calendar').doc(articleId);
  const snap = await artRef.get();
  if (!snap.exists) throw Object.assign(new Error('Artigo não encontrado'), { status: 404 });
  const article = { id: snap.id, ...(snap.data() as Omit<CalendarArticle, 'id'>) };
  if (!article.articleFinal) throw Object.assign(new Error('Artigo ainda não produzido'), { status: 400 });

  const slug = article.slug || article.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const docId = `article-${articleId}`;

  const mutations = [
    {
      createOrReplace: {
        _id: docId,
        _type: 'post',
        title: article.titulo,
        slug: { _type: 'slug', current: slug },
        body: markdownToPortableText(article.articleFinal),
        excerpt: article.metaDescription || undefined,
        publishedAt: new Date().toISOString(),
      },
    },
  ];

  const apiUrl = `https://${sanityProjectId}.api.sanity.io/v2021-10-21/data/mutate/${dataset}`;
  const mutateResp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mutations }),
  });

  if (!mutateResp.ok) {
    const body = await mutateResp.text();
    throw Object.assign(new Error(`Falha ao publicar no Sanity: ${mutateResp.status} — ${body}`), { status: 502 });
  }

  const documentUrl = `https://${sanityProjectId}.sanity.studio/desk/post;${docId}`;

  await debitCreditsAdmin(uid, CREDIT_ACTIONS.contentPublish, { productName: article.titulo });
  await artRef.update({
    status: 'publicado',
    urlPublicado: documentUrl,
    dataPublicacao: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return documentUrl;
}
```

- [ ] **Step 3: Atualizar o endpoint `/publish` para escolher plataforma**

Localizar o handler do endpoint `/publish` (linha ~826):

```typescript
  app.post('/api/content/projects/:projectId/articles/:articleId/publish', async (req, res) => {
    ...
      const url = await publishToWordpress(decoded.uid, req.params.projectId, req.params.articleId);
    ...
  });
```

Substituir a chamada `publishToWordpress` pela lógica de seleção:

```typescript
  app.post('/api/content/projects/:projectId/articles/:articleId/publish', async (req, res) => {
    try {
      const decoded = await verifyToken(req);
      const project = await loadProject(decoded.uid, req.params.projectId);
      let url: string;
      if (project.config.sanityProjectId) {
        url = await publishToSanity(decoded.uid, req.params.projectId, req.params.articleId);
      } else {
        url = await publishToWordpress(decoded.uid, req.params.projectId, req.params.articleId);
      }
      res.json({ url });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno' });
    }
  });
```

> **Nota:** Verificar como o handler existente está estruturado (pode ter um `try/catch` diferente) e adaptar apenas a linha de chamada, mantendo o restante intacto.

- [ ] **Step 4: Verificar TypeScript**

```bash
npm run lint
```

Esperado: zero erros.

- [ ] **Step 5: Testar no dev server**

```bash
npm run dev
```

Verificar:
- Servidor sobe sem erros
- Com `sanityProjectId` preenchido no projeto, o endpoint `/publish` chama `publishToSanity`
- Sem `sanityProjectId`, continua chamando `publishToWordpress` normalmente

- [ ] **Step 6: Commit**

```bash
git add server/contentAgent.ts
git commit -m "feat(content): add Sanity publishing with Markdown to Portable Text conversion"
```
