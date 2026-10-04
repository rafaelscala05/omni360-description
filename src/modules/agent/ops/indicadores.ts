// Indicadores do Centro de Operações (puro, usado pelos dois lados): vendas,
// funil do pedido e estoque. Vendas e funil rodam no servidor sobre
// `ops_pedidos` (GET /api/ops/painel e a ferramenta ops.painel.resumo); o
// estoque roda no cliente sobre o catálogo já em memória. Verificar com
// `npx tsx scripts/verify-ops.mjs`.

import { diaBrt, diasEntre, somaDias, type EstadoPainelSync, type PedidoOps, type SituacaoOps } from './pedidos';
import type { FontesOps } from './papeis';

export type PedidoCalc = Pick<PedidoOps, 'idExterno' | 'numero' | 'data' | 'situacao' | 'valor' | 'canal' | 'itens' | 'detalhado'>;

export interface Totais { receita: number; pedidos: number; ticket: number }
export interface Periodo extends Totais { anterior: Totais }
export type ChavePeriodo = 'hoje' | 'd7' | 'd30';

export interface PedidoParado { idExterno: string; numero: string; situacao: SituacaoOps; dias: number; valor: number }

export interface PainelPedidos {
  periodos: Record<ChavePeriodo, Periodo>;
  /** Últimos 30 dias, do mais antigo para hoje. */
  serie: { dia: string; receita: number; pedidos: number }[];
  canais: { nome: string; receita: number; pedidos: number }[];
  /** Fração dos pedidos de 30 dias com itens e canal (0–1). */
  detalhados: number;
  funil: Record<SituacaoOps, number>;
  parados: PedidoParado[];
  totalParados: number;
  /** Quantidade vendida por SKU nos últimos 30 dias (pedidos detalhados, sem cancelados). */
  vendidos30d: Record<string, number>;
}

/** Resposta de GET /api/ops/painel. */
export interface RespostaPainelOps {
  fontes: FontesOps;
  /** A fonte de pedidos tem adaptador de sync (só o Tiny na v1). */
  pedidosSuportados: boolean;
  sync: { estado: EstadoPainelSync; progresso: number; atualizadoEm: number | null; erro: string | null } | null;
  pedidos: PainelPedidos | null;
  geradoEm: string;
}

const DIAS: Record<ChavePeriodo, number> = { hoje: 1, d7: 7, d30: 30 };

/** Dias parado a partir dos quais o pedido entra na lista, por situação. */
export const LIMITE_PARADO: Partial<Record<SituacaoOps, number>> = { aberto: 2, aprovado: 2, faturado: 3 };

const totais = (lista: PedidoCalc[]): Totais => {
  const validos = lista.filter((p) => p.situacao !== 'cancelado');
  const receita = validos.reduce((s, p) => s + (p.valor || 0), 0);
  return { receita, pedidos: validos.length, ticket: validos.length ? receita / validos.length : 0 };
};

const entre = (lista: PedidoCalc[], inicio: string, fim: string) => lista.filter((p) => p.data >= inicio && p.data <= fim);

export function painelPedidos(pedidos: PedidoCalc[], agora: number): PainelPedidos {
  const hoje = diaBrt(agora);

  const periodos = {} as Record<ChavePeriodo, Periodo>;
  for (const k of Object.keys(DIAS) as ChavePeriodo[]) {
    const n = DIAS[k];
    const inicio = somaDias(hoje, -(n - 1));
    const antFim = somaDias(inicio, -1);
    const antInicio = somaDias(antFim, -(n - 1));
    periodos[k] = { ...totais(entre(pedidos, inicio, hoje)), anterior: totais(entre(pedidos, antInicio, antFim)) };
  }

  const inicio30 = somaDias(hoje, -29);
  const ult30 = entre(pedidos, inicio30, hoje);

  const porDia = new Map<string, { receita: number; pedidos: number }>();
  for (let i = 0; i < 30; i++) porDia.set(somaDias(inicio30, i), { receita: 0, pedidos: 0 });
  for (const p of ult30) {
    if (p.situacao === 'cancelado') continue;
    const d = porDia.get(p.data);
    if (d) { d.receita += p.valor || 0; d.pedidos += 1; }
  }
  const serie = [...porDia.entries()].map(([dia, v]) => ({ dia, ...v }));

  const detalhadosLista = ult30.filter((p) => p.detalhado);
  const porCanal = new Map<string, { receita: number; pedidos: number }>();
  const vendidos30d: Record<string, number> = {};
  for (const p of detalhadosLista) {
    if (p.situacao === 'cancelado') continue;
    const nome = p.canal || 'Sem canal';
    const c = porCanal.get(nome) ?? { receita: 0, pedidos: 0 };
    c.receita += p.valor || 0;
    c.pedidos += 1;
    porCanal.set(nome, c);
    for (const it of p.itens ?? []) vendidos30d[it.sku] = (vendidos30d[it.sku] ?? 0) + it.qtd;
  }
  const canais = [...porCanal.entries()]
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.receita - a.receita);

  const funil: Record<SituacaoOps, number> = { aberto: 0, aprovado: 0, faturado: 0, enviado: 0, entregue: 0, cancelado: 0, outro: 0 };
  for (const p of ult30) funil[p.situacao] += 1;

  // Parados olha o histórico inteiro carregado, não só 30 dias: um pedido
  // aberto há 40 dias é justamente o que mais importa.
  const parados: PedidoParado[] = [];
  for (const p of pedidos) {
    const limite = LIMITE_PARADO[p.situacao];
    if (limite == null) continue;
    const dias = diasEntre(p.data, hoje);
    if (dias > limite) parados.push({ idExterno: p.idExterno, numero: p.numero, situacao: p.situacao, dias, valor: p.valor });
  }
  parados.sort((a, b) => b.dias - a.dias || b.valor - a.valor);

  return {
    periodos,
    serie,
    canais,
    detalhados: ult30.length ? detalhadosLista.length / ult30.length : 1,
    funil,
    parados: parados.slice(0, 10),
    totalParados: parados.length,
    vendidos30d,
  };
}

