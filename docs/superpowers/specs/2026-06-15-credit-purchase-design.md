# Design: Compra de Créditos via Asaas Checkout

**Data:** 2026-06-15  
**Status:** Aprovado

## Resumo

Implementar um fluxo de compra de créditos usando o Asaas Checkout hospedado (PIX + Cartão de Crédito). O usuário escolhe a quantidade de créditos, informa nome e CPF/CNPJ, e é redirecionado à página de checkout do Asaas. Após confirmação do pagamento via webhook, o servidor credita a conta via Firebase Admin SDK (contornando as Firestore Security Rules que bloqueiam incremento de créditos pelo cliente).

## Modelo de Negócio

- Cada crédito custa **R$ 0,50**
- Compra mínima: **10 créditos (R$ 5,00)**
- Quantidade em múltiplos de 10 (10, 20, 30, ...)
- Para gerar um produto completo o usuário gasta 10 créditos

## Arquitetura

```
Usuário
  │
  ▼
[Modal "Comprar Créditos"] ──POST /api/payments/create-checkout──► [server.ts]
  │                                                                      │
  │                                                              Cria customer no Asaas
  │                                                              Cria cobrança (PIX + Cartão)
  │                                                              Salva pendingPayments/{id}
  │                                                                      │
  │◄─────────────── { invoiceUrl } ──────────────────────────────────────┘
  │
  ▼
[Nova aba: Asaas Checkout] ── usuário paga ──► [Asaas envia webhook]
                                                        │
                                             POST /api/payments/webhook
                                                        │
                                               Valida ASAAS_WEBHOOK_TOKEN
                                               Busca pendingPayments/{id}
                                               Adiciona créditos (Admin SDK)
                                               Grava credit_log tipo "purchase"
                                               Status → completed
                                                        │
                                               Listener Firestore atualiza saldo em tempo real
```

## Frontend: `CreditPurchaseModal.tsx`

Novo componente em `src/components/modals/CreditPurchaseModal.tsx`.

**Step 1 — Quantidade e dados pessoais**
- Seletor de quantidade com botões `-10` / `+10`, mínimo 10, sem máximo definido
- Exibe valor total em tempo real: `{quantidade} créditos = R$ {(quantidade * 0.5).toFixed(2)}`
- Campo "Nome completo"
- Campo "CPF ou CNPJ" com máscara (000.000.000-00 / 00.000.000/0000-00)
- Botão "Ir para o pagamento" → POST `/api/payments/create-checkout` → abre `invoiceUrl` em nova aba

**Step 2 — Aguardando confirmação**
- Mensagem: "Sua janela de pagamento foi aberta. Complete o pagamento no Asaas."
- O listener do Firestore em `users/{uid}` já existente no App.tsx atualiza o saldo automaticamente quando o webhook creditar
- Botão "Fechar"

**Ponto de entrada:** Botão de créditos no header (onde hoje aparece a contagem). Abre o modal sem alterar a navegação existente.

## Backend: `server.ts`

### Firebase Admin SDK

Inicializado com `applicationDefault()` — funciona automaticamente no Firebase App Hosting via service account do projeto. Adicionar `firebase-admin` como dependência.

### `POST /api/payments/create-checkout`

Autenticado via `Authorization: Bearer <Firebase ID token>`.

**Entrada:**
```json
{
  "credits": 50,
  "name": "Rafael Scala",
  "cpfCnpj": "123.456.789-00"
}
```

**Lógica:**
1. Verificar ID token → extrair `uid`
2. Validar `credits`: número inteiro, múltiplo de 10, mínimo 10
3. Calcular `amount = credits * 0.50`
4. Chamar `GET /customers?cpfCnpj=...` no Asaas; se não existe, `POST /customers` com `name`, `cpfCnpj`, `email` do token
5. Chamar `POST /payments` com:
   - `customer`: ID do customer Asaas
   - `billingType: UNDEFINED` (habilita PIX + cartão no checkout)
   - `value`: amount
   - `dueDate`: hoje + 1 dia
   - `description`: `"Compra de {credits} créditos — Omni360"`
