# Pipeline de Vídeo Paralelo com Fidelidade por Referência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar os 4 shots do vídeo de produto em paralelo, ancorados na foto real via `referenceImages` do Veo 3.1, reduzindo o job de 10–20 min para ~2–5 min com fidelidade total ao produto.

**Architecture:** O encadeamento sequencial seed→último-frame em `server/videoAgent.ts` vira um `Promise.all` de 4 chamadas Veo, cada uma com a foto do produto (inteira, sem crop) como imagem de referência `ASSET`. TTS roda no mesmo `Promise.all`. Concat+mix fundem-se em um passe único de ffmpeg. Progresso via contador `shotsDone` no Firestore.

**Tech Stack:** TypeScript, Express, `@google/genai` 1.46.0 (Veo 3.1 via Vertex), sharp, ffmpeg-static, Firebase Admin (Firestore/Storage), React 19.

## Global Constraints

- **Sem testes automatizados no repo** (CLAUDE.md): validação por task é `npm run lint` (tsc --noEmit); validação funcional é manual via `npm run dev`.
- Modelo permanece `veo-3.1-fast-generate-001`; `aspectRatio: '9:16'`; `generateAudio: false`; estrutura de 4 shots 8+8+8+6s inalterada.
- Débito/estorno de créditos, conexão HTTP aberta (Cloud Run), voz TTS `pt-BR-Neural2-B` e música única: **não mudar**.
- Todo texto de UI e prompts em pt-BR.
- No SDK, `referenceImages` fica em `config` e é **mutuamente exclusivo** com `image` — nunca passar os dois.
- Spec: `docs/superpowers/specs/2026-07-17-video-pipeline-parallel-fidelity-design.md`.

---

### Task 1: Shots em paralelo com imagem de referência (backend)

**Files:**
- Modify: `server/videoAgent.ts` (imports; constantes ~l.20–31; `cropToPortrait` l.95–107; `extractLastFrame` l.127–133; `runVideoJob` l.388–525)

**Interfaces:**
- Consumes: `runVeoOperation(ai, jobId, label, request)` (já existe, inalterada); `synthesizeNarration(text): Promise<Buffer>` (já existe, inalterada).
- Produces: documento Firestore `videoJobs/{jobId}` passa a ter `shotsDone: number` (substitui `currentShot`) e `step: 'shot' | 'concat' | 'tts' | 'mixing' | 'uploading'` nesta task (o vocabulário encolhe para `'shot' | 'post' | 'uploading'` na Task 2). Task 4 consome `shotsDone`.

- [ ] **Step 1: Atualizar import do SDK**

Em `server/videoAgent.ts` linha 2, trocar:

```ts
import { GoogleGenAI } from '@google/genai';
```

por:

```ts
import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
```

- [ ] **Step 2: Substituir constantes de crop e `cropToPortrait` por `resizeForReference`**

Remover as linhas 23–24 (`INPUT_IMAGE_W`/`INPUT_IMAGE_H`) e o comentário das linhas 20–21, substituindo por:

```ts
// Output video is always 9:16 (vertical/portrait) for marketplace product pages.
// The product photo is passed WHOLE (no crop) as a Veo reference image; the
// aspect ratio of the output is controlled by VIDEO_ASPECT_RATIO alone.
const VIDEO_ASPECT_RATIO = '9:16';
const REFERENCE_MAX_DIM = 1024;
```

Substituir a função `cropToPortrait` (linhas 95–107, incluindo o comentário) por:

```ts
// Downscales the product photo keeping its original aspect ratio — nothing is
// cropped — so the whole product stays visible in the Veo reference image.
async function resizeForReference(inputBuffer: Buffer): Promise<{ base64: string; mimeType: string }> {
  const resized = await sharp(inputBuffer)
    .resize({
      width: REFERENCE_MAX_DIM,
      height: REFERENCE_MAX_DIM,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}
```

- [ ] **Step 3: Remover `extractLastFrame`**

Apagar a função `extractLastFrame` e seu comentário (linhas 127–133). Ela deixa de ter chamadores após o Step 4.

- [ ] **Step 4: Reescrever a fase de geração dentro de `runVideoJob`**

Em `runVideoJob`, substituir o trecho que vai de `await jobRef.update({ status: 'processing', ... })` (linha 404) até o fim do `for` de shots (linha 459) — inclusive o bloco de TTS das linhas 467–475 mais abaixo — pelo código a seguir. O bloco de concat (linhas 461–465) e o de mix (linhas 477–481) permanecem como estão nesta task; apenas o TTS sai do meio deles (a narração já estará pronta em `narrationPath`):

