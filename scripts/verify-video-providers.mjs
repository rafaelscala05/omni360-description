// Verificação da lógica pura de seleção/montagem de provider de vídeo
// (server/videoShared.ts, server/videoProviders.ts). Não sobe servidor, não
// toca o Firestore; chamadas de rede do Seedance e do Omni são dubladas via globalThis.fetch.
// Rodar com: npx tsx scripts/verify-video-providers.mjs
import { buildVeoRequest, VideoGenerationReferenceType, resolveVideoProvider } from '../server/videoShared.ts';
import { buildOmniRequestBody, buildOmniPrompt, extractOmniVideoBytes, runOmniOperation, OMNI_MODEL } from '../server/omniProvider.ts';
import { buildSeedanceRequestBody, buildSeedancePrompt, getOpenRouterApiKey, runSeedanceOperation, SEEDANCE_MODEL } from '../server/videoProviders.ts';

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
    { url: 'https://cdn.exemplo/produto.jpg', base64: 'AAAA', mimeType: 'image/jpeg', papel: 'o PRODUTO' },
    { url: 'https://cdn.exemplo/folha.jpg', base64: 'BBBB', mimeType: 'image/jpeg', papel: 'FOLHA DE REFERÊNCIA' },
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
  buildVeoRequest({ ...baseRequest, referenceImages: [{ url: 'https://cdn.exemplo/sem-base64.jpg', papel: 'x' }] });
} catch {
  threw = true;
}
check('buildVeoRequest exige base64 por imagem (Veo não aceita URL crua)', threw, true);

// --- buildSeedanceRequestBody ---
const seedanceBody = buildSeedanceRequestBody(baseRequest);
check('buildSeedanceRequestBody usa bytedance/seedance-2.5', seedanceBody.model, 'bytedance/seedance-2.5');
check('SEEDANCE_MODEL é o slug do body', seedanceBody.model, SEEDANCE_MODEL);
check('buildSeedanceRequestBody mapeia duration/aspect_ratio/generate_audio', [seedanceBody.duration, seedanceBody.aspect_ratio, seedanceBody.generate_audio], [8, '9:16', false]);
check('buildSeedanceRequestBody pede 720p (default do provider pode ser 480p)', seedanceBody.resolution, '720p');
check('buildSeedanceRequestBody NÃO envia negative_prompt (campo inexistente)', 'negative_prompt' in seedanceBody, false);
check('buildSeedanceRequestBody NÃO envia frame_images (não combina com input_references)', 'frame_images' in seedanceBody, false);
check('buildSeedanceRequestBody mapeia referenceImages em input_references por url, na ordem', seedanceBody.input_references, [
  { type: 'image_url', image_url: { url: 'https://cdn.exemplo/produto.jpg' } },
  { type: 'image_url', image_url: { url: 'https://cdn.exemplo/folha.jpg' } },
]);
const seedancePrompt = buildSeedancePrompt(baseRequest);
check('buildSeedancePrompt nomeia cada referência como @ImageN na ordem do array', [
  seedancePrompt.includes('@Image1 = o PRODUTO'),
  seedancePrompt.includes('@Image2 = FOLHA DE REFERÊNCIA'),
  seedancePrompt.indexOf('@Image1') < seedancePrompt.indexOf('@Image2'),
], [true, true, true]);
check('buildSeedancePrompt mantém o prompt original', seedancePrompt.includes(baseRequest.prompt), true);
check('buildSeedancePrompt leva o negativePrompt como EVITE:', seedancePrompt.includes('EVITE: baixa qualidade'), true);
check('buildSeedancePrompt sem referências não gera bloco REFERÊNCIAS', buildSeedancePrompt({ ...baseRequest, referenceImages: [], negativePrompt: undefined }), baseRequest.prompt);
check('prompt do body é o buildSeedancePrompt', seedanceBody.prompt, seedancePrompt);

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

// --- runSeedanceOperation: rede dublada, status 'failed' não retenta ---
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
  await runSeedanceOperation('jobId1', 'shot#1', baseRequest, { pollIntervalMs: 1 });
} catch (err) {
  failedThrew = /não conseguiu gerar/i.test(err.message);
}
check('runSeedanceOperation lança quando a task volta failed', failedThrew, true);
check('runSeedanceOperation não retenta em status failed (1 submit + 1 poll)', fetchCalls, 2);

