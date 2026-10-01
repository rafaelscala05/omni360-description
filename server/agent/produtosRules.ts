// Regras puras das ferramentas de Produto do agente (server/agent/tools/produtos.ts).
// Sem I/O: recebem os documentos de users/{uid}/products já lidos. Verificar
// com `npx tsx scripts/verify-agent-produtos.mjs`.
//
// Mesma regra da "Sua semana" (src/modules/agent/semana.ts): só o produto
// principal conta. Variação herda descrição e foto do pai na vitrine, e contar
// as filhas multiplicaria a mesma pendência pelo número de grades.

export type ProdutoDoc = Record<string, unknown> & { _docId: string };

/** Teto de um lote. Com a geração em job (lote.ts) o limite não é mais o tempo de um preview(). */
export const MAX_DESCRICOES_POR_LOTE = 50;
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
  // Com SKUs (a seleção da tela), o padrão é levar todos eles.
  const limite = Math.min(MAX_DESCRICOES_POR_LOTE, Math.max(1, Math.floor(opts.limite ?? (opts.skus?.length || LOTE_PADRAO))));
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

// ---------------------------------------------------------------------------
// Atributos por categoria (produtos.atributos.gerar)
// ---------------------------------------------------------------------------

export interface DefAtributo {
  key: string;
  label: string;
  type: string;
  options?: string[];
  order?: number;
}
export interface CategoriaDoc {
  id: string;
  name?: string;
  pathIds?: string[];
  attributes?: DefAtributo[];
  parentId?: string | null;
  inheritImagePrompts?: boolean;
  imagePrompts?: CenasCategoria;
}

/** As 3 cenas de ambientada configuradas numa categoria (Categorias › cenas). */
export interface CenasCategoria { scene1?: string; scene2?: string; scene3?: string }

/**
 * Mesma regra de getEffectiveImagePrompts (src/services/categoryService.ts):
 * sobe pelos pais enquanto a categoria herda; a primeira que não herda (ou a
 * raiz) decide, e sem nenhuma cena preenchida vale o modo automático (null).
 */
export function cenasEfetivas(categoryId: string | undefined, categorias: CategoriaDoc[]): CenasCategoria | null {
  let atual = categorias.find((c) => c.id === categoryId);
  const vistas = new Set<string>();
  while (atual && !vistas.has(atual.id)) {
    vistas.add(atual.id);
    if (!atual.inheritImagePrompts || !atual.parentId) {
      const c = atual.imagePrompts;
      return c && (str(c.scene1) || str(c.scene2) || str(c.scene3)) ? c : null;
    }
    const pai = atual.parentId;
    atual = categorias.find((c) => c.id === pai);
  }
  return null;
}
type ValorAtributo = { value?: string | string[]; confirmed?: boolean; source?: string };

/**
 * Mesma regra de getEffectiveAttributes (src/services/categoryService.ts): os
 * atributos da categoria e dos ancestrais, o filho sobrescrevendo o pai na
 * mesma chave. Copiada aqui porque o serviço do cliente importa o Firebase.
 */
export function atributosEfetivos(categoryId: string | undefined, categorias: CategoriaDoc[]): DefAtributo[] {
  const cat = categorias.find((c) => c.id === categoryId);
  if (!cat) return [];
  const ids = [...new Set([...(Array.isArray(cat.pathIds) ? cat.pathIds : []), cat.id])];
  const mapa = new Map<string, DefAtributo>();
  for (const id of ids) {
    for (const a of categorias.find((c) => c.id === id)?.attributes ?? []) {
      if (a?.key) mapa.set(a.key, a);
    }
  }
  return [...mapa.values()];
}

const vazio = (v: unknown) => (Array.isArray(v) ? v.length === 0 : !str(v));

/** Atributos da categoria ainda sem valor no produto. */
export function atributosVazios(p: Record<string, unknown>, defs: DefAtributo[]): DefAtributo[] {
  const atuais = (p.attributes ?? {}) as Record<string, ValorAtributo>;
  return defs.filter((d) => vazio(atuais[d.key]?.value));
}

/**
 * Quem entra no lote de atributos. Sem SKUs, os primeiros pais com categoria e
 * pelo menos um atributo vazio — sem categoria não há o que preencher (a lista
 * de atributos vem dela). Com SKUs, os pedidos que têm categoria; os outros
 * voltam em `semCategoria` para o card avisar.
 */
