// Shared "what was actually written" log for every ERP push (Wake, Tiny, Bling,
// IdWorks). Each push builder records an entry per field it decided to write, so
// the send panel can show the user the real content that reached the ERP instead
// of only a per-group ok/skip summary.
//
// Entries are built at the point the write decision is made — never reconstructed
// afterwards — so the log cannot drift from the payload.

export interface PushLogEntry {
  /** pt-BR label shown to the user, e.g. "Descrição complementar". */
  campo: string;
  /** The value sent, truncated to MAX_VALOR characters. */
  valor?: string;
  /** For list-valued fields (image URLs), the items sent. */
  itens?: string[];
  /** Real size of `valor` in bytes before truncation, so the UI can show "2,1 KB". */
  bytes?: number;
  /** True when `valor` was cut. */
  truncado?: boolean;
}

// A product description can be several KB of HTML; a 50-product push would carry
// megabytes to the browser for a panel that only previews the content.
const MAX_VALOR = 600;
const MAX_ITENS = 20;

/** Records a text field. Returns null when there is nothing to record. */
export function logTexto(campo: string, valor: unknown): PushLogEntry | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const s = String(valor);
  const bytes = Buffer.byteLength(s, 'utf8');
  if (s.length > MAX_VALOR) {
    return { campo, valor: `${s.slice(0, MAX_VALOR)}…`, bytes, truncado: true };
  }
  return { campo, valor: s, bytes };
}

/** Records a list field (image URLs). Returns null for an empty list. */
export function logLista(campo: string, itens: unknown[]): PushLogEntry | null {
  const list = (itens ?? []).filter((u): u is string => typeof u === 'string' && u !== '');
  if (!list.length) return null;
  return list.length > MAX_ITENS
    ? { campo, itens: list.slice(0, MAX_ITENS), bytes: list.length, truncado: true }
    : { campo, itens: list };
}

/** Appends `entry` to `log` when it isn't null. Keeps call sites to one line. */
export function push(log: PushLogEntry[], entry: PushLogEntry | null): void {
  if (entry) log.push(entry);
}
