# Agente de Conteúdo Conversacional (CopilotKit + LangGraph) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Agente de Conteúdo be operated by chat — onboarding, clusters, calendário, produção/publicação de artigos, auditoria de SEO — via CopilotKit no frontend e um grafo LangGraph.js no backend, com aprovação humana antes de qualquer escrita relevante.

**Architecture:** Um servidor LangGraph.js separado (processo/deploy próprio, mesmo repositório) hospeda um `StateGraph` que vincula todas as ferramentas `provider: 'content'` do registry já existente (`server/agent/registry.ts`) a um modelo Gemini via Vertex AI. Ferramentas de escrita chamam `interrupt()` para pausar o grafo até aprovação (ou pulam direto para `execute()` quando o usuário configurou modo automático para aquela ferramenta). O app Express principal expõe `/api/copilotkit`, que encaminha para esse servidor via `LangGraphHttpAgent`. O frontend usa `@copilotkit/react-core`/`react-ui` no workspace de Conteúdo (`src/modules/content/ContentApp.tsx`), com um cartão de aprovação genérico e um formulário de credencial (WordPress/Sanity) que nunca passa pelo modelo.

**Tech Stack:** TypeScript, Express, React 19, Firebase Admin SDK/Firestore, `@langchain/langgraph` + `@langchain/langgraph-cli` + `@langchain/langgraph-checkpoint` + `@langchain/core` + `@langchain/google-vertexai`, `@copilotkit/runtime` (servidor) + `@copilotkit/react-core`/`react-ui` (frontend), `@google/genai` (já usado por `contentAgent.ts`/`seoAgent.ts`, inalterado).

**Spec:** `docs/superpowers/specs/2026-08-28-content-agent-chat-copilotkit-langgraph-design.md`

## Global Constraints

- `POST /api/content/cron/tick` nunca vira ferramenta — o scheduler autônomo não pode ficar acessível ao modelo.
- `content.artigo.publicar` e `content.artigo.despublicar` **sempre** pedem aprovação, ignorando `agent_settings.approvalMode` — trava estrutural, não configurável.
- A senha de aplicativo do WordPress e o token de API do Sanity **nunca** passam por argumento de tool call nem pelo contexto do modelo — só pelo formulário de credencial, que grava direto no Firestore.
- `content.projeto.criar` é a única ferramenta de escrita do onboarding; editar um projeto já existente continua pela tela de configurações atual (fora de escopo).
- O Agente Operacional (`server/agent/loop.ts` e tudo que ele já usa) e o Agente de Produto não são alterados nesta entrega.
- Toda UI, prompt de sistema e texto do modelo em português do Brasil (convenção do projeto, `CLAUDE.md`).
- Sem suíte de testes automatizada no projeto — lógica pura ganha `scripts/verify-*.mjs` (mesmo padrão de `scripts/verify-agent-tools.mjs`); o resto se valida manualmente com `npm run dev`.
- `langgraph.json` exige `node_version: "20"` — confirmar que o Node local/produção é 20.x antes de rodar o CLI.

---

## Task 1: Scaffold do servidor LangGraph.js (grafo de brinquedo)

**Files:**
- Create: `langgraph.json`
- Create: `server/agent/contentGraph.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `graph` exportado de `server/agent/contentGraph.ts` — um `CompiledStateGraph` do LangGraph.js, o entry point que `langgraph.json` referencia.

- [ ] **Step 1: Instalar as dependências do LangGraph.js**

```bash
npm install @langchain/langgraph @langchain/core zod
npm install -D @langchain/langgraph-cli
```

- [ ] **Step 2: Criar o grafo de brinquedo**

```typescript
// server/agent/contentGraph.ts
//
// Grafo do Agente de Conteúdo. Nesta task é só um eco, para provar que o
// servidor LangGraph.js sobe e responde — a Task 10 substitui o corpo deste
// arquivo pelo grafo real, vinculado às ferramentas `provider: 'content'`.

import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';

async function echo(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1);
  const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
  return { messages: [{ role: 'assistant' as const, content: `echo: ${text}` }] };
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('echo', echo)
  .addEdge(START, 'echo')
  .addEdge('echo', END)
  .compile();
```

- [ ] **Step 3: Criar `langgraph.json` na raiz do repo**

```json
{
  "graphs": {
    "content_agent": "./server/agent/contentGraph.ts:graph"
  },
  "node_version": "20",
  "env": ".env"
}
```

- [ ] **Step 4: Adicionar o script de dev do grafo ao `package.json`**

No bloco `"scripts"` de `package.json`, adicionar:

```json
"dev:content-agent": "langgraph dev --host localhost --port 8123"
```

- [ ] **Step 5: Rodar e verificar manualmente**

Run: `npm run dev:content-agent`
Expected: o CLI sobe em `http://localhost:8123`, sem erros de compilação do `contentGraph.ts`. Abrir `http://localhost:8123/docs` (ou o endereço que o CLI imprimir) deve responder — confirma que o servidor está de pé antes de conectar o CopilotKit na próxima task.

- [ ] **Step 6: Commit**

```bash
git add langgraph.json server/agent/contentGraph.ts package.json package-lock.json
git commit -m "feat(content-agent): scaffold LangGraph.js dev server with echo graph"
```

---

## Task 2: Round-trip de aprovação ponta a ponta (CopilotKit + interrupt de brinquedo)

Este é o passo de maior risco técnico do plano — e o passo onde a API real do
CopilotKit instalado (`1.69.3`) se revelou **v2**, bem diferente da v1
documentada publicamente e usada para redigir a primeira versão deste plano.
Correções abaixo já refletem o que foi validado de verdade, em quatro
camadas: (1) `interrupt()`/`Command({resume})` cru via API HTTP do LangGraph
(`/threads/{id}/runs/wait`); (2) o evento AG-UI que isso produz, capturado
direto do `@copilotkit/runtime/langgraph`'s `LangGraphAgent.runAgent()`; (3)
leitura do código-fonte compilado de `@ag-ui/langgraph` e do
`useInterrupt` de `@copilotkit/react-core/v2`; (4) o round-trip HTTP completo
através da própria rota Express, com um usuário de teste real (Identity
Toolkit REST, sem precisar de service account) confirmando a injeção do
`uid` verificado no servidor.

**Achado principal:** a integração `@copilotkit/runtime/langgraph`'s
`LangGraphAgent`/`LangGraphHttpAgent` traduz um `interrupt()` do LangGraph.js
num evento **`CUSTOM` chamado `"on_interrupt"`**, com `value` sendo o payload
passado para `interrupt()` serializado em JSON-string. No frontend, o hook
dedicado pra isso é `useInterrupt` (`@copilotkit/react-core/v2`) — não
`useCopilotAction`/`renderAndWaitForResponse` (API v1) nem `useHumanInTheLoop`
(esse é para ferramentas que rodam inteiramente no cliente, casado por nome —
diferente do nosso caso, que é uma ferramenta do grafo pausando). O `resolve()`
de `useInterrupt` já sabe reenviar `forwardedProps.command.resume` sozinho —
não precisa ser implementado à mão.

**Achado secundário (bug de tooling, não do nosso código):**
`@ag-ui/client` (dependência transitiva do CopilotKit) traz `fast-json-patch`,
que publica um `index.ts` órfão ao lado do `index.js` real. Sob `tsx` (usado
por `npm run dev`), esse arquivo órfão é resolvido no lugar do `index.js` e
quebra com `MODULE_NOT_FOUND` (seu próprio `require('./src/core')` não existe
no pacote publicado) — `npm run build` não é afetado (usa esbuild, que resolve
`package.json#main` corretamente). Corrigido com um `postinstall` que renomeia
o arquivo órfão (ver Step 1).

**Files:**
- Create: `scripts/fix-fast-json-patch.mjs`
- Modify: `package.json` (script `postinstall` + `dev:content-agent` já existente)
- Create: `server/copilotRuntime.ts`
- Modify: `server.ts`
- Modify: `server/agent/contentGraph.ts`
- Create: `src/modules/content/chat/ContentChatDebug.tsx`

**Interfaces:**
- Consumes: `graph` de `server/agent/contentGraph.ts` (Task 1); `adminAuth` de `server/firebaseAdmin.ts`.
- Produces: `registerCopilotRuntime(app: express.Application): void`, montada em `/api/copilotkit` **antes** do `express.json()` global (precisa do corpo cru como stream fetch-native — ver Step 4).

- [ ] **Step 1: Instalar as dependências do CopilotKit e corrigir o `fast-json-patch` órfão**

```bash
npm install @copilotkit/runtime @copilotkit/react-core @copilotkit/react-ui
```

```javascript
// scripts/fix-fast-json-patch.mjs
//
// fast-json-patch@3.1.1 (dependência transitiva de @ag-ui/client, que vem do
// CopilotKit) publica um `index.ts` órfão ao lado do `index.js` real. Sob tsx
// (usado por `npm run dev`), esse arquivo órfão é resolvido no lugar do
// `index.js` e quebra com MODULE_NOT_FOUND (seu `require('./src/core')`
// próprio não existe no pacote publicado). `npm run build` não é afetado
// (esbuild resolve `package.json#main` corretamente) — é um problema só do
// dev server via tsx. Renomear é inofensivo: nada importa
// `fast-json-patch/index.ts` diretamente, só o especificador nu
// `fast-json-patch`, que passa a resolver `index.js` assim que `index.ts`
// não está mais lá pra ofuscar.
import { existsSync, renameSync } from 'node:fs';

const path = 'node_modules/fast-json-patch/index.ts';
if (existsSync(path)) {
  renameSync(path, `${path}.bak`);
  console.log(`[fix-fast-json-patch] renamed ${path} -> ${path}.bak`);
}
```

No bloco `"scripts"` de `package.json`, adicionar (antes de `"dev"`):

```json
"postinstall": "node scripts/fix-fast-json-patch.mjs",
```

Run: `node scripts/fix-fast-json-patch.mjs`
Expected: imprime a linha de rename (ou nada, se já corrigido — idempotente).

- [ ] **Step 2: Adicionar um tool de brinquedo que interrompe o grafo**

Substituir o conteúdo de `server/agent/contentGraph.ts`:

```typescript
// server/agent/contentGraph.ts
//
// Grafo do Agente de Conteúdo. Nesta task tem um tool de brinquedo que chama
// interrupt() — só para validar o round-trip de aprovação ponta a ponta antes
// de construir o catálogo real (Task 10 substitui isto).

import { StateGraph, START, END, MessagesAnnotation, interrupt } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { ChatVertexAI } from '@langchain/google-vertexai';
import * as z from 'zod';

