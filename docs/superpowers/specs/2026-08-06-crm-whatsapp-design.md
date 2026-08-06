# CRM — Automação de WhatsApp Oficial por etapa do Kanban

**Data:** 2026-08-06
**Status:** Spec 2 de 2. Depende de `2026-08-06-crm-admin-design.md`, já implementado.

## Problema

O CRM já sabe em que etapa cada cliente está e quem travou, mas agir sobre isso
é manual. Falta o gatilho: quando um cliente entra numa etapa — ou empaca nela —
disparar automaticamente a mensagem certa no WhatsApp Oficial.

## Escopo

**Dentro:** provider da Meta WhatsApp Cloud API, leitura dos templates aprovados,
uma automação por etapa do Kanban (template padrão + condição de disparo), worker
de envio com salvaguardas, envio manual pela ficha do cliente, opt-out, e o
registro de cada envio na timeline.

**Fora:** recebimento de mensagens (webhook de inbound), caixa de entrada,
conversas bidirecionais. Este spec é régua de saída. Um `messages` inbound exigiria
webhook verificado, janela de atendimento de 24h e uma UI de conversa — outro
projeto.

## Decisões

### Uma automação por etapa, não um motor de regras

O pedido é "template padrão para enviar baseado na etapa". O modelo mais simples
que atende é **um documento por etapa** (`crm_automations/{stage}`, id = a própria
etapa). Isso torna impossível configurar duas regras conflitantes para a mesma
coluna, e a UI vira uma linha por coluna do Kanban — que é como a pessoa pensa
sobre o problema. Um motor de regras genérico seria mais poderoso e pior de usar.

### Dois gatilhos, não um

- **`entered`** — o cliente acabou de chegar na etapa. É boas-vindas / próximo passo.
- **`stagnant`** — o cliente passou do limite de dias daquela etapa (`STAGNATION_DAYS`,
  já definido no spec 1). É resgate.

`delayHours` adia o disparo em ambos os casos, para a mensagem não chegar no
segundo seguinte à ação.

### Salvaguardas — a parte que separa régua de spam

Automação de mensagem em canal pessoal erra feio quando erra. Cinco travas, todas
obrigatórias e não configuráveis para desligar por engano:

1. **Idempotência.** `users/{uid}/crm_messages/{stage}` é criado com
   `create()` (falha se já existir), então a mesma etapa nunca dispara duas vezes
   para o mesmo cliente — nem se o worker rodar concorrente ou reiniciar no meio.
2. **Opt-out.** `crm.whatsappOptOut === true` bloqueia todo envio automático. É
   respeitar o cliente e é exigência da política da Meta.
3. **Horário.** Só envia entre 09h e 20h no horário de Brasília. Mensagem
   comercial às 3h da manhã queima a marca e gera bloqueio.
4. **Teto diário.** No máximo `WHATSAPP_MAX_PER_DAY` envios por rodada de worker
   (padrão 50). Um bug no derivador de etapa não vira disparo em massa.
5. **Só template aprovado.** O envio sempre usa template — nunca texto livre. Fora
   da janela de 24h a Meta só aceita template mesmo, e como somos sempre nós
   iniciando, texto livre seria rejeitado ou marcado como spam.

### Cloud API direta, atrás de uma interface

`server/whatsappProvider.ts` isola a Graph API num par de funções
(`sendTemplate`, `listTemplates`, `isConfigured`). O worker e as rotas não sabem
que é a Meta. Trocar por um BSP depois é reescrever um arquivo.

Sem as env vars configuradas o provider reporta `configured: false`, a UI mostra o
que falta e o worker não roda. O CRM continua funcionando inteiro sem WhatsApp.

## §1 — Modelo de dados

```
crm_automations/{stage}            // id = CrmStage — uma por coluna do Kanban
  { stage, active, trigger: 'entered'|'stagnant', delayHours,
    templateName, templateLanguage, bodyParams: string[],
    updatedAt, updatedBy }

users/{uid}/crm_messages/{stage}   // trava de idempotência + histórico
  { stage, trigger, templateName, to, status: 'sent'|'failed',
    error, messageId, sentAt, manual: bool }

users/{uid}.crm.whatsappOptOut     // bool, controlado pelo admin
```

Tudo negado ao client nas rules; só o Admin SDK escreve.

### Variáveis do template

`bodyParams` é uma lista de tokens resolvidos por cliente no momento do envio:

| Token | Origem |
|---|---|
| `{{nome}}` | primeiro nome de `displayName` (ou do contato do onboarding) |
| `{{empresa}}` | `company.nomeFantasia` ou `razaoSocial` |
| `{{creditos}}` | saldo atual |
| `{{etapa}}` | `STAGE_LABELS[stage]` |
| `{{dias}}` | dias parado na etapa |