// --- runSeedanceOperation: 500 transitório retenta e depois funciona ---
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
const bytes = await runSeedanceOperation('jobId2', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1] });
check('runSeedanceOperation retenta 500 transitório e completa', Buffer.from(bytes, 'base64').toString(), 'video-bytes');

// --- runSeedanceOperation: erro transitório no poll retenta o PRÓPRIO poll,
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
const bytes4 = await runSeedanceOperation('jobId4', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1] });
check('runSeedanceOperation: erro transitório no poll não reenvia o submit (só 1 POST /videos)', videosCalls, 1);
check('runSeedanceOperation: poll foi retentado até completar', pollCalls >= 2, true);
check('runSeedanceOperation: vídeo baixado normalmente após o poll retentar', Buffer.from(bytes4, 'base64').toString(), 'video-bytes-4');

// --- runSeedanceOperation: não manda a Authorization da OpenRouter pra um host
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
await runSeedanceOperation('jobId5', 'shot#1', baseRequest, { pollIntervalMs: 1 });
check('runSeedanceOperation não manda Authorization pra host fora da OpenRouter', !downloadHeaders || !('Authorization' in downloadHeaders), true);

// --- runSeedanceOperation: status desconhecido (nem completed/failed/em-andamento)
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
  await withTimeout(runSeedanceOperation('jobId3', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1], maxPollMs: 50 }), 500);
} catch (err) {
  unknownStatusMessage = err.message;
}
check('runSeedanceOperation não trava num status desconhecido (resolve antes do timeout de segurança)', unknownStatusMessage !== 'timeout', true);
check('runSeedanceOperation menciona o status desconhecido no erro', /desconhecido/i.test(unknownStatusMessage), true);

globalThis.fetch = originalFetch;
process.env.OPENROUTER_API_KEY = originalKey;

// --- buildOmniRequestBody ---
const omniBody = buildOmniRequestBody(baseRequest);
check('buildOmniRequestBody usa o ID do Vertex (gemini-omni-1.1-flash-preview)', [omniBody.model, OMNI_MODEL], ['gemini-omni-1.1-flash-preview', 'gemini-omni-1.1-flash-preview']);
check('buildOmniRequestBody pede vídeo 9:16 720p inline (Vertex não aceita base64; uri exige gcs_uri)', omniBody.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p', delivery: 'inline' });
check('buildOmniRequestBody roda em background', omniBody.background, true);
check('buildOmniRequestBody: imagens inline em base64 antes do texto, na ordem', omniBody.input.map((p) => p.type === 'image' ? p.data : p.type), ['AAAA', 'BBBB', 'text']);
check('buildOmniRequestBody NÃO envia negative_prompt nem duração (campos inexistentes)', ['negative_prompt', 'duration', 'negativePrompt'].some((k) => k in omniBody), false);
const omniPrompt = buildOmniPrompt(baseRequest);
check('buildOmniPrompt nomeia as referências na ordem e leva duração/EVITE', [
  omniPrompt.includes('Imagem 1 = o PRODUTO'),
  omniPrompt.includes('Imagem 2 = FOLHA DE REFERÊNCIA'),
  omniPrompt.includes('DURAÇÃO: 8 segundos.'),
  omniPrompt.includes('EVITE: baixa qualidade'),
  omniPrompt.includes(baseRequest.prompt),
], [true, true, true, true, true]);
check('buildOmniPrompt: sem áudio pede clipe sem falas', /sem falas/.test(omniPrompt), true);
check('buildOmniPrompt: com áudio pede fala em pt-BR sincronizada', /português do Brasil/.test(buildOmniPrompt({ ...baseRequest, generateAudio: true })), true);
let omniThrew = false;
try { buildOmniRequestBody({ ...baseRequest, referenceImages: [{ url: 'https://x/y.jpg', papel: 'x' }] }); } catch { omniThrew = true; }
check('buildOmniRequestBody exige base64 por imagem', omniThrew, true);
omniThrew = false;
const img = baseRequest.referenceImages[0];
try { buildOmniRequestBody({ ...baseRequest, referenceImages: [img, img, img, img] }); } catch { omniThrew = true; }
check('buildOmniRequestBody recusa mais de 3 referências', omniThrew, true);

// --- extractOmniVideoBytes (formato real do Vertex, capturado em 2026-09-28) ---
check('extractOmniVideoBytes lê o vídeo do último model_output', extractOmniVideoBytes({ status: 'completed', steps: [
  { type: 'thought', content: [] },
  { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'VIDEO' }] },
] }), 'VIDEO');
check('extractOmniVideoBytes sem vídeo → null', extractOmniVideoBytes({ steps: [{ type: 'thought', content: [] }] }), null);

