// Sincronização com o ERP — "Tiny · em dia" / "Tiny · 2 não enviadas".
//
// Puro e sem I/O, usado dos dois lados: o servidor carimba (server/syncStamp.ts,
// no envio e na importação) e o cliente compara o carimbo com o produto para
// pintar o selo. Verificar com `npx tsx scripts/verify-sincronizacao.mjs`.
//
// Um carimbo é, por grupo de campos, o hash do conteúdo que o ERP tem (porque
// acabamos de enviar ou porque acabou de chegar dele). Pendente = o produto
// local tem conteúdo naquele grupo e o hash dele não bate com o carimbo.
//
// Três regras que não são óbvias:
// - Importação carimba título, descrição e SEO, nunca imagens: o ERP
//   re-hospeda as URLs e o carimbo nunca bateria com as locais.
// - Grupo vazio no local nunca fica pendente: nenhum push manda vazio.
// - Sem carimbo (produto anterior a isto), conta como pendente só o que foi
//   gerado no app (a mesma regra que o envio do Bling já usava), para o
//   catálogo não amanhecer inteiro em âmbar.
// - Bling e IdWorks não usam este carimbo: o navegador já grava neles a
//   assinatura legada (`_blingPushed`/`_idworksPushed`, App.tsx) depois do
//   envio, e o selo só lê o que está lá (`assinaturaLegada`).

export type IntegracaoSync = 'tiny' | 'wake' | 'idworks' | 'bling';
export type GrupoSync = 'titulo' | 'descricao' | 'seo' | 'imagens' | 'fiscal';
export type Carimbo = Partial<Record<GrupoSync, string>>;
export type EstadoSync = { tipo: 'sem-vinculo' } | { tipo: 'em-dia' } | { tipo: 'pendente'; grupos: GrupoSync[] };

export interface ConteudoEnvio {
  titulo?: string;
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  imagens?: string[];
}

export const INTEGRACOES: IntegracaoSync[] = ['tiny', 'wake', 'bling', 'idworks'];

export const CAMPO_VINCULO = {
  tiny: '_tinyProductId', wake: '_wakeProductId', idworks: '_idworksProductId', bling: '_blingProductId',
} as const;

export const CAMPO_CARIMBO = {
  tiny: '_tinyPushed', wake: '_wakePushed', idworks: '_idworksPushed', bling: '_blingPushed',
} as const;

/** Só o que cada push escreve. */
export const GRUPOS_DA_INTEGRACAO: Record<IntegracaoSync, GrupoSync[]> = {
  tiny: ['titulo', 'descricao', 'seo', 'imagens'],
  wake: ['descricao', 'seo', 'imagens'],
  idworks: ['descricao', 'seo', 'fiscal', 'imagens'],
  bling: ['descricao', 'seo', 'fiscal', 'imagens'],
};

