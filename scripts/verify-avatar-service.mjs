// scripts/verify-avatar-service.mjs
//
// Verificação da lógica pura de persistência de avatar
// (src/services/avatarPrompt.ts, reexportada por avatarService.ts). Não toca
// o Firestore. Importa avatarPrompt.ts diretamente (não avatarService.ts),
// que puxa src/firebase.ts — App Check + reCAPTCHA Enterprise fazem setup de
// DOM no carregamento do módulo e derrubam qualquer runtime fora do browser.
// Rodar com: npx tsx scripts/verify-avatar-service.mjs
import { getAvatarsPath, buildAvatarDoc, buildAvatarPortraitPrompt, buildAvatarDescription } from '../src/services/avatarPrompt.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

check('path da coleção é por uid', getAvatarsPath('abc123'), 'users/abc123/avatars');

const doc1 = buildAvatarDoc({ nome: 'Ana', descricao: 'jovem casual', referenceImageUrl: 'https://x/y.jpg' }, 'id1');
check('doc novo tem id', doc1.id, 'id1');
check('doc novo tem createdAt string', typeof doc1.createdAt, 'string');
check('doc novo não tem chaves undefined', Object.values(doc1).some((v) => v === undefined), false);

const doc2 = buildAvatarDoc({ nome: 'Ana', descricao: 'jovem casual', referenceImageUrl: undefined }, 'id1', '2026-01-01T00:00:00.000Z');
check('createdAt existente é preservado (update, não create)', doc2.createdAt, '2026-01-01T00:00:00.000Z');
check('chave undefined é removida antes de gravar', 'referenceImageUrl' in doc2, false);

const prompt = buildAvatarPortraitPrompt('mulher jovem, 25 anos, estilo casual');
check('prompt de retrato inclui a descrição fornecida', prompt.includes('mulher jovem, 25 anos, estilo casual'), true);
check('prompt pede fundo neutro', prompt.includes('Fundo neutro'), true);

const description = buildAvatarDescription({
  faixaEtaria: '25–34 anos', genero: 'Mulher', etnia: 'Pessoa negra',
  estilo: 'Casual descontraído', tomDeVoz: 'Animado e espontâneo',
}, 'cabelo cacheado');
check('descrição inclui faixa etária selecionada', description.includes('Faixa etária: 25–34 anos'), true);
check('descrição inclui tom de voz selecionado', description.includes('Tom de voz: Animado e espontâneo'), true);
check('descrição inclui detalhes livres', description.includes('Detalhes adicionais: cabelo cacheado'), true);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
