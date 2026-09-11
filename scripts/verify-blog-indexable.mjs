// Verificação do noindex do blog nativo. Não sobe servidor nem toca Firestore.
// Rodar com: npx tsx scripts/verify-blog-indexable.mjs
import { isBlogIndexable, DEFAULT_BLOG_COLORS } from '../src/modules/content/blog/types.ts';
import { renderDocument } from '../server/blog/shell.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// O default é o que protege os blogs que já estão no ar: sem o campo, indexa.
check('sem o campo → indexável (blogs existentes)', isBlogIndexable({}), true);
check('indexable: true → indexável', isBlogIndexable({ indexable: true }), true);
check('indexable: false → não indexável', isBlogIndexable({ indexable: false }), false);

const base = {
  enabled: true, slug: 'casa', title: 'Casa', description: '', template: 'editorial',
  colors: DEFAULT_BLOG_COLORS, customDomains: [], createdAt: '', updatedAt: '',
};
const head = { title: 'Casa', description: '', canonicalPath: '/', jsonLd: {} };
const render = (settings) => renderDocument(
  { settings, categories: [], baseUrl: '/b/casa', canonicalBase: 'https://app.test' },
  head, { css: '', body: '' },
);
const ROBOTS = '<meta name="robots" content="noindex,nofollow">';
check('preview (indexable: false) sai com noindex', render({ ...base, indexable: false }).includes(ROBOTS), true);
check('blog publicado não sai com noindex', render({ ...base, indexable: true }).includes(ROBOTS), false);
check('blog antigo (sem o campo) não sai com noindex', render(base).includes(ROBOTS), false);

console.log(failures === 0 ? '\nTudo ok.' : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
