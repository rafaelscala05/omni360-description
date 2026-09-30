// Ferramentas do otimizador de anúncios do Mercado Livre para o agente.
//
// Cascas finas sobre server/meli/* — as mesmas funções que as rotas
// /api/meli/* chamam, então a regra de negócio (proposta desatualizada quando o
// anúncio mudou, mudança bloqueada, confirmação de campo sensível) é uma só.
// Publicar vai para a lista de travas fixas (agentSettings.ts): mexe num
// anúncio público, então sempre pergunta, mesmo no modo automático.
//
// A publicação em si é assíncrona: execute() grava a seleção, cria a
// execução (meli_mutation_runs, status queued) e a agenda. Se este processo
// for o serviço do grafo e morrer antes de drenar a fila, o recoverMeliWork()
// do servidor principal pega a execução pendente — ver server/meli/scheduler.ts.

import crypto from 'crypto';
import { adminDb } from '../../firebaseAdmin';
import { registerTool } from '../registry';
import { makePreview, requireStr } from '../preview';
import { decideSelection, getLatestProposal } from '../../meli/proposals';
import { createMutationRun, scheduleMutation } from '../../meli/mutations';
import type { MeliListingChange } from '../../meli/types';
import type { PreviewField } from '../types';

const LISTINGS = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listings');
const PRONTAS = new Set(['awaiting_review', 'partially_approved']);

const RISCO: Record<string, string> = { low: 'baixo', medium: 'médio', high: 'alto', blocked: 'bloqueado' };

