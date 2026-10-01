// Tela "Fontes e conectores" (A4): o que o Alfred enxerga para montar a semana
// e o que cada conector novo liberaria.
//
// Puro e sem I/O — verificar com `npx tsx scripts/verify-conectores.mjs`. A
// tela e o rodapé da semana leem o mesmo `montarFontes`, para "4 fontes · +2
// para conectar" nunca discordar da lista que abre ao tocar nele.
//
// Três grupos, nessa ordem de prioridade:
// - atenção: a checagem falhou (não sabemos o estado — é diferente de
//   desconectado), a credencial não foi validada ou a autorização expirou;
// - conectados: com quantas ferramentas cada um libera ao Alfred;
// - disponíveis: o que conectar liberaria, em uma linha.

export type ChaveFonte = 'produtos' | 'tiny' | 'bling' | 'idworks' | 'wake' | 'meli' | 'content';

/** Como a fonte chega do app: o resumo dos endpoints de status ou um módulo ligado. */
export interface EntradaFonte {
  chave: ChaveFonte;
  conectado: boolean;
  /** `false` = conectado com credencial não validada. Ausente = não se aplica. */
  validado?: boolean;
  /** Autorização vencida do lado da plataforma (OAuth do Mercado Livre). */
  reautorizar?: boolean;
  /** A checagem em si falhou (rede, 500, sessão). */
  erro?: string;
  /** Conta/CNPJ/projetos — identifica qual conta está do outro lado. */
  detalhe?: string | null;
}

export type GrupoFonte = 'atencao' | 'conectado' | 'disponivel';

export interface Fonte {
  chave: ChaveFonte;
  nome: string;
  sigla: string;
  grupo: GrupoFonte;
  /** Linha de baixo: o que a fonte entrega (conectada) ou libera (disponível). */
  linha: string;
  /** Só no grupo atenção: o que pedir ao usuário. */
  acao?: 'verificar' | 'revalidar' | 'reconectar';
  ferramentas: number;
  pendentes: number;
}

export interface Fontes {
  atencao: Fonte[];
  conectados: Fonte[];
  disponiveis: Fonte[];
}

interface Catalogo {
  nome: string;
  sigla: string;
  /** O que a fonte dá ao Alfred, conectada. */
  entrega: string;
  /** O que conectar liberaria — começa sem "Libera:", a tela põe o prefixo. */
  libera: string;
}

export const CATALOGO: Record<ChaveFonte, Catalogo> = {
  produtos: { nome: 'Catálogo OMNI360', sigla: 'Pr', entrega: 'Produtos, categorias, imagens', libera: 'descrições, atributos e imagens' },
  tiny: { nome: 'Tiny ERP', sigla: 'Ti', entrega: 'Produtos, pedidos, estoque', libera: 'produtos, preço, estoque e pedidos' },
  bling: { nome: 'Bling', sigla: 'Bl', entrega: 'Importação e envio do catálogo', libera: 'importação e envio do catálogo' },
  idworks: { nome: 'IdWorks', sigla: 'Id', entrega: 'SKUs e sincronização', libera: 'envio de SKUs e sincronização' },
  wake: { nome: 'Wake Commerce', sigla: 'Wk', entrega: 'Banners, preço, estoque, SEO', libera: 'banners, preço, SEO da loja' },
  meli: { nome: 'Mercado Livre', sigla: 'ML', entrega: 'Anúncios e propostas do otimizador', libera: 'anúncios e propostas do otimizador' },
  content: { nome: 'Conteúdo e blog', sigla: 'Co', entrega: 'Clusters, calendário, artigos', libera: 'artigos, calendário e SEO' },
};

/** Ordem de exibição dentro de cada grupo: ERPs e loja antes, o resto depois. */
const ORDEM: ChaveFonte[] = ['tiny', 'bling', 'idworks', 'wake', 'meli', 'content', 'produtos'];

const MOTIVO: Record<NonNullable<Fonte['acao']>, string> = {
  verificar: 'Não conseguimos checar a conexão',
  revalidar: 'Credencial ainda não validada',
  reconectar: 'Autorização expirada — reconecte a conta',
};

