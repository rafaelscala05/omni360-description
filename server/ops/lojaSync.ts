// Sync do catálogo da loja (Wake) do Centro de Operações: copia preço,
// estoque e visibilidade de cada variante para `users/{uid}/ops_loja`, base
// da comparação ERP × loja e dos preços (src/modules/agent/ops/catalogo.ts).
//
// Mesmo desenho do sync de pedidos (pedidosSync.ts): ciclos curtos sob lease,
// liga na visita ao painel, pausa após 14 dias sem visita. Cada ciclo faz uma
// varredura completa (a cada 24 h, pelo cursor `produtoVarianteIdDe` — o
// parâmetro `pagina` foi descontinuado em 21/09/2026) ou um incremental por
// `alteradosPartirDe` (no máximo 48 h para trás).
//
// O limite da Wake é 120/min por grupo de endpoints, compartilhado com o
// integrador do ERP, e 5 requisições acima dele bloqueiam o token por 1 h.
// Por isso o fetch aqui é próprio: sem o retry automático do `fbitsFetch` em
// 429 — um 429 encerra o ciclo e o próximo espera o `Retry-After`.

import { randomUUID } from 'node:crypto';
import { deps, SYNC_REF } from './pedidosSync';
import {
  CHAMADAS_LOJA_POR_CICLO, POR_PAGINA_WAKE, dataHoraWake, estadoInicialLoja, itemLojaWake, precisaVarredura,
  type EstadoLoja, type ItemLoja,
} from '../../src/modules/agent/ops/catalogo';
import { INATIVO_APOS_MS, INTERVALO_EM_DIA_MS, INTERVALO_PENDENTE_MS, SOBREPOSICAO_MS } from '../../src/modules/agent/ops/pedidos';

export const ID_SYNC_LOJA = 'wake-catalogo';
const WAKE_BASE = 'https://api.fbits.net';
const LEASE_MS = 10 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

export const LOJA_COL = (uid: string) =>
  deps.db.collection('users').doc(uid).collection('ops_loja');
const REF = (uid: string) => SYNC_REF(uid, ID_SYNC_LOJA);

interface PaginaWake { itens: ItemLoja[]; brutos: number; ultimo: string | null }

async function listarWake(uid: string, token: string, params: { cursor: string | null; alteradosPartirDe?: string }): Promise<PaginaWake> {
  const q = new URLSearchParams({ quantidadeRegistros: String(POR_PAGINA_WAKE), camposAdicionais: 'Estoque' });
  if (params.cursor) q.set('produtoVarianteIdDe', params.cursor);
  if (params.alteradosPartirDe) q.set('alteradosPartirDe', params.alteradosPartirDe);
  const caminho = `/produtos?${q.toString()}`;
  const inicio = Date.now();
  const falhar = <E extends Error & { status?: number }>(e: E): E => {
    void deps.logFalha(uid, {
      provider: 'wake', tool: 'ops.loja.sync', operacao: 'GET', alvo: '/produtos', requisicao: Object.fromEntries(q),
      status: typeof e.status === 'number' ? e.status : null, ok: false, erro: e.message, ms: Date.now() - inicio,
    });
    return e;
  };

  const res = await fetch(`${WAKE_BASE}${caminho}`, { headers: { Authorization: token, Accept: 'application/json' } });
  if (res.status === 429) {
    const espera = Number(res.headers.get('retry-after'));
    throw falhar(Object.assign(new Error('Limite de requisições da Wake atingido.'), { status: 429, retryAfterS: Number.isFinite(espera) && espera > 0 ? espera : 60 }));
  }
  if (res.status === 401 || res.status === 403) {
    throw falhar(Object.assign(new Error('Token Wake inválido ou sem permissão.'), { status: 401, credencial: true }));
  }
  // A Wake responde 404 numa lista vazia (incremental sem alterações).
  if (res.status === 404) return { itens: [], brutos: 0, ultimo: null };
  const texto = await res.text();
  if (!res.ok) throw falhar(Object.assign(new Error(`Wake respondeu ${res.status}: ${texto.slice(0, 200)}`), { status: res.status }));
  let json: unknown;
  try { json = texto ? JSON.parse(texto) : []; } catch { json = []; }
  const brutos: any[] = Array.isArray(json) ? json : [];
  const ids = brutos.map((p) => Number(p?.produtoVarianteId)).filter((n) => Number.isFinite(n));
  const ultimo = res.headers.get('x-ultimo-produto-variante-id') || (ids.length ? String(Math.max(...ids)) : null);
  return { itens: brutos.map(itemLojaWake).filter((x): x is ItemLoja => !!x), brutos: brutos.length, ultimo };
}

async function gravar(uid: string, itens: ItemLoja[], extra: Record<string, unknown>): Promise<void> {
  if (!itens.length) return;
  const batch = deps.db.batch();
  const agora = new Date().toISOString();
  for (const i of itens) batch.set(LOJA_COL(uid).doc(i.varianteId), { ...i, ...extra, atualizadoEm: agora }, { merge: true });
  await batch.commit();
}

/** Fim da varredura: o que não foi visto nesta rodada saiu da loja. */
async function limparAusentes(uid: string, rodada: string): Promise<void> {
  for (;;) {
    const snap = await LOJA_COL(uid).where('rodada', '!=', rodada).limit(400).get();
    if (snap.empty) return;
    const batch = deps.db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    if (snap.size < 400) return;
  }
}

