// Envio do catálogo do OMNI360 a Wake, Bling e IdWorks pelo chat — a parte
// pura: o que o ERP já tem, o que muda e o payload do mesmo push da tela de
// Integrações (pushWakeProduto / pushBlingProduto / pushIdworksProduto).
// Verificar com `npx tsx scripts/verify-agent-produtos.mjs`.
//
// A regra é a do Tiny (CLAUDE.md › Tiny, invariante 1): pelo chat só vão
// descrição, SEO e imagens. Dados fiscais e logísticos (NCM, CEST, GTIN, pesos,
// dimensões) nunca saem daqui — o grupo `fiscal` é sempre falso e os campos nem
// entram no payload. Atributos da Wake também ficam de fora: o PUT de produto da
// Wake é atômico e é a tela de Integrações que oferece esse risco conscientemente.

import type { WakePushProduct } from '../wakeAgent';
import type { BlingPushProduct } from '../blingAgent';
import type { IdworksPushProduct } from '../idworksAgent';
import type { PreviewField } from './types';
import type { ProdutoDoc } from './produtosRules';
import { imagensParaTiny } from './tinyCatalogo';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** O conteúdo que o chat leva ao ERP, lado a lado com o que o ERP já tem. */
export interface TextoCatalogo {
  descricaoHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  imagens?: string[];
}

export interface GruposEnvio { descricao: boolean; seo: boolean; imagens: boolean }

/** O que cada ERP aceita pelo chat. Bling v3 não tem SEO no produto; a Wake recebe imagem só em base64 e sem deduplicar. */
export const SUPORTE: Record<'wake' | 'bling' | 'idworks', { seo: boolean; imagens: boolean }> = {
  wake: { seo: true, imagens: false },
  bling: { seo: false, imagens: true },
  idworks: { seo: true, imagens: true },
};

export function textoDoCatalogo(p: ProdutoDoc): TextoCatalogo {
  const opc = (v: unknown) => str(v) || undefined;
  return {
    descricaoHtml: opc(p['Descrição complementar']),
    seoTitle: opc(p['Título SEO']),
    seoDescription: opc(p['Descrição SEO']),
    seoKeywords: opc(p['Palavras chave SEO']),
    imagens: imagensParaTiny(p as Record<string, unknown>),
  };
}

