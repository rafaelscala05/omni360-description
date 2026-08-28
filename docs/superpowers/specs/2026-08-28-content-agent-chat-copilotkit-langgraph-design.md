# Agente de Conteúdo conversacional (CopilotKit + LangGraph) — Design

> **Nota (2026-08-28, mesmo dia):** depois desta entrega implementada e
> testada, a camada de UI/ponte com CopilotKit foi substituída por um
> cliente REST+SSE próprio, no mesmo padrão do Agente Operacional — ver
> `CONTENT_MODULE.md` § "Agente conversacional (chat)" para a arquitetura
> atual. O orquestrador (LangGraph.js), o registry de ferramentas e o
> checkpointer do Firestore descritos abaixo não mudaram; só as seções sobre
> CopilotKit (frontend, `/api/copilotkit`) estão desatualizadas.

**Data:** 2026-08-28
**Status:** Aprovado para plano de implementação
**Autor:** Rafael + Claude

## Objetivo

Permitir que o **Agente de Conteúdo** seja comandado por uma interface conversacional
(chat), usando **CopilotKit** no frontend e **LangGraph** como orquestrador no backend.
O usuário deve conseguir, via chat: fazer o onboarding de um projeto de conteúdo, gerar
clusters/calendário, produzir e publicar artigos, e gerenciar a integração com
WordPress/Sanity — tudo isso sem sair da conversa.

Esta entrega introduz a fundação técnica (LangGraph.js rodando no servidor Express
existente + runtime do CopilotKit + UI de chat) e a aplica **apenas ao Agente de
Conteúdo**. Não migra o Agente Operacional nem move a geração do Agente de Produto para
o servidor — ver Fora de escopo.

## Contexto

O app já tem três "agentes" (workspaces), cada um com uma fronteira de execução própria:

- **Agente de Produto** — IA roda no cliente (Firebase AI Logic), sem servidor no meio.
- **Agente de Conteúdo** — IA roda no servidor (`server/contentAgent.ts`,
  `@google/genai` + `GEMINI_API_KEY`), inclusive de forma autônoma via cron
  (`startContentScheduler`), sem navegador aberto. Ver `CONTENT_MODULE.md`.
- **Agente Operacional** — já é conversacional hoje, mas sem LangGraph: um registry de
  ferramentas transport-agnostic (`server/agent/registry.ts`) alimenta um loop manual de
  function-calling do Gemini (`server/agent/loop.ts`). O invariante de segurança: **o
  loop do modelo nunca chama `execute()`** — uma ferramenta de escrita declara
  `preview()` (lê o estado atual, monta o diff) e `execute()`; o loop só alcança
  `preview()`, grava `users/{uid}/agent_actions/{id}` como `pending` e para. Só
  `server/agent/actions.ts` executa, depois de aprovação, em transação.

O Agente de Conteúdo não tem hoje nenhuma superfície conversacional — todas as ações
(`generate-clusters`, `generate-calendar`, `produce`, `publish`, etc., ver
`server/contentAgent.ts` e `server/seoAgent.ts`) são chamadas por botões na UI do
workspace `src/modules/content/`.

**Decisão de escopo tomada durante o brainstorm:** o projeto completo (fundação +
Operacional + Produto + Conteúdo + UI unificada) foi decomposto em 4 sub-projetos.
Este spec cobre os itens **2 (Conteúdo vira ferramentas de chat)** e **4 (UI
conversacional)**. Os itens 1 (migrar Operacional para LangGraph) e 3 (mover geração de
Produto para o servidor + virar ferramentas de chat) ficam para specs futuros.

## Fora de escopo

- Migrar o Agente Operacional para LangGraph. Ele continua rodando no seu loop atual,
  intocado, como uma superfície de chat separada.
- Mover a geração do Agente de Produto para o servidor ou expô-la como ferramentas.
- Unificar num único chat as três superfícies (Operacional + Conteúdo + Produto). Por
  enquanto, o chat novo (CopilotKit) é dedicado ao Conteúdo; o Operacional mantém a UI
  que já tem.
