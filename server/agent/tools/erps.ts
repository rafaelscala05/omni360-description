// Enviar o catálogo do OMNI360 a Wake, Bling e IdWorks pelo chat — o irmão de
// tiny.catalogo.enviar (tools/tiny.ts). Cada ferramenta lê o que o ERP tem
// agora, mostra só o que muda e, aprovada, chama a mesma função de push da tela
// de Integrações (pushWakeProduto / pushBlingProduto / pushIdworksProduto), com
// cada chamada HTTP no agent_logs. Escrever no ERP do cliente é trava fixa
// (agentSettings.ts), como no Tiny.
//
// Só descrição, SEO e imagens — o porquê está em server/agent/erpCatalogo.ts.

import { adminDb } from '../../firebaseAdmin';
import { fbitsFetch, pushWakeProduto, type WakeCaller, type WakePushResult } from '../../wakeAgent';
import { blingFetch, pushBlingProduto, type BlingCaller } from '../../blingAgent';
import { idworksFetch, normalizeProduct as normalizarIdworks, pushIdworksProduto, type IdworksCaller } from '../../idworksAgent';
import { carimbarEnvio, conteudoDoPushWake } from '../../syncStamp';
import type { PushLogEntry } from '../../pushLog';
import { registerTool } from '../registry';
import { makePreview } from '../preview';
import { withLog } from '../telemetry';
import {
  SUPORTE, atualBling, atualWake, diffCatalogo, motivoDaFalha, paraBlingPush, paraIdworksPush, paraWakePush,
  temMudanca, textoDoCatalogo, type GruposEnvio, type TextoCatalogo,
} from '../erpCatalogo';
import type { ProdutoDoc } from '../produtosRules';
import type { PreviewField, ToolCtx } from '../types';

const MAX_ENVIO = 20;

type Erp = 'wake' | 'bling' | 'idworks';

interface ResultadoPush { ok: boolean; sku?: string; steps: object; enviado?: PushLogEntry[] }

interface EnvioErp<P> {
  erp: Erp;
  marca: string;
  campoId: '_wakeProductId' | '_blingProductId' | '_idworksProductId';
  /** Produto apagado no ERP (o webhook marca, não remove do catálogo). */
  removido?: (p: ProdutoDoc) => boolean;
  /** O que o ERP tem hoje — leitura ao vivo, nunca o que o catálogo acha que tem. */
  lerAtual: (ctx: ToolCtx, p: ProdutoDoc) => Promise<TextoCatalogo>;
  montar: (p: ProdutoDoc, g: GruposEnvio, imagensNovas: string[]) => P;
  enviar: (ctx: ToolCtx, produtos: P[]) => Promise<ResultadoPush[]>;
  avisos: string[];
}

const log = <T>(ctx: ToolCtx, provider: Erp, method: string, path: string, body: unknown, fn: () => Promise<T>) =>
  withLog<T>(ctx.uid, { provider, operacao: method, alvo: path, requisicao: body }, fn);

