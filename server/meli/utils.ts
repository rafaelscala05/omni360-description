import crypto from 'crypto';

export function chunk<T>(values: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('size deve ser um inteiro positivo');
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortObject(nested)]),
    );
  }
  return value;
}

export function contentHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(120_000, seconds * 1000);
  const base = Math.min(30_000, 750 * 2 ** Math.max(0, attempt));
  return base + Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.25)));
}

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Erro desconhecido');
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/APP_USR-[A-Za-z0-9-]+/gi, '[REDACTED_TOKEN]')
    .replace(/TG-[A-Za-z0-9-]+/gi, '[REDACTED_TOKEN]')
    .slice(0, 800);
}

export function normalizeBulkItems(payload: unknown): Array<Record<string, any>> {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry: any) => {
    const status = Number(entry?.status_code ?? entry?.code ?? 0);
    return status >= 200 && status < 300 && entry?.body ? [entry.body] : [];
  });
}
