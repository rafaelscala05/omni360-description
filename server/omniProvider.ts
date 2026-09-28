// server/omniProvider.ts
//
// Geração de vídeo via Gemini Omni 1.1 Flash, pela Interactions API do Vertex AI
// (mesmas credenciais ADC do Veo — sem API key, ver omniFetch). No Vertex o modelo só existe
// como `gemini-omni-1.1-flash-preview` e só na região `global`; o ID GA
// (`gemini-omni-1.1-flash`) é da Gemini API e dá 404 no Vertex. Validado com
// geração real em 2026-09-28: `background: true` responde na hora com
// `in_progress`, e o GET /interactions/{id} devolve o vídeo inline em
// steps[model_output].content[].data (MP4 H.264 + AAC, ~10s).
//
// O que o Omni muda em relação ao Veo, e por que o pipeline trata assim:
// - Áudio nativo sempre: vídeo e áudio (falas, efeitos, ambiente) saem na mesma
//   geração, com a fala sincronizada à boca. Não há flag para desligar — no
//   vídeo clássico o áudio do clipe é descartado na montagem (narração TTS +
//   música); no UGC é justamente ele que carrega a fala do avatar.
// - Sem campo de duração: o modelo decide entre 3 e 10s. A duração pedida vai
//   no prompt e fitSegmentDuration (videoShared.ts) acerta o trecho clássico
//   para os 8s que as legendas esperam.
// - Até 3 imagens de referência (mesmo teto do Veo), inline em base64 — por
//   isso usa o mesmo caminho multi-trecho do Veo (cena/avatar + painel + folha).
// - Sem negative prompt: vira uma linha "EVITE:" no prompt, como no Seedance.
// - Idioma: a Google só avaliou inglês; pt-BR funciona, mas sem garantia de
//   qualidade de fala/lip sync.
import { GoogleAuth } from 'google-auth-library';
import { GCP_PROJECT, type ClipGenerationRequest } from './videoShared';

export const OMNI_MODEL = 'gemini-omni-1.1-flash-preview';
export const OMNI_LOCATION = 'global';
export const OMNI_RESOLUTION = '720p';
export const OMNI_MAX_REFERENCE_IMAGES = 3;

// As imagens vão antes do texto no `input` (ordem da documentação). O Omni só
// distingue as referências pela ordem, então o prompt diz qual é qual.
export function buildOmniPrompt(request: ClipGenerationRequest): string {
  const refs = request.referenceImages.map((img, i) => `Imagem ${i + 1} = ${img.papel}`);
  return [
    ...(refs.length ? ['REFERÊNCIAS (imagens anexadas, na ordem):', ...refs, ''] : []),
    request.prompt,
    '',
    `DURAÇÃO: ${request.durationSeconds} segundos.`,
    request.generateAudio
      ? 'ÁUDIO: as falas em português do Brasil, com a boca sincronizada à fala, e som ambiente natural.'
      : 'ÁUDIO: sem falas, sem narração e sem música — só som ambiente discreto.',
    ...(request.negativePrompt ? ['', `EVITE: ${request.negativePrompt}`] : []),
  ].join('\n');
}

export function buildOmniRequestBody(request: ClipGenerationRequest): Record<string, unknown> {
  if (request.referenceImages.length > OMNI_MAX_REFERENCE_IMAGES) {
    throw new Error(`Omni aceita no máximo ${OMNI_MAX_REFERENCE_IMAGES} imagens de referência (vieram ${request.referenceImages.length})`);
  }
  return {
    model: OMNI_MODEL,
    input: [
      ...request.referenceImages.map((img) => {
        if (!img.base64 || !img.mimeType) {
          throw new Error(`referência "${img.papel}" sem base64/mimeType — obrigatório para o provider Omni`);
        }
        return { type: 'image', data: img.base64, mime_type: img.mimeType };
      }),
      { type: 'text', text: buildOmniPrompt(request) },
    ],
    response_format: {
      type: 'video',
      aspect_ratio: request.aspectRatio,
      resolution: OMNI_RESOLUTION,
      // O Vertex aceita só 'inline' ou 'uri', e 'uri' exige um gcs_uri de
      // saída. Inline é o que o Veo já faz (bytes na resposta).
      delivery: 'inline',
    },
    // Volta na hora com status in_progress; o resultado é lido por GET. Sem
    // isso a chamada fica aberta a geração inteira e pode estourar o
    // headersTimeout (5 min) do fetch do Node em 720p.
    background: true,
  };
}

interface OmniVideoContent { type?: string; data?: string; mime_type?: string }
export interface OmniInteraction {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: OmniVideoContent[] }>;
  error?: { message?: string };
}

// A fronteira com a rede — o verify script injeta um dublê no lugar do Vertex.
export interface OmniClient {
  create(body: Record<string, unknown>): Promise<OmniInteraction>;
  get(id: string): Promise<OmniInteraction>;
}

