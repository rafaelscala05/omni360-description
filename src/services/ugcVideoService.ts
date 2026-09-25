// src/services/ugcVideoService.ts
//
// Client contract for the UGC video pipeline — mirrors src/services/videoService.ts.
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';

export interface UgcVideoClip {
  papel: 'gancho' | 'demonstracao' | 'cta';
  fala: string;
  acaoVisual: string;
}

export interface UgcVideoScript {
  cena: string;
  avatarDescricao: string;
  clipes: UgcVideoClip[]; // 2 a 3 itens
}

export type UgcVideoJobStatus = 'queued' | 'processing' | 'done' | 'error';
export type UgcVideoJobStep = 'clip' | 'post' | 'uploading';

export interface UgcVideoJob {
  jobId: string;
  productId: string;
  status: UgcVideoJobStatus;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  clipsDone?: number;
  totalClips?: number;
  step?: UgcVideoJobStep;
}

export async function generateUgcVideoScript(
  idToken: string,
  params: {
    description: string;
    brand?: string;
    productImageUrl: string;
    avatarImageUrl: string;
    avatarDescricao: string;
    productName?: string;
    category?: string;
    attributes?: Record<string, string>;
  },
): Promise<UgcVideoScript> {
  const res = await fetch('/api/video/ugc/generate-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return (data as any).script as UgcVideoScript;
}

export async function startUgcVideoJob(
  idToken: string,
  params: {
    productId: string; productName: string; script: UgcVideoScript; avatarImageUrl: string; productImageUrl: string;
    productReferenceUrl: string;
  },
): Promise<string> {
  const res = await fetch('/api/video/ugc/start-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
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

export function listenUgcVideoJob(uid: string, jobId: string, cb: (job: UgcVideoJob) => void): () => void {
  return onSnapshot(doc(db, 'users', uid, 'ugcVideoJobs', jobId), (snap) => {
    if (snap.exists()) cb(snap.data() as UgcVideoJob);
  });
}

// Pure progress-bar calculation — mirrors computeVideoProgress() in VideoGenerationTab.tsx.
export function computeUgcVideoProgress(job: UgcVideoJob | null): { pct: number; label: string } {
  if (!job || job.status === 'queued') return { pct: 2, label: 'Aguardando na fila...' };
  if (job.status === 'done') return { pct: 100, label: 'Concluído!' };

  const step = job.step;
  const total = job.totalClips ?? 3;
  const done = job.clipsDone ?? 0;

  if (!step || step === 'clip') {
    const pct = Math.min(5 + Math.round((done / total) * 80), 85);
    return { pct, label: `${done} de ${total} clipes prontos — aguarde 2 a 4 min` };
  }
  if (step === 'post') return { pct: 90, label: 'Montando vídeo final...' };
  return { pct: 96, label: 'Enviando vídeo...' };
}
