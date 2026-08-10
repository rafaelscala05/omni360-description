# CRM — múltiplas automações de WhatsApp por etapa

**Data:** 2026-08-10
**Status:** Spec 3 de 3. Depende de `2026-08-06-crm-admin-design.md` e
`2026-08-06-crm-whatsapp-design.md`, já implementados. Substitui a decisão
"uma automação por etapa" do spec 2 (seção "Decisões").

## Problema

O spec 2 fixou **um documento por etapa** (`crm_automations/{stage}`, id = a
própria etapa) de propósito, para impedir duas regras conflitantes na mesma
coluna. Na prática isso é forte demais: o pedido real é fazer uma sequência —
"Cadastrou → 1h depois, mensagem A" e "Cadastrou → 10h depois, mensagem B" e
"Cadastrou → travou 2h, mensagem C" — três disparos independentes na mesma
coluna, cada um com seu próprio gatilho, atraso e template.

## Escopo

**Dentro:** trocar o modelo de "1 automação por etapa" por "N automações por
etapa", cada uma com seu próprio gatilho (`entered`/`stagnant`), atraso e
template; UI para adicionar/editar/remover automações dentro de cada coluna;
migração do worker e da trava de idempotência para operar por automação, não
por etapa.

**Fora:** tudo que já está fora do spec 2 (inbound, conversas). Também fora:
ordenar/priorizar automações dentro da mesma etapa — todas as automações
ativas de uma etapa são avaliadas de forma independente e podem disparar
todas para o mesmo cliente, sem interação entre si (confirmado com o
usuário: receber várias mensagens da mesma etapa, uma após a outra, é o
comportamento desejado).

## Decisões

### Documento por automação, não por etapa

`crm_automations` deixa de ser id = `CrmStage` (5 documentos fixos) e passa a
ser uma coleção normal com id auto-gerado. Cada doc carrega `stage` como
campo (não mais como chave), então nada impede duas, três ou N automações
apontando para a mesma etapa. Isso é a mudança central do spec — todo o
resto decorre dela.

### Nada de motor de regras genérico

Continua sendo o mesmo modelo de automação do spec 2 (gatilho + atraso +
template), só que sem o limite artificial de uma por etapa. Não é um motor de
regras com condições compostas, prioridades ou branching — YAGNI. Se
aparecer necessidade de ordenar ou condicionar automações entre si, é um
spec novo.

### Idempotência por automação, não por etapa

A trava hoje é `users/{uid}/crm_messages/{stage}`. Com N automações por
etapa, isso teria que virar `users/{uid}/crm_messages/{automationId}` —
cada automação tem sua própria trava, então a automação "1h" e a automação
"10h" da mesma etapa não bloqueiam uma à outra, e cada uma dispara no máximo
uma vez por cliente.

### Sem migração automática de dados

Os 5 documentos atuais (`crm_automations/signed_up`, etc.) são recriados
manualmente no admin depois do deploy — confirmado com o usuário. O deploy
troca a coleção de forma e os documentos antigos, com id = nome da etapa,
simplesmente deixam de ser lidos (o novo código nunca faz `.doc(stage)`, só
`.doc(automation.id)`). Não é necessário apagá-los, mas o admin precisa
reconfigurar as 5 régua atuais na UI nova.

## §1 — Modelo de dados

```
crm_automations/{automationId}     // id auto-gerado — N por etapa
  { id, stage, active, trigger: 'entered'|'stagnant', delayHours,
    templateName, templateLanguage, bodyParams: string[],
    updatedAt, updatedBy }

users/{uid}/crm_messages/{automationId}   // trava de idempotência + histórico, 1 por automação
  { automationId, stage, trigger, templateName, to,
    status: 'sent'|'failed', error, messageId, sentAt, manual: bool }
```

