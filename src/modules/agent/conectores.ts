// A4 · Fontes e conectores — o que o Alfred enxerga para montar a semana e o
// que cada conexão libera. Puro: recebe o status das integrações
// (fetchIntegrationsOverview), quantas ferramentas cada provider tem
// (GET /api/agent/tools) e os módulos da conta. Verificar com
// `npx tsx scripts/verify-conectores.mjs`.
//
// Três seções, nesta ordem de importância:
// - Precisa de atenção: a checagem falhou (rede, sessão expirada) ou a
//   credencial existe mas não foi validada. "Não consegui checar" não é "não
//   conectado" — por isso vem antes e nunca cai em Disponíveis.
// - Conectados: inclui o que não é integração externa (Catálogo, Conteúdo,
//   Mercado Livre), porque para o usuário também é "uma fonte ligada".
// - Disponíveis: só as integrações que dá para ligar na tela de Integrações,
//   cada uma dizendo o que libera — o motivo para conectar.

import type { IntegrationSummary } from '../../services/integrationsStatusService';

export type SecaoConector = 'atencao' | 'conectado' | 'disponivel';

export interface Conector {
  id: string;
  nome: string;
  /** "Produtos, pedidos, estoque · 9 ferramentas" ou "Libera: banners, preço…". */
  linha: string;
  secao: SecaoConector;
  /** Motivo da atenção, na voz do usuário. */
  alerta?: string;
  ferramentas: number;
  /** Abre Integrações para conectar/reconectar; Conteúdo e Catálogo não têm o que conectar. */
  conectavel: boolean;
}

/** O que cada fonte deixa o Alfred fazer — a frase de "Libera:" e de Conectados. */
export const LIBERA: Record<string, string> = {
  tiny: 'produtos, preço, estoque, pedidos e envio do catálogo',
  wake: 'banners, hotsites, preço, estoque e SEO da loja',
  bling: 'envio de descrição e imagens do catálogo',
  idworks: 'envio de descrição, SEO e imagens dos SKUs',
  meli: 'anúncios e propostas do otimizador',
  content: 'clusters, calendário e artigos do blog',
  produtos: 'produtos, categorias, descrições e imagens',
};

const NOMES: Record<string, string> = {
  tiny: 'Tiny ERP',
  wake: 'Wake Commerce',
  bling: 'Bling',
  idworks: 'IdWorks',
  meli: 'Mercado Livre',
  content: 'Conteúdo e blog',
  produtos: 'Catálogo OMNI360',
};

/** Identidade visual de cada fonte — na régua do Alfred e na tela de conectores. */
export const MARCA: Record<string, { glifo: string; cor: string }> = {
  wake: { glifo: 'W', cor: 'linear-gradient(135deg,#ff5b03,#ff9a52)' },
  tiny: { glifo: 'T', cor: 'linear-gradient(135deg,#3053ff,#7e94ff)' },
  bling: { glifo: 'B', cor: 'linear-gradient(135deg,#0f9d58,#4ade80)' },
  idworks: { glifo: 'ID', cor: 'linear-gradient(135deg,#828ed1,#b8c0ea)' },
  content: { glifo: 'C', cor: 'linear-gradient(135deg,#7c3aed,#c4b5fd)' },
  meli: { glifo: 'ML', cor: 'linear-gradient(135deg,#d4b800,#ffe36e)' },
  produtos: { glifo: 'P', cor: 'linear-gradient(135deg,#b24400,#ff8a3d)' },
};

const capitaliza = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function linhaConectado(id: string, n: number): string {
  const base = capitaliza(LIBERA[id] ?? '');
  return n > 0 ? `${base} · ${n} ${n === 1 ? 'ferramenta' : 'ferramentas'}` : base;
}

export function montarConectores(input: {
  integracoes: IntegrationSummary[];
  ferramentas: Record<string, number>;
  hasContentAgent: boolean;
  hasMeli: boolean;
}): Conector[] {
  const { integracoes, ferramentas } = input;
  const out: Conector[] = [];

  for (const i of integracoes) {
    const n = ferramentas[i.chave] ?? 0;
    const nome = NOMES[i.chave] ?? i.nome;
    if (i.erro) {
      out.push({ id: i.chave, nome, secao: 'atencao', alerta: 'Não conseguimos checar a conexão', linha: linhaConectado(i.chave, n), ferramentas: n, conectavel: true });
    } else if (i.conectado && !i.validado) {
      out.push({ id: i.chave, nome, secao: 'atencao', alerta: 'A credencial não foi confirmada — reconecte', linha: linhaConectado(i.chave, n), ferramentas: n, conectavel: true });
    } else if (i.conectado) {
      out.push({ id: i.chave, nome, secao: 'conectado', linha: linhaConectado(i.chave, n), ferramentas: n, conectavel: true });
    } else {
      out.push({ id: i.chave, nome, secao: 'disponivel', linha: `Libera: ${LIBERA[i.chave] ?? 'mais ferramentas'}`, ferramentas: 0, conectavel: true });
    }
  }

  const interno = (id: string) => {
    const n = ferramentas[id] ?? 0;
    out.push({ id, nome: NOMES[id], secao: 'conectado', linha: linhaConectado(id, n), ferramentas: n, conectavel: false });
  };
  if (input.hasMeli) interno('meli');
  if (input.hasContentAgent) interno('content');
  interno('produtos');

  const ordem: Record<SecaoConector, number> = { atencao: 0, conectado: 1, disponivel: 2 };
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ordem[a.c.secao] - ordem[b.c.secao] || a.i - b.i)
    .map(({ c }) => c);
}

/** O rodapé da semana: "4 fontes · +2 para conectar". Atenção conta como fonte (está ligada, só não checou). */
export function resumoFontes(conectores: Conector[]): { fontes: number; paraConectar: number; atencao: number } {
  return {
    fontes: conectores.filter((c) => c.secao !== 'disponivel').length,
    paraConectar: conectores.filter((c) => c.secao === 'disponivel').length,
    atencao: conectores.filter((c) => c.secao === 'atencao').length,
  };
}
