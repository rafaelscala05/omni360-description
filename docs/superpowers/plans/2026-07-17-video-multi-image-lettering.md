# Vídeo Promocional: Referências por Shot + Lettering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada um dos 4 shots do vídeo usa a imagem ambientada mais coerente como referência, e a narração de cada shot aparece como legenda na tela (CTA final em destaque), deixando o vídeo com cara de promocional.

**Architecture:** O frontend monta um array `shotImageUrls` (1 imagem por shot, mapeada por sentido com fallback) e o envia ao backend, que usa `shotImageUrls[i]` como referência ASSET em `generateShot(i)`. O lettering é 100% pós-produção: `assembleFinalVideo` ganha uma cadeia `drawtext` no `-filter_complex`, temporizada por shot (janelas de 8s), usando uma fonte OFL (Anton) empacotada. O Veo continua proibido de desenhar texto.

**Tech Stack:** TypeScript, Express, `@google/genai` 1.46.0 (Veo 3.1 via Vertex), ffmpeg-static, sharp, Firebase Admin, React 19.

## Global Constraints

- **Sem testes automatizados no repo** (CLAUDE.md): a verificação por task é `npm run lint` (tsc --noEmit); a validação funcional é manual via geração real.
- Baseline de lint: `npm run lint` já tem **5 erros PRÉ-EXISTENTES não relacionados** (src/App.tsx 655/1375; src/components/modals/ProductEditModal.tsx 313/425/462). "Lint passa" = só esses 5, nenhum NOVO em `server/videoAgent.ts`, `src/services/videoService.ts`, `src/components/modals/VideoGenerationTab.tsx`.
- Cada shot dura **8s** (o modo `reference_to_video` do Veo só aceita 8s); há 4 shots; janela de tempo do shot `i` no vídeo concatenado = `[i*8, i*8+8]` segundos.
- `negativePrompt` do Veo **continua** com "texto na tela" — o Veo não desenha texto; o lettering é só no ffmpeg.
- Ordem canônica dos shots (`SHOTS` em videoAgent.ts / `SHOT_FIELDS` no frontend): `inicio`, `meioDemonstracao`, `meioBeneficios`, `fim`.
- Todo texto de UI e prompts em pt-BR.
- Fonte OFL Anton (~167 KB) commitada em `server/assets/fonts/Anton-Regular.ttf`; caminho fixo `FONT_PATH`.
- Spec: `docs/superpowers/specs/2026-07-17-video-multi-image-lettering-design.md`.
- Branch base atual: `main` @ `d15a3f7`. Trabalhar em branch de feature.

---

### Task 1: Referências por shot (backend + frontend + tipos)

**Files:**
- Modify: `server/videoAgent.ts` (rota `start-job`; assinatura e corpo de `runVideoJob`; `generateShot`)
- Modify: `src/services/videoService.ts` (`startVideoJob` params)
- Modify: `src/components/modals/VideoGenerationTab.tsx` (mapeamento, etapa de imagem, `handleStartJob`)

**Interfaces:**
- Consumes: `fetchImageAsBase64(url): Promise<{ base64: string; mimeType: string }>`, `resizeForReference(buf): Promise<{ base64; mimeType }>`, `SHOTS` (array de 4), `VideoScript` — todos já existentes.
- Produces:
  - Frontend `buildShotImageUrls(product: Product): string[]` (comprimento 4, ordem canônica).
  - `startVideoJob(idToken, { productId, productName, script, shotImageUrls: string[] }): Promise<string>`.
  - Backend `runVideoJob(uid, jobId, productId, script, shotImages: Array<{ base64: string; mimeType: string }>, creditCost, meta)`.

- [ ] **Step 1: Trocar o param de `startVideoJob` no serviço**

Em `src/services/videoService.ts`, na função `startVideoJob`, trocar o tipo dos params e o corpo:

```ts
export async function startVideoJob(
  idToken: string,
  params: {
    productId: string;
    productName: string;
    script: VideoScript;
    shotImageUrls: string[];
  },
): Promise<string> {
  const res = await fetch('/api/video/start-job', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Erro ${res.status}`);
  }
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const data = JSON.parse(new TextDecoder().decode(value ?? new Uint8Array()));
  return (data as any).jobId as string;
}
```

- [ ] **Step 2: Mapeamento de imagens no frontend**

Em `src/components/modals/VideoGenerationTab.tsx`, adicionar (perto de `SHOT_FIELDS`) a função de mapeamento. Ela devolve 4 URLs na ordem canônica, com fallback:

```ts
// Monta 1 imagem de referência por shot, na ordem canônica dos SHOT_FIELDS,
// escolhendo a cena ambientada mais coerente com fallback gracioso.
function buildShotImageUrls(product: Product): string[] {
  const ambient = product._ambientImages ?? [];
  const original = product._selectedImage ?? '';
  const available = [original, ...ambient].filter(Boolean);
  const firstAvailable = available[0] ?? '';
  const pick = (preferred?: string) => preferred || original || firstAvailable;
  // inicio, meioDemonstracao, meioBeneficios, fim
  return [
    pick(ambient[0]), // Hook → Produto Ambientado
    pick(ambient[1]), // Demonstração → Produto em Uso
    pick(ambient[2]), // Benefícios → Escala e Tamanho
    pick(ambient[0]), // CTA → Produto Ambientado
  ];
}
```

- [ ] **Step 3: Imagem de contexto do roteiro + envio do array**

Ainda em `VideoGenerationTab.tsx`:

1. `handleGenerateScript` deixa de depender de `selectedImage`; usa a imagem primária de contexto:

```ts
  async function handleGenerateScript() {
    const primaryImage = product._selectedImage ?? product._ambientImages?.[0] ?? null;
    if (!primaryImage) return;
    setScriptLoading(true);
    setScriptError(null);
    try {
      const token = await getIdToken();
      const result = await generateVideoScript(token, {
        description: product['Descrição complementar'] ?? product['Descrição'] ?? '',
        brand: product['Marca'] ?? '',
        imageUrl: primaryImage,
        productName: product['Título SEO'] ?? product['Descrição'] ?? '',
        category: product['Categoria'] ?? (product.categoryPath?.join(' > ') ?? ''),
        attributes: collectAttributes(),
      });
      setScript(result);
      setStage('script');
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Erro ao gerar roteiro');
    } finally {
      setScriptLoading(false);
    }
  }
```

2. `handleStartJob` envia `shotImageUrls`:

```ts
  async function handleStartJob() {
    if (!script) return;
    setJobLoading(true);
    setJobError(null);
    try {
      const token = await getIdToken();
      const id = await startVideoJob(token, {
        productId: product._id,
        productName: product['Descrição'] ?? product._id,
        script,
        shotImageUrls: buildShotImageUrls(product),
      });
      setJobId(id);
      onVideoJobStarted?.(product._id, id);
      setStage('generate');
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Erro ao iniciar geração');
      setJobLoading(false);
    }
  }
