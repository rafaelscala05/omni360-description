import { FieldValue, adminDb } from '../firebaseAdmin';
import { meliLimiterSnapshot } from './rateLimit';

const METRICS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_metrics');

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function endpointKey(endpoint: string): string {
  return endpoint.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80) || 'root';
}

export function recordMeliApiCall(uid: string, endpoint: string, status: number, latencyMs: number, retried: boolean): void {
  const fields: Record<string, unknown> = {
    date: dayKey(), updatedAt: new Date().toISOString(), calls: FieldValue.increment(1),
    latencyTotalMs: FieldValue.increment(Math.max(0, Math.round(latencyMs))),
    statuses: { [String(status || 0)]: FieldValue.increment(1) },
    endpoints: { [endpointKey(endpoint)]: FieldValue.increment(1) },
  };
  if (status === 429) fields.rateLimited = FieldValue.increment(1);
  if (retried) fields.retries = FieldValue.increment(1);
  void METRICS_REF(uid).doc(dayKey()).set(fields, { merge: true }).catch(() => undefined);
}

function countBy<T extends Record<string, any>>(values: T[], key: keyof T): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    const name = String(value[key] ?? 'unknown');
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
}

export async function getMeliOperationalMetrics(uid: string) {
  const root = adminDb.collection('users').doc(uid);
  const [listings, jobs, analyses, proposals, mutations, webhooks, today] = await Promise.all([
    root.collection('meli_listings').get(), root.collection('meli_jobs').get(),
    root.collection('meli_listing_analyses').get(), root.collection('meli_listing_proposals').get(),
    root.collection('meli_mutation_runs').get(),
    root.collection('meli_webhook_events').get(), METRICS_REF(uid).doc(dayKey()).get(),
  ]);
  const listingValues = listings.docs.map((doc) => doc.data());
  const jobValues = jobs.docs.map((doc) => doc.data());
  const analysisValues = analyses.docs.map((doc) => doc.data());
  const proposalValues = proposals.docs.map((doc) => doc.data());
  const mutationValues = mutations.docs.map((doc) => doc.data());
  const webhookValues = webhooks.docs.map((doc) => doc.data());
  const api = today.data() || {};
  const calls = Number(api.calls || 0);
  return {
    listings: { total: listings.size, byStatus: countBy(listingValues, 'status') },
    jobs: { total: jobs.size, byStatus: countBy(jobValues, 'status') },
    analyses: { total: analyses.size, byStatus: countBy(analysisValues, 'status') },
    proposals: { total: proposals.size, byStatus: countBy(proposalValues, 'status') },
    mutations: { total: mutations.size, byStatus: countBy(mutationValues, 'status') },
    webhooks: { total: webhooks.size, byStatus: countBy(webhookValues, 'status'), byTopic: countBy(webhookValues, 'topic') },
    apiToday: {
      calls, retries: Number(api.retries || 0), rateLimited: Number(api.rateLimited || 0),
      averageLatencyMs: calls ? Math.round(Number(api.latencyTotalMs || 0) / calls) : 0,
      statuses: api.statuses || {}, endpoints: api.endpoints || {},
    },
    limiter: meliLimiterSnapshot(uid),
    generatedAt: new Date().toISOString(),
  };
}