const toyWriteTool = tool(
  async ({ mensagem }: { mensagem: string }) => {
    const decisao = interrupt({
      resumo: `Confirma o envio: "${mensagem}"?`,
      alvo: 'brinquedo',
      campos: [],
      avisos: [],
    }) as { aprovado: boolean };
    if (!decisao?.aprovado) return 'Ação cancelada pelo usuário.';
    return `Mensagem enviada: ${mensagem}`;
  },
  {
    name: 'toy_write',
    description: 'Ferramenta de teste que pede aprovação antes de "enviar" uma mensagem.',
    schema: z.object({ mensagem: z.string() }),
  },
);

// Nota: "project" NÃO é um campo direto de ChatVertexAIInput — o id do
// projeto GCP entra via authOptions.projectId (google-auth-library). Só
// "location" é campo de topo.
const model = new ChatVertexAI({
  model: 'gemini-2.5-flash',
  location: process.env.VERTEX_LOCATION || 'us-central1',
  authOptions: { projectId: process.env.VERTEX_PROJECT_ID },
}).bindTools([toyWriteTool]);

async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1) as { tool_calls?: unknown[] } | undefined;
  return last?.tool_calls?.length ? 'tools' : END;
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', new ToolNode([toyWriteTool]))
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['tools', END])
  .addEdge('tools', 'agent')
  .compile();
```

**Nota de ambiente:** se `ChatVertexAI` retornar HTTP 403, confira se
`VERTEX_PROJECT_ID` no `.env` é um projeto GCP onde as credenciais ADC locais
(`gcloud auth application-default login`) têm permissão de Vertex AI — em
dev, o projeto do Firebase (`firebase-applet-config.json#projectId`) costuma
funcionar mesmo quando um `VERTEX_PROJECT_ID` de produção não funciona
localmente.

- [ ] **Step 3: Montar o runtime do CopilotKit no Express (API v2 real, confirmada contra o pacote instalado)**

A API pública documentada para LangGraph (`CopilotRuntime`/`copilotRuntimeNodeHttpEndpoint` do pacote raiz, com um `serviceAdapter` tipo `GoogleGenerativeAIAdapter`) é a **v1, obsoleta**. A versão instalada (`@copilotkit/runtime@1.69.3`) usa uma API v2 completamente diferente — confirmada lendo `node_modules/@copilotkit/runtime/skills/runtime/references/*.md` (o próprio pacote publica esses guias) e o código-fonte compilado. Nela: `CopilotRuntime`/`createCopilotRuntimeHandler` vêm de `@copilotkit/runtime/v2`; `LangGraphAgent`/`LangGraphHttpAgent` continuam vindo de `@copilotkit/runtime/langgraph` (apesar de um `@deprecated` na JSDoc — os guias v2 do próprio pacote recomendam exatamente esse import, então é o caminho certo); não existe mais `serviceAdapter` obrigatório de fallback; o handler fala fetch nativo (`Request`/`Response`), não Express, e precisa de uma ponte manual documentada pelo próprio pacote.

```typescript
// server/copilotRuntime.ts
//
// Ponte entre o Express principal e o servidor LangGraph.js do Agente de
// Conteúdo. @copilotkit/runtime v2 fala fetch (Request/Response) nativo, não
// Express — a delegação abaixo é o padrão documentado pelo próprio pacote
// (node_modules/@copilotkit/runtime/skills/runtime/references/setup-endpoint.md)
// para expor um handler fetch-native dentro de uma rota Express, com streaming
// via SSE preservado (sem bufferizar o corpo da resposta).
import type express from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2';
import { LangGraphAgent } from '@copilotkit/runtime/langgraph';
import { adminAuth } from './firebaseAdmin';

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_LANGGRAPH_URL || 'http://localhost:8123';
const BASE_PATH = '/api/copilotkit';

export function registerCopilotRuntime(app: express.Application): void {
  const runtime = new CopilotRuntime({
    agents: {
      content_agent: new LangGraphAgent({
        deploymentUrl: CONTENT_AGENT_URL,
        graphId: 'content_agent',
      }),
    },
  });

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    hooks: {
      // Verifica o token Firebase e substitui qualquer uid que o cliente
      // tenha mandado por um valor confiável, resolvido no servidor — nunca
      // confiamos em uid vindo do navegador. O uid verificado entra em
      // forwardedProps.config.configurable, que o SDK do LangGraph.js
      // repassa como config.configurable do grafo (confirmado lendo
      // node_modules/@ag-ui/langgraph/dist/index.mjs:prepareStream, e por
      // teste ao vivo: o uid injetado aqui apareceu no RUN_STARTED echoado
      // pelo próprio LangGraph).
      onBeforeHandler: async ({ route, request }) => {
        if (route.method !== 'agent/run') return;

        const auth = request.headers.get('authorization') ?? '';
        const token = auth.replace(/^Bearer\s+/i, '');
        if (!token) throw new Response('Não autenticado', { status: 401 });
        const decoded = await adminAuth.verifyIdToken(token).catch(() => null);
        if (!decoded) throw new Response('Não autenticado', { status: 401 });

        const body = await request.clone().json().catch(() => ({}) as Record<string, unknown>);
        const forwardedProps = (body.forwardedProps ?? {}) as Record<string, unknown>;
        const config = (forwardedProps.config ?? {}) as Record<string, unknown>;
        const configurable = (config.configurable ?? {}) as Record<string, unknown>;

        body.forwardedProps = {
          ...forwardedProps,
          config: { ...config, configurable: { ...configurable, uid: decoded.uid } },
        };

        return new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(body),
        });
      },
      onError: async ({ error, route }) => {
        console.error('[copilotkit]', route?.method, error);
      },
    },
  });

  app.all(`${BASE_PATH}/*`, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : (req as unknown as BodyInit),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const webRes = await handler(webReq);
    res.status(webRes.status);
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    if (webRes.body) {
      Readable.fromWeb(webRes.body as unknown as WebReadableStream).pipe(res);
    } else {
      res.end();
    }
  });
}
```

- [ ] **Step 4: Registrar a rota em `server.ts` — ANTES do `express.json()` global**

`registerCopilotRuntime` precisa do corpo da requisição como stream cru
(`body: req` acima) para reconstruir um `Request` fetch-nativo. Se
`express.json()` rodar primeiro, ele já drena esse stream para `req.body`, e
o `Request` reconstruído chega vazio no handler do CopilotKit. Por isso a
rota é registrada **antes** do body-parser global, não junto dos outros
`register*Routes` (que ficam depois e dependem de `req.body` parseado):

```typescript
// server.ts — import no topo, junto dos outros register*
import { registerCopilotRuntime } from "./server/copilotRuntime";

// server.ts — dentro de startServer(), ANTES de app.use(express.json(...))
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

registerCopilotRuntime(app);

app.use(express.json({ limit: '50mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ... registerContentRoutes(app, { verifyFirebaseToken }) e demais, sem mudança
```

- [ ] **Step 5: Harness de debug no frontend (API v2: `useInterrupt`, não `useCopilotAction`)**

Achado (lendo `node_modules/@copilotkit/react-core/dist/copilotkit-*.mjs` e
`node_modules/@copilotkit/react-core/skills/react-core/references/*.md`):
todos os componentes de chat (`CopilotKit`, `CopilotChat`, `CopilotSidebar`,
`CopilotPopup`) vivem em `@copilotkit/react-core/v2` — `@copilotkit/react-ui`
é só a v1 legada, seu `/v2` é apenas CSS. Para reagir a um `interrupt()` do
LangGraph, o hook certo é `useInterrupt` (não `useCopilotAction` nem
`useHumanInTheLoop`, que é para ferramentas que rodam no cliente, casadas por
nome — diferente do nosso caso). `useInterrupt`'s `resolve(payload)` já sabe
reenviar `forwardedProps.command.resume` sozinho.

```tsx
// src/modules/content/chat/ContentChatDebug.tsx
//
// Página temporária só para validar o round-trip de aprovação. Removida/
// substituída na Task 13 pela integração real no ContentApp.
import { CopilotKit, CopilotChat, useInterrupt } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';

interface ToyInterruptPayload {
  resumo?: string;
  alvo?: string;
}

function ToyApproval() {
  useInterrupt({
    agentId: 'content_agent',
    render: ({ event, resolve }) => {
      const payload: ToyInterruptPayload = event?.value ? JSON.parse(event.value as string) : {};
      return (
        <div className="border rounded-lg p-3 space-y-2">
          <p>{payload.resumo ?? 'Aprovar ação?'}</p>
          <div className="flex gap-2">
            <button onClick={() => resolve({ aprovado: true })}>Aprovar</button>
            <button onClick={() => resolve({ aprovado: false })}>Rejeitar</button>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default function ContentChatDebug({ authToken }: { authToken: string }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="content_agent" headers={{ Authorization: `Bearer ${authToken}` }}>
      <ToyApproval />
      <CopilotChat agentId="content_agent" />
    </CopilotKit>
  );
}
```

Note que a prop do provider `<CopilotKit>` é `agent` (não `agentId` — só
`useInterrupt`/`useAgent`/`<CopilotChat>` usam `agentId`); `tsc --noEmit`
pega esse tipo de erro na hora.

- [ ] **Step 6: Verificação do mecanismo**

O round-trip completo foi validado em 4 camadas independentes durante o
desenvolvimento deste plano (documentado acima), incluindo uma chamada HTTP
real e autenticada contra `/api/copilotkit/agent/content_agent/run` com um
usuário de teste descartável (criado via `identitytoolkit.googleapis.com`
REST, sem precisar de service account), confirmando que o `uid` verificado
no servidor chega ao `config.configurable` do grafo. Ao reexecutar esta task
numa sessão nova, validar pelo menos manualmente pelo navegador:

Run: `npm run dev:content-agent` (terminal 1), `npm run dev` (terminal 2).
Logar no app com um usuário de teste, montar `ContentChatDebug` numa rota
temporária acessível (passando o ID token do usuário logado, obtido via
`user.getIdToken()`), pedir no chat "manda a mensagem 'oi' pro teste".

Expected: o card de aprovação aparece com o resumo → Aprovar → a resposta
final do assistente contém "Mensagem enviada: oi". Repetir com Rejeitar e
confirmar "Ação cancelada pelo usuário."

- [ ] **Step 7: Commit**

```bash
git add scripts/fix-fast-json-patch.mjs server/copilotRuntime.ts server.ts server/agent/contentGraph.ts src/modules/content/chat/ContentChatDebug.tsx package.json package-lock.json
git commit -m "feat(content-agent): validate CopilotKit v2 + LangGraph interrupt approval round-trip"
```

---

## Task 3: `toLangChainTools()` — o registry vira consumível pelo LangGraph

**Files:**
- Modify: `server/agent/types.ts:17` (linha do `ToolProvider`)
- Modify: `server/agent/registry.ts`
- Modify: `server/agent/agentSettings.ts` (criado na Task 4 — se essa task rodar depois, deixar um `resolveApprovalMode` inline temporário aqui e importar de verdade quando a Task 4 existir; **ordem recomendada: rodar a Task 4 antes desta**)
- Create: `scripts/verify-content-langchain-adapter.mjs`

> Reordenação: implementar a Task 4 (agent_settings) antes desta Task 3, mesmo a numeração indicando o contrário — `toLangChainTools()` depende de `resolveApprovalMode()`. Os arquivos abaixo já assumem que a Task 4 rodou primeiro.

**Interfaces:**
- Consumes: `ToolDef<A>`, `ToolCtx`, `listTools()` de `server/agent/registry.ts`/`types.ts` (já existentes); `resolveApprovalMode(settings: AgentSettings, toolName: string): 'ask' | 'auto'` de `server/agent/agentSettings.ts` (Task 4).
- Produces: `toLangChainTools(providers: ToolProvider[], ctx: ToolCtx, settings: AgentSettings): DynamicStructuredTool[]` em `server/agent/registry.ts` — consumida pela Task 10 (grafo real).

- [ ] **Step 1: Extender `ToolProvider`**

```typescript
// server/agent/types.ts:17
export type ToolProvider = 'wake' | 'tiny' | 'docs' | 'content';
```

- [ ] **Step 2: Escrever o adaptador `toLangChainTools()`**

```typescript
// server/agent/registry.ts — adicionar ao final do arquivo, depois de toGeminiDeclarations()
import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { resolveApprovalMode, type AgentSettings } from './agentSettings';
import type { ToolCtx } from './types';

/**
 * Converte o registry em ferramentas do LangChain/LangGraph. Ferramentas de
 * leitura chamam `.read()` direto. Ferramentas de escrita sempre chamam
 * `.preview()`; a partir daí, ou seguem para `.execute()` (modo automático
 * para aquele tool) ou pausam o grafo com `interrupt()` até a aprovação — o
 * mesmo invariante do loop do Operacional, só que via LangGraph em vez de
 * `agent_actions`.
 */
