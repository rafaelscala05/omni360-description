// Catálogo e preços do Centro de Operações (puro, usado pelos dois lados):
// compara o catálogo do ERP (o que o OMNI360 importou do Tiny/Bling/IdWorks)
// com o da loja (a cópia da Wake em `ops_loja`, de server/ops/lojaSync.ts),
// pela SKU, e lê as promoções e a margem da loja. Verificar com
// `npx tsx scripts/verify-ops.mjs`.

import { numeroBr } from './pedidos';

export interface ItemErp {
  sku: string;
  nome: string;
  preco: number | null;
  precoPromocional: number | null;
  custo: number | null;
  estoque: number | null;
}

export interface ItemLoja {
  varianteId: string;
  produtoId: string;
  sku: string;
  nome: string;
  precoPor: number | null;
  precoDe: number | null;
  precoCusto: number | null;
  estoque: number | null;
  exibirSite: boolean;
  valido: boolean;
}

const numOuNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = numeroBr(v);
  return Number.isFinite(n) ? n : null;
};

/** Produto do catálogo do OMNI360 → lado ERP. Só produto vindo de ERP; pai de variação fica de fora. */
export interface ProdutoCatalogo {
  'Código (SKU)'?: string;
  'Descrição'?: string;
  'Código do pai'?: string;
  'Preço'?: string | number;
  'Preço promocional'?: string | number;
  'Preço de custo'?: string | number;
  'Estoque'?: string | number;
  _tinyProductId?: string;
  _blingProductId?: string;
  _idworksProductId?: string;
}

export function itensErp(produtos: ProdutoCatalogo[]): ItemErp[] {
  const pais = new Set(produtos.map((p) => String(p['Código do pai'] ?? '').trim()).filter(Boolean));
  const out: ItemErp[] = [];
  for (const p of produtos) {
    if (!p._tinyProductId && !p._blingProductId && !p._idworksProductId) continue;
    const sku = String(p['Código (SKU)'] ?? '').trim();
    if (!sku || pais.has(sku)) continue;
    out.push({
      sku,
      nome: String(p['Descrição'] ?? sku),
      preco: numOuNull(p['Preço']),
      precoPromocional: numOuNull(p['Preço promocional']),
      custo: numOuNull(p['Preço de custo']),
      estoque: numOuNull(p['Estoque']),
    });
  }
  return out;
}

/** Item de `GET /produtos` da Wake (com `camposAdicionais=Estoque`) → doc de `ops_loja`. */
export function itemLojaWake(p: any): ItemLoja | null {
  const varianteId = String(p?.produtoVarianteId ?? '').trim();
  const sku = String(p?.sku ?? '').trim();
  if (!varianteId || !sku) return null;
  const cds: any[] = Array.isArray(p?.estoque) ? p.estoque : [];
  const estoque = cds.length
    ? cds.reduce((s, c) => s + (Number(c?.estoqueFisico) || 0) - (Number(c?.estoqueReservado) || 0), 0)
    : null;
  const pos = (v: unknown) => { const n = numOuNull(v); return n && n > 0 ? n : null; };
  return {
    varianteId,
    produtoId: String(p?.produtoId ?? ''),
    sku,
    nome: String(p?.nome ?? sku),
    precoPor: numOuNull(p?.precoPor),
    precoDe: pos(p?.precoDe),
    precoCusto: pos(p?.precoCusto),
    estoque,
    exibirSite: p?.exibirSite !== false,
    valido: p?.valido !== false,
  };
}

/** Preço que o cliente paga no ERP: o promocional quando é menor que o cheio. */
export function precoFinalErp(i: ItemErp): number | null {
  if (i.precoPromocional && i.precoPromocional > 0 && (!i.preco || i.precoPromocional < i.preco)) return i.precoPromocional;
  return i.preco && i.preco > 0 ? i.preco : null;
}

export const MARGEM_BAIXA = 0.15;
const TOP = 20;

export interface LinhaCatalogo { sku: string; nome: string; estoque: number | null }
export interface LinhaEstoque { sku: string; nome: string; erp: number; loja: number }
export interface LinhaPreco { sku: string; nome: string; erp: number; loja: number }
export interface LinhaPromo { sku: string; nome: string; de: number; por: number; desconto: number }
export interface LinhaMargem { sku: string; nome: string; preco: number; custo: number; margem: number }

export interface PainelCatalogo {
  /** Há os dois lados para comparar. */
  comparado: boolean;
  totalErp: number;
  totalLoja: number;
  emAmbos: number;
  foraDaLoja: { total: number; comEstoque: number; itens: LinhaCatalogo[] };
  foraDoErp: { total: number; itens: LinhaCatalogo[] };
  ocultosComEstoque: { total: number; itens: LinhaCatalogo[] };
  estoqueDiferente: { total: number; itens: LinhaEstoque[] };
}