```ts
    await jobRef.update({ status: 'processing', shotsDone: 0, totalShots: SHOTS.length, step: 'shot', updatedAt: now() });

    // The product photo goes WHOLE (no crop) as an ASSET reference image on
    // every shot, anchoring all four segments to the real product.
    const inputBuffer = Buffer.from(imageBase64, 'base64');
    const referenceImage = await resizeForReference(inputBuffer);
    console.log(`[video] reference image prepared (max ${REFERENCE_MAX_DIM}px) jobId=${jobId}`);

    const ai = getVeoClient();
    const styleLine = 'Formato: vertical 9:16, comercial e explicativo para página de produto, luz natural ou de estúdio, câmera fluida, realista, alta qualidade.';
    const rulesLine = 'As mãos devem MANIPULAR o produto de forma rica (girar, abrir, acionar, demonstrar o uso). Nenhuma pessoa falando para a câmera. Sem texto na tela. Sem efeitos artificiais.';
    const fidelityLine = 'FIDELIDADE OBRIGATÓRIA: o produto no vídeo deve ser IDÊNTICO à imagem de referência — mesmas cores, proporções, logotipos, materiais e acabamento. Nunca redesenhe, recolora ou altere o produto.';
    const negativePrompt = 'produto diferente da referência, cores alteradas, logotipo modificado, proporções distorcidas, texto na tela, legendas, marca d\'água, pessoa falando para a câmera, lip sync, distorções, baixa qualidade';

    // All four shots run in PARALLEL — each is anchored to the same product
    // reference image, so there is no frame-chaining dependency between them.
    // Transitions between shots are hard cuts (the shorts/TikTok standard).
    const generateShot = async (i: number): Promise<string> => {
      const shot = SHOTS[i];
      const shotScript = script[shot.key];
      const prompt = [
        `Cena: ${script.cena}`,
        `Ato (${shot.ato}, ~${shot.seconds}s): ${shotScript.acao}`,
        styleLine,
        rulesLine,
        fidelityLine,
      ].join('\n');

      console.log(`[video] shot ${i + 1}/${SHOTS.length} (${shot.key}) generate jobId=${jobId}`);
      const videoBytes = await runVeoOperation(ai, jobId, `shot#${i + 1}`, {
        model: VEO_MODEL,
        prompt,
        config: {
          numberOfVideos: 1,
          durationSeconds: shot.seconds,
          aspectRatio: VIDEO_ASPECT_RATIO,
          personGeneration: 'allow_adult',
          generateAudio: false,
          negativePrompt,
          referenceImages: [
            {
              image: { imageBytes: referenceImage.base64, mimeType: referenceImage.mimeType },
              referenceType: VideoGenerationReferenceType.ASSET,
            },
          ],
        },
      });

      const segPath = path.join(workDir, `seg${i}.mp4`);
      await fs.writeFile(segPath, Buffer.from(videoBytes, 'base64'));
      await jobRef.update({ shotsDone: FieldValue.increment(1), updatedAt: now() });
      return segPath;
    };

    // Narration only depends on the script, so TTS runs alongside the shots.
    const narrationText = SHOTS.map((s) => script[s.key].narracao.trim())
      .filter(Boolean)
      .join(' ');

    const [segmentPaths, narrationBuffer] = await Promise.all([
      Promise.all(SHOTS.map((_, i) => generateShot(i))),
      synthesizeNarration(narrationText),
    ]);
    const narrationPath = path.join(workDir, 'narration.mp3');
    await fs.writeFile(narrationPath, narrationBuffer);
    console.log(`[video] ${segmentPaths.length} shots + narration ready jobId=${jobId} chars=${narrationText.length}`);
```

Ajustes nos blocos que permanecem logo abaixo:
- No bloco de concat, trocar `await jobRef.update({ currentShot: SHOTS.length, step: 'concat', updatedAt: now() });` por `await jobRef.update({ step: 'concat', updatedAt: now() });`
- Apagar o bloco de TTS original (comentário "Build a single continuous narration..." até o `console.log` de "narration synthesized") — a narração já foi sintetizada acima.
- O bloco de mix (`step: 'mixing'` + `mixAudio`) fica como está.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add server/videoAgent.ts
git commit -m "feat(video): gera os 4 shots em paralelo ancorados na foto do produto via referenceImages"
```

