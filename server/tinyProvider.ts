// Version-aware dispatch layer for the Tiny integration. The background worker and
// the push route call these functions; they resolve the user's active API version
// (v2 = static token, v3 = OAuth) and delegate to the matching client.
import type express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import {
  tinyFetch, normalizeProduct, buildProductPutBody, SECRET_REF, STATUS_REF,
  type TinyNormalizedProduct, type TinyPushProduct, type TinyPushResult, type TinyPushSteps,
} from './tinyAgent';
import { listV2Page, getV2Product, updateV2Product, validateV2Token } from './tinyV2';

export type TinyVersion = 'v2' | 'v3';

// The push route fetches each product live from Tiny before diffing, sequentially,
// inside a single HTTP request. Cap the batch to keep the request from timing out
// and to bound the cost of an unfiltered "all Tiny-linked products" push.
const MAX_PUSH_BATCH = 50;

export async function getActiveVersion(uid: string): Promise<TinyVersion | null> {
  const snap = await SECRET_REF(uid).get();
  const d = snap.data();
  if (!d) return null;
  if (d.version === 'v2' || d.version === 'v3') return d.version;
  // Legacy secrets (connected before versioning): infer from the stored fields.
  if (d.accessToken) return 'v3';
  if (d.token) return 'v2';
  return null;
}

// --- v3 provider impl ------------------------------------------------------

async function listV3Page(
  uid: string,
  opts: { offset: number; mode: 'full' | 'update'; sinceISO?: string | null },
): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  const params = new URLSearchParams({ situacao: 'A', limit: '50', offset: String(opts.offset) });
  if (opts.mode === 'update' && opts.sinceISO) params.set('dataAlteracao', opts.sinceISO.slice(0, 10));
  const page = await tinyFetch<any>(uid, 'GET', `/produtos?${params.toString()}`);
  const itens: any[] = Array.isArray(page?.itens) ? page.itens : [];
  const total = Number(page?.paginacao?.total ?? 0);
  const items = itens.map((i) => ({ id: String(i.id) }));
  return { items, total, done: items.length < 50 || (total > 0 && opts.offset + items.length >= total) };
}

// --- Dispatch --------------------------------------------------------------

export async function tinyListPage(
  uid: string,
  opts: { offset: number; mode: 'full' | 'update'; sinceISO?: string | null },
  version?: TinyVersion,
): Promise<{ items: { id: string }[]; total: number; done: boolean }> {
  const v = version ?? await getActiveVersion(uid);
  return v === 'v2' ? listV2Page(uid, opts) : listV3Page(uid, opts);
}

export async function tinyGetProduct(uid: string, id: string, version?: TinyVersion): Promise<TinyNormalizedProduct> {
  const v = version ?? await getActiveVersion(uid);
  if (v === 'v2') return getV2Product(uid, id);
  return normalizeProduct(await tinyFetch<any>(uid, 'GET', `/produtos/${id}`));
}

export async function tinyUpdateProduct(uid: string, id: string, prod: TinyPushProduct, version?: TinyVersion, sobrescreverTitulo = true): Promise<TinyPushSteps> {
  const v = version ?? await getActiveVersion(uid);
  if (v === 'v2') return updateV2Product(uid, id, prod, sobrescreverTitulo);
  const current = await tinyFetch<any>(uid, 'GET', `/produtos/${id}`);
  const { body, steps } = buildProductPutBody(current, prod, sobrescreverTitulo);
  const hasAnyChange = steps.titulo === 'ok' || steps.descricao === 'ok' || steps.seo === 'ok' || steps.fiscal === 'ok' || steps.imagens === 'ok';
  if (hasAnyChange) await tinyFetch(uid, 'PUT', `/produtos/${id}`, body);
  return steps;
}

// --- Routes (push + v2 connect) --------------------------------------------

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerTinyProviderRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // v2 connect: validate the integration token and persist it as the active version.
  app.post('/api/tiny/v2/validate', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const token: string | undefined = req.body?.token?.trim();
      if (!token) return res.status(400).json({ valid: false, message: 'Token obrigatório.' });

      await validateV2Token(token);

      await SECRET_REF(uid).set({ version: 'v2', token, updatedAt: FieldValue.serverTimestamp() });
      await STATUS_REF(uid).set({
        connected: true, validated: true, apiVersion: 'v2',
        connectedAt: FieldValue.serverTimestamp(), lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ valid: true, message: 'Conectado com sucesso (v2).' });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 400).json({ valid: false, message: e?.message ?? 'Falha na validação.' });
    }
  });

  // Push enriched fields back to Tiny (works for v2 and v3 via the provider).
  app.post('/api/tiny/push', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const version = await getActiveVersion(uid);
      if (!version) return res.status(400).json({ message: 'Tiny não conectado.' });

      const produtos: TinyPushProduct[] = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      const sobrescreverTitulo = req.body?.sobrescreverTitulo !== false;
      if (produtos.length > MAX_PUSH_BATCH) {
        return res.status(400).json({
          message: `Selecione no máximo ${MAX_PUSH_BATCH} produtos por envio. Marque produtos específicos na lista antes de enviar.`,
        });
      }
      const resultados: TinyPushResult[] = [];

      for (const prod of produtos) {
        if (!prod.tinyId) {
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: false, steps: {
            titulo: 'Sem ID Tiny', descricao: 'Sem ID Tiny', seo: 'Sem ID Tiny', fiscal: 'Sem ID Tiny', imagens: 'Sem ID Tiny',
          } });
          continue;
        }
        try {
          const steps = await tinyUpdateProduct(uid, prod.tinyId, prod, version, sobrescreverTitulo);
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: true, steps });
        } catch (e: any) {
          const msg = e?.message ?? 'erro';
          resultados.push({ tinyId: prod.tinyId, sku: prod.sku, ok: false, steps: {
            titulo: msg, descricao: msg, seo: msg, fiscal: msg, imagens: msg,
          } });
        }
      }
      return res.json({ resultados });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha no envio.' });
    }
  });
}
