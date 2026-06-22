/**
 * Cria/atualiza um cupom de desconto na coleção `coupons` do Firestore. Como as
 * Security Rules bloqueiam escrita do cliente nesse caminho, este script usa o
 * Admin SDK (mesma abordagem de seed-credit-config.cjs).
 *
 * O id do documento é o CÓDIGO do cupom em maiúsculas. Campos:
 *   - active:     boolean   — cupom habilitado
 *   - type:       'percent' | 'fixed'
 *   - value:      number    — percent: 0-100 ; fixed: valor em R$
 *   - minCredits: number?   — quantidade mínima de créditos para usar (opcional)
 *
 * O desconto incide apenas sobre o valor pago; a quantidade de créditos é mantida.
 * O valor mínimo de cobrança no Asaas é R$ 5,00 (o servidor aplica esse piso).
 *
 * Pré-requisito: gcloud auth application-default login (conta com acesso ao projeto)
 *
 * Uso:
 *   node seed-coupon.cjs --project="PROJECT_ID" [--db="DATABASE_ID"] [--dry-run]
 *
 * Ajuste COUPON_CODE / COUPON abaixo para criar outros cupons.
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] ?? true;
  });
  return args;
}

const args = parseArgs();
const DRY_RUN = args['dry-run'] === true;

if (!args['project']) {
  console.error('Uso: node seed-coupon.cjs --project="PROJECT_ID" [--db="DB_ID"] [--dry-run]');
  process.exit(1);
}

// >>> Edite aqui para criar/diferenciar o cupom <<<
const COUPON_CODE = 'BEMVINDO10';
const COUPON = {
  active: true,
  type: 'percent',   // 'percent' ou 'fixed'
  value: 10,         // 10% de desconto
  minCredits: 10,    // mínimo de créditos para usar
};

const app = initializeApp({ projectId: args['project'] }, 'seed-coupon');
const db = (args['db'] && args['db'] !== '(default)')
  ? getFirestore(app, args['db'])
  : getFirestore(app);

async function run() {
  const code = COUPON_CODE.trim().toUpperCase();
  const payload = { ...COUPON, updatedAt: new Date().toISOString() };

  console.log(`→ coupons/${code} @ ${args['project']}${args['db'] ? ` (db: ${args['db']})` : ''}`);
  console.log(JSON.stringify(payload, null, 2));

  if (DRY_RUN) {
    console.log('(dry-run) nada gravado.');
    return;
  }

  await db.collection('coupons').doc(code).set(payload, { merge: true });
  console.log(`✓ coupons/${code} gravado.`);
}

run().catch(err => { console.error(err); process.exit(1); });
