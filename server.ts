import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
// Admin SDK init lives in a shared leaf module so server/contentAgent.ts can also
// use adminDb/adminAuth without re-triggering this server's bootstrap.
import { adminDb, adminAuth, adminStorage, FieldValue } from "./server/firebaseAdmin";
import { assertSafeImageUrl } from "./server/safeUrl";
import firebaseAppletConfig from "./firebase-applet-config.json";

const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;
import { registerContentRoutes, startContentScheduler } from "./server/contentAgent";
import { registerSeoRoutes } from "./server/seoAgent";
import { registerVideoRoutes } from "./server/videoAgent";
import { registerWakeRoutes } from "./server/wakeAgent";
import { registerTinyRoutes } from "./server/tinyAgent";
import { registerTinyImportRoutes, startTinyScheduler } from "./server/tinyImportWorker";
import { registerTinyProviderRoutes } from "./server/tinyProvider";
import { registerTinyWebhookRoutes } from "./server/tinyWebhook";
import { registerBlingRoutes } from "./server/blingAgent";
import { registerBlingImportRoutes, startBlingScheduler } from "./server/blingImportWorker";
import { registerBlingWebhookRoutes } from "./server/blingWebhook";
import { registerIdworksRoutes } from "./server/idworksAgent";
import { registerIdworksImportRoutes, startIdworksScheduler } from "./server/idworksImportWorker";
import { registerIdworksWebhookRoutes } from "./server/idworksWebhook";
import { registerMercadoLivreWebhookRoutes } from "./server/mercadoLivreWebhook";
import { registerBlogPublic } from "./server/blogPublic";
import { registerBlogAdminRoutes } from "./server/blogAdmin";
import { registerMetaEventsRoutes } from "./server/metaEvents";
import { registerTiktokEventsRoutes } from "./server/tiktokEvents";
import { registerOnboardingRoutes } from "./server/onboardingAgent";
import { registerReferralRoutes } from "./server/referralAgent";
import { registerProductImportRoutes } from "./server/productImport";
import { recordEvent, registerCrmEventRoutes } from "./server/crmEvents";
import { registerCrmAdminRoutes } from "./server/crmAdmin";
import { registerOperationsRoutes } from "./server/agent/routes";
import { registerCopilotRuntime } from "./server/copilotRuntime";
import { startCrmScheduler } from "./server/crmReconcile";
import { startAutomationScheduler } from "./server/crmAutomation";

// Do NOT override: in production the App Hosting environment (apphosting.yaml /
// Secret Manager) must take precedence over any stray .env bundled in the image.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyFirebaseToken(req: express.Request): Promise<import('firebase-admin/auth').DecodedIdToken> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing auth token'), { status: 401 });
  }
  const idToken = authHeader.split('Bearer ')[1];
  return adminAuth.verifyIdToken(idToken);
}

// Asaas hosts (api.asaas.com / api-sandbox.asaas.com) expose the API under /v3,
// NOT /api/v3. Self-heal a stray /api segment and trailing slashes so a
// misconfigured ASAAS_BASE_URL still produces the correct path instead of an
// empty-body 404.
function getAsaasBaseUrl(): string {
  const raw = (process.env.ASAAS_BASE_URL || '').trim().replace(/\/+$/, '');
  return raw.replace(/\/api\/v3$/, '/v3');
}

// Valida um cupom contra a coleção `coupons` no Firestore e calcula o valor com
// desconto. Documento: id = código em maiúsculas, campos
// { active: boolean, type: 'percent' | 'fixed', value: number, minCredits?: number }.
// O desconto incide apenas sobre o valor pago; a quantidade de créditos é mantida.
// Retorna `{ error }` quando inválido, ou os valores calculados quando válido.
type CouponResult =
  | { error: string }
  | { code: string; baseAmount: number; amount: number; discount: number };

