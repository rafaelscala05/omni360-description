/**
 * Cria/atualiza o documento read-only `config/credits` no Firestore, que define
 * o custo (em créditos) de cada operação de IA. Como as Security Rules bloqueiam
 * escrita do cliente nesse caminho, este script usa o Admin SDK.
 *
 * Pré-requisito: gcloud auth application-default login (conta com acesso ao projeto)
 *
 * Uso:
 *   node seed-credit-config.cjs --project="PROJECT_ID" [--db="DATABASE_ID"] [--dry-run]
 *
 * Ajuste os valores em CREDIT_COSTS / DEFAULT_COST abaixo para diferenciar custos.
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
  console.error('Uso: node seed-credit-config.cjs --project="PROJECT_ID" [--db="DB_ID"] [--dry-run]');
  process.exit(1);
}

// >>> Edite aqui para controlar/diferenciar os custos por operação <<<
const DEFAULT_COST = 1;
const CREDIT_COSTS = {
  generate_seo_single: 1,
  generate_seo_mass: 1,
  enrich_single: 1,
  enrich_mass: 1,
  regenerate_single: 1,
  generate_hierarchy: 1,
  ambient_image: 1,
  regenerate_image: 1,
  // Agência de Criação de Conteúdo (Alfred)
  content_clusters: 2,
  content_calendar: 2,
  content_article: 5,
  content_image: 1,
  content_publish: 1,
};

const app = initializeApp({ projectId: args['project'] }, 'seed-credits');
const db = (args['db'] && args['db'] !== '(default)')
  ? getFirestore(app, args['db'])
  : getFirestore(app);

async function run() {
  const payload = {
    costs: CREDIT_COSTS,
    defaultCost: DEFAULT_COST,
    updatedAt: new Date().toISOString(),
  };

  console.log(`→ config/credits @ ${args['project']}${args['db'] ? ` (db: ${args['db']})` : ''}`);
  console.log(JSON.stringify(payload, null, 2));

  if (DRY_RUN) {
    console.log('(dry-run) nada gravado.');
    return;
  }

  await db.collection('config').doc('credits').set(payload, { merge: true });
  console.log('✓ config/credits gravado.');
}

run().catch(err => { console.error(err); process.exit(1); });
