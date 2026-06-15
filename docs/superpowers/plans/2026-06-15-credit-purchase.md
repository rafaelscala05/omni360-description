# Credit Purchase (Asaas Checkout) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que usuários comprem créditos em múltiplos de 10 (R$ 0,50/crédito) via Asaas Checkout hospedado (PIX + Cartão), com confirmação automática via webhook e crédito imediato no Firestore via Admin SDK.

**Architecture:** O frontend abre um modal onde o usuário escolhe a quantidade e informa nome + CPF/CNPJ. O servidor Express cria um customer e uma cobrança no Asaas e retorna a `invoiceUrl`. O Asaas confirma o pagamento via webhook POST no servidor, que usa o Firebase Admin SDK (bypassa as Security Rules) para incrementar `users/{uid}.credits`. O saldo atualiza em tempo real via `onSnapshot`.

**Tech Stack:** TypeScript, React 19, Express (server.ts), Firebase Admin SDK (`firebase-admin` já instalado), Asaas REST API v3, Firestore, Tailwind CSS v4.

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/App.tsx` | Modificar | Listener em tempo real de créditos; estado + render do modal; botão no header; histórico com compras |
| `src/components/modals/CreditPurchaseModal.tsx` | Criar | Modal 2-step de compra |
| `server.ts` | Modificar | Firebase Admin SDK; endpoint create-checkout; endpoint webhook |
| `firestore.rules` | Modificar | Bloquear `pendingPayments` para o cliente |
| `apphosting.yaml` | Modificar | Variáveis ASAAS_* |
| `.env.example` | Modificar | Documentar variáveis ASAAS_* |

---

## Task 1: Migrar leitura de créditos de getDoc para onSnapshot

**Files:**
- Modify: `src/App.tsx` (linhas ~254–300)

**Contexto:** Hoje `setCredits` é chamado uma única vez via `getDoc`. Após o webhook creditar o usuário, o saldo não atualiza sem reload. Trocar por `onSnapshot` resolve isso.

- [ ] **Passo 1: Encontrar o bloco onAuthStateChanged e substituir a leitura de créditos**

Em `src/App.tsx`, dentro do callback de `onAuthStateChanged` (~linha 254), substitua o trecho de `getDoc` por um `onSnapshot`:

```typescript
// Localizar e substituir este trecho:
const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
  setUser(currentUser);
  if (currentUser) {
    const userRef = doc(db, `users/${currentUser.uid}`);
    try {
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setCredits(userSnap.data().credits ?? 0);
      } else {
        const initialCredits = 10;
        await setDoc(userRef, { 
          email: currentUser.email, 
          credits: initialCredits,
          lastSync: new Date().toISOString(),
          displayName: currentUser.displayName 
        });
        setCredits(initialCredits);
      }
      // ... resto do bloco (credit costs config) permanece igual
```

Substituir APENAS a parte do `getDoc` do userSnap por:

```typescript
// Inicializar usuário se não existir, depois escutar em tempo real
const userSnap = await getDoc(userRef);
if (!userSnap.exists()) {
  const initialCredits = 10;
  await setDoc(userRef, {
    email: currentUser.email,
    credits: initialCredits,
    lastSync: new Date().toISOString(),
    displayName: currentUser.displayName,
  });
  setCredits(initialCredits);
}
// Listener em tempo real para manter o saldo sempre atualizado
const unsubscribeCredits = onSnapshot(userRef, (snap) => {
  if (snap.exists()) setCredits(snap.data().credits ?? 0);
});
```

E garantir que `unsubscribeCredits` seja chamado no cleanup do `onAuthStateChanged`. Armazene-o em uma variável acessível no escopo do effect (usando `useRef` ou variável local no closure do `onAuthStateChanged`).

- [ ] **Passo 2: Adicionar `onSnapshot` ao import do firebase/firestore**

Em `src/App.tsx` linha 11, adicionar `onSnapshot` à lista de imports:

```typescript
import { collection, doc, writeBatch, getDocs, setDoc, getDoc, deleteDoc, getDocFromServer, runTransaction, onSnapshot } from 'firebase/firestore';
```

- [ ] **Passo 3: Testar manualmente**

```bash
npm run dev
```
Fazer login → verificar que o saldo aparece normalmente. Acessar o Firebase Console → Firestore → editar manualmente `users/{uid}.credits` → confirmar que o saldo no header atualiza sem reload.

- [ ] **Passo 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: live credit balance via onSnapshot"
```

---

## Task 2: Bloquear `pendingPayments` no Firestore Rules e fazer deploy

**Files:**
- Modify: `firestore.rules`

- [ ] **Passo 1: Adicionar regra para pendingPayments**

Em `firestore.rules`, dentro do `match /databases/{database}/documents {`, adicionar antes do fechamento:

```
// Pagamentos pendentes — escritos apenas pelo servidor via Admin SDK.
// O cliente nunca deve ler nem escrever nesta coleção.
match /pendingPayments/{paymentId} {
  allow read, write: if false;
}
```

- [ ] **Passo 2: Deploy das regras**

```bash
firebase deploy --only firestore:rules
```

Saída esperada: `✔  firestore: released rules firestore.rules to cloud.firestore`

- [ ] **Passo 3: Commit**

```bash
git add firestore.rules
git commit -m "feat: block pendingPayments from client in firestore rules"
```

---

## Task 3: Variáveis de ambiente (local + App Hosting)

**Files:**
- Modify: `.env.example`
- Modify: `apphosting.yaml`

- [ ] **Passo 1: Atualizar .env.example**

Adicionar ao final de `.env.example`:

```
# Asaas payment gateway
ASAAS_API_KEY=your_asaas_api_key_here
ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3
ASAAS_WEBHOOK_TOKEN=your_webhook_token_here
```

- [ ] **Passo 2: Adicionar ao seu .env local**

```bash
# Adicione as variáveis ao .env com os valores reais do sandbox Asaas
echo "ASAAS_API_KEY=..." >> .env
echo "ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3" >> .env
echo "ASAAS_WEBHOOK_TOKEN=..." >> .env
```

- [ ] **Passo 3: Atualizar apphosting.yaml**

Adicionar ao bloco `env:` de `apphosting.yaml`:

```yaml
  - variable: ASAAS_API_KEY
    secret: asaas-api-key
  - variable: ASAAS_WEBHOOK_TOKEN
    secret: asaas-webhook-token
  - variable: ASAAS_BASE_URL
    value: https://api.asaas.com/api/v3
```

- [ ] **Passo 4: Criar os secrets no Google Cloud Secret Manager (produção)**

```bash
echo -n "SEU_ASAAS_API_KEY_PRODUCAO" | gcloud secrets create asaas-api-key --data-file=-
echo -n "SEU_WEBHOOK_TOKEN" | gcloud secrets create asaas-webhook-token --data-file=-
```

Conceder acesso ao App Hosting:
```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud secrets add-iam-policy-binding asaas-api-key \
  --member="serviceAccount:firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding asaas-webhook-token \
  --member="serviceAccount:firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

- [ ] **Passo 5: Commit**

```bash
git add .env.example apphosting.yaml
git commit -m "feat: add Asaas env vars to apphosting.yaml and .env.example"
```

---

## Task 4: Inicializar Firebase Admin SDK no server.ts

**Files:**
- Modify: `server.ts`

**Contexto:** `firebase-admin@^14.0.0` já está em `package.json`. No App Hosting, `applicationDefault()` usa automaticamente o service account do projeto, sem necessidade de arquivo de credenciais.

- [ ] **Passo 1: Adicionar imports do Firebase Admin no topo de server.ts**

Logo após os imports existentes (linha ~8, antes do `dotenv.config()`):

```typescript
import admin from 'firebase-admin';

// Inicializa o Admin SDK uma única vez. No App Hosting, applicationDefault()
// usa o service account do projeto automaticamente. Localmente, configure
// GOOGLE_APPLICATION_CREDENTIALS apontando para um arquivo de credenciais de serviço.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const adminDb = admin.firestore();
const adminAuth = admin.auth();
```

- [ ] **Passo 2: Testar que o servidor ainda sobe sem erro**

```bash
npm run dev
```

Saída esperada: `Server running on http://localhost:3000` (sem erros de Admin SDK).

Se der erro de credenciais localmente, configure:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
```

- [ ] **Passo 3: Commit**

```bash
git add server.ts
git commit -m "feat: initialize Firebase Admin SDK in server.ts"
```

---

## Task 5: Endpoint POST /api/payments/create-checkout

**Files:**
- Modify: `server.ts`

- [ ] **Passo 1: Adicionar helper para verificar o ID token do Firebase**

Antes dos endpoints existentes em `server.ts`, adicionar:

```typescript
async function verifyFirebaseToken(req: express.Request): Promise<admin.auth.DecodedIdToken> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing auth token'), { status: 401 });
  }
  const idToken = authHeader.split('Bearer ')[1];
  return adminAuth.verifyIdToken(idToken);
}
```

- [ ] **Passo 2: Adicionar helper para criar ou recuperar customer no Asaas**

```typescript
async function getOrCreateAsaasCustomer(
  name: string,
  cpfCnpj: string,
  email: string,
): Promise<string> {
  const baseUrl = process.env.ASAAS_BASE_URL!;
  const apiKey = process.env.ASAAS_API_KEY!;
  const headers = { 'access_token': apiKey, 'Content-Type': 'application/json' };

  // Remover formatação do CPF/CNPJ antes de enviar
  const rawCpfCnpj = cpfCnpj.replace(/\D/g, '');

  const listResp = await fetch(`${baseUrl}/customers?cpfCnpj=${rawCpfCnpj}&limit=1`, { headers });
  if (!listResp.ok) throw new Error(`Asaas list customers failed: ${listResp.status}`);
  const listData = await listResp.json() as { data: Array<{ id: string }> };

  if (listData.data.length > 0) return listData.data[0].id;

  const createResp = await fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, cpfCnpj: rawCpfCnpj, email }),
  });
  if (!createResp.ok) throw new Error(`Asaas create customer failed: ${createResp.status}`);
  const customer = await createResp.json() as { id: string };
  return customer.id;
}
```

- [ ] **Passo 3: Adicionar o endpoint create-checkout**

Logo após o endpoint `/api/upload` em `server.ts`:

```typescript
app.post('/api/payments/create-checkout', async (req, res) => {
  try {
    const decoded = await verifyFirebaseToken(req);
    const { credits, name, cpfCnpj } = req.body as {
      credits: number;
      name: string;
      cpfCnpj: string;
    };

    // Validações
    if (!credits || !Number.isInteger(credits) || credits < 10 || credits % 10 !== 0) {
      return res.status(400).json({ error: 'credits deve ser inteiro, múltiplo de 10 e mínimo 10' });
    }
    if (!name?.trim()) return res.status(400).json({ error: 'name é obrigatório' });
    if (!cpfCnpj?.trim()) return res.status(400).json({ error: 'cpfCnpj é obrigatório' });

    const amount = credits * 0.5;
    const email = decoded.email ?? `${decoded.uid}@sem-email.com`;

    const customerId = await getOrCreateAsaasCustomer(name.trim(), cpfCnpj, email);

    // Vencimento: hoje + 1 dia
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    const baseUrl = process.env.ASAAS_BASE_URL!;
    const apiKey = process.env.ASAAS_API_KEY!;
    const headers = { 'access_token': apiKey, 'Content-Type': 'application/json' };

    const paymentResp = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customer: customerId,
        billingType: 'UNDEFINED',
        value: amount,
        dueDate: dueDateStr,
        description: `Compra de ${credits} créditos — Omni360`,
      }),
    });

    if (!paymentResp.ok) {
      const err = await paymentResp.text();
      console.error('Asaas create payment error:', err);
      return res.status(502).json({ error: 'Falha ao criar cobrança no Asaas' });
    }

    const payment = await paymentResp.json() as { id: string; invoiceUrl: string };

    // Salvar pendingPayment no Firestore via Admin SDK
    await adminDb.collection('pendingPayments').doc(payment.id).set({
      uid: decoded.uid,
      credits,
      amount,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ invoiceUrl: payment.invoiceUrl });
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status === 401) return res.status(401).json({ error: 'Não autorizado' });
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});
```

- [ ] **Passo 4: Testar manualmente com curl**

```bash
# Primeiro, obtenha um token Firebase (use o DevTools do app logado):
# No console do navegador: firebase.auth().currentUser.getIdToken().then(console.log)