// --- runOmniOperation: submit em background → poll (com erro transitório) → bytes ---
const omniDone = { id: 'i1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', data: Buffer.from('omni-bytes').toString('base64') }] }] };
let omniCreates = 0;
let omniGets = 0;
let omniCreateBody = null;
const flakyClient = {
  async create(body) { omniCreates++; omniCreateBody = body; return { id: 'i1', status: 'in_progress' }; },
  async get(id) {
    omniGets++;
    if (omniGets === 1) throw Object.assign(new Error('indisponível'), { status: 503 });
    if (omniGets === 2) return { id, status: 'in_progress' };
    return omniDone;
  },
};
const omniBytes = await runOmniOperation('jobO1', 'shot#1', baseRequest, { client: flakyClient, pollIntervalMs: 1, retryDelaysMs: [1, 1, 1] });
check('runOmniOperation completa com os bytes do model_output', Buffer.from(omniBytes, 'base64').toString(), 'omni-bytes');
check('runOmniOperation envia o body de buildOmniRequestBody', omniCreateBody?.model, 'gemini-omni-1.1-flash-preview');
check('runOmniOperation: erro transitório no poll não reenvia a geração (só 1 create)', omniCreates, 1);

// --- runOmniOperation: 503 no submit retenta; 400 não ---
let submits = 0;
await runOmniOperation('jobO2', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1], client: {
  async create() { submits++; if (submits === 1) throw Object.assign(new Error('sobrecarga'), { status: 503 }); return omniDone; },
  async get() { throw new Error('não devia pollar'); },
} });
check('runOmniOperation retenta 503 no submit', submits, 2);
let badSubmits = 0;
let badMsg = '';
try {
  await runOmniOperation('jobO3', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1], client: {
    async create() { badSubmits++; throw Object.assign(new Error('invalid_request'), { status: 400 }); },
    async get() { throw new Error('não devia pollar'); },
  } });
} catch (err) { badMsg = err.message; }
check('runOmniOperation não retenta 400', [badSubmits, badMsg], [1, 'invalid_request']);

// --- runOmniOperation: status failed vira erro com o motivo, sem retentar ---
let failCreates = 0;
let omniFailMsg = '';
try {
  await runOmniOperation('jobO4', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1], client: {
    async create() { failCreates++; return { id: 'f', status: 'in_progress' }; },
    async get(id) { return { id, status: 'failed', error: { message: 'política de conteúdo' } }; },
  } });
} catch (err) { omniFailMsg = err.message; }
check('runOmniOperation: failed vira erro com o motivo e sem retentar', [/política de conteúdo/.test(omniFailMsg), failCreates], [true, 1]);

// --- runOmniOperation: não fica pollando para sempre ---
let stuckMsg = '';
try {
  await runOmniOperation('jobO5', 'shot#1', baseRequest, { pollIntervalMs: 1, retryDelaysMs: [1, 1, 1], maxPollMs: 20, client: {
    async create() { return { id: 's', status: 'in_progress' }; },
    async get(id) { return { id, status: 'in_progress' }; },
  } });
} catch (err) { stuckMsg = err.message; }
check('runOmniOperation respeita o tempo máximo de espera', /tempo máximo/.test(stuckMsg), true);

// --- resolveVideoProvider ---
check('resolveVideoProvider: omni → omni', resolveVideoProvider({ defaultProvider: 'omni' }), 'omni');
check('resolveVideoProvider: doc ausente → veo', resolveVideoProvider(undefined), 'veo');
check('resolveVideoProvider: campo ausente → veo', resolveVideoProvider({}), 'veo');
check('resolveVideoProvider: valor inválido → veo', resolveVideoProvider({ defaultProvider: 'sora' }), 'veo');
check('resolveVideoProvider: seedance → seedance', resolveVideoProvider({ defaultProvider: 'seedance' }), 'seedance');
check('resolveVideoProvider: kling legado → seedance', resolveVideoProvider({ defaultProvider: 'kling' }), 'seedance');
check('resolveVideoProvider: veo explícito → veo', resolveVideoProvider({ defaultProvider: 'veo' }), 'veo');

console.log(failures === 0 ? '\nTodas as verificações passaram.' : `\n${failures} verificação(ões) falharam.`);
process.exit(failures === 0 ? 0 : 1);
