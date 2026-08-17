// Registro de cada chamada HTTP que o agente faz para Wake e Tiny.
//
// Existe porque as duas APIs falham com mensagens genéricas: a Wake devolve 422
// com "Erro ao inserir banner!" e o motivo real no corpo; o Tiny embute o erro
// dentro de um HTTP 200. Sem guardar requisição e resposta, um erro desses vira
// tentativa e erro. Com isso, o painel de logs mostra exatamente o que saiu, o
// que voltou e quanto demorou.
//
// Gravar é best-effort: uma falha aqui nunca pode derrubar a operação que o
// usuário pediu — o log é diagnóstico, não parte da transação.

import { adminDb } from '../firebaseAdmin';

const logsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_logs');

/** Um documento do Firestore vai até 1 MiB; base64 de banner estoura sozinho. */
const MAX_FIELD_CHARS = 4000;

/**
 * Remove os campos que não podem ir para o log: base64 de imagem (tamanho) e
 * qualquer coisa com cara de credencial (o token da Wake viaja em header, mas o
 * do Tiny vai no corpo do form).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '…';

  if (typeof value === 'string') {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}… [+${value.length - MAX_FIELD_CHARS} chars]`
      : value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const corte = value.slice(0, 25).map((v) => redact(v, depth + 1));
    if (value.length > 25) corte.push(`… +${value.length - 25} itens`);
    return corte;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const chave = k.toLowerCase();
    if (chave === 'base64') {
      out[k] = typeof v === 'string' ? `[base64 omitido, ${v.length} chars]` : '[base64 omitido]';
    } else if (chave === 'token' || chave === 'authorization' || chave.includes('secret') || chave.includes('senha')) {
      out[k] = '[redigido]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

export interface CallLog {
  provider: 'wake' | 'tiny';
  tool?: string;
  /** GET/POST/PUT na Wake; o nome do endpoint .php no Tiny. */
  operacao: string;
  alvo: string;
  requisicao?: unknown;
  resposta?: unknown;
  status: number | null;
  ok: boolean;
  erro?: string;
  ms: number;
  threadId?: string;
  actionId?: string;
}

export async function logCall(uid: string, entry: CallLog): Promise<void> {
  try {
    await logsCol(uid).add({
      ...entry,
      requisicao: redact(entry.requisicao ?? null),
      resposta: redact(entry.resposta ?? null),
      erro: entry.erro ?? null,
      at: new Date().toISOString(),
    });
  } catch {
    // Nunca propague: o log é diagnóstico, a operação do usuário é o que importa.
  }
}

/**
 * Envolve uma chamada HTTP, medindo e registrando os dois desfechos. Repropaga o
 * erro original intacto — quem chama continua tratando exatamente o que tratava.
 */
export async function withLog<T>(
  uid: string,
  meta: Omit<CallLog, 'status' | 'ok' | 'ms' | 'resposta' | 'erro'>,
  fn: () => Promise<T>,
): Promise<T> {
  const inicio = Date.now();
  try {
    const resposta = await fn();
    await logCall(uid, { ...meta, resposta, status: 200, ok: true, ms: Date.now() - inicio });
    return resposta;
  } catch (e: any) {
    await logCall(uid, {
      ...meta,
      // responseBody é anexado por fbitsFetch: é onde a Wake põe o motivo real
      // por trás de uma mensagem genérica.
      resposta: e?.responseBody ?? null,
      status: typeof e?.status === 'number' ? e.status : null,
      ok: false,
      erro: e?.message ?? String(e),
      ms: Date.now() - inicio,
    });
    throw e;
  }
}