export function toLangChainTools(
  providers: ToolProvider[],
  ctx: ToolCtx,
  settings: AgentSettings,
): DynamicStructuredTool[] {
  return listTools(providers).map((def) =>
    tool(
      // Erros de qualquer ferramenta (read/preview/execute) viram texto de
      // retorno em vez de exceção — uma exceção aqui derrubaria o nó do grafo
      // inteiro; devolver o erro como resultado deixa o modelo explicar ao
      // usuário e tentar de novo, mesmo espírito de sendError() nas rotas
      // HTTP existentes, sem ter uma resposta HTTP no meio.
      async (args: Record<string, unknown>) => {
        try {
          if (def.mode === 'read') {
            return await def.read!(ctx, args);
          }

          const preview = await def.preview!(ctx, args);
          const mode = resolveApprovalMode(settings, def.name);
          if (mode === 'auto') {
            return await def.execute!(ctx, args, preview);
          }

          const decisao = interrupt({
            ferramenta: def.name,
            resumo: preview.resumo,
            alvo: preview.alvo,
            campos: preview.campos,
            avisos: preview.avisos,
          }) as { aprovado: boolean };

          if (!decisao?.aprovado) return 'Ação cancelada pelo usuário.';
          return await def.execute!(ctx, args, preview);
        } catch (err) {
          const e = err as { status?: number; message?: string };
          return `Erro ao executar ${def.name}: ${e.message ?? 'erro desconhecido'}`;
        }
      },
      {
        name: def.name,
        description: def.mode === 'write'
          ? `${def.description}\n[ESCRITA] Esta ação será apresentada ao usuário para aprovação antes de rodar.`
          : def.description,
        schema: jsonSchemaToZodPassthrough(def.schema),
      },
    ),
  );
}

// LangChain tools exigem um schema Zod; o registry guarda JSON Schema puro
// (para ser reaproveitável pelo Gemini function-calling e, no futuro, MCP).
// z.object({}).passthrough() aceita qualquer shape e deixa a validação de
// obrigatoriedade para dentro do tool (mesmo que requireStr() já faz hoje) —
// evita duplicar a definição do schema em dois formatos.
import * as z from 'zod';
function jsonSchemaToZodPassthrough(_schema: ToolSchema) {
  return z.object({}).passthrough();
}
```

**Nota de calibração:** `z.object({}).passthrough()` é deliberadamente permissivo — o registry já valida obrigatoriedade dentro de cada `read`/`preview` (ver `requireStr()` em `preview.ts`). Se, ao testar, o LangGraph/CopilotKit exigir um schema mais estrito para o modelo gerar argumentos corretos, trocar por uma conversão real JSON-Schema→Zod (ex.: pacote `zod-from-json-schema`) nesta mesma função, sem mudar a assinatura.

- [ ] **Step 3: Script de verificação (lógica pura de branching, sem precisar do LangGraph rodando)**

```javascript
// scripts/verify-content-agent-tools.mjs seria o lugar natural, mas o
// branching auto/ask é testado isoladamente aqui porque não depende de
// nenhuma ferramenta de conteúdo específica.
// scripts/verify-content-langchain-adapter.mjs
import assert from 'node:assert';
import { resolveApprovalMode } from '../server/agent/agentSettings.ts';

// auto global, sem override → auto
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.clusters.gerar'),
  'auto',
);
// ask global, override auto numa ferramenta específica → auto só nela
assert.strictEqual(
  resolveApprovalMode(
    { approvalMode: 'ask', toolOverrides: { 'content.clusters.gerar': 'auto' } },
    'content.clusters.gerar',
  ),
  'auto',
);
assert.strictEqual(
  resolveApprovalMode(
    { approvalMode: 'auto', toolOverrides: { 'content.clusters.gerar': 'ask' } },
    'content.calendario.gerar',
  ),
  'auto',
);
// travas fixas de publicar/despublicar ignoram tudo, mesmo com auto global
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.artigo.publicar'),
  'ask',
);
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.artigo.despublicar'),
  'ask',
);

console.log('OK: verify-content-langchain-adapter');
```

- [ ] **Step 4: Rodar e confirmar**

Run: `npx tsx scripts/verify-content-langchain-adapter.mjs`
Expected: `OK: verify-content-langchain-adapter`, sem asserção falhando.

- [ ] **Step 5: Commit**

```bash
git add server/agent/types.ts server/agent/registry.ts scripts/verify-content-langchain-adapter.mjs package.json package-lock.json
git commit -m "feat(agent): add toLangChainTools() adapter with approval-mode branching"
```

---

## Task 4: `agent_settings` e a função pura `resolveApprovalMode()`

**Files:**
- Create: `server/agent/agentSettings.ts`
- Create: `scripts/verify-content-approval-settings.mjs`

**Interfaces:**
- Produces: `AgentSettings` (type), `resolveApprovalMode(settings: AgentSettings, toolName: string): 'ask' | 'auto'`, `ALWAYS_ASK_TOOLS: readonly string[]` — consumidos pela Task 3.

- [ ] **Step 1: Escrever o módulo**

```typescript
// server/agent/agentSettings.ts
//
// Configuração de aprovação por usuário, users/{uid}/agent_settings. Pura e
// sem I/O — quem lê/escreve o doc no Firestore é o chamador (o node do grafo
// que monta o ToolCtx); isto só resolve a decisão dado o estado já carregado.

export interface AgentSettings {
  approvalMode: 'ask' | 'auto';
  toolOverrides?: Record<string, 'ask' | 'auto'>;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { approvalMode: 'ask' };

// Trava estrutural: nada aqui muda o comportamento dessas ferramentas, não
// importa o que o usuário configurou. Publicar expõe conteúdo publicamente;
// não é uma ação que aceita "rodar sem perguntar".
const ALWAYS_ASK_TOOLS: readonly string[] = [
  'content.artigo.publicar',
  'content.artigo.despublicar',
];

export function resolveApprovalMode(settings: AgentSettings, toolName: string): 'ask' | 'auto' {
  if (ALWAYS_ASK_TOOLS.includes(toolName)) return 'ask';
  return settings.toolOverrides?.[toolName] ?? settings.approvalMode;
}
```

- [ ] **Step 2: Script de verificação**

```javascript
// scripts/verify-content-approval-settings.mjs
import assert from 'node:assert';
import { resolveApprovalMode, DEFAULT_AGENT_SETTINGS } from '../server/agent/agentSettings.ts';

assert.strictEqual(resolveApprovalMode(DEFAULT_AGENT_SETTINGS, 'content.clusters.gerar'), 'ask');
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.clusters.gerar'),
  'auto',
);
assert.strictEqual(
  resolveApprovalMode({ approvalMode: 'auto' }, 'content.artigo.publicar'),
  'ask',
);
assert.strictEqual(
  resolveApprovalMode(
    { approvalMode: 'ask', toolOverrides: { 'content.artigo.produzir': 'auto' } },
    'content.artigo.produzir',
  ),
  'auto',
);

console.log('OK: verify-content-approval-settings');
```

- [ ] **Step 3: Rodar e confirmar que falha antes de existir o módulo, depois passa**

Run (antes do Step 1 existir, para registrar o comportamento esperado de falha): `npx tsx scripts/verify-content-approval-settings.mjs`
Expected antes do Step 1: `Cannot find module '../server/agent/agentSettings.ts'`.
Run depois do Step 1: mesmo comando.
Expected: `OK: verify-content-approval-settings`.

- [ ] **Step 4: Commit**

```bash
git add server/agent/agentSettings.ts scripts/verify-content-approval-settings.mjs
git commit -m "feat(agent): add per-tool approval mode settings (ask/auto) with hard-coded publish override"
```

---

## Task 5: Ferramentas de leitura do Agente de Conteúdo

**Files:**
- Modify: `server/contentAgent.ts` (exportar `scanWebsite`, `getReusableArticles`, `detectSanityTypes`, `detectSanityFields`, `loadProject`, `projectRef`)
- Create: `server/agent/tools/content.ts`
- Create: `scripts/verify-content-agent-tools.mjs`

**Interfaces:**
- Consumes: `scanWebsite(url: string): Promise<ScannedConfig>`, `getReusableArticles(uid: string): Promise<Array<{id, titulo, articleFinal}>>`, `detectSanityTypes(uid, projectId): Promise<Array<{type, count}>>`, `detectSanityFields(uid, projectId, type): Promise<Array<{field, kind}>>`, `loadProject(uid, projectId): Promise<ContentProject>`, `projectRef(uid, projectId)` (todos de `server/contentAgent.ts`, depois de exportados).
- Produces: 5 `registerTool()` com `provider: 'content'`, `mode: 'read'` em `server/agent/tools/content.ts` — o arquivo é reaproveitado (crescido) nas Tasks 6-9.

- [ ] **Step 1: Exportar as funções necessárias em `server/contentAgent.ts`**

Trocar as declarações (sem mudar corpo/assinatura):
- linha 263: `function projectRef` → `export function projectRef`
- linha 267: `async function loadProject` → `export async function loadProject`
- linha 313: `async function scanWebsite` → `export async function scanWebsite`
- linha 1024: `async function detectSanityTypes` → `export async function detectSanityTypes`
- linha 1061: `async function detectSanityFields` → `export async function detectSanityFields`
- linha 1364: `async function getReusableArticles` → `export async function getReusableArticles`

- [ ] **Step 2: Criar os tools de leitura**

```typescript
// server/agent/tools/content.ts
//
// Ferramentas do Agente de Conteúdo. Cada uma é uma casca fina sobre uma
// função que já existe em contentAgent.ts/seoAgent.ts — nenhuma lógica de
// negócio é duplicada aqui. Mesmo padrão de server/agent/tools/wake.ts.

