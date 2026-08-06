// Atribui o custom claim `admin: true` a um usuário, que é o que libera
// /api/admin/* e a área /admin. Uso:
//   node scripts/set-admin-claim.cjs rafaelscala@hotmail.com
//   node scripts/set-admin-claim.cjs rafaelscala@hotmail.com --remove
//
// Requer GOOGLE_APPLICATION_CREDENTIALS apontando para uma service account do
// projeto (a mesma credencial que o servidor usa).
const admin = require('firebase-admin');

const email = process.argv[2];
const remove = process.argv.includes('--remove');

if (!email) {
  console.error('Uso: node scripts/set-admin-claim.cjs <email> [--remove]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

admin
  .auth()
  .getUserByEmail(email)
  .then(async (user) => {
    const claims = { ...(user.customClaims ?? {}) };
    if (remove) delete claims.admin;
    else claims.admin = true;
    await admin.auth().setCustomUserClaims(user.uid, claims);
    console.log(`${remove ? 'Removido' : 'Concedido'} admin para ${email} (${user.uid}).`);
    console.log('O usuário precisa sair e entrar de novo para o claim entrar no token.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Falhou:', err.message);
    process.exit(1);
  });
