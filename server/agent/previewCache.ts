// Cache de prévias caras (as que chamam um modelo para montar o `depois`).
//
// Por que existe: no LangGraph, `interrupt()` não congela a função — no resume
// o nó da ferramenta roda DE NOVO desde o começo, e com ele o preview(). Para
// uma prévia determinística (ler o Tiny e montar o diff) isso é inofensivo;
// para uma que gera texto com IA, a segunda execução escreveria outro texto e
// o que seria gravado deixaria de ser o que o usuário aprovou. O cache,
// chaveado pela ferramenta + argumentos, faz o resume reencontrar exatamente a
// mesma prévia.

import crypto from 'crypto';
import { adminDb } from '../firebaseAdmin';

const TTL_MS = 6 * 60 * 60_000;

const col = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_previews');

export function chavePrevia(tool: string, args: Record<string, unknown>): string {
  // Ordena as chaves: { a, b } e { b, a } são o mesmo pedido.
  const norm = JSON.stringify(args, Object.keys(args).sort());
  return crypto.createHash('sha256').update(`${tool}:${norm}`).digest('hex').slice(0, 40);
}

export async function comCache<T>(uid: string, tool: string, args: Record<string, unknown>, gerar: () => Promise<T>): Promise<T> {
  const ref = col(uid).doc(chavePrevia(tool, args));
  const snap = await ref.get().catch(() => null);
  const salvo = snap?.exists ? snap.data() : null;
  if (salvo && typeof salvo.at === 'number' && Date.now() - salvo.at < TTL_MS && salvo.valor) {
    return salvo.valor as T;
  }
  const valor = await gerar();
  await ref.set({ tool, at: Date.now(), valor: JSON.parse(JSON.stringify(valor)) }).catch(() => {});
  return valor;
}

/** Depois de executar, a prévia não pode ser reaproveitada por um pedido igual mais tarde. */
export async function esquecerPrevia(uid: string, tool: string, args: Record<string, unknown>): Promise<void> {
  await col(uid).doc(chavePrevia(tool, args)).delete().catch(() => {});
}
