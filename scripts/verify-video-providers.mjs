// Verificação da lógica pura de seleção/montagem de provider de vídeo
// (server/videoShared.ts, server/videoProviders.ts). Não sobe servidor, não
// toca o Firestore; chamadas de rede da Kling são dubladas via globalThis.fetch.
// Rodar com: npx tsx scripts/verify-video-providers.mjs
import { buildVeoRequest, VideoGenerationReferenceType, resolveVideoProvider } from '../server/videoShared.ts';
import { buildKlingRequestBody, getOpenRouterApiKey, runKlingOperation, KLING_MODEL } from '../server/videoProviders.ts';

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

// --- buildKlingRequestBody ---
const klingBody = buildKlingRequestBody(baseRequest);
check('buildKlingRequestBody usa o modelo Kling', klingBody.model, KLING_MODEL);
check('buildKlingRequestBody mapeia duration/aspect_ratio/generate_audio', [klingBody.duration, klingBody.aspect_ratio, klingBody.generate_audio], [8, '9:16', false]);
check('buildKlingRequestBody NÃO envia negative_prompt', 'negative_prompt' in klingBody, false);
check('buildKlingRequestBody mapeia referenceImages em input_references por url', klingBody.input_references, [
  { type: 'image_url', image_url: { url: 'https://cdn.exemplo/produto.jpg' } },
  { type: 'image_url', image_url: { url: 'https://cdn.exemplo/folha.jpg' } },
]);

// --- getOpenRouterApiKey ---
const originalKey = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
let keyThrew = false;
try {
  getOpenRouterApiKey();
} catch (err) {
  keyThrew = err.status === 500;
}
check('getOpenRouterApiKey lança 500 sem OPENROUTER_API_KEY', keyThrew, true);
process.env.OPENROUTER_API_KEY = 'sk-or-v1-teste';
check('getOpenRouterApiKey retorna a chave quando configurada', getOpenRouterApiKey(), 'sk-or-v1-teste');

// --- runKlingOperation: rede dublada, status 'failed' não retenta ---
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async (url) => {
  fetchCalls++;
  if (String(url).endsWith('/videos')) {
    return { ok: true, json: async () => ({ id: 'job1', polling_url: '/api/v1/videos/job1', status: 'pending' }) };
  }
  return { ok: true, json: async () => ({ status: 'failed' }) };
};
let failedThrew = false;
try {
  await runKlingOperation('jobId1', 'shot#1', baseRequest, { pollIntervalMs: 1 });
} catch (err) {
  failedThrew = /não conseguiu gerar/i.test(err.message);
}
check('runKlingOperation lança quando a task volta failed', failedThrew, true);
check('runKlingOperation não retenta em status failed (1 submit + 1 poll)', fetchCalls, 2);

// --- runKlingOperation: 500 transitório retenta e depois funciona ---
fetchCalls = 0;
let pollAfterRetry = 0;
globalThis.fetch = async (url) => {
  fetchCalls++;
  if (String(url).endsWith('/videos')) {
    if (fetchCalls === 1) return { ok: false, status: 500, text: async () => 'erro temporário' };
    return { ok: true, json: async () => ({ id: 'job2', polling_url: '/api/v1/videos/job2', status: 'pending' }) };
  }
  if (String(url).includes('/content') === false && String(url).includes('job2')) {
    pollAfterRetry++;
    if (pollAfterRetry === 1) return { ok: true, json: async () => ({ status: 'completed', unsigned_urls: ['https://cdn.exemplo/video.mp4'] }) };
  }
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode('video-bytes').buffer };
};
const bytes = await runKlingOperation('jobId2', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1] });
check('runKlingOperation retenta 500 transitório e completa', Buffer.from(bytes, 'base64').toString(), 'video-bytes');
globalThis.fetch = originalFetch;
process.env.OPENROUTER_API_KEY = originalKey;

// --- resolveVideoProvider ---
check('resolveVideoProvider: doc ausente → veo', resolveVideoProvider(undefined), 'veo');
check('resolveVideoProvider: campo ausente → veo', resolveVideoProvider({}), 'veo');
check('resolveVideoProvider: valor inválido → veo', resolveVideoProvider({ defaultProvider: 'sora' }), 'veo');
check('resolveVideoProvider: kling → kling', resolveVideoProvider({ defaultProvider: 'kling' }), 'kling');
check('resolveVideoProvider: veo explícito → veo', resolveVideoProvider({ defaultProvider: 'veo' }), 'veo');

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
