// O "Plano" de um turno do Alfred: os passos numerados que o card mostra no
// chat, cada um marcado como leitura, você ou gravação.
//
// Não é um plano que o modelo escreve e pode não cumprir — é montado do que o
// turno de fato fez e do que falta: as leituras que rodaram (`leituras` do
// SSE ou da mensagem salva), o passo em andamento e, quando há uma escrita
// proposta, "Você revisa" seguido de "Gravar". Assim o card nunca promete um
// passo que não existe. Puro; verificar com `npx tsx scripts/verify-plano.mjs`.

import type { AgentAction } from '../../types/agent';

export type TipoPasso = 'leitura' | 'trabalho' | 'voce' | 'gravacao';
export type EstadoPasso = 'feito' | 'agora' | 'depois' | 'erro' | 'cancelado';

export interface PassoPlano {
  titulo: string;
  detalhe?: string;
  tipo: TipoPasso;
  estado: EstadoPasso;
}

export interface Plano {
  passos: PassoPlano[];
  /** Créditos que a gravação vai debitar, quando se sabe. */
  custo?: number;
}

/** O que cada ferramenta de leitura faz, na voz do lojista. */
const ROTULOS: Record<string, string> = {
  'produtos.incompletos.listar': 'Ler o catálogo',
  'produtos.buscar': 'Buscar no catálogo',
  'meli.propostas.listar': 'Ver as propostas do Mercado Livre',
  'meli.proposta.ver': 'Ler a proposta do anúncio',
  'docs.buscar': 'Consultar a documentação',
  'content.projetos.listar': 'Ver os projetos de conteúdo',
};

const MARCAS: Record<string, string> = {
  wake: 'Wake', tiny: 'Tiny', content: 'Conteúdo', docs: 'Documentação', produtos: 'Catálogo', meli: 'Mercado Livre',
};

/** Nome técnico em algo legível: `tiny.produto.obter` → "Tiny · produto obter". */
export function rotuloFerramenta(tool: string): string {
  if (ROTULOS[tool]) return ROTULOS[tool];
  const [provider, ...resto] = tool.split('.');
  const nome = resto.join(' ').replace(/[._]/g, ' ');
  const marca = MARCAS[provider] ?? provider;
  return nome ? `${marca} · ${nome}` : marca;
}

/** Onde a gravação cai, para o último passo dizer "Gravar no Tiny" e não só "Gravar". */
export function destinoGravacao(provider: string): string {
  switch (provider) {
    case 'produtos': return 'no catálogo';
    case 'meli': return 'no Mercado Livre';
    case 'wake': return 'na Wake';
    case 'tiny': return 'no Tiny';
    case 'content': return 'no Conteúdo';
    default: return '';
  }
}

type Leitura = { tool: string; ok: boolean; erro?: string };

export function montarPlano(input: {
  leituras: Leitura[];
  acao?: Pick<AgentAction, 'status' | 'provider' | 'preview'> | null;
  /** O turno ainda está rodando (SSE aberto). */
  aoVivo?: boolean;
}): Plano {
  const { leituras, acao, aoVivo } = input;
  // A mesma ferramenta chamada duas vezes seguidas vira um passo só.
  const passos: PassoPlano[] = [];
  for (const l of leituras) {
    const titulo = rotuloFerramenta(l.tool);
    const ultimo = passos[passos.length - 1];
    if (ultimo && ultimo.titulo === titulo && ultimo.tipo === 'leitura') {
      if (!l.ok) { ultimo.estado = 'erro'; ultimo.detalhe = l.erro; }
      continue;
    }
    passos.push({ titulo, tipo: 'leitura', estado: l.ok ? 'feito' : 'erro', ...(l.erro ? { detalhe: l.erro } : {}) });
  }

  if (!acao) {
    if (aoVivo) passos.push({ titulo: passos.length ? 'Montando a resposta' : 'Entendendo o pedido', tipo: 'leitura', estado: 'agora' });
    return { passos };
  }

  const { status, provider, preview } = acao;
  // Lote em job: o Alfred escreve em segundo plano e a revisão começa antes do
  // fim — o progresso ao vivo fica no card do lote, o plano só nomeia o passo.
  if (preview.lote) {
    const m = preview.lote.total;
    passos.push({
      titulo: `Escrever ${m === 1 ? '1 item' : `${m} itens`} em segundo plano`,
      detalhe: 'Um por vez — o progresso aparece no card',
      tipo: 'trabalho',
      estado: status === 'pending' ? 'agora' : 'feito',
    });
    passos.push({
      titulo: 'Você revisa as prontas',
      detalhe: 'Pode aprovar antes de terminar todas',
      tipo: 'voce',
      estado: status === 'pending' ? 'agora' : status === 'rejected' ? 'cancelado' : 'feito',
    });
    passos.push({
      titulo: `Gravar ${destinoGravacao(provider)}`.trim(),
      detalhe: preview.alvo,
      tipo: 'gravacao',
      estado: status === 'executed' ? 'feito' : status === 'failed' ? 'erro' : status === 'rejected' ? 'cancelado' : 'depois',
    });
    return { passos, ...(typeof preview.custo === 'number' ? { custo: preview.custo } : {}) };
  }
  const n = preview.itens?.length;
  passos.push({
    titulo: 'Você revisa',
    detalhe: n ? `Amostra navegável dos ${n} itens antes de gravar` : preview.resumo,
    tipo: 'voce',
    estado: status === 'pending' ? 'agora' : status === 'rejected' ? 'cancelado' : 'feito',
  });
  passos.push({
    titulo: `Gravar ${destinoGravacao(provider)}`.trim(),
    detalhe: preview.alvo,
    tipo: 'gravacao',
    estado: status === 'executed' ? 'feito' : status === 'failed' ? 'erro' : status === 'rejected' ? 'cancelado' : 'depois',
  });
  return { passos, ...(typeof preview.custo === 'number' ? { custo: preview.custo } : {}) };
}

/** Só vale mostrar o card quando há algo a planejar: uma escrita, ou várias leituras. */
export function temPlano(input: { leituras: Leitura[]; acao?: unknown; aoVivo?: boolean }): boolean {
  return !!input.acao || input.leituras.length >= 2 || (!!input.aoVivo && input.leituras.length >= 1);
}
