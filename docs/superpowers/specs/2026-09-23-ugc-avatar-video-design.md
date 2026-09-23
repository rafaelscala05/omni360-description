# Vídeo UGC com avatar

**Data:** 2026-09-23
**Status:** Aprovado (brainstorming) — aguardando plano de implementação
**Arquivos afetados:** `src/types/models.ts`, `src/services/aiService.ts`, novo `src/services/avatarService.ts`, novo `src/services/ugcVideoService.ts`, `src/components/modals/ProductEditModal.tsx`, novo `src/components/modals/UgcVideoGenerationTab.tsx`, novo `src/components/modals/AvatarLibrary.tsx`, novo `server/ugcVideoAgent.ts`, `server.ts` (registro de rotas), `src/credits.ts`, `firestore.rules`

## Problema

O pipeline de vídeo atual (`server/videoAgent.ts`, `VideoGenerationTab.tsx`) gera 4 cenas mudas de mãos manipulando o produto, com narração em voice-over — nunca uma pessoa em quadro (`rulesLine`: "Nenhuma pessoa falando para a câmera"; `negativePrompt` reforça isso). Não existe hoje nenhum conceito de avatar/persona/UGC no código.

Queremos um **modo adicional** de geração de vídeo onde uma pessoa (avatar), definida pelo usuário e reutilizável entre produtos, aparece falando diretamente para a câmera e interagindo com o produto — no estilo de um vídeo de influenciador/UGC real, com fala sincronizada (lábio + áudio nativo), não locução em off.

## Solução

Modo **"UGC com avatar"**, escolhido explicitamente pelo usuário ao lado do modo clássico existente (que permanece intocado). Três peças novas:

1. **Biblioteca de avatares por usuário** — o usuário descreve características em texto (idade, gênero, etnia, estilo, tom), a IA gera um retrato de referência (client-side, mesmo modelo usado hoje para imagem ambientada) e salva `descrição + imagem` em `users/{uid}/avatars/{avatarId}` para reuso em vídeos futuros. Criado e selecionado dentro do próprio wizard de vídeo — sem tela nova fora do fluxo.
2. **Roteiro UGC** — estrutura diferente da atual (não são 4 cenas de 8s com "ação + narração"; são 2-3 clipes de ~8s com papel `gancho` / `demonstracao` / `cta`, cada um com `fala` do avatar + `acaoVisual`), gerado por um prompt novo no mesmo modelo de texto (Gemini) já usado no fluxo atual.
3. **Geração Veo com áudio nativo** — cada clipe é uma chamada Veo separada (~8s, como hoje), mas com **duas** imagens de referência (avatar + produto, ambas `ASSET`) em vez de uma, e `generateAudio: true` para produzir fala sincronizada em vez de vídeo mudo. Os clipes são concatenados por corte seco, como hoje — só que sem a trilha de narração TTS por cima (o áudio já vem embutido em cada clipe).

## Modelo de dados

### Nova coleção `users/{uid}/avatars/{avatarId}`

```ts
interface Avatar {
  nome: string;              // nome dado pelo usuário (ex.: "Ana — Jovem Casual")
  descricao: string;         // características digitadas, reaproveitadas no prompt do Veo
  referenceImageUrl: string; // retrato gerado uma vez, Firebase Storage
  createdAt: string;         // ISO
}
```

Lida/escrita diretamente do cliente, seguindo o padrão de `src/services/categoryService.ts` (o service mais limpo/isolado do repo para uma coleção por usuário) — não o padrão `addDoc` mais solto do `App.tsx`: um path helper (`getAvatarsPath(uid)`), `getDocs(collection(...))` para listar, `setDoc(doc(collection(...)), data, { merge: true })` para criar/atualizar (ID automático via `doc(collection(db, path))` quando não houver um), e remoção manual de chaves `undefined` antes de gravar (o Firestore rejeita `undefined`, e o projeto não usa `ignoreUndefinedProperties`).

