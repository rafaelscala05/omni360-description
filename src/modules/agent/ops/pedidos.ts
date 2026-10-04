// Regras puras do sync de pedidos do Centro de Operações: normalização da
// situação, o doc compacto (`users/{uid}/ops_pedidos`) montado a partir do
// Tiny e as janelas de backfill. O I/O mora em server/ops/pedidosSync.ts.
// Verificar com `npx tsx scripts/verify-ops.mjs`.

import type { PlataformaOps } from './papeis';

export type SituacaoOps = 'aberto' | 'aprovado' | 'faturado' | 'enviado' | 'entregue' | 'cancelado' | 'outro';

export const ORDEM_FUNIL: SituacaoOps[] = ['aberto', 'aprovado', 'faturado', 'enviado', 'entregue'];

export const ROTULO_SITUACAO: Record<SituacaoOps, string> = {
  aberto: 'Em aberto',
  aprovado: 'Aprovado',
  faturado: 'Faturado',
  enviado: 'Enviado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
  outro: 'Outros',
};

export interface ItemPedidoOps { sku: string; qtd: number; valor: number }

export interface PedidoOps {
  fonte: PlataformaOps;
  idExterno: string;
  numero: string;
  /** Data do pedido, YYYY-MM-DD (horário de Brasília). */
  data: string;
  situacao: SituacaoOps;
  situacaoOriginal: string;
  valor: number;
  /** Nome do canal de venda (e-commerce/marketplace); só depois do detalhe. */
  canal?: string;
  itens?: ItemPedidoOps[];
  detalhado: boolean;
  atualizadoEm: string;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const MAPA_TINY: Record<string, SituacaoOps> = {
  'em aberto': 'aberto',
  aberto: 'aberto',
  'dados incompletos': 'aberto',
  aprovado: 'aprovado',
  'preparando envio': 'aprovado',
  'em andamento': 'aprovado',
  faturado: 'faturado',
  'pronto para envio': 'faturado',
  enviado: 'enviado',
  entregue: 'entregue',
  cancelado: 'cancelado',
};

export function normalizarSituacao(original: unknown): SituacaoOps {
  return MAPA_TINY[semAcento(String(original ?? ''))] ?? 'outro';
}

/** "1.234,56" | "1234.56" | 12 → número; lixo → 0. */
export function numeroBr(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim();
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** "dd/mm/aaaa" → "aaaa-mm-dd"; inválida → "". */
export function dataIso(br: unknown): string {
  const m = String(br ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** "aaaa-mm-dd" → "dd/mm/aaaa". */
export const dataBr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Brasil não tem horário de verão desde 2019: UTC−3 fixo. */
const BRT_MS = 3 * 3600_000;

/** Dia (YYYY-MM-DD) de um instante, no horário de Brasília. */
export const diaBrt = (ms: number): string => new Date(ms - BRT_MS).toISOString().slice(0, 10);

/** "dd/mm/aaaa hh:mm:ss" de um instante, no horário de Brasília — o formato de `dataAtualizacao`. */
export function dataHoraBr(ms: number): string {
  const d = new Date(ms - BRT_MS).toISOString();
  return `${dataBr(d.slice(0, 10))} ${d.slice(11, 19)}`;
}

/** Soma `dias` a um dia YYYY-MM-DD. */
export function somaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias inteiros entre dois dias YYYY-MM-DD (b − a). */
export const diasEntre = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Resumo de `pedidos.pesquisa.php` (item já desembrulhado) → campos do doc. Sem id ou data → null. */
export function resumoTiny(p: any, agoraIso: string): Omit<PedidoOps, 'detalhado' | 'canal' | 'itens'> | null {
  const id = String(p?.id ?? '').trim();
  const data = dataIso(p?.data_pedido);
  if (!id || !data) return null;
  const original = String(p?.situacao ?? '');
  return {
    fonte: 'tiny',
    idExterno: id,
    numero: String(p?.numero ?? id),
    data,
    situacao: normalizarSituacao(original),
    situacaoOriginal: original,
    valor: numeroBr(p?.valor ?? p?.total_pedido),
    atualizadoEm: agoraIso,
  };
}

/** `pedido.obter.php` (`retorno.pedido`) → itens e canal. */
export function detalheTiny(p: any): { itens: ItemPedidoOps[]; canal: string; valor?: number; situacao?: SituacaoOps; situacaoOriginal?: string } {
  const brutos: any[] = Array.isArray(p?.itens) ? p.itens : [];
  const itens = brutos
    .map((x) => x?.item ?? x)
    .map((i) => ({ sku: String(i?.codigo ?? '').trim(), qtd: numeroBr(i?.quantidade), valor: numeroBr(i?.valor_unitario) }))
    .filter((i) => i.sku && i.qtd > 0);
  const canal = String(p?.ecommerce?.nomeEcommerce ?? p?.ecommerce?.nome ?? '').trim();
  const out: ReturnType<typeof detalheTiny> = { itens, canal: canal || 'Sem canal' };
  if (p?.total_pedido != null) out.valor = numeroBr(p.total_pedido);
  if (p?.situacao) { out.situacao = normalizarSituacao(p.situacao); out.situacaoOriginal = String(p.situacao); }
  return out;
}

export const idDoc = (fonte: PlataformaOps, idExterno: string) => `${fonte}_${idExterno}`;

// ---------------------------------------------------------------------------
// Estado do sync (users/{uid}/ops_sync/{fonte})
// ---------------------------------------------------------------------------

export const HISTORICO_DIAS = 90;
export const JANELA_BACKFILL_DIAS = 7;
export const INATIVO_APOS_MS = 14 * 86_400_000;
export const INTERVALO_EM_DIA_MS = 15 * 60_000;
export const INTERVALO_PENDENTE_MS = 60_000;
export const SOBREPOSICAO_MS = 10 * 60_000;

export interface EstadoSync {
  fonte: PlataformaOps;
  criadoEm: string;
  ultimaVisita: number;
  /** null = pausado (inativo ou credencial); a próxima visita religa. */
  proximaEm: number | null;
  leaseId?: string | null;
  leaseUntil?: number | null;
  incremental: {
    /** Instante (ms) a partir do qual buscar alterações. */
    desde: number;
    /** Início da rodada em curso: vira o novo `desde` quando as páginas acabam. */
    inicioRodada: number | null;
    pagina: number;
    /** `janela` = o Tiny recusou `dataAtualizacao`; reescaneia os últimos 7 dias. */
    modo: 'atualizacao' | 'janela';
  };
  backfill: {
    /** Dia mais antigo já coberto (YYYY-MM-DD, inclusivo). */
    ate: string;
    alvo: string;
    pagina: number;
  };
  erro?: string | null;
  ultimoCicloEm?: number | null;
}

export function estadoInicial(fonte: PlataformaOps, agora: number): EstadoSync {
  const hoje = diaBrt(agora);
  return {
    fonte,
    criadoEm: new Date(agora).toISOString(),
    ultimaVisita: agora,
    proximaEm: agora,
    leaseId: null,
    leaseUntil: null,
    incremental: { desde: agora - SOBREPOSICAO_MS, inicioRodada: null, pagina: 1, modo: 'atualizacao' },
    // `ate` = amanhã: a primeira janela do backfill começa em hoje.
    backfill: { ate: somaDias(hoje, 1), alvo: somaDias(hoje, -HISTORICO_DIAS), pagina: 1 },
    erro: null,
    ultimoCicloEm: null,
  };
}

/** Próxima janela do backfill (dias inclusivos), andando para trás; null = histórico completo. */
export function janelaBackfill(b: EstadoSync['backfill']): { inicio: string; fim: string } | null {
  if (b.ate <= b.alvo) return null;
  const fim = somaDias(b.ate, -1);
  const inicio = somaDias(fim, -(JANELA_BACKFILL_DIAS - 1));
  return { inicio: inicio < b.alvo ? b.alvo : inicio, fim };
}

/** Fração do histórico já importada (0–1). */
export function progressoBackfill(b: EstadoSync['backfill'], agora: number): number {
  const total = diasEntre(b.alvo, somaDias(diaBrt(agora), 1));
  if (total <= 0) return 1;
  const feitos = diasEntre(b.ate, somaDias(diaBrt(agora), 1));
  return Math.max(0, Math.min(1, feitos / total));
}

export type EstadoPainelSync = 'importando' | 'em-dia' | 'erro' | 'credencial' | 'pausado';

export function estadoDoSync(s: EstadoSync | null, agora: number): { estado: EstadoPainelSync; progresso: number; atualizadoEm: number | null } {
  if (!s) return { estado: 'importando', progresso: 0, atualizadoEm: null };
  const progresso = progressoBackfill(s.backfill, agora);
  const atualizadoEm = s.ultimoCicloEm ?? null;
  if (s.erro === 'credencial') return { estado: 'credencial', progresso, atualizadoEm };
  if (s.erro) return { estado: 'erro', progresso, atualizadoEm };
  if (s.proximaEm == null) return { estado: 'pausado', progresso, atualizadoEm };
  return { estado: progresso < 1 ? 'importando' : 'em-dia', progresso, atualizadoEm };
}
