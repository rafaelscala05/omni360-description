// scripts/verify-video-fetch.mjs
//
// Verifica que o fetch de imagem compartilhado pelos pipelines de vídeo
// (server/videoShared.ts) recusa destinos internos ANTES de qualquer conexão:
// as rotas de vídeo buscam URLs de imagem enviadas pelo cliente, então sem esse
// guard qualquer usuário logado faria o servidor acessar a rede interna (SSRF).
// Não faz nenhuma requisição de rede real.
// Rodar com: npx tsx scripts/verify-video-fetch.mjs
import { fetchImageAsBase64 } from '../server/videoShared.ts';

let failures = 0;
async function rejects(label, url, expectedMessage) {
  let message = '(não lançou erro)';
  try {
    await fetchImageAsBase64(url);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  const ok = message.includes(expectedMessage);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado "${expectedMessage}", veio "${message}"`}`);
}

await rejects('bloqueia loopback', 'http://127.0.0.1:9/x.jpg', 'Destino não permitido');
await rejects('bloqueia o endpoint de metadados do GCP', 'http://169.254.169.254/computeMetadata/v1/', 'Destino não permitido');
await rejects('bloqueia a rede privada 10.x', 'http://10.0.0.5/x.jpg', 'Destino não permitido');
await rejects('bloqueia protocolo file:', 'file:///etc/passwd', 'Protocolo não permitido');

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
