# Omni360 — Funcionalidades e Módulos Prontos

Visão geral do que está implementado e em produção no projeto, para uso como contexto geral. Baseado no estado atual do código (2026-09-28), não em planos futuros.

O app é uma SPA React (pt-BR) com backend Express (`server.ts` + módulos `server/*.ts`), Firebase (Auth + Firestore) como banco/autenticação, e Gemini/Vertex AI como motor de IA generativa. Existem hoje **duas superfícies de produto** dentro do mesmo repositório: o app principal de catálogo/descrição de produtos, e um segundo serviço (Agente de Conteúdo, rodando via LangGraph) para blog/SEO.

---

## 1. Núcleo: Catálogo e Geração de Conteúdo de Produto

O core histórico do produto. Estado vive quase todo em `src/App.tsx`.

- **Importação de planilha** de produtos (Excel/CSV), com mapeamento de colunas e template padrão (`src/services/productService.ts`).
- **Geração de conteúdo por IA (client-side via Firebase AI Logic / Gemini)**:
  - Descrição de produto (`generateDescriptionText`)
  - Atributos de produto, inclusive a partir de imagem (`generateProductAttributes`, `generateAttributesFromImage`)
  - Imagens ambientadas do produto
  - Enriquecimento de dados e hierarquia de categorias
- **Categorias hierárquicas** (`Category`, `parentId`/`pathIds`) com atributos (`AttributeDefinition[]`) herdáveis por categoria filha (`categoryService.ts`, `CategoryManager.tsx`).
- **Edição de produto em modal** (`ProductEditModal.tsx`), incluindo geração/edição de imagens (`ImageSearchModal.tsx`).
- **Referência de produto para vídeo**: a partir de ≥2 fotos reais do produto, gera uma folha multi-ângulo + close-ups usada como referência visual consistente nas gerações de vídeo (aba "Vídeo" do modal de edição). Não depende mais de imagem ambientada.
- **Exportação**: para planilha padrão (mantém cabeçalhos originais) ou para o layout fixo da TinyERP, incluindo colunas dinâmicas de atributos.
- **Persistência em nuvem**: produtos, configurações de planilha e categorias em Firestore por usuário; créditos de IA debitados por operação, com log em `credit_logs`.

## 2. Geração de Vídeo de Produto

- **Vídeo clássico** (`server/videoAgent.ts`) e **vídeo UGC com avatar** (`server/ugcVideoAgent.ts`), ambos usando a referência multi-ângulo do produto como asset extra enviado ao modelo de vídeo (Veo).
- **Provider de vídeo configurável no admin** (feature recente): painel para trocar o provider padrão entre modelos de vídeo (inclui suporte a Kling além do pipeline original), com tratamento isolado de falhas de poll sem vazar chave de API.
- Pipeline paralelo com legendagem multi-imagem.

## 3. Integrações com ERPs

Padrão comum: OAuth ou token, import inicial, worker de sincronização em background, push de produto, webhook de eventos, service no cliente + componente "Connector".

- **Tiny ERP** (v2 token + v3 OAuth — hoje a UI só expõe v2): `server/tinyAgent.ts`, `server/tinyV2.ts`, `server/tinyProvider.ts`. Push grava **apenas** título, descrição complementar, SEO e imagens (nunca dados fiscais/logísticos). Suporta variações (imagem por mapeamento, gravada sempre pelo pai). Produtos marcados com `_tinyProductId`.
- **Bling ERP** (API v3, OAuth2): `server/blingAgent.ts`, import worker, webhook HMAC. Produtos com `_blingProductId`; exclusões marcam `_blingDeleted`.
- **IdWorks** (REST + JWT, sem OAuth): `server/idworksAgent.ts`, import worker, webhook por usuário. Produtos com `_idworksProductId` ("SKU" na nomenclatura deles).
- **Wake** (e-commerce/loja): usado tanto para push de produto/preço/estoque quanto como plataforma operada pelo Agente Operacional (banners, hotsites).
- **Push log** (`server/pushLog.ts`): toda integração devolve `enviado?: PushLogEntry[]` com os campos realmente escritos, gravado no ponto exato da decisão (não reconstruído depois), renderizado por produto em `IntegrationSendPanel.tsx`.

## 4. Mercado Livre (integração completa)

Módulo próprio (`server/meli/*`, `src/modules/meli/*`) para otimização de anúncios do Mercado Livre:

- OAuth de conexão de conta (`/api/integrations/meli/oauth/*`), múltiplas conexões por usuário.
- Sincronização de anúncios (`sync.ts`) e por item individual.
- **Análise por IA** de cada anúncio (`analysis.ts`, `aiSchema.ts`) e geração de **propostas de mudança** (`proposals.ts`) — título, descrição, atributos, etc.
- Fluxo de revisão humana: propostas com mudanças individuais aprováveis/rejeitáveis (`ProposalReview.tsx`), aplicação (`mutations.ts`) e **rollback**.
- Rate limiting próprio para a API do Mercado Livre (`rateLimit.ts`), métricas de operação e scheduler de sync.
- Interface: `MeliOptimizer.tsx` (visão geral/listagem) + `ProposalReview.tsx` (revisão de proposta).

## 5. Blog Nativo (multi-tenant, com domínio próprio)

Motor de blog completo, server-rendered (`server/blog/*`: `shell.ts` + `themes/`), administrável pelo cliente (`src/modules/content/blog/*`):

- Editor de posts (`PostEditor.tsx`), categorias, aparência/temas (`BlogAppearance.tsx`), domínios customizados por proxy (`BlogDomains.tsx`).
- Rotas públicas (`registerBlogPublic`) e administrativas (`registerBlogAdminRoutes`) separadas.
- Integra com os clusters/calendário de conteúdo do Agente de Conteúdo (publicação de artigos gerados por IA direto no blog).

## 6. Agente de Conteúdo (SEO / Blog por IA) — serviço próprio

Uma segunda superfície de produto, voltada a marketing de conteúdo/SEO, com IA conversacional:

- **Chat conversacional** orquestrado por um **grafo LangGraph.js** (`server/agent/contentGraph.ts`), rodando como **serviço separado** do Express principal (`Dockerfile.contentAgent`, `npm run dev:content-agent`, porta 8123).
- **41 ferramentas** (14 leitura / 27 escrita) sobre gestão de projeto de conteúdo: clusters temáticos, calendário editorial, artigos, blog nativo, SEO — `server/agent/tools/{content,contentSeo,contentBlog}.ts`.
- Fluxo de aprovação humano via `interrupt()`/`Command(resume)` do LangGraph, persistido em checkpointer próprio no Firestore (não existe um oficial para Firestore).
- Modo automático vs. "sempre perguntar" configurável por ferramenta; publicar/despublicar/conectar credencial **sempre** pedem aprovação, independente do modo.
- Contexto de workspace (projeto/artigo abertos) injetado automaticamente no system prompt — usuário nunca digita IDs.
- Transporte REST + SSE hand-rolado (não CopilotKit — removido por instabilidade); SSE só entrega o "pensando ao vivo", mensagens/ações persistem em Firestore e o front consome via `onSnapshot`.
- Funcionalidades cobertas pelo módulo de conteúdo (`src/modules/content/*`): clusters (`ClustersView.tsx`, `ClusterDetailView.tsx`), calendário (`CalendarView.tsx`), produção de artigos (`ArticlesProductionView.tsx`, `ArticleView.tsx`, tamanho do artigo), mapa de conteúdo, auditoria de SEO (`SeoAuditCard.tsx`), gestão de empresas/clientes (`CompanyManager.tsx`), onboarding próprio, logs de publicação, integrações.
- Ver `CONTENT_MODULE.md` para o detalhe completo.

## 7. Agente Operacional (chat que opera a loja/ERP)

Chat de linguagem natural que executa ações reais na loja/ERP do usuário (`modules.operationsAgent`):

- **Registry de ferramentas** independente de transporte (`server/agent/registry.ts`) — hoje vira `functionDeclarations` do Gemini, preparado para virar servidor MCP sem alterar as ferramentas.
- **27 ferramentas**: Wake (banners, hotsites, produtos, preço, estoque, SEO), Tiny v2 (produtos, preço, estoque, pedidos, contatos), mais busca de documentação e escape hatches de leitura crua da API.
- **Invariante de segurança**: o loop do modelo nunca executa uma escrita diretamente. Ferramentas de escrita geram um `preview()` (diff do que vai mudar), gravam uma ação `pending` em `agent_actions`, e só `server/agent/actions.ts` executa — depois de aprovação explícita, em transação (não é possível executar duas vezes).
- `connections.ts` só expõe ferramentas de plataformas de fato conectadas pelo usuário.
- `AGENT_DRY_RUN=true` monta o payload sem chamar a API real.
- **Telemetria total**: toda chamada HTTP a Wake/Tiny passa por `withLog` e vira um doc em `agent_logs` (requisição, resposta, status, duração, com segredos redigidos), exposto em `GET /api/agent/logs` e no painel "Logs".
- Interface própria "Alfreds" (`src/modules/agent/*`) — design system "liquid glass" com tema claro/escuro local à tela do agente.
- Regra de negócio: as duas superfícies de chat (Agente Operacional e Agente de Conteúdo) **coexistem sem unificação** — motores diferentes, não migrado.