`CrmAutomation` (`src/types/crm.ts`) ganha o campo `id: string`. `stage`
continua no tipo, mas vira um campo comum, não mais implícito na chave do
documento. `defaultAutomation(stage)` vira `defaultAutomation(stage): Omit<CrmAutomation, 'id'>`,
usado só como valor inicial de um formulário novo (não mais como fallback de
leitura, já que agora "sem automação" para uma etapa é simplesmente "lista
vazia").

Envio manual (`POST /api/admin/customers/:uid/whatsapp`) já usa `.doc()`
auto-id com `stage: 'manual'` e continua exatamente assim — não interage com
a trava de nenhuma automação.

## §2 — Worker

`server/crmAutomation.ts`:

- `loadAutomations()` passa de `Promise<Record<CrmStage, CrmAutomation>>`
  para `Promise<CrmAutomation[]>` (lê a coleção inteira, sem `.doc(stage)`).
- `runAutomations()` deixa de iterar `CRM_STAGES` e passa a iterar a lista de
  automações ativas; para cada uma, filtra os usuários cuja etapa atual bate
  com `automation.stage` e roda o mesmo fluxo do spec 2 (opt-out, WhatsApp
  presente, horário, gatilho, `create()` da trava, envio, registro).
- A trava de idempotência usa `automation.id` no lugar de `automation.stage`.
- Teto diário (`WHATSAPP_MAX_PER_DAY`) continua global por rodada do worker,
  agora contando envios de todas as automações somadas.

`shouldSend()` (`server/crmAutomationRules.ts`) já recebe uma única
`CrmAutomation` e não precisa mudar de assinatura — só o chamador muda (uma
automação por vez de uma lista, em vez de uma por etapa fixa).

## §3 — API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/admin/automations` | todas as automações, de todas as etapas |
| POST | `/api/admin/automations` | cria uma automação nova (`stage` no corpo) |
| PUT | `/api/admin/automations/:id` | edita uma automação existente |
| DELETE | `/api/admin/automations/:id` | remove uma automação |

Substitui `PUT /api/admin/automations/:stage` do spec 2. As demais rotas
(`/whatsapp/status`, `/whatsapp/templates`, `/customers/:uid/*`) não mudam.

`adminService.ts`: `saveAutomation(stage, automation)` vira
`createAutomation(stage, automation)`, `updateAutomation(id, automation)` e
`deleteAutomation(id)`.

## §4 — Interface

`AutomationsView.tsx` deixa de ser "uma linha por coluna" e passa a ser "um
Card por coluna, contendo uma lista de automações daquela coluna":

- Cada Card de etapa lista suas automações como sub-linhas (o mesmo form do
  spec 2: ativo, gatilho, atraso em horas, template, parâmetros), cada uma
  com um botão de remover.
- Botão "+ Adicionar automação" no rodapé do Card cria uma automação nova
  para aquela etapa com `defaultAutomation(stage)` como ponto de partida.
- Etapa sem nenhuma automação mostra o Card vazio com só o botão de
  adicionar — não é mais um estado impossível, é o padrão para quem ainda
  não configurou nada ali.
- Prévia da mensagem resolvida, faixa de aviso de provider não configurado e
  selo no Kanban continuam como no spec 2, só que o selo agora reflete "tem
  pelo menos uma automação ativa" em vez de "tem a automação da coluna
  ativa".

## §5 — Tratamento de erro

Mesmo padrão do spec 2 (§6): falha num cliente não interrompe os demais,
falha de envio grava `status: 'failed'` mantendo a trava (não retenta
sozinho), provider não configurado impede o worker de rodar. Nenhuma
automação nova nesse quesito — só o escopo da trava muda de etapa para
automação individual.

## §6 — Validação

1. `npm run lint` limpo.
2. `scripts/verify-crm-automation.mjs` atualizado: os casos que hoje montam
   um `Record<CrmStage, CrmAutomation>` passam a montar uma `CrmAutomation[]`
   com 0, 1 ou N entradas por etapa; adicionar um caso específico de duas
   automações ativas na mesma etapa, com gatilhos/atrasos diferentes,
   confirmando que ambas podem disparar para o mesmo cliente sem se
   bloquearem.
3. No admin: criar duas automações na coluna "Cadastrou" (`entered` + 1h,
   `entered` + 10h), rodar o worker com `WHATSAPP_DRY_RUN=true` e conferir
   dois docs distintos em `crm_messages`, um por automação.
4. Remover uma automação e confirmar que a outra continua funcionando
   normalmente (a trava da removida não afeta a que ficou).
