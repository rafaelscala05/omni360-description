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
import { custoDaAcao } from '../execution';
import { CREDIT_ACTIONS } from '../../../src/credits';
import { addPictureChange } from '../../meli/proposals';
import { generateListingPicture, TARGET_ORDER, type MeliGeneratedPictureKind } from '../../meli/pictureGenerator';
import { getListingMedia } from '../../meli/videoAssets';
import { assertNoActiveVideoJob } from '../../videoShared';
import { faltaParaVideo, montarPedidoVideoMeli, produtoDoAnuncio, type PedidoVideo } from '../videoPedido';

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

// ---------------------------------------------------------------------------
// Mídia do anúncio pelo chat: foto gerada (vai para a proposta) e vídeo
// ---------------------------------------------------------------------------

const fotosDoAnuncio = (pictures: unknown): string[] =>
  (Array.isArray(pictures) ? pictures : [])
    .map((p) => String((p as { secure_url?: string; url?: string })?.secure_url || (p as { url?: string })?.url || ''))
    .filter((u) => /^https:\/\//i.test(u));

interface ArgsFoto { itemId: string; tipo: 'lifestyle' | 'white_background'; instrucoes?: string }

registerTool<ArgsFoto>({
  name: 'meli.foto.gerar',
  provider: 'meli',
  mode: 'write',
  description: 'Gera uma foto nova para um anúncio do Mercado Livre a partir da foto atual — tipo "white_background" (capa em fundo branco, a da busca) ou "lifestyle" (produto em uso) — e a coloca na proposta do anúncio como mudança pendente. Não publica: para ir ao anúncio, depois o usuário aprova e publica a proposta (meli.proposta.publicar). Debita uma ambientação.',
  schema: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'Código do anúncio (MLB…).' },
      tipo: { type: 'string', enum: ['lifestyle', 'white_background'] },
      instrucoes: { type: 'string', description: 'Pedido do usuário sobre a cena (opcional, sem links).' },
    },
    required: ['itemId', 'tipo'],
  },
  preview: async (ctx, a) => {
    const itemId = requireStr(a as never, 'itemId').toUpperCase();
    const snap = await LISTINGS(ctx.uid).doc(itemId).get();
    if (!snap.exists) throw Object.assign(new Error(`Anúncio ${itemId} não encontrado — sincronize o Mercado Livre.`), { status: 404 });
    const listing = snap.data() as { title?: string; pictures?: unknown };
    const fotos = fotosDoAnuncio(listing.pictures);
    if (!fotos.length) throw Object.assign(new Error('O anúncio não tem foto para servir de base.'), { status: 422 });
    const capa = a.tipo === 'white_background';
    return {
      ...makePreview({
        resumo: `Gerar ${capa ? 'uma capa em fundo branco' : 'uma foto ambientada'} para "${listing.title ?? itemId}"`,
        alvo: `Mercado Livre · ${itemId}`,
        campos: [
          { campo: 'Foto base', antes: null, depois: 'a primeira foto do anúncio', mudou: true },
          { campo: 'Destino', antes: `${fotos.length} fotos no anúncio`, depois: capa ? 'nova capa (posição 1) na proposta' : 'foto nova na proposta', mudou: true },
          ...(a.instrucoes ? [{ campo: 'Pedido', antes: null, depois: curto(a.instrucoes, 200), mudou: true }] : []),
        ],
        avisos: ['A foto entra na proposta do anúncio como mudança pendente — nada vai ao Mercado Livre até você publicar a proposta.'],
        criacao: true,
        payload: { itemId, tipo: a.tipo, instrucoes: a.instrucoes ?? null },
      }),
      // O débito acontece dentro de generateListingPicture.
      custo: await custoDaAcao(CREDIT_ACTIONS.ambientImage),
    };
  },
  execute: async (ctx, _a, preview) => {
    const { itemId, tipo, instrucoes } = preview.payload as { itemId: string; tipo: MeliGeneratedPictureKind; instrucoes: string | null };
    if (ctx.dryRun) return { dryRun: true, itemId, tipo };
    const foto = await generateListingPicture(ctx.uid, itemId, { kind: tipo, instructions: instrucoes });
    await addPictureChange(ctx.uid, itemId, {
      source: foto.url, targetOrder: TARGET_ORDER[tipo], generatedPictureId: foto.id,
      reason: tipo === 'white_background'
        ? 'Nova capa em fundo branco: é a foto que aparece na busca e a que mais pesa no clique.'
        : 'Foto ambientada mostra o produto em uso e ajuda o comprador a se imaginar com ele.',
    });
    return { itemId, foto: foto.url, status: 'na proposta, aguardando publicação' };
  },
});