import { registerTool } from '../registry';
import { requireStr } from '../preview';
import type { ToolCtx } from '../types';
import {
  scanWebsite,
  getReusableArticles,
  detectSanityTypes,
  detectSanityFields,
  loadProject,
  projectRef,
} from '../../contentAgent';

registerTool({
  name: 'content.site.escanear',
  provider: 'content',
  mode: 'read',
  description: 'Analisa um site (URL pública) e sugere um perfil de empresa (nome, descrição, produto/serviço, público-alvo, tom de voz, objetivos, palavras-chave) para pré-preencher o onboarding de um projeto de conteúdo.',
  schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL do site a analisar, ex.: https://minhaempresa.com.br' } },
    required: ['url'],
  },
  read: async (_ctx: ToolCtx, args: Record<string, unknown>) => {
    const url = requireStr(args, 'url');
    return scanWebsite(url);
  },
});

registerTool({
  name: 'content.artigos.reutilizaveis.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista artigos já aprovados/publicados do usuário que podem ser reaproveitados (ex.: linkados na descrição de um produto).',
  schema: { type: 'object', properties: {} },
  read: async (ctx: ToolCtx) => getReusableArticles(ctx.uid),
});

registerTool({
  name: 'content.publicacoes.logs.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista as últimas chamadas HTTP que a publicação de artigos fez para WordPress/Sanity, com requisição, resposta e status — para diagnosticar falha de publicação.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      limit: { type: 'number', description: 'Máximo de logs (padrão 50, teto 200).' },
    },
    required: ['projectId'],
  },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const projectId = requireStr(args, 'projectId');
    await loadProject(ctx.uid, projectId); // valida posse do projeto
    const limit = Math.min(Number(args.limit ?? 50), 200);
    const snap = await projectRef(ctx.uid, projectId)
      .collection('publishLogs').orderBy('at', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
});

registerTool({
  name: 'content.sanity.tipos.listar',
  provider: 'content',
  mode: 'read',
  description: 'Lista os _type existentes no dataset do Sanity configurado no projeto, amostrando o conteúdo (não depende de "sanity schema deploy").',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) => detectSanityTypes(ctx.uid, requireStr(args, 'projectId')),
});

registerTool({
  name: 'content.sanity.campos.listar',
  provider: 'content',
  mode: 'read',
  description: 'Dado um _type do Sanity (de content.sanity.tipos.listar), lista os campos de um documento de exemplo com um palpite de natureza (texto rico/referência/string).',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, type: { type: 'string' } },
    required: ['projectId', 'type'],
  },
  read: async (ctx: ToolCtx, args: Record<string, unknown>) =>
    detectSanityFields(ctx.uid, requireStr(args, 'projectId'), requireStr(args, 'type')),
});
```

- [ ] **Step 3: Registrar o import do novo arquivo de tools**

Em algum ponto de bootstrap do servidor que já importa `server/agent/tools/wake.ts`/`tiny.ts`/`discovery.ts` só para disparar o `registerTool()` de cada um (checar `server/agent/routes.ts` ou `server.ts` para achar onde isso acontece hoje), adicionar:

```typescript
import './agent/tools/content';
```

- [ ] **Step 4: Script de verificação — schema válido e leitura registrada**

```javascript
// scripts/verify-content-agent-tools.mjs
import assert from 'node:assert';
import '../server/agent/tools/content.ts';
import { describeTools } from '../server/agent/registry.ts';

const tools = describeTools(['content']);
const expectedReadTools = [
  'content.site.escanear',
  'content.artigos.reutilizaveis.listar',
  'content.publicacoes.logs.listar',
  'content.sanity.tipos.listar',
  'content.sanity.campos.listar',
];

for (const name of expectedReadTools) {
  const def = tools.find((t) => t.name === name);
  assert.ok(def, `ferramenta ausente: ${name}`);
  assert.strictEqual(def.mode, 'read', `${name} deveria ser read`);
  assert.strictEqual(def.inputSchema.type, 'object', `${name}: schema inválido`);
}

console.log(`OK: verify-content-agent-tools (${expectedReadTools.length} ferramentas de leitura)`);
```

- [ ] **Step 5: Rodar e confirmar**

Run: `npx tsx scripts/verify-content-agent-tools.mjs`
Expected: `OK: verify-content-agent-tools (5 ferramentas de leitura)`.

- [ ] **Step 6: Commit**

```bash
git add server/contentAgent.ts server/agent/tools/content.ts scripts/verify-content-agent-tools.mjs
git commit -m "feat(content-agent): register read-only chat tools (scan site, reusable articles, publish logs, sanity introspection)"
```

---

## Task 6: Ferramentas de escrita — onboarding, clusters, calendário

**Files:**
- Modify: `server/contentAgent.ts` (exportar `generateClusters`, `generateCalendar`, `debitCreditsAdmin`; usar `adminDb`/`CREDIT_ACTIONS` já importados no arquivo)
- Modify: `server/agent/tools/content.ts`
- Modify: `scripts/verify-content-agent-tools.mjs`

**Interfaces:**
- Consumes: `generateClusters(uid, project): Promise<ContentCluster[]>`, `generateCalendar(uid, project): Promise<CalendarArticle[]>`, `debitCreditsAdmin(uid, action: CreditAction, meta?): Promise<number>`, `CREDIT_ACTIONS` (já importado em `contentAgent.ts` de `../src/credits`), `ContentProjectConfig` (de `src/modules/content/types.ts`).
- Produces: `content.projeto.criar`, `content.clusters.gerar`, `content.calendario.gerar` (todos `mode: 'write'`, `provider: 'content'`).

- [ ] **Step 1: Exportar as funções necessárias**

Em `server/contentAgent.ts`:
- linha 232: `async function debitCreditsAdmin` → `export async function debitCreditsAdmin`
- linha 374: `async function generateClusters` → `export async function generateClusters`
- linha 481: `async function generateCalendar` → `export async function generateCalendar`

- [ ] **Step 2: Adicionar os três tools de escrita a `server/agent/tools/content.ts`**

```typescript
// acrescentar aos imports do topo de server/agent/tools/content.ts
import { makePreview } from '../preview';
import { adminDb } from '../../firebaseAdmin';
import { CREDIT_ACTIONS } from '../../../src/credits';
import {
  generateClusters,
  generateCalendar,
  debitCreditsAdmin,
} from '../../contentAgent';
import type { ContentProjectConfig } from '../../../src/modules/content/types';

// ---------------------------------------------------------------------------
// Onboarding: criar projeto (perfil da empresa). A credencial de WordPress/
// Sanity NUNCA passa por aqui — fica no formulário de credencial (fora do
// modelo), ver src/modules/content/chat/WordpressCredentialForm.tsx.
// ---------------------------------------------------------------------------
registerTool({
  name: 'content.projeto.criar',
  provider: 'content',
  mode: 'write',
  description: 'Cria um novo projeto de conteúdo com o perfil da empresa (nome, descrição, produto/serviço, público-alvo, tom de voz, objetivos, palavras-chave, frequência de postagens). Não edita um projeto já existente — para isso, use a tela de configurações.',
  schema: {
    type: 'object',
    properties: {
      nomeEmpresa: { type: 'string' },
      descricao: { type: 'string' },
      produtoServico: { type: 'string' },
      publicoAlvo: { type: 'array', items: { type: 'string' } },
      tomDeVoz: { type: 'string' },
      objetivos: { type: 'array', items: { type: 'string' } },
      palavrasChave: { type: 'array', items: { type: 'string' } },
      frequenciaPostagens: { type: 'string', description: 'Ex.: "2x por semana", "4x por mês".' },
      wordpressUrl: { type: 'string' },
      wordpressUser: { type: 'string' },
      sanityProjectId: { type: 'string' },
      sanityDataset: { type: 'string' },
    },
    required: ['nomeEmpresa', 'descricao', 'produtoServico', 'tomDeVoz'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Criar o projeto de conteúdo "${requireStr(args, 'nomeEmpresa')}".`,
    alvo: 'novo projeto de conteúdo',
    campos: [],
    criacao: true,
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const payload = preview.payload as Record<string, unknown>;
    const config: ContentProjectConfig = {
      nomeEmpresa: String(payload.nomeEmpresa ?? ''),
      descricao: String(payload.descricao ?? ''),
      produtoServico: String(payload.produtoServico ?? ''),
      publicoAlvo: Array.isArray(payload.publicoAlvo) ? payload.publicoAlvo as string[] : [],
      tomDeVoz: String(payload.tomDeVoz ?? ''),
      objetivos: Array.isArray(payload.objetivos) ? payload.objetivos as string[] : [],
      palavrasChave: Array.isArray(payload.palavrasChave) ? payload.palavrasChave as string[] : [],
      referencias: [],
      frequenciaPostagens: String(payload.frequenciaPostagens ?? '2x por semana'),
      wordpressUrl: String(payload.wordpressUrl ?? ''),
      wordpressUser: String(payload.wordpressUser ?? ''),
      sanityProjectId: String(payload.sanityProjectId ?? ''),
      sanityDataset: String(payload.sanityDataset ?? ''),
    };
    const ref = adminDb.collection('users').doc(ctx.uid).collection('contentProjects').doc();
    const now = new Date().toISOString();
    await ref.set({ config, status: 'onboarding', ownerId: ctx.uid, createdAt: now, updatedAt: now });
    return { projectId: ref.id };
  },
});

registerTool({
  name: 'content.clusters.gerar',
  provider: 'content',
  mode: 'write',
  description: 'Gera clusters de conteúdo (pesquisa de palavras-chave + agrupamento temático) para um projeto. Custa créditos.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Gerar clusters de conteúdo para "${project.config.nomeEmpresa}". Isso debita créditos de geração de clusters e de pesquisa de palavras-chave.`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      criacao: true,
      payload: { projectId: args.projectId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const projectId = String((preview.payload as Record<string, unknown>).projectId);
    const project = await loadProject(ctx.uid, projectId);
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.contentClusters, { productName: project.config.nomeEmpresa });
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.seoKeywordResearch, { productName: project.config.nomeEmpresa });
    return { clusters: await generateClusters(ctx.uid, project) };
  },
});

