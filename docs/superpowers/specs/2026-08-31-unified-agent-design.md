# Agente único (Conteúdo + Operacional) e nova tela inicial — Design

**Data:** 2026-08-31
**Status:** Aprovado para plano de implementação
**Autor:** Rafael + Claude

## Objetivo

Unificar o **Agente de Conteúdo** e o **Agente Operacional** — hoje duas superfícies de
chat separadas, com motores de orquestração diferentes — em **um único agente
conversacional**, e substituir a tela inicial do Alfreds por uma nova tela dominada por
esse chat, no estilo Claude/ChatGPT.

Este spec cobre os itens 1 ("migrar Operacional para LangGraph") e 4 ("UI unificada")
deixados em aberto por `docs/superpowers/specs/2026-08-28-content-agent-chat-copilotkit-langgraph-design.md`.
Não cobre o item 3 desse spec (mover a geração do Agente de Produto para o servidor) —
o Agente de Produto continua rodando no cliente via Firebase AI Logic, fora do escopo
desta unificação.

Um protótipo visual da nova tela inicial já foi validado (canvas de design, aprovado
nesta mesma conversa) — ver seção "UI" abaixo para o que muda do protótipo para a
implementação real.

## Contexto

O app tem hoje dois motores de agente distintos, descritos em `CLAUDE.md`:

- **Agente Operacional** (`server/agent/loop.ts` + `server/agent/routes.ts`): loop de
  function-calling manual sobre `@google/genai`, rodando dentro do processo Express
  principal. Ferramentas Wake/Tiny/docs. Aprovação via documento pendente em
  `users/{uid}/agent_actions/{id}`, executado só por `server/agent/actions.ts`
  (`executeAction`), que também debita crédito e grava auditoria em `agent_audit` antes
  de chamar `execute()`.
- **Agente de Conteúdo** (`server/agent/contentGraph.ts`): grafo LangGraph.js rodando
  como serviço próprio (`server/agent/contentAgentServer.ts`, porta 8123 em dev,
  `Dockerfile.contentAgent` em produção), com checkpointer no Firestore
  (`server/agent/firestoreCheckpointer.ts`). Aprovação via `interrupt()`/
  `Command(resume)` do LangGraph, ponte REST+SSE em `server/agent/contentAgentChat.ts`.
  Ferramentas de conteúdo/SEO/blog. `execute()` roda direto dentro do wrapper de
  interrupt/resume do próprio registry (não passa por `actions.ts`); cada ferramenta
  debita crédito por conta própria (`debitCreditsAdmin`), e não há log de auditoria
  equivalente a `agent_audit`.

Os dois motores já compartilham a mesma base transport-agnostic:
`server/agent/registry.ts` (`ToolDef`, `registerTool`) e `server/agent/types.ts`
(`ToolProvider = 'wake' | 'tiny' | 'docs' | 'content'`). O registry já sabe converter
para os dois formatos — `toGeminiDeclarations` (loop manual) e `toLangChainTools`
(LangGraph, com o mesmo invariante preview→interrupt→execute via `interrupt()`). Isso é
o que torna a unificação tratável: não é preciso reescrever nenhuma ferramenta, só
trocar quem as consome.

No frontend, `src/modules/operations/*` e `src/modules/content/chat/*` são dois
workspaces separados, alternados pela sidebar (`setWorkspace('operations' | 'content')`
em `App.tsx`). Um protótipo visual de uma nova tela inicial — chat único, cards de
contexto (Produtos/Conteúdo/Operações), sidebar colapsada por padrão — foi desenhado e
aprovado num canvas de design nesta conversa.

## Fora de escopo

- Mover a geração do Agente de Produto (descrição, atributos, imagens) para o servidor
  ou expô-la como ferramentas de chat. Continua client-side via Firebase AI Logic.
- Migrar dados de threads/ações antigas (`agent_threads`/`agent_actions` do Operacional,
  `content_agent_threads`/`content_agent_actions` do Conteúdo) para o novo formato.
  Ficam congeladas como histórico legível; a nova thread única começa vazia (ver
  "Migração de dados" abaixo).
- Um MCP server de verdade (`tools/list`/`tools/call`) — o registry já é
  transport-agnostic pensando nisso, mas continua fora do escopo aqui.
- Múltiplas conversas nomeadas com histórico navegável. A nova tela usa uma thread
  única e contínua por usuário (decisão tomada no brainstorm — ver "Modelo de thread").

## Arquitetura

### Motor único: consolidar no LangGraph

O grafo em `server/agent/contentGraph.ts` passa a ser o único orquestrador. Duas
mudanças nele:

1. `buildTools()` passa a pedir todos os providers, não só `content`:
   ```ts
   toLangChainTools(['wake', 'tiny', 'docs', 'content'], ctx, settings)
   ```
2. O `ToolCtx` monta com `buildContext(uid)` de `server/agent/connections.ts` (o mesmo
   que o loop Operacional usa hoje) em vez do stub atual, que lança erro fixo para
   `wakeToken()`/`tinyToken()`:
   ```ts
   // Antes (contentGraph.ts, buildTools):
   const ctx: ToolCtx = {
     uid, dryRun: false,
     wakeToken: async () => { throw new Error('wakeToken indisponível para o Agente de Conteúdo'); },
     tinyToken: async () => { throw new Error('tinyToken indisponível para o Agente de Conteúdo'); },
   };
   // Depois:
   const ctx = buildContext(uid);
   ```

A lista de providers efetivamente disponíveis para um usuário (quais ferramentas o
modelo vê) continua vindo de `resolveConnections(uid)` — Wake/Tiny só entram se
houver credencial conectada, exatamente como o Operacional já faz hoje. `content` entra
sempre que o módulo de conteúdo estiver habilitado na conta.

`server/agent/loop.ts` e `server/agent/routes.ts` (o loop manual e suas rotas HTTP) são
removidos. `server/agent/contentAgentServer.ts` (o serviço LangGraph standalone) passa a
responder por toda a conversa — Wake/Tiny inclusive.

### Serviço único

O Agente Operacional para de rodar dentro do processo Express principal. Suas
ferramentas (`server/agent/tools/wake.ts`, `tiny.ts`, `discovery.ts`) continuam
importadas por efeito colateral (registro no registry), só que agora a partir de
`contentGraph.ts` em vez de `loop.ts`, e passam a rodar dentro do serviço standalone do
Agente de Conteúdo (mesmo `Dockerfile.contentAgent`, mesmo processo Cloud Run). O
Express principal (`server.ts`) continua sem geração de IA nenhuma, só fazendo proxy do
chat pela ponte REST+SSE — que é exatamente o que já faz hoje para o Agente de
Conteúdo.

`server/agent/connections.ts` (resolução de credenciais Wake/Tiny) precisa ficar
acessível a partir do serviço standalone — hoje já é um módulo puro sem dependência do
Express, só de `adminDb`/`getV2Token`, então a mudança é só de "quem importa", não de
infraestrutura nova.

### Aprovação e execução: generalizar o padrão do Operacional

Hoje só o Operacional centraliza débito de crédito + auditoria em
`server/agent/actions.ts` (`executeAction`), chamado depois da aprovação, fora do
`toLangChainTools`. O Conteúdo não passa por ali. Unificar exige escolher um único
caminho — e a recomendação é generalizar o padrão do Operacional para todos os
providers:

- `toLangChainTools` (registry.ts), no ponto em que hoje chama `def.execute!(ctx, args, preview)`
  depois do `interrupt()` aprovado, passa a chamar um helper único
  (`runApprovedWrite(ctx, def, args, preview)`) que:
  1. debita o crédito da ação (mesmo cálculo de `debitCredit` em `actions.ts`, hoje só
     usado pelo Operacional);
  2. chama `def.execute(ctx, args, preview)`;
  3. grava um registro de auditoria (mesmo formato de `agent_audit`, hoje só escrito
     pelo Operacional) com o resultado ou erro.
- As ferramentas de conteúdo (`content.ts`, `contentSeo.ts`) **param de chamar
  `debitCreditsAdmin` internamente** — isso sai do `execute()` de cada ferramenta e vai
  para o helper único. `CREDIT_ACTIONS` continua definindo o custo de cada ação; só
  quem debita muda.
- `server/agent/actions.ts` deixa de existir como módulo separado do Operacional — sua
  lógica (claim transacional, débito, auditoria) migra para dentro do registry como o
  helper acima, reutilizável por qualquer provider.

O invariante estrutural não muda: **o loop do modelo nunca chama `execute()`
diretamente** — só o helper de aprovação, alcançado exclusivamente depois de um
`interrupt()` resolvido com `aprovado: true`. `registerTool` continua recusando no boot
qualquer ferramenta de escrita sem `preview`/`execute`.

As travas fixas de conteúdo (`ALWAYS_ASK_TOOLS` em `agentSettings.ts` — publicar,
despublicar, conectar credencial, excluir projeto) continuam valendo sem alteração.

### Modelo de dados