// REST direto, não `ai.interactions` do @google/genai: o SDK (1.46) monta o
// cliente de interactions com `apiKey: undefined`, e o construtor dele cai no
// default `process.env.GEMINI_API_KEY` — em produção (onde a chave existe) a
// chamada vai para o Vertex com `x-goog-api-key` e volta 401 "API keys are
// not supported by this API". Aqui a autenticação é sempre o token OAuth do ADC.
const OMNI_BASE_URL = `https://aiplatform.googleapis.com/v1beta1/projects/${GCP_PROJECT}/locations/${OMNI_LOCATION}/interactions`;
let omniAuth: GoogleAuth | null = null;

async function omniFetch(url: string, init: RequestInit = {}): Promise<OmniInteraction> {
  omniAuth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await omniAuth.getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': GCP_PROJECT, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Omni ${init.method ?? 'GET'} falhou (${res.status}): ${text.slice(0, 300)}`), { status: res.status });
  }
  return (await res.json()) as OmniInteraction;
}

function createVertexOmniClient(): OmniClient {
  return {
    create: (body) => omniFetch(OMNI_BASE_URL, { method: 'POST', body: JSON.stringify(body) }),
    get: (id) => omniFetch(`${OMNI_BASE_URL}/${encodeURIComponent(id)}`),
  };
}

const OMNI_RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const OMNI_MAX_RETRIES = 3;
const OMNI_DEFAULT_RETRY_DELAYS = [30_000, 60_000, 120_000];
const OMNI_DEFAULT_POLL_INTERVAL = 10_000;
// Abaixo do VIDEO_JOB_STALE_MS (30min), como o Seedance.
const OMNI_DEFAULT_MAX_POLL_MS = 20 * 60_000;

function isRetryableOmniError(err: unknown, attempt: number): boolean {
  const httpStatus = (err as { status?: number; httpStatus?: number }).status ?? (err as { httpStatus?: number }).httpStatus;
  const nonRetryable = (err as { nonRetryable?: boolean }).nonRetryable === true;
  return !nonRetryable && attempt < OMNI_MAX_RETRIES && (httpStatus === undefined || OMNI_RETRYABLE_HTTP_STATUS.has(httpStatus));
}

// Mesma regra do Seedance: cada fase retenta só a si mesma, para um erro no
// poll nunca pagar uma nova geração do zero.
async function withOmniRetry<T>(jobId: string, label: string, phase: string, retryDelaysMs: number[], fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= OMNI_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = retryDelaysMs[attempt - 1];
      console.log(`[video] ${label} omni ${phase} retry attempt=${attempt} after=${delay / 1000}s jobId=${jobId}`);
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isRetryableOmniError(err, attempt)) {
        console.warn(`[video] ${label} omni ${phase} transient error, will retry (${attempt + 1}/${OMNI_MAX_RETRIES}) jobId=${jobId}:`, (err as Error).message);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// O vídeo vem no último passo model_output, em base64 (delivery inline).
export function extractOmniVideoBytes(interaction: OmniInteraction): string | null {
  const steps = interaction.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type !== 'model_output') continue;
    const video = (steps[i].content ?? []).find((c) => c.type === 'video' && c.data);
    if (video?.data) return video.data;
  }
  return null;
}

export async function runOmniOperation(
  jobId: string,
  label: string,
  request: ClipGenerationRequest,
  opts: { client?: OmniClient; pollIntervalMs?: number; retryDelaysMs?: number[]; maxPollMs?: number } = {},
): Promise<string> {
  const client = opts.client ?? createVertexOmniClient();
  const pollIntervalMs = opts.pollIntervalMs ?? OMNI_DEFAULT_POLL_INTERVAL;
  const retryDelaysMs = opts.retryDelaysMs ?? OMNI_DEFAULT_RETRY_DELAYS;
  const maxPollMs = opts.maxPollMs ?? OMNI_DEFAULT_MAX_POLL_MS;

  const body = buildOmniRequestBody(request);
  let interaction = await withOmniRetry(jobId, label, 'submit', retryDelaysMs, () => client.create(body));

  const deadline = Date.now() + maxPollMs;
  let pollCount = 0;
  while (interaction.status === 'in_progress') {
    const id = interaction.id;
    if (!id) throw Object.assign(new Error(`Omni devolveu interação em andamento sem id (${label})`), { nonRetryable: true });
    if (Date.now() > deadline) throw Object.assign(new Error(`Omni excedeu o tempo máximo de espera (${label})`), { nonRetryable: true });
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    interaction = await withOmniRetry(jobId, label, 'poll', retryDelaysMs, () => client.get(id));
    pollCount++;
    console.log(`[video] polling jobId=${jobId} ${label} omni attempt=${pollCount} status=${interaction.status}`);
  }

  // failed, cancelled, incomplete, requires_action: falha determinística
  // (ex.: política de conteúdo) — retentar pagaria de novo pelo mesmo resultado.
  if (interaction.status !== 'completed') {
    const reason = interaction.error?.message ? `: ${interaction.error.message}` : '';
    throw Object.assign(new Error(`Omni não conseguiu gerar o vídeo (${label}, status ${interaction.status})${reason}`), { nonRetryable: true });
  }
  const bytes = extractOmniVideoBytes(interaction);
  if (!bytes) throw Object.assign(new Error(`Omni não retornou vídeo (${label})`), { nonRetryable: true });
  console.log(`[video] ${label} omni done jobId=${jobId} polls=${pollCount}`);
  return bytes;
}