- Expor `POST /api/content/cron/tick` como ferramenta — o scheduler autônomo nunca deve
  ficar acessível ao modelo.
- Expor criação/edição de projeto além dos campos de perfil da empresa (ver seção
  Onboarding) — não há tool de "listar projetos"; o projeto ativo chega ao modelo como
  contexto de workspace, não por chamada de ferramenta.

## Arquitetura

### 1. Novo provider e catálogo de ferramentas

`ToolProvider` (`server/agent/types.ts`) ganha o valor `'content'`. Um novo arquivo
`server/agent/tools/content.ts` (+ `contentSeo.ts` para as ferramentas de
`seoAgent.ts`, se o arquivo crescer demais) registra cada ferramenta com
`registerTool()`, no mesmo padrão de `wake.ts`/`tiny.ts`/`discovery.ts`. Cada tool é uma
casca fina que chama a função que já existe hoje — nenhuma lógica de negócio é
duplicada.

`ToolCtx` (uid, dryRun, wakeToken, tinyToken) é reaproveitado sem alteração; as
ferramentas de conteúdo simplesmente nunca chamam `wakeToken()`/`tinyToken()`.

**Ferramentas de leitura** (`mode: 'read'`, sem aprovação, rodam inline):

| Ferramenta | Função por trás |
|---|---|
| `content.artigos.reutilizaveis.listar` | `getReusableArticles` |
| `content.publicacoes.logs.listar` | logs de publish (`publishLogs`) |
| `content.sanity.tipos.listar` | `detectSanityTypes` |
| `content.sanity.campos.listar` | `detectSanityFields` |
| `content.site.escanear` | `scanWebsite` |

**Ferramentas de escrita** (`mode: 'write'`, exigem `preview()`/`execute()`):

| Ferramenta | Função por trás | Preview |
|---|---|---|
| `content.projeto.criar` | cria doc em `contentProjects/{projectId}` | `criacao: true` |
| `content.clusters.gerar` | `generateClusters` (+ débito de crédito) | `criacao: true` |
| `content.calendario.gerar` | `generateCalendar` | `criacao: true` |
| `content.artigo.produzir` | `runArticlePipeline` (5 etapas) | `criacao: true` |
| `content.artigo.imagem.regenerar` | `regenerateArticleImage` | `criacao: true` |
| `content.artigo.publicar` | `publishToBlog/Sanity/Wordpress` | diff real (rascunho→publicado) |
| `content.artigo.despublicar` | `unpublishArticle` | diff real |
| `content.seo.auditoria.gerar` | rota `seo-audit` de `seoAgent.ts` | `criacao: true` |
| `content.seo.auditoria.atualizar` | rota `seo-audit/refresh` | diff |
| `content.seo.auditoria.cancelar` | rota `seo-audit/cancel` | diff |

Como a maioria das ações **cria** em vez de **editar**, o preview usa
`makePreview({ criacao: true, ... })` (já existe em `preview.ts`) — resumo textual do
que será gerado e custo estimado em créditos, em vez de diff campo-a-campo. Publicar e
despublicar têm antes/depois real e usam diff normal.

### 2. Aprovação: reaproveita o invariante do Operacional, com o toggle pedido

Novo doc `users/{uid}/agent_settings`:

```ts
interface AgentSettings {
  approvalMode: 'ask' | 'auto';       // padrão global
  toolOverrides?: Record<string, 'ask' | 'auto'>; // por nome de ferramenta
}
```

`content.artigo.publicar` e `content.artigo.despublicar` **ignoram o setting e sempre
pedem aprovação** — publicar é a única ação aqui que expõe algo publicamente
(WordPress/blog ao vivo), e essa trava é estrutural (não configurável), no mesmo
espírito da restrição de leitura-apenas dos escape hatches `*.api.chamar` do
Operacional. As demais ferramentas de escrita respeitam o `approvalMode` resolvido
(override da ferramenta, senão o global).