| Hoje (Operacional) | Hoje (Conteúdo) | Depois |
|---|---|---|
| `users/{uid}/agent_threads/{id}/messages` (mensagens legíveis) | `users/{uid}/content_agent_threads/{id}/messages` + `.../checkpoints` (checkpointer LangGraph) | `users/{uid}/agent_threads/{id}/messages` + `.../checkpoints` |
| `users/{uid}/agent_actions/{id}` | `users/{uid}/content_agent_actions/{id}` | `users/{uid}/agent_actions/{id}` |
| `users/{uid}/agent_audit` | (nenhum) | `users/{uid}/agent_audit` |

Como o Operacional para de escrever nesses coleções (loop/routes removidos), os nomes
genéricos `agent_threads`/`agent_actions` ficam livres para o formato do Conteúdo (que é
o que sobrevive) assumir — evita ter que renomear e migrar dados. `agent_audit` passa a
receber entradas de qualquer provider, não só Wake/Tiny.

### Modelo de thread

Decisão do brainstorm: **thread única e contínua por usuário**, sem lista de conversas
navegável. `threadId` deixa de ser algo que o frontend cria ou lista — é implícito
(`thread_id = uid`, ou um slug fixo tipo `'principal'` dentro do namespace do usuário) e
criado sob demanda (lazy) na primeira mensagem, tanto no Firestore quanto no
`ensureLangGraphThread` já existente. Os endpoints `GET/POST/DELETE
/api/content-agent/threads` (listagem/criação/exclusão de múltiplas threads) deixam de
ser necessários e são removidos; sobra só `POST /api/agent/messages` (renomeado de
`/api/content-agent/threads/:id/messages`, com o `:id` implícito) e
`POST /api/agent/actions/:id/{execute,reject}`.

### Migração de dados existentes

Sem migração automática. `agent_threads`/`agent_actions` antigos (Operacional) e
`content_agent_threads`/`content_agent_actions` (Conteúdo) ficam como histórico
congelado — legíveis se alguém precisar auditar, mas nada mais escreve neles depois do
deploy. A nova thread única do agente unificado começa vazia para todo mundo. Nenhuma
ação pendente de antes do deploy sobrevive à troca — usuários com uma aprovação em
aberto no momento do deploy precisam refazer o pedido depois.

### Frontend

- `src/modules/operations/*` (painel do Agente Operacional) e
  `src/modules/content/chat/ContentAgentPanel.tsx` (painel do Agente de Conteúdo) são
  substituídos por um único componente de chat, montado na nova tela inicial.
- `src/services/operationsService.ts` e `src/services/contentAgentChatService.ts` viram
  um único `src/services/agentChatService.ts`, apontando para os endpoints renomeados
  acima.
- O `WorkspaceContext` (projeto/artigo aberto no workspace de conteúdo, injetado no
  system prompt via `config.configurable.contexto`) continua existindo sem alteração —
  ele já é uma informação puramente de UI, ortogonal à unificação do motor.
- A sidebar (`App.tsx`) perde os dois botões "Ir para Agente de Conteúdo"/"Ir para
  Agente Operacional" — o chat unificado é a própria tela inicial, não um workspace
  alternável.

### UI: da mockup para a implementação real

O protótipo aprovado (canvas de design) usa Canvas 2D + JS puro para simular uma esfera
de partículas conectadas por linhas, porque o canvas de design roda cada artboard num
iframe sandboxed sem egress de rede (CDNs bloqueados), inviabilizando carregar uma
biblioteca externa ali. Na implementação real, sem essa restrição, a esfera usa
**three.js** (`https://github.com/mrdoob/three.js/`) de verdade:

- `THREE.BufferGeometry` com posições dos pontos numa distribuição em esfera
  (Fibonacci sphere, mesmo cálculo do protótipo), renderizada como `THREE.Points`.
- As conexões entre pontos próximos usam `THREE.LineSegments` sobre um
  `BufferGeometry` cujo `drawRange` é recalculado a cada frame — no espírito do exemplo
  oficial `webgl_buffergeometry_drawrange` — para desenhar só os segmentos cuja
  distância atual é menor que `minDistance`.
- **Animação pedida:** `minDistance` oscila continuamente (`Math.sin` sobre o tempo,
  mesma curva do protótipo) enquanto o agente está com uma resposta em andamento (evento
  SSE `delta`/`leitura` chegando) — mais conexões aparecendo/desaparecendo transmite
  "processando". Em repouso, a oscilação continua mas mais discreta (amplitude menor),
  para a esfera nunca parecer estática.
- Cor/paleta seguem a marca do Alfreds (laranja `#FF5B03` nos nós, `#1e293b` nas linhas
  de fundo), como já validado no protótipo — não a paleta azul da referência original.
