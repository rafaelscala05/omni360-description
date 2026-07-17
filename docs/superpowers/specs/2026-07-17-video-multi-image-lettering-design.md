# Vídeo promocional: referências por shot + lettering

**Data:** 2026-07-17
**Status:** Aprovado
**Arquivos afetados:** `server/videoAgent.ts`, `server/assets/fonts/Anton-Regular.ttf` (novo), `src/services/videoService.ts`, `src/components/modals/VideoGenerationTab.tsx`

## Problema

Após o pipeline paralelo, os 4 shots do vídeo usam **uma única imagem** de referência — mesmo quando o produto tem 3 imagens ambientadas com papéis distintos ("Produto Ambientado", "Produto em Uso", "Escala e Tamanho"). Isso desperdiça o contexto das cenas e deixa o vídeo visualmente monótono. Além disso, o vídeo não tem **texto na tela**, então não parece um vídeo promocional (a maioria dos usuários de shorts assiste sem som).

## Solução

Duas mudanças que, juntas, transformam o vídeo em promocional:

1. **Uma imagem de referência por shot, mapeada por sentido.** O frontend monta um array ordenado `shotImageUrls` (1 por shot) a partir das imagens disponíveis; cada `generateShot(i)` usa `shotImageUrls[i]` como referência ASSET no Veo.
2. **Lettering na pós-produção via ffmpeg `drawtext`.** No passe único do `assembleFinalVideo`, sobrepõe-se a `narracao` de cada shot como legenda temporizada, com o CTA final em destaque. Fonte OFL empacotada. O Veo continua **proibido de desenhar texto** (o texto nítido entra só no ffmpeg).

## Mudanças detalhadas

### Mapeamento imagem→shot

Ordem dos shots (já em `SHOTS`): `inicio`, `meioDemonstracao`, `meioBeneficios`, `fim`.

Mapeamento preferido (índices de `_ambientImages`), com fallback gracioso:

| Shot | Preferência | Fallback (nesta ordem) |
|------|-------------|------------------------|
| inicio | ambient[0] (Produto Ambientado) | selectedImage → 1ª imagem disponível |
| meioDemonstracao | ambient[1] (Produto em Uso) | selectedImage → 1ª disponível |
| meioBeneficios | ambient[2] (Escala e Tamanho) | selectedImage → 1ª disponível |
| fim | ambient[0] (Produto Ambientado) | selectedImage → 1ª disponível |

Regra de fallback: se a imagem preferida do shot não existir, usar `_selectedImage` (original); se também faltar, usar a primeira URL disponível na lista `[selectedImage, ...ambientImages]`. Como os pré-requisitos exigem ≥1 imagem ambientada, sempre há pelo menos uma URL — o array nunca fica vazio nem com buracos.

### `src/components/modals/VideoGenerationTab.tsx`

- A etapa `select-image` deixa de ser seleção de 1 imagem e passa a **exibir o mapeamento** (read-only): 4 cards "Shot → cena", cada um mostrando a miniatura da imagem que o dirige. Um aviso curto informa que **a narração de cada trecho aparece como legenda no vídeo**.
- Nova função `buildShotImageUrls(product): string[]` implementa a tabela acima (comprimento = `SHOT_FIELDS.length`).
- `handleGenerateScript` continua usando **1 imagem de contexto** para o roteiro: a primeira disponível (`_selectedImage ?? _ambientImages[0]`).
- `handleStartJob` envia `shotImageUrls` (array) em vez de `imageUrl`.
- Remoção do estado `selectedImage` de escolha única; o "primary" para roteiro/poster passa a ser derivado.

### `src/services/videoService.ts`

- `startVideoJob` params: trocar `imageUrl: string` por `shotImageUrls: string[]`.

### `server/videoAgent.ts` — referências por shot

