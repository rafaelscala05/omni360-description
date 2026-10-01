// Regras puras de produtos.categorias.organizar: o Alfred propõe a árvore de
// categorias para os nomes de "Categoria" do catálogo que ainda não viraram
// categoria, e uma aprovação cria tudo e vincula os produtos. Sem I/O;
// verificar com `npx tsx scripts/verify-agent-produtos.mjs`.
//
// Mesmo formato de documento que processCategoryImport (App.tsx) grava em
// users/{uid}/categories — id, path, pathIds, level, herança de atributos.

export interface NoArvore { name: string; children: NoArvore[] }
export interface CategoriaExistente { id: string; name: string; path?: string[]; pathIds?: string[]; level?: number }

export interface NovaCategoria {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
  path: string[];
  pathIds: string[];
}

export const MAX_NIVEIS = 3;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const slugDe = (s: string) => chave(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'categoria';

/** Nomes de "Categoria" usados no catálogo por produtos ainda sem categoria vinculada, sem repetir. */
export function categoriasSemVinculo(produtos: Record<string, unknown>[], existentes: CategoriaExistente[]): { nomes: string[]; produtos: number } {
  const jaExiste = new Set(existentes.map((c) => chave(c.name)));
  const nomes = new Map<string, string>();
  let n = 0;
  for (const p of produtos) {
    if (str(p.categoryId)) continue;
    const nome = str(p['Categoria']);
    if (!nome) continue;
    n++;
    if (!jaExiste.has(chave(nome)) && !nomes.has(chave(nome))) nomes.set(chave(nome), nome);
  }
  return { nomes: [...nomes.values()], produtos: n };
}

/**
 * Limpa a árvore do modelo: nomes vazios fora, sem irmãos repetidos, no
 * máximo MAX_NIVEIS níveis (o que vier mais fundo sobe para o último nível).
 * Todo nome pedido tem de aparecer: o que o modelo esqueceu entra na raiz.
 */
export function normalizarArvore(raw: unknown, pedidos: string[]): NoArvore[] {
  const lista = ((raw ?? {}) as { hierarchy?: unknown }).hierarchy;
  const limpar = (nos: unknown, nivel: number): NoArvore[] => {
    const out: NoArvore[] = [];
    for (const n of Array.isArray(nos) ? nos : []) {
      const name = str((n as { name?: unknown })?.name).slice(0, 80);
      if (!name || out.some((o) => chave(o.name) === chave(name))) continue;
      const filhos = limpar((n as { children?: unknown }).children, nivel + 1);
      if (nivel + 1 >= MAX_NIVEIS) {
        out.push({ name, children: [] });
        for (const f of achatarNomes(filhos)) if (!out.some((o) => chave(o.name) === chave(f))) out.push({ name: f, children: [] });
      } else {
        out.push({ name, children: filhos });
      }
    }
    return out;
  };
  const arvore = limpar(lista, 0);
  const presentes = new Set(achatarNomes(arvore).map(chave));
  for (const p of pedidos) if (!presentes.has(chave(p))) arvore.push({ name: p, children: [] });
  return arvore;
}

function achatarNomes(nos: NoArvore[]): string[] {
  return nos.flatMap((n) => [n.name, ...achatarNomes(n.children)]);
}

/**
 * Árvore → documentos. Um nó com o nome de uma categoria que já existe no
 * mesmo lugar (raiz com raiz) é reaproveitado, não duplicado; os filhos novos
 * penduram nela. Ids determinísticos pelo caminho: aprovar duas vezes não cria
 * duas árvores.
 */
export function achatarArvore(arvore: NoArvore[], existentes: CategoriaExistente[]): { novas: NovaCategoria[]; todas: CategoriaExistente[] } {
  const novas: NovaCategoria[] = [];
  const todas: CategoriaExistente[] = [...existentes];
  const visitar = (nos: NoArvore[], pai: CategoriaExistente | null) => {
    for (const n of nos) {
      const path = [...(pai?.path ?? []), n.name];
      const nivel = path.length - 1;
      const existente = todas.find((c) => chave(c.name) === chave(n.name) && (c.level ?? (c.path?.length ?? 1) - 1) === nivel
        && chave((c.path ?? []).slice(0, -1).join('>')) === chave((pai?.path ?? []).join('>')));
      let atual: CategoriaExistente;
      if (existente) {
        atual = existente;
      } else {
        const id = `cat_${path.map(slugDe).join('__')}`.slice(0, 140);
        const pathIds = [...(pai?.pathIds ?? []), id];
        const nova: NovaCategoria = { id, name: n.name, slug: slugDe(n.name), parentId: pai?.id ?? null, level: nivel, path, pathIds };
        novas.push(nova);
        atual = nova;
        todas.push(nova);
      }
      visitar(n.children, atual);
    }
  };
  visitar(arvore, null);
  return { novas, todas };
}

/** Produtos sem categoria cujo "Categoria" bate com o nome de uma categoria: o vínculo que a importação faz. */
export function vinculosDeProdutos<T extends Record<string, unknown> & { _docId: string }>(
  produtos: T[],
  categorias: CategoriaExistente[],
): { docId: string; categoryId: string; categoryPath: string[] }[] {
  const porNome = new Map<string, CategoriaExistente>();
  // Em nome repetido em níveis diferentes, vence o mais fundo (mais específico).
  for (const c of [...categorias].sort((a, b) => (a.path?.length ?? 1) - (b.path?.length ?? 1))) porNome.set(chave(c.name), c);
  const out: { docId: string; categoryId: string; categoryPath: string[] }[] = [];
  for (const p of produtos) {
    if (str(p.categoryId)) continue;
    const c = porNome.get(chave(str(p['Categoria'])));
    if (c) out.push({ docId: p._docId, categoryId: c.id, categoryPath: c.path ?? [c.name] });
  }
  return out;
}

/** A árvore em texto indentado, para a aprovação. Marca o que já existia. */
export function arvoreEmTexto(arvore: NoArvore[], existentes: CategoriaExistente[], nivel = 0): string {
  const existe = new Set(existentes.map((c) => chave(c.name)));
  return arvore.map((n) => {
    const linha = `${'   '.repeat(nivel)}${nivel ? '└ ' : ''}${n.name}${existe.has(chave(n.name)) ? ' (já existe)' : ''}`;
    const filhos = n.children.length ? `\n${arvoreEmTexto(n.children, existentes, nivel + 1)}` : '';
    return linha + filhos;
  }).join('\n');
}
