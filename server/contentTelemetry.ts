// Registro de cada chamada HTTP que o pipeline de conteúdo faz ao publicar
// (Sanity/WordPress/blog nativo). Mesmo motivo do agent_logs (server/agent/telemetry.ts):
// APIs de terceiros falham com corpos que só fazem sentido guardados — sem isso,
// um erro de publicação vira tentativa e erro no escuro.
//
// Gravar é best-effort: uma falha aqui nunca pode derrubar a publicação que o
// usuário pediu — o log é diagnóstico, não parte da transação.

import { adminDb } from './firebaseAdmin';

const logsCol = (uid: string, projectId: string) =>
  adminDb
    .collection('users').doc(uid)
    .collection('contentProjects').doc(projectId)
    .collection('publishLogs');

/** Um documento do Firestore vai até 1 MiB; corpos grandes estouram sozinhos. */
const MAX_FIELD_CHARS = 4000;

/** Remove/trunca o que não deve ir para o log: credenciais e campos enormes. */
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
    if (chave === 'token' || chave === 'authorization' || chave.includes('secret') || chave.includes('senha') || chave.includes('password')) {
      out[k] = '[redigido]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

export interface PublishCallLog {
  destino: 'sanity' | 'wordpress' | 'blog';
  /** ex.: 'mutate', 'mutate.delete', 'posts', 'posts.update' */
  operacao: string;
  /** URL/endpoint chamado */
  alvo: string;
  articleId: string;
  articleTitulo: string;
  requisicao?: unknown;
  resposta?: unknown;
  status: number | null;
  ok: boolean;
  erro?: string;
  ms: number;
}

export async function logPublishCall(uid: string, projectId: string, entry: PublishCallLog): Promise<void> {
  try {
    await logsCol(uid, projectId).add({
      ...entry,
      requisicao: redact(entry.requisicao ?? null),
      resposta: redact(entry.resposta ?? null),
      erro: entry.erro ?? null,
      at: new Date().toISOString(),
    });
  } catch {
    // Nunca propague: o log é diagnóstico, a publicação do usuário é o que importa.
  }
}