export interface PainelPrecos {
  comparado: boolean;
  precoDiferente: { total: number; itens: LinhaPreco[] };
  semPrecoNaLoja: { total: number; itens: LinhaCatalogo[] };
  promocoes: { total: number; descontoMedio: number | null; itens: LinhaPromo[] };
  abaixoDoCusto: { total: number; itens: LinhaMargem[] };
  margemBaixa: { total: number; itens: LinhaMargem[] };
  /** Itens da loja à venda com custo conhecido (Wake ou ERP) / total à venda. */
  comCusto: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function painelCatalogo(erp: ItemErp[] | null, loja: ItemLoja[]): PainelCatalogo {
  const porSkuLoja = new Map(loja.map((l) => [l.sku, l]));
  const porSkuErp = new Map((erp ?? []).map((e) => [e.sku, e]));

  const foraDaLoja = (erp ?? []).filter((e) => !porSkuLoja.has(e.sku));
  foraDaLoja.sort((a, b) => (b.estoque ?? 0) - (a.estoque ?? 0));
  const foraDoErp = erp ? loja.filter((l) => !porSkuErp.has(l.sku)) : [];

  // Na loja, mas sem aparecer: oculto ou inválido com saldo (do ERP quando há, senão da própria loja).
  const ocultos = loja
    .filter((l) => !l.exibirSite || !l.valido)
    .map((l) => ({ l, estoque: porSkuErp.get(l.sku)?.estoque ?? l.estoque }))
    .filter((x) => (x.estoque ?? 0) > 0)
    .sort((a, b) => (b.estoque ?? 0) - (a.estoque ?? 0));

  const estoqueDiferente: LinhaEstoque[] = [];
  if (erp) {
    for (const l of loja) {
      const e = porSkuErp.get(l.sku);
      if (!e || e.estoque === null || l.estoque === null) continue;
      if (Math.round(e.estoque) !== Math.round(l.estoque)) estoqueDiferente.push({ sku: l.sku, nome: l.nome, erp: e.estoque, loja: l.estoque });
    }
    estoqueDiferente.sort((a, b) => Math.abs(b.erp - b.loja) - Math.abs(a.erp - a.loja));
  }

  const linha = (x: { sku: string; nome: string }, estoque: number | null): LinhaCatalogo => ({ sku: x.sku, nome: x.nome, estoque });
  return {
    comparado: !!erp,
    totalErp: erp?.length ?? 0,
    totalLoja: loja.length,
    emAmbos: erp ? loja.filter((l) => porSkuErp.has(l.sku)).length : 0,
    foraDaLoja: {
      total: foraDaLoja.length,
      comEstoque: foraDaLoja.filter((e) => (e.estoque ?? 0) > 0).length,
      itens: foraDaLoja.slice(0, TOP).map((e) => linha(e, e.estoque)),
    },
    foraDoErp: { total: foraDoErp.length, itens: foraDoErp.slice(0, TOP).map((l) => linha(l, l.estoque)) },
    ocultosComEstoque: { total: ocultos.length, itens: ocultos.slice(0, TOP).map((x) => linha(x.l, x.estoque)) },
    estoqueDiferente: { total: estoqueDiferente.length, itens: estoqueDiferente.slice(0, TOP) },
  };
}

export function painelPrecos(erp: ItemErp[] | null, loja: ItemLoja[]): PainelPrecos {
  const porSkuErp = new Map((erp ?? []).map((e) => [e.sku, e]));
  const aVenda = loja.filter((l) => l.exibirSite && l.valido);

  const precoDiferente: LinhaPreco[] = [];
  if (erp) {
    for (const l of aVenda) {
      const e = porSkuErp.get(l.sku);
      const pe = e ? precoFinalErp(e) : null;
      if (pe === null || !l.precoPor || l.precoPor <= 0) continue;
      if (Math.abs(pe - l.precoPor) > 0.01) precoDiferente.push({ sku: l.sku, nome: l.nome, erp: pe, loja: l.precoPor });
    }
    precoDiferente.sort((a, b) => Math.abs(b.erp - b.loja) / b.erp - Math.abs(a.erp - a.loja) / a.erp);
  }

  const semPreco = aVenda.filter((l) => !l.precoPor || l.precoPor <= 0);

  const promos: LinhaPromo[] = aVenda
    .filter((l) => l.precoDe && l.precoPor && l.precoPor > 0 && l.precoDe > l.precoPor)
    .map((l) => ({ sku: l.sku, nome: l.nome, de: l.precoDe as number, por: l.precoPor as number, desconto: r2(1 - (l.precoPor as number) / (l.precoDe as number)) }))
    .sort((a, b) => b.desconto - a.desconto);

  const margens: LinhaMargem[] = [];
  for (const l of aVenda) {
    if (!l.precoPor || l.precoPor <= 0) continue;
    const custo = l.precoCusto ?? porSkuErp.get(l.sku)?.custo ?? null;
    if (!custo || custo <= 0) continue;
    margens.push({ sku: l.sku, nome: l.nome, preco: l.precoPor, custo, margem: r2((l.precoPor - custo) / l.precoPor) });
  }
  margens.sort((a, b) => a.margem - b.margem);
  const abaixo = margens.filter((m) => m.margem < 0);
  const baixa = margens.filter((m) => m.margem >= 0 && m.margem < MARGEM_BAIXA);

  return {
    comparado: !!erp,
    precoDiferente: { total: precoDiferente.length, itens: precoDiferente.slice(0, TOP) },
    semPrecoNaLoja: { total: semPreco.length, itens: semPreco.slice(0, TOP).map((l) => ({ sku: l.sku, nome: l.nome, estoque: l.estoque })) },
    promocoes: {
      total: promos.length,
      descontoMedio: promos.length ? r2(promos.reduce((s, p) => s + p.desconto, 0) / promos.length) : null,
      itens: promos.slice(0, TOP),
    },
    abaixoDoCusto: { total: abaixo.length, itens: abaixo.slice(0, TOP) },
    margemBaixa: { total: baixa.length, itens: baixa.slice(0, TOP) },
    comCusto: aVenda.length ? margens.length / aVenda.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Estado do sync do catálogo da loja (users/{uid}/ops_sync/wake-catalogo)
// ---------------------------------------------------------------------------

/** Wake: 120/min por grupo de endpoints, compartilhado com o integrador do ERP; 5 acima do limite = token bloqueado 1 h. */
export const CHAMADAS_LOJA_POR_CICLO = 15;
export const POR_PAGINA_WAKE = 50;
export const VARREDURA_A_CADA_MS = 24 * 3600_000;
/** `alteradosPartirDe` aceita no máximo 48 h; com folga, 47 h. */
export const ALTERADOS_MAX_MS = 47 * 3600_000;

export interface EstadoLoja {
  tipo: 'catalogo';
  fonte: 'wake';
  criadoEm: string;
  ultimaVisita: number;
  proximaEm: number | null;
  leaseId?: string | null;
  leaseUntil?: number | null;
  varredura: {
    /** Rodada em curso (null = nenhuma); o que não for visto nela é apagado no fim. */
    rodada: string | null;
    cursor: string | null;
    lidos: number;
    ultimaConcluidaEm: number | null;
  };
  incremental: { desde: number | null; inicioRodada: number | null; cursor: string | null };
  erro?: string | null;
  falhas?: number;
  ultimoCicloEm?: number | null;
}

export function estadoInicialLoja(agora: number): EstadoLoja {
  return {
    tipo: 'catalogo',
    fonte: 'wake',
    criadoEm: new Date(agora).toISOString(),
    ultimaVisita: agora,
    proximaEm: agora,
    leaseId: null,
    leaseUntil: null,
    varredura: { rodada: null, cursor: null, lidos: 0, ultimaConcluidaEm: null },
    incremental: { desde: null, inicioRodada: null, cursor: null },
    erro: null,
    falhas: 0,
    ultimoCicloEm: null,
  };
}

/** Varredura completa: em curso, nunca feita, com mais de 24 h, ou o incremental passaria das 48 h que a Wake aceita. */
export function precisaVarredura(s: EstadoLoja, agora: number): boolean {
  if (s.varredura.rodada) return true;
  if (!s.varredura.ultimaConcluidaEm || agora - s.varredura.ultimaConcluidaEm > VARREDURA_A_CADA_MS) return true;
  return !s.incremental.desde || agora - s.incremental.desde > ALTERADOS_MAX_MS;
}

/** "aaaa-mm-dd hh:mm:ss" no horário de Brasília — o formato de `alteradosPartirDe`. */
export function dataHoraWake(ms: number): string {
  const d = new Date(ms - 3 * 3600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`;
}

export type EstadoPainelLoja = 'importando' | 'em-dia' | 'erro' | 'credencial' | 'pausado';

export function estadoDoLoja(s: EstadoLoja | null): { estado: EstadoPainelLoja; lidos: number; atualizadoEm: number | null } {
  if (!s) return { estado: 'importando', lidos: 0, atualizadoEm: null };
  const base = { lidos: s.varredura.lidos, atualizadoEm: s.ultimoCicloEm ?? null };
  if (s.erro === 'credencial') return { estado: 'credencial', ...base };
  if (s.erro) return { estado: 'erro', ...base };
  if (s.proximaEm == null) return { estado: 'pausado', ...base };
  return { estado: s.varredura.ultimaConcluidaEm ? 'em-dia' : 'importando', ...base };
}