function registrarEnvio<P extends { sku?: string }>(cfg: EnvioErp<P>): void {
  const suporte = SUPORTE[cfg.erp];
  const vai = ['descrição complementar', ...(suporte.seo ? ['SEO'] : []), ...(suporte.imagens ? ['imagens novas'] : [])];

  registerTool<{ skus: string[] }>({
    name: `${cfg.erp}.catalogo.enviar`,
    provider: cfg.erp,
    mode: 'write',
    description: `Envia ao ${cfg.marca} o que está no catálogo do OMNI360 — ${vai.join(', ')} — dos produtos indicados (os que vieram do ${cfg.marca}). É o mesmo envio da tela de Integrações: dados fiscais, preço e estoque nunca vão, e só segue o que for diferente do que o ${cfg.marca} já tem. A prévia mostra, produto a produto, o que muda. Até ${MAX_ENVIO} SKUs por vez.`,
    schema: {
      type: 'object',
      properties: {
        skus: { type: 'array', items: { type: 'string' }, description: `SKUs do catálogo do OMNI360 (até ${MAX_ENVIO}).` },
      },
      required: ['skus'],
    },
    preview: async (ctx, a) => {
      const skus = [...new Set((a.skus ?? []).map((s) => String(s).trim()).filter(Boolean))];
      if (!skus.length) throw Object.assign(new Error('Informe os SKUs a enviar.'), { status: 400 });
      if (skus.length > MAX_ENVIO) throw Object.assign(new Error(`No máximo ${MAX_ENVIO} produtos por envio — divida em lotes.`), { status: 400 });

      const snap = await adminDb.collection('users').doc(ctx.uid).collection('products').get();
      const porSku = new Map(snap.docs.map((d) => {
        const p = { ...(d.data() as Record<string, unknown>), _docId: d.id } as ProdutoDoc;
        return [String(p['Código (SKU)'] ?? '').trim().toLowerCase(), p] as const;
      }));

      const naoEncontrados: string[] = [];
      const fora: string[] = [];
      const iguais: string[] = [];
      const falhaLeitura: string[] = [];
      const produtos: P[] = [];
      const itens: { alvo: string; campos: PreviewField[] }[] = [];
      for (const sku of skus) {
        const p = porSku.get(sku.toLowerCase());
        if (!p) { naoEncontrados.push(sku); continue; }
        const nome = String(p['Descrição'] ?? sku);
        if (!p[cfg.campoId] || cfg.removido?.(p)) { fora.push(nome); continue; }
        let atual: TextoCatalogo;
        try { atual = await cfg.lerAtual(ctx, p); } catch (e: any) { falhaLeitura.push(`${nome} (${e?.message ?? 'erro'})`); continue; }
        const { campos, grupos, imagensNovas } = diffCatalogo(atual, textoDoCatalogo(p), suporte);
        if (!temMudanca(grupos)) { iguais.push(nome); continue; }
        produtos.push(cfg.montar(p, grupos, imagensNovas));
        itens.push({ alvo: `${nome} · ${sku}`, campos });
      }

      if (!produtos.length) {
        const motivo = [
          iguais.length ? `já iguais no ${cfg.marca}: ${iguais.join(', ')}` : '',
          fora.length ? `não vieram do ${cfg.marca}: ${fora.join(', ')}` : '',
          falhaLeitura.length ? `não consegui ler no ${cfg.marca}: ${falhaLeitura.join(', ')}` : '',
          naoEncontrados.length ? `não encontrados no catálogo: ${naoEncontrados.join(', ')}` : '',
        ].filter(Boolean).join('; ');
        throw Object.assign(new Error(`Nada para enviar — ${motivo || 'nenhum produto'}.`), { status: 409 });
      }

      const avisos = [
        ...cfg.avisos,
        ...(iguais.length ? [`Já iguais no ${cfg.marca} (não vão): ${iguais.join(', ')}.`] : []),
        ...(fora.length ? [`Não vieram do ${cfg.marca} (o envio não cria produto): ${fora.join(', ')}.`] : []),
        ...(falhaLeitura.length ? [`Não consegui ler no ${cfg.marca} (ficam de fora): ${falhaLeitura.join(', ')}.`] : []),
        ...(naoEncontrados.length ? [`SKUs não encontrados no catálogo: ${naoEncontrados.join(', ')}.`] : []),
      ];
      return {
        ...makePreview({
          resumo: `Enviar ${produtos.length === 1 ? '1 produto' : `${produtos.length} produtos`} do catálogo ao ${cfg.marca}`,
          alvo: produtos.length === 1 ? `${cfg.marca} · ${produtos[0].sku ?? ''}` : `${cfg.marca} · ${produtos.length} produtos`,
          campos: [{ campo: 'Produtos', antes: null, depois: produtos.map((x) => x.sku).join(', '), mudou: true }],
          avisos,
          payload: { produtos },
        }),
        itens,
      };
    },
    execute: async (ctx, _a, preview) => {
      const { produtos } = preview.payload as { produtos: P[] };
      if (ctx.dryRun) return { dryRun: true, acao: `push ${cfg.erp}`, produtos: produtos.length };
      const resultados = await cfg.enviar(ctx, produtos);
      const ok = resultados.filter((r) => r.ok);
      return {
        enviados: ok.length,
        falhas: resultados.filter((r) => !r.ok).map((r) => `${r.sku ?? '?'}: ${motivoDaFalha(r.steps as Record<string, string>)}`),
        // O mesmo log do painel de Integrações: o que de fato chegou ao ERP, campo a campo.
        enviado: ok.map((r) => ({ sku: r.sku, campos: (r.enviado ?? []).map((e) => e.campo) })),
      };
    },
  });
}