/** Variação relativa (−1…∞); null quando não há base de comparação. */
export const variacao = (atual: number, anterior: number): number | null =>
  anterior > 0 ? (atual - anterior) / anterior : null;

// ---------------------------------------------------------------------------
// Estoque (cliente, sobre o catálogo)
// ---------------------------------------------------------------------------

export interface ProdutoEstoque {
  _id?: string;
  'Código (SKU)'?: string;
  'Descrição'?: string;
  'Código do pai'?: string;
  'Estoque'?: string | number;
  'Estoque mínimo'?: string | number;
}

export interface ItemEstoque { id?: string; sku: string; nome: string; estoque: number; minimo: number | null; vendidos30: number; diasCobertura: number | null }

export interface PainelEstoque {
  /** Itens vendáveis (simples e variações) com estoque informado. */
  avaliados: number;
  semEstoqueInformado: number;
  esgotados: number;
  /** Esgotados que tiveram venda nos últimos 30 dias — o que mais custa. */
  esgotadosQueVendiam: ItemEstoque[];
  abaixoMinimo: ItemEstoque[];
  /** Com saldo, mas que acaba antes de COBERTURA_CURTA_DIAS no ritmo atual. */
  coberturaCurta: ItemEstoque[];
}

export const COBERTURA_CURTA_DIAS = 14;

const numOuNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
};

export function painelEstoque(produtos: ProdutoEstoque[], vendidos30d: Record<string, number>): PainelEstoque {
  // Pai de variação não tem estoque próprio: o saldo mora em cada variação.
  const pais = new Set(produtos.map((p) => String(p['Código do pai'] ?? '').trim()).filter(Boolean));
  const folhas = produtos.filter((p) => {
    const sku = String(p['Código (SKU)'] ?? '').trim();
    return sku && !pais.has(sku);
  });

  let semEstoqueInformado = 0;
  let esgotados = 0;
  const esgotadosQueVendiam: ItemEstoque[] = [];
  const abaixoMinimo: ItemEstoque[] = [];
  const coberturaCurta: ItemEstoque[] = [];

  for (const p of folhas) {
    const estoque = numOuNull(p['Estoque']);
    if (estoque === null) { semEstoqueInformado++; continue; }
    const sku = String(p['Código (SKU)']).trim();
    const vendidos30 = vendidos30d[sku] ?? 0;
    const minimo = numOuNull(p['Estoque mínimo']);
    const ritmo = vendidos30 / 30;
    const item: ItemEstoque = {
      id: p._id,
      sku,
      nome: String(p['Descrição'] ?? sku),
      estoque,
      minimo: minimo && minimo > 0 ? minimo : null,
      vendidos30,
      diasCobertura: ritmo > 0 && estoque > 0 ? Math.floor(estoque / ritmo) : null,
    };
    if (estoque <= 0) {
      esgotados++;
      if (vendidos30 > 0) esgotadosQueVendiam.push(item);
      continue;
    }
    if (item.minimo !== null && estoque < item.minimo) abaixoMinimo.push(item);
    if (item.diasCobertura !== null && item.diasCobertura < COBERTURA_CURTA_DIAS) coberturaCurta.push(item);
  }

  esgotadosQueVendiam.sort((a, b) => b.vendidos30 - a.vendidos30);
  abaixoMinimo.sort((a, b) => a.estoque / (a.minimo ?? 1) - b.estoque / (b.minimo ?? 1));
  coberturaCurta.sort((a, b) => (a.diasCobertura ?? 0) - (b.diasCobertura ?? 0));

  return {
    avaliados: folhas.length - semEstoqueInformado,
    semEstoqueInformado,
    esgotados,
    esgotadosQueVendiam,
    abaixoMinimo,
    coberturaCurta,
  };
}