---

### Task 2: Pós-produção em um passe único de ffmpeg (backend)

**Files:**
- Modify: `server/videoAgent.ts` (`concatVideos` + `mixAudio` → `assembleFinalVideo`; chamadas dentro de `runVideoJob`)

**Interfaces:**
- Consumes: `segmentPaths: string[]`, `narrationPath: string`, `MUSIC_PATH` e `workDir` produzidos na Task 1; `runFfmpeg(args)` existente.
- Produces: `assembleFinalVideo(segmentPaths: string[], narrationPath: string, musicPath: string, workDir: string, outPath: string): Promise<void>`; vocabulário final de `step` no Firestore: `'shot' | 'post' | 'uploading'` (Task 4 consome).

- [ ] **Step 1: Substituir `concatVideos` e `mixAudio` por `assembleFinalVideo`**

Remover as duas funções (e seus comentários) e adicionar no mesmo local:

```ts
// Concatenates the silent shots and mixes narration + looped background music
// in a SINGLE ffmpeg pass (one re-encode instead of two). Re-encodes video
// because shots are generated independently and may differ in timebase/SAR.
// Output length is bounded by the video (-shortest).
async function assembleFinalVideo(
  segmentPaths: string[],
  narrationPath: string,
  musicPath: string,
  workDir: string,
  outPath: string,
): Promise<void> {
  const listPath = path.join(workDir, 'concat.txt');
  const list = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list, 'utf8');
  await runFfmpeg([
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-stream_loop', '-1', '-i', musicPath,
    '-i', narrationPath,
    '-filter_complex',
    '[1:a]volume=0.14[mus];[2:a]volume=1.6[nar];[mus][nar]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]',
    '-map', '0:v', '-map', '[mix]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    outPath,
  ]);
}
```

- [ ] **Step 2: Atualizar `runVideoJob` para o passe único**

Substituir os dois blocos remanescentes de concat e mix (de `await jobRef.update({ step: 'concat', ... })` até o `console.log` de "audio mixed") por:

```ts
    // Single-pass post-production: concat + narration + music in one encode.
    await jobRef.update({ step: 'post', updatedAt: now() });
    const finalPath = path.join(workDir, 'final.mp4');
    await assembleFinalVideo(segmentPaths, narrationPath, MUSIC_PATH, workDir, finalPath);
    console.log(`[video] post-production done jobId=${jobId}`);
```

A variável `combinedPath` deixa de existir; `finalPath` segue sendo usada pelo upload logo abaixo.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add server/videoAgent.ts
git commit -m "perf(video): concat + mix de áudio em um único passe de ffmpeg"
```

---

### Task 3: Roteiro orientado a cortes secos (backend)

**Files:**
- Modify: `server/videoAgent.ts` (prompt dentro de `generateScript`, bloco "BOAS PRÁTICAS OBRIGATÓRIAS")

**Interfaces:**
- Consumes: nada de tasks anteriores (mudança independente de prompt).
- Produces: nada consumido por outras tasks — apenas melhora o roteiro gerado.

- [ ] **Step 1: Ajustar o item de estrutura no prompt**

No prompt de `generateScript`, trocar a linha:

```
- Estrutura de 4 shots encadeados (continuidade visual entre eles):
```

por:

```
- Estrutura de 4 shots INDEPENDENTES unidos por CORTES SECOS (padrão de shorts/TikTok): cada shot deve abrir já com o produto em quadro e funcionar sozinho, sem depender visualmente do shot anterior. A "cena" compartilhada garante a coerência de ambientação entre eles:
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add server/videoAgent.ts
git commit -m "feat(video): roteiro passa a pedir shots independentes com cortes secos"
```

---

### Task 4: Tipos e UI de progresso no frontend

**Files:**
- Modify: `src/services/videoService.ts` (tipos `VideoJobStep`/`VideoJob`, comentário de duração)
- Modify: `src/components/modals/VideoGenerationTab.tsx` (progresso, dots, textos de expectativa)

**Interfaces:**
- Consumes: documento Firestore com `shotsDone: number`, `totalShots: number`, `step: 'shot' | 'post' | 'uploading'` (Tasks 1–2).
- Produces: tipos `VideoJobStep = 'shot' | 'post' | 'uploading'` e `VideoJob.shotsDone?: number` usados pelo componente.

- [ ] **Step 1: Atualizar tipos em `src/services/videoService.ts`**

Trocar (linhas 23, 33–38):

```ts
export type VideoJobStep = 'shot' | 'concat' | 'tts' | 'mixing' | 'uploading';
```

por:

```ts
export type VideoJobStep = 'shot' | 'post' | 'uploading';
```

E na interface `VideoJob`, trocar:

```ts
  /** Index of the shot currently being generated (0-based), written by the server */
  currentShot?: number;