Precisa de uma entrada nova em `firestore.rules`, espelhando o bloco de `categories` (`allow read/create/update: if isOwner(userId) && isValidAvatar(); allow delete: if isOwner(userId)`), não o de `products` (que exige `ownerId` — desnecessário aqui).

### `Product` (`src/types/models.ts`)

Campos namespaced e independentes de `_video*` (produto pode ter os dois vídeos, clássico e UGC, ao mesmo tempo):

```ts
_ugcVideoScript?: import('../services/ugcVideoService').UgcVideoScript;
_ugcVideoJobId?: string;
_ugcVideoStatus?: 'idle' | 'generating_script' | 'script_ready' | 'queued' | 'processing' | 'done' | 'error';
_ugcVideoUrl?: string;
_ugcAvatarId?: string;
_ugcVideoError?: string;
```

### `src/services/ugcVideoService.ts` (novo, espelha `videoService.ts`)

```ts
interface UgcVideoClip {
  papel: 'gancho' | 'demonstracao' | 'cta';
  fala: string;       // diálogo do avatar, dito na frente da câmera
  acaoVisual: string; // o que acontece visualmente além da fala
}
interface UgcVideoScript {
  cena: string;           // ambientação coerente entre os clipes
  avatarDescricao: string; // eco da descrição do avatar escolhido, para o prompt do Veo
  clipes: UgcVideoClip[]; // 2 a 3 itens
}
type UgcVideoJobStatus = 'queued' | 'processing' | 'done' | 'error';
type UgcVideoJobStep = 'clip' | 'post' | 'uploading';
interface UgcVideoJob {
  jobId: string; productId: string; status: UgcVideoJobStatus;
  videoUrl?: string; error?: string; createdAt: string; updatedAt: string;
  clipsDone?: number; totalClips?: number; step?: UgcVideoJobStep;
}
```

Funções `generateUgcVideoScript`, `startUgcVideoJob`, `listenUgcVideoJob` — mesmo formato fetch/`onSnapshot` de `videoService.ts`, apontando para `/api/video/ugc/generate-script`, `/api/video/ugc/start-job` e `users/{uid}/ugcVideoJobs/{jobId}`.

## Geração do avatar (client-side)

### `src/services/aiService.ts` — nova função

`generateImage()` (L221) sempre parte de uma imagem de entrada (`inlineData`), pois foi desenhada para ambientação/edição. Criação de avatar parte só de texto, então entra uma variante:

```ts
export async function generateImageFromText(prompt: string, aspectRatio: string = '3:4'): Promise<string>
```

Mesmo `IMAGE_MODEL` (`gemini-2.5-flash-image`), mesmo `model.generateContent(...)`, mas com `contents: [{ text: prompt }]` (sem `inlineData`). Reaproveita `extractImage`, `reencodeAsJpeg`/`cropToAspectRatio` e `withRetry` já existentes. Aspect ratio `3:4` (retrato) por padrão.

### `src/services/avatarService.ts` (novo)

- `generateAvatarPortrait(descricao: string): Promise<string>` — monta o prompt ("retrato realista de [descrição], fundo neutro, iluminação de estúdio, foco no rosto e torso") e chama `generateImageFromText`. Retorna **data URL**, nada é persistido ainda (mesmo comportamento de `generateImage`/`runGenerateAmbient`, que só sobe pro Storage no "Salvar").
- `uploadAvatarImage(uid, dataUrl, avatarId): Promise<string>` — mesmo padrão de `uploadImage` em `ImageSearchModal.tsx:270` (`uploadString` para Storage), path `users/{uid}/avatar-images/{avatarId}.jpg`. Chamado só quando o usuário confirma o avatar (equivalente ao "Salvar" do fluxo de ambientação).
- `saveAvatar` / `listAvatars` / `deleteAvatar` — CRUD direto em `users/{uid}/avatars`, no padrão `categoryService.ts` descrito acima (`getAvatarsPath`, `getDocs`, `setDoc(..., { merge: true })`).

