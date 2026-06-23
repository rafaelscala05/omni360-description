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
    throw new Error((body as any).error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return (data as any).script as VideoScript;
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
    throw new Error((body as any).error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return (data as any).jobId as string;
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
