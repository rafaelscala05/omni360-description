# Onboarding por Missão — Design

**Data:** 2026-09-09
**Status:** Aprovado para plano de implementação
**Autor:** Rafael + Claude

## Objetivo

Substituir, **para coortes novas**, o onboarding atual por uma **missão única** que leva o
usuário do login até um artefato visível na primeira sessão, e por uma **trilha de
missões** que sustenta as sessões seguintes.

Duas missões, escolhidas por resultado:

- **Missão Produto** → um produto aprimorado, publicado no ERP quando houver um conectado e
  salvo no catálogo quando não houver.
- **Missão Conteúdo** → um blog montado e visível numa URL real (`noindex` até o usuário publicar).

A entrega é **conversacional no celular e em painel de duas colunas no desktop**, a partir
de **uma única máquina de estados** — não dois fluxos.

Fora de escopo: remover ou migrar os fluxos atuais; WordPress e domínio próprio no caminho
crítico; onboarding do Agente Operacional e do Agente de Força de Vendas.

## Problema

O caminho atual até o primeiro resultado atravessa **oito formulários** e um catálogo vazio:

1. `src/modules/onboarding/OnboardingWizard.tsx` — 3 passos (Perfil, Empresa/CNPJ, Contato).
   Coleta pura, zero valor entregue, e dispensável (vira banner).
2. `mainView` inicia em `'products'` (`src/App.tsx:209`) — catálogo vazio para conta nova.
3. `src/modules/content/OnboardingWizard.tsx` — outros 5 passos, em outro workspace, pedindo
   inclusive credenciais de WordPress (`wordpressUrl`, `wordpressUser`).

4. `src/components/onboarding/ProductUrlImportModal.tsx` — **um quarto fluxo, já no ar**
   (spec `2026-08-18-first-product-url-onboarding-design.md`). Auto-abre uma vez quando
   `products.length === 0` e faz zero-a-primeiro-produto-enriquecido por URL. É o que mais se
   aproxima da Missão Produto — e é o principal ponto de colisão desta entrega (ver Conflito
   declarado).

`TutorialView.tsx` (33 KB) e `AgentHomeScreen.tsx` — as duas peças que mais ajudariam — só
são alcançáveis pela sidebar, depois que o usuário já teria desistido. Nenhum dos fluxos tem
como alvo declarado os dois momentos que prendem um cliente.

## Decisões

Numeradas na ordem em que foram tomadas; cada uma restringe a seguinte.

1. **Roteamento por resultado, com sugestão.** A pergunta é "o que você quer resolver", não
   "qual agente". **A variante principal é a de conta vazia** (ver Evidência): os dois cartões
   vêm neutros e a trilha de Produto começa pedindo a URL de um produto. Quando existe
   catálogo ou ERP conectado, a trilha de Produto vem pré-selecionada com a contagem real —
   essa é a variante secundária.
   *Custo:* a tela precisa de duas variantes honestas, não uma com placeholder.

2. **Uma máquina de estados, dois renderizadores.** Passos, perguntas, validações e
   transições vivem em dados. O celular renderiza como diálogo; o desktop, como painel de
   duas colunas. *Ganho:* retomada entre dispositivos sai de graça do estado persistido.

3. **WhatsApp durante a espera, CNPJ depois.** O número é pedido no meio da geração, como
   serviço ("te aviso quando ficar pronto"), preservando o registro de consentimento que o
   CRM exige (mesmo `WHATSAPP_CONSENT_TEXT`). CNPJ sai do dia 1 e volta como missão
   opcional. *Custo:* quem abandona antes da espera não deixa telefone.

4. **Blog em preview, publicação como ato explícito.** A missão monta o blog nativo numa URL
   real com `noindex`; "Publicar o blog" remove o `noindex`. *Custo:* a linha de chegada é
   mais fraca que "está no ar" — a execução do preview precisa compensar. *Ganho:* "Publicar"
   vira um evento de conversão limpo, que hoje não existe.

