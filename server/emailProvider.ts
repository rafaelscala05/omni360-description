// Provider de e-mail (SMTP genérico via nodemailer).
//
// Toda a conversa com o SMTP vive aqui, atrás de duas funções. O worker e as
// rotas não sabem qual provedor está por trás (Gmail Workspace, SES,
// SendGrid SMTP relay, Zoho...) — trocar depois é reescrever só este arquivo.
//
// Sem as env vars o provider reporta configured: false e nada mais acontece;
// o CRM inteiro (incluindo o canal de WhatsApp) continua funcionando sem
// e-mail configurado.

import { createTransport, type Transporter } from 'nodemailer';

export interface ProviderStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  maxPerDay: number;
}

export function isConfigured(): ProviderStatus {
  const missing: string[] = [];
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
  if (!process.env.SMTP_USER) missing.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS');
  if (!process.env.SMTP_FROM) missing.push('SMTP_FROM');
  return {
    configured: missing.length === 0,
    missing,
    dryRun: process.env.EMAIL_DRY_RUN === 'true',
    maxPerDay: Math.max(1, Number(process.env.EMAIL_MAX_PER_DAY ?? 100)),
  };
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<{ messageId: string; dryRun: boolean }> {
  const status = isConfigured();

  if (status.dryRun) {
    console.log(`[email] DRY RUN → to=${to} subject="${subject}"`);
    return { messageId: `dry-run-${Date.now()}`, dryRun: true };
  }

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });
  return { messageId: info.messageId, dryRun: false };
}
