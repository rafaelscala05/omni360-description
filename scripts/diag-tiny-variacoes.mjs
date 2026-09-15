// Diagnóstico SÓ DE LEITURA (produto.obter.php) de um produto com variações no
// Tiny v2. Imprime o pai e cada variação num JSON estável, para comparar antes e
// depois de um push:
//   TINY_TOKEN=... TINY_DEVELOPER_ID=... node scripts/diag-tiny-variacoes.mjs 911205510 > antes.json
//   (push)
//   TINY_TOKEN=... TINY_DEVELOPER_ID=... node scripts/diag-tiny-variacoes.mjs 911205510 > depois.json
//   diff antes.json depois.json
// Com TINY_DEVELOPER_ID o obter também devolve os mapeamentos das variações.
const [idPai] = process.argv.slice(2);
const token = process.env.TINY_TOKEN;
const developerId = process.env.TINY_DEVELOPER_ID;
if (!token || !idPai) {
  console.error('Uso: TINY_TOKEN=... [TINY_DEVELOPER_ID=...] node scripts/diag-tiny-variacoes.mjs <idPai>');
  process.exit(1);
}

async function obter(id) {
  const res = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(developerId ? { 'Developer-Id': developerId } : {}),
    },
    body: new URLSearchParams({ token, formato: 'json', id }),
  });
  const json = await res.json();
  if (json?.retorno?.status !== 'OK') throw new Error(`obter ${id}: ${JSON.stringify(json?.retorno)}`);
  return json.retorno.produto;
}

const pai = await obter(idPai);
const { variacoes = [], ...restoDoPai } = pai;
const saida = { pai: restoDoPai, variacoes: [] };
for (const item of variacoes) {
  const naListaDoPai = item?.variacao ?? item;
  // Respeita o limite por minuto do Tiny no plano base (~60 req/min).
  await new Promise((r) => setTimeout(r, 1100));
  saida.variacoes.push({ naListaDoPai, registro: await obter(String(naListaDoPai.id)) });
}
console.log(JSON.stringify(saida, null, 2));