registerTool({
  name: 'content.calendario.gerar',
  provider: 'content',
  mode: 'write',
  description: 'Distribui os artigos aprovados dos clusters por data, conforme a frequência de postagem configurada no projeto. Custa créditos.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Gerar o calendário editorial de "${project.config.nomeEmpresa}".`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      criacao: true,
      payload: { projectId: args.projectId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const projectId = String((preview.payload as Record<string, unknown>).projectId);
    const project = await loadProject(ctx.uid, projectId);
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.contentCalendar, { productName: project.config.nomeEmpresa });
    return { calendar: await generateCalendar(ctx.uid, project) };
  },
});
```

- [ ] **Step 3: Estender o script de verificação**

Em `scripts/verify-content-agent-tools.mjs`, adicionar:

```javascript
const expectedWriteTools = ['content.projeto.criar', 'content.clusters.gerar', 'content.calendario.gerar'];
for (const name of expectedWriteTools) {
  const def = tools.find((t) => t.name === name);
  assert.ok(def, `ferramenta ausente: ${name}`);
  assert.strictEqual(def.mode, 'write', `${name} deveria ser write`);
}
```

(atualizar a linha final `console.log` para refletir a contagem combinada de leitura + escrita).

- [ ] **Step 4: Rodar e confirmar**

Run: `npx tsx scripts/verify-content-agent-tools.mjs`
Expected: saída OK, sem asserção falhando.

- [ ] **Step 5: Commit**

```bash
git add server/contentAgent.ts server/agent/tools/content.ts scripts/verify-content-agent-tools.mjs
git commit -m "feat(content-agent): add onboarding, clusters, and calendar write tools"
```

---

## Task 7: Ferramentas de escrita — produzir artigo e regenerar imagem

**Files:**
- Modify: `server/contentAgent.ts` (exportar `runArticlePipeline`, `regenerateArticleImage`)
- Modify: `server/agent/tools/content.ts`
- Modify: `scripts/verify-content-agent-tools.mjs`

**Interfaces:**
- Consumes: `runArticlePipeline(uid, projectId, articleId): Promise<void>`, `regenerateArticleImage(uid, projectId, articleId, opts: {mode: 'improve'|'fromProduct', improvementPrompt?, baseProductImageUrl?}): Promise<string>`.
- Produces: `content.artigo.produzir`, `content.artigo.imagem.regenerar`.

- [ ] **Step 1: Exportar as funções**

Em `server/contentAgent.ts`:
- linha 567: `async function runArticlePipeline` → `export async function runArticlePipeline`
- linha 687: `async function regenerateArticleImage` → `export async function regenerateArticleImage`

- [ ] **Step 2: Adicionar os tools**

```typescript
// acrescentar aos imports de server/agent/tools/content.ts
import { runArticlePipeline, regenerateArticleImage } from '../../contentAgent';

registerTool({
  name: 'content.artigo.produzir',
  provider: 'content',
  mode: 'write',
  description: 'Roda o pipeline completo de produção de um artigo já agendado no calendário: pesquisa → outline → rascunho → imagem → revisão. Custa créditos e pode levar alguns minutos.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, articleId: { type: 'string' } },
    required: ['projectId', 'articleId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Produzir este artigo agora (pipeline de 5 etapas: pesquisa, outline, rascunho, imagem, revisão).',
    alvo: requireStr(args, 'articleId'),
    campos: [],
    criacao: true,
    payload: { projectId: args.projectId, articleId: args.articleId },
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId } = preview.payload as { projectId: string; articleId: string };
    await runArticlePipeline(ctx.uid, projectId, articleId);
    return { ok: true };
  },
});

registerTool({
  name: 'content.artigo.imagem.regenerar',
  provider: 'content',
  mode: 'write',
  description: 'Regenera a imagem de capa de um artigo — "improve" melhora a imagem atual com uma instrução, "fromProduct" gera a partir da imagem de um produto vinculado.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      articleId: { type: 'string' },
      mode: { type: 'string', enum: ['improve', 'fromProduct'] },
      improvementPrompt: { type: 'string' },
      baseProductImageUrl: { type: 'string' },
    },
    required: ['projectId', 'articleId', 'mode'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Regenerar a imagem de capa (modo: ${requireStr(args, 'mode')}).`,
    alvo: requireStr(args, 'articleId'),
    campos: [],
    criacao: true,
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const p = preview.payload as {
      projectId: string; articleId: string; mode: 'improve' | 'fromProduct';
      improvementPrompt?: string; baseProductImageUrl?: string;
    };
    const imageUrl = await regenerateArticleImage(ctx.uid, p.projectId, p.articleId, {
      mode: p.mode, improvementPrompt: p.improvementPrompt, baseProductImageUrl: p.baseProductImageUrl,
    });
    return { imageUrl };
  },
});
```

- [ ] **Step 3: Estender o script de verificação e rodar**

Adicionar `'content.artigo.produzir'` e `'content.artigo.imagem.regenerar'` à lista `expectedWriteTools` de `scripts/verify-content-agent-tools.mjs`.

Run: `npx tsx scripts/verify-content-agent-tools.mjs`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add server/contentAgent.ts server/agent/tools/content.ts scripts/verify-content-agent-tools.mjs
git commit -m "feat(content-agent): add article production and image regeneration write tools"
```

---

## Task 8: Ferramentas de escrita — publicar e despublicar (trava fixa de aprovação)

**Files:**
- Modify: `server/contentAgent.ts` (exportar `publishToWordpress`... na verdade a rota já resolve o destino via `publishToBlog`/`publishToSanity`/`publishToWordpress` — exportar as três — e `unpublishArticle`)
- Modify: `server/agent/tools/content.ts`
- Modify: `scripts/verify-content-agent-tools.mjs`

**Interfaces:**
- Consumes: `publishToBlog(uid, projectId, articleId): Promise<string>`, `publishToSanity(uid, projectId, articleId): Promise<string>`, `publishToWordpress(uid, projectId, articleId): Promise<string>`, `unpublishArticle(uid, projectId, articleId): Promise<void>`.
- Produces: `content.artigo.publicar`, `content.artigo.despublicar` — ambos já cobertos por `ALWAYS_ASK_TOOLS` (Task 4), então não precisam de lógica extra de aprovação aqui.

- [ ] **Step 1: Exportar as funções**

Em `server/contentAgent.ts`:
- linha 792: `async function publishToWordpress` → `export async function publishToWordpress`
- linha 1070: `async function publishToSanity` → `export async function publishToSanity`
- linha 1231: `async function publishToBlog` → `export async function publishToBlog`
- linha 1328: `async function unpublishArticle` → `export async function unpublishArticle`

- [ ] **Step 2: Adicionar os tools**

```typescript
// acrescentar aos imports de server/agent/tools/content.ts
import { publishToBlog, publishToSanity, publishToWordpress, unpublishArticle } from '../../contentAgent';

registerTool({
  name: 'content.artigo.publicar',
  provider: 'content',
  mode: 'write',
  description: 'Publica um artigo revisado — no blog nativo, no WordPress ou no Sanity, conforme configurado no projeto (ou "destination" explícito). Torna o conteúdo público. Sempre pede aprovação, mesmo com o modo automático ligado para outras ferramentas.',
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      articleId: { type: 'string' },
      destination: { type: 'string', enum: ['blog', 'wordpress', 'sanity'] },
    },
    required: ['projectId', 'articleId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: `Publicar este artigo${args.destination ? ` em ${args.destination}` : ''}. Isso torna o conteúdo público.`,
    alvo: requireStr(args, 'articleId'),
    campos: [{ campo: 'status', antes: 'rascunho', depois: 'publicado', mudou: true }],
    avisos: ['Ação pública e visível para terceiros — confira o artigo antes de aprovar.'],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId, destination } = preview.payload as {
      projectId: string; articleId: string; destination?: 'blog' | 'wordpress' | 'sanity';
    };
    let url: string;
    if (destination === 'blog') url = await publishToBlog(ctx.uid, projectId, articleId);
    else if (destination === 'sanity') url = await publishToSanity(ctx.uid, projectId, articleId);
    else if (destination === 'wordpress') url = await publishToWordpress(ctx.uid, projectId, articleId);
    else {
      const project = await loadProject(ctx.uid, projectId);
      url = project.config.sanityProjectId
        ? await publishToSanity(ctx.uid, projectId, articleId)
        : project.config.wordpressUrl
          ? await publishToWordpress(ctx.uid, projectId, articleId)
          : await publishToBlog(ctx.uid, projectId, articleId);
    }
    return { url };
  },
});

registerTool({
  name: 'content.artigo.despublicar',
  provider: 'content',
  mode: 'write',
  description: 'Remove um artigo publicado do ar (blog nativo, WordPress ou Sanity). Sempre pede aprovação.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, articleId: { type: 'string' } },
    required: ['projectId', 'articleId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Despublicar este artigo (remove do ar).',
    alvo: requireStr(args, 'articleId'),
    campos: [{ campo: 'status', antes: 'publicado', depois: 'despublicado', mudou: true }],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, articleId } = preview.payload as { projectId: string; articleId: string };
    await unpublishArticle(ctx.uid, projectId, articleId);
    return { ok: true };
  },
});
```

- [ ] **Step 3: Estender o script de verificação, incluindo a checagem da trava fixa**

```javascript
// acrescentar a scripts/verify-content-agent-tools.mjs
import { resolveApprovalMode } from '../server/agent/agentSettings.ts';

for (const name of ['content.artigo.publicar', 'content.artigo.despublicar']) {
  assert.ok(tools.find((t) => t.name === name), `ferramenta ausente: ${name}`);
  assert.strictEqual(
    resolveApprovalMode({ approvalMode: 'auto' }, name),
    'ask',
    `${name} deveria ignorar approvalMode: 'auto'`,
  );
}
```

- [ ] **Step 4: Rodar e confirmar**

Run: `npx tsx scripts/verify-content-agent-tools.mjs`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add server/contentAgent.ts server/agent/tools/content.ts scripts/verify-content-agent-tools.mjs
git commit -m "feat(content-agent): add publish/unpublish write tools with hard-coded approval"
```

---

## Task 9: Ferramentas de escrita — auditoria de SEO

**Files:**
- Modify: `server/seoAgent.ts` (exportar `triggerAudit`, `refreshAudit`, `cancelAudit`, `loadProject`)
- Create: `server/agent/tools/contentSeo.ts`
- Modify: `scripts/verify-content-agent-tools.mjs`

**Interfaces:**
- Consumes: `triggerAudit(uid, project): Promise<SeoAudit>`, `refreshAudit(uid, projectId, auditId): Promise<SeoAudit>`, `cancelAudit(uid, projectId, auditId): Promise<SeoAudit>`, `loadProject(uid, projectId): Promise<ContentProject>` (todos de `server/seoAgent.ts` — módulo com sua própria cópia dessas funções, não as de `contentAgent.ts`).
- Produces: `content.seo.auditoria.gerar`, `content.seo.auditoria.atualizar`, `content.seo.auditoria.cancelar`.

- [ ] **Step 1: Exportar as funções em `server/seoAgent.ts`**