A resolução do modo (dado settings + nome da ferramenta → `'ask' | 'auto'`) é uma
função pura, sem I/O, para poder ser verificada isoladamente (mesmo espírito de
`server/agent/preview.ts` e `server/crmStage.ts`).

### 3. Onboarding conversacional — perfil normal + credencial fora do modelo

Hoje `wordpressUrl`/`wordpressUser` ficam no doc de config do projeto (legíveis);
apenas a senha de aplicativo fica em `contentProjects/{id}/secrets/wordpress`, com
**leitura bloqueada por regra do Firestore** (o cliente escreve, nunca lê de volta; só o
Admin SDK no servidor lê para publicar). Sanity segue o mesmo padrão
(`sanityProjectId`/`sanityDataset` no config, `apiToken` em `secrets/`).

Levar a senha para uma tool call a exporia no contexto do modelo (envio à API do
Gemini) e na transcrição persistida da conversa — uma exposição bem maior que um campo
de senha que vai direto ao Firestore. Por isso o onboarding se divide em duas partes:

1. **Perfil da empresa, via chat normal:** `content.projeto.criar` recebe os campos não
   sensíveis (`nomeEmpresa`, `descricao`, `produtoServico`, `publicoAlvo`, `tomDeVoz`,
   `objetivos`, `palavrasChave`, `wordpressUrl`, `wordpressUser`, `sanityProjectId`,
   `sanityDataset`). O usuário pode pedir "escaneia meu-site.com.br" →
   `content.site.escanear` (read) sugere os campos → o modelo propõe →
   `content.projeto.criar` roda como write normal (preview + aprovação conforme o
   toggle).
   `content.projeto.criar` é a única ferramenta de escrita do onboarding — cobre a
   criação inicial do projeto. Editar um projeto já existente (trocar tom de voz,
   corrigir URL do WordPress depois de criado) continua pela tela de configurações
   existente; não faz parte deste spec.
2. **Credencial, fora do modelo:** quando o projeto precisa de WordPress/Sanity, o chat
   renderiza um **formulário inline via Generative UI do CopilotKit** — um componente
   React de verdade dentro da resposta do chat, não texto — que grava direto no
   Firestore pelo mesmo caminho cliente→Firestore que já existe hoje. O modelo só recebe
   de volta "conectado com sucesso/falhou", nunca o valor da credencial. Não é uma tool
   nova; é a UI existente reaproveitada dentro da conversa.

### 4. Orquestração: LangGraph como novo consumidor do registry

`server/agent/loop.ts` (Gemini function-calling manual) **não é alterado** — continua
servindo só o Operacional. Um consumidor novo e paralelo é adicionado:

- `toLangChainTools(providers)` em `registry.ts` (irmã de `toGeminiDeclarations`):
  converte cada `ToolDef` numa tool do LangChain. `read` chama `.read()` direto;
  `write` chama `.preview()` e, conforme o `approvalMode` resolvido, ou segue direto
  para `.execute()` ou dispara um `interrupt()` do LangGraph — pausando o grafo até a
  aprovação, no papel que hoje `agent_actions` + polling cumprem para o Operacional.
- Um `StateGraph` (`server/agent/contentGraph.ts`) com as tools de `provider: 'content'`
  vinculadas ao modelo (via `@langchain/google-genai`, reaproveitando `GEMINI_API_KEY`),
  rodando no mesmo processo Express — sem precisar de um deploy de LangGraph Platform
  separado.
- **Persistência do grafo (checkpointer):** LangGraph precisa de um "checkpoint saver"
  para manter o estado entre a interrupção e a retomada. **Risco identificado:** não
  está confirmado se existe um checkpointer oficial para Firestore — isso precisa ser
  verificado no início do plano de implementação; se não houver, escreve-se um adaptador
  simples implementando a interface de checkpointer do LangGraph.js sobre Firestore
  (documento por thread, no mesmo espírito de `users/{uid}/agent_threads`).