## 8. Onboarding

- **Onboarding de produto/loja**: `server/onboardingAgent.ts`, wizard client-side (`CompanyProfile.tsx`, `OnboardingWizard.tsx`, `ProfileSummary.tsx`).
- **Onboarding por missão** (feature mais recente, no ar desde 2026-09-14): fluxo gamificado em `src/modules/onboarding/mission/*` — trilha de missões (`TrilhaMissoes.tsx`), execução de missão (`MissionRunner.tsx`), chat guiado (`MissionChat.tsx`), missões específicas de produto e de conteúdo (`MissaoProduto.tsx`, `MissaoConteudo.tsx`), e pedido de ajuda via WhatsApp (`PedidoWhatsApp.tsx`). Regras puras em `server/onboardingMissionRules.ts`.

## 9. Programa de Indicação (Referral)

- `server/referralAgent.ts` + `src/modules/referral/ReferralPage.tsx` + `src/services/referralService.ts`.
- Bônus de cadastro para indicado/indicador.

## 10. CRM Administrativo (`/admin`)

CRM interno sobre a base de usuários, acesso restrito por custom claim `admin: true` do Firebase Auth:

- **Três fontes de dados**, em ordem de precedência: eventos emitidos pelo servidor (`recordEvent`), beacon do cliente (`POST /api/events`, para eventos client-side como geração de conteúdo), e `crmReconcile.ts` (deriva jornada retroativamente a partir de `products`/`credit_logs`/`settings` — cobre usuários anteriores ao event store).
- Estado denormalizado em `users/{uid}.crm` (estágio, marcos, contadores, saúde) + coleções `events`, `crm_notes`, `crm_tasks`, `crm_audit`.
- Regras de negócio (estágio, health score, estagnação) isoladas e puras em `server/crmStage.ts`.
- **Automação via WhatsApp**: uma automação por estágio do Kanban (`crm_automations/{stage}`), gatilho por entrada no estágio ou por estagnação, com 5 guardas obrigatórias: idempotência, opt-out por cliente, janela 09h–20h BRT, limite por execução, e apenas templates aprovados. Modo `WHATSAPP_DRY_RUN` disponível; sem credenciais, o worker simplesmente não faz nada (resto do CRM não é afetado).
- Server: `server/crm{Stage,Events,Reconcile,Admin,Automation,AutomationRules}.ts`; client: `src/modules/admin/*`.

## 11. Pagamentos

- Integração com **Asaas** para cobrança/assinatura (rotas hospedadas direto em `server.ts`, junto com `/api/upload`).

## 12. Infraestrutura transversal

- **Upload de imagens**: `POST /api/upload`, salva em `./uploads/`.
- **Segurança contra SSRF** centralizada em `server/safeUrl.ts`, usada por todas as integrações que fazem chamadas HTTP a serviços externos a partir de URLs fornecidas pelo usuário.
- **Eventos de conversão**: Meta CAPI (`server/metaEvents.ts`) e TikTok (`server/tiktokEvents.ts`).
- **SE Ranking** (`server/seRankingClient.ts`) e **descoberta de palavras-chave** (`server/keywordDiscovery.ts`) para o módulo de SEO/conteúdo.
- **Deploy**: Firebase App Hosting (`apphosting.yaml`), com provider de vídeo e chaves (ex.: `OPENROUTER_API_KEY`) referenciados via config, não hardcoded.

---

## O que NÃO está pronto / é histórico a considerar

- A geração de conteúdo de produto (descrição/atributos/imagens/enriquecimento) **não roda mais no servidor** — migrou para o cliente via Firebase AI Logic. Qualquer observação de geração precisa hookar o cliente (beacon de eventos do CRM), não um endpoint de servidor.
- Não há testes automatizados no projeto — validação é manual via `npm run dev`, mais os scripts `scripts/verify-*.mjs`/`.ts` para lógica pura crítica (push do Tiny, automação CRM, ferramentas do agente, etc.).
- Agente Operacional e Agente de Conteúdo usam motores de orquestração diferentes e não foram unificados.