const texto = (html?: string) => str(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const corte = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * O que muda de fato: um campo vazio no catálogo nunca apaga o do ERP, e um
 * igual não vai. Imagens só contam as que o ERP ainda não tem (Bling e IdWorks
 * deduplicam por link no push).
 */
export function diffCatalogo(
  atual: TextoCatalogo,
  local: TextoCatalogo,
  suporte: { seo: boolean; imagens: boolean },
): { campos: PreviewField[]; grupos: GruposEnvio; imagensNovas: string[] } {
  const campos: PreviewField[] = [];
  const grupos: GruposEnvio = { descricao: false, seo: false, imagens: false };
  const difere = (a?: string, b?: string) => str(a) !== str(b);

  if (local.descricaoHtml && difere(local.descricaoHtml, atual.descricaoHtml)) {
    grupos.descricao = true;
    campos.push({
      campo: 'Descrição complementar',
      antes: atual.descricaoHtml ? corte(texto(atual.descricaoHtml)) : null,
      depois: corte(texto(local.descricaoHtml)),
      mudou: true,
    });
  }
  if (suporte.seo) {
    const SEO: [keyof TextoCatalogo, string][] = [
      ['seoTitle', 'Título SEO'], ['seoDescription', 'Descrição SEO'], ['seoKeywords', 'Palavras-chave SEO'],
    ];
    for (const [k, rotulo] of SEO) {
      const novo = local[k] as string | undefined;
      if (!novo || !difere(novo, atual[k] as string | undefined)) continue;
      grupos.seo = true;
      campos.push({ campo: rotulo, antes: (atual[k] as string | undefined) || null, depois: novo, mudou: true });
    }
  }
  let imagensNovas: string[] = [];
  if (suporte.imagens) {
    const ja = new Set(atual.imagens ?? []);
    imagensNovas = (local.imagens ?? []).filter((u) => !ja.has(u));
    if (imagensNovas.length) {
      grupos.imagens = true;
      campos.push({
        campo: 'Imagens',
        antes: ja.size ? `${ja.size} no ERP` : null,
        depois: `+${imagensNovas.length} ${imagensNovas.length === 1 ? 'imagem nova' : 'imagens novas'}`,
        mudou: true,
      });
    }
  }
  return { campos, grupos, imagensNovas };
}

export const temMudanca = (g: GruposEnvio) => g.descricao || g.seo || g.imagens;

// --- O que o ERP tem hoje --------------------------------------------------

/** Wake: o texto vem do bloco de informações (o mesmo que o push escolhe) e o SEO das metatags. */
export function atualWake(infos: unknown, seo: unknown, informacaoId?: number): TextoCatalogo {
  const lista = Array.isArray(infos) ? (infos as any[]) : [];
  const bloco = lista.find((i) => i?.informacaoId === informacaoId)
    ?? lista.find((i) => i?.tipoInformacao === 'Informacoes')
    ?? lista[0];
  const s = (seo ?? {}) as { title?: string; metaTags?: { name?: string; content?: string }[] };
  const meta = (nome: string) => (s.metaTags ?? []).find((m) => str(m?.name).toLowerCase() === nome)?.content;
  return {
    descricaoHtml: bloco?.texto || undefined,
    seoTitle: s.title || undefined,
    seoDescription: meta('description') || undefined,
    seoKeywords: meta('keywords') || undefined,
  };
}

/** Bling v3: GET /produtos/{id} → data. */
export function atualBling(current: any): TextoCatalogo {
  const externas: any[] = current?.midia?.imagens?.externas ?? [];
  return {
    descricaoHtml: current?.descricaoComplementar || undefined,
    imagens: externas.map((a) => a?.link ?? a?.url).filter(Boolean),
  };
}

// --- Payloads do push da tela de Integrações -------------------------------

export function paraWakePush(p: ProdutoDoc, g: GruposEnvio): WakePushProduct {
  const t = textoDoCatalogo(p);
  return {
    produtoId: str(p._wakeProductId),
    sku: str(p['Código (SKU)']) || undefined,
    informacaoId: typeof p._wakeInformacaoId === 'number' ? p._wakeInformacaoId : undefined,
    descricaoHtml: g.descricao ? t.descricaoHtml : undefined,
    seoTitle: g.seo ? t.seoTitle : undefined,
    seoDescription: g.seo ? t.seoDescription : undefined,
    seoKeywords: g.seo ? t.seoKeywords : undefined,
    campos: { descricao: g.descricao, seo: g.seo, atributos: false, imagens: false },
  };
}

export function paraBlingPush(p: ProdutoDoc, g: GruposEnvio, imagensNovas: string[]): BlingPushProduct {
  const t = textoDoCatalogo(p);
  return {
    blingId: str(p._blingProductId),
    sku: str(p['Código (SKU)']) || undefined,
    descricaoHtml: g.descricao ? t.descricaoHtml : undefined,
    imagens: g.imagens ? imagensNovas : undefined,
    campos: { descricao: g.descricao, seo: false, fiscal: false, imagens: g.imagens },
  };
}

export function paraIdworksPush(p: ProdutoDoc, g: GruposEnvio, imagensNovas: string[]): IdworksPushProduct {
  const t = textoDoCatalogo(p);
  return {
    idworksId: str(p._idworksProductId),
    sku: str(p['Código (SKU)']) || undefined,
    descricaoHtml: g.descricao ? t.descricaoHtml : undefined,
    seoTitle: g.seo ? t.seoTitle : undefined,
    seoDescription: g.seo ? t.seoDescription : undefined,
    seoKeywords: g.seo ? t.seoKeywords : undefined,
    imagens: g.imagens ? imagensNovas : undefined,
    campos: { descricao: g.descricao, seo: g.seo, fiscal: false, imagens: g.imagens },
  };
}

/** Uma linha de falha legível a partir dos `steps` de um push. */
export function motivoDaFalha(steps: Record<string, string>): string {
  const ruim = Object.values(steps).find((v) => v && v !== 'ok' && v !== 'skip' && !v.startsWith('sem ') && !v.startsWith('não suportado'));
  return ruim ?? 'falhou';
}