- linha 66: `async function loadProject` → `export async function loadProject`
- linha 202: `async function triggerAudit` → `export async function triggerAudit`
- linha 232: `async function refreshAudit` → `export async function refreshAudit`
- linha 278: `async function cancelAudit` → `export async function cancelAudit`

**Atenção:** `server/seoAgent.ts` já importa `CREDIT_ACTIONS`/`resolveCreditCost`/`adminDb` — os tools abaixo reaproveitam a `debitCreditsAdmin` local desse arquivo (assinatura `(uid, action, productName: string)`, diferente da de `contentAgent.ts`), então **também precisa** exportá-la (linha 33: `async function debitCreditsAdmin` → `export async function debitCreditsAdmin`).

- [ ] **Step 2: Criar `server/agent/tools/contentSeo.ts`**

```typescript
// server/agent/tools/contentSeo.ts
//
// Ferramentas de auditoria de SEO do Agente de Conteúdo. Casca fina sobre
// server/seoAgent.ts, mesmo padrão de server/agent/tools/content.ts.

import { registerTool } from '../registry';
import { makePreview, requireStr } from '../preview';
import type { ToolCtx } from '../types';
import { CREDIT_ACTIONS } from '../../../src/credits';
import { triggerAudit, refreshAudit, cancelAudit, loadProject, debitCreditsAdmin } from '../../seoAgent';

registerTool({
  name: 'content.seo.auditoria.gerar',
  provider: 'content',
  mode: 'write',
  description: 'Dispara uma auditoria de SEO (técnica + análise de domínio) do site do projeto. Custa créditos.',
  schema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  preview: async (ctx: ToolCtx, args: Record<string, unknown>) => {
    const project = await loadProject(ctx.uid, requireStr(args, 'projectId'));
    return makePreview({
      resumo: `Rodar auditoria de SEO para "${project.config.nomeEmpresa}".`,
      alvo: project.config.nomeEmpresa,
      campos: [],
      criacao: true,
      payload: { projectId: args.projectId },
    });
  },
  execute: async (ctx: ToolCtx, _args, preview) => {
    const projectId = String((preview.payload as Record<string, unknown>).projectId);
    const project = await loadProject(ctx.uid, projectId);
    await debitCreditsAdmin(ctx.uid, CREDIT_ACTIONS.seoAudit, project.config.nomeEmpresa);
    return { audit: await triggerAudit(ctx.uid, project) };
  },
});

registerTool({
  name: 'content.seo.auditoria.atualizar',
  provider: 'content',
  mode: 'write',
  description: 'Atualiza o status de uma auditoria de SEO em andamento (poll do crawl).',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, auditId: { type: 'string' } },
    required: ['projectId', 'auditId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Atualizar status da auditoria de SEO.',
    alvo: requireStr(args, 'auditId'),
    campos: [],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, auditId } = preview.payload as { projectId: string; auditId: string };
    return { audit: await refreshAudit(ctx.uid, projectId, auditId) };
  },
});

registerTool({
  name: 'content.seo.auditoria.cancelar',
  provider: 'content',
  mode: 'write',
  description: 'Cancela uma auditoria de SEO travada/lenta.',
  schema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, auditId: { type: 'string' } },
    required: ['projectId', 'auditId'],
  },
  preview: async (_ctx: ToolCtx, args: Record<string, unknown>) => makePreview({
    resumo: 'Cancelar esta auditoria de SEO.',
    alvo: requireStr(args, 'auditId'),
    campos: [{ campo: 'status', antes: 'processing', depois: 'canceled', mudou: true }],
    payload: args,
  }),
  execute: async (ctx: ToolCtx, _args, preview) => {
    const { projectId, auditId } = preview.payload as { projectId: string; auditId: string };
    return { audit: await cancelAudit(ctx.uid, projectId, auditId) };
  },
});
```

- [ ] **Step 3: Registrar o import junto do de `content.ts` (mesmo ponto de bootstrap da Task 5, Step 3)**

```typescript
import './agent/tools/contentSeo';
```

- [ ] **Step 4: Estender o script de verificação e rodar**

Adicionar `import '../server/agent/tools/contentSeo.ts';` e as 3 ferramentas SEO à lista `expectedWriteTools` de `scripts/verify-content-agent-tools.mjs`.

Run: `npx tsx scripts/verify-content-agent-tools.mjs`
Expected: OK, agora contando 5 leitura + 8 escrita = 13 ferramentas `content`.

- [ ] **Step 5: Commit**

```bash
git add server/seoAgent.ts server/agent/tools/contentSeo.ts scripts/verify-content-agent-tools.mjs
git commit -m "feat(content-agent): add SEO audit write tools"
```

---

## Task 10: O grafo real — substituir o grafo de brinquedo

**Files:**
- Modify: `server/agent/contentGraph.ts`

**Interfaces:**
- Consumes: `toLangChainTools()` (Task 3), `listTools()`/tools registrados nas Tasks 5-9, `AgentSettings`/`resolveApprovalMode` (Task 4).
- Produces: `graph` real, exportado (mesmo nome/formato consumido por `langgraph.json` desde a Task 1 — nenhuma outra task precisa mudar por causa desta).

- [ ] **Step 1: Carregar as ferramentas de conteúdo antes de montar o grafo**

```typescript
// server/agent/contentGraph.ts
//
// Grafo real do Agente de Conteúdo — substitui o grafo de brinquedo das
// Tasks 1/2. Cada thread_id (ver Task 11, checkpointer) corresponde a uma
// conversa; uid e agent_settings chegam via `config.configurable`, montados
// pelo runtime do CopilotKit (server/copilotRuntime.ts) a partir do usuário
// autenticado — nunca a partir de algo que o modelo decide.

import '../agent/tools/content';
import '../agent/tools/contentSeo';
import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { toLangChainTools } from '../agent/registry';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../agent/agentSettings';
import type { ToolCtx } from '../agent/types';

const SYSTEM_PROMPT = [
  'Você é o Agente de Conteúdo do Alfreds — cuida da criação e publicação de',
  'conteúdo (clusters, calendário editorial, artigos, SEO) para o e-commerce',
  'do usuário. Responda sempre em português do Brasil. Nunca peça senhas,',
  'tokens ou credenciais pelo chat — se precisar conectar WordPress ou',
  'Sanity, avise o usuário para usar o formulário de conexão.',
].join(' ');

function buildTools(config: { configurable?: { uid?: string; settings?: AgentSettings } }) {
  const uid = config.configurable?.uid;
  if (!uid) throw new Error('uid ausente na configuração do grafo — o runtime do CopilotKit deveria sempre fornecer.');
  const settings = config.configurable?.settings ?? DEFAULT_AGENT_SETTINGS;
  // Ferramentas de conteúdo não usam wakeToken()/tinyToken() — só uid/dryRun.
  const ctx: ToolCtx = {
    uid,
    dryRun: false,
    wakeToken: async () => { throw new Error('wakeToken indisponível para o Agente de Conteúdo'); },
    tinyToken: async () => { throw new Error('tinyToken indisponível para o Agente de Conteúdo'); },
  };
  return toLangChainTools(['content'], ctx, settings);
}

async function callModel(
  state: typeof MessagesAnnotation.State,
  config: { configurable?: { uid?: string; settings?: AgentSettings } },
) {
  const tools = buildTools(config);
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    location: process.env.VERTEX_LOCATION || 'us-central1',
    authOptions: { projectId: process.env.VERTEX_PROJECT_ID },
  }).bindTools(tools);

  const response = await model.invoke([{ role: 'system', content: SYSTEM_PROMPT }, ...state.messages]);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1) as { tool_calls?: unknown[] } | undefined;
  return last?.tool_calls?.length ? 'tools' : END;
}

async function toolsNode(
  state: typeof MessagesAnnotation.State,
  config: { configurable?: { uid?: string; settings?: AgentSettings } },
) {
  const node = new ToolNode(buildTools(config));
  return node.invoke(state, config as never);
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['tools', END])
  .addEdge('tools', 'agent')
  .compile();
```

**Nota de calibração:** `buildTools()` reconstrói as ferramentas do LangChain a cada chamada de nó porque `uid`/`settings` só existem em tempo de execução (por request) — confirmar, ao testar, se o `ToolNode` do LangGraph.js aceita receber `config` para repassar ao construtor de tools dessa forma, ou se a versão instalada exige que as tools sejam vinculadas de outro jeito (ex.: closures fixadas fora do grafo, com `uid` vindo de `state` em vez de `config`). Se precisar mudar, o ponto de ajuste é só `buildTools()`/`toolsNode()` — o resto do grafo não muda.

- [ ] **Step 2: Remover o `dev:content-agent` de brinquedo e confirmar que o grafo real sobe**

Run: `npm run dev:content-agent`
Expected: sobe sem erro de compilação — confirma que todos os imports de `agent/tools/content.ts`/`contentSeo.ts` resolvem corretamente a partir do novo caminho.

- [ ] **Step 3: Commit**

```bash
git add server/agent/contentGraph.ts
git commit -m "feat(content-agent): wire the real content tool catalog into the LangGraph.js graph"
```

---

## Task 11: Checkpointer customizado no Firestore

O LangGraph.js não tem um checkpointer oficial para Firestore (só Postgres/SQLite/MongoDB/Redis) — sem persistência, uma aprovação pendente se perde se o servidor reiniciar entre a pergunta e a resposta do usuário (relevante em Cloud Run, que escala a zero). Esta task escreve o adaptador.

**Files:**
- Create: `server/agent/firestoreCheckpointer.ts`
- Modify: `server/agent/contentGraph.ts`

**Interfaces:**
- Produces: `FirestoreCheckpointSaver` (classe que estende `BaseCheckpointSaver`), consumida por `contentGraph.ts` em `.compile({ checkpointer })`.

- [ ] **Step 1: Extrair a interface exata da versão instalada**

Run: `npm ls @langchain/langgraph-checkpoint` (deve já estar instalada como dependência transitiva de `@langchain/langgraph` — se não aparecer, `npm install @langchain/langgraph-checkpoint`).
Run: `find node_modules/@langchain/langgraph-checkpoint/dist -name "*.d.ts" | xargs grep -l "class BaseCheckpointSaver"`
Abrir o arquivo encontrado e anotar: os quatro métodos abstratos/obrigatórios (`getTuple`, `list`, `put`, `putWrites`) com seus parâmetros e tipos de retorno exatos, e a forma de `Checkpoint`, `CheckpointMetadata`, `CheckpointTuple`, `PendingWrite`, `RunnableConfig["configurable"]["thread_id"]`. A documentação pública só descreve os métodos em prosa — o `.d.ts` instalado é a fonte de verdade para assinatura exata.

- [ ] **Step 2: Implementar `FirestoreCheckpointSaver`**

Estrutura de dados: um documento por checkpoint em
`users/{uid}/agent_threads/{threadId}/checkpoints/{checkpointId}` (mesmo prefixo `agent_threads` já usado pelo Operacional, para manter as conversas dos dois agentes num lugar previsível) — `uid` extraído de `config.configurable.uid` (o mesmo valor que `contentGraph.ts` já espera), `threadId` de `config.configurable.thread_id`.

