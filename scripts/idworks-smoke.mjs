// Smoke-test the IdWorks API contract end-to-end against a real account, using the
// exact flow server/idworksAgent.ts implements: POST /user/signin/local → JWT →
// GET /sku (list) → GET /sku/{idsku} (detail). Run it once you have test credentials.
//
// Usage:
//   IDWORKS_ACCOUNT=teste IDWORKS_EMAIL=<login> IDWORKS_PASSWORD=<senha> npx tsx scripts/idworks-smoke.mjs
//   # or: npx tsx scripts/idworks-smoke.mjs <accountName> <email> <password>
//
// It validates (a) the auth contract (path/body/token field — confirmed via the OpenAPI
// spec + probing the demo account) and (b) the import listing + detail endpoints — the
// two calls the background import worker makes per page. Exits 0 on success.
import assert from 'node:assert';

const [accArg, emailArg, pwArg] = process.argv.slice(2);
const accountName = accArg ?? process.env.IDWORKS_ACCOUNT;
const email = emailArg ?? process.env.IDWORKS_EMAIL;
const password = pwArg ?? process.env.IDWORKS_PASSWORD;

if (!accountName || !email || !password) {
  console.error('Informe accountName, email e password (via argv ou IDWORKS_ACCOUNT/IDWORKS_EMAIL/IDWORKS_PASSWORD).');
  process.exit(1);
}

const base = `https://${accountName}.api-idworks.com.br/1.0`;
const log = (m) => console.log(`[idworks-smoke] ${m}`);

const tokenRes = await fetch(`${base}/user/signin/local`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const tokenText = await tokenRes.text().catch(() => '');
if (!tokenRes.ok) {
  console.error(`Falha ao autenticar (${tokenRes.status}): ${tokenText.slice(0, 300)}`);
  process.exit(1);
}
const tokenJson = JSON.parse(tokenText);
const token = tokenJson.token ?? tokenJson.access_token ?? tokenJson.jwt;
assert.ok(typeof token === 'string' && token.length > 0, `token ausente na resposta: ${JSON.stringify(tokenJson).slice(0, 200)}`);
log('autenticado — token obtido de POST /user/signin/local');

const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// Import listing: GET /sku (Page x 500, Simple=0 default detail), filtered to IDTypeSku 3/4
// exactly like idworksImportWorker.listPage does.
const listRes = await fetch(`${base}/sku?Page=0&Simple=0`, { headers: authHeaders });
const listText = await listRes.text().catch(() => '');
if (!listRes.ok) {
  console.error(`GET /sku falhou (${listRes.status}): ${listText.slice(0, 300)}`);
  process.exit(1);
}
const list = JSON.parse(listText);
const skus = (Array.isArray(list) ? list : []).filter((s) => s?.IDTypeSku === 3 || s?.IDTypeSku === 4);
log(`GET /sku → ${skus.length} SKUs vendáveis (IDTypeSku 3/4) na página 0.`);
assert.ok(Array.isArray(list), 'GET /sku deve retornar array');

if (skus.length > 0) {
  const firstId = String(skus[0].IDSku);
  const detailRes = await fetch(`${base}/sku/${firstId}`, { headers: authHeaders });
  const detailText = await detailRes.text().catch(() => '');
  if (!detailRes.ok) {
    console.error(`GET /sku/${firstId} falhou (${detailRes.status}): ${detailText.slice(0, 300)}`);
    process.exit(1);
  }
  const detailArr = JSON.parse(detailText);
  const detail = Array.isArray(detailArr) ? detailArr[0] : detailArr;
  log(`GET /sku/${firstId} → ${detail?.IDSkuCompany ?? '(sem códigos)'} · nome=${detail?.SkuName ?? '(sem nome)'} · NCM=${detail?.SkuNCM ?? '-'}`);
  console.log('Campos de mapeamento de amostra:', JSON.stringify({
    idworksId: String(detail?.IDSku ?? ''),
    sku: detail?.IDSkuCompany,
    nome: detail?.SkuName,
    descricaoHtml: detail?.EcommerceDescription,
    seoTitle: detail?.EcommerceTitle,
    ncm: detail?.SkuNCM,
    gtin: detail?.BarCode,
    pesoLiquido: detail?.SkuWeightNet,
    categoria: detail?.CategoryTree ?? detail?.Category,
    imagem: detail?.MainImageURL,
  }));
} else {
  log('nenhum SKU na página 0 — import retornará vazio nesta conta (ok para validação de contrato).');
}

console.log('OK — contrato de auth + listagem + detalhe validados contra a API real.');
