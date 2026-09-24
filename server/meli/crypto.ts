import crypto from 'crypto';
import type { EncryptedValue } from './types';

function encryptionKey(): Buffer {
  const raw = (process.env.MELI_TOKEN_ENCRYPTION_KEY ?? '').trim();
  if (!raw) throw new Error('MELI_TOKEN_ENCRYPTION_KEY não configurada.');

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;
  throw new Error('MELI_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64 ou 64 caracteres hexadecimais.');
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  if (value?.version !== 1) throw new Error('Versão de criptografia MELI não suportada.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
