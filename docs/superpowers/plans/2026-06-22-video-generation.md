# Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma aba "Vídeo" no ProductEditModal que permite gerar um vídeo de 8s com interação humana a partir de uma imagem ambientada de IA, usando Vertex AI Veo 3.1, com polling assíncrono via Firestore onSnapshot.

**Architecture:** O servidor expõe dois endpoints — geração de roteiro (Gemini 2.5 Flash) e início do job de vídeo (Veo 3.1 via @google/genai em modo Vertex AI). O job persiste em `users/{uid}/videoJobs/{jobId}` no Firestore; o servidor faz polling do Veo em background e faz upload do .mp4 para Firebase Storage ao concluir. O cliente usa `onSnapshot` para atualização em tempo real, sem bloquear o usuário.

**Tech Stack:** React 19, Tailwind CSS v4, Firebase Firestore (onSnapshot), Firebase Admin Storage, @google/genai 1.29+ (Vertex AI mode, generateVideos), Express, TypeScript.

## Global Constraints

- Todo texto de UI em pt-BR
- Seguir padrão de `registerContentRoutes` / `verifyFirebaseToken` para novos endpoints
- Não modificar CLAUDE.md, arquivos de teste ou configurações de build
- Modelo de vídeo: `veo-3.1-fast-generate-001`, aspecto 9:16, 8 segundos, `personGeneration: 'allow_adult'`
- Firebase Storage bucket: `project-95918f0d-50bb-4f66-a0d.firebasestorage.app`
- Vertex AI project: `project-95918f0d-50bb-4f66-a0d`, location: `us-central1`
- Um vídeo por produto (sobrescreve o anterior)
- Crédito para geração de vídeo: chave `video_generation`, label `Geração de Vídeo de Produto`

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/types/models.ts` | Modificar | Campos `_video*` em Product; `'video'` em ProductModalTab |
| `src/credits.ts` | Modificar | CreditAction `videoGeneration` |
| `server/firebaseAdmin.ts` | Modificar | Exportar `adminStorage` |
| `server/videoAgent.ts` | Criar | Endpoints `/api/video/*` + worker Veo |
| `server.ts` | Modificar | Registrar rotas do videoAgent |
| `src/services/videoService.ts` | Criar | `generateVideoScript`, `startVideoJob`, `listenVideoJob` |
| `src/components/modals/VideoGenerationTab.tsx` | Criar | UI dos 4 estágios |
| `src/components/modals/ProductEditModal.tsx` | Modificar | Aba `video` + render VideoGenerationTab |

---

## Task 1: Types, Credits e Firebase Storage no servidor

**Files:**
- Modify: `src/types/models.ts`
- Modify: `src/credits.ts`
- Modify: `server/firebaseAdmin.ts`

**Interfaces:**
- Produces: campos `_video*` em `Product`; `'video'` em `ProductModalTab`; `CREDIT_ACTIONS.videoGeneration`; `adminStorage` exportado

- [ ] **Step 1: Adicionar campos de vídeo ao tipo `Product` em `src/types/models.ts`**

Após a linha `_isDirty?: boolean;` (atualmente a última linha de campos internos, antes de `categoryId`), adicionar:

```typescript
  _videoScript?: { cena: string; acao: string; audio: string };
  _videoJobId?: string;
  _videoStatus?: 'idle' | 'generating_script' | 'script_ready' | 'queued' | 'processing' | 'done' | 'error';
  _videoUrl?: string;
  _videoSelectedImage?: string;
  _videoError?: string;
```

- [ ] **Step 2: Adicionar `'video'` ao tipo `ProductModalTab` em `src/types/models.ts`**

Alterar a linha:
```typescript
export type ProductModalTab = 'geral' | 'atributos' | 'tecnico' | 'ia' | 'imagem' | 'simular';
```
Para:
```typescript
export type ProductModalTab = 'geral' | 'atributos' | 'tecnico' | 'ia' | 'imagem' | 'video' | 'simular';
```

- [ ] **Step 3: Adicionar `videoGeneration` em `src/credits.ts`**

No objeto `CREDIT_ACTIONS`, após `contentPublish`, adicionar:
```typescript
  videoGeneration: { key: 'video_generation', label: 'Geração de Vídeo de Produto' },
```

No objeto `DEFAULT_CREDIT_COSTS`, após `content_publish: 1`, adicionar:
```typescript
  video_generation: 5,
```

- [ ] **Step 4: Exportar `adminStorage` de `server/firebaseAdmin.ts`**

Adicionar ao final das importações:
```typescript
import { getStorage } from 'firebase-admin/storage';
```

Adicionar ao final das exportações:
```typescript
export const adminStorage = getStorage();
```

- [ ] **Step 5: Verificar que o TypeScript compila sem erros**

```bash
npm run lint
```
Esperado: sem erros de tipo nos arquivos modificados.

- [ ] **Step 6: Commit**

```bash
git add src/types/models.ts src/credits.ts server/firebaseAdmin.ts
git commit -m "feat(video): add video fields to Product, VideoGeneration credit action, adminStorage"
```

---

## Task 2: Server — videoAgent.ts

**Files:**
- Create: `server/videoAgent.ts`

**Interfaces:**
- Consumes: `adminDb` e `adminStorage` de `./firebaseAdmin`; `CREDIT_ACTIONS` e `resolveCreditCost` de `../src/credits`; `verifyFirebaseToken` via deps
- Produces: `registerVideoRoutes(app, deps)` — registra `POST /api/video/generate-script` e `POST /api/video/start-job`

- [ ] **Step 1: Criar `server/videoAgent.ts` com helpers e tipos internos**

```typescript
import type express from 'express';
import { GoogleGenAI } from '@google/genai';
import { adminDb, adminStorage } from './firebaseAdmin';
import { CREDIT_ACTIONS, resolveCreditCost } from '../src/credits';
import type { CreditAction } from '../src/credits';
import { FieldValue } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';

const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
const GCP_PROJECT = firebaseAppletConfig.projectId;
const VEO_MODEL = 'veo-3.1-fast-generate-001';
const TEXT_MODEL = 'gemini-2.5-flash';

interface VideoScript {
  cena: string;
  acao: string;
  audio: string;
}

interface VideoDeps {
  verifyFirebaseToken: (req: express.Request) => Promise<import('firebase-admin/auth').DecodedIdToken>;
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY não configurada'), { status: 500 });
  return new GoogleGenAI({ apiKey });
}

function getVeoClient() {
  return new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location: 'us-central1',
  });
}

function now() {
  return new Date().toISOString();
}

function sendError(res: express.Response, err: unknown) {
  const status = (err as any)?.status ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao buscar imagem: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return { base64, mimeType };
}

async function debitCreditsAdmin(
  uid: string,
  action: CreditAction,
  meta: { productName?: string; userName?: string } = {},
): Promise<number> {
  const configSnap = await adminDb.collection('config').doc('credits').get();
  const costs: Record<string, number> = configSnap.exists ? (configSnap.data() as any) : {};
  const cost = resolveCreditCost(costs, action.key);

  const userRef = adminDb.collection('users').doc(uid);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current: number = snap.exists ? (snap.data()?.credits ?? 0) : 0;
    if (current < cost) throw Object.assign(new Error('Créditos insuficientes'), { status: 402 });
    const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();
    tx.update(userRef, { credits: FieldValue.increment(-cost) });
    tx.set(logRef, {
      action: action.key,
      label: action.label,
      cost: -cost,
      productName: meta.productName ?? '',
      userName: meta.userName ?? '',
      createdAt: now(),
    });
    return cost;
  });
}
```

- [ ] **Step 2: Adicionar função `generateScript` em `server/videoAgent.ts`**

```typescript
async function generateScript(
  description: string,
  brand: string,
  imageBase64: string,
  mimeType: string,
): Promise<VideoScript> {
  const ai = getGeminiClient();
  const prompt = `Você é um diretor de vídeo especialista em e-commerce. Crie um roteiro curto e cinematográfico para um vídeo de 8 segundos que apresenta o produto abaixo de forma envolvente, com interação humana natural.

Produto: ${description}${brand ? `\nMarca: ${brand}` : ''}

O vídeo deve ter:
- UMA pessoa interagindo naturalmente com o produto no seu contexto de uso real
- Movimento de câmera suave (close → plano médio ou vice-versa)
- Ambiente realista e específico para este produto (não estúdio genérico)
- Sensação de vida real, não propaganda

Retorne APENAS um JSON válido neste formato exato:
{
  "cena": "Descrição do ambiente e enquadramento inicial em português (max 80 chars)",
  "acao": "O que a pessoa faz com o produto, como interage (max 120 chars)",
  "audio": "Sons ambiente, trilha, ou fala breve da pessoa (max 80 chars)"
}`;

  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const text = result.text?.trim() ?? '{}';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned) as VideoScript;
  if (!parsed.cena || !parsed.acao || !parsed.audio) {
    throw new Error('Roteiro gerado inválido — campos obrigatórios ausentes');
  }
  return parsed;
}
```

- [ ] **Step 3: Adicionar função `runVeoJob` (worker background) em `server/videoAgent.ts`**

```typescript
async function runVeoJob(
  uid: string,
  jobId: string,
  productId: string,
  script: VideoScript,
  imageBase64: string,
  mimeType: string,
): Promise<void> {
  const jobRef = adminDb.collection('users').doc(uid).collection('videoJobs').doc(jobId);

  try {
    await jobRef.update({ status: 'processing', updatedAt: now() });

    const fullPrompt = [
      `Cena: ${script.cena}`,
      `Ação: ${script.acao}`,
      `Áudio: ${script.audio}`,
      'Estilo: cinematográfico, luz natural, câmera lenta suave, realista, alta qualidade, 4K',
      'IMPORTANTE: A pessoa deve interagir naturalmente com o produto. Sem texto na tela. Sem efeitos artificiais.',
    ].join('\n');

    const ai = getVeoClient();
    let operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: fullPrompt,
      image: { imageBytes: imageBase64, mimeType },
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: '9:16',
        personGeneration: 'allow_adult',
        generateAudio: false,
      },
    });

    // Polling — Veo leva em média 2–5 minutos
    while (!operation.done) {
      await new Promise((r) => setTimeout(r, 15000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(String(operation.error.message ?? operation.error));
    }

    const videoBytes = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
    if (!videoBytes) throw new Error('Veo não retornou bytes de vídeo');

    // Upload para Firebase Storage
    const bucket = adminStorage.bucket(STORAGE_BUCKET);
    const filePath = `product-videos/${uid}/${productId}/${jobId}.mp4`;
    const file = bucket.file(filePath);
    await file.save(Buffer.from(videoBytes, 'base64'), {
      contentType: 'video/mp4',
      metadata: { cacheControl: 'public, max-age=31536000' },
    });
    await file.makePublic();
    const videoUrl = file.publicUrl();

    await jobRef.update({ status: 'done', videoUrl, updatedAt: now() });

    // Salva URL no produto também (conveniência para o modal)
    const productRef = adminDb.collection('users').doc(uid).collection('products').doc(productId);
    const prodSnap = await productRef.get();
    if (prodSnap.exists) {
      await productRef.update({ _videoUrl: videoUrl, _videoJobId: jobId, updatedAt: now() });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobRef.update({ status: 'error', error: message, updatedAt: now() }).catch(() => {});
  }
}
```

- [ ] **Step 4: Adicionar `registerVideoRoutes` em `server/videoAgent.ts`**

```typescript
export function registerVideoRoutes(app: express.Application, deps: VideoDeps): void {
  const { verifyFirebaseToken } = deps;

  // Gera roteiro cinematográfico para o vídeo
  app.post('/api/video/generate-script', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { description, brand, imageUrl } = req.body as {
        description: string;
        brand?: string;
        imageUrl: string;
      };
      if (!description || !imageUrl) {
        return res.status(400).json({ error: 'description e imageUrl são obrigatórios' });
      }
      const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
      const script = await generateScript(description, brand ?? '', base64, mimeType);
      res.json({ script });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Inicia job de geração de vídeo (assíncrono)
  app.post('/api/video/start-job', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { productId, productName, script, imageUrl } = req.body as {
        productId: string;
        productName: string;
        script: VideoScript;
        imageUrl: string;
      };
      if (!productId || !script || !imageUrl) {
        return res.status(400).json({ error: 'productId, script e imageUrl são obrigatórios' });
      }

      await debitCreditsAdmin(decoded.uid, CREDIT_ACTIONS.videoGeneration, {
        productName,
        userName: decoded.name ?? decoded.email,
      });

      const jobRef = adminDb
        .collection('users')
        .doc(decoded.uid)
        .collection('videoJobs')
        .doc();
      const jobId = jobRef.id;

      await jobRef.set({
        jobId,
        productId,
        status: 'queued',
        videoUrl: null,
        error: null,
        createdAt: now(),
        updatedAt: now(),
      });

      const { base64, mimeType } = await fetchImageAsBase64(imageUrl);

      // Fire and forget — não bloqueia a resposta HTTP
      runVeoJob(decoded.uid, jobId, productId, script, base64, mimeType);

      res.json({ jobId });
    } catch (err) {
      sendError(res, err);
    }
  });
}
```

- [ ] **Step 5: Verificar tipos**

```bash
npm run lint
```
Esperado: sem erros em `server/videoAgent.ts`.

- [ ] **Step 6: Commit**

```bash
git add server/videoAgent.ts
git commit -m "feat(video): add videoAgent server with Veo 3.1 script generation and async job"
```

---

## Task 3: Registrar rotas no servidor (`server.ts`)

**Files:**
- Modify: `server.ts`

**Interfaces:**
- Consumes: `registerVideoRoutes` de `./server/videoAgent`
- Produces: endpoints `/api/video/*` ativos

- [ ] **Step 1: Importar `registerVideoRoutes` em `server.ts`**

Na linha onde está `import { registerContentRoutes, startContentScheduler } from "./server/contentAgent";`, adicionar logo abaixo:

```typescript
import { registerVideoRoutes } from "./server/videoAgent";
```

- [ ] **Step 2: Chamar `registerVideoRoutes` em `server.ts`**

Logo após a linha `registerContentRoutes(app, { verifyFirebaseToken, uploadsDir });`, adicionar:

```typescript
registerVideoRoutes(app, { verifyFirebaseToken });
```

- [ ] **Step 3: Verificar tipos**

```bash
npm run lint
```
Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(video): register video API routes"
```

---

## Task 4: Cliente — `src/services/videoService.ts`

**Files:**
- Create: `src/services/videoService.ts`

**Interfaces:**
- Consumes: `db` de `../firebase`; `onSnapshot`, `doc` de `firebase/firestore`
- Produces:
  - `VideoScript` — `{ cena: string; acao: string; audio: string }`
  - `VideoJob` — `{ jobId, productId, status, videoUrl?, error?, createdAt, updatedAt }`
  - `generateVideoScript(uid, idToken, params): Promise<VideoScript>`
  - `startVideoJob(uid, idToken, params): Promise<string>` (jobId)
  - `listenVideoJob(uid, jobId, cb): () => void` (unsubscribe)

- [ ] **Step 1: Criar `src/services/videoService.ts`**

```typescript
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';

export interface VideoScript {
  cena: string;
  acao: string;
  audio: string;
}

export type VideoJobStatus = 'queued' | 'processing' | 'done' | 'error';

export interface VideoJob {
  jobId: string;
  productId: string;
  status: VideoJobStatus;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export async function generateVideoScript(
  idToken: string,
  params: { description: string; brand?: string; imageUrl: string },
): Promise<VideoScript> {
  const res = await fetch('/api/video/generate-script', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.script as VideoScript;
}

export async function startVideoJob(
  idToken: string,
  params: {
    productId: string;
    productName: string;
    script: VideoScript;
    imageUrl: string;
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
    throw new Error(body.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.jobId as string;
}

export function listenVideoJob(
  uid: string,
  jobId: string,
  cb: (job: VideoJob) => void,
): () => void {
  return onSnapshot(
    doc(db, 'users', uid, 'videoJobs', jobId),
    (snap) => {
      if (snap.exists()) cb(snap.data() as VideoJob);
    },
  );
}
```

- [ ] **Step 2: Verificar tipos**

```bash
npm run lint
```
Esperado: sem erros em `src/services/videoService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/videoService.ts
git commit -m "feat(video): add videoService client (generateVideoScript, startVideoJob, listenVideoJob)"
```

---

## Task 5: UI — `VideoGenerationTab.tsx`

**Files:**
- Create: `src/components/modals/VideoGenerationTab.tsx`

**Interfaces:**
- Consumes:
  - `VideoScript`, `VideoJob`, `generateVideoScript`, `startVideoJob`, `listenVideoJob` de `../../services/videoService`
  - `Product` de `../../types/models`
- Produces: componente `<VideoGenerationTab>` com props abaixo

- [ ] **Step 1: Criar `src/components/modals/VideoGenerationTab.tsx` — estrutura base e tipos**

```typescript
import React, { useState, useEffect, useRef } from 'react';
import {
  Video, Image as ImageIcon, Sparkles, RefreshCw, CheckCircle2,
  AlertCircle, Loader2, Download, Play, ChevronRight, Info,
} from 'lucide-react';
import type { Product } from '../../types/models';
import {
  generateVideoScript, startVideoJob, listenVideoJob,
  type VideoScript, type VideoJob,
} from '../../services/videoService';

interface VideoGenerationTabProps {
  product: Product;
  uid: string;
  getIdToken: () => Promise<string>;
  onVideoGenerated: (productId: string, videoUrl: string, jobId: string) => void;
  onNavigateToTab: (tab: 'imagem' | 'ia') => void;
}

type Stage = 'prereqs' | 'select-image' | 'script' | 'generate';

const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');
```

- [ ] **Step 2: Adicionar hook de pré-requisitos e seleção de imagem**

Continuar o arquivo com o componente principal:

```typescript
export default function VideoGenerationTab({
  product, uid, getIdToken, onVideoGenerated, onNavigateToTab,
}: VideoGenerationTabProps) {
  const hasDescription = !!product['Descrição complementar']?.trim();
  const hasSeoTitle = !!product['Título SEO']?.trim();
  const hasImages = (product._ambientImages?.length ?? 0) > 0;
  const prereqsMet = hasDescription && hasSeoTitle && hasImages;

  const allImages = [
    ...(product._selectedImage ? [{ url: product._selectedImage, label: 'Imagem Original' }] : []),
    ...(product._ambientImages ?? []).map((url, i) => ({
      url,
      label: ['Produto Ambientado', 'Produto em Uso', 'Escala e Tamanho'][i] ?? `Ambientação ${i + 1}`,
    })),
  ];

  const [stage, setStage] = useState<Stage>('prereqs');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [script, setScript] = useState<VideoScript | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(product._videoJobId ?? null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Resume listening if there's an active job
  useEffect(() => {
    if (!jobId) return;
    setStage('generate');
    unsubRef.current = listenVideoJob(uid, jobId, (j) => {
      setJob(j);
      if (j.status === 'done' && j.videoUrl) {
        onVideoGenerated(product._id, j.videoUrl, jobId);
      }
    });
    return () => { unsubRef.current?.(); };
  }, [jobId]);

  async function handleGenerateScript() {
    if (!selectedImage) return;
    setScriptLoading(true);
    setScriptError(null);
    try {
      const token = await getIdToken();
      const result = await generateVideoScript(token, {
        description: product['Descrição complementar'] ?? product['Descrição'] ?? '',
        brand: product['Marca'] ?? '',
        imageUrl: selectedImage,
      });
      setScript(result);
      setStage('script');
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Erro ao gerar roteiro');
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleStartJob() {
    if (!script || !selectedImage) return;
    setJobLoading(true);
    setJobError(null);
    try {
      const token = await getIdToken();
      const id = await startVideoJob(token, {
        productId: product._id,
        productName: product['Descrição'] ?? product._id,
        script,
        imageUrl: selectedImage,
      });
      setJobId(id);
      setStage('generate');
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Erro ao iniciar geração');
      setJobLoading(false);
    }
  }
```

- [ ] **Step 3: Adicionar renderização dos 4 estágios no componente**

Continuar o arquivo (return do componente):

```typescript
  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">

      {/* Stage indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['prereqs', 'select-image', 'script', 'generate'] as Stage[]).map((s, i) => {
          const labels = ['Pré-requisitos', 'Imagem', 'Roteiro', 'Gerar Vídeo'];
          const active = stage === s;
          const done = (['prereqs', 'select-image', 'script', 'generate'] as Stage[]).indexOf(stage) > i;
          return (
            <React.Fragment key={s}>
              <span className={cn(
                'px-3 py-1 rounded-full text-xs font-bold transition-all',
                active && 'bg-violet-600 text-white',
                done && 'bg-green-100 text-green-700',
                !active && !done && 'bg-slate-100 text-slate-400',
              )}>
                {done ? '✓ ' : `${i + 1}. `}{labels[i]}
              </span>
              {i < 3 && <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Estágio 1: Pré-requisitos */}
      {stage === 'prereqs' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Video className="w-5 h-5 text-violet-600" />
            Gerar Vídeo com IA
          </h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Para gerar um vídeo de qualidade com interação humana e roteiro cinematográfico,
            o produto precisa ter as informações abaixo preenchidas.
          </p>

          <div className="space-y-3 mb-6">
            <PrereqItem
              ok={hasDescription}
              label="Descrição complementar gerada"
              onFix={() => onNavigateToTab('ia')}
              fixLabel="Ir para IA"
            />
            <PrereqItem
              ok={hasSeoTitle}
              label="Título SEO preenchido"
              onFix={() => onNavigateToTab('ia')}
              fixLabel="Ir para IA"
            />
            <PrereqItem
              ok={hasImages}
              label="Imagens ambientadas geradas (mínimo 1)"
              onFix={() => onNavigateToTab('imagem')}
              fixLabel="Ir para Imagens"
            />
          </div>

          {!prereqsMet && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mb-6">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Preencha os itens marcados acima para desbloquear a geração de vídeo.</span>
            </div>
          )}

          <button
            onClick={() => setStage('select-image')}
            disabled={!prereqsMet}
            className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-md"
          >
            <ChevronRight className="w-4 h-4" />
            Próximo: Escolher Imagem
          </button>
        </section>
      )}

      {/* Estágio 2: Seleção de imagem */}
      {stage === 'select-image' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-violet-600" />
            Escolha a imagem base do vídeo
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Esta imagem será o ponto de partida do vídeo. O Veo 3.1 vai animar a cena a partir dela.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {allImages.map(({ url, label }) => (
              <button
                key={url}
                onClick={() => setSelectedImage(url)}
                className={cn(
                  'relative aspect-square rounded-xl overflow-hidden border-2 transition-all group',
                  selectedImage === url
                    ? 'border-violet-500 ring-2 ring-violet-300 scale-[1.02]'
                    : 'border-slate-200 hover:border-violet-300',
                )}
              >
                <img src={url} alt={label} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className={cn(
                  'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent py-2 px-2',
                  selectedImage === url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  'transition-opacity',
                )}>
                  <span className="text-white text-xs font-bold">{label}</span>
                </div>
                {selectedImage === url && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-violet-600 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStage('prereqs')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all">
              Voltar
            </button>
            <button
              onClick={handleGenerateScript}
              disabled={!selectedImage || scriptLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {scriptLoading ? 'Gerando roteiro...' : 'Gerar Roteiro com IA'}
            </button>
          </div>
          {scriptError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {scriptError}
            </p>
          )}
        </section>
      )}

      {/* Estágio 3: Roteiro */}
      {stage === 'script' && script && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            Roteiro gerado pela IA
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Revise e edite o roteiro antes de gerar o vídeo. Cada campo orienta uma parte do vídeo de 8 segundos.
          </p>

          <div className="space-y-4 mb-6">
            <ScriptField
              label="Cena / Contexto"
              hint="Ambiente e enquadramento da câmera"
              value={script.cena}
              onChange={(v) => setScript({ ...script, cena: v })}
            />
            <ScriptField
              label="Ação / Interação"
              hint="O que a pessoa faz com o produto"
              value={script.acao}
              onChange={(v) => setScript({ ...script, acao: v })}
            />
            <ScriptField
              label="Áudio / Narração"
              hint="Sons ambiente, trilha ou fala da pessoa"
              value={script.audio}
              onChange={(v) => setScript({ ...script, audio: v })}
            />
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleGenerateScript}
              disabled={scriptLoading}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 disabled:opacity-40"
            >
              {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Regenerar Roteiro
            </button>
            <button
              onClick={handleStartJob}
              disabled={jobLoading}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-40"
            >
              {jobLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {jobLoading ? 'Iniciando...' : 'Aprovar e Gerar Vídeo'}
            </button>
          </div>
          {jobError && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {jobError}
            </p>
          )}
        </section>
      )}

      {/* Estágio 4: Gerar / Status / Player */}
      {stage === 'generate' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Video className="w-5 h-5 text-violet-600" />
            Geração de Vídeo
          </h2>

          {(!job || job.status === 'queued' || job.status === 'processing') && (
            <div className="flex flex-col items-center py-12 gap-6 text-center">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
                <div className="absolute inset-0 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" />
                <Video className="absolute inset-0 m-auto w-6 h-6 text-violet-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800 text-lg mb-1">
                  {job?.status === 'processing' ? 'Gerando seu vídeo...' : 'Na fila de processamento...'}
                </p>
                <p className="text-sm text-slate-500 max-w-sm">
                  O Veo 3.1 está animando a cena. Esse processo leva em média 2–5 minutos.
                  Você pode fechar essa janela — o vídeo ficará disponível aqui quando pronto.
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 rounded-xl text-sm text-violet-700 font-medium">
                <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                {job?.status === 'processing' ? 'Processando no servidor' : 'Aguardando processamento'}
              </div>
            </div>
          )}

          {job?.status === 'done' && job.videoUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-3 rounded-xl text-sm font-bold border border-green-200">
                <CheckCircle2 className="w-4 h-4" />
                Vídeo gerado com sucesso!
              </div>
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                <video
                  src={job.videoUrl}
                  controls
                  className="w-full max-h-[480px] object-contain"
                  poster={selectedImage ?? undefined}
                />
              </div>
              <div className="flex gap-3">
                <a
                  href={job.videoUrl}
                  download={`video_produto_${product._id}.mp4`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Baixar Vídeo
                </a>
                <button
                  onClick={() => { setStage('select-image'); setJob(null); setJobId(null); setScript(null); setSelectedImage(null); }}
                  className="px-5 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Gerar Novo Vídeo
                </button>
              </div>
            </div>
          )}

          {job?.status === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold mb-1">Falha na geração do vídeo</p>
                  <p>{job.error ?? 'Erro desconhecido'}</p>
                </div>
              </div>
              <button
                onClick={() => { setStage('select-image'); setJob(null); setJobId(null); setJobLoading(false); }}
                className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Tentar Novamente
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Adicionar sub-componentes `PrereqItem` e `ScriptField` no mesmo arquivo**

**Após** o `}` de fechamento do `export default function VideoGenerationTab` (ou seja, no final do arquivo), adicionar:

```typescript
function PrereqItem({ ok, label, onFix, fixLabel }: {
  ok: boolean; label: string; onFix: () => void; fixLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
        <span className={cn('text-sm font-medium', ok ? 'text-slate-700' : 'text-slate-600')}>
          {label}
        </span>
      </div>
      {!ok && (
        <button
          onClick={onFix}
          className="shrink-0 text-xs font-bold text-violet-600 hover:text-violet-800 underline underline-offset-2 transition-colors"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}

function ScriptField({ label, hint, value, onChange }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className="text-sm font-bold text-slate-800">{label}</label>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none transition-all"
      />
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipos**

```bash
npm run lint
```
Esperado: sem erros em `src/components/modals/VideoGenerationTab.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/modals/VideoGenerationTab.tsx
git commit -m "feat(video): add VideoGenerationTab with 4-stage UI and Firestore onSnapshot"
```

---

## Task 6: Integrar a aba no `ProductEditModal`

**Files:**
- Modify: `src/components/modals/ProductEditModal.tsx`

**Interfaces:**
- Consumes:
  - `VideoGenerationTab` de `./VideoGenerationTab`
  - Props novas no modal: `getIdToken: () => Promise<string>`, `onVideoGenerated: (productId, videoUrl, jobId) => void`
- Produces: aba `video` visível no modal; VideoGenerationTab renderizado para `activeTab === 'video'`

- [ ] **Step 1: Importar `VideoGenerationTab` em `ProductEditModal.tsx`**

No bloco de imports do arquivo, adicionar após o último import de componente:

```typescript
import VideoGenerationTab from './VideoGenerationTab';
import { Video } from 'lucide-react';
```

- [ ] **Step 2: Adicionar props `uid`, `getIdToken` e `onVideoGenerated` à interface `ProductEditModalProps`**

Localizar a interface (linha ~211):
```typescript
interface ProductEditModalProps {
  product: Product;
  categories: Category[];
  // ...demais props existentes
}
```
Adicionar as três novas props:
```typescript
  uid: string;
  getIdToken: () => Promise<string>;
  onVideoGenerated: (productId: string, videoUrl: string, jobId: string) => void;
```
E adicionar `uid`, `getIdToken`, `onVideoGenerated` à desestruturação no `export default function ProductEditModal(...)` na linha ~223.

- [ ] **Step 3: Adicionar a aba `video` ao array de tabs**

Localizar onde as tabs são definidas (array com `{ id: 'imagem', label: 'Imagens', icon: ImageIcon, ... }`) e adicionar logo após a aba `imagem`:

```typescript
{ id: 'video' as const, label: 'Vídeo', icon: Video, done: !!editedProduct._videoUrl },
```

- [ ] **Step 4: Renderizar `VideoGenerationTab` para `activeTab === 'video'`**

Localizar o bloco `{activeTab === 'imagem' && (...)}` e adicionar logo após (antes do bloco `ia`):

```typescript
{activeTab === 'video' && (
  <VideoGenerationTab
    product={editedProduct}
    uid={uid}
    getIdToken={getIdToken}
    onVideoGenerated={(productId, videoUrl, jobId) => {
      setEditedProduct((prev) => ({
        ...prev,
        _videoUrl: videoUrl,
        _videoJobId: jobId,
        _videoStatus: 'done',
      }));
      onVideoGenerated(productId, videoUrl, jobId);
    }}
    onNavigateToTab={(tab) => setActiveTab(tab)}
  />
)}
```

- [ ] **Step 5: Passar as novas props no(s) local(is) onde `ProductEditModal` é instanciado em `App.tsx`**

Fazer grep para encontrar todos os locais:

```bash
grep -n "ProductEditModal" /Users/rafaelscala/omni360-description/src/App.tsx | head -10
```

Em cada `<ProductEditModal ...>` encontrado (linha ~2898 em App.tsx), adicionar:

```tsx
uid={user?.uid ?? ''}
getIdToken={async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Não autenticado');
  return currentUser.getIdToken();
}}
onVideoGenerated={(productId, videoUrl, jobId) => {
  setProducts((prev) =>
    prev.map((p) =>
      p._id === productId
        ? { ...p, _videoUrl: videoUrl, _videoJobId: jobId, _videoStatus: 'done' as const }
        : p,
    ),
  );
}}
```

Nota: `user` já é state em App.tsx (`const [user, setUser] = useState<User | null>(null)`), e `auth` já está importado de `./firebase`.

- [ ] **Step 6: Verificar tipos**

```bash
npm run lint
```
Esperado: sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add src/components/modals/ProductEditModal.tsx src/App.tsx
git commit -m "feat(video): integrate VideoGenerationTab into ProductEditModal"
```

---

## Task 7: Teste manual end-to-end

**Files:** Nenhum arquivo novo — apenas validação.

- [ ] **Step 1: Iniciar o servidor de desenvolvimento**

```bash
npm run dev
```
Esperado: servidor iniciado em `http://localhost:3000` sem erros.

- [ ] **Step 2: Verificar que `Application Default Credentials` estão configuradas**

```bash
gcloud auth application-default print-access-token
```
Se falhar com "not found": executar `gcloud auth application-default login` e logar com a conta GCP que tem acesso ao projeto `project-95918f0d-50bb-4f66-a0d`.

Verificar que a API Vertex AI está habilitada no projeto:
```bash
gcloud services list --enabled --filter="name:aiplatform.googleapis.com" --project=project-95918f0d-50bb-4f66-a0d
```
Se não estiver: `gcloud services enable aiplatform.googleapis.com --project=project-95918f0d-50bb-4f66-a0d`

- [ ] **Step 3: Testar pré-requisitos bloqueantes**

Abrir um produto SEM descrição complementar. Clicar na aba "Vídeo". Verificar:
- Item "Descrição complementar gerada" aparece com ícone amarelo
- Botão "Próximo: Escolher Imagem" fica desabilitado
- Link "Ir para IA" navega para a aba `ia`

- [ ] **Step 4: Testar fluxo completo com produto que tem imagens**

Abrir um produto COM `_ambientImages` e `Descrição complementar`. Verificar:
1. Todos os pré-requisitos em verde → botão "Próximo" habilitado
2. Grid de imagens exibe corretamente com hover e seleção
3. "Gerar Roteiro" chama `/api/video/generate-script` e exibe 3 campos
4. Campos do roteiro são editáveis
5. "Aprovar e Gerar Vídeo" chama `/api/video/start-job` e exibe spinner
6. Fechar e reabrir o modal → aba vídeo exibe status de processamento (via onSnapshot)
7. Após conclusão: player de vídeo e botão download aparecem

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "feat(video): video generation feature complete and manually tested"
```