export const ROTULO_INTEGRACAO: Record<IntegracaoSync, string> = { tiny: 'Tiny', wake: 'Wake', bling: 'Bling', idworks: 'IdWorks' };
export const ROTULO_GRUPO: Record<GrupoSync, string> = {
  titulo: 'título', descricao: 'descrição', seo: 'SEO', imagens: 'imagens', fiscal: 'fiscal',
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Únicas, só http(s), em ordem — a ordem de envio não muda a assinatura. */
function normalizarImagens(urls: unknown[]): string[] {
  return [...new Set(urls.map(str).filter((u) => /^https?:\/\//i.test(u)))].sort();
}

function imagensLocais(p: Record<string, unknown>, integ: IntegracaoSync): string[] {
  const ambientadas = Array.isArray(p._ambientImages) ? (p._ambientImages as unknown[]) : [];
  // A Wake só recebe as ambientadas (buildWakePushPayload); os outros, as fotos também.
  if (integ === 'wake') return normalizarImagens(ambientadas);
  const fotos = Array.from({ length: 6 }, (_, i) => p[`URL imagem ${i + 1}`]);
  return normalizarImagens([...ambientadas, ...fotos]);
}

export function conteudoDoProduto(p: Record<string, unknown>, integ: IntegracaoSync): ConteudoEnvio {
  return {
    titulo: str(p['Descrição']),
    descricaoHtml: str(p['Descrição complementar']),
    seoTitle: str(p['Título SEO']),
    seoDescription: str(p['Descrição SEO']),
    seoKeywords: str(p['Palavras chave SEO']),
    imagens: imagensLocais(p, integ),
  };
}

type GrupoConteudo = Exclude<GrupoSync, 'fiscal'>;

/** Texto canônico de um grupo; '' = o grupo não tem conteúdo. */
function canonico(g: GrupoConteudo, c: ConteudoEnvio): string {
  switch (g) {
    case 'titulo': return str(c.titulo);
    case 'descricao': return str(c.descricaoHtml);
    case 'seo': {
      const partes = [str(c.seoTitle), str(c.seoDescription), str(c.seoKeywords)];
      return partes.some(Boolean) ? partes.join('\u0001') : '';
    }
    case 'imagens': return normalizarImagens(c.imagens ?? []).join('\n');
  }
}

const temNoConteudo = (g: GrupoConteudo, c: ConteudoEnvio): boolean => {
  if (g === 'imagens') return c.imagens !== undefined;
  if (g === 'seo') return c.seoTitle !== undefined || c.seoDescription !== undefined || c.seoKeywords !== undefined;
  if (g === 'titulo') return c.titulo !== undefined;
  return c.descricaoHtml !== undefined;
};

const passoOk = (s?: string) => s === 'ok' || s === 'sem alteração';

/** O que o ERP tem depois de um envio: só grupos que o push confirmou. */
export function assinaturasDoEnvio(integ: IntegracaoSync, c: ConteudoEnvio, steps: Record<string, string | undefined>): Carimbo {
  const out: Carimbo = {};
  for (const g of GRUPOS_DA_INTEGRACAO[integ]) {
    if (g === 'fiscal' || !passoOk(steps[g]) || !temNoConteudo(g, c)) continue;
    out[g] = djb2(canonico(g, c));
  }
  return out;
}

/** O que o ERP tem quando o produto chega dele. Imagens ficam de fora (ver topo). */
export function assinaturasDeImportacao(integ: IntegracaoSync, c: ConteudoEnvio): Carimbo {
  const out: Carimbo = {};
  for (const g of GRUPOS_DA_INTEGRACAO[integ]) {
    if (g === 'fiscal' || g === 'imagens' || !temNoConteudo(g, c)) continue;
    out[g] = djb2(canonico(g, c));
  }
  return out;
}

/** Foi gerado/editado no app? — o mesmo sinal que o envio do Bling usava (tinyGenerated). */
function geradoNoApp(p: Record<string, unknown>, g: GrupoSync): boolean {
  switch (g) {
    case 'descricao': return p._statusDescricao === 'Gerado por IA';
    case 'seo': return p._statusSEO === 'Gerado por IA';
    case 'fiscal': return !!p._enrichmentLog;
    case 'imagens': return Array.isArray(p._ambientImages) && p._ambientImages.length > 0;
    case 'titulo': return false;
  }
}

/**
 * Assinatura antiga por grupo, a que o envio do Bling grava em `_blingPushed`
 * pelo navegador (App.tsx). Mantida idêntica para não invalidar o que já está
 * gravado.
 */
export function assinaturaLegada(p: Record<string, unknown>, g: 'descricao' | 'seo' | 'fiscal' | 'imagens'): { has: boolean; sig: string } {
  const s = (v: unknown) => String(v ?? '');
  switch (g) {
    case 'descricao': return { has: !!p['Descrição complementar'], sig: djb2(s(p['Descrição complementar'])) };
    case 'seo': {
      const parts = [p['Título SEO'], p['Descrição SEO'], p['Palavras chave SEO']];
      return { has: parts.some((x) => !!x), sig: djb2(parts.map(s).join('')) };
    }
    case 'fiscal': {
      const parts = [p['NCM (Classificação fiscal)'], p['GTIN/EAN'], p['Peso líquido (Kg)'], p['Peso bruto (Kg)'], p['Largura embalagem'], p['Altura Embalagem'], p['Comprimento embalagem']];
      return { has: parts.some((x) => x !== undefined && x !== null && x !== ''), sig: djb2(parts.map(s).join('')) };
    }
    case 'imagens': {
      const urls: string[] = [...((p._ambientImages as string[] | undefined) ?? [])];
      for (let i = 1; i <= 6; i++) {
        const u = p[`URL imagem ${i}`];
        if (typeof u === 'string' && u) urls.push(u);
      }
      const imgs = Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u))));
      return { has: imgs.length > 0, sig: djb2(imgs.join('')) };
    }
  }
}

