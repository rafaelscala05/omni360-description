// Atribui o custom claim `admin: true` a um usuário, que é o que libera
// /api/admin/* e a área /admin. Uso:
//   npx tsx scripts/set-admin-claim.mjs rafaelscala@hotmail.com
//   npx tsx scripts/set-admin-claim.mjs rafaelscala@hotmail.com --remove
//
// Requer credenciais do Google (gcloud auth application-default login, ou
// GOOGLE_APPLICATION_CREDENTIALS apontando para uma service account) — as mesmas
// que o servidor usa. Usa a API modular do firebase-admin e fixa o projectId no
// mesmo projeto de server/firebaseAdmin.ts, senão o claim iria para outro projeto.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { projectId } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'firebase-applet-config.json'), 'utf8'),
);

const email = process.argv[2];
const remove = process.argv.includes('--remove');

if (!email) {
  console.error('Uso: npx tsx scripts/set-admin-claim.mjs <email> [--remove]');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();

try {
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims ?? {}) };
  if (remove) delete claims.admin;
  else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${remove ? 'Removido' : 'Concedido'} admin para ${email} (${user.uid}).`);
  console.log('O usuário precisa sair e entrar de novo para o claim entrar no token.');
  process.exit(0);
} catch (err) {
  console.error('Falhou:', err.message);
  process.exit(1);
}
