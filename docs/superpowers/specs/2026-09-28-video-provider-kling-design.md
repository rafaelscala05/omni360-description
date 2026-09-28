# Kling como provider alternativo de geração de vídeo

**Data:** 2026-09-28
**Status:** Aprovado (brainstorming) — aguardando plano de implementação
**Arquivos afetados:** `server/videoShared.ts`, novo `server/openRouterVideoAgent.ts`, `server/videoAgent.ts`, `server/ugcVideoAgent.ts`, `server/crmAdmin.ts`, `src/services/adminService.ts`, novo `src/modules/admin/VideoSettingsView.tsx`, `src/modules/admin/AdminApp.tsx`, `.env.example`, `firestore.rules`

## Problema

Hoje `server/videoAgent.ts` (vídeo clássico) e `server/ugcVideoAgent.ts` (vídeo UGC com avatar) geram cada shot/clipe chamando o Veo 3.1 diretamente (`runVeoOperation`, em `server/videoShared.ts`), via Vertex AI com autenticação ADC. Não existe nenhum conceito de "provider" — o modelo é uma constante hardcoded (`VEO_MODEL`).

Queremos poder gerar os mesmos vídeos usando Kling (modelo `kwaivgi/kling-v3.0-std`) como alternativa, escolhida centralmente por um administrador da plataforma (não por usuário/produto), mantendo o Veo intacto como opção — inclusive como default até a Kling ser validada em produção.

## Solução

**Acesso à Kling via OpenRouter**, não a API direta da Kling. OpenRouter expõe uma API de geração de vídeo dedicada (`POST /api/v1/videos` → poll `polling_url` → `GET .../content`), com autenticação por uma única chave Bearer — mais simples que a API direta da Kling (que exige assinar um JWT HS256 com access key + secret key a cada request). O Veo continua exatamente como está hoje (Vertex AI/ADC); só a Kling passa pelo OpenRouter.

Três peças:

1. **Abstração de provider** — um dispatcher em `videoShared.ts` que escolhe entre `runVeoOperation` (existente) e `runKlingOperation` (novo, em `server/openRouterVideoAgent.ts`), ambos retornando o mesmo formato `{ videoBytes: base64 }`, para que a montagem por ffmpeg (concat, legendas, mixagem TTS) em `videoAgent.ts`/`ugcVideoAgent.ts` não mude nenhuma linha.
2. **Config de admin** — um doc Firestore único (`platform_settings/video`) com o provider padrão da plataforma, editável por uma tela nova no CRM admin, seguindo o mesmo padrão de auth (`requireAdmin`) e auditoria (`auditLog`) já usado pelas automações de WhatsApp em `server/crmAdmin.ts`.
3. **Provider resolvido uma vez por job** — lido no `start-job` e gravado no próprio doc do job, para que uma troca de default no meio de uma geração em andamento não afete o job já iniciado.

## Modelo de dados

### `platform_settings/video` (novo doc, coleção nova)

```ts
interface VideoPlatformSettings {
  defaultProvider: 'veo' | 'kling';
  updatedAt: string; // ISO
  updatedBy: string;  // uid do admin
}
```

Ausência do doc (ou do campo) ⇒ tratado como `'veo'` no código — não precisa de seed manual nem migração.

### `users/{uid}/videoJobs/{jobId}` e `users/{uid}/ugcVideoJobs/{jobId}`

Um campo novo em cada, gravado no `start-job` a partir de `platform_settings/video`, nunca recalculado depois:

```ts
provider: 'veo' | 'kling';
```

`assertNoActiveVideoJob` (o gate cross-pipeline "um job de vídeo por vez por usuário") não muda — continua agnóstico a provider, só olha `status`.

### Tipos compartilhados (`videoShared.ts`)

```ts
export type VideoProvider = 'veo' | 'kling';

// Formato de entrada comum a ambos os providers — cada agente monta isto
// uma vez e o dispatcher decide o que repassar pra Veo ou pra Kling.
export interface ClipReferenceImage {
  url: string;              // sempre presente (Storage pública) — é o que a Kling usa
  base64?: string;          // presente só quando o provider é 'veo' (resize/fetch já feito)
  mimeType?: string;
}

export interface ClipGenerationRequest {
  prompt: string;
  negativePrompt?: string;   // ignorado pela Kling — sem campo equivalente na API do OpenRouter
  durationSeconds: number;   // 8, como hoje
  aspectRatio: string;       // '9:16'
  generateAudio: boolean;    // false nos shots clássicos, true nos clipes UGC
  referenceImages: ClipReferenceImage[];
}

export interface ClipGenerationResult {
  videoBytes: string; // base64
}
```