### Créditos

Nova ação `CREDIT_ACTIONS.avatarCreation` (`avatar_creation`, custo padrão 1) em `src/credits.ts`, debitada **no cliente** via `consumeCredit` logo após o retrato ser gerado com sucesso — mesmo padrão de `CREDIT_ACTIONS.ambientImage` em `ImageSearchModal.tsx:217` (debita só depois do sucesso, nunca antes).

## UI

### `AvatarLibrary.tsx` (novo, montado dentro do wizard de vídeo)

Galeria dos avatares salvos do usuário (`listAvatars`) + card "Criar novo avatar" com formulário (nome + descrição em texto) → gera retrato → preview → confirmar → salva e seleciona automaticamente.

### `UgcVideoGenerationTab.tsx` (novo, componente irmão de `VideoGenerationTab.tsx`)

Em vez de ramificar o wizard clássico (644 linhas) com `if (modo === 'ugc')` em cada estágio, o modo UGC ganha seu próprio componente de wizard, reaproveitando apenas os pedaços genéricos que fizerem sentido extrair (`PrereqItem`, o esqueleto de `VideoProgressDisplay`) para um arquivo compartilhado `src/components/modals/videoWizardShared.tsx`. Estágios:

1. `prereqs` — mesmos 3 pré-requisitos do fluxo clássico (descrição, título SEO, ≥1 imagem ambientada).
2. `select-avatar` — `AvatarLibrary`; avança só com um avatar selecionado.
3. `script` — roteiro editável: por clipe, badge do papel (Gancho/Demonstração/CTA) + campo `fala` + campo `acaoVisual`. Sem campo de trilha sonora (o áudio é nativo do clipe, sem mixagem de música nesta v1 — ver "Não muda / fora de escopo").
4. `generate` — mesmo padrão de progresso Firestore-driven de `VideoProgressDisplay`, rotulado com `clipsDone/totalClips` e expectativa de tempo (2-3 clipes, mesma ordem de grandeza do fluxo atual).

### `ProductEditModal.tsx`

A aba "video" (linha ~1006) ganha um seletor de modo no topo ("Vídeo clássico" vs "UGC com avatar") que decide entre montar `VideoGenerationTab` (como hoje) ou `UgcVideoGenerationTab`. Nenhuma mudança nas props/callbacks do fluxo clássico.

## Servidor (`server/ugcVideoAgent.ts`, novo)

Espelha `server/videoAgent.ts`, registrado via `registerUgcVideoRoutes()` a partir de `server.ts`.

- `POST /api/video/ugc/generate-script` — chamada Gemini (`gemini-2.5-flash`, mesmo `TEXT_MODEL`) análoga a `generateScript()` (`videoAgent.ts:357`), recebendo também a descrição do avatar; prompt novo pedindo 2-3 clipes com `papel`/`fala`/`acaoVisual`, JSON forçado.
- `POST /api/video/ugc/start-job` — débito de créditos via `debitCreditsAdmin` com nova ação `CREDIT_ACTIONS.ugcVideoGeneration` (`video_ugc_generation`, custo padrão a definir — ver Riscos), cria `users/{uid}/ugcVideoJobs/{jobId}`, busca imagem do avatar + imagem de referência do produto, chama `runUgcVideoJob`.
- `runUgcVideoJob` — para cada clipe (`Promise.all`, 2-3 itens):
  - prompt: `cena` + papel do clipe + `acaoVisual` + instrução explícita de que o avatar deve dizer a `fala` olhando para a câmera; `styleLine` de UGC (câmera na mão/selfie ou tripé caseiro, iluminação natural, estética amadora-autêntica, não estúdio comercial); `fidelityLine` cobrindo **duas** fidelidades — avatar idêntico ao retrato de referência E produto idêntico à imagem de referência.
  - `referenceImages`: `[{ avatar, ASSET }, { produto, ASSET }]` — hoje só 1 referência é usada (`videoAgent.ts:549-554`); **precisa validar que a API aceita 2 referências `ASSET` simultâneas** (ver Riscos).
  - `config.generateAudio: true` (hoje é `false`, L547) — áudio nativo com fala, sem TTS por cima.
  - `negativePrompt` remove a proibição de "pessoa falando para a câmera" e adiciona "avatar diferente da referência", "voz robótica", "fala fora de sincronia".