- Empacotamento: `three` como dependência do bundle Vite normal (não CDN) — o app já
  tem seu próprio build, sem a restrição de CSP do canvas de design.

O restante do visual (cards flutuantes de Produtos/Conteúdo/Operações, tendrils SVG
conectando ao núcleo, sidebar colapsada por padrão, input pill no rodapé) implementa
como no protótipo, com componentes React reais em vez de HTML estático.

## Tratamento de erros

- Ferramenta indisponível para os providers da conta (ex.: `wake.*` chamado sem
  Wake conectado): mesmo comportamento de hoje — a ferramenta simplesmente não está na
  lista que o modelo recebe (`resolveConnections`), então o modelo não consegue
  alucinar a chamada.
- Falha na `execute()` depois de aprovado: o helper único (`runApprovedWrite`) marca a
  ação como `failed`, grava o erro em `agent_audit`, e o crédito já debitado **não é
  estornado** — mesmo trade-off que `actions.ts` já assume hoje para o Operacional
  (documentado em `actions.ts`: "same trade-off the rest of the app makes for AI
  operations").
- Falha ao debitar (`INSUFFICIENT_CREDITS`): a ação nunca chega a chamar `execute()` —
  mesmo comportamento de `actions.ts` hoje.
- Serviço do agente unificado fora do ar: o Express principal devolve o mesmo erro
  HTTP que hoje devolve para o Agente de Conteúdo quando `CONTENT_AGENT_LANGGRAPH_URL`
  não responde.

## Verificação

- `npx tsx scripts/verify-agent-tools.mjs` — precisa continuar passando com o registry
  completo (`wake`, `tiny`, `docs`, `content`) consumido só pelo LangGraph.
- `npx tsx scripts/verify-wake-banner-payload.mjs` — sem mudança esperada (o payload das
  ferramentas Wake não muda, só quem as chama).
- Novo script de verificação (nome sugerido: `scripts/verify-unified-approval.mjs`):
  lógica pura testando que `runApprovedWrite` debita antes de chamar `execute()`, grava
  auditoria em sucesso e falha, e nunca é alcançável sem um `interrupt()` aprovado —
  mesmo espírito de `verify-crm-automation.mjs`/`verify-crm-stage.mjs`.
- Teste manual ponta a ponta (não há suíte automatizada no projeto): no chat unificado,
  pedir uma ação Wake (ex.: ajustar estoque) e uma ação de conteúdo (ex.: publicar
  artigo) na mesma conversa, confirmar que ambas passam pelo mesmo card de aprovação e
  aparecem em `agent_audit`.

## Dependências novas

- `three` (client, bundle Vite) — substitui a simulação em Canvas 2D do protótipo pela
  esfera de partículas real.
- Nenhuma dependência nova no servidor — `@langchain/langgraph`, `@langchain/core`,
  `@langchain/google-vertexai` já estão em uso pelo grafo de Conteúdo.

## Pendências / riscos a resolver no plano de implementação

- **Nome do helper de aprovação único e onde ele vive** (`registry.ts` vs. um novo
  `server/agent/approval.ts`) — o registry hoje é deliberadamente "puro" (sem Firestore
  direto); centralizar débito/auditoria ali introduz uma dependência de `adminDb` que
  não existe hoje nesse arquivo. Vale considerar manter `actions.ts` como o módulo (só
  generalizando suas funções para qualquer provider) em vez de mover a lógica para
  dentro de `registry.ts`.
- **Rate/step limit do loop antigo** (`MAX_STEPS = 8` em `loop.ts`, evitando loop
  infinito) não tem equivalente explícito no grafo LangGraph atual — checar se o grafo
  precisa de uma trava parecida antes de ferramentas Wake/Tiny (potencialmente mais
  "chamativas" que as de conteúdo) entrarem nele.
- **`AGENT_DRY_RUN`** hoje é lido em `connections.ts` (`buildContext`) e vale para as
  chamadas HTTP a Wake/Tiny; confirmar que o serviço standalone do Agente de Conteúdo
  também recebe essa env var no deploy.
- **Telemetria (`withLog`, `agent_logs`)** hoje instrumenta toda chamada HTTP a
  Wake/Tiny a partir do processo onde `loop.ts`/`actions.ts` rodam; confirmar que
  `server/agent/telemetry.ts` funciona sem alteração quando chamado a partir do
  processo do serviço standalone (import puro, sem estado de processo — não deveria
  haver problema, mas vale confirmar no plano).
- **Janela de corte no deploy**: como não há migração de ações pendentes, o deploy da
  unificação deveria idealmente acontecer num horário de baixo uso, e avisar
  (changelog/CRM) usuários com uma aprovação pendente no momento da troca.