const curto = (v: unknown, n = 400) => {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function mudancaParaModelo(c: MeliListingChange) {
  return {
    id: c.id,
    campo: c.label || c.fieldPath,
    antes: curto(c.oldValue),
    depois: curto(c.newValue),
    motivo: c.reason,
    risco: RISCO[c.riskLevel] ?? c.riskLevel,
    exigeConfirmacao: c.requiresConfirmation,
    decisao: c.approvalStatus,
  };
}

async function propostaAtual(uid: string, itemId: string) {
  const r = await getLatestProposal(uid, itemId);
  if (!r) throw Object.assign(new Error(`O anúncio ${itemId} não tem proposta de melhoria. Peça uma análise na tela do Mercado Livre.`), { status: 404 });
  return r;
}

registerTool({
  name: 'meli.propostas.listar',
  provider: 'meli',
  mode: 'read',
  description: 'Lista os anúncios do Mercado Livre com proposta de melhoria esperando revisão (título, ficha técnica, descrição, fotos), do maior potencial para o menor.',
  schema: { type: 'object', properties: { limite: { type: 'integer', description: 'Padrão 20.' } } },
  read: async (ctx, a: { limite?: number }) => {
    const snap = await LISTINGS(ctx.uid)
      .select('itemId', 'title', 'status', 'visits30d', 'analysisSummary.alfredsScore', 'proposalSummary')
      .get();
    const prontas = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
      .filter((l) => PRONTAS.has(String(l.proposalSummary?.status ?? '')))
      .map((l) => ({
        itemId: l.itemId ?? l.id,
        titulo: l.title,
        nota: l.analysisSummary?.alfredsScore ?? null,
        visitas30d: l.visits30d ?? null,
        mudancas: l.proposalSummary?.changeCount ?? null,
        status: l.proposalSummary?.status,
      }))
      .sort((x, y) => ((y.visitas30d ?? 1) * (100 - (y.nota ?? 50))) - ((x.visitas30d ?? 1) * (100 - (x.nota ?? 50))));
    return { total: prontas.length, anuncios: prontas.slice(0, Math.min(50, a.limite ?? 20)) };
  },
});

registerTool({
  name: 'meli.proposta.ver',
  provider: 'meli',
  mode: 'read',
  description: 'Mostra a proposta de melhoria mais recente de um anúncio do Mercado Livre: cada mudança com antes, depois, motivo e risco.',
  schema: {
    type: 'object',
    properties: { itemId: { type: 'string', description: 'Código do anúncio (ex.: MLB1234567890).' } },
    required: ['itemId'],
  },
  read: async (ctx, a: { itemId: string }) => {
    const { proposal, changes } = await propostaAtual(ctx.uid, requireStr(a as never, 'itemId').toUpperCase());
    return {
      propostaId: proposal.id,
      status: proposal.status,
      resumo: proposal.summary,
      mudancas: changes.map(mudancaParaModelo),
    };
  },
});

interface ArgsPublicar { itemId: string; mudancas?: string[] }

registerTool<ArgsPublicar>({
  name: 'meli.proposta.publicar',
  provider: 'meli',
  mode: 'write',
  description: 'Publica no Mercado Livre as mudanças escolhidas da proposta de um anúncio. Sem "mudancas", publica todas as pendentes que não são bloqueadas. As não escolhidas são recusadas. Sempre pede aprovação.',
  schema: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'Código do anúncio.' },
      mudancas: { type: 'array', items: { type: 'string' }, description: 'Ids das mudanças (de meli.proposta.ver) a publicar.' },
    },
    required: ['itemId'],
  },
  preview: async (ctx, a) => {
    const itemId = requireStr(a as never, 'itemId').toUpperCase();
    const { proposal, changes } = await propostaAtual(ctx.uid, itemId);
    if (proposal.status === 'stale') {
      throw Object.assign(new Error('O anúncio mudou depois da proposta. Sincronize e gere a proposta de novo.'), { status: 409 });
    }
    const pedidas = a.mudancas?.length ? new Set(a.mudancas) : null;
    const escolhidas = changes.filter((c) => (pedidas ? pedidas.has(c.id) : c.approvalStatus !== 'rejected' && c.riskLevel !== 'blocked'));
    if (!escolhidas.length) throw Object.assign(new Error('Nenhuma mudança publicável nesta proposta.'), { status: 422 });
    const bloqueadas = escolhidas.filter((c) => c.riskLevel === 'blocked');
    if (bloqueadas.length) {
      throw Object.assign(new Error(`Mudança bloqueada não pode ser publicada: ${bloqueadas.map((c) => c.label || c.fieldPath).join(', ')}.`), { status: 422 });
    }
    const titulo = changes.length ? (await LISTINGS(ctx.uid).doc(itemId).get()).data()?.title : null;
    const campos: PreviewField[] = escolhidas.map((c) => ({
      campo: c.label || c.fieldPath, antes: curto(c.oldValue, 600) || null, depois: curto(c.newValue, 600), mudou: true,
    }));
    const sensiveis = escolhidas.filter((c) => c.requiresConfirmation).map((c) => c.label || c.fieldPath);
    const recusadas = changes.length - escolhidas.length;
    return {
      ...makePreview({
        resumo: `Publicar ${escolhidas.length === 1 ? '1 melhoria' : `${escolhidas.length} melhorias`} no Mercado Livre`,
        alvo: `${titulo ?? 'Anúncio'} · ${itemId}`,
        campos,
        avisos: [
          ...(sensiveis.length ? [`Confira com atenção antes de aprovar: ${sensiveis.join(', ')}. São dados que o comprador usa para decidir e que o Mercado Livre pode questionar.`] : []),
          ...(recusadas ? [`${recusadas} ${recusadas === 1 ? 'mudança não escolhida será recusada' : 'mudanças não escolhidas serão recusadas'}.`] : []),
          'A publicação roda em segundo plano e é conferida no anúncio depois; dá para reverter pela tela do Mercado Livre.',
        ],
        payload: { propostaId: proposal.id, changeIds: escolhidas.map((c) => c.id) },
      }),
      itens: escolhidas.map((c) => ({
        alvo: `${c.label || c.fieldPath} · risco ${RISCO[c.riskLevel] ?? c.riskLevel}`,
        campos: [
          { campo: 'Antes', antes: null, depois: curto(c.oldValue, 800) || '—', mudou: false },
          { campo: 'Depois', antes: null, depois: curto(c.newValue, 800), mudou: true },
          { campo: 'Por quê', antes: null, depois: c.reason, mudou: false },
        ],
      })),
    };
  },
  execute: async (ctx, _a, preview) => {
    const { propostaId, changeIds } = preview.payload as { propostaId: string; changeIds: string[] };
    if (ctx.dryRun) return { dryRun: true, propostaId, mudancas: changeIds.length };
    await decideSelection(ctx.uid, propostaId, changeIds);
    // Idempotência pela proposta + seleção: um resume repetido cai na mesma execução.
    const chave = crypto.createHash('sha256').update(changeIds.slice().sort().join(',')).digest('hex').slice(0, 32);
    const run = await createMutationRun(ctx.uid, propostaId, `agente:${chave}`);
    scheduleMutation(ctx.uid, run.id);
    return { execucao: run.id, status: run.status, mudancas: changeIds.length };
  },
});