5. **Nada é removido nesta fase.** A jornada nova atende só coortes novas, atrás de um flag.
   Os dois wizards e o `TutorialView` seguem servindo a base atual e o "refazer configuração".
   *Custo:* dois mundos convivendo até a decisão de migrar.

## Arquitetura

### A máquina de estados

As duas trilhas são **a mesma máquina de três etapas** — `contexto`, `palco`, `chegada` — com
conteúdo diferente. Essa é a decisão estrutural central: é o que impede o onboarding de se
dividir em dois de novo.

```
                    ┌─ contexto ─────┬─ palco ────┬─ chegada ────┐
Missão Produto      │ URL do produto │ escreve    │ antes/depois │→ ERP, ou catálogo
Missão Conteúdo     │ lê o site      │ monta blog │ URL noindex  │→ publica o blog
                    └────────────────┴────────────┴──────────────┘
```

`src/modules/onboarding/mission/missionSteps.ts` (novo, puro, sem I/O) declara as duas
missões como dados:

```ts
type MissionId = 'produto' | 'conteudo';
type StepId = 'contexto' | 'palco' | 'chegada';

interface MissionStep {
  id: StepId;
  // O que o agente pergunta/afirma neste passo, e as respostas rápidas.
  turnos: Turno[];
  // Como saber que o passo terminou.
  concluido: (estado: MissionState) => boolean;
}
```

Regra de isolamento: **nenhum renderizador guarda regra de negócio**, e `missionSteps.ts` não
importa Firebase, React ou serviços. É verificável com um script de verificação puro, no
mesmo padrão de `scripts/verify-crm-stage.mjs`.

### Estado e persistência

`users/{uid}/missions/{missionId}` — um doc por missão:

```
{ missionId, step, estado, iniciadaEm, concluidaEm?, abandonadaEm?, artefato? }
```

É o que entrega a retomada entre dispositivos (começa no celular às 22h, termina no desktop) e
o dado de **onde** cada pessoa parou — em vez de "não terminou o onboarding".

### Renderizadores

- `MissionChat.tsx` — diálogo empilhado, o palco como cartão inline. Default no mobile.
- `MissionSplit.tsx` — duas colunas, conversa à esquerda e palco à direita. Default no desktop.
- A escolha é por largura de viewport, não por user-agent, e é trocável em runtime (redimensionar
  a janela não pode perder estado).

### O palco

`Stage.tsx` — **um componente, compartilhado pelas duas trilhas e pelos dois renderizadores.**
Renderiza o log ao vivo do que o agente leu, o artefato se materializando, e os estados de
espera. Reaproveita o streaming SSE, o tratamento de parciais e a persistência de mensagens
que já existem em `src/modules/agent/AgentHomeScreen.tsx` — a lógica sai de lá em vez de
nascer de novo.

O log não é decorativo: cada linha corresponde a uma leitura que o agente de fato fez. É o que
faz 90 segundos de espera valerem a pena, e é a razão de o palco ser único — se cada trilha
ganhar o seu, voltamos a ter dois onboardings.

### Coorte

`users/{uid}.cohort === 'missao-v1'`, gravado na criação da conta. Só essa coorte entra na
jornada nova; todo o resto continua no fluxo atual, sem alteração de comportamento.
`OnboardingWizard`, o wizard de conteúdo e `TutorialView` não são tocados.

## Fluxo — Missão Produto

1. **contexto** — **caso principal (conta vazia):** pede a URL de um produto e extrai os
   dados, reaproveitando integralmente a extração de `ProductUrlImportModal` (parser
   determinístico JSON-LD/OG primeiro, Gemini só para o que não veio estruturado, fallback em
   formulário manual, e a exigência de Imagem + Título + Categoria). **Caso secundário (conta
   com catálogo):** lê `products`, conta itens sem descrição e sem SEO e confirma a loja; se
   houver ERP conectado (`_tinyProductId` / `_blingProductId` / `_idworksProductId`), usa a
   contagem real.
2. **palco** — escolhe o produto de maior tráfego sem descrição, gera descrição + título SEO +
   atributos + imagem ambientada com os serviços que já existem
   (`src/services/productService.ts`). Durante a espera, pede o WhatsApp.
