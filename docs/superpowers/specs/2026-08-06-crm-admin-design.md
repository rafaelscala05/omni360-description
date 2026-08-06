# CRM Admin — Jornada de Ativação, Ficha 360 e Base de Eventos

**Data:** 2026-08-06
**Status:** Spec 1 de 2. O spec 2 (WhatsApp Oficial + automação por estágio) depende deste.

## Problema

Não existe hoje nenhuma forma de saber como os usuários cadastrados estão usando o
Alfred. Os eventos de produto (`src/analytics.ts`) são disparados para GA4, Meta
Pixel/CAPI e TikTok e **nunca são persistidos** — servem para otimizar anúncios, não
para operar a base. Não há área admin, não há papel de admin, e a única visão de
"o que o cliente fez" é a subcoleção `credit_logs`, acessível apenas pelo próprio
dono via console do Firebase.

O objetivo é ter um CRM interno que responda três perguntas:

1. Em que ponto da jornada de ativação cada cliente está?
2. Quem está travado e precisa de contato hoje?
3. O que exatamente esse cliente preencheu e fez desde que se cadastrou?

## Escopo

**Dentro:** base de eventos durável, papel de admin, kanban de ativação (automático)
+ pipeline comercial (manual), ficha 360 do cliente, health score, alerta de
estagnação, notas e tarefas, ajuste de créditos pelo admin.

**Fora (spec 2):** WhatsApp Cloud API, templates, envio automático por estágio.
Este spec deixa o ponto de engate pronto e explícito (§9), mas não implementa envio.

**Fora (cortado por YAGNI):** funil de conversão e coortes de ativação. Os
contadores e timestamps de marco ficam gravados, então a tela pode ser somada
depois sem migração de dados.

## Decisões

### Como os eventos entram na base — híbrido com reconciliação

Três caminhos foram considerados:

- **Beacon único no client.** `src/analytics.ts` já centraliza tudo; bastaria um
  quarto sink. Cobre inclusive import/export de planilha, que são 100% browser
  (SheetJS). Mas o client pode forjar e a operação se perde se a aba fechar.
- **Instrumentação server-side canônica.** Infalsificável e nunca se perde, mas
  não captura "Subiu Produtos" nem "Exportou Planilha" — planilha não passa pelo
  servidor.
- **Híbrido + derivação de estado.** ← escolhido.

O híbrido tem três fontes, com precedência clara:

1. **`source: 'server'`** — o servidor emite do próprio endpoint quando a ação já
   passa por ele (geração de descrição/imagem, import/push Tiny/Bling/Wake,
   conclusão de onboarding, compra de créditos).
2. **`source: 'client'`** — beacon `POST /api/events` só para o que é genuinamente
   client-side: import de planilha, export de planilha, login. O servidor valida
   contra uma allowlist de nomes; o client não inventa evento novo.
3. **`source: 'derived'`** — o reconciliador (§6) deriva marcos a partir do estado
   atual do Firestore.

A terceira fonte não é um detalhe: os usuários existentes hoje não têm evento
nenhum, mas têm `products`, `credit_logs` e `settings/{tiny,bling,wake}`. Dá para
reconstruir a jornada inteira deles a partir disso, e o CRM nasce populado. Ela
também funciona como rede de segurança contínua contra beacon perdido.

### Estágio denormalizado no doc do usuário

O estágio poderia ser calculado sob demanda ao abrir o kanban, mas isso é uma
varredura de subcoleções por usuário a cada abertura. Em vez disso, `users/{uid}.crm`
guarda o resumo (estágio, marcos, contadores, health), escrito pela ingestão de
eventos e pelo reconciliador. O kanban vira **uma query só**, e `stageEnteredAt`
dá "dias no estágio" de graça — que é a base do alerta de estagnação e do gatilho
do WhatsApp.

### Acesso admin — custom claim

`admin: true` como custom claim do Firebase Auth, verificado no servidor em todo
endpoint `/api/admin/*`. Um script (`scripts/set-admin-claim.cjs`) atribui o claim.
Alternativa descartada: allowlist de e-mails em env var, que exigiria deploy para
adicionar um admin.

O client **nunca** acessa dados de outro usuário direto no Firestore. Todas as
coleções novas são negadas nas rules e o admin passa exclusivamente pelo servidor
com o Admin SDK, que bypassa as rules. Isso mantém uma única porta de entrada
auditável.

### Kanban de dois eixos

O estágio de ativação é um **fato derivado de eventos** — arrastar um card
significaria mentir sobre o que o cliente fez. Então:

- **Board de Ativação**: 5 colunas, read-only, 100% derivado.
- **Board Comercial**: 5 colunas arrastáveis (`novo`, `em_contato`, `qualificado`,
  `ganho`, `perdido`), campo independente que o admin controla.

Os dois convivem na mesma tela com um toggle. O dado nunca mente e o trabalho
comercial ainda é registrado.

## §1 — Modelo de dados

### `users/{uid}.crm` (campo novo no doc existente)

```ts
interface CrmSummary {
  stage: CrmStage;                    // ver §2
  stageEnteredAt: string;             // ISO
  firstSeenAt: string;
  lastSeenAt: string;
  milestones: Partial<Record<CrmStage, string>>;  // marco → ISO da 1ª vez
  counters: {
    products: number;
    descriptions: number;
    images: number;
    exports: number;
    erpSyncs: number;
    aiOps30d: number;
  };
  activeWeeks: string[];              // ['2026-W31', ...] — alimenta o estágio 'active'
  healthScore: number;                // 0-100
  healthBand: 'ativo' | 'atencao' | 'risco' | 'inativo';
  pipelineStatus: PipelineStatus;
  pipelineUpdatedAt: string | null;
  pipelineUpdatedBy: string | null;
  tags: string[];
  updatedAt: string;
}
```

Denormalizado de propósito (§Decisões). Nunca escrito pelo client.

### Subcoleções e coleções novas

```
users/{uid}/events/{eventId}     append-only
  { name, ts, source: 'server'|'client'|'derived', props: Record<string,unknown> }

users/{uid}/crm_notes/{noteId}
  { body, createdAt, createdBy, createdByName }

crm_tasks/{taskId}               top-level
  { uid, customerName, title, dueDate, done, doneAt, createdAt, createdBy }

crm_audit/{auditId}              top-level
  { uid, action, detail, at, by, byName }
```

`crm_tasks` é top-level, não subcoleção, porque a query dominante é "minhas
tarefas vencendo hoje" — atravessa clientes. `events` é subcoleção porque a query
dominante é a timeline de um cliente; um feed global futuro usa `collectionGroup`.

`crm_audit` registra toda alteração de crédito e de pipeline: quem, quando, o quê.
Ajuste manual de saldo sem trilha de auditoria é como um CRM apodrece.

### Regras do Firestore

Todas as coleções novas: `allow read, write: if false`. Além disso, a regra de
update de `users/{uid}` ganha uma trava impedindo o client de escrever `crm` —
hoje `isValidUser()` valida os campos conhecidos mas não rejeita campos extras.

## §2 — Estágios da jornada

```ts
type CrmStage =
  | 'signed_up'              // Cadastrou
  | 'products_uploaded'      // Subiu Produtos
  | 'content_generated'      // Gerou Descrição ou Imagem
  | 'integrated_or_exported' // Fez Integração ERP ou Exportou Planilha
  | 'active';                // Ativo / Recorrente
```

| Estágio | Marco atingido quando |
|---|---|
| `signed_up` | a conta existe |
| `products_uploaded` | evento `spreadsheet_import` **ou** import Tiny/Bling/Wake **ou** `products` > 0 |
| `content_generated` | `credit_logs` com `actionKey` de geração (§6) **ou** evento equivalente |
| `integrated_or_exported` | evento `spreadsheet_export` **ou** `settings/{tiny,bling,wake}.connected` **ou** push ERP |
| `active` | uso em ≥ 2 semanas ISO distintas **após** atingir `integrated_or_exported` |

A quinta coluna é um acréscimo ao pedido original. Os 4 eventos da Meta medem
**ativação** e param aí; sem uma coluna de retenção, quem ativou e sumiu fica
indistinguível de quem virou cliente de verdade — que é exatamente quem não se
pode perder.

**O estágio é monotônico**: `stage` é sempre o marco mais alto já atingido e nunca
regride. Inatividade não rebaixa o card — ela aparece no health score e no alerta
de estagnação, que é onde ela pertence.

## §3 — Health score e estagnação

Fórmula transparente e determinística, sem caixa-preta — o admin precisa entender
por que um cliente está vermelho.

| Componente | Faixa | Cálculo |
|---|---|---|
| Recência | 0-40 | dias desde `lastSeenAt`: 0-1d=40, ≤7d=30, ≤14d=20, ≤30d=10, >30d=0 |
| Profundidade | 0-30 | estágio: `signed_up`=0, `products_uploaded`=8, `content_generated`=16, `integrated_or_exported`=24, `active`=30 |
| Volume | 0-20 | `aiOps30d`: 0=0, 1-4=6, 5-19=12, 20-49=16, ≥50=20 |
| Investimento | 0-10 | já comprou créditos=10; senão saldo>0=5; senão 0 |