Qualquer outro texto é enviado literal. Token que resolve vazio vira `—`, porque
a Cloud API rejeita parâmetro em branco.

## §2 — Envio

`server/whatsappProvider.ts`:

- `isConfigured(): { ok: boolean; missing: string[] }`
- `listTemplates(): Promise<WhatsAppTemplate[]>` — `GET /{WABA_ID}/message_templates`,
  filtrando `status === 'APPROVED'`.
- `sendTemplate(to, name, language, params): Promise<{ messageId }>` —
  `POST /{PHONE_NUMBER_ID}/messages`. Erro da Meta é propagado com a mensagem
  original, porque o motivo (template não aprovado, número inválido, janela) é a
  informação que o admin precisa.

Env: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
`WHATSAPP_MAX_PER_DAY` (opcional), `WHATSAPP_DRY_RUN` (opcional).

`WHATSAPP_DRY_RUN=true` faz o worker percorrer tudo e **registrar** os envios sem
chamar a Meta. É como se valida uma régua sem torrar mensagem em cliente real.

## §3 — Worker

`server/crmAutomation.ts`, no padrão dos outros schedulers do projeto.

A cada rodada (30 min):

1. Sai cedo se o provider não estiver configurado.
2. Carrega as automações ativas.
3. Para cada usuário com `crm`:
   - resolve a automação da etapa atual; pula se não houver ou estiver inativa;
   - checa opt-out, WhatsApp presente, horário permitido;
   - avalia o gatilho (`entered` + `delayHours`, ou `isStagnant`);
   - `create()` do doc de idempotência — se já existir, pula;
   - resolve os parâmetros, envia, atualiza o doc com o resultado;
   - `recordEvent(uid, 'whatsapp_sent')` para cair na timeline;
   - respeita o teto diário.

Falha de envio grava `status: 'failed'` **mantendo** o doc de idempotência: um
número inválido não deve ser retentado a cada 30 minutos para sempre. O admin
reenvia manualmente depois de corrigir.

## §4 — API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/admin/whatsapp/status` | configurado? o que falta? dry-run ligado? |
| GET | `/api/admin/whatsapp/templates` | templates aprovados na WABA |
| GET | `/api/admin/automations` | as automações das 5 etapas |
| PUT | `/api/admin/automations/:stage` | grava a automação da etapa |
| GET | `/api/admin/customers/:uid/messages` | histórico de envios do cliente |
| POST | `/api/admin/customers/:uid/whatsapp` | envio manual de template |
| POST | `/api/admin/customers/:uid/optout` | liga/desliga o opt-out |

Todas atrás do mesmo `requireAdmin` do spec 1.

## §5 — Interface

**Nova aba "Automações"** — uma linha por coluna do Kanban, na ordem da jornada:
toggle de ativo, seletor de gatilho, atraso em horas, seletor de template (só os
aprovados) e o campo de parâmetros com a legenda dos tokens. Prévia da mensagem
resolvida com dados de exemplo. Faixa de aviso no topo quando o provider não está
configurado, listando exatamente quais env vars faltam, e quando `DRY_RUN` está
ligado.

**Ficha do cliente** — aba "WhatsApp": histórico de envios (template, quando,
status, erro), botão de envio manual com escolha de template, e o interruptor de
opt-out. Envio manual não cria doc de idempotência, então não bloqueia a régua.

**Kanban** — cada coluna mostra um selo discreto quando tem automação ativa, para
o gatilho ser visível de onde ele age.

## §6 — Tratamento de erro

- Provider não configurado: worker não roda, UI explica o que falta, envio manual
  responde 422 com a lista.
- Erro da Meta: propagado com a mensagem original e gravado em `crm_messages`.
- Falha num cliente nunca interrompe os demais (mesmo padrão do reconciliador).
- Envio nunca derruba o fluxo: o worker é isolado em try/catch por cliente.

## §7 — Validação

1. `npm run lint` limpo e `npx tsx scripts/verify-crm-automation.mjs` passando
   (lógica pura de gatilho, horário e resolução de token — sem I/O).
2. Sem env vars: `/admin/automacoes` mostra o aviso e o worker não roda.
3. Com `WHATSAPP_DRY_RUN=true`: configurar uma automação, rodar o worker e conferir
   que `crm_messages` registra o envio simulado e o evento aparece na timeline.
4. Com credenciais reais: envio manual para o próprio número.
5. Rodar o worker duas vezes seguidas e confirmar que nada é reenviado.
