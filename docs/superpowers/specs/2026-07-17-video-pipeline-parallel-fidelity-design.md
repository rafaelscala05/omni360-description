# Pipeline de vídeo paralelo com fidelidade por imagem de referência

**Data:** 2026-07-17
**Status:** Aprovado
**Arquivos afetados:** `server/videoAgent.ts`, `src/components/modals/VideoGenerationTab.tsx`, `src/services/videoService.ts`

## Problema

O pipeline atual de geração de vídeo de produto (Veo 3.1 Fast, 4 shots de 8+8+8+6s) tem duas falhas estruturais:

1. **Lentidão (10–20 min por vídeo).** Os shots são gerados sequencialmente porque cada shot é semeado pelo último frame do shot anterior. O tempo do job é a soma dos 4 shots (2–5 min cada).
2. **Perda de fidelidade ao produto.** Apenas o shot 1 vê a foto real do produto. Os shots 2–4 partem de frames gerados pela IA, acumulando deriva de cores, logotipo, proporções e materiais. Além disso, o pré-processamento recorta a imagem em 9:16 com `cover` centrado, podendo cortar partes do produto antes mesmo da geração.

## Solução

Trocar o encadeamento seed→último-frame pelo modo **imagem de referência** do Veo 3.1 (`referenceImages` com `referenceType: 'asset'`, suportado pelo `@google/genai` 1.46.0 instalado). Todos os shots ficam ancorados na foto real do produto, o que:

- elimina a dependência sequencial → os 4 shots rodam em **paralelo** (`Promise.all`); o job cai para o tempo do shot mais lento (~2–5 min);
- garante fidelidade ao produto em 100% dos trechos (todos veem a foto real);
- elimina o crop: no Veo 3.1, referência de asset e seed de primeiro frame são mutuamente exclusivos, e a referência não dita enquadramento (o `aspectRatio: '9:16'` continua controlando o formato). A foto vai **inteira**, apenas redimensionada (~1024px no lado maior) para reduzir payload.

Transições entre shots passam a ser cortes secos — o padrão de shorts para e-commerce (TikTok, Mercado Livre).

## Mudanças detalhadas

### `server/videoAgent.ts`

1. **Geração paralela dos shots.** O loop sequencial em `runVideoJob` vira um `Promise.all` sobre os 4 shots. Cada chamada a `runVeoOperation` usa:
   - `referenceImages: [{ image: { imageBytes, mimeType }, referenceType: 'asset' }]` no lugar de `image` (seed);
   - o mesmo retry/backoff por shot já existente (`VEO_MAX_RETRIES`, delays 30/60/120s);
   - falha definitiva de qualquer shot rejeita o `Promise.all` e derruba o job (com estorno de créditos, como hoje).
2. **Remoções:** `cropToPortrait`, `extractLastFrame` e as constantes `INPUT_IMAGE_W`/`INPUT_IMAGE_H`. Entra um `resizeForReference` (sharp, `fit: 'inside'`, lado maior ≤ 1024, JPEG q90) que preserva a proporção original.
3. **Prompt de fidelidade por shot.** Acrescentar ao prompt de cada shot: o produto no vídeo deve ser IDÊNTICO à imagem de referência — mesmas cores, proporções, logotipos, materiais e acabamento; nunca redesenhar, recolorir ou alterar o produto. `negativePrompt` ganha: "produto diferente da referência, cores alteradas, logotipo modificado, proporções distorcidas".
4. **TTS em paralelo.** `synthesizeNarration` entra no mesmo `Promise.all` dos shots (a narração depende só do roteiro).
5. **Pós-produção em 1 passe.** `concatVideos` + `mixAudio` fundem-se em um único comando ffmpeg: `concat` demuxer para os vídeos + `filter_complex` de áudio (música em loop a 0.14 + narração a 1.6, `amix`), `-preset veryfast -crf 20 -pix_fmt yuv420p`, `-shortest`. Elimina um re-encode completo.
6. **Progresso no Firestore.** Com paralelismo, `currentShot` deixa de existir; entra `shotsDone` (contador incrementado conforme cada shot conclui, via `FieldValue.increment(1)`). `totalShots` permanece. A sequência de `step` vira: `shot` → `post` (concat+mix único) → `uploading`. Os steps `concat`/`tts`/`mixing` saem do vocabulário.

### Prompt do roteiro (função `generateScript`)

7. Instrução nova: cada trecho deve funcionar como cena independente com corte seco (estilo shorts) — abrir já com o produto em quadro, sem depender visualmente do trecho anterior. A `cena` compartilhada continua garantindo coerência de ambientação.

### `src/services/videoService.ts`

8. Tipos atualizados: `VideoJobStep = 'shot' | 'post' | 'uploading'`; `VideoJob.currentShot` substituído por `shotsDone`.

### `src/components/modals/VideoGenerationTab.tsx`

9. Progresso: barra e dots passam a refletir `shotsDone/totalShots` ("X de 4 trechos prontos"); dots deixam de indicar ordem e indicam quantidade concluída.
10. Textos de expectativa: "10 a 20 minutos" → "2 a 5 minutos"; menção a geração sequencial vira "os 4 trechos são gerados em paralelo".

## O que NÃO muda

- Modelo `veo-3.1-fast-generate-001`, resolução/formatos, `aspectRatio: '9:16'`, `generateAudio: false`.
- Estrutura de 4 atos (Início/Meio/Meio/Fim, 8+8+8+6s) e o fluxo de telas do frontend.
- Débito/estorno de créditos, conexão HTTP mantida aberta para o Cloud Run, música de fundo única, voz TTS.

## Riscos e mitigação

- **Quota do Veo em paralelo:** 4 chamadas simultâneas podem esbarrar em limite de operações concorrentes do projeto. O retry existente (padrões "quota/high load", backoff 30/60/120s) já cobre; se a quota real for < 4, os shots excedentes apenas esperam e tentam de novo — pior caso degrada para o tempo sequencial atual.
- **Corte seco perceptível:** aceito por decisão de design (padrão do formato shorts). O prompt do roteiro garante ambientação coerente entre trechos.

## Critérios de sucesso

- Job completo em ~2–5 min em condições normais (vs. 10–20 min).
- Produto visualmente idêntico à foto de referência nos 4 trechos (inspeção manual).
- Nenhuma parte do produto cortada por pré-processamento.
- `npm run lint` limpo; fluxo validado manualmente via dev server.
