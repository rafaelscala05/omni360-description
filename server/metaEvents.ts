// Recebe eventos do client (src/meta.ts) e repassa para a Conversions API do
// Meta, hasheando PII e anexando IP/user-agent para melhorar o match quality.
// Nunca deve derrubar o fluxo do produto: sempre responde 200 ao client, e
// qualquer falha na chamada ao Meta é só logada.
import type express from 'express';
import crypto from 'crypto';

const GRAPH_API_VERSION = 'v21.0';

interface MetaEventBody {
  event_name?: string;
  event_id?: string;
  custom_data?: Record<string, unknown>;
  user_data?: { email?: string };
  fbp?: string;
  fbc?: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export function registerMetaEventsRoutes(app: express.Express): void {
  app.post('/api/meta/events', (req, res) => {
    res.status(200).json({ received: true });
    void forwardToMeta(req).catch((err) => {
      console.error('Meta CAPI request failed:', err);
    });
  });
}

async function forwardToMeta(req: express.Request): Promise<void> {
  const pixelId = process.env.VITE_META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN;
  if (!pixelId || !accessToken) return;

  const body = req.body as MetaEventBody;
  if (!body?.event_name || !body?.event_id) return;

  const userData: Record<string, unknown> = {};
  if (body.user_data?.email) userData.em = [sha256(body.user_data.email)];

  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
  if (clientIp) userData.client_ip_address = clientIp;

  const userAgent = req.headers['user-agent'];
  if (userAgent) userData.client_user_agent = userAgent;

  if (body.fbp) userData.fbp = body.fbp;
  if (body.fbc) userData.fbc = body.fbc;

  const eventPayload: Record<string, unknown> = {
    event_name: body.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id,
    action_source: 'website',
    user_data: userData,
  };
  if (body.custom_data && Object.keys(body.custom_data).length > 0) {
    eventPayload.custom_data = body.custom_data;
  }

  const requestBody: Record<string, unknown> = { data: [eventPayload] };
  if (process.env.META_TEST_EVENT_CODE) {
    requestBody.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const resp = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
  );
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Meta CAPI error:', resp.status, errText);
  }
}
