// Verifica a lógica pura da Referência do Produto (src/services/productReferencePrompt.ts).
// Uso: npx tsx scripts/verify-product-reference.mjs
import {
  collectProductPhotos, buildProductReferencePrompt, buildProductReferenceAdjustPrompt,
  buildProductReferenceDoc, MIN_REFERENCE_PHOTOS,
} from '../src/services/productReferencePrompt.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const product = {
  _id: 'p1',
  _selectedImage: 'https://x/a.jpg',
  'URL imagem 1': 'https://x/a.jpg',
  'URL imagem 2': ' https://x/b.jpg ',
  'URL imagem externa 3': 'https://x/c.jpg',
  _ambientImages: ['https://x/ambient.jpg'],
};

check('fotos reais, sem duplicata e sem espaços', collectProductPhotos(product), ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg']);
check('imagem ambientada não entra na referência', collectProductPhotos(product).includes('https://x/ambient.jpg'), false);
check('produto só com ambientada não atinge o mínimo', collectProductPhotos({ _id: 'p2', _ambientImages: ['a', 'b'] }).length >= MIN_REFERENCE_PHOTOS, false);

const prompt = buildProductReferencePrompt({ productName: 'Garrafa Térmica', caracteristicas: 'tampa prata', photoCount: 3 });
check('prompt cita o produto', prompt.includes('Garrafa Térmica'), true);
check('prompt inclui as características do lojista', prompt.includes('tampa prata'), true);
check('prompt pede vários ângulos e detalhes', prompt.includes('ângulos') && prompt.includes('close-ups'), true);
check('prompt sem características não deixa bloco vazio', buildProductReferencePrompt({ productName: 'X', photoCount: 2 }).includes('Características informadas'), false);

check('ajuste leva o pedido', buildProductReferenceAdjustPrompt('  logo azul ').includes('logo azul'), true);

const doc = buildProductReferenceDoc({ imageUrl: 'u', sourceImages: ['a', 'b'], caracteristicas: '  ', ajustes: [' ', 'x'] });
check('doc sem campos vazios (Firestore recusa undefined)', Object.keys(doc).sort(), ['ajustes', 'createdAt', 'imageUrl', 'sourceImages']);
check('doc limpa ajustes vazios', doc.ajustes, ['x']);

if (failures) {
  console.error(`\n${failures} verificação(ões) falharam`);
  process.exit(1);
}
console.log('\nTudo certo.');
