// Payload do push para o Tiny a partir de um produto do catálogo — a mesma
// montagem de tinyPushPayloadOf/collectTinyImages (App.tsx), aqui no servidor
// para o Alfred enviar pelo chat. Puro; verificar com
// `npx tsx scripts/verify-agent-produtos.mjs`.
//
// Só título, descrição complementar, SEO e imagens — nunca dados fiscais (o
// invariante 1 do push, ver CLAUDE.md › Tiny).

import { urlImagemPropria } from '../../src/services/tinyVariantImage';
import type { TinyPushProduct } from '../tinyAgent';
import type { PushLogEntry } from '../pushLog';
import type { ProdutoDoc } from './produtosRules';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Imagens públicas que o Tiny baixa: ambientadas + "URL imagem 1..6". */
export function imagensParaTiny(p: Record<string, unknown>): string[] {
  const urls: string[] = [...((p._ambientImages as string[] | undefined) ?? [])];
  for (let i = 1; i <= 6; i++) {
    const u = p[`URL imagem ${i}`];
    if (typeof u === 'string' && u) urls.push(u);
  }
  return [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))];
}

export function paraTinyPush(p: ProdutoDoc, pai?: ProdutoDoc): TinyPushProduct {
  const opc = (v: unknown) => str(v) || undefined;
  return {
    tinyId: str(p._tinyProductId),
    sku: opc(p['Código (SKU)']),
    nome: opc(p['Descrição']),
    descricaoHtml: opc(p['Descrição complementar']),
    seoTitle: opc(p['Título SEO']),
    seoDescription: opc(p['Descrição SEO']),
    seoKeywords: opc(p['Palavras chave SEO']),
    imagens: imagensParaTiny(p),
    urlImagem: urlImagemPropria(p as never, pai as never),
  };
}

/** Linhas de antes/depois da aprovação a partir do que o push gravaria (`enviado`). */
export function camposDoEnvio(
  enviado: PushLogEntry[],
  atual: { nome?: string; descricaoHtml?: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string },
): { campo: string; antes: unknown; depois: unknown; mudou: boolean }[] {
  const texto = (html?: string) => str(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const corte = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const ANTES: Record<string, string | undefined> = {
    'Nome do produto': atual.nome,
    'Descrição complementar': atual.descricaoHtml,
    'Título SEO': atual.seoTitle,
    'Descrição SEO': atual.seoDescription,
    'Palavras-chave SEO': atual.seoKeywords,
  };
  return enviado.map((e) => {
    if (e.itens) return { campo: e.campo, antes: null, depois: `${e.itens.length} ${e.itens.length === 1 ? 'imagem' : 'imagens'}`, mudou: true };
    const html = e.campo === 'Descrição complementar';
    const antes = ANTES[e.campo];
    return {
      campo: e.campo,
      antes: antes ? corte(html ? texto(antes) : antes) : null,
      depois: corte(html ? texto(e.valor) : str(e.valor)),
      mudou: true,
    };
  });
}
