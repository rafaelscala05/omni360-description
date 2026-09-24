// This leaf module reads configuration at module-evaluation time. Load .env here
// for local development; dotenv does not override variables injected by App
// Hosting/Secret Manager in production.
import 'dotenv/config';
import { encryptionConfigured } from './crypto';

export const MELI_API_BASE = (process.env.MELI_API_BASE_URL || 'https://api.mercadolibre.com').replace(/\/+$/, '');
export const MELI_AUTH_BASE = (process.env.MELI_AUTH_BASE_URL || 'https://auth.mercadolivre.com.br').replace(/\/+$/, '');

// Preserve the existing catalog-import integration while adopting the shorter
// names from the optimizer spec.
export const MELI_CLIENT_ID = process.env.MELI_CLIENT_ID || process.env.MERCADOLIVRE_CLIENT_ID || '';
export const MELI_CLIENT_SECRET = process.env.MELI_CLIENT_SECRET || process.env.MERCADOLIVRE_CLIENT_SECRET || '';
export const MELI_REDIRECT_URI = process.env.MELI_REDIRECT_URI || '';
export const MELI_PKCE_ENABLED = (process.env.MELI_PKCE_ENABLED || 'true').toLowerCase() !== 'false';

export function meliConfigured(): boolean {
  return Boolean(MELI_CLIENT_ID && MELI_CLIENT_SECRET && MELI_REDIRECT_URI && encryptionConfigured());
}
