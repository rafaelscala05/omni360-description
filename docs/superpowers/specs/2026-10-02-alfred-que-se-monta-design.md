# Alfred que se monta — Design

**Data:** 2026-10-02
**Status:** Aprovado para plano de implementação
**Autor:** Rafael + Claude
**Referência visual:** <https://claude.ai/artifact/1PPnm2XHBtBJ5QwZ3DSdS9>
**Evolui:** `2026-09-09-onboarding-missao-design.md` (coorte `missao-v1`)

## Objetivo

O cliente chega com um objetivo — melhorar a descrição dos produtos, otimizar o Mercado Livre
ou gerar conteúdo para o blog — e o Alfred se monta a partir dele: ganha uma peça a cada módulo
que o cliente adere, cada integração que conecta e cada permissão que libera.

Fora de escopo: Wake como objetivo da Tela 0 (segue só como conexão da peça Loja/ERP), o
Agente Operacional como porta de entrada, e a migração da base atual (fase 6, só com dados da v2).

## Problema (estado em `eb2bcb3`)

1. **Mercado Livre não é objetivo.** `MissionId = 'produto' | 'conteudo'` (`missionTypes.ts`);
   o `MissionPicker` só tem esses dois cartões.
2. **Só Conteúdo é aderido pelo cliente.** O único código que grava `modules.*` é
   `habilitarConteudo` (`App.tsx`). `meliListingOptimizer`, `operationsAgent` e `video` são
   ligados à mão.
3. **Mesma coorte, dois apps.** A Missão Conteúdo liga `contentAgent`, então `temAgente` vira
   verdadeiro e a conta ganha o shell do Alfred; a Missão Produto não liga módulo de agente e a
   conta fica no shell antigo.
4. **O que não está ativo some.** `FerramentasScreen` esconde os cartões com
   `hasContentAgent &&` / `hasMeli &&`; Fontes só lista conexões como "Disponíveis", nunca módulos.
5. **Trilha fixa.** `montarTrilha` devolve sempre os mesmos seis itens, sem Mercado Livre e sem
   permissões, independente do objetivo.
6. **Permissão fora da jornada.** `agent_settings` existe, mas o cliente só chega nele por
   configuração.

O que já ajuda: `resolveAgentContext` já deriva os providers de módulos + conexões, e a máquina
`contexto → palco → chegada` com `Stage` único aguenta uma terceira trilha.

## Decisões