TOKEN="SEU_TOKEN_AQUI"
curl -s -X POST http://localhost:3000/api/payments/create-checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"credits": 10, "name": "Rafael Scala", "cpfCnpj": "000.000.000-00"}' | python3 -m json.tool
```

Saída esperada: `{ "invoiceUrl": "https://sandbox.asaas.com/i/..." }`

- [ ] **Passo 5: Commit**

```bash
git add server.ts
git commit -m "feat: add POST /api/payments/create-checkout"
```

---

## Task 6: Endpoint POST /api/payments/webhook

**Files:**
- Modify: `server.ts`

- [ ] **Passo 1: Adicionar o endpoint webhook**

Logo após o endpoint `create-checkout`:

```typescript
app.post('/api/payments/webhook', async (req, res) => {
  // Sempre retornar 200 para o Asaas não retentar
  try {
    const token = req.headers['asaas-access-token'];
    if (token !== process.env.ASAAS_WEBHOOK_TOKEN) {
      console.warn('Webhook: token inválido recebido');
      return res.status(200).json({ received: true }); // 200 mesmo em erro de auth (evita retry)
    }

    const event = req.body as {
      event: string;
      payment?: { id: string };
    };

    const CONFIRMABLE_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
    if (!CONFIRMABLE_EVENTS.includes(event.event) || !event.payment?.id) {
      return res.status(200).json({ received: true });
    }

    const paymentId = event.payment.id;
    const pendingRef = adminDb.collection('pendingPayments').doc(paymentId);

    await adminDb.runTransaction(async (tx) => {
      const pendingSnap = await tx.get(pendingRef);
      if (!pendingSnap.exists || pendingSnap.data()?.status === 'completed') return;

      const { uid, credits, amount } = pendingSnap.data() as {
        uid: string;
        credits: number;
        amount: number;
      };

      const userRef = adminDb.collection('users').doc(uid);
      const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();

      tx.update(userRef, {
        credits: admin.firestore.FieldValue.increment(credits),
      });

      tx.set(logRef, {
        type: 'purchase',
        actionType: 'Compra de Créditos',
        creditsAdded: credits,
        creditsConsumed: 0,
        amount,
        paymentId,
        productName: 'N/A',
        sku: 'N/A',
        userName: '',
        timestamp: new Date().toISOString(),
      });

      tx.update(pendingRef, {
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(200).json({ received: true }); // Nunca falhar para o Asaas
  }
});
```

- [ ] **Passo 2: Testar manualmente com curl (simular evento Asaas)**

```bash
WEBHOOK_TOKEN=$(grep ASAAS_WEBHOOK_TOKEN .env | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/payments/webhook \
  -H "Content-Type: application/json" \
  -H "asaas-access-token: $WEBHOOK_TOKEN" \
  -d '{
    "event": "PAYMENT_CONFIRMED",
    "payment": { "id": "pay_test_123" }
  }' | python3 -m json.tool
```

Saída esperada: `{ "received": true }` (e no Firestore, `pendingPayments/pay_test_123` não existe ainda, então a transação sai silenciosamente).

Para testar o fluxo completo: faça um pagamento real no sandbox e monitore os logs do servidor.

- [ ] **Passo 3: Commit**

```bash
git add server.ts
git commit -m "feat: add POST /api/payments/webhook"
```

---

## Task 7: Criar CreditPurchaseModal.tsx

**Files:**
- Create: `src/components/modals/CreditPurchaseModal.tsx`

- [ ] **Passo 1: Criar o componente**

```typescript
import React, { useState } from 'react';
import { X, Coins, Minus, Plus, CreditCard, Loader2 } from 'lucide-react';
import { auth } from '../../firebase';

interface Props {
  onClose: () => void;
}

type Step = 'form' | 'waiting';

function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export default function CreditPurchaseModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [credits, setCredits] = useState(10);
  const [name, setName] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amount = (credits * 0.5).toFixed(2);

  function handleCpfCnpjChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCpfCnpj(formatCpfCnpj(e.target.value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado');
      const token = await user.getIdToken();

      const resp = await fetch('/api/payments/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ credits, name: name.trim(), cpfCnpj }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Erro ao gerar cobrança');
      }

      const { invoiceUrl } = await resp.json() as { invoiceUrl: string };
      window.open(invoiceUrl, '_blank', 'noopener,noreferrer');
      setStep('waiting');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={onClose}
        />
        <div className="relative inline-block w-full max-w-md p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Coins className="w-6 h-6 text-amber-500" />
              <h3 className="text-lg font-semibold text-gray-900">Comprar Créditos</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <X className="w-6 h-6" />
            </button>
          </div>

          {step === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Seletor de quantidade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantidade de créditos
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCredits((c) => Math.max(10, c - 10))}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-40"
                    disabled={credits <= 10}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold text-gray-900 w-16 text-center">
                    {credits}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCredits((c) => c + 10)}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <div className="ml-auto text-right">
                    <p className="text-sm text-gray-500">Total</p>
                    <p className="text-xl font-bold text-gray-900">R$ {amount}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  R$ 0,50 por crédito · mínimo 10 créditos
                </p>
              </div>

              {/* Dados pessoais */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome completo
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Seu nome completo"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CPF ou CNPJ
                </label>
                <input
                  type="text"
                  value={cpfCnpj}
                  onChange={handleCpfCnpjChange}
                  required
                  placeholder="000.000.000-00"
                  maxLength={18}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6] focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#004ac6] text-white rounded-xl font-medium hover:bg-[#003aa0] disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando cobrança...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Ir para o pagamento
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                <CreditCard className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-gray-900 mb-1">
                  Janela de pagamento aberta
                </h4>
                <p className="text-sm text-gray-500">
                  Complete o pagamento na janela do Asaas. Após a confirmação, seus créditos
                  serão adicionados automaticamente.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Passo 2: Verificar que não há erros de tipo**

```bash
npm run lint
```

Saída esperada: sem erros. Se houver erros de tipo, corrija antes de continuar.

- [ ] **Passo 3: Commit**

```bash
git add src/components/modals/CreditPurchaseModal.tsx
git commit -m "feat: add CreditPurchaseModal component"
```

---

## Task 8: Integrar modal no App.tsx e atualizar histórico

**Files:**
- Modify: `src/App.tsx`

- [ ] **Passo 1: Importar o modal**

Adicionar ao bloco de imports do App.tsx (junto dos outros imports de modals):

```typescript
import CreditPurchaseModal from './components/modals/CreditPurchaseModal';
```

- [ ] **Passo 2: Adicionar estado do modal**

Junto dos outros estados (por volta da linha 167):

```typescript
const [isCreditPurchaseOpen, setIsCreditPurchaseOpen] = useState(false);
```

- [ ] **Passo 3: Tornar o badge de créditos no header clicável**

Localizar o badge de créditos (~linha 2097):

```typescript
<div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 md:px-3 py-1 rounded-full shadow-sm">
  <Coins className="w-4 h-4 text-amber-500 shrink-0" />
  <span className="hidden sm:inline">Créditos:</span>
  <span className="text-slate-900 font-bold">{credits}</span>
</div>
```

Substituir por:

```typescript
<button
  onClick={() => setIsCreditPurchaseOpen(true)}
  className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 md:px-3 py-1 rounded-full shadow-sm hover:bg-amber-50 hover:border-amber-200 transition-colors"
  title="Comprar créditos"
>
  <Coins className="w-4 h-4 text-amber-500 shrink-0" />
  <span className="hidden sm:inline">Créditos:</span>
  <span className="text-slate-900 font-bold">{credits}</span>
</button>
```

- [ ] **Passo 4: Adicionar botão "Comprar créditos" no modal de histórico**

No modal de créditos (~linha 2830), substituir o texto de contato pelo botão:

```typescript
// Substituir:
<div className="text-right">
  <p className="text-xs text-amber-600">Para recarregar, entre em contato</p>
  <p className="text-xs text-amber-600">com o administrador do sistema.</p>
</div>

// Por:
<button
  onClick={() => {
    setIsCreditHistoryOpen(false);
    setIsCreditPurchaseOpen(true);
  }}
  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition-colors"
>
  <Coins className="w-3.5 h-3.5" />
  Comprar créditos
</button>
```

- [ ] **Passo 5: Atualizar render do histórico para exibir compras com sinal positivo**

No histórico de créditos, atualizar a interface `CreditLog` (~linha 39) para incluir os campos opcionais:

```typescript
interface CreditLog {
  id: string;
  type?: 'purchase';
  actionType: string;
  actionKey?: string;
  productName: string;
  sku: string;
  userName: string;
  creditsConsumed: number;
  creditsAdded?: number;
  amount?: number;
  timestamp: string;
}
```

No render da tabela do histórico (~linha 2965), substituir a célula de custo:

```typescript
// Substituir:
<td className="px-4 py-3 whitespace-nowrap text-right text-xs font-bold text-amber-600">
  -{log.creditsConsumed}
</td>

// Por:
<td className="px-4 py-3 whitespace-nowrap text-right text-xs font-bold">
  {log.type === 'purchase' ? (
    <span className="text-green-600">+{log.creditsAdded}</span>
  ) : (
    <span className="text-amber-600">-{log.creditsConsumed}</span>
  )}
</td>
```

No `renderHistoryView` (~linha 1927), o cálculo de "Usado Este Mês" deve ignorar compras:

```typescript
// Substituir:
{creditLogs.reduce((acc, log) => acc + log.creditsConsumed, 0)}

// Por:
{creditLogs.filter(l => l.type !== 'purchase').reduce((acc, log) => acc + log.creditsConsumed, 0)}
```

- [ ] **Passo 6: Renderizar o modal no JSX do App**

Antes do fechamento do `return` principal (junto dos outros modals, por volta da linha 2885):

```typescript
{isCreditPurchaseOpen && (
  <CreditPurchaseModal onClose={() => setIsCreditPurchaseOpen(false)} />
)}
```

- [ ] **Passo 7: Testar manualmente**

```bash
npm run dev
```

Verificar:
1. Clicar no badge de créditos → modal abre
2. Botão `-10` desabilitado quando quantidade é 10
3. Valor total atualiza ao mudar quantidade
4. Máscara de CPF/CNPJ funciona (xxx.xxx.xxx-xx / xx.xxx.xxx/xxxx-xx)
5. Submit com dados válidos → nova aba abre com checkout Asaas sandbox
6. Step 2 aparece com mensagem de aguardo
7. No modal de histórico: botão "Comprar créditos" abre o modal de compra

- [ ] **Passo 8: Verificar lint**

```bash
npm run lint
```

Sem erros esperados.

- [ ] **Passo 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire CreditPurchaseModal into App.tsx + update credit history"
```

---

## Task 9: Teste de ponta a ponta no sandbox

**Pré-requisito:** Ter as variáveis `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` configuradas no `.env` com valores reais do sandbox Asaas.

- [ ] **Passo 1: Expor o servidor local para o Asaas via ngrok (para testar webhook)**

```bash
ngrok http 3000
```

Copiar a URL HTTPS gerada (ex: `https://abc123.ngrok.io`).

- [ ] **Passo 2: Registrar o webhook no painel Asaas sandbox**

Acessar: https://sandbox.asaas.com → Configurações → Integrações → Webhooks

URL: `https://abc123.ngrok.io/api/payments/webhook`
Token: valor de `ASAAS_WEBHOOK_TOKEN` do `.env`
Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`

- [ ] **Passo 3: Fazer uma compra completa**

1. Abrir `http://localhost:3000`
2. Fazer login
3. Clicar no badge de créditos
4. Selecionar 10 créditos, preencher nome e CPF
5. Clicar em "Ir para o pagamento"
6. Na página do Asaas sandbox, usar dados de teste para PIX ou cartão
7. Confirmar pagamento
8. Verificar nos logs do servidor que o webhook chegou
9. Verificar que o saldo atualizou no header sem reload
10. Verificar que o histórico de créditos mostra a entrada de compra com `+10` em verde

- [ ] **Passo 4: Commit final da branch**

```bash
git add -A
git commit -m "feat: complete Asaas credit purchase flow"
```