// --- Wake ------------------------------------------------------------------

const SKU_Q = '?tipoIdentificador=Sku';

registrarEnvio({
  erp: 'wake',
  marca: 'Wake',
  campoId: '_wakeProductId',
  // A Wake só aceita escrita por SKU (ver pushWakeProduto): sem SKU, não há como enviar.
  removido: (p) => !String(p['Código (SKU)'] ?? '').trim(),
  lerAtual: async (ctx, p) => {
    const token = await ctx.wakeToken();
    const id = encodeURIComponent(String(p['Código (SKU)'] ?? '').trim());
    const get = (path: string) => log(ctx, 'wake', 'GET', path, undefined, () => fbitsFetch(token, 'GET', path));
    const [infos, seo] = await Promise.all([
      get(`/produtos/${id}/informacoes${SKU_Q}`).catch(() => []),
      get(`/produtos/${id}/seo${SKU_Q}`).catch(() => null),
    ]);
    return atualWake(infos, seo, typeof p._wakeInformacaoId === 'number' ? p._wakeInformacaoId : undefined);
  },
  montar: (p, g) => paraWakePush(p, g),
  enviar: async (ctx, produtos) => {
    const token = await ctx.wakeToken();
    const call: WakeCaller = (method, path, body) => log(ctx, 'wake', method, path, body, () => fbitsFetch(token, method, path, body));
    const out: WakePushResult[] = [];
    for (const prod of produtos) out.push(await pushWakeProduto(call, prod));
    await carimbarEnvio(ctx.uid, 'wake', out.map((r, i) => ({
      erpId: r.produtoId, ok: r.ok, steps: r.steps, conteudo: conteudoDoPushWake(produtos[i]),
    })));
    return out;
  },
  avisos: [
    'Vai a descrição complementar e o SEO. Atributos, dados fiscais, preço e estoque não são enviados.',
    'Imagens ficam de fora pelo chat: a Wake não evita duplicar — envie pela tela de Integrações.',
  ],
});

// --- Bling -----------------------------------------------------------------

registrarEnvio({
  erp: 'bling',
  marca: 'Bling',
  campoId: '_blingProductId',
  removido: (p) => p._blingDeleted === true,
  lerAtual: async (ctx, p) => {
    const path = `/produtos/${String(p._blingProductId)}`;
    const r = await log(ctx, 'bling', 'GET', path, undefined, () => blingFetch<any>(ctx.uid, 'GET', path));
    return atualBling(r?.data ?? {});
  },
  montar: paraBlingPush,
  enviar: async (ctx, produtos) => {
    const call: BlingCaller = (method, path, body) => log(ctx, 'bling', method, path, body, () => blingFetch(ctx.uid, method, path, body));
    const out: ResultadoPush[] = [];
    for (const prod of produtos) out.push(await pushBlingProduto(call, prod));
    return out;
  },
  avisos: [
    'Vai a descrição complementar e as imagens novas. O Bling v3 não tem SEO no produto; dados fiscais, preço e estoque não são enviados.',
  ],
});

// --- IdWorks ---------------------------------------------------------------

registrarEnvio({
  erp: 'idworks',
  marca: 'IdWorks',
  campoId: '_idworksProductId',
  removido: (p) => p._idworksDeleted === true,
  lerAtual: async (ctx, p) => {
    const path = `/sku/${String(p._idworksProductId)}`;
    const r = await log(ctx, 'idworks', 'GET', path, undefined, () => idworksFetch<any>(ctx.uid, 'GET', path));
    const n = normalizarIdworks(Array.isArray(r) ? r[0] : r);
    return { descricaoHtml: n.descricaoHtml, seoTitle: n.seoTitle, seoDescription: n.seoDescription, seoKeywords: n.seoKeywords, imagens: n.imagens };
  },
  montar: paraIdworksPush,
  enviar: async (ctx, produtos) => {
    const call: IdworksCaller = (method, path, body) => log(ctx, 'idworks', method, path, body, () => idworksFetch(ctx.uid, method, path, body));
    const out: ResultadoPush[] = [];
    for (const prod of produtos) out.push(await pushIdworksProduto(call, prod));
    return out;
  },
  avisos: [
    'Vai a descrição, o SEO e as imagens novas. Dados fiscais, preço e estoque não são enviados.',
  ],
});
