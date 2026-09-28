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

// --- runKlingOperation: erro transitório no poll retenta o PRÓPRIO poll,
// não reenvia um novo submit (não pode comprar a geração de novo) ---
let videosCalls = 0;
let pollCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/videos')) {
    videosCalls++;
    return { ok: true, json: async () => ({ id: 'job4', polling_url: '/api/v1/videos/job4', status: 'pending' }) };
  }
  if (u.includes('/content')) {
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('video-bytes-4').buffer };
  }
  pollCalls++;
  if (pollCalls === 1) return { ok: false, status: 503, text: async () => 'indisponível' };
  return { ok: true, json: async () => ({ status: 'completed', unsigned_urls: ['https://openrouter.ai/api/v1/videos/job4/content'] }) };
};
const bytes4 = await runKlingOperation('jobId4', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1] });
check('runKlingOperation: erro transitório no poll não reenvia o submit (só 1 POST /videos)', videosCalls, 1);
check('runKlingOperation: poll foi retentado até completar', pollCalls >= 2, true);
check('runKlingOperation: vídeo baixado normalmente após o poll retentar', Buffer.from(bytes4, 'base64').toString(), 'video-bytes-4');

// --- runKlingOperation: não manda a Authorization da OpenRouter pra um host
// de terceiro (unsigned_urls pode apontar pra um CDN fora do controle da OpenRouter) ---
let downloadHeaders = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/videos')) {
    return { ok: true, json: async () => ({ id: 'job5', polling_url: '/api/v1/videos/job5', status: 'pending' }) };
  }
  if (u.startsWith('https://cdn.terceiro.exemplo/')) {
    downloadHeaders = init?.headers ?? {};
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('bytes-5').buffer };
  }
  return { ok: true, json: async () => ({ status: 'completed', unsigned_urls: ['https://cdn.terceiro.exemplo/video.mp4'] }) };
};
await runKlingOperation('jobId5', 'shot#1', baseRequest, { pollIntervalMs: 1 });
check('runKlingOperation não manda Authorization pra host fora da OpenRouter', !downloadHeaders || !('Authorization' in downloadHeaders), true);

// --- runKlingOperation: status desconhecido (nem completed/failed/em-andamento)
// não pode ficar pollando pra sempre — findings do code review (2026-09-28).
// Roda por último entre os testes de fetch: pré-fix esta chamada nunca resolve
// de verdade (só rejeita via a race de segurança abaixo), e a promise órfã
// continuaria chamando o fetch mockado em segundo plano, contaminando
// qualquer teste que viesse depois dela.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/videos')) {
    return { ok: true, json: async () => ({ id: 'job3', polling_url: '/api/v1/videos/job3', status: 'pending' }) };
  }
  return { ok: true, json: async () => ({ status: 'cancelled' }) };
};
let unknownStatusMessage = '';
try {
  await withTimeout(runKlingOperation('jobId3', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1], maxPollMs: 50 }), 500);
} catch (err) {
  unknownStatusMessage = err.message;
}
check('runKlingOperation não trava num status desconhecido (resolve antes do timeout de segurança)', unknownStatusMessage !== 'timeout', true);
check('runKlingOperation menciona o status desconhecido no erro', /desconhecido/i.test(unknownStatusMessage), true);

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