Bandas: `≥70 ativo` · `40-69 atencao` · `15-39 risco` · `<15 inativo`.

**Estagnação** é medida à parte, por limite específico de cada estágio — 3 dias
parado em "Cadastrou" é grave, 14 dias em "Ativo" é normal:

```ts
const STAGNATION_DAYS: Record<CrmStage, number> = {
  signed_up: 3,
  products_uploaded: 5,
  content_generated: 7,
  integrated_or_exported: 14,
  active: 30,
};
```

Um cliente está estagnado quando `dias desde stageEnteredAt > limite` **e** não
avançou de estágio. É isso que alimenta a fila de atenção — e é o mesmo sinal que
o spec 2 vai usar como gatilho de WhatsApp, sem precisar de nova modelagem.

## §4 — Telas

Rota `/admin/*`, protegida pelo claim. Fora de `/app/*`.

- **Home — "Precisam de atenção hoje"**: estagnados + banda `risco`/`inativo` +
  tarefas vencendo. É a tela que responde "o que eu faço agora".
- **Kanban**: 5 colunas de ativação com contagem e cards; toggle para o board
  comercial arrastável. Card mostra nome, empresa, health dot, dias no estágio,
  créditos, último acesso e chip de estagnação.
- **Clientes**: tabela densa com busca (nome/e-mail/empresa) e filtros por estágio,
  health, pipeline, integração e tag.
- **Ficha 360** (`/admin/clientes/:uid`): header com nome, e-mail, WhatsApp,
  empresa/CNPJ, health, estágio, créditos e ações (ajustar créditos, mover
  pipeline, adicionar tag). Abas:
  - **Visão geral** — dados cadastrais, respostas do onboarding (`step1`, `contact`)
    e dados da empresa (`company`).
  - **Timeline** — eventos e `credit_logs` fundidos num feed único, ordem
    decrescente, paginado.
  - **Uso** — contadores, marcos com data, integrações ativas, produtos.
  - **Notas & Tarefas** — notas livres e tarefas com prazo.

## §5 — API

Todas sob `/api/admin/*`, atrás de um middleware `requireAdmin` que verifica o
token **e** o claim.

| Método | Rota | Função |
|---|---|---|
| GET | `/api/admin/stats` | contagens por coluna + resumo da fila de atenção |
| GET | `/api/admin/customers` | lista filtrável/paginada |
| GET | `/api/admin/customers/:uid` | perfil completo + crm + onboarding + empresa + integrações |
| GET | `/api/admin/customers/:uid/timeline` | eventos + credit_logs fundidos, paginado |
| POST | `/api/admin/customers/:uid/pipeline` | move no board comercial |
| POST | `/api/admin/customers/:uid/tags` | define tags |
| POST | `/api/admin/customers/:uid/credits` | ajusta saldo (`delta`, `reason`) |
| GET/POST/DELETE | `/api/admin/customers/:uid/notes` | notas |
| GET/POST/PATCH | `/api/admin/tasks` | tarefas (cross-cliente) |
| POST | `/api/admin/reconcile` | backfill/recômputo idempotente |

Mais um endpoint **não-admin**: `POST /api/events`, autenticado como usuário comum,
que recebe o beacon do client.

O ajuste de créditos usa `FieldValue.increment` numa transação, grava em
`credit_logs` (mesmo formato dos bônus existentes) e em `crm_audit`. Isso também
fecha o item de recarga server-side que estava pendente: a regra
`creditsNotIncreased()` impede o client de aumentar o próprio saldo, e o Admin SDK
bypassa a regra.

## §6 — Módulos do servidor

Seguem o padrão `registerXRoutes(app, { verifyFirebaseToken })` já usado por todos
os módulos existentes.

- **`server/crmStage.ts`** — **puro, sem I/O**. `resolveStage()`, `computeHealth()`,
  `isStagnant()`, `applyEventToSummary()`, `isoWeek()`. Toda a regra de negócio do
  CRM isolada aqui: dá para verificar sozinho, e nenhuma decisão de estágio fica
  espalhada por endpoint.
- **`server/crmEvents.ts`** — `recordEvent(uid, name, props, source)` escreve o
  evento e atualiza `users/{uid}.crm` num batch. Registra a rota `POST /api/events`
  com allowlist de nomes. **Nunca derruba o fluxo do produto**: try/catch + log,
  mesmo padrão do `server/metaEvents.ts`, e o beacon sempre responde 200.
