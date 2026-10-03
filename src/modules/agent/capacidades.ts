// As peças do Alfred: o que cada conta tem montado e o que ainda pode montar.
// PURO e usado pelos dois lados (o servidor importa `temAlfred`). Verificar
// com `npx tsx scripts/verify-capacidades.mjs`.
//
// Toda peça passa pelas mesmas camadas — objetivo → módulo → conexão →
// permissão — e o estado é sempre derivado, nunca gravado. Nenhuma tela deve
// voltar a decidir sozinha a partir de um `hasX` solto.

export type Objetivo = 'produto' | 'meli' | 'conteudo';
export const OBJETIVOS: readonly Objetivo[] = ['produto', 'meli', 'conteudo'] as const;

export type PecaId = 'produtos' | 'meli' | 'conteudo' | 'erp' | 'video';
export type EstadoPeca = 'oculta' | 'disponivel' | 'ativa' | 'conectada' | 'com-resultado';

export interface ModulosConta {
  produtos?: boolean;
  contentAgent?: boolean;
  operationsAgent?: boolean;
  blog?: boolean;
  meliListingOptimizer?: boolean;
  video?: boolean;
}

export interface ContaAlfred {
  objetivos: Objetivo[];
  modules: ModulosConta;
  conexoes: { erp: boolean; meli: boolean; site: boolean };
  /** O que a conta já produziu. Ausente = não sabemos = não conta. */
  marcos: {
    produtos: number;
    produtosComDescricao: number;
    propostaPublicada?: boolean;
    artigoNoBlog?: boolean;
    envioErp?: boolean;
    videoGerado?: boolean;
  };
}

export interface Peca {
  id: PecaId;
  estado: EstadoPeca;
  titulo: string;
  /** O que a peça dá ao Alfred — "Libera: …" quando disponível. */
  libera: string;
  /** Objetivo que monta a peça pela adesão. null = é conexão, não módulo. */
  objetivo: Objetivo | null;
}

/** O shell do Alfred e o provider `produtos`: qualquer módulo de agente ligado. */
export function temAlfred(m: ModulosConta): boolean {
  return m.produtos === true || m.contentAgent === true || m.operationsAgent === true;
}

export function modulosDoObjetivo(o: Objetivo): (keyof ModulosConta)[] {
  if (o === 'produto') return ['produtos'];
  if (o === 'meli') return ['meliListingOptimizer'];
  return ['contentAgent', 'blog'];
}

/**
 * Revogado pelo admin: algum módulo do objetivo gravado como `false` (o código
 * nunca grava `false`; ausente = nunca teve). Revogado não é oferecido nem
 * religado pela adesão.
 */
export function objetivoRevogado(m: ModulosConta | Record<string, unknown>, o: Objetivo): boolean {
  return modulosDoObjetivo(o).some((k) => (m as Record<string, unknown>)[k] === false);
}

const escada = (ativa: boolean, conectada: boolean, resultado: boolean, semModulo: EstadoPeca): EstadoPeca =>
  !ativa ? semModulo : resultado ? 'com-resultado' : conectada ? 'conectada' : 'ativa';

export function montarAlfred(c: ContaAlfred): Peca[] {
  const m = c.modules;
  return [
    {
      id: 'produtos', titulo: 'Produtos', libera: 'descrições, atributos e imagens', objetivo: 'produto',
      estado: escada(temAlfred(m), c.marcos.produtos > 0, c.marcos.produtosComDescricao > 0, objetivoRevogado(m, 'produto') ? 'oculta' : 'disponivel'),
    },
    {
      id: 'meli', titulo: 'Mercado Livre', libera: 'títulos, fichas e fotos dos anúncios', objetivo: 'meli',
      estado: escada(m.meliListingOptimizer === true, c.conexoes.meli, c.marcos.propostaPublicada === true, objetivoRevogado(m, 'meli') ? 'oculta' : 'disponivel'),
    },
    {
      id: 'conteudo', titulo: 'Conteúdo e blog', libera: 'artigos, calendário e SEO', objetivo: 'conteudo',
      estado: escada(m.contentAgent === true, c.conexoes.site, c.marcos.artigoNoBlog === true, objetivoRevogado(m, 'conteudo') ? 'oculta' : 'disponivel'),
    },
    {
      // Não tem módulo: "ativa" é já ter o que mandar para o ERP.
      id: 'erp', titulo: 'Loja / ERP', libera: 'envio do catálogo para a sua loja', objetivo: null,
      estado: c.conexoes.erp
        ? (c.marcos.envioErp ? 'com-resultado' : 'conectada')
        : c.marcos.produtos > 0 ? 'disponivel' : 'oculta',
    },
    {
      id: 'video', titulo: 'Vídeo', libera: 'vídeos dos seus produtos', objetivo: null,
      // Vídeo não tem passo de conexão: ativa → com-resultado.
      estado: escada(m.video === true, false, c.marcos.videoGerado === true, 'oculta'),
    },
  ];
}

/** A peça que a semana oferece: disponível, aderível, objetivos marcados antes. */
export function proximaPecaParaMontar(pecas: Peca[], objetivos: Objetivo[]): Peca | null {
  const candidatas = pecas.filter((p) => p.estado === 'disponivel' && p.objetivo !== null);
  const marcada = objetivos.map((o) => candidatas.find((p) => p.objetivo === o)).find(Boolean);
  return marcada ?? candidatas[0] ?? null;
}
