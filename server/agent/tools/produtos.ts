// Ferramentas de Produto do agente — o catálogo que vive em users/{uid}/products.
//
// A geração de descrição do app roda no cliente (Firebase AI Logic); aqui ela
// roda no servidor, via Vertex, com o MESMO template (produtosGeracao.ts), em
// lote em job (loteWorker.ts) — o preview() só cria o lote. Só escreve no
// Firestore do OMNI360 — enviar ao ERP continua sendo
// o push de Integrações, que tem as próprias travas (ver CLAUDE.md, Tiny).
//
// O que é gravado: Descrição complementar + os três campos de SEO no pai, e a
// descrição nas variações (o mesmo patch de buildGeneratedParentPatch /
// buildGeneratedChildPatch em App.tsx). Diferente do botão, o nome do produto
// (`Descrição`) NÃO é trocado pelo título SEO: renomear o catálogo inteiro não
// é o que "completar descrições" promete.

import { adminDb } from '../../firebaseAdmin';
import { registerTool } from '../registry';
import { makePreview } from '../preview';
import { estimateCredits } from '../execution';
import { criarLote } from '../loteStore';
import { scheduleLote } from '../loteWorker';
import { lerCatalogo, lerCategorias, produtosCol } from '../produtosGeracao';
import {
  buscarProdutos, ehPai, faltando, mesclarAtributos, nomeDe, selecionarParaAtributos, selecionarParaDescricao,
  semDescricao, semImagem, skuDe,
  textoPuro, LOTE_PADRAO, MAX_DESCRICOES_POR_LOTE, MAX_SKUS_BUSCA,
  type DescricaoGerada, type ProdutoDoc,
} from '../produtosRules';
import type { PreviewField } from '../types';

const TOOL_DESCRICOES = 'produtos.descricoes.gerar';
const trecho = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

registerTool({
  name: 'produtos.incompletos.listar',
  provider: 'produtos',
  mode: 'read',
  description: 'Lista os produtos do catálogo do OMNI360 que estão incompletos (sem descrição, sem foto ou sem SEO), só os produtos principais — variações herdam do pai. Use antes de propor completar descrições.',
  schema: {
    type: 'object',
    properties: {
      falta: { type: 'string', enum: ['descricao', 'foto', 'seo', 'qualquer'], description: 'Filtra pelo que falta. Padrão: qualquer.' },
      limite: { type: 'integer', description: 'Máximo de produtos na lista (padrão 30).' },
    },
  },
  read: async (ctx, a: { falta?: string; limite?: number }) => {
    const pais = (await lerCatalogo(ctx.uid)).filter(ehPai);
    const alvo = a.falta && a.falta !== 'qualquer' ? a.falta : null;
    const filtro = (p: ProdutoDoc) => {
      const f = faltando(p);
      if (!alvo) return f.length > 0;
      return f.includes(alvo === 'descricao' ? 'descrição' : alvo);
    };
    const lista = pais.filter(filtro);
    return {
      totalPrincipais: pais.length,
      semDescricao: pais.filter(semDescricao).length,
      semFoto: pais.filter(semImagem).length,
      encontrados: lista.length,
      produtos: lista.slice(0, Math.min(100, a.limite ?? 30)).map((p) => ({
        sku: skuDe(p), nome: nomeDe(p), categoria: p['Categoria'] ?? null, faltando: faltando(p),
      })),
    };
  },
});