3. **chegada** — antes/depois lado a lado. **Com ERP conectado:** "Publicar no Tiny" usa
   `POST /api/tiny/push`, respeitando os invariantes de push já documentados no CLAUDE.md.
   **Sem ERP (caso principal):** o botão é "Salvar no meu catálogo" — o produto entra no mesmo
   `products` / `saveToCloud` de sempre, e a oferta seguinte é conectar um ERP ou exportar a
   planilha. A linha de chegada nunca depende de uma integração que a conta não tem.
   Depois do salvo/publicado:
   "esse foi 1 de N", oferta de lote, e só então a oferta do segundo agente.

## Fluxo — Missão Conteúdo

1. **contexto** — `contentService.scanWebsite` lê o site; o agente propõe público, tom,
   frequência e temas **já preenchidos**, e o usuário corrige o que não bater. Os cinco passos
   do wizard atual viram uma revisão.
2. **palco** — monta os clusters, cria o blog nativo, escreve o primeiro artigo.
3. **chegada** — a URL `/b/{slug}/` com o blog real (logo, cores, categorias), selo `noindex`
   visível, "Abrir no navegador" e "Publicar o blog".

WordPress e domínio próprio **não aparecem** — viram missões da trilha, para quem já tem blog.

### O que muda no blog nativo

Hoje `server/blogPublic.ts:130` usa `settings.enabled` como única porta: se for falso, não
serve. Não existe nenhum tratamento de `noindex`/robots no serving.

Mudança mínima, sem quebrar nada existente:

- Novo campo `indexable` em `blog/settings`, **default `false`**.
- A missão grava `enabled: true, indexable: false` → a URL funciona, o HTML sai com
  `<meta name="robots" content="noindex,nofollow">`, e sitemap/feed retornam 404.
- "Publicar o blog" grava `indexable: true` → comportamento atual, sem `noindex`.
- **Blogs existentes** (que não têm o campo) são tratados como `indexable: true`, para não
  desindexar ninguém em produção. Esse default é a única parte da mudança que toca a base atual.

Também é preciso ligar `modules.blog` para a coorte nova, já que hoje é `false` por padrão.

## Trilha de missões (dia 2+)

Substitui o catálogo vazio como aterrissagem, **só para a coorte nova**. A primeira missão já
vem riscada — progresso herdado é o que faz a segunda sessão começar com impulso.

Cinco missões, três acionáveis; as bloqueadas ficam visíveis mas apagadas, mostrando o caminho
sem competir por atenção. É aqui que "Completar dados da empresa" (o CNPJ) aparece, com a
justificativa na própria linha: necessário só para emitir nota.

O cabeçalho mede a loja, não o uso do app: "sua loja está 1 missão à frente de ontem".

## Eventos e medição

Os eventos vão pelo beacon que já existe (`POST /api/events`, `server/crmEvents.ts:73`),
adicionando nomes a `CLIENT_EVENT_NAMES` (`src/types/crm.ts:200`):

- `mission_started` — `{ missionId, sugerida, aceitouSugestao }`
- `mission_step_completed` — `{ missionId, step }`
- `mission_completed` — `{ missionId }`
- `mission_artifact_published` — `{ missionId, destino: 'tiny' | 'blog' }`

Com a coorte antiga servindo de controle sem esforço extra, os quatro números são: tempo do
login até o primeiro artefato visível; taxa de quem inicia uma missão e alcança `chegada`;
retorno em 7 dias; e taxa de publicação. O abandono passa a dizer **em qual etapa** parou.

Um evento a mais, no CRM: a missão concluída é um sinal de milestone mais forte que
`credit_logs`, e `server/crmReconcile.ts` deve considerá-la ao derivar o estágio.

## Reaproveitamento

Já existe e não precisa ser reescrito:

| Peça | Uso na missão |
|---|---|
| `ProductUrlImportModal.tsx` (extração + fallback manual) | etapa contexto da trilha de Produto |
| `AgentHomeScreen.tsx` (SSE, parciais, persistência) | motor do palco |
| `server/blogPublic.ts` (SSR de `/b/{slug}/`) | serve o preview; falta só o `noindex` |
| `contentService.scanWebsite` | etapa contexto da trilha de Conteúdo |
| `productService.ts` (descrição, atributos, imagem) | etapa palco da trilha de Produto |
| `tinyProvider` / `POST /api/tiny/push` | chegada da trilha de Produto |
| `crmEvents.ts` + `CLIENT_EVENT_NAMES` | telemetria |
| `WHATSAPP_CONSENT_TEXT` (`src/types/onboarding.ts`) | consentimento no palco |

## Riscos

1. **Divergência entre as trilhas.** No dia em que o palco do Conteúdo tiver a animação dele e
   o de Produto o dele, voltamos ao problema que este spec existe para resolver. Mitigação:
   `Stage.tsx` único, e o script de verificação da máquina de estados garantindo que as duas
   missões têm as mesmas três etapas.
2. **Colisão com `ProductUrlImportModal`.** Os dois disparam na mesma condição
   (`products.length === 0`) e resolvem o mesmo problema. Para a coorte nova, o modal **não
   pode auto-abrir** — a missão é a porta, e ela chama a mesma extração por dentro. O gate do
   auto-open passa a checar a coorte. Deixar os dois vivos na mesma conta é a falha mais
   provável desta entrega.
3. **`indexable` default em blogs existentes.** Errar isso desindexa blogs em produção. O
   default `true` na ausência do campo é obrigatório, e precisa de teste explícito.
4. **Dois mundos convivendo.** O flag de coorte precisa ser a única porta; qualquer lógica que
   verifique "onboarding completo" em vez da coorte vai divergir entre os dois fluxos.

## Conflito declarado

O spec `2026-08-18-first-product-url-onboarding-design.md` decidiu, para o mesmo fluxo,
**"sem chat/conversacional"**, por duas razões: evitar confusão com o Agente Operacional, e
não construir infraestrutura nova sem necessidade.

Este spec **reverte essa decisão**, conscientemente:

- A confusão com o Agente Operacional deixa de existir porque a missão é enquadrada por
  resultado ("vender mais com o que já tenho"), e a Tela 0 nomeia qual agente executa. O
  Agente Operacional não aparece na jornada de entrada.
- A infraestrutura conversacional deixou de ser "sem necessidade": ela é o que permite atender
  celular e desktop com uma implementação só, e é a decisão 2 desta entrega.

O que **não** é revertido, e deve ser preservado inteiro: a extração determinística antes do
Gemini, o fallback em formulário manual, a entrada manual como escolha, e a exigência de
Imagem + Título + Categoria. Essas decisões são independentes do formato da interface.

## Evidência para a decisão 1

- O spec `2026-08-18` existe justamente porque "campanhas de performance trazem usuários
  majoritariamente mobile" que "chegam ao dashboard vazio, não têm planilha, e abandonam".
  Conta vazia é a premissa declarada do fluxo que está no ar.
- No snapshot `firestore-export/` (9 contas), 5 têm exatamente 1 produto e nenhuma tem tag de
  ERP. **Ressalva:** o snapshot é de 2026-06-12 e antecede as integrações Tiny push / Bling /
  IdWorks, então ele não mede a fração atual de contas com ERP — sustenta apenas a leitura de
  que catálogo cheio não é o estado de entrada típico.

## Pendências

- Definir se a oferta de lote na chegada de Produto debita créditos antes ou depois da
  aprovação — fora do escopo desta entrega, mas afeta a copy da tela final.
- Medir, com dados atuais do CRM, a fração de contas novas que conecta ERP na primeira semana.
  Não bloqueia esta entrega (a variante secundária já está especificada), mas decide se vale
  inverter as variantes mais adiante.

## Referência visual

Mockups das telas, o diagrama da jornada e o handoff:
<https://claude.ai/code/artifact/0ce94267-e5b3-4ee6-bd33-887ea0d9105a>