- Rota `start-job`: aceitar `shotImageUrls: string[]` (validar `Array.isArray` e comprimento === `SHOTS.length`). Buscar cada URL via `fetchImageAsBase64`, **deduplicando** URLs repetidas (a mesma cena pode dirigir 2 shots) para não baixar duas vezes. Passar um array `shotImages: Array<{ base64; mimeType }>` para `runVideoJob`.
- `runVideoJob`: assinatura troca `imageBase64: string, mimeType: string` por `shotImages: Array<{ base64: string; mimeType: string }>`. Dentro, cada `generateShot(i)` faz `resizeForReference` da imagem `shotImages[i]` e a usa em `referenceImages`. (Remover a preparação única de `referenceImage`.)
- Rota `generate-script`: **inalterada** (continua recebendo `imageUrl` único de contexto).

### `server/videoAgent.ts` — lettering

- Novo asset: `server/assets/fonts/Anton-Regular.ttf` (fonte OFL, peso display pesado; renderiza "negrito" por natureza, sem depender de fontes do sistema no Cloud Run/Linux). Constante `FONT_PATH`.
- Novo helper `wrapCaption(text: string, maxCharsPerLine = 24): string` — quebra a narração em linhas curtas inserindo `\n`, para caber no 9:16.
- `assembleFinalVideo` ganha um parâmetro `captions: string[]` (a `narracao` de cada shot, na ordem dos segmentos) e passa a montar uma cadeia `drawtext` no vídeo dentro do `-filter_complex`:
  - Para cada shot `i` (janela de tempo `[i*8, i*8+8]`s no vídeo concatenado):
    - Escreve a legenda quebrada em `cap{i}.txt` no `workDir` e referencia via `textfile=` (evita escape de `:'%\`).
    - Legendas dos shots 0–2: fonte Anton, `fontsize≈48`, `fontcolor=white`, `borderw=6:bordercolor=black@0.9`, posição terço inferior (`x=(w-tw)/2:y=h*0.72`), `enable='between(t,ini,fim)'`.
    - Shot final (CTA): destaque — `fontsize≈64`, `fontcolor=white`, `box=1:boxcolor=0xF59E0B@0.85:boxborderw=24` (âmbar vibrante), centralizado (`y=(h-th)/2`), `enable='between(t,ini,fim)'`.
  - A cadeia encadeia os `drawtext` em `[0:v]…[v]`; o áudio segue com o `amix` existente em `[mix]`. Mapear `-map '[v]' -map '[mix]'`. Demais flags de encode inalteradas.
- `runVideoJob` passa `captions = SHOTS.map((s) => script[s.key].narracao)` para `assembleFinalVideo`.

### Fonte — obtenção (passo do plano, não runtime)

Baixar no build/dev uma vez e commitar o binário:
`curl -sL -o server/assets/fonts/Anton-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf"`
(OFL 1.1 — redistribuível; ~167 KB.)

## O que NÃO muda

- Modelo Veo, 4 shots de 8s, `aspectRatio 9:16`, `generateAudio: false`, paralelismo, TTS em paralelo, passe único de ffmpeg (agora com vídeo filtrado além do áudio).
- `negativePrompt` continua proibindo "texto na tela" — o Veo não deve desenhar texto; o lettering é 100% pós-produção.
- Débito/estorno de créditos, upload, progresso (`shotsDone`/`step`).
- Geração e edição do roteiro: o usuário edita a `narracao` na tela de revisão e isso **também** controla as legendas (mesmo texto).

## Riscos e mitigação

- **Legenda longa estourando o quadro:** `wrapCaption` limita a ~24 chars/linha; a narração já é limitada a ~16 palavras por shot no prompt. Pior caso, 3 linhas — ainda cabe no terço inferior 9:16.
- **Imagem ausente para um slot:** fallback gracioso garante URL válida por shot; nunca há buraco.
- **`data:` URLs vs https:** `fetchImageAsBase64` já lida com a imagem selecionada hoje; o mesmo helper serve para todas.
- **Fonte não encontrada em runtime:** o binário é commitado no repo; `FONT_PATH` aponta para ele. Se faltar, o ffmpeg falha o job (com estorno) — sem corrupção silenciosa.

## Critérios de sucesso

- Cada shot exibe visualmente a cena da sua imagem mapeada (inspeção manual: Hook=ambientado, Demonstração=em uso, Benefícios=escala).
- Legenda sincronizada aparece por shot; CTA em destaque no fim.
- Produto continua fiel às imagens de referência.
- `npm run lint` sem novos erros; validação funcional manual via geração real.