`runClipGeneration(provider: VideoProvider, jobId: string, label: string, request: ClipGenerationRequest): Promise<ClipGenerationResult>` — dispatcher que:
- `provider === 'veo'` → monta o payload Veo hoje já montado inline em `generateShot`/`generateUgcClip` (moved para dentro deste dispatcher, usando `request.referenceImages[].base64`) e chama `runVeoOperation` (inalterado).
- `provider === 'kling'` → chama `runKlingOperation` com `request.referenceImages[].url`.

Isso significa que `generateShot` (`videoAgent.ts`) e `generateUgcClip` (`ugcVideoAgent.ts`) passam a montar um `ClipGenerationRequest` genérico (prompt, negativePrompt, referenceImages com url **e** base64 já resolvidos como hoje — o fetch/resize pra base64 continua incondicional, por simplicidade; não vale a pena condicionar isso ao provider) e chamam `runClipGeneration(job.provider, ...)` em vez de `runVeoOperation(...)` diretamente.

## `server/openRouterVideoAgent.ts` (novo)

Espelha o formato de `runVeoOperation` em `videoShared.ts` (mesma assinatura de retorno, mesmo padrão de retry/backoff), mas contra a API de vídeo do OpenRouter:

- `getOpenRouterConfig()` — lê `OPENROUTER_API_KEY` do env, lança 500 se ausente (mesmo padrão de `getGeminiClient()`).
- `KLING_MODEL = 'kwaivgi/kling-v3.0-std'` — constante, mesmo padrão de `VEO_MODEL`.
- `runKlingOperation(jobId, label, request: ClipGenerationRequest)`:
  1. `POST https://openrouter.ai/api/v1/videos` com `{ model: KLING_MODEL, prompt, duration: request.durationSeconds, aspect_ratio: request.aspectRatio, generate_audio: request.generateAudio, input_references: request.referenceImages.map(r => ({ type: 'image_url', image_url: { url: r.url } })) }`. `negativePrompt` não é enviado (sem campo equivalente documentado).
  2. Poll `GET {polling_url}` a cada 15s (mesmo intervalo do Veo) até `status` ser `'completed'` ou `'failed'`; `'failed'` lança erro com a mensagem retornada.
  3. Em `'completed'`, baixa os bytes de `GET {id}/content` (mesmo header `Authorization`) e retorna base64 — reaproveita uma variante genérica de `fetchImageAsBase64` (que já existe em `videoShared.ts`, SSRF-guarded) generalizada para qualquer content-type, não só imagem.
  4. Retry 3× com backoff (30s/60s/120s) em erro de rede/5xx — mesmo padrão do Veo, mas sem a heurística de string `/high load|.../i` (não documentada para a Kling); retry aqui é só por status HTTP/timeout.

## Config de admin (`server/crmAdmin.ts`)

Duas rotas novas **dentro de `registerCrmAdminRoutes`** (mesmo arquivo, reaproveitando os `requireAdmin`/`auditLog` locais já existentes — não cria um segundo hub de auth admin):

- `GET /api/admin/video-settings` → lê `platform_settings/video`, default `{ defaultProvider: 'veo' }` se o doc não existir.
- `PUT /api/admin/video-settings` `{ defaultProvider: 'veo' | 'kling' }` → valida o enum, `.set()` no doc com `updatedAt`/`updatedBy`, `auditLog(admin, 'platform', 'video-provider', \`default → ${defaultProvider}\`)`.

### Cliente

`src/services/adminService.ts` — duas funções no mesmo padrão de `listAutomations`:
```ts
export const getVideoSettings = () => call<VideoPlatformSettings>('/api/admin/video-settings');
export const setVideoSettings = (defaultProvider: 'veo' | 'kling') =>
  call<VideoPlatformSettings>('/api/admin/video-settings', { method: 'PUT', body: { defaultProvider } });
```

`src/modules/admin/VideoSettingsView.tsx` (novo) — mesmo esqueleto de `AutomationsView.tsx` (load em `useEffect`, `Card`/`ErrorBanner`/`Spinner` de `./ui`): dois radio/cards "Veo 3" / "Kling", mostra o valor salvo, botão salvar chama `setVideoSettings`. `AdminApp.tsx` ganha `<Route path="video" element={<VideoSettingsView />} />` e uma entrada em `NAV`.

## Env

`.env.example` ganha:
```
OPENROUTER_API_KEY=       # geração de vídeo via Kling (OpenRouter). Vazio = Kling indisponível como provider.
```
Se o admin selecionar Kling como default mas a env estiver vazia, o `start-job` do job específico falha com erro claro (mesmo padrão de `getGeminiClient()` sem `GEMINI_API_KEY`) — não há fallback silencioso pro Veo.

