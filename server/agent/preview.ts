// Pure, I/O-free helpers for building approval previews. Kept separate from the
// tools so the diff logic can be verified without touching Wake, Tiny, Firestore
// or the model — see scripts/verify-agent-tools.mjs.

import type { ActionPreview, PreviewField } from './types';

/** Loose equality that treats "1200" / 1200 and null / undefined / '' as equal. */
export function sameValue(a: unknown, b: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return true;
  if (empty(a) !== empty(b)) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(String(a).replace(',', '.'));
    const nb = Number(String(b).replace(',', '.'));
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a).trim() === String(b).trim();
}

/**
 * Builds the before/after rows. `depois` entries that are undefined mean "the
 * user did not ask to change this field" and are dropped — only fields actually
 * in play show up in the card.
 */
export function buildFieldDiff(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  labels: Record<string, string>,
): PreviewField[] {
  const rows: PreviewField[] = [];
  for (const [key, novo] of Object.entries(depois)) {
    if (novo === undefined) continue;
    const atual = antes[key];
    rows.push({
      campo: labels[key] ?? key,
      antes: atual ?? null,
      depois: novo,
      mudou: !sameValue(atual, novo),
    });
  }
  return rows;
}

/** True when the diff would change nothing — callers turn this into a warning. */
export function isNoop(campos: PreviewField[]): boolean {
  return campos.length === 0 || campos.every((c) => !c.mudou);
}

/**
 * Assembles a preview and attaches the standard warnings every write shares:
 * a no-op notice, and a heads-up when the action creates rather than edits.
 */
export function makePreview(input: {
  resumo: string;
  alvo: string;
  campos: PreviewField[];
  payload?: Record<string, unknown>;
  avisos?: string[];
  criacao?: boolean;
}): ActionPreview {
  const avisos = [...(input.avisos ?? [])];
  if (!input.criacao && isNoop(input.campos)) {
    avisos.push('Nenhum campo muda de valor — executar não terá efeito.');
  }
  return {
    resumo: input.resumo,
    alvo: input.alvo,
    campos: input.campos,
    avisos,
    payload: input.payload,
  };
}

/** Small helper for tools that need a required string argument. */
export function requireStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw Object.assign(new Error(`Parâmetro obrigatório ausente: ${key}`), { status: 400 });
  }
  return v.trim();
}