```

- [ ] **Step 4: Etapa "Imagens do vídeo" (read-only, mapeamento)**

Substituir o bloco `{stage === 'select-image' && ( ... )}` (a seção inteira de seleção de imagem única) por uma exibição read-only do mapeamento shot→cena. Usa `buildShotImageUrls` + os títulos de `SHOT_FIELDS`:

```tsx
      {stage === 'select-image' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-violet-600" />
            Imagens do vídeo
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            Cada trecho do vídeo usa a cena mais coerente como referência. As imagens são
            recortadas no formato vertical (9:16). A narração de cada trecho aparece como
            legenda na tela.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {SHOT_FIELDS.map(({ key, title, badge }, i) => {
              const url = buildShotImageUrls(product)[i];
              return (
                <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="relative aspect-square bg-slate-100">
                    {url
                      ? <img src={url} alt={title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-300"><ImageIcon className="w-6 h-6" /></div>}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-violet-600 text-white text-[11px] font-bold">
                      {badge}
                    </span>
                  </div>
                  <div className="px-2 py-2">
                    <p className="text-[11px] font-bold text-slate-700 leading-tight">{title}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setStage('prereqs')}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={scriptLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {scriptLoading ? 'Gerando roteiro...' : 'Gerar Roteiro com IA'}
            </button>
          </div>
          {scriptError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {scriptError}
            </p>
          )}
        </section>
      )}
```

- [ ] **Step 5: Remover o estado `selectedImage` de escolha única**

O estado `const [selectedImage, setSelectedImage] = useState<string | null>(null);` e todas as referências restantes a `selectedImage` (a lista `allImages`, o `poster={selectedImage ?? undefined}` no player, e o reset em "Gerar Novo Vídeo") devem ser ajustados:

1. Remover a declaração de `selectedImage`/`setSelectedImage` e a constante `allImages` (não é mais usada).
2. No player de vídeo (stage `generate`, `job.status === 'done'`), trocar `poster={selectedImage ?? undefined}` por:

```tsx
                  poster={(product._selectedImage ?? product._ambientImages?.[0]) ?? undefined}
```

3. No botão "Gerar Novo Vídeo", remover a linha `setSelectedImage(null);` do handler de reset; manter `setStage('select-image')`, `setJob(null)`, `setJobId(null)`, `setScript(null)`, `setJobLoading(false)`.
4. No botão "Tentar Novamente" (stage error), o reset não referencia `selectedImage` — deixar como está.

- [ ] **Step 6: Backend — rota `start-job` recebe o array e busca as imagens**

Em `server/videoAgent.ts`, substituir o corpo da rota `app.post('/api/video/start-job', ...)` na parte de leitura do body e busca da imagem. Trocar o destructuring e a validação:

```ts
      const { productId, productName, script, shotImageUrls } = req.body as {
        productId: string;
        productName: string;
        script: VideoScript;
        shotImageUrls: string[];
      };
      if (!productId || !script || !Array.isArray(shotImageUrls) || shotImageUrls.length !== SHOTS.length) {
        return res.status(400).json({ error: `productId, script e shotImageUrls (${SHOTS.length} imagens) são obrigatórios` });
      }
```

E trocar a busca única `const { base64, mimeType } = await fetchImageAsBase64(imageUrl);` por uma busca deduplicada, montando o array na ordem dos shots:

```ts
      // Fetch each shot's reference image, deduplicating repeated URLs so the
      // same scene driving two shots is only downloaded once.
      const uniqueUrls = Array.from(new Set(shotImageUrls));
      const fetched = new Map<string, { base64: string; mimeType: string }>();
      await Promise.all(uniqueUrls.map(async (url) => {
        fetched.set(url, await fetchImageAsBase64(url));
      }));
      const shotImages = shotImageUrls.map((url) => fetched.get(url)!);
```

E a chamada final passa `shotImages` no lugar de `base64, mimeType`:

```ts
      try {
        await runVideoJob(decoded.uid, jobId, productId, script, shotImages, creditCost, creditMeta);
      } finally {
        res.end();
      }
```

- [ ] **Step 7: Backend — `runVideoJob` usa imagem por shot**

Trocar a assinatura de `runVideoJob`:

```ts
async function runVideoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: VideoScript,
  shotImages: Array<{ base64: string; mimeType: string }>,
  creditCost: number,
  meta: { productName?: string; userName?: string } = {},
): Promise<void> {
```

Remover a preparação única da imagem (as linhas que criam `inputBuffer`/`referenceImage` a partir de `imageBase64`). Dentro de `generateShot`, preparar a referência do shot `i` a partir de `shotImages[i]`:

```ts
    const generateShot = async (i: number): Promise<string> => {
      const shot = SHOTS[i];
      const shotScript = script[shot.key];
      const src = shotImages[i];
      const referenceImage = await resizeForReference(Buffer.from(src.base64, 'base64'));
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
```

Ajustar o comentário acima de `generateShot` que dizia "anchored to the same product reference image" para refletir que cada shot usa sua própria imagem.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: apenas os 5 erros baseline; nenhum novo.

- [ ] **Step 9: Commit**

```bash
git add server/videoAgent.ts src/services/videoService.ts src/components/modals/VideoGenerationTab.tsx
git commit -m "feat(video): uma imagem de referência por shot, mapeada por sentido"
```

---

### Task 2: Fonte OFL empacotada

**Files:**
- Create: `server/assets/fonts/Anton-Regular.ttf` (binário, OFL)

**Interfaces:**
- Produces: o arquivo de fonte em caminho fixo, consumido pela Task 3 via `FONT_PATH`.

- [ ] **Step 1: Baixar a fonte**

```bash
mkdir -p server/assets/fonts
curl -sL -o server/assets/fonts/Anton-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf"
```

- [ ] **Step 2: Validar o arquivo**

Run: `file server/assets/fonts/Anton-Regular.ttf && ls -l server/assets/fonts/Anton-Regular.ttf`
Expected: `TrueType Font data ...`, tamanho ~167 KB (aprox. 150.000–180.000 bytes). Se o `file` disser HTML/ASCII, o download falhou (redirect não seguido) — refazer com `-L`.

- [ ] **Step 3: Commit**

```bash
git add server/assets/fonts/Anton-Regular.ttf
git commit -m "chore(video): empacota fonte Anton (OFL) para lettering"
```

---

### Task 3: Lettering no `assembleFinalVideo`

**Files:**
- Modify: `server/videoAgent.ts` (constantes de fonte; `wrapCaption`; `assembleFinalVideo`; chamada em `runVideoJob`)

**Interfaces:**
- Consumes: `server/assets/fonts/Anton-Regular.ttf` (Task 2); `SHOTS` (duração 8s por shot); `runFfmpeg(args): Promise<void>`; `script` em `runVideoJob`.
- Produces: `wrapCaption(text: string, maxCharsPerLine?: number): string`; nova assinatura `assembleFinalVideo(segmentPaths, narrationPath, musicPath, workDir, outPath, captions: string[])`.

- [ ] **Step 1: Constantes de fonte**

Perto de `MUSIC_PATH` em `server/videoAgent.ts`, adicionar:

```ts
const FONT_PATH = path.join(process.cwd(), 'server', 'assets', 'fonts', 'Anton-Regular.ttf');
```

- [ ] **Step 2: Helper `wrapCaption`**

Adicionar (perto dos outros helpers de ffmpeg):

```ts
// Quebra uma legenda em linhas curtas (para caber no quadro 9:16) inserindo \n.
// Greedy por palavras; não corta palavras no meio.
function wrapCaption(text: string, maxCharsPerLine = 24): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
```

- [ ] **Step 3: `assembleFinalVideo` monta a cadeia `drawtext`**

Substituir a função `assembleFinalVideo` inteira por esta versão, que aceita `captions` e adiciona o vídeo filtrado. A janela de cada shot é `[i*8, i*8+8]`; o último shot (índice `captions.length - 1`) é o CTA em destaque. As legendas vão em `textfile=` (arquivos `cap{i}.txt` no `workDir`), evitando escape:

```ts
async function assembleFinalVideo(
  segmentPaths: string[],
  narrationPath: string,
  musicPath: string,
  workDir: string,
  outPath: string,
  captions: string[],
): Promise<void> {
  const listPath = path.join(workDir, 'concat.txt');
  const list = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list, 'utf8');

  const SHOT_SECONDS = 8;
  const lastIndex = captions.length - 1;

  // Caminhos vão para dentro do filtergraph; escapa `:` e `\` (mkdtemp não gera
  // caminhos com vírgula). Vírgulas DENTRO do filtro (ex.: between(t,a,b)) são
  // escapadas com `\,` porque a vírgula separa filtros no filter_complex.
  const esc = (p: string) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  const fontArg = esc(FONT_PATH);

  // Escreve cada legenda quebrada em um arquivo e monta um drawtext por shot,
  // temporizado à janela do shot. O último shot é o CTA (maior + caixa âmbar).
  const drawParts: string[] = [];
  for (let i = 0; i < captions.length; i++) {
    const text = wrapCaption(captions[i] ?? '');
    if (!text) continue;
    const capPath = path.join(workDir, `cap${i}.txt`);
    await fs.writeFile(capPath, text, 'utf8');
    const textArg = esc(capPath);
    const start = i * SHOT_SECONDS;
    const end = start + SHOT_SECONDS;
    const enable = `enable=between(t\\,${start}\\,${end})`;
    if (i === lastIndex) {
      drawParts.push(
        `drawtext=fontfile=${fontArg}:textfile=${textArg}:fontsize=64:fontcolor=white:box=1:boxcolor=0xF59E0B@0.85:boxborderw=24:line_spacing=8:x=(w-tw)/2:y=(h-th)/2:${enable}`,
      );
    } else {
      drawParts.push(
        `drawtext=fontfile=${fontArg}:textfile=${textArg}:fontsize=48:fontcolor=white:borderw=6:bordercolor=black@0.9:line_spacing=6:x=(w-tw)/2:y=h*0.72:${enable}`,
      );
    }
  }

  const videoChain = drawParts.length > 0 ? `[0:v]${drawParts.join(',')}[v]` : `[0:v]copy[v]`;
  const filterComplex = `${videoChain};[1:a]volume=0.14[mus];[2:a]volume=1.6[nar];[mus][nar]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`;

  await runFfmpeg([
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-stream_loop', '-1', '-i', musicPath,
    '-i', narrationPath,
    '-filter_complex', filterComplex,
    '-map', '[v]', '-map', '[mix]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    outPath,
  ]);
}
```

Notas: `fontfile` e `textfile` evitam o inferno de escape do `text=` inline. O `\\,` no JS vira `\,` no argumento real, escapando as vírgulas do `between(...)` para o parser do filtergraph. O `filter_complex` é passado como um único argv (sem shell), então não há reinterpretação de aspas pelo shell.

- [ ] **Step 4: `runVideoJob` passa `captions`**

Na chamada de `assembleFinalVideo` dentro de `runVideoJob`, passar as narrações na ordem dos shots:

```ts
    const captions = SHOTS.map((s) => script[s.key].narracao);
    await assembleFinalVideo(segmentPaths, narrationPath, MUSIC_PATH, finalPath, captions);
```

Atenção à ORDEM dos parâmetros: a assinatura é `(segmentPaths, narrationPath, musicPath, workDir, outPath, captions)`. A chamada atual é `assembleFinalVideo(segmentPaths, narrationPath, MUSIC_PATH, workDir, finalPath)`. Adicionar `captions` como 6º argumento, mantendo `workDir` como 4º:

```ts
    const captions = SHOTS.map((s) => script[s.key].narracao);
    await assembleFinalVideo(segmentPaths, narrationPath, MUSIC_PATH, workDir, finalPath, captions);
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: apenas os 5 erros baseline; nenhum novo.

- [ ] **Step 6: Verificação de sintaxe do ffmpeg (sem Veo)**

Prova que a cadeia `drawtext` (textfile + `enable between` + caixa do CTA) é válida, usando clipes de cor sólida no lugar dos shots do Veo. Como `assembleFinalVideo`/`wrapCaption` não são exportadas, adicione `export` a ambas **temporariamente**, rode o teste, e **reverta antes do commit**.

1. Adicionar `export` a `wrapCaption` e `assembleFinalVideo`.
2. Criar `/tmp/letter-test.ts`:

```ts
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { assembleFinalVideo } from '/Users/rafaelscala/omni360-description/server/videoAgent.ts';

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-600)))));
  });
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lt-'));
  const segs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const seg = path.join(dir, `seg${i}.mp4`);
    await run(['-y', '-f', 'lavfi', '-i', 'color=c=navy:s=720x1280:d=8', '-pix_fmt', 'yuv420p', seg]);
    segs.push(seg);
  }
  const nar = path.join(dir, 'nar.mp3');
  const mus = path.join(dir, 'mus.mp3');
  await run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '32', nar]);
  await run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '5', mus]);

  const out = path.join(dir, 'final.mp4');
  await assembleFinalVideo(segs, nar, mus, dir, out, [
    'Legenda do hook aqui', 'Produto em uso real',
    'Ótimo em qualquer espaço', 'Garanta o seu agora',
  ]);
  const st = await fs.stat(out);
  console.log('OK final.mp4 bytes=', st.size, st.size > 100000 ? 'PASS' : 'FALHOU (muito pequeno)');
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
```

3. Rodar: `npx tsx /tmp/letter-test.ts`
   Expected: imprime `OK final.mp4 bytes= <n> PASS` (n > 100000), sem erro do ffmpeg.
4. Reverter os `export` de `wrapCaption`/`assembleFinalVideo`; `rm /tmp/letter-test.ts`.
5. `npm run lint` de novo para confirmar que a reversão não deixou nada quebrado (só os 5 erros baseline).

- [ ] **Step 7: Commit**

```bash
git add server/videoAgent.ts
git commit -m "feat(video): legendas por shot + CTA em destaque no passe de ffmpeg"
```

---

### Task 4: Validação manual de ponta a ponta

**Files:** nenhum (validação).

**Interfaces:**
- Consumes: pipeline completo das Tasks 1–3.

- [ ] **Step 1: Subir o dev server**

Run: `npm run dev`
Expected: Express + Vite na porta 3000, sem erros.

- [ ] **Step 2: Gerar um vídeo real**

Produto com 3 imagens ambientadas + descrição + título SEO. Aba de vídeo → "Imagens do vídeo" mostra os 4 cards com as cenas mapeadas → Gerar Roteiro → Aprovar e Gerar.

Verificar no vídeo final:
1. Hook usa a cena "Produto Ambientado"; Demonstração usa "Produto em Uso"; Benefícios usa "Escala e Tamanho".
2. Legenda de cada trecho aparece sincronizada (terço inferior), com o texto da narração daquele trecho.
3. CTA final aparece em destaque (maior, caixa âmbar, centralizado).
4. Produto fiel às imagens; ~32s; 9:16.

- [ ] **Step 3: Registrar resultado**

Reportar se o mapeamento e as legendas apareceram como esperado e quaisquer ajustes de estilo (tamanho de fonte, posição, cor) desejados.
