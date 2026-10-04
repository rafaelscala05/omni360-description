// Classificador de papel dos conectores do Centro de Operações (puro, usado
// pelos dois lados). O papel é fixo por plataforma e decidido aqui — o usuário
// não configura. O que importa é `fonteDe`: de onde cada domínio é lido, para
// que um pedido nunca seja contado duas vezes (o pedido da Wake também chega
// ao Tiny). Verificar com `npx tsx scripts/verify-ops.mjs`.

export type PlataformaOps = 'tiny' | 'bling' | 'idworks' | 'wake' | 'meli';
export type PapelConector = 'erp' | 'loja' | 'marketplace';
export type DominioOps = 'pedidos' | 'estoque' | 'catalogo_loja';

export const PAPEL: Record<PlataformaOps, PapelConector> = {
  tiny: 'erp',
  bling: 'erp',
  idworks: 'erp',
  wake: 'loja',
  meli: 'marketplace',
};

export const NOME_PLATAFORMA: Record<PlataformaOps, string> = {
  tiny: 'Tiny',
  bling: 'Bling',
  idworks: 'IdWorks',
  wake: 'Wake',
  meli: 'Mercado Livre',
};

/** Ordem de preferência entre ERPs quando há mais de um conectado. */
const ORDEM_ERP: PlataformaOps[] = ['tiny', 'bling', 'idworks'];

export const papelDe = (p: PlataformaOps): PapelConector => PAPEL[p];

export type Conectados = Partial<Record<PlataformaOps, boolean>>;

/**
 * De qual plataforma o domínio é lido. Pedidos e estoque: o primeiro ERP
 * conectado; sem ERP, a loja (Wake). Catálogo da loja: sempre a Wake.
 * `null` = nenhuma fonte — o painel pede para conectar, nunca mostra zero.
 */
export function fonteDe(dominio: DominioOps, conectados: Conectados): PlataformaOps | null {
  if (dominio === 'catalogo_loja') return conectados.wake ? 'wake' : null;
  const erp = ORDEM_ERP.find((p) => conectados[p]);
  if (erp) return erp;
  return conectados.wake ? 'wake' : null;
}

/** Fontes de pedidos que o sync já sabe ler. As outras entram como adaptador novo. */
export const ADAPTADORES_PEDIDOS: readonly PlataformaOps[] = ['tiny'];
export const temAdaptadorPedidos = (p: PlataformaOps | null): boolean =>
  !!p && ADAPTADORES_PEDIDOS.includes(p);

export interface FontesOps {
  pedidos: PlataformaOps | null;
  estoque: PlataformaOps | null;
  catalogoLoja: PlataformaOps | null;
}

export const fontesOps = (c: Conectados): FontesOps => ({
  pedidos: fonteDe('pedidos', c),
  estoque: fonteDe('estoque', c),
  catalogoLoja: fonteDe('catalogo_loja', c),
});
