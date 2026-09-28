// Verificação da lógica pura de seleção/montagem de provider de vídeo
// (server/videoShared.ts, server/videoProviders.ts). Não sobe servidor, não
// toca o Firestore; chamadas de rede da Kling são dubladas via globalThis.fetch.
// Rodar com: npx tsx scripts/verify-video-providers.mjs
import { buildVeoRequest, VideoGenerationReferenceType } from '../server/videoShared.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`}`);
}

// --- buildVeoRequest ---
const baseRequest = {
  prompt: 'um produto girando lentamente',
  negativePrompt: 'baixa qualidade',
  durationSeconds: 8,
  aspectRatio: '9:16',
  generateAudio: false,
  referenceImages: [
    { url: 'https://cdn.exemplo/produto.jpg', base64: 'AAAA', mimeType: 'image/jpeg' },
    { url: 'https://cdn.exemplo/folha.jpg', base64: 'BBBB', mimeType: 'image/jpeg' },
  ],
};

const veoReq = buildVeoRequest(baseRequest);
check('buildVeoRequest usa o modelo Veo', veoReq.model, 'veo-3.1-fast-generate-001');
check('buildVeoRequest propaga prompt/negativePrompt', [veoReq.prompt, veoReq.config.negativePrompt], [baseRequest.prompt, baseRequest.negativePrompt]);
check('buildVeoRequest propaga duração/aspecto/áudio', [veoReq.config.durationSeconds, veoReq.config.aspectRatio, veoReq.config.generateAudio], [8, '9:16', false]);
check('buildVeoRequest converte referenceImages em ASSET com base64', veoReq.config.referenceImages, [
  { image: { imageBytes: 'AAAA', mimeType: 'image/jpeg' }, referenceType: VideoGenerationReferenceType.ASSET },
  { image: { imageBytes: 'BBBB', mimeType: 'image/jpeg' }, referenceType: VideoGenerationReferenceType.ASSET },
]);

let threw = false;
try {
  buildVeoRequest({ ...baseRequest, referenceImages: [{ url: 'https://cdn.exemplo/sem-base64.jpg' }] });
} catch {
  threw = true;
}
check('buildVeoRequest exige base64 por imagem (Veo não aceita URL crua)', threw, true);

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