6. Salvar `pendingPayments/{payment.id}` no Firestore via Admin SDK:
   ```json
   { "uid": "...", "credits": 50, "amount": 25.00, "status": "pending", "createdAt": Timestamp }
   ```
7. Retornar `{ invoiceUrl: payment.invoiceUrl }`

**Erros:** 400 para validação, 401 para token inválido, 502 para falha no Asaas.

### `POST /api/payments/webhook`

Sem autenticação de usuário. Chamado pelo Asaas.

**Lógica:**
1. Validar header `asaas-access-token === ASAAS_WEBHOOK_TOKEN`; retornar 401 se inválido
2. Ignorar eventos que não sejam `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`
3. Buscar `pendingPayments/{payment.id}`; ignorar silenciosamente se não existe ou `status === 'completed'`
4. Transação Admin SDK:
   - Incrementar `users/{uid}.credits += credits`
   - Criar `users/{uid}/credit_logs/{newId}` com `type: 'purchase'`, `creditsAdded`, `amount`, `paymentId`, `actionType: 'Compra de Créditos'`, `timestamp`
   - Atualizar `pendingPayments/{id}.status → 'completed'`, adicionar `completedAt`
5. Sempre retornar `200` (Asaas retem se receber outro status)

## Dados no Firestore

### Nova coleção: `pendingPayments/{asaasPaymentId}`

```
pendingPayments/
  pay_abc123/
    uid: "firebase-user-uid"
    credits: 50
    amount: 25.00
    status: "pending" | "completed" | "failed"
    createdAt: Timestamp
    completedAt?: Timestamp
```

Escrita apenas pelo servidor (Admin SDK). Acesso do cliente bloqueado nas Firestore Rules.

### Atualização em `users/{uid}/credit_logs`

Compras adicionam um novo tipo de log:

```
credit_logs/{logId}/
  type: "purchase"
  actionType: "Compra de Créditos"
  creditsAdded: 50
  amount: 25.00
  paymentId: "pay_abc123"
  timestamp: number
```

Logs de débito existentes não têm `type`, mantendo compatibilidade retroativa.

**Atualização no histórico (App.tsx):** O render atual exibe `-{log.creditsConsumed}`. Atualizar para exibir `+{log.creditsAdded}` em verde quando `log.type === 'purchase'`.

## Firestore Rules

Adicionar em `firestore.rules`:

```
match /pendingPayments/{paymentId} {
  allow read, write: if false; // apenas Admin SDK (servidor)
}
```

## Variáveis de Ambiente

### `.env` (desenvolvimento local)
```
ASAAS_API_KEY=...
ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3
ASAAS_WEBHOOK_TOKEN=...
```

### `apphosting.yaml` (produção)
```yaml
env:
  - variable: ASAAS_API_KEY
    secret: asaas-api-key          # Google Cloud Secret Manager
  - variable: ASAAS_WEBHOOK_TOKEN
    secret: asaas-webhook-token    # Google Cloud Secret Manager
  - variable: ASAAS_BASE_URL
    value: https://api.asaas.com/api/v3
```

Secrets criados via: `gcloud secrets create asaas-api-key --data-file=-`

**Configuração manual no painel Asaas:** Após o deploy, registrar a URL do webhook em Configurações → Integrações → Webhooks:
`https://<url-do-app-hosting>/api/payments/webhook`
Usar o mesmo valor de `ASAAS_WEBHOOK_TOKEN` como "Token de autenticação".

## Arquivos Modificados / Criados

| Arquivo | Ação |
|---|---|
| `src/components/modals/CreditPurchaseModal.tsx` | Criar |
| `src/App.tsx` | Adicionar estado do modal, botão no header, render no histórico |
| `server.ts` | Adicionar firebase-admin, 2 endpoints |
| `firestore.rules` | Bloquear `pendingPayments` para cliente |
| `apphosting.yaml` | Adicionar 3 variáveis de ambiente |
| `.env.example` | Documentar novas variáveis |
| `package.json` | Adicionar `firebase-admin` |