Implementar os métodos com as assinaturas exatas anotadas no Step 1:
- `getTuple(config)`: busca o checkpoint mais recente (ou o `checkpoint_id` específico se `config.configurable.checkpoint_id` vier preenchido) na subcoleção, desserializa com `this.serde` (ou equivalente encontrado no Step 1) e retorna o `CheckpointTuple`.
- `put(config, checkpoint, metadata)`: serializa e grava um novo doc na subcoleção, com `checkpoint_id` crescente (usar `Date.now()` + um contador, ou o próprio id gerado pelo LangGraph se ele vier em `checkpoint.id`).
- `putWrites(config, writes, taskId)`: grava os writes pendentes associados ao checkpoint atual (subcoleção irmã, ex. `.../checkpoints/{checkpointId}/writes/{idx}`).
- `list(config, options)`: itera os checkpoints da thread em ordem decrescente, respeitando `options.limit`/`options.before` se existirem na assinatura encontrada.

Usar `adminDb` (de `server/firebaseAdmin.ts`, mesmo import que `contentAgent.ts` já usa) para todo acesso ao Firestore.

- [ ] **Step 3: Wirar no grafo**

```typescript
// server/agent/contentGraph.ts — no final, trocar
// export const graph = new StateGraph(...).compile();
// por:
import { FirestoreCheckpointSaver } from './firestoreCheckpointer';

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['tools', END])
  .addEdge('tools', 'agent')
  .compile({ checkpointer: new FirestoreCheckpointSaver() });
```

- [ ] **Step 4: Verificação manual de persistência entre reinícios**

Run: `npm run dev:content-agent` — pedir no chat de debug (Task 2) para rodar uma ferramenta de escrita real (ex.: `content.clusters.gerar` com um `projectId` de teste), até o card de aprovação aparecer. **Sem responder ainda**, matar o processo do `langgraph dev` (Ctrl+C) e subir de novo. Aprovar o card. Confirmar em `users/{uid}/agent_threads/{threadId}/checkpoints` no console do Firestore que os docs existem, e que o fluxo completa mesmo depois do restart.

Expected: a aprovação resolve corretamente mesmo com o processo tendo reiniciado no meio — prova que o estado não dependia de memória do processo.

- [ ] **Step 5: Commit**

```bash
git add server/agent/firestoreCheckpointer.ts server/agent/contentGraph.ts
git commit -m "feat(content-agent): add Firestore-backed LangGraph checkpointer for durable approvals"
```

---

## Task 12: Deploy — o servidor LangGraph.js como serviço próprio

**Files:**
- Create: `Dockerfile.contentAgent`
- Modify: `server/copilotRuntime.ts` (já lê `CONTENT_AGENT_LANGGRAPH_URL`, ver Task 2 — aqui só confirma/documenta o valor de produção)
- Modify: `.env.example`

**Interfaces:** nenhuma nova — esta task só empacota o que as Tasks 1-11 já produziram.

- [ ] **Step 1: Gerar o Dockerfile base do CLI e adaptar**

Run: `npx @langchain/langgraph-cli dockerfile Dockerfile.contentAgent`

Abrir o arquivo gerado e confirmar que ele copia `server/`, `src/modules/content/types.ts`, `src/credits.ts` e demais caminhos que `server/agent/contentGraph.ts` importa (transitivamente, todo `server/*.ts` que `contentAgent.ts`/`seoAgent.ts` tocam) — o Dockerfile gerado por padrão só espelha o que `langgraph.json` referencia diretamente; ajustar o `COPY` para incluir a árvore inteira do repo (mais simples e seguro do que listar cada import) já que este serviço roda do mesmo código-fonte do app principal, só com outro entrypoint.

- [ ] **Step 2: Variáveis de ambiente do novo serviço**

Adicionar a `.env.example`:

```
# Agente de Conteúdo conversacional — serviço LangGraph.js separado
CONTENT_AGENT_LANGGRAPH_URL=http://localhost:8123
```

O serviço do Dockerfile.contentAgent precisa das mesmas credenciais Admin do Firebase que `server/firebaseAdmin.ts` já exige do app principal (ADC/service account), mais `VERTEX_PROJECT_ID`/`VERTEX_LOCATION` (já usados por `contentAgent.ts`) — nenhuma variável nova além de `CONTENT_AGENT_LANGGRAPH_URL`, que é exclusiva do app principal (aponta para onde o serviço novo escuta).

- [ ] **Step 3: Buildar a imagem localmente e validar**

Run: `npx @langchain/langgraph-cli build -t content-agent-graph`
Expected: build conclui sem erro.

Run: `docker run -p 8123:8123 --env-file .env content-agent-graph`
Expected: mesmo comportamento manual da Task 2/Task 10 (o servidor responde em `:8123`), agora rodando containerizado.

- [ ] **Step 4: Documentar o deploy em produção**

Adicionar ao `CONTENT_MODULE.md` (seção nova, "Agente conversacional") as instruções de deploy do serviço no Cloud Run — mesmo padrão de `gcloud run deploy` que o restante do projeto já usa para o app principal, apontando `CONTENT_AGENT_LANGGRAPH_URL` do serviço principal para a URL do novo serviço Cloud Run.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.contentAgent .env.example CONTENT_MODULE.md
git commit -m "feat(content-agent): package LangGraph.js server as its own deployable service"
```

---

## Task 13: Frontend — chat provider e cartão de aprovação real

**Files:**
- Create: `src/modules/content/chat/ApprovalCard.tsx`
- Create: `src/modules/content/chat/ContentCopilotProvider.tsx`
- Modify: `src/modules/content/ContentApp.tsx`
- Remove: `src/modules/content/chat/ContentChatDebug.tsx` (harness da Task 2, substituído por esta task)

**Interfaces:**
- Consumes: o payload do `interrupt()` (Task 3/10) — chega como `event.value` (string JSON) no `render` de `useInterrupt` (`@copilotkit/react-core/v2`; ver achado da Task 2 — não é `useCopilotAction`/`renderAndWaitForResponse`, API v1).
- Produces: `<ContentCopilotProvider project={ContentProject | null} articleId={string | null} authToken={string}>{children}</ContentCopilotProvider>`, montado em `ContentApp.tsx`.

- [ ] **Step 1: Cartão de aprovação genérico**

```tsx
// src/modules/content/chat/ApprovalCard.tsx
interface PreviewField { campo: string; antes: unknown; depois: unknown; mudou: boolean }
export interface ApprovalPreview {
  ferramenta?: string;
  resumo?: string;
  alvo?: string;
  campos?: PreviewField[];
  avisos?: string[];
}