/** Bling e IdWorks: assinatura legada gravada pelo navegador. */
function estadoLegado(p: Record<string, unknown>, integ: 'bling' | 'idworks'): EstadoSync {
  const carimbo = (p[CAMPO_CARIMBO[integ]] ?? {}) as Carimbo;
  const grupos = (['descricao', 'seo', 'fiscal', 'imagens'] as const).filter((g) => {
    const { has, sig } = assinaturaLegada(p, g);
    return has && geradoNoApp(p, g) && carimbo[g] !== sig;
  });
  return grupos.length ? { tipo: 'pendente', grupos: [...grupos] } : { tipo: 'em-dia' };
}

export function estadoIntegracao(p: Record<string, unknown>, integ: IntegracaoSync): EstadoSync {
  if (!str(p[CAMPO_VINCULO[integ]])) return { tipo: 'sem-vinculo' };
  if (integ === 'bling' || integ === 'idworks') return estadoLegado(p, integ);
  const carimbo = (p[CAMPO_CARIMBO[integ]] ?? {}) as Carimbo;
  const c = conteudoDoProduto(p, integ);
  const grupos = GRUPOS_DA_INTEGRACAO[integ].filter((g) => {
    if (g === 'fiscal') return false;
    const local = canonico(g, c);
    if (!local) return false;
    const gravado = carimbo[g];
    return gravado ? djb2(local) !== gravado : geradoNoApp(p, g);
  });
  return grupos.length ? { tipo: 'pendente', grupos } : { tipo: 'em-dia' };
}

export function integracoesDe(p: Record<string, unknown>): { integracao: IntegracaoSync; estado: EstadoSync }[] {
  return INTEGRACOES
    .map((integracao) => ({ integracao, estado: estadoIntegracao(p, integracao) }))
    .filter((i) => i.estado.tipo !== 'sem-vinculo');
}

// ---------------------------------------------------------------------------
// Cliente: o carimbo é do servidor
// ---------------------------------------------------------------------------

/** O conteúdo de um item do payload de envio (Tiny ou Wake), como saiu. */
export function conteudoDoPayload(integ: 'tiny' | 'wake', x: {
  nome?: string; descricaoHtml?: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string;
  imagens?: string[]; urlImagem?: string; imagensUrls?: string[]; imagensBase64?: unknown[];
}): ConteudoEnvio {
  // Wake: as URLs só contam se cada uma virou uma imagem do envio. O corpo vem
  // do navegador; uma lista que não casa com o que foi enviado não carimba nada.
  const urlsWake = x.imagensUrls?.length && x.imagensUrls.length === x.imagensBase64?.length ? x.imagensUrls : undefined;
  return {
    // A Wake usa `nome` para o título SEO, e não sincroniza título.
    titulo: integ === 'tiny' ? x.nome : undefined,
    descricaoHtml: x.descricaoHtml,
    seoTitle: x.seoTitle,
    seoDescription: x.seoDescription,
    seoKeywords: x.seoKeywords,
    imagens: integ === 'wake' ? urlsWake : (x.imagens ?? (x.urlImagem ? [x.urlImagem] : undefined)),
  };
}

/** O produto em memória com o carimbo que o servidor acabou de gravar (o selo muda sem recarregar). */
export function aplicarCarimbo<T extends Record<string, unknown>>(p: T, integ: 'tiny' | 'wake', carimbo: Carimbo): T {
  if (!Object.keys(carimbo).length) return p;
  const campo = CAMPO_CARIMBO[integ];
  return { ...p, [campo]: { ...((p[campo] as Carimbo | undefined) ?? {}), ...carimbo } };
}

/**
 * O que o "salvar" do cliente grava. `_tinyPushed`/`_wakePushed` são escritos
 * pelo servidor (envio, importação): o merge profundo do Firestore com uma
 * cópia velha em memória apagaria o carimbo novo. A exceção é a importação da
 * Wake, que roda no navegador e marca `_wakePushedNovo` até o primeiro salvar.
 */
export function paraSalvar<T extends Record<string, unknown>>(p: T): T {
  const out: Record<string, unknown> = { ...p };
  delete out._tinyPushed;
  if (!out._wakePushedNovo) delete out._wakePushed;
  delete out._wakePushedNovo;
  return out as T;
}
