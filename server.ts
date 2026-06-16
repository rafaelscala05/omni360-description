import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import dotenv from "dotenv";
import { createRequire } from "module";

// Pin the Admin SDK to the SAME Firebase project the client uses to mint ID
// tokens, so verifyIdToken's expected "aud" always matches the token issuer.
// Without this, the Admin SDK inherits the local ADC's project (which may differ)
// and rejects tokens with an "incorrect aud claim" error.
const require = createRequire(import.meta.url);
const { projectId: firebaseProjectId } = require("./firebase-applet-config.json") as { projectId: string };

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: firebaseProjectId,
  });
}

export const adminDb = getFirestore();
export const adminAuth = getAuth();

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

async function getOrCreateAsaasCustomer(
  name: string,
  cpfCnpj: string,
  email: string,
): Promise<string> {
  const baseUrl = process.env.ASAAS_BASE_URL!;
  const apiKey = process.env.ASAAS_API_KEY!;
  const headers: Record<string, string> = { 'access_token': apiKey, 'Content-Type': 'application/json' };

  const rawCpfCnpj = cpfCnpj.replace(/\D/g, '');

  const listResp = await fetch(`${baseUrl}/customers?cpfCnpj=${rawCpfCnpj}&limit=1`, { headers });
  if (!listResp.ok) {
    const body = await listResp.text();
    throw new Error(`Asaas list customers failed: ${listResp.status} — ${body}`);
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

  // API routes FIRST (image upload — all AI generation now runs client-side via Firebase AI Logic)

  app.post("/api/upload", async (req, res) => {
    try {
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
          const response = await fetch(imageUrl);
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

  app.post('/api/payments/create-checkout', async (req, res) => {
    try {
      const decoded = await verifyFirebaseToken(req);
      const { credits, name, cpfCnpj } = req.body as {
        credits: number;
        name: string;
        cpfCnpj: string;
      };

      if (!credits || !Number.isInteger(credits) || credits < 10 || credits % 10 !== 0) {
        return res.status(400).json({ error: 'credits deve ser inteiro, múltiplo de 10 e mínimo 10' });
      }
      if (!name?.trim()) return res.status(400).json({ error: 'name é obrigatório' });
      if (!cpfCnpj?.trim()) return res.status(400).json({ error: 'cpfCnpj é obrigatório' });

      const amount = Math.round(credits * 0.5 * 100) / 100;
      const email = decoded.email ?? `${decoded.uid}@sem-email.com`;

      const baseUrl = process.env.ASAAS_BASE_URL;
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
          productName: 'N/A',
          sku: 'N/A',
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
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