- Runtime do CopilotKit montado como rota Express (`/api/copilotkit`) apontando para
  esse grafo. A API exata do adaptador `@copilotkit/runtime` ↔ LangGraph.js muda entre
  versões — será confirmada contra a documentação atual no início da implementação
  (via `context7`), não fixada aqui.

### 5. Frontend

- `CopilotKit` provider no React; painel de chat persistente (sidebar/popup) dedicado
  ao workspace de Conteúdo.
- Consciência de workspace via `useCopilotReadable` — projeto de conteúdo aberto,
  artigo em foco — para o usuário não precisar citar IDs.
- Cartão de aprovação via `useCopilotAction` com render customizado, reaproveitando o
  formato de `ActionPreview` (`resumo`, `alvo`, `campos`, `avisos`) já usado pelo
  Operacional — mesma linguagem visual, dado novo.
- Formulário de credencial (WordPress/Sanity) como Generative UI, conforme seção 3.
- Este chat **coexiste** com a UI de chat já existente do Operacional; unificar as duas
  superfícies é trabalho do item 1 (spec futuro).

## Modelo de dados (novo)

- `users/{uid}/agent_settings` — `AgentSettings` (seção 2).
- Threads/mensagens da conversa de Conteúdo: estrutura equivalente a
  `agent_threads/{threadId}/messages/{id}` do Operacional, mas o mecanismo de
  pausa/retomada é o checkpointer do LangGraph (seção 4), não um doc `pending` genérico
  — os dois sistemas não compartilham essa parte do modelo de dados.

## Tratamento de erros

Erros de qualquer tool (`read`/`preview`/`execute`) devem ser capturados na camada
`toLangChainTools()` e devolvidos como saída de tool (texto de erro) para o modelo
informar o usuário, em vez de derrubar o grafo — mesmo espírito de `sendError()` nas
rotas HTTP existentes, adaptado para não ter uma resposta HTTP no meio.

## Verificação

Sem suíte de testes automatizada no projeto (validação manual via `npm run dev`).
Seguindo o padrão já usado no módulo do agente:

- `scripts/verify-content-agent-tools.mjs` — schema de cada ferramenta nova é JSON
  Schema válido; toda ferramenta `write` tem `preview`/`execute`; nomes batem com o
  regex de function-calling do Gemini (mesmas checagens que `registerTool()` já faz em
  runtime, mas como smoke test isolado, no espírito de `verify-agent-tools.mjs`).
- `scripts/verify-content-approval-settings.mjs` — a função pura de resolução de
  `approvalMode` (global × override × trava fixa de publicar/despublicar).

Validação manual: rodar `npm run dev`, abrir o chat no workspace de Conteúdo, e
percorrer o fluxo completo — onboarding (perfil + credencial via formulário inline) →
escanear site → criar projeto → gerar clusters → gerar calendário → produzir artigo →
publicar (confirmando que sempre pede aprovação) → despublicar.

## Dependências novas

- `langgraph` (`@langchain/langgraph`) e binding do modelo (`@langchain/google-genai`
  ou equivalente) no backend.
- `@copilotkit/runtime` (servidor) e `@copilotkit/react-core` / `@copilotkit/react-ui`
  (frontend).
- Nenhuma variável de ambiente nova além das já existentes (`GEMINI_API_KEY`) — a
  confirmar durante a implementação se o binding do modelo exige alguma configuração
  adicional.

## Pendências / riscos a resolver no plano de implementação

1. Confirmar existência (ou não) de checkpointer oficial do LangGraph.js para
   Firestore; se não houver, desenhar o adaptador.
2. Confirmar a API atual de integração `@copilotkit/runtime` ↔ grafo LangGraph.js
   self-hosted (sem LangGraph Platform), incluindo como o `interrupt()` chega até a UI
   como Generative UI de aprovação.
3. Definir o texto exato do resumo de custo em créditos nos previews de `criacao: true`
   (hoje o débito acontece dentro da função de negócio; o preview precisa estimar antes
   de rodar).
