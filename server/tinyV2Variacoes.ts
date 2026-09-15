// Tiny v2: variações de um produto dentro do produto.alterar do PAI. No Tiny, a
// variação só existe em variacoes[] do pai, e a imagem própria dela só existe no
// mapeamento com o e-commerce (variacoes[].variacao.mapeamentos[].mapeamento.urlImagem,
// que só é aceito com o cabeçalho Developer-Id). Pura — sem I/O — para ser
// verificada em scripts/verify-tiny-push.mjs.
import { logTexto, push as pushLog, type PushLogEntry } from './pushLog';

export const PASSO_PERTENCE_AO_PAI = 'no Tiny este campo pertence ao produto pai';
export const PASSO_SEM_IMAGEM = 'sem imagem própria';
export const PASSO_NAO_MAPEADA = 'variação ainda não mapeada no Tiny — envie o produto pela integração primeiro';
export const PASSO_NAO_ENCONTRADA = 'variação não encontrada no produto pai no Tiny';
export const PASSO_SEM_PAI = 'o Tiny não informou o produto pai desta variação';
export const PASSO_PAI_SEM_VARIACOES = 'o produto pai não está como "com variações" no Tiny';
export const PASSO_SEM_DEVELOPER_ID = 'Developer-Id do Tiny não configurado';

export interface VarianteDoLote {
  tinyId: string;
  urlImagem?: string;
}

export interface VariacoesPayload {
  /** Todas as variações do pai, prontas para produto.variacoes. */
  variacoes: Array<{ variacao: Record<string, unknown> }>;
  /** tinyId da variante do lote → valor de steps.imagens. */
  passoImagem: Record<string, string>;
  /** tinyId da variante do lote → o que foi gravado (ver server/pushLog.ts). */
  enviado: Record<string, PushLogEntry[]>;
  /** Se ao menos uma variante do lote tem mapeamento a gravar. */
  temMapeamento: boolean;
}

const semVazios = (o: Record<string, unknown>): Record<string, unknown> => {
  Object.keys(o).forEach((k) => { if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; });
  return o;
};

// `paiAtual` é o produto.obter do pai (com Developer-Id). Toda variação do pai
// vai no payload — mandar só parte da lista não é documentado e poderia remover
// as outras. Cada uma ecoa id/codigo/preco/grade como o Tiny devolveu. Só as
// variantes do lote com imagem própria E mapeamento existente ganham
// `mapeamentos`, copiados do obter com o urlImagem trocado. `mapeamentos` nunca
// vai vazio: um array vazio apaga os mapeamentos da variação.
export function buildV2VariacoesPayload(paiAtual: any, variantes: VarianteDoLote[]): VariacoesPayload {
  const passoImagem: Record<string, string> = {};
  const enviado: Record<string, PushLogEntry[]> = {};
  const alvos = new Map(variantes.map((v) => [String(v.tinyId), v]));
  let temMapeamento = false;

  const lista: any[] = Array.isArray(paiAtual?.variacoes)
    ? paiAtual.variacoes.map((x: any) => x?.variacao ?? x).filter((v: any) => v?.id !== undefined && v?.id !== null)
    : [];

  const variacoes = lista.map((v) => {
    const variacao = semVazios({ id: v.id, codigo: v.codigo, preco: v.preco, grade: v.grade });
    const id = String(v.id);
    const alvo = alvos.get(id);
    if (!alvo) return { variacao };

    const log: PushLogEntry[] = [];
    enviado[id] = log;
    if (!alvo.urlImagem) {
      passoImagem[id] = PASSO_SEM_IMAGEM;
      return { variacao };
    }
    const existentes = (Array.isArray(v.mapeamentos) ? v.mapeamentos : [])
      .map((m: any) => m?.mapeamento ?? m)
      .filter((m: any) => m?.skuMapeamento);
    if (!existentes.length) {
      passoImagem[id] = PASSO_NAO_MAPEADA;
      return { variacao };
    }
    variacao.mapeamentos = existentes.map((m: any) => ({
      mapeamento: semVazios({
        idEcommerce: m.idEcommerce,
        skuMapeamento: m.skuMapeamento,
        skuMapeamentoPai: m.skuMapeamentoPai,
        urlImagem: alvo.urlImagem,
      }),
    }));
    passoImagem[id] = 'ok';
    pushLog(log, logTexto('URL da imagem (mapeamento)', alvo.urlImagem));
    temMapeamento = true;
    return { variacao };
  });

  for (const v of variantes) {
    const id = String(v.tinyId);
    if (!(id in passoImagem)) {
      passoImagem[id] = PASSO_NAO_ENCONTRADA;
      enviado[id] = [];
    }
  }

  return { variacoes, passoImagem, enviado, temMapeamento };
}
