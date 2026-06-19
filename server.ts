import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import net from "net";
import { lookup } from "dns/promises";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
// Admin SDK init lives in a shared leaf module so server/contentAgent.ts can also
// use adminDb/adminAuth without re-triggering this server's bootstrap.
import { adminDb, adminAuth, FieldValue } from "./server/firebaseAdmin";
import { registerContentRoutes, startContentScheduler } from "./server/contentAgent";

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

// Bloqueia ranges privados/loopback/link-local para evitar SSRF (ex.: acessar o
// endpoint de metadados 169.254.169.254 ou serviços internos da VPC).
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||                          // 10.0.0.0/8
      a === 127 ||                         // loopback
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) ||          // 192.168.0.0/16
      (a === 169 && b === 254) ||          // link-local (metadata)
      a === 0
    );
  }
  const v6 = ip.toLowerCase();
  // ::1 (loopback), fc00::/7 (ULA), fe80::/10 (link-local) e IPv4-mapeado.
  if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) {
    return true;
  }
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return false;
}

// Valida uma URL de imagem fornecida pelo cliente antes de o servidor buscá-la.
// Só permite http/https e resolve o host para garantir que não aponta para a
// rede interna (defesa contra SSRF). Lança em caso de URL não permitida.
async function assertSafeImageUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Protocolo não permitido'), { status: 400 });
  }
  // Resolve TODOS os endereços do host e rejeita se qualquer um for interno.
  const results = await lookup(url.hostname, { all: true });
  if (!results.length || results.some((r) => isPrivateIp(r.address))) {
    throw Object.assign(new Error('Destino não permitido'), { status: 400 });
  }
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

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Serve uploads directory directly
  app.use('/uploads', express.static(uploadsDir));

  // Agência de Criação de Conteúdo (Alfred) — server-side AI pipeline + scheduler.
  registerContentRoutes(app, { verifyFirebaseToken, uploadsDir });

  // API routes FIRST (image upload — all AI generation now runs client-side via Firebase AI Logic)

  app.post("/api/upload", async (req, res) => {
    try {
      try {
        await verifyFirebaseToken(req);
      } catch {
        return res.status(401).json({ error: "Não autorizado" });
      }

      const { imageBase64, imageUrl, filename } = req.body;

      let data = '';
      let extension = 'png';

      if (imageBase64) {
        const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        data = imageBase64;
        
        if (matches && matches.length === 3) {
          data = matches[2];
          const mime = matches[1];
          if (mime === 'image/jpeg') extension = 'jpg';
          else if (mime === 'image/webp') extension = 'webp';
        }
      } else if (imageUrl) {
        try {
          await assertSafeImageUrl(imageUrl);
          const response = await fetch(imageUrl, { redirect: 'error' });
          if (!response.ok) throw new Error("Failed to fetch image");
          const arrayBuffer = await response.arrayBuffer();
          data = Buffer.from(arrayBuffer).toString('base64');
          
          const contentType = response.headers.get('content-type');
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

      const safeFilename = filename ? filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() : `img_${Date.now()}`;
      const finalFilename = `${safeFilename}_${Date.now()}.${extension}`;
      const filePath = path.join(uploadsDir, finalFilename);

      fs.writeFileSync(filePath, data, 'base64');

      // Return the URL (absolute URL based on request host)
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers.host;
      const url = `${protocol}://${host}/uploads/${finalFilename}`;
      
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

      await adminDb.runTransaction(async (tx) => {
        const pendingSnap = await tx.get(pendingRef);
        if (!pendingSnap.exists || pendingSnap.data()?.status === 'completed') return;

        const { uid, credits, amount } = pendingSnap.data() as {
          uid: string;
          credits: number;
          amount: number;
        };

        const userRef = adminDb.collection('users').doc(uid);
        const logRef = adminDb.collection('users').doc(uid).collection('credit_logs').doc();

        tx.update(userRef, {
          credits: FieldValue.increment(credits),
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

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('Webhook processing error:', err);
      return res.status(200).json({ received: true });
    }
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
  startContentScheduler(uploadsDir);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