export function selecionarParaAtributos(
  produtos: ProdutoDoc[],
  categorias: CategoriaDoc[],
  opts: { skus?: string[]; limite?: number },
): { escolhidos: ProdutoDoc[]; naoEncontrados: string[]; semCategoria: string[]; totalComVazios: number } {
  const limite = Math.min(MAX_DESCRICOES_POR_LOTE, Math.max(1, Math.floor(opts.limite ?? (opts.skus?.length || LOTE_PADRAO))));
  const defsDe = (p: ProdutoDoc) => atributosEfetivos(str(p.categoryId) || undefined, categorias);
  const comVazios = produtos.filter((p) => ehPai(p) && atributosVazios(p, defsDe(p)).length > 0);

  if (opts.skus?.length) {
    const porSku = new Map(produtos.map((p) => [skuDe(p).toLowerCase(), p]));
    const escolhidos: ProdutoDoc[] = [];
    const naoEncontrados: string[] = [];
    const semCategoria: string[] = [];
    for (const sku of opts.skus) {
      const p = porSku.get(String(sku).trim().toLowerCase());
      if (!p) { naoEncontrados.push(String(sku)); continue; }
      if (!defsDe(p).length) { semCategoria.push(nomeDe(p)); continue; }
      if (!escolhidos.includes(p)) escolhidos.push(p);
    }
    return { escolhidos: escolhidos.slice(0, limite), naoEncontrados, semCategoria, totalComVazios: comVazios.length };
  }
  return { escolhidos: comVazios.slice(0, limite), naoEncontrados: [], semCategoria: [], totalComVazios: comVazios.length };
}

const igual = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : str(a)) === JSON.stringify(Array.isArray(b) ? [...b].sort() : str(b));

/**
 * Limpa a resposta do modelo: só chaves da categoria; em select/multiselect,
 * só opções permitidas (casando sem diferença de maiúsculas e devolvendo a
 * grafia da opção); nada que o usuário confirmou; nada igual ao que já está.
 */
export function normalizarAtributos(
  raw: unknown,
  defs: DefAtributo[],
  atuais: Record<string, ValorAtributo> = {},
): { key: string; label: string; antes: string | string[] | null; valor: string | string[] }[] {
  const r = ((raw ?? {}) as { attributes?: Record<string, { value?: unknown }> }).attributes ?? {};
  const out: { key: string; label: string; antes: string | string[] | null; valor: string | string[] }[] = [];
  for (const d of defs) {
    const bruto = r[d.key]?.value;
    if (bruto === undefined || bruto === null) continue;
    const atual = atuais[d.key];
    if (atual?.confirmed && !vazio(atual.value)) continue;
    const opcoes = d.options ?? [];
    const casar = (v: unknown) => {
      const s = str(v);
      if (!s) return null;
      if (!opcoes.length || (d.type !== 'select' && d.type !== 'multiselect')) return s;
      return opcoes.find((o) => o.toLowerCase() === s.toLowerCase()) ?? null;
    };
    let valor: string | string[] | null;
    if (d.type === 'multiselect') {
      const lista = (Array.isArray(bruto) ? bruto : String(bruto).split(',')).map(casar).filter((v): v is string => !!v);
      valor = lista.length ? [...new Set(lista)] : null;
    } else {
      valor = casar(Array.isArray(bruto) ? bruto[0] : bruto);
    }
    if (valor === null || igual(valor, atual?.value)) continue;
    out.push({ key: d.key, label: d.label || d.key, antes: vazio(atual?.value) ? null : (atual!.value as string | string[]), valor });
  }
  return out;
}

/**
 * Aplica as sugestões aprovadas sobre os atributos de agora. Uma chave cujo
 * valor mudou desde que o lote começou (o usuário editou no meio) é pulada:
 * vale o que ele escreveu.
 */
export function mesclarAtributos(
  atuais: Record<string, ValorAtributo>,
  sugeridos: { key: string; antes: string | string[] | null; valor: string | string[] }[],
): { atributos: Record<string, unknown>; aplicados: string[]; pulados: string[] } {
  const atributos: Record<string, unknown> = { ...atuais };
  const aplicados: string[] = [];
  const pulados: string[] = [];
  for (const s of sugeridos) {
    const agora = atuais[s.key]?.value;
    if (!igual(vazio(agora) ? null : agora, s.antes)) { pulados.push(s.key); continue; }
    atributos[s.key] = { value: s.valor, aiSuggested: true, confirmed: false, source: 'ai' };
    aplicados.push(s.key);
  }
  return { atributos, aplicados, pulados };
}
