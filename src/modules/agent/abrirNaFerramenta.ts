// "Abrir na ferramenta": de um card do Alfred para a tela exata do item — o
// produto aberto no modal na aba certa, a lista de Produtos com os itens
// selecionados, o anúncio do Mercado Livre aberto. Puro: só decide o destino a
// partir da ação; quem navega é o App (AbrirNaFerramentaContext). Verificar com
// `npx tsx scripts/verify-plano.mjs`.

import type { AgentAction } from '../../types/agent';
import type { ProductModalTab } from '../../types/models';

export type DestinoItem =
  | { tipo: 'produto'; sku: string; aba: ProductModalTab }
  | { tipo: 'produtos'; skus: string[] }
  | { tipo: 'meli'; itemId: string };

/** Aba do modal do produto que mostra o que a ferramenta mexeu. */
const ABA: Record<string, ProductModalTab> = {
  'produtos.video.gerar': 'video',
  'produtos.ambientadas.gerar': 'imagem',
  'produtos.atributos.gerar': 'atributos',
};

const skusDe = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((s) => String(s).trim()).filter(Boolean))] : [];

export function destinoDaAcao(a: Pick<AgentAction, 'tool' | 'args'>): DestinoItem | null {
  const args = (a.args ?? {}) as Record<string, unknown>;
  if (a.tool.startsWith('meli.proposta.') && typeof args.itemId === 'string' && args.itemId.trim()) {
    return { tipo: 'meli', itemId: args.itemId.trim().toUpperCase() };
  }
  const sku = typeof args.sku === 'string' ? args.sku.trim() : '';
  const skus = sku ? [sku] : skusDe(args.skus);
  if (!skus.length) return null;
  // Só ferramentas que mexem em produto do catálogo (as de ERP também: o
  // usuário quer ver o produto que foi enviado).
  if (!/^(produtos|tiny|wake|bling|idworks)\./.test(a.tool)) return null;
  if (skus.length === 1) return { tipo: 'produto', sku: skus[0], aba: ABA[a.tool] ?? 'geral' };
  return { tipo: 'produtos', skus };
}

export function rotuloDestino(d: DestinoItem): string {
  if (d.tipo === 'meli') return 'Abrir o anúncio';
  if (d.tipo === 'produtos') return `Abrir os ${d.skus.length} produtos`;
  return 'Abrir o produto';
}
