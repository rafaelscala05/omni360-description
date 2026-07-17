// Tiny ERP product webhook (API v2 "envio de produtos"): receives one product
// per POST (parent + nested variações), synchronously, and must answer with
// the mapping array Tiny expects. This module normalizes the payload into the
// shared TinyNormalizedProduct shape so it can reuse tinyImportWorker's upsert.
// Docs: https://tiny.com.br/api-docs/api2-webhooks-envio-produtos
import express from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { num } from './tinyV2';
import { STATUS_REF } from './tinyAgent';
import type { TinyNormalizedProduct } from './tinyAgent';
import { upsertProduct } from './tinyImportWorker';

function collectWebhookImages(p: any): string[] {
  const urls: string[] = [];
  if (Array.isArray(p?.anexos)) {
    for (const a of p.anexos) {
      const u = a?.url;
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  return Array.from(new Set(urls));
}

function normalizeWebhookParent(p: any): TinyNormalizedProduct {
  const seo = p?.seo ?? {};
  const arvore = p?.descricaoArvoreCategoria || p?.descricaoCategoria;
  return {
    tinyId: String(p?.id),
    sku: p?.codigo ?? '',
    nome: p?.nome ?? '',
    descricaoHtml: p?.descricaoComplementar || undefined,
    seoTitle: seo?.title || undefined,
    seoDescription: seo?.description || undefined,
    seoKeywords: seo?.keywords || undefined,
    linkVideo: seo?.linkVideo || undefined,
    slug: seo?.slug || undefined,
    ncm: p?.ncm || undefined,
    gtin: p?.gtin || undefined,
    pesoLiquido: num(p?.pesoLiquido),
    pesoBruto: num(p?.pesoBruto),
    largura: num(p?.larguraEmbalagem),
    altura: num(p?.alturaEmbalagem),
    comprimento: num(p?.comprimentoEmbalagem),
    precoPor: num(p?.preco),
    precoDe: num(p?.precoPromocional),
    estoque: num(p?.estoqueAtual),
    estoqueMinimo: num(p?.estoqueMinimo),
    estoqueMaximo: num(p?.estoqueMaximo),
    localizacao: p?.localizacao || undefined,
    marca: p?.marca || undefined,
    garantia: p?.garantia || undefined,
    sobEncomenda: p?.sobEncomenda || undefined,
    cest: p?.cest || undefined,
    diasPreparacao: num(p?.diasPreparacao),
    obs: p?.obs || undefined,
    unidadePorCaixa: p?.unidadePorCaixa || undefined,
    codigoFornecedor: p?.codigoFornecedor || undefined,
    unidade: p?.unidade || undefined,
    categorias: arvore ? [String(arvore)] : [],
    imagens: collectWebhookImages(p),
    raw: p,
  };
}

// Tiny doesn't send a display name per variação — reuse its own codigo so the
// row is identifiable in the product list.
function normalizeWebhookVariacao(v: any, parentCodigo: string): TinyNormalizedProduct {
  const grade = Array.isArray(v?.grade)
    ? v.grade.map((g: any) => `${g?.chave}: ${g?.valor}`).filter(Boolean).join(', ')
    : undefined;
  return {
    tinyId: String(v?.id),
    sku: v?.codigo ?? '',
    nome: v?.codigo ?? '',
    gtin: v?.gtin || undefined,
    precoPor: num(v?.preco),
    precoDe: num(v?.precoPromocional),
    estoque: num(v?.estoqueAtual),
    codigoPai: parentCodigo || undefined,
    variacaoGrade: grade || undefined,
    categorias: [],
    imagens: collectWebhookImages(v),
    raw: v,
  };
}

export function normalizeWebhookPayload(dados: any): { parent: TinyNormalizedProduct; variacoes: TinyNormalizedProduct[] } {
  const parent = normalizeWebhookParent(dados);
  const variacoes = Array.isArray(dados?.variacoes)
    ? dados.variacoes.map((v: any) => normalizeWebhookVariacao(v, parent.sku))
    : [];
  return { parent, variacoes };
}

// --- Routes ------------------------------------------------------------

const digitsOnly = (s: string): string => s.replace(/\D/g, '');

interface Deps {
  verifyFirebaseToken: (req: express.Request) => Promise<{ uid: string }>;
}

export function registerTinyWebhookRoutes(app: express.Express, { verifyFirebaseToken }: Deps): void {
  // Authenticated: set CNPJ / sync mode, (re)generate the webhook secret.
  app.post('/api/tiny/webhook/config', async (req, res) => {
    try {
      const { uid } = await verifyFirebaseToken(req);
      const body = req.body ?? {};
      const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (typeof body.cnpj === 'string') update.cnpj = digitsOnly(body.cnpj);
      if (body.syncMode === 'polling' || body.syncMode === 'webhook') update.syncMode = body.syncMode;

      const statusSnap = await STATUS_REF(uid).get();
      const cur = statusSnap.data() ?? {};
      let secret = cur.webhookSecret as string | undefined;
      if (!secret || body.regenerateSecret === true) {
        secret = crypto.randomBytes(24).toString('hex');
        update.webhookSecret = secret;
      }

      await STATUS_REF(uid).set(update, { merge: true });

      const webhookUrl = `${req.protocol}://${req.get('host')}/api/tiny/webhook/${uid}/${secret}`;
      return res.json({
        webhookUrl,
        cnpj: update.cnpj ?? cur.cnpj ?? '',
        syncMode: update.syncMode ?? cur.syncMode ?? 'polling',
      });
    } catch (e: any) {
      return res.status(e?.status === 401 ? 401 : 500).json({ message: e?.message ?? 'Falha ao salvar configuração do webhook.' });
    }
  });

  // Public: Tiny calls this synchronously when the merchant sends products to
  // the e-commerce. No documented auth from Tiny's side, so the URL carries a
  // per-user secret and we cross-check the cnpj in the envelope. `type: () =>
  // true` makes this route parse the body as JSON regardless of the
  // Content-Type header Tiny sends (undocumented) — body-parser no-ops if the
  // global express.json() already consumed the body.
  app.post('/api/tiny/webhook/:uid/:secret', express.json({ type: () => true }), async (req, res) => {
    const { uid, secret } = req.params;
    try {
      const statusSnap = await STATUS_REF(uid).get();
      const settings = statusSnap.data() ?? {};
      if (settings.syncMode !== 'webhook' || !settings.webhookSecret || settings.webhookSecret !== secret) {
        console.warn(`[tiny-webhook] rejeitado uid=${uid}: secret inválido ou syncMode != webhook`);
        return res.status(403).json({ message: 'Webhook não habilitado ou secret inválido.' });
      }

      const cnpjRecebido = digitsOnly(String(req.body?.cnpj ?? ''));
      const cnpjEsperado = digitsOnly(String(settings.cnpj ?? ''));
      if (!cnpjEsperado || cnpjRecebido !== cnpjEsperado) {
        console.warn(`[tiny-webhook] rejeitado uid=${uid}: cnpj não confere`);
        return res.status(403).json({ message: 'CNPJ não confere.' });
      }

      const dados = req.body?.dados;
      if (!dados || typeof dados !== 'object') {
        return res.status(400).json({ message: 'Payload inválido: campo dados ausente.' });
      }

      const { parent, variacoes } = normalizeWebhookPayload(dados);
      const items = [parent, ...variacoes];
      const resultados: Array<{ idMapeamento: string; skuMapeamento: string; error?: string }> = [];

      for (const item of items) {
        try {
          const docId = await upsertProduct(uid, item, 'tiny-webhook');
          resultados.push({ idMapeamento: docId, skuMapeamento: item.sku || '' });
        } catch (e: any) {
          console.error(`[tiny-webhook] falha ao salvar tinyId=${item.tinyId} uid=${uid}: ${e?.message}`);
          resultados.push({ idMapeamento: item.tinyId, skuMapeamento: item.sku || '', error: e?.message ?? 'Falha ao salvar produto.' });
        }
      }

      await STATUS_REF(uid).set({
        webhookStats: {
          lastReceivedAt: new Date().toISOString(),
          totalReceived: FieldValue.increment(items.length),
        },
      }, { merge: true });

      console.log(`[tiny-webhook] uid=${uid} recebeu ${items.length} item(ns) (produto ${parent.tinyId})`);
      return res.status(200).json(resultados);
    } catch (e: any) {
      console.error(`[tiny-webhook] erro inesperado uid=${uid}: ${e?.message}`);
      return res.status(500).json({ message: 'Erro ao processar webhook.' });
    }
  });
}
