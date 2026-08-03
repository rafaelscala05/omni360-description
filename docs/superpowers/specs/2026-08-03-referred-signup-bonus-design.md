# Bônus de +30 créditos para quem se cadastra via link de indicação

## Contexto

O programa "Indique e Ganhe" (commit `ed01198`) já credita o **indicador** (usuário existente) quando alguém se cadastra usando seu link (`REFERRAL_SIGNUP_BONUS = 30`) e quando esse indicado completa o onboarding (`REFERRAL_ONBOARDING_BONUS = 70`). Essa lógica vive em `server/referralAgent.ts` (`POST /api/referrals/register-signup`), via Admin SDK, dentro de uma transação idempotente guardada pela existência do doc `referrals/{referredUid}`.

O que falta: o **próprio novo usuário** (o "indicado") não ganha nada além do bônus padrão de 10 créditos que qualquer cadastro recebe. Este spec adiciona um bônus de +30 créditos para quem se cadastra pelo link, e deixa essa vantagem visível na página "Indique e Ganhe" e no popup/formulário de cadastro.

Não há mudança no lado do indicador (nem lógica nem textos) — escopo definido explicitamente com o usuário.

## Mudanças

### 1. Constante nova
`src/types/referral.ts`: adicionar `REFERRED_SIGNUP_BONUS = 30`, distinto de `REFERRAL_SIGNUP_BONUS` (mesmo valor, papel diferente — um é o que o indicador ganha, o outro o que o indicado ganha).

### 2. Concessão real do crédito (server)
`server/referralAgent.ts`, dentro da transação existente em `/api/referrals/register-signup`:
- Além do `tx.update(referrerRef, { credits: increment(REFERRAL_SIGNUP_BONUS) })` que já existe, adicionar `tx.update(userRef, { credits: increment(REFERRED_SIGNUP_BONUS), ... })` no doc do **novo** usuário.
- Gravar um registro correspondente em `users/{novoUid}/credit_logs` (mesmo padrão usado para o log do indicador: `type: 'bonus'`, `actionKey: 'referred_signup_bonus'`, `creditsAdded: REFERRED_SIGNUP_BONUS`).
- Como a transação inteira já é idempotente (aborta cedo se `referrals/{referredUid}` já existe), não há risco de conceder o bônus duas vezes.
- O saldo já é observado em tempo real via `onSnapshot` no `App.tsx`, então o crédito aparece na UI assim que a transação roda — não é necessário nenhum toast ou lógica extra no client.

### 3. Página "Indique e Ganhe" (`src/modules/referral/ReferralPage.tsx`)
O hero hoje só mostra os marcos de ganho do indicador ("Amigo se cadastra" → +30, "Amigo completa onboarding" → +70). Adicionar uma linha abaixo do "milestone path" deixando explícito que o amigo/indicado também ganha os +30 créditos por se cadastrar pelo link, usando a nova constante `REFERRED_SIGNUP_BONUS`.

### 4. Popup e formulário de cadastro (`src/marketing/pages/AuthPage.tsx`)
- No popup "Você foi indicado!" (mostrado quando a visita chega com `?ref=CODE`), adicionar uma linha de destaque citando o bônus de +30 créditos para quem criar a conta pelo link.
- Como o popup pode ser fechado antes do preenchimento do formulário, adicionar também um selo persistente no formulário de cadastro, visível apenas quando `mode === 'register' && referrerName` (ou seja, só quando a pessoa veio por um link de indicação válido), seguindo o padrão visual do card "Bônus de Boas-vindas" já existente na tela de login.

## Fora de escopo
- Qualquer mudança em bônus, lógica ou textos do lado do indicador.
- Toast ou notificação extra no client além da atualização natural do saldo via `onSnapshot`.
- Suporte a inserir/editar código de indicação manualmente no formulário (o fluxo continua sendo só via `?ref=CODE` na URL).
