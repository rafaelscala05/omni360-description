# Design: Geração de Vídeo de Produto (Veo 3.1)

**Data:** 2026-06-22  
**Status:** Aprovado

---

## Objetivo

Adicionar uma aba `video` no `ProductEditModal` que permite ao usuário gerar um vídeo curto (8s) de um produto com interação humana usando o Vertex AI Veo 3.1, partindo de uma imagem ambientada gerada por IA.

---

## Fluxo do Usuário (4 estágios)

```
[1. Pré-requisitos] → [2. Seleção de Imagem] → [3. Roteiro] → [4. Gerar Vídeo]
```

### Estágio 1 — Pré-requisitos (bloqueante)
- Checa: descrição complementar gerada, título SEO preenchido, `_ambientImages` não vazia.
- Se algum item falta, o botão "Próximo" fica desabilitado com tooltip.
- Links navegam diretamente para a aba correspondente no modal.

### Estágio 2 — Seleção de Imagem
- Grid das `_ambientImages` + a imagem original (`_selectedImage`).
- Seleção por clique com borda destacada.

### Estágio 3 — Roteiro gerado por IA
- `POST /api/video/generate-script` envia descrição + imagem base64 → retorna `{ cena, acao, audio }`.
- Exibido em card editável pelo usuário.
- Botões: "Regenerar Roteiro" e "Aprovar e Continuar".

### Estágio 4 — Geração de Vídeo (assíncrono)
- `POST /api/video/start-job` inicia o job Veo 3.1 no servidor, grava estado em Firestore e retorna `jobId`.
- Cliente usa `onSnapshot` em `users/{uid}/videoJobs/{jobId}` para acompanhar em tempo real.
- Quando `status === 'done'`, exibe player `<video>` + botão download.
- Quando `status === 'error'`, exibe mensagem + botão "Tentar novamente".

---

## Modelo de Dados

### Novos campos em `Product` (src/types/models.ts)
```ts
_videoScript?: { cena: string; acao: string; audio: string };
_videoJobId?: string;
_videoStatus?: 'idle' | 'generating_script' | 'script_ready' | 'queued' | 'processing' | 'done' | 'error';
_videoUrl?: string;         // Firebase Storage URL do .mp4 final
_videoSelectedImage?: string; // URL da imagem usada como base
_videoError?: string;
```

### Novo documento Firestore: `users/{uid}/videoJobs/{jobId}`
```ts
interface VideoJob {
  jobId: string;
  productId: string;       // _id do produto
  operationName: string;   // nome da long-running operation do Veo
  status: 'queued' | 'processing' | 'done' | 'error';
  videoUrl?: string;       // preenchido quando done
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Novo campo em `CreditAction` (src/credits.ts)
```ts
videoGeneration: { key: 'video_generation', label: 'Geração de Vídeo de Produto' }
```

---

## Novos Endpoints do Servidor (server/videoAgent.ts)

### `POST /api/video/generate-script`
- **Auth:** uid via header `x-uid`
- **Body:** `{ productId, description, imageBase64, mimeType }`
- **Processo:** chama Gemini 2.5 Flash com prompt cinematográfico → retorna `{ cena, acao, audio }`
- **Custo:** sem crédito (só geração de roteiro)

### `POST /api/video/start-job`
- **Auth:** uid via header `x-uid`
- **Body:** `{ productId, script: { cena, acao, audio }, imageBase64, mimeType }`
- **Processo:**
  1. Debita crédito `video_generation`
  2. Chama `veo-3.1-fast-generate-001` via Vertex AI SDK com image-to-video
  3. Grava `videoJobs/{jobId}` com `status: 'queued'` e `operationName`
  4. Inicia worker background que faz polling do Veo e atualiza Firestore
  5. Quando Veo conclui: baixa `.mp4` do GCS, faz upload para Firebase Storage, atualiza `videoUrl` e `status: 'done'`
- **Retorna:** `{ jobId }`

### `GET /api/video/job-status/:jobId`  *(fallback opcional)*
- Retorna estado atual do job do Firestore (para casos onde onSnapshot falha)

---

## Componentes Novos

- `src/components/modals/VideoGenerationTab.tsx` — tab completa com os 4 estágios
- `src/services/videoService.ts` — `generateVideoScript()`, `startVideoJob()`, `listenVideoJob()`
- `server/videoAgent.ts` — endpoints e worker de polling do Veo

---

## Configuração Necessária

- Variável de ambiente: `GOOGLE_CLOUD_PROJECT` e `GOOGLE_APPLICATION_CREDENTIALS` no servidor para autenticar no Vertex AI
- GCS bucket temporário configurado no servidor (pode ser o mesmo bucket do Firebase Storage)
- `ProductModalTab` atualizado: `'geral' | 'atributos' | 'tecnico' | 'ia' | 'imagem' | 'video' | 'simular'`

---

## Decisões de Arquitetura

- **Modelo:** `veo-3.1-fast-generate-001` — melhor custo-benefício para produto e-commerce (~$0,10/s, 8s = ~$0,80/vídeo)
- **Sem áudio TTS** nesta versão — o prompt de áudio orienta o Veo a gerar sons ambiente, não narração sintética
- **Polling server-side:** o servidor faz polling da Vertex AI independente do cliente; resultado persiste em Firestore
- **Um vídeo por produto:** sobrescreve o anterior para simplicidade
