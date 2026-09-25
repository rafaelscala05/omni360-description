import { adminDb } from '../firebaseAdmin';
import { scheduleAnalysis } from './analysis';
import { scheduleSyncJob } from './sync';
import { scheduleMutation } from './mutations';

let timer: NodeJS.Timeout | null = null;
let running = false;

function uidFromJobPath(path: string): string | null {
  const match = path.match(/^users\/([^/]+)\/(?:meli_jobs|meli_listing_analyses|meli_webhook_events|meli_mutation_runs)\/[^/]+$/);
  return match?.[1] || null;
}

export async function recoverMeliWork(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const [jobs, analyses, webhooks, mutations] = await Promise.all([
      adminDb.collectionGroup('meli_jobs').where('status', 'in', ['queued', 'running', 'retry_scheduled']).limit(200).get(),
      adminDb.collectionGroup('meli_listing_analyses').where('status', 'in', ['queued', 'running']).limit(200).get(),
      adminDb.collectionGroup('meli_webhook_events').where('status', '==', 'processing').limit(200).get(),
      adminDb.collectionGroup('meli_mutation_runs').where('status', 'in', ['queued', 'running', 'verifying']).limit(100).get(),
    ]);
    const now = Date.now();
    jobs.docs.forEach((doc) => {
      const data = doc.data();
      if (!['queued', 'running', 'retry_scheduled'].includes(data.status)) return;
      if (data.processingLeaseUntil && data.processingLeaseUntil > now) return;
      const uid = uidFromJobPath(doc.ref.path);
      if (uid) scheduleSyncJob(uid, doc.id);
    });
    analyses.docs.forEach((doc) => {
      const data = doc.data();
      if (!['queued', 'running'].includes(data.status)) return;
      if (data.processingLeaseUntil && data.processingLeaseUntil > now) return;
      const uid = uidFromJobPath(doc.ref.path);
      if (uid) scheduleAnalysis(uid, doc.id);
    });
    mutations.docs.forEach((doc) => {
      const data = doc.data();
      if (!['queued', 'running', 'verifying'].includes(data.status)) return;
      if (data.processingLeaseUntil && data.processingLeaseUntil > now) return;
      const uid = uidFromJobPath(doc.ref.path);
      if (uid) scheduleMutation(uid, doc.id);
    });
    await Promise.all(webhooks.docs.map(async (doc) => {
      const uid = uidFromJobPath(doc.ref.path);
      const jobIds = Array.isArray(doc.data().jobIds) ? doc.data().jobIds.map(String) : [];
      if (!uid || !jobIds.length) return;
      const jobDocs = await Promise.all(jobIds.map((jobId) => adminDb.collection('users').doc(uid).collection('meli_jobs').doc(jobId).get()));
      const statuses = jobDocs.map((job) => job.data()?.status || 'missing');
      if (statuses.some((status) => ['queued', 'running', 'retry_scheduled', 'waiting_for_consistency'].includes(status))) return;
      const status = statuses.every((value) => value === 'succeeded') ? 'processed'
        : statuses.some((value) => value === 'succeeded' || value === 'partial') ? 'partial' : 'failed';
      await doc.ref.set({ status, reconciledAt: new Date().toISOString(), jobStatuses: statuses }, { merge: true });
    }));
  } catch (error) {
    console.warn('[meli-scheduler] recuperação falhou', error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

export function startMeliScheduler(): void {
  if (timer) return;
  void recoverMeliWork();
  timer = setInterval(() => void recoverMeliWork(), 60_000);
  timer.unref?.();
}