- Pós-produção simplificada: só concatenação ffmpeg (sem `assembleFinalVideo`'s overlay de legenda/mixagem de música — não há trilha nem narração TTS a mixar nesta v1).
- Upload em `product-videos/{uid}/{productId}/ugc_{jobId}.mp4`; reutiliza `refundCreditsAdmin` (parametrizando label/actionKey) no `catch` de `runUgcVideoJob`, mesmo padrão de `videoAgent.ts:613-622`.

## O que NÃO muda / fora de escopo desta v1

- Fluxo clássico (`videoAgent.ts`, `VideoGenerationTab.tsx`, campos `_video*`) — zero alteração, os dois modos coexistem.
- Padrão de débito de créditos (transação client-side pós-sucesso para ações de IA Logic; transação admin com estorno para o job server-side) — reaproveitado tal como é.
- Upload para Firebase Storage (`uploadString` + URL pública) — reaproveitado tal como é.
- Mixagem de música de fundo e legendas queimadas no vídeo UGC — o áudio nativo do avatar já carrega a "narração"; música/legenda ficam de fora da v1 (podem entrar depois como incremento independente).
- Gestão administrativa da biblioteca de avatares (CRM) — biblioteca é 100% por usuário, sem tela de admin.

## Riscos e mitigação

- **Não validado: 2 reference images `ASSET` simultâneas no Veo 3.1.** O SDK (`@google/genai`) aceita array em `referenceImages`, mas o comportamento com avatar + produto juntos nunca foi testado neste projeto. **Primeiro passo da implementação deve ser um teste isolado** (script standalone chamando `ai.models.generateVideos` com as 2 referências) antes de integrar ao pipeline completo. Se não funcionar bem, fallback: priorizar a referência do avatar (fidelidade de rosto/pessoa é mais crítica para UGC que fidelidade exata do produto) e descrever o produto só em texto no prompt.
- **Não validado: `generateAudio: true` produzindo fala em pt-BR sincronizada (lip sync) de forma confiável.** Mesmo teste isolado acima deve confirmar. Fallback caso a qualidade seja ruim: avatar de boca fechada/gestual + TTS como no fluxo clássico (perde o "lip sync real" mas mantém o resto do design).
- **Custo Veo com áudio + geração de pessoa é desconhecido** e provavelmente maior que o muted atual. `video_ugc_generation` entra com um custo inicial estimado (ex.: 8 créditos) em `DEFAULT_CREDIT_COSTS`, ajustável sem deploy via `config/credits` assim que o custo real de billing for observado.
- **Deriva de aparência do avatar entre clipes** — cada clipe é uma geração independente ancorada nas mesmas 2 imagens de referência; pequenas variações entre clipes são esperadas (mesma limitação hoje aceita para fidelidade de produto, mitigada por ancoragem em referência, não por costura de frames).

## Critérios de sucesso

- Usuário cria e salva ao menos um avatar (retrato gerado + persistido) e consegue reutilizá-lo em outro produto sem recriar.
- Escolher "UGC com avatar" produz um vídeo de 2-3 clipes em que o avatar aparece segurando/usando o produto e falando as falas do roteiro, com áudio presente.
- Fluxo clássico de vídeo permanece funcionando sem nenhuma regressão perceptível.
- Créditos debitados corretamente nos dois pontos (criação de avatar no cliente, geração de vídeo UGC no servidor com estorno em falha).
- `npm run lint` limpo; validado manualmente via dev server (projeto não tem testes automatizados).