## Firestore rules

`platform_settings/**` é lido/escrito só pelo Admin SDK (rotas `/api/admin/*`), igual às outras coleções do CRM admin — nenhuma regra de cliente precisa ser adicionada (o padrão do projeto é negar por default e só liberar o que o cliente de fato acessa direto).

## UI do wizard de vídeo (`VideoGenerationTab.tsx`, `UgcVideoGenerationTab.tsx`)

Nenhuma mudança funcional — o usuário final não escolhe provider, só o admin. Único acréscimo (opcional, barato): mostrar o `job.provider` como badge discreto na tela de progresso, útil pra suporte/debug quando um vídeo sair diferente do esperado.

## O que NÃO muda / fora de escopo desta v1

- O pipeline Veo (`runVeoOperation`, autenticação Vertex/ADC, `VEO_MODEL`) — intocado, continua sendo o default até ser trocado manualmente no admin.
- Seleção de provider por usuário ou por produto — é só um switch de plataforma, um valor só pra todo mundo.
- `assertNoActiveVideoJob` e o restante do ciclo de vida de créditos (`debitCreditsAdmin`/`refundCreditsAdmin`) — agnósticos a provider, sem alteração.
- Trilha de música/legendas do fluxo clássico e mixagem — continuam iguais, o provider só troca a geração do vídeo mudo/com áudio nativo que entra nesse pipeline depois.
- Suporte a outros modelos Kling (`kling-v3.0-pro`, `kling-video-o1`) — fica só `kwaivgi/kling-v3.0-std` fixo por enquanto, trocável depois como uma constante (mesmo padrão do `VEO_MODEL` hoje).
- Callback/webhook do OpenRouter (`callback_url`) — v1 usa só polling, pra manter o mesmo padrão de progresso Firestore-driven que já existe (o polling loop é o lugar onde `shotsDone`/`clipsDone` são incrementados hoje).

## Riscos e mitigação

- **`generate_audio: true` da Kling pode não gerar fala sincronizada (lip sync) com o texto do avatar**, ao contrário do que o Veo 3 faz nativamente — isso é crítico especificamente pro pipeline UGC, e a documentação do OpenRouter/Kling disponível publicamente não confirma esse comportamento. Mitigação: testar manualmente os dois pipelines com Kling assim que a chave `OPENROUTER_API_KEY` estiver configurada, antes de recomendar Kling como default em produção; o Veo continua sendo o default seguro e a troca é instantânea via admin (sem deploy).
- **Payload exato da Kling/OpenRouter (`input_references` vs. `frame_images`, nomes de campo) foi coletado de documentação de terceiros e páginas parcialmente renderizadas em JS** (a doc oficial da Kling não pôde ser lida diretamente; a doc do OpenRouter foi confirmada com mais confiança, incluindo exemplo de request para `kwaivgi/kling-video-o1`). Mitigação: `runKlingOperation` isola o payload em uma função só (`buildKlingRequestBody`), fácil de ajustar num único lugar se a primeira chamada real devolver erro de schema.
- **Custo por segundo da Kling via OpenRouter (~US$0,126/s, tabela pública) é desconhecido em créditos internos da plataforma** — como não há mudança na lógica de débito (`debitCreditsAdmin` já usa o mesmo `CREDIT_ACTIONS.videoGeneration`/`ugcVideoGeneration` independente do provider), o custo em créditos fica igual ao do Veo por enquanto; se divergir na prática, ajuste é só no doc `config/credits`, sem deploy.

## Critérios de sucesso

- Um admin consegue ver e trocar o provider padrão (`Veo` ↔ `Kling`) em `/admin/video` sem precisar de deploy.
- Com Kling selecionada como default e `OPENROUTER_API_KEY` configurada, um job do fluxo clássico e um do fluxo UGC completam de ponta a ponta (script → shots/clipes → vídeo final no Storage → `_videoUrl`/`_ugcVideoUrl` no produto), sem tocar em nenhuma linha do pipeline de ffmpeg.
- Com Veo selecionado (default atual), nada muda de comportamento — zero regressão no fluxo hoje em produção.
- Trocar o default no meio de um job já `processing` não afeta esse job (ele termina com o provider que tinha quando começou).
- Sem `OPENROUTER_API_KEY` configurada, selecionar Kling como default e iniciar um job falha com uma mensagem de erro clara, sem debitar crédito (mesmo padrão de erro pré-débito hoje).
- `npm run lint` limpo; validado manualmente via dev server (projeto não tem testes automatizados) — script de verificação pura `scripts/verify-kling-payload.mjs` cobrindo `buildKlingRequestBody`, no mesmo padrão dos outros `verify-*.mjs` do projeto.
