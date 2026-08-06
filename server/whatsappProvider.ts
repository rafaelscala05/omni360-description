// Provider do WhatsApp Oficial (Meta Cloud API).
//
// Toda a conversa com a Graph API vive aqui, atrás de três funções. O worker e as
// rotas não sabem que é a Meta — trocar por um BSP depois é reescrever só este
// arquivo.
//
// Sem as env vars o provider reporta configured: false e nada mais acontece; o
// CRM inteiro continua funcionando sem WhatsApp.

const GRAPH_API_VERSION = 'v21.0';

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  // Quantos parâmetros {{1}}, {{2}}… o corpo do template espera. A UI usa isso
  // para pedir exatamente essa quantidade.
  bodyParamCount: number;
  bodyText: string;
}

export interface ProviderStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}

export function isConfigured(): ProviderStatus {
  const missing: string[] = [];
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!process.env.WHATSAPP_WABA_ID) missing.push('WHATSAPP_WABA_ID');
  return {
    configured: missing.length === 0,
    missing,
    dryRun: process.env.WHATSAPP_DRY_RUN === 'true',
    maxPerDay: Math.max(1, Number(process.env.WHATSAPP_MAX_PER_DAY ?? 50)),
  };
}

function requireConfig() {
  const status = isConfigured();
  if (!status.configured) {
    throw Object.assign(
      new Error(`WhatsApp não configurado. Faltam: ${status.missing.join(', ')}`),
      { status: 422 },
    );
  }
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN!,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    wabaId: process.env.WHATSAPP_WABA_ID!,
  };
}

interface RawTemplate {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: { type?: string; text?: string }[];
}

// Conta os placeholders {{1}}, {{2}}… distintos do corpo. A Cloud API exige que a
// quantidade de parâmetros enviados bata exatamente com a do template aprovado.
function countBodyParams(text: string): number {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) found.add(m[1]);
  return found.size;
}

export async function listTemplates(): Promise<WhatsAppTemplate[]> {
  const { token, wabaId } = requireConfig();
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?limit=200&access_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url);
  const json = (await resp.json().catch(() => ({}))) as {
    data?: RawTemplate[];
    error?: { message?: string };
  };
  if (!resp.ok) {
    throw Object.assign(new Error(json.error?.message ?? `Meta respondeu ${resp.status}`), {
      status: resp.status === 401 || resp.status === 403 ? 502 : resp.status,
    });
  }

  return (json.data ?? [])
    .filter((t) => t.status === 'APPROVED')
    .map((t) => {
      const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
      return {
        name: t.name ?? '',
        language: t.language ?? 'pt_BR',
        status: t.status ?? '',
        category: t.category ?? '',
        bodyParamCount: countBodyParams(body),
        bodyText: body,
      };
    })
    .filter((t) => t.name);
}

// Normaliza para o formato que a Cloud API espera: só dígitos, com DDI.
// Números brasileiros salvos sem DDI (10 ou 11 dígitos) recebem 55.
export function normalizePhone(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

export async function sendTemplate(
  to: string,
  templateName: string,
  language: string,
  params: string[],
): Promise<{ messageId: string; dryRun: boolean }> {
  const status = isConfigured();
  const { token, phoneNumberId } = requireConfig();

  const phone = normalizePhone(to);
  if (!phone) {
    throw Object.assign(new Error('Número de WhatsApp inválido'), { status: 422 });
  }

  // DRY RUN: percorre tudo e registra, sem gastar mensagem real. É como se valida
  // uma régua nova sem torrar disparo em cliente de verdade.
  if (status.dryRun) {
    console.log(`[whatsapp][dry-run] ${templateName} → ${phone} params=${JSON.stringify(params)}`);
    return { messageId: `dry-run-${Date.now()}`, dryRun: true };
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(params.length > 0
        ? {
            components: [
              {
                type: 'body',
                parameters: params.map((p) => ({ type: 'text', text: p })),
              },
            ],
          }
        : {}),
    },
  };

  const resp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await resp.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; error_user_msg?: string };
  };

  if (!resp.ok) {
    // O motivo da recusa (template não aprovado, número fora da WABA, janela) é
    // exatamente a informação que o admin precisa — não engolir.
    const msg = json.error?.error_user_msg || json.error?.message || `Meta respondeu ${resp.status}`;
    throw Object.assign(new Error(msg), { status: 502 });
  }

  return { messageId: json.messages?.[0]?.id ?? '', dryRun: false };
}
