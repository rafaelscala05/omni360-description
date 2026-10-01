// Firestore do lote em job: users/{uid}/agent_jobs/{id} e a agent_action que o
// representa na conversa e na Atividade. As transições são as funções puras de
// src/modules/agent/lote.ts; aqui só se lê, aplica e grava numa transação.
//
// A agent_action acompanha o lote: nasce "pending" junto com ele, ganha os
// contadores em `result` a cada gravação (é o que faz o App reler o catálogo,
// ver usePendentesAlfred) e só é resolvida quando todo item chegou a um estado
// final.

import crypto from 'crypto';
import { adminDb } from '../firebaseAdmin';
import {
  resumoLote, statusDaAcao, statusDerivado,
  type ItemLote, type LoteJob,
} from '../../src/modules/agent/lote';
import { chavePrevia } from './previewCache';
import type { ActionPreview, ToolProvider } from './types';

export const jobsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_jobs');
const actionsCol = (uid: string) => adminDb.collection('users').doc(uid).collection('agent_actions');

/** Firestore recusa undefined. */
const limpo = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

export interface NovoLote {
  uid: string;
  tool: string;
  provider: ToolProvider;
  args: Record<string, unknown>;
  itens: Omit<ItemLote, 'id' | 'estado'>[];
  preview: Pick<ActionPreview, 'resumo' | 'alvo' | 'campos' | 'avisos' | 'custo'>;
  auto: boolean;
}

/**
 * Cria o lote e a ação. Pedir de novo o mesmo lote (mesma ferramenta e mesmos
 * argumentos) enquanto ele não terminou devolve o existente: o modelo às vezes
 * repete a chamada, e dois lotes iguais gerariam e cobrariam duas vezes.
 */
export async function criarLote(input: NovoLote): Promise<{ job: LoteJob; reaproveitado: boolean }> {
  const chave = chavePrevia(input.tool, input.args);
  const existentes = await jobsCol(input.uid).where('chave', '==', chave).get();
  const vivo = existentes.docs.map((d) => d.data() as LoteJob).find((j) => j.status !== 'concluido');
  if (vivo) return { job: vivo, reaproveitado: true };

  const jobRef = jobsCol(input.uid).doc();
  const actionRef = actionsCol(input.uid).doc();
  const agora = new Date().toISOString();
  const job: LoteJob = {
    id: jobRef.id,
    tool: input.tool,
    args: input.args,
    chave,
    actionId: actionRef.id,
    status: 'rodando',
    auto: input.auto,
    avisos: input.preview.avisos,
    itens: input.itens.map((i, k) => ({ ...i, id: `i${k}`, estado: 'fila' })),
    leaseId: null,
    leaseUntil: null,
    createdAt: agora,
    updatedAt: agora,
  };
  const batch = adminDb.batch();
  batch.set(jobRef, limpo(job));
  batch.set(actionRef, limpo({
    id: actionRef.id,
    // Não nasce de um interrupt do grafo: não há thread a retomar.
    threadId: 'lote',
    tool: input.tool,
    provider: input.provider,
    args: input.args,
    preview: { ...input.preview, ferramenta: input.tool, args: input.args, lote: { id: jobRef.id, total: job.itens.length } },
    status: 'pending',
    ...(input.auto ? { auto: true } : {}),
    createdAt: agora,
  }));
  await batch.commit();
  return { job, reaproveitado: false };
}

export async function lerLote(uid: string, id: string): Promise<LoteJob | null> {
  const snap = await jobsCol(uid).doc(id).get();
  return snap.exists ? (snap.data() as LoteJob) : null;
}

/** O que a ação mostra como recibo enquanto o lote anda e quando termina. */
function resultadoDaAcao(job: LoteJob) {
  const r = resumoLote(job);
  return {
    gravados: r.gravados,
    produtos: job.itens.filter((i) => i.estado === 'gravado').map((i) => i.nome),
    pulados: job.itens.filter((i) => i.estado === 'pulado' || i.estado === 'falhou').map((i) => `${i.nome}${i.erro ? ` (${i.erro})` : ''}`),
    descartados: r.descartados,
  };
}

/**
 * Lê, aplica `fn` e grava, numa transação. `fn` devolvendo null = nada a
 * gravar (lease perdido, item que já não estava pronto…). Mantém a ação em dia
 * com o lote na mesma transação.
 */
export async function mutarLote(uid: string, id: string, fn: (job: LoteJob) => LoteJob | null): Promise<LoteJob | null> {
  const jobRef = jobsCol(uid).doc(id);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw Object.assign(new Error('Lote não encontrado.'), { status: 404 });
    const antes = snap.data() as LoteJob;
    const actionRef = actionsCol(uid).doc(antes.actionId);
    const actionSnap = await tx.get(actionRef);
    const depois = fn(antes);
    if (!depois) return null;
    depois.status = statusDerivado(depois);
    tx.set(jobRef, limpo(depois));

    const acao = actionSnap.exists ? actionSnap.data() : null;
    if (acao && acao.status === 'pending') {
      const status = statusDaAcao(depois);
      const gravouAgora = resumoLote(depois).gravados !== resumoLote(antes).gravados;
      if (status !== 'pending' || gravouAgora) {
        tx.update(actionRef, limpo({
          result: resultadoDaAcao(depois),
          ...(status !== 'pending' ? { status, resolvedAt: depois.updatedAt } : {}),
        }));
      }
    }
    return depois;
  });
}

export const novoLeaseId = () => crypto.randomUUID();