- **`server/crmReconcile.ts`** — deriva marcos do estado atual:
  - `products_uploaded` ← `users/{uid}/products` tem ≥1 doc (usa `createdAt` mais
    antigo como data do marco)
  - `content_generated` ← `credit_logs` com `actionKey` em `generate_seo_single`,
    `generate_seo_mass`, `regenerate_single`, `ambient_image`, `regenerate_image`,
    `video_generation`, `content_article`, `content_image`
  - `integrated_or_exported` ← `settings/{tiny,bling,wake}.connected === true`
  - contadores e `activeWeeks` ← agregação de `credit_logs`
  Roda no `POST /api/admin/reconcile` e num scheduler diário, seguindo o padrão de
  `startTinyScheduler` / `startContentScheduler`.
- **`server/crmAdmin.ts`** — rotas `/api/admin/*` e o `requireAdmin`.

Chamadas de `recordEvent` são adicionadas nos endpoints existentes que já
representam marcos (geração de descrição, imagens ambientadas, import/push
Tiny/Bling, conclusão de onboarding). São inserções de uma linha, sempre em
`void ...catch()` para não alterar o comportamento do endpoint.

## §7 — Módulos do client

Tudo em `src/modules/admin/`. **Nada disso entra em `App.tsx`**, que já tem 4.251
linhas; ele ganha exatamente uma linha de rota.

| Arquivo | Responsabilidade |
|---|---|
| `src/types/crm.ts` | tipos compartilhados client/servidor |
| `src/services/adminService.ts` | fetch com Bearer token, padrão do `referralService.ts` |
| `src/modules/admin/AdminApp.tsx` | shell, nav, guarda de claim, rotas internas |
| `src/modules/admin/AttentionQueue.tsx` | home |
| `src/modules/admin/KanbanBoard.tsx` | os dois boards + toggle |
| `src/modules/admin/CustomerList.tsx` | tabela + filtros |
| `src/modules/admin/CustomerDetail.tsx` | header + abas |
| `src/modules/admin/CustomerOverview.tsx` | aba cadastro/onboarding/empresa |
| `src/modules/admin/CustomerTimeline.tsx` | aba timeline |
| `src/modules/admin/CustomerNotes.tsx` | aba notas & tarefas |
| `src/modules/admin/CreditAdjustModal.tsx` | ajuste de saldo |

Uma aba por arquivo mantém cada peça pequena o bastante para ser entendida sozinha
— o oposto do que aconteceu com `App.tsx`.

`src/analytics.ts` ganha um quarto sink (`crmTrack`) ao lado de GA4/Meta/TikTok,
para os eventos client-side. `scripts/set-admin-claim.cjs` atribui o claim.

## §8 — Tratamento de erro

- Ingestão de evento nunca propaga exceção para o fluxo de produto.
- Beacon `POST /api/events` sempre responde 200, mesmo em falha.
- Endpoints admin usam o `sendError` padrão dos outros módulos (status + mensagem
  pt-BR, log no servidor).
- Reconciliação é idempotente e por usuário: falha em um usuário é logada e não
  interrompe os demais.
- Ausência de `crm` no doc do usuário é estado válido (usuário nunca reconciliado);
  a UI mostra "não reconciliado" em vez de quebrar.

## §9 — Ponto de engate do WhatsApp (spec 2)

Este spec deixa pronto, sem implementar:

- `crm.stage` + `crm.stageEnteredAt` → gatilho "entrou no estágio X" e "está no
  estágio X há N dias".
- `isStagnant()` em `crmStage.ts` → o sinal exato que dispara a régua.
- `onboarding.contact.whatsapp` → o destino, já coletado no wizard.
- `users/{uid}/events` → onde a mensagem enviada será registrada como mais um
  evento, aparecendo na mesma timeline.

O spec 2 acrescenta uma coleção de regras (estágio → template), o provider da
Cloud API e o worker de envio. Nenhuma mudança no modelo acima será necessária.

## §10 — Validação

O projeto não tem testes automatizados (CLAUDE.md); a validação é manual com o dev
server. O caminho de verificação:

1. `npm run lint` limpo.
2. `scripts/set-admin-claim.cjs` atribui o claim; `/admin` abre para o admin e
   redireciona um usuário comum.
3. `POST /api/admin/reconcile` popula o CRM a partir dos usuários reais existentes
   — o kanban deve aparecer com a base atual distribuída pelas colunas, e cada
   card deve bater com o que aquele usuário de fato fez.
4. Uma ação real no app (gerar uma descrição) aparece na timeline do cliente e
   move o contador.
5. Ajuste de crédito reflete no saldo, no `credit_logs` e no `crm_audit`.

`crmStage.ts` é puro e sem I/O, então suas regras podem ser exercitadas por um
script Node avulso durante a implementação, sem subir o servidor.
