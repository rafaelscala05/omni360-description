// Regras puras das ferramentas de Produto do agente (server/agent/tools/produtos.ts).
// Sem I/O: recebem os documentos de users/{uid}/products já lidos. Verificar
// com `npx tsx scripts/verify-agent-produtos.mjs`.
//
// Mesma regra da "Sua semana" (src/modules/agent/semana.ts): só o produto
// principal conta. Variação herda descrição e foto do pai na vitrine, e contar
// as filhas multiplicaria a mesma pendência pelo número de grades.

export type ProdutoDoc = Record<string, unknown> & { _docId: string };

export const MAX_DESCRICOES_POR_LOTE = 10;
export const LOTE_PADRAO = 5;
/** Mesmo teto do prompt (descricaoTemplate.ts) — acima disso o ERP corta. */
export const MAX_HTML = 2500;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export const skuDe = (p: Record<string, unknown>) => str(p['Código (SKU)']);
export const nomeDe = (p: Record<string, unknown>) => str(p['Descrição']) || skuDe(p) || '(sem nome)';
export const ehPai = (p: Record<string, unknown>) => !str(p['Código do pai']);
export const semDescricao = (p: Record<string, unknown>) => !str(p['Descrição complementar']);
export const semImagem = (p: Record<string, unknown>) =>
  !Object.keys(p).some((k) => /^URL imagem/i.test(k) && str(p[k]) !== '');

/** O que falta num produto, na linguagem do lojista. */
export function faltando(p: Record<string, unknown>): string[] {
  const f: string[] = [];
  if (semDescricao(p)) f.push('descrição');
  if (semImagem(p)) f.push('foto');
  if (!str(p['Título SEO'])) f.push('SEO');
  return f;
}

/**
 * Quais produtos entram no lote de descrições. Com SKUs, respeita a ordem
 * pedida e aceita produto que já tem descrição (é um pedido explícito de
 * reescrever); sem SKUs, pega os primeiros pais sem descrição.
 */
export function selecionarParaDescricao(
  produtos: ProdutoDoc[],
  opts: { skus?: string[]; limite?: number },
): { escolhidos: ProdutoDoc[]; naoEncontrados: string[]; totalSemDescricao: number } {
  const limite = Math.min(MAX_DESCRICOES_POR_LOTE, Math.max(1, Math.floor(opts.limite ?? LOTE_PADRAO)));
  const pais = produtos.filter(ehPai);
  const totalSemDescricao = pais.filter(semDescricao).length;

  if (opts.skus?.length) {
    const porSku = new Map(produtos.map((p) => [skuDe(p).toLowerCase(), p]));
    const escolhidos: ProdutoDoc[] = [];
    const naoEncontrados: string[] = [];
    for (const sku of opts.skus) {
      const p = porSku.get(String(sku).trim().toLowerCase());
      if (p) { if (!escolhidos.includes(p)) escolhidos.push(p); } else naoEncontrados.push(String(sku));
    }
    return { escolhidos: escolhidos.slice(0, limite), naoEncontrados, totalSemDescricao };
  }

  return {
    escolhidos: pais.filter(semDescricao).slice(0, limite),
    naoEncontrados: [],
    totalSemDescricao,
  };
}

export const MAX_SKUS_BUSCA = 50;

/**
 * Busca do `produtos.buscar`. Com `skus`, lê exatamente esses (na ordem pedida,
 * até MAX_SKUS_BUSCA) e diz quais não existem — é o caminho da seleção vinda da
 * tela. Sem, procura por SKU exato ou parte do nome (até 20).
 */
export function buscarProdutos<T extends Record<string, unknown>>(
  produtos: T[],
  opts: { pesquisa?: string; skus?: string[] },
): { achados: T[]; naoEncontrados: string[] } {
  if (opts.skus?.length) {
    const porSku = new Map(produtos.map((p) => [skuDe(p).toLowerCase(), p]));
    const achados: T[] = [];
    const naoEncontrados: string[] = [];
    for (const sku of opts.skus.slice(0, MAX_SKUS_BUSCA)) {
      const p = porSku.get(String(sku).trim().toLowerCase());
      if (p) { if (!achados.includes(p)) achados.push(p); } else naoEncontrados.push(String(sku));
    }
    return { achados, naoEncontrados };
  }
  const q = String(opts.pesquisa ?? '').trim().toLowerCase();
  if (!q) return { achados: [], naoEncontrados: [] };
  return {
    achados: produtos.filter((p) => skuDe(p).toLowerCase() === q || nomeDe(p).toLowerCase().includes(q)).slice(0, 20),
    naoEncontrados: [],
  };
}

/** Variações do grupo (campo `Variações` das filhas), como o prompt do cliente espera. */
export function variacoesDoPai(produtos: Record<string, unknown>[], skuPai: string): string {
  if (!skuPai) return 'Nenhuma';
  const v = produtos
    .filter((p) => str(p['Código do pai']) === skuPai)
    .map((p) => str(p['Variações']))
    .filter(Boolean);
  return v.length ? v.join(' | ') : 'Nenhuma';
}

const ENTIDADES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export const decodeEntidades = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTIDADES[m] ?? m);

/** Remove tags para mostrar um trecho legível na aprovação. */
export function textoPuro(html: string): string {
  return decodeEntidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface DescricaoGerada {
  descricao: string;
  tituloSeo: string;
  descricaoSeo: string;
  palavrasChave: string;
}

/**
 * Normaliza a resposta do modelo (o JSON do template padrão). Falha em vez de
 * aceitar descrição vazia: gravar "" num produto seria apagar e chamar de feito.
 */
export function normalizarGeracao(raw: unknown): DescricaoGerada {
  const r = (raw ?? {}) as Record<string, unknown>;
  const descricao = decodeEntidades(str(r.descricao_html));
  if (!descricao) throw new Error('O modelo não devolveu a descrição.');
  return {
    descricao: descricao.length > MAX_HTML ? cortarHtml(descricao, MAX_HTML) : descricao,
    tituloSeo: decodeEntidades(str(r.titulo_seo)).slice(0, 120),
    descricaoSeo: decodeEntidades(str(r.descricao_seo)).slice(0, 255),
    palavrasChave: decodeEntidades(str(r.palavras_chave)).slice(0, 255),
  };
}

/** Corta no último fechamento de tag antes do limite, para não gravar HTML quebrado no meio de uma tag. */
export function cortarHtml(html: string, max: number): string {
  const corte = html.slice(0, max);
  const ultimo = corte.lastIndexOf('</');
  if (ultimo <= 0) return corte.replace(/<[^>]*$/, '');
  const fim = corte.indexOf('>', ultimo);
  return fim === -1 ? corte.slice(0, ultimo) : corte.slice(0, fim + 1);
}