1. **Adesão livre.** Nenhum módulo depende de plano. Ao aceitar um objetivo (Tela 0 ou peça "para
   montar"), o servidor liga o módulo e grava o aceite em `users/{uid}/adesoes/{objetivo}`
   (`{ modulo, objetivo, aceitoEm, texto }`). O consumo continua em créditos.
2. **Uma missão por sessão.** A Tela 0 aceita vários objetivos; o primeiro marcado vira a missão
   em tela cheia. Os outros entram no topo da Semana e não abrem sozinhos na mesma sessão.
3. **Crédito de missão.** Cada adesão concede, uma única vez, créditos do tamanho da missão
   daquele módulo, na mesma transação que liga o módulo. Idempotência pelo `create()` do doc de
   `adesoes` (mesmo padrão de `crm_messages`). Registrado em `credit_logs`. Valores por módulo em
   `config/credits.missao.{produto,meli,conteudo}`, editáveis sem deploy. **Precisa ser no
   servidor:** `firestore.rules` impede o cliente de aumentar `credits`.
4. **Wake fora da Tela 0.** Fica como conexão da peça Loja/ERP ("Libera: banners e SEO da loja").

## Modelo

Toda peça passa por quatro camadas, sempre nesta ordem, cada uma com um único lugar de gravação:

| Camada | Pergunta ao cliente | Onde mora |
|---|---|---|
| Objetivo | o que você quer resolver | `users/{uid}.objetivos: Objetivo[]` |
| Módulo | ativar este agente | `users/{uid}.modules.*` (só servidor) + `adesoes/{objetivo}` |
| Conexão | conectar a fonte de dados | estado das integrações já existente |
| Permissão | pode fazer sem perguntar | `users/{uid}/agent_settings/config` |

Peças: `produtos`, `meli`, `conteudo`, `erp`, `video`. Estados **derivados**, nunca gravados:
`oculta → disponivel → ativa → conectada → com-resultado`, mais a autonomia lida de
`agent_settings`.

| Peça | Disponível | Ativa | Conectada | 1º resultado | Automático |
|---|---|---|---|---|---|
| Produtos | sempre | criação da conta | ≥1 produto | 1 descrição aprovada | `produtos.descricoes.gerar` |
| Mercado Livre | sempre (sem módulo) | `meliListingOptimizer` | OAuth + sync | 1 proposta publicada | propostas/fotos; publicar é trava |
| Conteúdo | sempre (sem módulo) | `contentAgent` + `blog` | site lido + blog criado | 1º artigo | produção; publicar é trava |
| Loja/ERP | após 1º produto salvo | (é conexão) | Tiny/Bling/IdWorks/Wake | 1 envio | nunca (trava fixa) |
| Vídeo | produto com ≥2 fotos reais | `video` | — | 1 vídeo | nunca (trava fixa) |

Decisão da implementação (2026-10-02): a rota recebe `objetivos[]` (a Tela 0 manda vários de uma vez) e o doc de aceite é por objetivo; módulo gravado `false` é revogação do admin e bloqueia a adesão em qualquer conta. ML e Conteúdo ficam sempre disponíveis, porque condicioná-los a objetivo/ERP/site repetiria o problema 4 (o que não está ativo some). A Semana continua oferecendo uma peça por vez. Objetivo já aderido não religa o módulo: se o admin desligou, a revogação vale (achado da revisão de segurança).

### `src/modules/agent/capacidades.ts` (novo, puro)

```ts
export type Objetivo = 'produto' | 'meli' | 'conteudo';
export type PecaId = 'produtos' | 'meli' | 'conteudo' | 'erp' | 'video';
export type EstadoPeca = 'oculta' | 'disponivel' | 'ativa' | 'conectada' | 'com-resultado';
export interface Peca { id: PecaId; estado: EstadoPeca; autonomia: 'perguntar' | 'parcial' | 'automatico'; libera: string; proximoPasso?: { titulo: string; destino: string } }
export function montarAlfred(conta: ContaAlfred): Peca[];
```

Lido por Tela 0, `SemanaPanel` (no máximo uma peça "para montar" por vez), `FerramentasScreen`,
`ConectoresScreen` e `resolveAgentContext`. Verificar com `npx tsx scripts/verify-capacidades.mjs`.
Regra: nenhuma tela volta a decidir sozinha a partir de `hasX` solto.

### `POST /api/onboarding/aderir { objetivos: Objetivo[] }`

Numa transação: `create()` em `adesoes/{objetivo}` (se já existe, responde 200 sem efeito), liga
`modules.*` do objetivo, acrescenta o objetivo em `objetivos`, soma o crédito de missão e grava
o `credit_logs`. Emite `recordEvent('module_adopted', { modulo, objetivo })` para o CRM.
`habilitarConteudo` no cliente passa a chamar esta rota.

## Jornadas

As três usam `missionSteps.ts` e o `Stage` único; o WhatsApp continua pedido na primeira espera.

**Produto** (existe): contexto = link/planilha/ERP (extração determinística antes do Gemini) →
palco = descrição + SEO → chegada = antes/depois, salvar no catálogo ou publicar no Tiny.
Novo: "esse foi 1 de N" oferece o lote em massa (`/api/agent/lotes`) dentro do Alfred.

**Mercado Livre** (novo `MissionId 'meli'`): contexto = adesão + OAuth + `/api/meli/sync` com log
do que foi lido → palco = escolher o anúncio (pura: visitas × problemas da análise) e gerar a
proposta → chegada = revisão e publicação via `meli_mutation_runs` (trava fixa). O OAuth precisa
de retomada pelo doc da missão: o callback devolve uma página de popup, e no Safari do iOS o
popup vira aba. Evento `mission_artifact_published` com `destino: 'meli'`; marco `meli_published`
no `crmStage`.

**Conteúdo** (existe): site lido → temas + blog nativo + 1º artigo → URL em `noindex`, "Publicar o
blog". Novo: com catálogo, o 2º artigo cita produtos reais (`BlogPostProduct`). Com o crédito de
missão, o caminho enxuto pode voltar a incluir o calendário.

**Pontes** (tarefas da Semana, uma por vez): ML → "traga esses produtos para o catálogo";
Produtos → "seus produtos também estão no ML?"; Conteúdo só é sugerido depois que os produtos
estiverem descritos; Vídeo quando houver anúncios do ML sem vídeo.

## Permissões por confiança

- **Perguntar** é o padrão de toda ferramenta de escrita.
- **Fazer sozinho** é oferecido depois de 3 aprovações seguidas da mesma ferramenta sem "Ajustar no
  chat". Uma oferta por ferramenta; recusada, só volta em 30 dias (`agent_settings.ofertas`).
- **Travas fixas** não mudam: publicar no ML, publicar o blog, enviar ao ERP, gerar vídeo,
  conectar credencial.

## Coorte

`missao-v2`, gravada na criação da conta. Para ela: shell do Alfred desde o login, e provider
`produtos` sem depender de `contentAgent`/`operationsAgent`. A `missao-v1` e a base legada não mudam.

## Fases

1. `capacidades.ts` + verify; Ferramentas e Fontes mostram peças "para montar".
2. Coorte `missao-v2` nasce no shell do Alfred.
3. Tela 0 com três objetivos + `POST /api/onboarding/aderir` com crédito de missão.
4. Missão Mercado Livre (testar OAuth no iOS antes de abrir a coorte).
5. Oferta de automático por confiança + pontes entre peças.
6. Migração da base (objetivos derivados pelo `crmReconcile`), saída do wizard legado.

## Riscos

1. **Duas fontes de verdade.** Se alguma tela continuar lendo `hasMeli` etc. direto, as portas
   voltam a discordar. Mitigação: `montarAlfred` é a única entrada, e o verify cobre os estados.
2. **Crédito duplicado.** Só a transação com `create()` concede; nenhum caminho do cliente.
3. **Custo da Missão ML ainda não somado.** Medir análise + proposta + foto antes de fixar
   `config/credits.missao.meli`.
4. **OAuth do ML no telefone.** Sem retomada pelo doc da missão, o cliente perde o passo.