export function montarFontes(
  entradas: EntradaFonte[],
  ferramentas: Partial<Record<string, number>> = {},
  pendentes: Partial<Record<string, number>> = {},
): Fontes {
  const vistas = new Set<ChaveFonte>();
  const fontes: Fonte[] = [];

  for (const e of entradas) {
    // A mesma chave duas vezes (ex.: a tela juntou duas fontes de status)
    // não vira duas linhas: a primeira vale.
    if (vistas.has(e.chave) || !CATALOGO[e.chave]) continue;
    vistas.add(e.chave);
    const c = CATALOGO[e.chave];

    const acao: Fonte['acao'] = e.erro
      ? 'verificar'
      // O servidor do ML já responde `connected: false` com a autorização
      // vencida — por isso `reautorizar` não depende de `conectado`.
      : e.reautorizar ? 'reconectar'
        : e.conectado && e.validado === false ? 'revalidar'
          : undefined;

    const grupo: GrupoFonte = acao ? 'atencao' : e.conectado ? 'conectado' : 'disponivel';
    const n = ferramentas[e.chave] ?? 0;

    let linha: string;
    if (grupo === 'atencao') linha = MOTIVO[acao!];
    else if (grupo === 'disponivel') linha = `Libera: ${c.libera}`;
    else {
      const partes = [c.entrega];
      if (e.detalhe) partes.push(e.detalhe);
      if (n) partes.push(`${n} ${n === 1 ? 'ferramenta' : 'ferramentas'}`);
      linha = partes.join(' · ');
    }

    fontes.push({
      chave: e.chave,
      nome: c.nome,
      sigla: c.sigla,
      grupo,
      linha,
      acao,
      ferramentas: grupo === 'disponivel' ? 0 : n,
      pendentes: pendentes[e.chave] ?? 0,
    });
  }

  fontes.sort((a, b) => ORDEM.indexOf(a.chave) - ORDEM.indexOf(b.chave));
  return {
    atencao: fontes.filter((f) => f.grupo === 'atencao'),
    conectados: fontes.filter((f) => f.grupo === 'conectado'),
    disponiveis: fontes.filter((f) => f.grupo === 'disponivel'),
  };
}

/**
 * Rodapé da semana: "4 fontes · +2 para conectar". Uma fonte em atenção ainda
 * conta como fonte (ela continua ligada, só precisa de um toque), e é o
 * `alerta` que faz o rodapé mudar de cor.
 */
export function resumoFontes(f: Fontes): { ativas: number; paraConectar: number; alerta: number } {
  return {
    ativas: f.conectados.length + f.atencao.length,
    paraConectar: f.disponiveis.length,
    alerta: f.atencao.length,
  };
}

/** Resumo de `fetchIntegrationsOverview`, sem depender do serviço (este módulo é puro). */
interface ResumoIntegracao {
  chave: 'wake' | 'tiny' | 'bling' | 'idworks';
  conectado: boolean;
  validado: boolean;
  detalhe: string | null;
  erro?: string;
}

/** O que a tela sabe do Mercado Livre: a conexão, ou a falha ao buscá-la. */
export type EstadoMeli =
  | { conectado: boolean; status: string; erro?: undefined }
  | { erro: string };

/**
 * Junta as fontes que o app conhece. O catálogo vem sempre (toda conta com
 * agente tem o provider `produtos`); Mercado Livre e Conteúdo só quando o
 * módulo está ligado — sem módulo não há o que conectar ali.
 */
export function entradasDoApp(opts: {
  integracoes: ResumoIntegracao[];
  meli?: EstadoMeli | null;
  hasMeli: boolean;
  hasContentAgent: boolean;
  projetos?: number | null;
}): EntradaFonte[] {
  const lista: EntradaFonte[] = [{ chave: 'produtos', conectado: true }];
  for (const i of opts.integracoes) {
    lista.push({ chave: i.chave, conectado: i.conectado, validado: i.validado, detalhe: i.detalhe, erro: i.erro });
  }
  if (opts.hasMeli && opts.meli) {
    lista.push('erro' in opts.meli && opts.meli.erro
      ? { chave: 'meli', conectado: false, erro: opts.meli.erro }
      : {
        chave: 'meli',
        conectado: (opts.meli as { conectado: boolean }).conectado,
        reautorizar: (opts.meli as { status: string }).status === 'reauthorization_required',
      });
  }
  if (opts.hasContentAgent) {
    const n = opts.projetos;
    lista.push({
      chave: 'content',
      conectado: true,
      detalhe: n == null ? null : `${n} ${n === 1 ? 'projeto' : 'projetos'}`,
    });
  }
  return lista;
}
