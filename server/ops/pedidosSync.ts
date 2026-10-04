// Sync de pedidos do Centro de Operações: copia os pedidos da fonte (hoje só
// o Tiny v2) para `users/{uid}/ops_pedidos`, em ciclos curtos e limitados —
// nunca um job longo, porque no Cloud Run o timer não tem CPU garantida.
//
// Cada ciclo, sob lease: (1) incremental por data de alteração, (2) backfill
// de 7 em 7 dias até 90 dias atrás, (3) detalhe (itens e canal) dos pedidos
// que ainda não têm. O estado mora em `users/{uid}/ops_sync/{fonte}` e as
// regras (janelas, normalização) em src/modules/agent/ops/pedidos.ts.
//
// Só falhas vão para `agent_logs`: o backfill faz dezenas de chamadas por
// minuto e afogaria o painel de Logs do agente.
//
// Ver docs/superpowers/specs/2026-10-04-centro-de-operacoes-design.md.

import { randomUUID } from 'node:crypto';
import { adminDb } from '../firebaseAdmin';
import { getV2Token, limiteV2PorToken, tinyV2CallRaw } from '../tinyV2';
import { logCall } from '../agent/telemetry';
import type { Firestore } from 'firebase-admin/firestore';
import type { PlataformaOps } from '../../src/modules/agent/ops/papeis';
import {
  INATIVO_APOS_MS, INTERVALO_EM_DIA_MS, INTERVALO_PENDENTE_MS, SOBREPOSICAO_MS,
  dataBr, dataHoraBr, detalheTiny, diaBrt, estadoInicial, idDoc, janelaBackfill, orcamentoDoCiclo, resumoTiny, somaDias,
  type EstadoSync, type PedidoOps,
} from '../../src/modules/agent/ops/pedidos';

/**
 * O que o sync toca fora dele. Substituível só para scripts/verify-ops-sync.mjs,
 * que roda o ciclo inteiro contra um Tiny falso e um Firestore em memória.
 */
export const deps = {
  db: adminDb as Firestore,
  tokenTiny: (uid: string) => getV2Token(uid),
  logFalha: logCall,
};

/**
 * Credencial recusada. `tinyV2CallRaw` marca 401 em qualquer erro com
 * "inválido" no texto — inclusive "Data inválida" —, então o status sozinho
 * pausaria o sync por um parâmetro ruim. Só conta se o texto fala do token.
 */
export const ehCredencial = (e: any): boolean =>
  e?.status === 401 && /token|autoriz|acesso negado/i.test(String(e?.message ?? ''));

export const SYNC_REF = (uid: string, fonte: PlataformaOps) =>
  deps.db.collection('users').doc(uid).collection('ops_sync').doc(fonte);
export const PEDIDOS_COL = (uid: string) =>
  deps.db.collection('users').doc(uid).collection('ops_pedidos');

const LEASE_MS = 10 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

type Resumo = NonNullable<ReturnType<typeof resumoTiny>>;

// ---------------------------------------------------------------------------
// Adaptador por fonte. Bling/IdWorks/Wake entram implementando esta interface.
// ---------------------------------------------------------------------------

interface Pagina { resumos: Resumo[]; paginas: number }

interface Adaptador {
  /** Pedidos alterados desde `desde` (ms). Lança `RecusouAtualizacao` se a fonte não aceitar o filtro. */
  listarAtualizados(desde: number, pagina: number): Promise<Pagina>;
  /** Pedidos com data do pedido entre `inicio` e `fim` (YYYY-MM-DD, inclusivos). */
  listarPorData(inicio: string, fim: string, pagina: number): Promise<Pagina>;
  obter(idExterno: string): Promise<ReturnType<typeof detalheTiny> | null>;
}

class RecusouAtualizacao extends Error {}