export function ApprovalCard({
  preview, onDecide,
}: {
  preview: ApprovalPreview;
  onDecide: (aprovado: boolean) => void;
}) {
  return (
    <div className="border border-orange/30 bg-orange/5 rounded-xl p-4 space-y-3">
      <p className="font-medium text-ink">{preview.resumo ?? 'Confirmar ação?'}</p>
      {preview.alvo && <p className="text-xs text-slate-500">Alvo: {preview.alvo}</p>}
      {!!preview.campos?.length && (
        <table className="w-full text-xs">
          <tbody>
            {preview.campos.map((c) => (
              <tr key={c.campo} className={c.mudou ? 'font-medium' : 'text-slate-400'}>
                <td className="pr-2">{c.campo}</td>
                <td className="pr-2">{String(c.antes ?? '—')}</td>
                <td>→ {String(c.depois ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview.avisos?.map((a, i) => <p key={i} className="text-xs text-amber-600">⚠ {a}</p>)}
      <div className="flex gap-2 pt-1">
        <button
          className="bg-orange text-white text-sm font-bold rounded-lg px-3 py-1.5"
          onClick={() => onDecide(true)}
        >
          Aprovar
        </button>
        <button
          className="border border-ink/20 text-ink text-sm rounded-lg px-3 py-1.5"
          onClick={() => onDecide(false)}
        >
          Rejeitar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Provider do CopilotKit ciente do workspace**

Achados da Task 2 aplicados aqui: `CopilotKit`/`CopilotSidebar` vêm de
`@copilotkit/react-core/v2` (não `@copilotkit/react-ui`, que é só v1); o
equivalente de `useCopilotReadable` na v2 é `useAgentContext`; e a aprovação
usa `useInterrupt`, um único registro cobrindo qualquer ferramenta do grafo
que pause (o roteamento por nome já acontece dentro do grafo — o frontend só
precisa saber renderizar o preview genérico).

```tsx
// src/modules/content/chat/ContentCopilotProvider.tsx
import { CopilotKit, CopilotSidebar, useAgentContext, useInterrupt } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { ApprovalCard, type ApprovalPreview } from './ApprovalCard';
import type { ContentProject } from '../types';

function ContentAgentBridge({
  project, articleId, children,
}: { project: ContentProject | null; articleId: string | null; children: React.ReactNode }) {
  useAgentContext({
    description: 'Projeto de conteúdo atualmente aberto no workspace',
    value: project ? { id: project.id, nomeEmpresa: project.config.nomeEmpresa } : null,
  });
  useAgentContext({ description: 'Artigo em foco no workspace, se houver', value: articleId });

  useInterrupt({
    agentId: 'content_agent',
    render: ({ event, resolve }) => {
      const preview: ApprovalPreview = event?.value ? JSON.parse(event.value as string) : {};
      return <ApprovalCard preview={preview} onDecide={(aprovado) => resolve({ aprovado })} />;
    },
  });

  return (
    <CopilotSidebar agentId="content_agent">
      {children}
    </CopilotSidebar>
  );
}

export function ContentCopilotProvider({
  project, articleId, authToken, children,
}: {
  project: ContentProject | null;
  articleId: string | null;
  authToken: string;
  children: React.ReactNode;
}) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="content_agent" headers={{ Authorization: `Bearer ${authToken}` }}>
      <ContentAgentBridge project={project} articleId={articleId}>{children}</ContentAgentBridge>
    </CopilotKit>
  );
}
```

**Nota de calibração:** `useInterrupt`'s `render` recebe `{event, interrupt,
interrupts, result, resolve, cancel}` — no nosso fluxo (evento `CUSTOM
on_interrupt`, não o formato "standard" mais novo do AG-UI), `interrupt`/
`interrupts` vêm vazios e o payload real está em `event.value` como string
JSON (confirmado lendo `node_modules/@copilotkit/react-core/dist/
copilotkit-*.mjs`, função `useInterrupt`/`toLegacyEvent`). Se uma versão
futura do pacote migrar nosso caso para o formato "standard", o payload passa
a vir em `interrupt.value` já parseado — ajustar o `render` para checar os
dois casos (`interrupt ?? JSON.parse(event.value)`) se o teste manual do
Step 5 mostrar `interrupt` preenchido.

- [ ] **Step 3: Montar no `ContentApp.tsx`**

Em `src/modules/content/ContentApp.tsx`, importar e envolver o retorno do componente (por volta da linha 78, `return (<div className="h-screen ...">`):

```tsx
import { ContentCopilotProvider } from './chat/ContentCopilotProvider';
// ...
const [authToken, setAuthToken] = useState('');
useEffect(() => { user.getIdToken().then(setAuthToken); }, [user]);
// ...
return (
  <ContentCopilotProvider project={selected} articleId={openArticleId} authToken={authToken}>
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
      {/* ...conteúdo existente, inalterado... */}
    </div>
  </ContentCopilotProvider>
);
```

- [ ] **Step 4: Remover o harness de debug**

```bash
git rm src/modules/content/chat/ContentChatDebug.tsx
```

Reverter qualquer rota/flag temporária adicionada na Task 2, Step 6 para montá-lo.

- [ ] **Step 5: Verificação manual**

Run: `npm run dev:content-agent` + `npm run dev`. Abrir o workspace de Conteúdo, confirmar que a sidebar do chat aparece, que perguntar "qual projeto eu tenho aberto?" responde com o nome certo (prova que `useAgentContext` chegou ao modelo), e repetir o teste de aprovar/rejeitar da Task 2 Step 6 agora usando `content.clusters.gerar` de verdade.

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/chat/ApprovalCard.tsx src/modules/content/chat/ContentCopilotProvider.tsx src/modules/content/ContentApp.tsx
git commit -m "feat(content-agent): wire CopilotKit chat sidebar with generic approval card into Content workspace"
```

---

## Task 14: Frontend — formulário de credencial (fora do modelo)

**Files:**
- Create: `src/modules/content/chat/CredentialForm.tsx`
- Modify: `src/modules/content/chat/ContentCopilotProvider.tsx`

**Interfaces:**
- Consumes: o mesmo caminho de escrita Firestore que `secrets/wordpress`/`secrets/sanity` já usam hoje na tela de configurações (checar `src/modules/content/IntegrationsView.tsx` para reaproveitar a função de salvar exata, em vez de duplicar).

- [ ] **Step 1: Localizar a função existente de salvar credencial**

Run: `grep -n "secrets').doc('wordpress')\|secrets').doc('sanity')" src/modules/content/IntegrationsView.tsx src/services/contentService.ts`

Usar a função encontrada (ex.: algo como `saveWordpressSecret(uid, projectId, appPassword)` em `contentService.ts`) em vez de escrever um novo caminho de gravação no Firestore — o objetivo é reaproveitar exatamente o mecanismo que já preserva a regra "leitura bloqueada ao cliente", não recriar um paralelo.

- [ ] **Step 2: Formulário Generative UI**

```tsx
// src/modules/content/chat/CredentialForm.tsx
import { useState } from 'react';
// import { saveWordpressSecret, saveSanitySecret } from '../../../services/contentService'; // ajustar ao nome real encontrado no Step 1

export function CredentialForm({
  provider, projectId, onDone,
}: { provider: 'wordpress' | 'sanity'; projectId: string; onDone: (ok: boolean) => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const label = provider === 'wordpress' ? 'Senha de aplicativo do WordPress' : 'Token de API do Sanity';

  const handleSave = async () => {
    setSaving(true);
    try {
      // await (provider === 'wordpress' ? saveWordpressSecret : saveSanitySecret)(projectId, value);
      onDone(true);
    } catch {
      onDone(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-ink/10 rounded-xl p-4 space-y-2 bg-white">
      <p className="text-sm font-medium text-ink">Conectar {provider === 'wordpress' ? 'WordPress' : 'Sanity'}</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={label}
        className="w-full border border-ink/15 rounded-lg px-3 py-2 text-sm"
      />
      <button
        disabled={saving || !value.trim()}
        onClick={handleSave}
        className="bg-orange text-white text-sm font-bold rounded-lg px-3 py-1.5 disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}
```

Esse valor **nunca** vira argumento de tool call nem trafega pelo `/api/copilotkit` — o `onDone(ok)` só informa o resultado (booleano) de volta pro fluxo do chat, via `respond()` do `useHumanInTheLoop` (ver Step 3; API v2 — `useCopilotAction`/`renderAndWaitForResponse` é v1 e não existe no pacote instalado).

- [ ] **Step 3: Expor como ferramenta de frontend no `ContentCopilotProvider`**

`useHumanInTheLoop` (`@copilotkit/react-core/v2`) é o hook certo aqui — ao
contrário de `useInterrupt` (Task 13, para ferramentas do **grafo** que
pausam via `interrupt()`), esta é uma ferramenta que **só existe no
cliente**: o modelo a chama, o navegador mostra o formulário, e `respond()`
resolve a chamada sem nunca passar pelo servidor LangGraph.

```tsx
// acrescentar a ContentAgentBridge em src/modules/content/chat/ContentCopilotProvider.tsx
import { useHumanInTheLoop } from '@copilotkit/react-core/v2';
import { z } from 'zod';
import { CredentialForm } from './CredentialForm';

useHumanInTheLoop({
  name: 'content.credencial.conectar',
  description: 'Abre o formulário para o usuário conectar WordPress ou Sanity. Nunca peça a senha/token por texto — sempre chame esta ferramenta.',
  parameters: z.object({ provider: z.enum(['wordpress', 'sanity']) }),
  render: ({ args, status, respond }) => {
    if (status !== 'executing' || !respond) return <p className="text-sm text-slate-500">Aguardando…</p>;
    return (
      <CredentialForm
        provider={args.provider}
        projectId={project?.id ?? ''}
        onDone={(ok) => respond({ conectado: ok })}
      />
    );
  },
});
```

**Nota de calibração/dependência com a Task 10:** ferramentas registradas via
`useHumanInTheLoop`/`useFrontendTool` no cliente chegam ao runtime como
`RunAgentInput.tools` (AG-UI as repassa automaticamente) — mas o nó `agent`
de `contentGraph.ts` (Task 10) hoje só vincula ao modelo as ferramentas de
`toLangChainTools(['content'], ctx, settings)` (as do registry do servidor).
Para o modelo enxergar `content.credencial.conectar`, `callModel()` precisa
também vincular as ferramentas vindas de `config`/`state` (o campo exato —
`state.tools` vs. algo em `config.configurable` — depende de como o
`LangGraphAgent` do lado do runtime empacota `RunAgentInput.tools` no envio
ao LangGraph; confirmar isso é o primeiro passo desta task, inspecionando o
`RUN_STARTED`/`on_chain_start` recebido no servidor LangGraph com uma
ferramenta de frontend registrada, do mesmo jeito que a Task 2 investigou
`forwardedProps`). Ajustar `model.bindTools([...registryTools, ...clientTools])` em `callModel()` conforme o que for encontrado.

- [ ] **Step 3b: Verificar onde as ferramentas de frontend chegam no grafo**

Run: com `npm run dev:content-agent` e `npm run dev` rodando e o
`useHumanInTheLoop` acima montado, pedir no chat "conecta o WordPress desse
projeto" e observar os logs do `langgraph dev` (ou adicionar um
`console.log(JSON.stringify(state))` temporário no início de `callModel`).

Expected: encontrar `content.credencial.conectar` em algum campo do
input/state recebido pelo nó `agent` — esse é o campo a ler em
`callModel()` para compor a lista final de tools do `bindTools(...)`.

- [ ] **Step 4: Verificação manual**

Fluxo completo de onboarding: pedir no chat "cria um projeto pro site tal.com.br" → `content.site.escanear` roda (sem aprovação) → modelo propõe os campos → aprova `content.projeto.criar` → pedir "conecta o WordPress desse projeto" → confirmar que aparece o formulário (não um pedido de senha em texto) → preencher e salvar → confirmar no Firestore que `secrets/wordpress` foi escrito e que o campo continua ilegível para o cliente (tentar ler via console do navegador deve falhar pela regra existente).

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/chat/CredentialForm.tsx src/modules/content/chat/ContentCopilotProvider.tsx
git commit -m "feat(content-agent): add out-of-model credential form for WordPress/Sanity onboarding"
```

---

## Task 15: Verificação manual ponta a ponta e documentação

**Files:**
- Modify: `CONTENT_MODULE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rodar todos os scripts de verificação juntos**

Run:
```bash
npx tsx scripts/verify-content-langchain-adapter.mjs
npx tsx scripts/verify-content-approval-settings.mjs
npx tsx scripts/verify-content-agent-tools.mjs
```
Expected: os três imprimem `OK: ...`, nenhum erro.

- [ ] **Step 2: Checklist manual completo (dev)**

Com `npm run dev:content-agent` e `npm run dev` rodando, no workspace de Conteúdo:

1. Onboarding: escanear site → criar projeto → conectar WordPress via formulário.
2. `content.clusters.gerar` com aprovação (modo `ask`) — aprovar.
3. Trocar o `agent_settings` do usuário de teste para `approvalMode: 'auto'` direto no Firestore, pedir `content.calendario.gerar` de novo e confirmar que roda **sem** card de aprovação.
4. Pedir para produzir um artigo (`content.artigo.produzir`) e acompanhar até completar.
5. Pedir para publicar o artigo — confirmar que o card de aprovação aparece **mesmo com `approvalMode: 'auto'`** (trava fixa da Task 4/8).
6. Despublicar o mesmo artigo — mesma confirmação de trava fixa.
7. Rodar uma auditoria de SEO e verificar o resultado.
8. Confirmar que pedir para "rodar o cron" ou qualquer coisa equivalente ao scheduler autônomo não tem ferramenta correspondente — o modelo deve responder que não tem essa capacidade.

- [ ] **Step 3: Atualizar `CONTENT_MODULE.md`**

Adicionar uma seção "Agente conversacional (chat)" resumindo: onde vivem os tools (`server/agent/tools/content.ts`, `contentSeo.ts`), onde vive o grafo (`server/agent/contentGraph.ts`, serviço próprio via `Dockerfile.contentAgent`), o mecanismo de aprovação (`agent_settings`, trava fixa de publicar/despublicar), e o link para o spec (`docs/superpowers/specs/2026-08-28-content-agent-chat-copilotkit-langgraph-design.md`).

- [ ] **Step 4: Atualizar `CLAUDE.md`**

No bloco do "Agente Operacional" (ou logo abaixo dele), adicionar um parágrafo equivalente descrevendo o Agente de Conteúdo conversacional: provider `content` no mesmo registry, orquestrado por um servidor LangGraph.js separado, com o mesmo invariante de aprovação (agora via `interrupt()`/checkpointer no Firestore em vez de `agent_actions`), e apontar que o Operacional continua no loop antigo — a unificação dos dois é trabalho futuro.

- [ ] **Step 5: Commit**

```bash
git add CONTENT_MODULE.md CLAUDE.md
git commit -m "docs(content-agent): document the conversational content agent architecture"
```
