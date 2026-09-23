// scripts/verify-video-gate.mjs
//
// Verificação da regra pura do gate de "um job de vídeo por vez"
// (server/videoShared.ts). Não toca o Firestore.
// Rodar com: npx tsx scripts/verify-video-gate.mjs
import { isVideoJobActive, VIDEO_JOB_STALE_MS } from '../server/videoShared.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

const now = Date.parse('2026-09-23T12:00:00.000Z');
const ago = (ms) => new Date(now - ms).toISOString();

check('queued recente é ativo', isVideoJobActive({ status: 'queued', updatedAt: ago(5 * 60_000) }, now), true);
check('processing recente é ativo', isVideoJobActive({ status: 'processing', updatedAt: ago(60_000) }, now), true);
check('done nunca é ativo', isVideoJobActive({ status: 'done', updatedAt: ago(1000) }, now), false);
check('error nunca é ativo', isVideoJobActive({ status: 'error', updatedAt: ago(1000) }, now), false);

// Um job cuja instância morreu fica 'processing' para sempre — não pode travar o usuário.
check(
  'processing parado além do limite é ignorado',
  isVideoJobActive({ status: 'processing', updatedAt: ago(VIDEO_JOB_STALE_MS + 1000) }, now),
  false,
);
check(
  'processing logo abaixo do limite ainda é ativo',
  isVideoJobActive({ status: 'processing', updatedAt: ago(VIDEO_JOB_STALE_MS - 1000) }, now),
  true,
);

// Dado ruim jamais deve bloquear o usuário.
check('updatedAt inválido não trava', isVideoJobActive({ status: 'queued', updatedAt: 'lixo' }, now), false);
check('sem updatedAt não trava', isVideoJobActive({ status: 'queued' }, now), false);
check('sem status não trava', isVideoJobActive({ updatedAt: ago(1000) }, now), false);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