function adaptadorTiny(uid: string, token: string, gastar: () => void): Adaptador {
  const chamar = async (endpoint: string, params: Record<string, string>) => {
    gastar();
    const inicio = Date.now();
    try {
      return await tinyV2CallRaw(token, endpoint, params);
    } catch (e: any) {
      void deps.logFalha(uid, {
        provider: 'tiny', tool: 'ops.sync', operacao: endpoint, alvo: 'Centro de Operações',
        requisicao: params, status: typeof e?.status === 'number' ? e.status : null,
        ok: false, erro: e?.message ?? String(e), ms: Date.now() - inicio,
      });
      throw e;
    }
  };
  const pagina = (r: any): Pagina => {
    const agoraIso = new Date().toISOString();
    const brutos: any[] = Array.isArray(r?.pedidos) ? r.pedidos : [];
    return {
      resumos: brutos.map((x) => resumoTiny(x?.pedido ?? x, agoraIso)).filter((x): x is Resumo => !!x),
      paginas: Number(r?.numero_paginas ?? 1) || 1,
    };
  };
  return {
    async listarAtualizados(desde, p) {
      try {
        return pagina(await chamar('pedidos.pesquisa.php', { dataAtualizacao: dataHoraBr(desde), pagina: String(p) }));
      } catch (e: any) {
        // Erro de validação na primeira página = o filtro não existe nesta conta/versão.
        // (O texto pode trazer "inválido", que o tinyV2CallRaw transforma em 401.)
        if (p === 1 && (e?.status === 400 || e?.status === 401) && !ehCredencial(e)) throw new RecusouAtualizacao(e.message);
        throw e;
      }
    },
    async listarPorData(inicio, fim, p) {
      return pagina(await chamar('pedidos.pesquisa.php', { dataInicial: dataBr(inicio), dataFinal: dataBr(fim), pagina: String(p) }));
    },
    async obter(id) {
      const r = await chamar('pedido.obter.php', { id });
      return r?.pedido ? detalheTiny(r.pedido) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

/** Grava os resumos; só escreve o que mudou. Valor diferente pede detalhe de novo. */
async function gravarResumos(uid: string, resumos: Resumo[]): Promise<void> {
  if (!resumos.length) return;
  const refs = resumos.map((r) => PEDIDOS_COL(uid).doc(idDoc(r.fonte, r.idExterno)));
  const snaps = await deps.db.getAll(...refs);
  const batch = deps.db.batch();
  let escritas = 0;
  resumos.forEach((r, i) => {
    const atual = snaps[i].exists ? (snaps[i].data() as PedidoOps) : null;
    if (!atual) {
      batch.set(refs[i], { ...r, detalhado: false });
      escritas++;
    } else if (atual.situacao !== r.situacao || atual.valor !== r.valor || atual.data !== r.data || atual.numero !== r.numero) {
      batch.set(refs[i], { ...r, ...(atual.valor !== r.valor ? { detalhado: false } : {}) }, { merge: true });
      escritas++;
    }
  });
  if (escritas) await batch.commit();
}

// ---------------------------------------------------------------------------
// Ciclo
// ---------------------------------------------------------------------------

async function pegarLease(uid: string, fonte: PlataformaOps, forcar: boolean): Promise<{ leaseId: string; estado: EstadoSync } | null> {
  const ref = SYNC_REF(uid, fonte);
  const leaseId = randomUUID();
  return deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const s = snap.data() as EstadoSync;
    const agora = Date.now();
    if (s.leaseUntil && s.leaseUntil > agora) return null;
    if (!forcar && (s.proximaEm == null || s.proximaEm > agora)) return null;
    tx.update(ref, { leaseId, leaseUntil: agora + LEASE_MS });
    return { leaseId, estado: s };
  });
}

/** Roda um ciclo para a conta. Devolve sem fazer nada se outro processo estiver com o lease. */
export async function rodarCiclo(uid: string, fonte: PlataformaOps, opts: { forcar?: boolean } = {}): Promise<void> {
  const lease = await pegarLease(uid, fonte, !!opts.forcar);
  if (!lease) return;
  const ref = SYNC_REF(uid, fonte);
  const s = lease.estado;
  const agora = Date.now();
  const soltar = async (campos: Record<string, unknown>): Promise<void> => {
    await ref.update({ ...campos, leaseId: null, leaseUntil: null }).catch(() => {});
  };

  // Ninguém abre o painel há 14 dias: pausa. A próxima visita religa.
  if (agora - (s.ultimaVisita ?? 0) > INATIVO_APOS_MS) return soltar({ proximaEm: null });

  const token = fonte === 'tiny' ? await deps.tokenTiny(uid).catch(() => null) : null;
  if (!token) return soltar({ proximaEm: null, erro: 'credencial', ultimoCicloEm: agora });

  const limite = limiteV2PorToken.get(token) ?? s.limitePorMinuto ?? null;
  let restante = orcamentoDoCiclo(limite);
  const gastar = () => { restante--; };
  const fonteApi = adaptadorTiny(uid, token, gastar);
  const inc = { ...s.incremental };
  const bf = { ...s.backfill };
  let detalhesPendentes = false;

  try {
    // 1 · Incremental: uma rodada completa de páginas (ou até o orçamento acabar).
    if (inc.inicioRodada == null) inc.inicioRodada = agora;
    while (restante > 0) {
      let r: Pagina;
      try {
        r = inc.modo === 'janela'
          ? await fonteApi.listarPorData(somaDias(diaBrt(agora), -6), diaBrt(agora), inc.pagina)
          : await fonteApi.listarAtualizados(inc.desde, inc.pagina);
      } catch (e) {
        if (e instanceof RecusouAtualizacao) { inc.modo = 'janela'; inc.pagina = 1; continue; }
        throw e;
      }
      await gravarResumos(uid, r.resumos);
      if (inc.pagina >= r.paginas) {
        inc.desde = inc.inicioRodada - SOBREPOSICAO_MS;
        inc.inicioRodada = null;
        inc.pagina = 1;
        break;
      }
      inc.pagina++;
    }

    // 2 · Backfill, com no máximo metade do que sobrou: o detalhe também precisa andar.
    const tetoBackfill = restante - Math.floor(restante / 2);
    const fazerBackfill = async (teto: number) => {
      const limite = restante - teto;
      while (restante > limite) {
        const janela = janelaBackfill(bf);
        if (!janela) return;
        const r = await fonteApi.listarPorData(janela.inicio, janela.fim, bf.pagina);
        await gravarResumos(uid, r.resumos);
        if (bf.pagina >= r.paginas) { bf.ate = janela.inicio; bf.pagina = 1; } else bf.pagina++;
      }
    };
    await fazerBackfill(tetoBackfill);

    // 3 · Detalhe (itens e canal).
    if (restante > 0) {
      const pendentes = await PEDIDOS_COL(uid).where('detalhado', '==', false).limit(restante).get();
      detalhesPendentes = pendentes.size >= restante;
      for (const doc of pendentes.docs) {
        if (restante <= 0) { detalhesPendentes = true; break; }
        const p = doc.data() as PedidoOps;
        let d: Awaited<ReturnType<Adaptador['obter']>> = null;
        try {
          d = await fonteApi.obter(p.idExterno);
        } catch (e: any) {
          if (ehCredencial(e)) throw e;
          // Pedido que a fonte não devolve não pode travar a fila: fica sem itens.
        }
        await doc.ref.update({
          detalhado: true,
          canal: d?.canal ?? 'Sem canal',
          itens: d?.itens ?? [],
          ...(d?.valor != null ? { valor: d.valor } : {}),
          ...(d?.situacao ? { situacao: d.situacao, situacaoOriginal: d.situacaoOriginal } : {}),
          ...(d ? {} : { detalheFalhou: true }),
        });
      }
    }

    // Sobrou orçamento: o backfill segue.
    if (restante > 0) await fazerBackfill(restante);

    const pendente = detalhesPendentes || !!janelaBackfill(bf) || inc.inicioRodada != null;
    await soltar({
      incremental: inc,
      backfill: bf,
      limitePorMinuto: limiteV2PorToken.get(token) ?? limite,
      erro: null,
      falhas: 0,
      ultimoCicloEm: Date.now(),
      proximaEm: Date.now() + (pendente ? INTERVALO_PENDENTE_MS : INTERVALO_EM_DIA_MS),
    });
  } catch (e: any) {
    const falhas = Number((s as any).falhas ?? 0) + 1;
    const credencial = ehCredencial(e);
    console.warn(`[ops-sync] ${uid}/${fonte} falhou:`, e?.message ?? String(e));
    // O progresso feito até o erro é mantido: o próximo ciclo continua dali.
    await soltar({
      incremental: inc,
      backfill: bf,
      falhas,
      erro: credencial ? 'credencial' : String(e?.message ?? e).slice(0, 300),
      ultimoCicloEm: Date.now(),
      proximaEm: credencial ? null : Date.now() + Math.min(BACKOFF_MAX_MS, 5 * 60_000 * 2 ** (falhas - 1)),
    });
  }
}

// ---------------------------------------------------------------------------
// Ligar (visita ao painel) e agendador
// ---------------------------------------------------------------------------

const emCurso = new Set<string>();

/** Dispara um ciclo em segundo plano, sem duplicar no mesmo processo. */
export function dispararCiclo(uid: string, fonte: PlataformaOps, forcar = false): void {
  const chave = `${uid}/${fonte}`;
  if (emCurso.has(chave)) return;
  emCurso.add(chave);
  rodarCiclo(uid, fonte, { forcar })
    .catch((e) => console.warn('[ops-sync] ciclo', chave, e?.message ?? e))
    .finally(() => emCurso.delete(chave));
}

const VISITA_GRAVA_A_CADA_MS = 60 * 60_000;

/**
 * Chamado a cada visita ao painel: cria o estado na primeira vez (idempotente),
 * marca a visita e religa um sync pausado (inativo ou credencial — o usuário
 * pode ter reconectado). Devolve o estado atual.
 */
export async function visitarSync(uid: string, fonte: PlataformaOps): Promise<EstadoSync> {
  const ref = SYNC_REF(uid, fonte);
  const agora = Date.now();
  const snap = await ref.get();
  if (!snap.exists) {
    const inicial = estadoInicial(fonte, agora);
    try {
      await ref.create(inicial);
      dispararCiclo(uid, fonte);
      return inicial;
    } catch {
      // Outra requisição criou no meio: segue como visita normal.
      return visitarSync(uid, fonte);
    }
  }
  const s = snap.data() as EstadoSync;
  const campos: Record<string, unknown> = {};
  if (agora - (s.ultimaVisita ?? 0) > VISITA_GRAVA_A_CADA_MS) campos.ultimaVisita = agora;
  if (s.proximaEm == null) { campos.proximaEm = agora; campos.erro = null; campos.ultimaVisita = agora; }
  if (Object.keys(campos).length) {
    await ref.update(campos);
    if (campos.proximaEm != null) dispararCiclo(uid, fonte);
  }
  return { ...s, ...campos } as EstadoSync;
}

let timer: NodeJS.Timeout | null = null;
let varrendo = false;

export async function varrerOpsSync(): Promise<void> {
  if (varrendo) return;
  varrendo = true;
  try {
    const snap = await deps.db.collectionGroup('ops_sync').where('proximaEm', '<=', Date.now()).limit(20).get();
    for (const doc of snap.docs) {
      const m = doc.ref.path.match(/^users\/([^/]+)\/ops_sync\/([^/]+)$/);
      if (m) dispararCiclo(m[1], m[2] as PlataformaOps);
    }
  } catch (e) {
    console.warn('[ops-sync] varredura falhou', e instanceof Error ? e.message : String(e));
  } finally {
    varrendo = false;
  }
}

export function startOpsSyncScheduler(): void {
  if (timer) return;
  void varrerOpsSync();
  timer = setInterval(() => void varrerOpsSync(), 60_000);
  timer.unref?.();
}