async function resolveCoupon(coupon: string, credits: number, baseAmount: number): Promise<CouponResult> {
  const code = coupon.trim().toUpperCase();
  const snap = await adminDb.collection('coupons').doc(code).get();
  const data = snap.exists ? snap.data() as {
    active?: boolean; type?: string; value?: number; minCredits?: number;
  } : null;

  if (!data || data.active === false) {
    return { error: 'Cupom inválido ou expirado' };
  }
  if (data.minCredits && credits < data.minCredits) {
    return { error: `Este cupom exige no mínimo ${data.minCredits} créditos` };
  }

  const value = Number(data.value) || 0;
  const rawDiscount = data.type === 'percent'
    ? Math.round(baseAmount * (value / 100) * 100) / 100
    : Math.round(value * 100) / 100;

  // O valor mínimo de cobrança no Asaas é R$ 5,00.
  const amount = Math.max(5, Math.round((baseAmount - rawDiscount) * 100) / 100);
  const discount = Math.round((baseAmount - amount) * 100) / 100;
  return { code, baseAmount, amount, discount };
}

async function getOrCreateAsaasCustomer(
  name: string,
  cpfCnpj: string,
  email: string,
): Promise<string> {
  const baseUrl = getAsaasBaseUrl();
  const apiKey = process.env.ASAAS_API_KEY!;
  const headers: Record<string, string> = { 'access_token': apiKey, 'Content-Type': 'application/json' };

  const rawCpfCnpj = cpfCnpj.replace(/\D/g, '');

  const listUrl = `${baseUrl}/customers?cpfCnpj=${rawCpfCnpj}&limit=1`;
  console.log(`Asaas list customers → ${listUrl} (key ${apiKey ? 'present' : 'MISSING'})`);
  const listResp = await fetch(listUrl, { headers });
  if (!listResp.ok) {
    const body = await listResp.text();
    throw new Error(`Asaas list customers failed: ${listResp.status} — ${body} [url=${listUrl}]`);
  }
  const listData = await listResp.json() as { data: Array<{ id: string }> };

  if (listData.data.length > 0) return listData.data[0].id;

  const createResp = await fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, cpfCnpj: rawCpfCnpj, email }),
  });
  if (!createResp.ok) {
    const body = await createResp.text();
    throw new Error(`Asaas create customer failed: ${createResp.status} — ${body}`);
  }
  const customer = await createResp.json() as { id: string };
  return customer.id;
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Agente de Conteúdo conversacional (CopilotKit -> LangGraph.js). Precisa ir
  // ANTES do express.json() global abaixo: o handler v2 do CopilotKit consome
  // o corpo da requisição como stream fetch-native (Readable -> Request), e
  // express.json() já teria drenado esse stream para req.body se viesse primeiro.
  registerCopilotRuntime(app);

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Agência de Criação de Conteúdo (Alfred) — server-side AI pipeline + scheduler.
  registerContentRoutes(app, { verifyFirebaseToken });
  registerSeoRoutes(app, { verifyFirebaseToken });
  registerVideoRoutes(app, { verifyFirebaseToken });
  registerWakeRoutes(app, { verifyFirebaseToken });
  registerTinyRoutes(app, { verifyFirebaseToken });
  registerTinyProviderRoutes(app, { verifyFirebaseToken });
  registerTinyImportRoutes(app, { verifyFirebaseToken });
  registerTinyWebhookRoutes(app, { verifyFirebaseToken });
  registerBlingRoutes(app, { verifyFirebaseToken });
  registerBlingImportRoutes(app, { verifyFirebaseToken });
  registerBlingWebhookRoutes(app, { verifyFirebaseToken });
  registerIdworksRoutes(app, { verifyFirebaseToken });
  registerIdworksImportRoutes(app, { verifyFirebaseToken });
  registerIdworksWebhookRoutes(app, { verifyFirebaseToken });
  registerMercadoLivreWebhookRoutes(app);
  registerMetaEventsRoutes(app);
  registerTiktokEventsRoutes(app);

  // Onboarding wizard (CNPJ lookup + credit bonus) e Indique e Ganhe (referral).
  registerOnboardingRoutes(app, { verifyFirebaseToken });
  registerReferralRoutes(app, { verifyFirebaseToken });
  registerProductImportRoutes(app, { verifyFirebaseToken });

  // CRM admin: beacon de eventos do client (/api/events) e as rotas /api/admin/*.
  registerCrmEventRoutes(app, { verifyFirebaseToken });
  registerCrmAdminRoutes(app, { verifyFirebaseToken });

  // Agente Operacional (chat que opera Wake/Tiny com aprovação por ação).
  registerOperationsRoutes(app, { verifyFirebaseToken });

  // Blog nativo (CMS) — serving público SSR. Precisa vir antes do Vite/static
  // para que /b/{slug} e domínios customizados não caiam no SPA.
  registerBlogPublic(app);
  registerBlogAdminRoutes(app, { verifyFirebaseToken });

  // API routes FIRST (image upload — all AI generation now runs client-side via Firebase AI Logic)

  app.post("/api/upload", async (req, res) => {
    try {
      let uid: string;
      try {
        uid = (await verifyFirebaseToken(req)).uid;
      } catch {
        return res.status(401).json({ error: "Não autorizado" });
      }

      const { imageBase64, imageUrl, filename } = req.body;

      let data = '';
      let extension = 'png';
      let contentType = 'image/png';

      if (imageBase64) {
        const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        data = imageBase64;

        if (matches && matches.length === 3) {
          data = matches[2];
          contentType = matches[1];
          if (contentType === 'image/jpeg') extension = 'jpg';
          else if (contentType === 'image/webp') extension = 'webp';
        }
      } else if (imageUrl) {
        try {
          await assertSafeImageUrl(imageUrl);
          const response = await fetch(imageUrl, { redirect: 'error' });
          if (!response.ok) throw new Error("Failed to fetch image");
          const arrayBuffer = await response.arrayBuffer();
          data = Buffer.from(arrayBuffer).toString('base64');

          contentType = response.headers.get('content-type') || 'image/png';
          if (contentType === 'image/jpeg') extension = 'jpg';
          else if (contentType === 'image/webp') extension = 'webp';
          else if (contentType === 'image/gif') extension = 'gif';
        } catch (e) {
          console.error("Error downloading image from URL:", e);
          return res.status(400).json({ error: "Failed to download image from URL" });
        }
      } else {
        return res.status(400).json({ error: "No image provided" });
      }

      // Uploaded to Firebase Storage (not local disk): App Hosting instances have
      // an ephemeral, per-instance filesystem, so files written to ./uploads were
      // lost on every deploy, restart, or scale-out.
      const safeFilename = filename ? filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() : `img_${Date.now()}`;
      const finalFilename = `${safeFilename}_${Date.now()}.${extension}`;
      const storagePath = `manual-uploads/${uid}/${finalFilename}`;
      const downloadToken = crypto.randomUUID();
      const bucket = adminStorage.bucket(STORAGE_BUCKET);
      await bucket.file(storagePath).save(Buffer.from(data, 'base64'), {
        contentType,
        metadata: {
          cacheControl: 'public, max-age=31536000',
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const url = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

      res.json({ url });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to save image" });
    }
  });

  // Valida um cupom e retorna o valor com desconto, sem criar cobrança.
  // Usado pelo modal de compra para mostrar o total antes de ir ao Asaas.
  app.post('/api/payments/validate-coupon', async (req, res) => {
    try {
      await verifyFirebaseToken(req);
      const { credits, coupon } = req.body as { credits: number; coupon?: string };

      if (!credits || !Number.isInteger(credits) || credits < 10 || credits % 10 !== 0) {
        return res.status(400).json({ error: 'credits deve ser inteiro, múltiplo de 10 e mínimo 10' });
      }
      if (!coupon?.trim()) {
        return res.status(400).json({ error: 'coupon é obrigatório' });
      }

      const baseAmount = Math.round(credits * 0.5 * 100) / 100;
      const result = await resolveCoupon(coupon, credits, baseAmount);
      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }

      return res.json({
        code: result.code,
        baseAmount: result.baseAmount,
        amount: result.amount,
        discount: result.discount,
      });
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      if (error.status === 401) return res.status(401).json({ error: 'Não autorizado' });
      console.error('validate-coupon error:', err);
      return res.status(500).json({ error: 'Erro interno', detail: error.message });
    }
  });

  app.post('/api/payments/create-checkout', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { credits, name, cpfCnpj, coupon } = req.body as {
        credits: number;
        name: string;
        cpfCnpj: string;
        coupon?: string;
      };

      if (!credits || !Number.isInteger(credits) || credits < 10 || credits % 10 !== 0) {
        return res.status(400).json({ error: 'credits deve ser inteiro, múltiplo de 10 e mínimo 10' });
      }
      if (!name?.trim()) return res.status(400).json({ error: 'name é obrigatório' });
      if (!cpfCnpj?.trim()) return res.status(400).json({ error: 'cpfCnpj é obrigatório' });

      const baseAmount = Math.round(credits * 0.5 * 100) / 100;

      // Cupom de desconto (opcional). Reaproveita a validação compartilhada.
      let amount = baseAmount;
      let appliedCoupon: { code: string; discount: number } | null = null;
      if (coupon?.trim()) {
        const result = await resolveCoupon(coupon, credits, baseAmount);
        if ('error' in result) {
          return res.status(400).json({ error: result.error });
        }
        amount = result.amount;
        appliedCoupon = { code: result.code, discount: result.discount };
      }

      const email = decoded.email ?? `${decoded.uid}@sem-email.com`;

      const baseUrl = getAsaasBaseUrl();
      const apiKey = process.env.ASAAS_API_KEY;
      if (!baseUrl || !apiKey) {
        console.error('create-checkout: ASAAS_BASE_URL ou ASAAS_API_KEY não configurados');
        return res.status(500).json({ error: 'Configuração de pagamento ausente no servidor' });
      }

      let customerId: string;
      try {
        customerId = await getOrCreateAsaasCustomer(name.trim(), cpfCnpj, email);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('create-checkout: falha ao criar/buscar cliente Asaas:', msg);
        return res.status(502).json({ error: 'Falha ao registrar cliente no Asaas', detail: msg });
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      const headers: Record<string, string> = { 'access_token': apiKey, 'Content-Type': 'application/json' };

      const paymentResp = await fetch(`${baseUrl}/payments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customer: customerId,
          billingType: 'UNDEFINED',
          value: amount,
          dueDate: dueDateStr,
          description: `Compra de ${credits} créditos — Omni360`,
        }),
      });

      if (!paymentResp.ok) {
        const err = await paymentResp.text();
        console.error('Asaas create payment error:', err);
        return res.status(502).json({ error: 'Falha ao criar cobrança no Asaas' });
      }

      const payment = await paymentResp.json() as { id: string; invoiceUrl: string };

      await adminDb.collection('pendingPayments').doc(payment.id).set({
        uid: decoded.uid,
        credits,
        amount,
        coupon: appliedCoupon?.code ?? null,
        discount: appliedCoupon?.discount ?? 0,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

      return res.json({ invoiceUrl: payment.invoiceUrl });
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      if (error.status === 401) return res.status(401).json({ error: 'Não autorizado' });
      console.error('create-checkout error:', err);
      return res.status(500).json({ error: 'Erro interno', detail: error.message });
    }
  });

  app.post('/api/payments/webhook', async (req, res) => {
    try {
      const token = req.headers['asaas-access-token'];
      if (token !== process.env.ASAAS_WEBHOOK_TOKEN) {
        console.warn('Webhook: token inválido recebido');
        return res.status(200).json({ received: true });
      }

      const event = req.body as {
        event: string;
        payment?: { id: string };
      };

      const CONFIRMABLE_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
      if (!CONFIRMABLE_EVENTS.includes(event.event) || !event.payment?.id) {
        return res.status(200).json({ received: true });
      }

      const paymentId = event.payment.id;

      // Verificar status real do pagamento na API do Asaas
      const asaasBaseUrl = process.env.ASAAS_BASE_URL!;
      const asaasApiKey = process.env.ASAAS_API_KEY!;
      const verifyResp = await fetch(`${asaasBaseUrl}/payments/${paymentId}`, {
        headers: { 'access_token': asaasApiKey },
      });
      if (!verifyResp.ok) {
        console.warn(`Webhook: não foi possível verificar pagamento ${paymentId} no Asaas`);
        return res.status(200).json({ received: true });
      }
      const asaasPayment = await verifyResp.json() as { status?: string };
      const CONFIRMED_STATUSES = ['CONFIRMED', 'RECEIVED'];
      if (!asaasPayment.status || !CONFIRMED_STATUSES.includes(asaasPayment.status)) {
        console.warn(`Webhook: pagamento ${paymentId} status=${asaasPayment.status}, ignorando`);
        return res.status(200).json({ received: true });
      }

      const pendingRef = adminDb.collection('pendingPayments').doc(paymentId);

      // Capturado dentro da transação para o evento do CRM ser emitido só depois
      // do commit — se a transação abortar, nenhum evento é registrado.
      let purchase: { uid: string; credits: number; amount: number } | null = null;

      await adminDb.runTransaction(async (tx) => {
        const pendingSnap = await tx.get(pendingRef);
        if (!pendingSnap.exists || pendingSnap.data()?.status === 'completed') return;

        const { uid, credits, amount } = pendingSnap.data() as {
          uid: string;
          credits: number;
          amount: number;
        };
        purchase = { uid, credits, amount };

        const userRef = adminDb.collection('users').doc(uid);
        const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();

        tx.update(userRef, {
          credits: FieldValue.increment(credits),
          // Marca o cliente como pagante — entra no health score do CRM e não
          // some se o saldo for todo consumido depois.
          hasPurchased: true,
        });

        tx.set(logRef, {
          type: 'purchase',
          actionType: 'Compra de Créditos',
          creditsAdded: credits,
          creditsConsumed: 0,
          amount,
          paymentId,
          productName: `Compra de ${credits} créditos`,
          sku: `R$ ${amount.toFixed(2)}`,
          userName: '',
          timestamp: new Date().toISOString(),
        });

        tx.update(pendingRef, {
          status: 'completed',
          completedAt: FieldValue.serverTimestamp(),
        });
      });

      if (purchase) {
        const { uid, credits, amount } = purchase as { uid: string; credits: number; amount: number };
        void recordEvent(uid, 'credits_purchased', { credits, amount });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('Webhook processing error:', err);
      return res.status(200).json({ received: true });
    }
  });

  // Qualquer /api/* que não casou com uma rota acima é um 404 de API, não uma
  // rota do SPA. Sem isso a requisição cai no fallback e o cliente recebe
  // index.html com status 200, virando um "Unexpected token '<'" na hora do
  // .json() — erro que não diz nada sobre a causa real (rota inexistente, quase
  // sempre por servidor desatualizado, já que tsx não recarrega o backend).
  app.use('/api', (req, res) => {
    res.status(404).json({
      message: `Rota de API não encontrada: ${req.method} /api${req.path}. `
        + 'Se ela deveria existir, reinicie o servidor — o backend não recarrega sozinho.',
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Hashed assets are immutable: cache them aggressively. index.html must
    // never be cached, or the browser keeps requesting an old bundle hash.
    app.use(express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get('*', (req, res) => {
      // Never serve index.html for missing asset requests (.js, .css, etc.) —
      // returning HTML for a module request triggers a MIME type error.
      // Let those 404 so the browser fails loudly instead of silently.
      if (path.extname(req.path)) {
        return res.status(404).end();
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Dev-only autonomous content scheduler (production uses Cloud Scheduler).
  startContentScheduler();

  // Tiny background import/sync worker (production also backed by Cloud Scheduler
  // hitting /api/tiny/cron/tick).
  startTinyScheduler();

  // Bling background import/sync worker (production also backed by Cloud Scheduler
  // hitting /api/bling/cron/tick).
  startBlingScheduler();

  // IdWorks background import/sync worker (production also backed by Cloud Scheduler
  // hitting /api/idworks/cron/tick).
  startIdworksScheduler();

  // CRM: reconcilia os marcos da jornada a partir do estado do Firestore.
  startCrmScheduler();

  // CRM: régua de WhatsApp por etapa do Kanban. Não faz nada se o provider não
  // estiver configurado ou se nenhuma automação estiver ativa.
  startAutomationScheduler();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