registerTool({
  name: 'produtos.buscar',
  provider: 'produtos',
  mode: 'read',
  description: 'Busca produtos no catálogo do OMNI360 por SKU ou parte do nome — ou vários de uma vez por "skus" (ex.: os selecionados na tela) — e devolve o cadastro (nome, categoria, marca, preço, descrição atual, SEO, ERP vinculado, o que falta).',
  schema: {
    type: 'object',
    properties: {
      pesquisa: { type: 'string', description: 'SKU ou parte do nome.' },
      skus: { type: 'array', items: { type: 'string' }, description: `Lista de SKUs exatos (até ${MAX_SKUS_BUSCA}). Use em vez de "pesquisa" para ler vários produtos de uma vez.` },
    },
  },
  read: async (ctx, a: { pesquisa?: string; skus?: string[] }) => {
    const catalogo = await lerCatalogo(ctx.uid);
    const { achados, naoEncontrados } = buscarProdutos(catalogo, a);
    return {
      ...(naoEncontrados.length ? { naoEncontrados } : {}),
      produtos: achados.map((p) => ({
        sku: skuDe(p),
        nome: nomeDe(p),
        pai: p['Código do pai'] || null,
        categoria: p['Categoria'] ?? null,
        marca: p['Marca'] ?? null,
        preco: p['Preço'] ?? null,
        descricao: trecho(textoPuro(String(p['Descrição complementar'] ?? '')), 400) || null,
        tituloSeo: p['Título SEO'] ?? null,
        erp: p._tinyProductId ? 'Tiny' : p._blingProductId ? 'Bling' : p._idworksProductId ? 'IdWorks' : null,
        faltando: faltando(p),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** O que a rota de aprovação (loteAprovacao.ts) manda ao execute(): um item pronto do lote. */
interface ItemGerado extends DescricaoGerada {
  itemId: string;
  docId: string;
  sku: string;
  nome: string;
  descricaoAntes: string;
}

interface ArgsDescricoes { skus?: string[]; limite?: number }

registerTool<ArgsDescricoes>({
  name: TOOL_DESCRICOES,
  provider: 'produtos',
  mode: 'write',
  // Lote em job: o preview() só escolhe os produtos e cria o lote; o texto é
  // escrito item a item em segundo plano (loteWorker.ts), e o usuário aprova no
  // card o que já ficou pronto. Ver src/modules/agent/lote.ts.
  lote: true,
  description: `Escreve com IA a descrição (HTML) e o SEO (título, meta description, palavras-chave) de produtos do catálogo do OMNI360. Roda em segundo plano: cria um lote, as descrições aparecem no card conforme ficam prontas e o usuário revisa e aprova lá (pode aprovar as prontas antes do fim). Sem "skus", pega os primeiros produtos principais sem descrição. No máximo ${MAX_DESCRICOES_POR_LOTE} por lote (padrão ${LOTE_PADRAO}; com "skus", todos eles). Não envia ao ERP — isso é feito em Integrações.`,
  schema: {
    type: 'object',
    properties: {
      skus: { type: 'array', items: { type: 'string' }, description: 'SKUs específicos. Omitir para pegar os que estão sem descrição.' },
      limite: { type: 'integer', description: `Quantos produtos neste lote (1–${MAX_DESCRICOES_POR_LOTE}).` },
    },
  },
  preview: async (ctx, a) => {
    const args = { skus: a.skus ?? [], limite: a.limite ?? null };
    const catalogo = await lerCatalogo(ctx.uid);
    const { escolhidos, naoEncontrados, totalSemDescricao } = selecionarParaDescricao(catalogo, a);
    if (!escolhidos.length) {
      throw Object.assign(new Error(naoEncontrados.length
        ? `Nenhum dos SKUs foi encontrado no catálogo: ${naoEncontrados.join(', ')}.`
        : 'Nenhum produto principal está sem descrição.'), { status: 404 });
    }
    const avisos = [
      'Grava só no catálogo do OMNI360 (descrição, título, meta description e palavras-chave). Nome, preço, estoque e dados fiscais não mudam, e nada vai ao ERP.',
      ...(naoEncontrados.length ? [`SKUs não encontrados: ${naoEncontrados.join(', ')}.`] : []),
    ];
    const restantes = totalSemDescricao - escolhidos.filter(semDescricao).length;
    if (!a.skus?.length && restantes > 0) avisos.push(`Depois deste lote ainda ficam ${restantes} produtos sem descrição.`);

    const n = escolhidos.length;
    const def = { name: TOOL_DESCRICOES, provider: 'produtos' as const };
    const preview = {
      resumo: `Escrever ${n === 1 ? 'a descrição de 1 produto' : `as descrições de ${n} produtos`}`,
      alvo: n === 1 ? `${nomeDe(escolhidos[0])}${skuDe(escolhidos[0]) ? ` · ${skuDe(escolhidos[0])}` : ''}` : `${n} produtos do catálogo`,
      campos: [{ campo: 'Produtos', antes: null, depois: escolhidos.map(nomeDe).join(', '), mudou: true }] as PreviewField[],
      avisos,
      custo: await estimateCredits(def, { payload: { itens: escolhidos } }),
    };
    const { job, reaproveitado } = await criarLote({
      uid: ctx.uid,
      tool: TOOL_DESCRICOES,
      provider: 'produtos',
      args,
      itens: escolhidos.map((p) => ({
        docId: p._docId, sku: skuDe(p), nome: nomeDe(p), descricaoAntes: String(p['Descrição complementar'] ?? ''),
      })),
      preview,
      auto: ctx.aprovacao === 'auto',
    });
    scheduleLote(ctx.uid, job.id);
    return makePreview({ ...preview, payload: { lote: { id: job.id, actionId: job.actionId, reaproveitado } } });
  },
  execute: async (ctx, _a, preview) => {
    const itens = ((preview.payload?.itens ?? []) as ItemGerado[]);
    if (ctx.dryRun) return { dryRun: true, gravadosIds: itens.map((i) => i.itemId), puladosIds: [], gravados: itens.length };
    const agora = new Date().toISOString();
    const gravados: string[] = [];
    const gravadosIds: string[] = [];
    const pulados: string[] = [];
    const puladosIds: { id: string; motivo: string }[] = [];
    const pular = (it: ItemGerado, motivo: string) => { pulados.push(`${it.nome} (${motivo})`); puladosIds.push({ id: it.itemId, motivo }); };
    for (const it of itens) {
      const ref = produtosCol(ctx.uid).doc(it.docId);
      const snap = await ref.get();
      if (!snap.exists) { pular(it, 'removido do catálogo'); continue; }
      const atual = snap.data() as Record<string, unknown>;
      // Alguém escreveu uma descrição entre o início do lote e a aprovação: a dela vale.
      if (String(atual['Descrição complementar'] ?? '').trim() !== it.descricaoAntes.trim()) {
        pular(it, 'a descrição mudou desde que o lote começou');
        continue;
      }
      const batch = adminDb.batch();
      batch.update(ref, {
        'Descrição complementar': it.descricao,
        'Título SEO': it.tituloSeo,
        'Descrição SEO': it.descricaoSeo,
        'Palavras chave SEO': it.palavrasChave,
        _statusDescricao: 'Gerado por IA',
        _statusSEO: 'Gerado por IA',
        updatedAt: agora,
      });
      if (it.sku) {
        const filhas = await produtosCol(ctx.uid).where('Código do pai', '==', it.sku).get();
        filhas.docs.forEach((f) => batch.update(f.ref, { 'Descrição complementar': it.descricao, _statusDescricao: 'Gerado por IA', updatedAt: agora }));
      }
      await batch.commit();
      gravados.push(it.nome);
      gravadosIds.push(it.itemId);
    }
    return { gravados: gravados.length, produtos: gravados, pulados, gravadosIds, puladosIds };
  },
});

// ---------------------------------------------------------------------------
// Atributos da categoria — lote em job, como as descrições
// ---------------------------------------------------------------------------

const TOOL_ATRIBUTOS = 'produtos.atributos.gerar';

interface ItemAtributos {
  itemId: string;
  docId: string;
  nome: string;
  atributos: { key: string; label: string; antes: string | string[] | null; valor: string | string[] }[];
}

registerTool<ArgsDescricoes>({
  name: TOOL_ATRIBUTOS,
  provider: 'produtos',
  mode: 'write',
  lote: true,
  description: `Preenche com IA os atributos da categoria (cor, material, voltagem… — os definidos em Categorias) de produtos do catálogo do OMNI360, lendo os dados e a foto de cada um. Roda em segundo plano como lote: os atributos aparecem no card conforme ficam prontos e o usuário aprova lá. Só preenche atributos que a categoria define; produto sem categoria fica de fora. Sem "skus", pega os primeiros produtos principais com atributo vazio. No máximo ${MAX_DESCRICOES_POR_LOTE} por lote. Não gasta créditos.`,
  schema: {
    type: 'object',
    properties: {
      skus: { type: 'array', items: { type: 'string' }, description: 'SKUs específicos. Omitir para pegar os que têm atributo vazio.' },
      limite: { type: 'integer', description: `Quantos produtos neste lote (1–${MAX_DESCRICOES_POR_LOTE}).` },
    },
  },
  preview: async (ctx, a) => {
    const args = { skus: a.skus ?? [], limite: a.limite ?? null };
    const [catalogo, categorias] = await Promise.all([lerCatalogo(ctx.uid), lerCategorias(ctx.uid)]);
    const { escolhidos, naoEncontrados, semCategoria, totalComVazios } = selecionarParaAtributos(catalogo, categorias, a);
    if (!escolhidos.length) {
      throw Object.assign(new Error(
        semCategoria.length ? `Esses produtos não têm categoria com atributos definidos: ${semCategoria.join(', ')}. Defina a categoria (e os atributos dela) em Categorias primeiro.`
          : naoEncontrados.length ? `Nenhum dos SKUs foi encontrado no catálogo: ${naoEncontrados.join(', ')}.`
            : categorias.some((c) => c.attributes?.length) ? 'Nenhum produto principal com categoria tem atributo vazio.'
              : 'Nenhuma categoria tem atributos definidos ainda — crie os atributos em Categorias primeiro.',
      ), { status: 404 });
    }
    const avisos = [
      'Grava só os atributos da categoria no catálogo do OMNI360. Atributo que você já confirmou não é trocado, e nada vai ao ERP.',
      ...(semCategoria.length ? [`Sem categoria com atributos, ficaram de fora: ${semCategoria.join(', ')}.`] : []),
      ...(naoEncontrados.length ? [`SKUs não encontrados: ${naoEncontrados.join(', ')}.`] : []),
    ];
    const restantes = totalComVazios - escolhidos.length;
    if (!a.skus?.length && restantes > 0) avisos.push(`Depois deste lote ainda ficam ${restantes} produtos com atributo vazio.`);
    const n = escolhidos.length;
    const preview = {
      resumo: `Preencher os atributos de ${n === 1 ? '1 produto' : `${n} produtos`}`,
      alvo: n === 1 ? nomeDe(escolhidos[0]) : `${n} produtos do catálogo`,
      campos: [{ campo: 'Produtos', antes: null, depois: escolhidos.map(nomeDe).join(', '), mudou: true }] as PreviewField[],
      avisos,
      custo: 0,
    };
    const { job, reaproveitado } = await criarLote({
      uid: ctx.uid, tool: TOOL_ATRIBUTOS, provider: 'produtos', args,
      itens: escolhidos.map((p) => ({ docId: p._docId, sku: skuDe(p), nome: nomeDe(p) })),
      preview, auto: ctx.aprovacao === 'auto',
    });
    scheduleLote(ctx.uid, job.id);
    return makePreview({ ...preview, payload: { lote: { id: job.id, actionId: job.actionId, reaproveitado } } });
  },
  execute: async (ctx, _a, preview) => {
    const itens = ((preview.payload?.itens ?? []) as ItemAtributos[]);
    if (ctx.dryRun) return { dryRun: true, gravadosIds: itens.map((i) => i.itemId), puladosIds: [], gravados: itens.length };
    const gravadosIds: string[] = [];
    const puladosIds: { id: string; motivo: string }[] = [];
    const produtos: string[] = [];
    for (const it of itens) {
      const ref = produtosCol(ctx.uid).doc(it.docId);
      const snap = await ref.get();
      if (!snap.exists) { puladosIds.push({ id: it.itemId, motivo: 'removido do catálogo' }); continue; }
      const atuais = (snap.data()?.attributes ?? {}) as Record<string, { value?: string | string[]; confirmed?: boolean }>;
      const { atributos, aplicados } = mesclarAtributos(atuais, it.atributos);
      if (!aplicados.length) { puladosIds.push({ id: it.itemId, motivo: 'os atributos mudaram desde que o lote começou' }); continue; }
      await ref.update({ attributes: atributos, updatedAt: new Date().toISOString() });
      gravadosIds.push(it.itemId);
      produtos.push(it.nome);
    }
    return { gravados: gravadosIds.length, produtos, gravadosIds, puladosIds };
  },
});
