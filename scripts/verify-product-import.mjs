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

// og:image igual ao <img> de header/[class*="logo"] é recusado — sintoma
// clássico de página sem meta específico, caindo no banner genérico do site
const logoInHeaderHtml = `<html><head>
  <meta property="og:title" content="Camisa Polo" />
  <meta property="og:image" content="https://loja.exemplo/cdn/marca.png" />
</head><body>
  <header><div class="site-logo"><img src="https://loja.exemplo/cdn/marca.png" alt="Loja Exemplo" /></div></header>
</body></html>`;
check(
  'recusa og:image que é o mesmo <img> do header/logo',
  parseProductFromHtml(logoInHeaderHtml, 'https://loja.exemplo/produtos/camisa-polo'),
  { title: 'Camisa Polo' },
);

// og:image igual ao favicon é recusado
const logoAsFaviconHtml = `<html><head>
  <link rel="icon" href="/favicon-marca.png" />
  <meta property="og:title" content="Calça Jeans" />
  <meta property="og:image" content="https://loja.exemplo/favicon-marca.png" />
</head><body></body></html>`;
check(
  'recusa og:image que é o mesmo do favicon',
  parseProductFromHtml(logoAsFaviconHtml, 'https://loja.exemplo/produtos/calca-jeans'),
  { title: 'Calça Jeans' },
);

// Organization.logo (JSON-LD) usado como image do produto é recusado
const logoFromOrganizationHtml = `<html><head>
  <script type="application/ld+json">{"@type":"Organization","name":"Loja Exemplo","logo":"https://loja.exemplo/cdn/org-logo.png"}</script>
  <meta property="og:title" content="Jaqueta Corta-vento" />
  <meta property="og:image" content="https://loja.exemplo/cdn/org-logo.png" />
</head><body></body></html>`;
check(
  'recusa og:image igual ao Organization.logo do JSON-LD',
  parseProductFromHtml(logoFromOrganizationHtml, 'https://loja.exemplo/produtos/jaqueta'),
  { title: 'Jaqueta Corta-vento' },
);

// Nome de arquivo com "logo"/"favicon" é recusado mesmo sem <img>/favicon correspondente na página
const logoFilenameHtml = `<html><head>
  <meta property="og:title" content="Bermuda Cargo" />
  <meta property="og:image" content="https://loja.exemplo/assets/logo-principal.svg" />
</head><body></body></html>`;
check(
  'recusa imagem cujo nome de arquivo indica logo, mesmo sem markup correspondente',
  parseProductFromHtml(logoFilenameHtml, 'https://loja.exemplo/produtos/bermuda-cargo'),
  { title: 'Bermuda Cargo' },
);

// Imagem de produto legítima (não bate com nenhum sinal de logo) permanece intacta
const legitProductImageHtml = `<html><head>
  <link rel="icon" href="/favicon.ico" />
  <meta property="og:title" content="Óculos de Sol" />
  <meta property="og:image" content="https://loja.exemplo/produtos/oculos-sol-preto.jpg" />
</head><body>
  <header><img class="logo" src="/img/logo-loja.svg" alt="Loja Exemplo" /></header>
</body></html>`;
check(
  'mantém imagem de produto legítima quando não coincide com nenhum sinal de logo',
  parseProductFromHtml(legitProductImageHtml, 'https://loja.exemplo/produtos/oculos-sol'),
  { title: 'Óculos de Sol', imageUrl: 'https://loja.exemplo/produtos/oculos-sol-preto.jpg' },
);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
