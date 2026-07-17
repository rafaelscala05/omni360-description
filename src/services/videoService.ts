import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';

export interface VideoScriptShot {
  acao: string;     // o que acontece visualmente (câmera + manipulação do produto)
  narracao: string; // texto da locução em off (voz por cima) deste trecho
}

// Vídeo vertical (9:16) de ~30s, dividido em 4 shots encadeados (8+8+8+6s)
// formando a estrutura Início → Meio → Fim, conforme boas práticas de
// vídeo para e-commerce. O áudio é montado depois (TTS + música), portanto
// o vídeo é gerado MUDO e SEM lip sync.
export interface VideoScript {
  cena: string;   // ambientação/visual geral coerente em todos os shots
  trilha: string; // mood da música de fundo (ex.: "upbeat, leve, moderna")
  inicio: VideoScriptShot;           // 0–8s  — Hook: chama atenção e apresenta o produto
  meioDemonstracao: VideoScriptShot; // 8–16s — Meio: produto em uso / funcionamento
  meioBeneficios: VideoScriptShot;   // 16–24s — Meio: close-ups de 2–3 atributos/benefícios
  fim: VideoScriptShot;              // 24–30s — Fim: fechamento + chamada para ação
}

export type VideoJobStatus = 'queued' | 'processing' | 'done' | 'error';
export type VideoJobStep = 'shot' | 'post' | 'uploading';

export interface VideoJob {
  jobId: string;
  productId: string;
  status: VideoJobStatus;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** Number of shots already generated (shots run in parallel), written by the server */
  shotsDone?: number;
  /** Total number of shots (always 4) */
  totalShots?: number;
  /** Current pipeline step */
  step?: VideoJobStep;
}

export async function generateVideoScript(
  idToken: string,
  params: {
    description: string;
    brand?: string;
    imageUrl: string;
    productName?: string;
    category?: string;
    /** Atributos do produto (rótulo → valor) para enriquecer o roteiro */
    attributes?: Record<string, string>;
  },
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
  // The server keeps the HTTP connection open for the duration of the job so
  // Cloud Run doesn't kill the instance. We only need the first chunk, which
  // contains the complete jobId JSON. The connection closes when job finishes.
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const data = JSON.parse(new TextDecoder().decode(value ?? new Uint8Array()));
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
