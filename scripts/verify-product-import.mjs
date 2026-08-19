// Verificação da extração pura de server/productImport.ts (JSON-LD/OG). Não
// sobe servidor, não faz fetch de rede. Rodar com:
// npx tsx scripts/verify-product-import.mjs
import { parseProductFromHtml } from '../server/productImport.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok' : 'FALHA'}  ${label}${
      ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`
    }`,
  );
}

// JSON-LD Product completo
const jsonLdHtml = `<html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"Tênis Esportivo Pro",
   "description":"Tênis leve para corrida","image":"https://loja.exemplo/img/tenis.jpg",
   "brand":{"@type":"Brand","name":"Alfred Sport"},
   "offers":{"@type":"Offer","price":"299.90","priceCurrency":"BRL"}}
  </script>
</head><body></body></html>`;
check('extrai JSON-LD completo', parseProductFromHtml(jsonLdHtml), {
  title: 'Tênis Esportivo Pro',
  description: 'Tênis leve para corrida',
  price: 299.9,
  imageUrl: 'https://loja.exemplo/img/tenis.jpg',
  brand: 'Alfred Sport',
});

// JSON-LD dentro de um array @graph / lista de scripts, com @type em array
const jsonLdArrayHtml = `<html><head>
  <script type="application/ld+json">[{"@type":["Product"],"name":"Camiseta Básica","image":["https://loja.exemplo/img/camiseta.jpg"]}]</script>
</head><body></body></html>`;
check('extrai JSON-LD quando @type é array e o payload é uma lista', parseProductFromHtml(jsonLdArrayHtml), {
  title: 'Camiseta Básica',
  imageUrl: 'https://loja.exemplo/img/camiseta.jpg',
});

// Sem JSON-LD, cai para Open Graph
const ogHtml = `<html><head>
  <meta property="og:title" content="Mochila Urbana" />
  <meta property="og:description" content="Mochila resistente à água" />
  <meta property="og:image" content="https://loja.exemplo/img/mochila.jpg" />
  <meta property="product:price:amount" content="189.9" />
</head><body></body></html>`;
check('extrai via Open Graph quando não há JSON-LD', parseProductFromHtml(ogHtml), {
  title: 'Mochila Urbana',
  description: 'Mochila resistente à água',
  price: 189.9,
  imageUrl: 'https://loja.exemplo/img/mochila.jpg',
});

// JSON-LD malformado não deve lançar exceção — cai para OG ou fica vazio
const brokenHtml = `<html><head>
  <script type="application/ld+json">{ isto não é json }</script>
  <meta property="og:title" content="Produto Recuperado" />
</head><body></body></html>`;
check('JSON-LD quebrado não derruba a extração, cai para OG', parseProductFromHtml(brokenHtml), {
  title: 'Produto Recuperado',
});

// Nenhum dado estruturado — retorna objeto vazio, nunca lança
check('sem JSON-LD nem OG retorna vazio', parseProductFromHtml('<html><head></head><body>oi</body></html>'), {});

// Imagem relativa (comum em og:image) é resolvida contra a URL da página
const relativeImageHtml = `<html><head>
  <meta property="og:title" content="Boné Trucker" />
  <meta property="og:image" content="/img/bone.jpg" />
</head><body></body></html>`;
check(
  'resolve og:image relativo contra a URL da página',
  parseProductFromHtml(relativeImageHtml, 'https://loja.exemplo/produtos/bone-trucker'),
  { title: 'Boné Trucker', imageUrl: 'https://loja.exemplo/img/bone.jpg' },
);

// Sem baseUrl, imagem relativa é devolvida como veio (sem baseUrl não há como resolver)
check(
  'sem baseUrl, imagem relativa não é alterada',
  parseProductFromHtml(relativeImageHtml),
  { title: 'Boné Trucker', imageUrl: '/img/bone.jpg' },
);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
