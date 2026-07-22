// Recebe eventos do client (src/tiktok.ts) e repassa para a Events API do
// TikTok, hasheando PII e anexando IP/user-agent para melhorar o match quality.
// Nunca deve derrubar o fluxo do produto: sempre responde 200 ao client, e
// qualquer falha na chamada ao TikTok é só logada.
import type express from 'express';
import crypto from 'crypto';

const EVENTS_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

interface TiktokEventBody {
  event_name?: string;
  event_id?: string;
  custom_data?: Record<string, unknown>;
  user_data?: { email?: string };
  ttp?: string;
  ttclid?: string;
  url?: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export function registerTiktokEventsRoutes(app: express.Express): void {
  app.post('/api/tiktok/events', (req, res) => {
    res.status(200).json({ received: true });
    void forwardToTiktok(req).catch((err) => {
      console.error('TikTok Events API request failed:', err);
    });
  });
}

async function forwardToTiktok(req: express.Request): Promise<void> {
  const pixelCode = process.env.VITE_TIKTOK_PIXEL_ID;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (!pixelCode || !accessToken) return;

  const body = req.body as TiktokEventBody;
  if (!body?.event_name || !body?.event_id) return;

  const userData: Record<string, unknown> = {};
  if (body.user_data?.email) userData.email = sha256(body.user_data.email);

  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
  if (clientIp) userData.ip = clientIp;

  const userAgent = req.headers['user-agent'];
  if (userAgent) userData.user_agent = userAgent;

  if (body.ttp) userData.ttp = body.ttp;
  if (body.ttclid) userData.ttclid = body.ttclid;

  const eventPayload: Record<string, unknown> = {
    event: body.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id,
    user: userData,
  };
  if (body.custom_data && Object.keys(body.custom_data).length > 0) {
    eventPayload.properties = body.custom_data;
  }
  if (body.url) {
    eventPayload.page = { url: body.url };
  }

  const requestBody: Record<string, unknown> = {
    event_source: 'web',
    event_source_id: pixelCode,
    data: [eventPayload],
  };
  if (process.env.TIKTOK_TEST_EVENT_CODE) {
    requestBody.test_event_code = process.env.TIKTOK_TEST_EVENT_CODE;
  }

  const resp = await fetch(EVENTS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
    body: JSON.stringify(requestBody),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('TikTok Events API error:', resp.status, errText);
  }
}