```

por:

```ts
  /** Number of shots already generated (shots run in parallel), written by the server */
  shotsDone?: number;
```

- [ ] **Step 2: Atualizar helpers de progresso em `VideoGenerationTab.tsx`**

Substituir `STEP_PROGRESS`, `STEP_LABELS` e `computeVideoProgress` (linhas 508–540) por:

```ts
const STEP_PROGRESS: Record<VideoJobStep, number> = {
  shot: 0,        // dynamic — computed from shotsDone
  post: 88,
  uploading: 96,
};

const STEP_LABELS: Record<VideoJobStep, string> = {
  shot: '',       // overridden below
  post: 'Montando vídeo, narração e música...',
  uploading: 'Enviando vídeo...',
};

function computeVideoProgress(job: VideoJob | null): { pct: number; label: string } {
  if (!job || job.status === 'queued') return { pct: 2, label: 'Aguardando na fila...' };
  if (job.status === 'done') return { pct: 100, label: 'Concluído!' };

  const step = job.step;
  const total = job.totalShots ?? 4;
  const done = job.shotsDone ?? 0;

  if (!step || step === 'shot') {
    // Shots run in parallel; the bar tracks how many finished (range 5-85%)
    const pct = Math.min(5 + Math.round((done / total) * 80), 85);
    const label = `${done} de ${total} trechos prontos — aguarde 2 a 5 min`;
    return { pct, label };
  }

  return { pct: STEP_PROGRESS[step], label: STEP_LABELS[step] };
}
```

- [ ] **Step 3: Atualizar `VideoProgressDisplay`**

No componente `VideoProgressDisplay`, trocar `const current = job?.currentShot ?? 0;` por `const done = job?.shotsDone ?? 0;` e o bloco dos dots por (todos os shots restantes pulsam, pois rodam em paralelo):

```tsx
        {/* Shot dots — shots run in parallel, unfinished ones pulse */}
        {isShot && job?.status === 'processing' && (
          <div className="flex justify-center gap-2 pt-1">
            {Array.from({ length: total }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-2.5 h-2.5 rounded-full transition-all',
                  i < done ? 'bg-violet-500' : 'bg-violet-300 animate-pulse',
                )}
              />
            ))}
          </div>
        )}
```

E o parágrafo de expectativa por:

```tsx
        <p className="text-xs text-slate-400 leading-relaxed">
          O Veo 3.1 gera os 4 trechos em paralelo e monta narração + música. Esse processo geralmente leva de 2 a 5 minutos.
          Você pode fechar essa janela — o vídeo ficará disponível aqui quando pronto.
        </p>
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/services/videoService.ts src/components/modals/VideoGenerationTab.tsx
git commit -m "feat(video): UI de progresso para geração paralela (shotsDone) e novos tempos"
```

---

### Task 5: Validação manual de ponta a ponta

**Files:** nenhum (validação).

**Interfaces:**
- Consumes: todo o pipeline das Tasks 1–4.
- Produces: confirmação dos critérios de sucesso da spec.

- [ ] **Step 1: Subir o dev server**

Run: `npm run dev`
Expected: Express + Vite na porta 3000, sem erros no console.

- [ ] **Step 2: Gerar um vídeo real**

No app: abrir um produto com descrição, título SEO e imagem ambientada → aba de vídeo → escolher imagem → gerar roteiro → aprovar → gerar vídeo. Cronometrar.

Verificar:
1. Logs do servidor mostram os 4 `shot N/4 ... generate` **antes** de qualquer `done` (paralelismo real).
2. Job termina em ~2–5 min (vs. 10–20 min).
3. Barra de progresso mostra "X de 4 trechos prontos" com dots pulsando.
4. No vídeo final: produto idêntico à foto nos 4 trechos (cores, logo, proporções); produto nunca cortado; narração + música presentes; duração ~30s; 9:16.

- [ ] **Step 3: Registrar resultado**

Reportar tempos e qualquer desvio observado (ex.: erro de quota em paralelo — se ocorrer `quota` nos logs, o retry/backoff deve segurar; anotar quantos retries houve).