registerTool<{ itemId: string }>({
  name: 'meli.video.gerar',
  provider: 'meli',
  mode: 'write',
  description: 'Produz o vídeo vertical de um anúncio do Mercado Livre — o mesmo do estúdio de vídeo do anúncio: roteiro a partir das fotos do anúncio e da referência do produto. Leva alguns minutos, começa com o app aberto e aparece em Atividade › Rodando. O Mercado Livre não aceita envio de vídeo por integração: o vídeo fica pronto na mídia do anúncio para o usuário subir como Clip. Exige a referência do produto criada no estúdio do anúncio.',
  schema: {
    type: 'object',
    properties: { itemId: { type: 'string', description: 'Código do anúncio (MLB…).' } },
    required: ['itemId'],
  },
  preview: async (ctx, a) => {
    const userSnap = await adminDb.collection('users').doc(ctx.uid).get();
    if (userSnap.data()?.modules?.video !== true) {
      throw Object.assign(new Error('O módulo de vídeo não está ativo nesta conta.'), { status: 403 });
    }
    const itemId = requireStr(a as never, 'itemId').toUpperCase();
    const snap = await LISTINGS(ctx.uid).doc(itemId).get();
    if (!snap.exists) throw Object.assign(new Error(`Anúncio ${itemId} não encontrado — sincronize o Mercado Livre.`), { status: 404 });
    const listing = snap.data() as { title?: string; pictures?: unknown; descriptionPlainText?: string; attributes?: { id?: string; value_name?: string }[] };
    const media = await getListingMedia(ctx.uid, itemId);
    const anuncio = {
      itemId,
      title: listing.title,
      descricao: listing.descriptionPlainText,
      marca: listing.attributes?.find((x) => x.id === 'BRAND')?.value_name,
      fotos: fotosDoAnuncio(listing.pictures),
      referencia: media.productReference,
    };
    const falta = faltaParaVideo(produtoDoAnuncio(anuncio)).filter((f) => f !== 'título SEO');
    if (falta.length) {
      throw Object.assign(new Error(`Antes do vídeo, o anúncio precisa de: ${falta.join(', ').replace('aba Vídeo do produto', 'estúdio de vídeo do anúncio')}.`), { status: 409 });
    }
    await assertNoActiveVideoJob(ctx.uid);
    const pedido = montarPedidoVideoMeli(anuncio);
    return {
      ...makePreview({
        resumo: `Produzir o vídeo do anúncio "${listing.title ?? itemId}"`,
        alvo: `Mercado Livre · ${itemId}`,
        campos: [
          { campo: 'Formato', antes: null, depois: 'Vertical 9:16, ~32s, narração em off e música', mudou: true },
          { campo: 'Fotos de referência', antes: null, depois: `${pedido.inicio.productPhotoUrls?.length ?? 0} fotos do anúncio + a referência do produto`, mudou: true },
          { campo: 'Vídeo atual', antes: media.videoUrl ? 'já tem um vídeo gerado' : 'sem vídeo', depois: 'vídeo novo na mídia do anúncio', mudou: true },
        ],
        avisos: [
          'O Mercado Livre não aceita vídeo por integração: depois de pronto, suba o vídeo como Clip na Central de Vendedores.',
          'Leva alguns minutos e começa logo depois da aprovação, com o app aberto. Se falhar, os créditos voltam.',
        ],
        payload: { pedido },
      }),
      custo: await custoDaAcao(CREDIT_ACTIONS.videoGeneration),
    };
  },
  execute: async (ctx, _a, preview) => {
    const { pedido } = preview.payload as { pedido: PedidoVideo };
    if (ctx.dryRun) return { dryRun: true, anuncio: pedido.inicio.productName };
    // Só registra o pedido aprovado; quem roda é /api/agent/video/:actionId/iniciar.
    return { pedidoVideo: pedido, status: 'aguardando início' };
  },
});
