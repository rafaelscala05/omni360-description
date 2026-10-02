// Confirmação de "Gerar descrição/imagem para todas" — quem entra, quem já tem,
// quem fica de fora e quanto custa.
//
// Puro e usado dos dois lados: a tela monta o card com isto (sem IA, número
// sempre certo) e a rota POST /api/agent/lotes refaz a mesma conta no servidor,
// porque o corpo vem do navegador. Verificar com
// `npx tsx scripts/verify-confirmacao-massa.mjs`.

export type FerramentaMassa = 'produtos.descricoes.gerar' | 'produtos.ambientadas.gerar';
export const FERRAMENTAS_MASSA: FerramentaMassa[] = ['produtos.descricoes.gerar', 'produtos.ambientadas.gerar'];

/** Os mesmos tetos das ferramentas (MAX_DESCRICOES_POR_LOTE / MAX_AMBIENTADAS_POR_LOTE). */
export const TAMANHO_LOTE: Record<FerramentaMassa, number> = {
  'produtos.descricoes.gerar': 50,
  'produtos.ambientadas.gerar': 10,
};

export interface CandidatoMassa {
  id: string;
  nome: string;
  temDescricao: boolean;
  temAmbientada: boolean;
  temFoto: boolean;
  /** false = só existe em memória (novo ou com edição não salva): o servidor gera do catálogo salvo. */
  salvo?: boolean;
}

export interface Confirmacao {
  ferramenta: FerramentaMassa;
  total: number;
  /** Ainda não têm — o que "Gerar só os N" gera. */
  novos: CandidatoMassa[];
  /** Já têm — entram só com "Sobrescrever". */
  jaTem: CandidatoMassa[];
  /** Imagem sem foto de base: fica de fora nos dois modos. */
  semFoto: CandidatoMassa[];
  /** Não salvos: ficam de fora nos dois modos, com aviso — antes sumiam em silêncio. */
  naoSalvos: CandidatoMassa[];
  custoUnitario: number;
}

export function montarConfirmacao(ferramenta: FerramentaMassa, candidatos: CandidatoMassa[], custoUnitario: number): Confirmacao {
  const imagem = ferramenta === 'produtos.ambientadas.gerar';
  const naoSalvos = candidatos.filter((c) => c.salvo === false);
  const salvos = candidatos.filter((c) => c.salvo !== false);
  const semFoto = imagem ? salvos.filter((c) => !c.temFoto) : [];
  const elegiveis = imagem ? salvos.filter((c) => c.temFoto) : salvos;
  const ja = (c: CandidatoMassa) => (imagem ? c.temAmbientada : c.temDescricao);
  return {
    ferramenta,
    total: candidatos.length,
    novos: elegiveis.filter((c) => !ja(c)),
    jaTem: elegiveis.filter(ja),
    semFoto,
    naoSalvos,
    custoUnitario,
  };
}

export const alvos = (c: Confirmacao, sobrescrever: boolean) => (sobrescrever ? [...c.novos, ...c.jaTem] : c.novos);
export const custoDe = (c: Confirmacao, sobrescrever: boolean) => alvos(c, sobrescrever).length * c.custoUnitario;

export function listaNomes(itens: { nome: string }[], max = 3): string {
  const nomes = itens.slice(0, max).map((i) => i.nome).join(', ');
  return itens.length > max ? `${nomes} e mais ${itens.length - max}` : nomes;
}

/** As linhas do "pensando" — cada uma é um fato que a tela de fato conferiu. */
export function etapasPensando(c: Confirmacao): string[] {
  const imagem = c.ferramenta === 'produtos.ambientadas.gerar';
  const n = c.total;
  const linhas = [`Lendo ${n === 1 ? 'o produto selecionado' : `os ${n} produtos selecionados`}…`];
  const oque = imagem ? 'imagens ambientadas' : 'descrições';
  linhas.push(c.jaTem.length
    ? `Conferindo ${oque} — ${c.jaTem.length} já ${c.jaTem.length === 1 ? 'tem' : 'têm'}: ${listaNomes(c.jaTem)}`
    : `Conferindo ${oque} — nenhum tem ainda`);
  if (c.naoSalvos.length) linhas.push(`Ainda não salvos — ${c.naoSalvos.length} fica${c.naoSalvos.length === 1 ? '' : 'm'} de fora (salve para incluir): ${listaNomes(c.naoSalvos)}`);
  if (c.semFoto.length) linhas.push(`Sem foto para servir de base — ${c.semFoto.length} fica${c.semFoto.length === 1 ? '' : 'm'} de fora: ${listaNomes(c.semFoto)}`);
  const k = c.novos.length;
  linhas.push(`Calculando custo — ${k} × ${c.custoUnitario} = ${k * c.custoUnitario} créditos`);
  return linhas;
}

export function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

/** A frase do card depois das etapas. */
export function resumoConfirmacao(c: Confirmacao): string {
  const n = c.novos.length;
  if (n) return `${n} ${n === 1 ? 'será gerado' : 'serão gerados'}.`;
  if (!c.jaTem.length && c.naoSalvos.length === c.total) return 'Nenhum dos selecionados está salvo — salve antes de gerar.';
  if (!c.jaTem.length && c.semFoto.length) return 'Nenhum dos selecionados tem foto para servir de base.';
  return `Todos já têm ${c.ferramenta === 'produtos.ambientadas.gerar' ? 'imagem ambientada' : 'descrição'}.`;
}