async function pegarLease(uid: string, forcar: boolean): Promise<EstadoLoja | null> {
  const ref = REF(uid);
  const leaseId = randomUUID();
  return deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const s = snap.data() as EstadoLoja;
    const agora = Date.now();
    if (s.leaseUntil && s.leaseUntil > agora) return null;
    if (!forcar && (s.proximaEm == null || s.proximaEm > agora)) return null;
    tx.update(ref, { leaseId, leaseUntil: agora + LEASE_MS });
    return s;
  });
}

export async function rodarCicloLoja(uid: string, opts: { forcar?: boolean } = {}): Promise<void> {
  const s = await pegarLease(uid, !!opts.forcar);
  if (!s) return;
  const ref = REF(uid);
  const agora = Date.now();
  const soltar = async (campos: Record<string, unknown>): Promise<void> => {
    await ref.update({ ...campos, leaseId: null, leaseUntil: null }).catch(() => {});
  };

  if (agora - (s.ultimaVisita ?? 0) > INATIVO_APOS_MS) return soltar({ proximaEm: null });
  const token = await deps.tokenWake(uid).catch(() => null);
  if (!token) return soltar({ proximaEm: null, erro: 'credencial', ultimoCicloEm: agora });

  let restante = CHAMADAS_LOJA_POR_CICLO;
  const v = { ...s.varredura };
  const inc = { ...s.incremental };
  try {
    if (precisaVarredura(s, agora)) {
      if (!v.rodada) { v.rodada = String(agora); v.cursor = null; v.lidos = 0; inc.inicioRodada = agora; }
      while (restante-- > 0) {
        const p = await listarWake(uid, token, { cursor: v.cursor });
        await gravar(uid, p.itens, { rodada: v.rodada });
        v.lidos += p.itens.length;
        if (p.brutos < POR_PAGINA_WAKE || !p.ultimo) {
          await limparAusentes(uid, v.rodada);
          // O incremental começa de quando a varredura começou: o que mudou durante ela entra de novo.
          inc.desde = (inc.inicioRodada ?? agora) - SOBREPOSICAO_MS;
          inc.inicioRodada = null;
          inc.cursor = null;
          v.ultimaConcluidaEm = Date.now();
          v.rodada = null;
          v.cursor = null;
          break;
        }
        v.cursor = p.ultimo;
      }
    } else {
      if (inc.inicioRodada == null) inc.inicioRodada = agora;
      while (restante-- > 0) {
        const p = await listarWake(uid, token, { cursor: inc.cursor, alteradosPartirDe: dataHoraWake(inc.desde as number) });
        // `rodada` sempre preenchida: o `!=` da limpeza não enxerga doc sem o campo.
        await gravar(uid, p.itens, { rodada: 'inc' });
        if (p.brutos < POR_PAGINA_WAKE || !p.ultimo) {
          inc.desde = inc.inicioRodada - SOBREPOSICAO_MS;
          inc.inicioRodada = null;
          inc.cursor = null;
          break;
        }
        inc.cursor = p.ultimo;
      }
    }
    const pendente = !!v.rodada || inc.inicioRodada != null;
    await soltar({
      varredura: v, incremental: inc, erro: null, falhas: 0, ultimoCicloEm: Date.now(),
      proximaEm: Date.now() + (pendente ? INTERVALO_PENDENTE_MS : INTERVALO_EM_DIA_MS),
    });
  } catch (e: any) {
    console.warn(`[ops-loja] ${uid} falhou:`, e?.message ?? String(e));
    if (e?.status === 429) {
      // Limite não é falha da conta: espera o que a Wake pediu e segue de onde parou.
      return soltar({ varredura: v, incremental: inc, ultimoCicloEm: Date.now(), proximaEm: Date.now() + (e.retryAfterS + 5) * 1000 });
    }
    const falhas = Number(s.falhas ?? 0) + 1;
    await soltar({
      varredura: v, incremental: inc, falhas, ultimoCicloEm: Date.now(),
      erro: e?.credencial ? 'credencial' : String(e?.message ?? e).slice(0, 300),
      proximaEm: e?.credencial ? null : Date.now() + Math.min(BACKOFF_MAX_MS, 5 * 60_000 * 2 ** (falhas - 1)),
    });
  }
}

const emCurso = new Set<string>();

export function dispararCicloLoja(uid: string, forcar = false): void {
  if (emCurso.has(uid)) return;
  emCurso.add(uid);
  rodarCicloLoja(uid, { forcar })
    .catch((e) => console.warn('[ops-loja] ciclo', uid, e?.message ?? e))
    .finally(() => emCurso.delete(uid));
}

/** Visita ao painel: cria o estado na primeira vez, marca a visita e religa um sync pausado. */
export async function visitarLoja(uid: string): Promise<EstadoLoja> {
  const ref = REF(uid);
  const agora = Date.now();
  const snap = await ref.get();
  if (!snap.exists) {
    const inicial = estadoInicialLoja(agora);
    try {
      await ref.create(inicial);
      dispararCicloLoja(uid);
      return inicial;
    } catch {
      return visitarLoja(uid);
    }
  }
  const s = snap.data() as EstadoLoja;
  const campos: Record<string, unknown> = {};
  if (agora - (s.ultimaVisita ?? 0) > 60 * 60_000) campos.ultimaVisita = agora;
  if (s.proximaEm == null) { campos.proximaEm = agora; campos.erro = null; campos.ultimaVisita = agora; }
  if (Object.keys(campos).length) {
    await ref.update(campos);
    if (campos.proximaEm != null) dispararCicloLoja(uid);
  }
  return { ...s, ...campos } as EstadoLoja;
}

export async function lerLoja(uid: string): Promise<ItemLoja[]> {
  const snap = await LOJA_COL(uid).get();
  return snap.docs.map((d) => d.data() as ItemLoja);
}
