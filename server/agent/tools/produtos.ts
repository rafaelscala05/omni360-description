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
import { custoDaAcao, estimateCredits } from '../execution';
import { CREDIT_ACTIONS } from '../../../src/credits';
import { assertNoActiveVideoJob } from '../../videoShared';
import { faltaParaVideo, montarPedidoVideo, type PedidoVideo } from '../videoPedido';
import { criarLote } from '../loteStore';
import { scheduleLote } from '../loteWorker';
import { clienteVertex, fotoPrincipal, gerarArvore, lerCatalogo, lerCategorias, produtosCol } from '../produtosGeracao';
import { comCache, esquecerPrevia } from '../previewCache';
import {
  achatarArvore, arvoreEmTexto, categoriasSemVinculo, normalizarArvore, vinculosDeProdutos,
  type CategoriaExistente, type NovaCategoria,
} from '../categoriasRules';
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

// ---------------------------------------------------------------------------
// Vídeo de produto — aprova o pedido; quem roda é o app (ver videoPedido.ts)
// ---------------------------------------------------------------------------

registerTool<{ sku: string }>({
  name: 'produtos.video.gerar',
  provider: 'produtos',
  mode: 'write',
  description: 'Produz o vídeo comercial vertical (~32s, narração e música) de UM produto do catálogo, o mesmo da aba Vídeo do produto: roteiro escrito a partir das fotos reais e da referência do produto, e geração das cenas. Leva alguns minutos e aparece em Atividade › Rodando. Exige descrição, título SEO e a referência do produto já criada. Um vídeo por vez.',
  schema: {
    type: 'object',
    properties: { sku: { type: 'string', description: 'SKU do produto no catálogo do OMNI360.' } },
    required: ['sku'],
  },
  preview: async (ctx, a) => {
    const userSnap = await adminDb.collection('users').doc(ctx.uid).get();
    if (userSnap.data()?.modules?.video !== true) {
      throw Object.assign(new Error('O módulo de vídeo não está ativo nesta conta.'), { status: 403 });
    }
    const { achados } = buscarProdutos(await lerCatalogo(ctx.uid), { skus: [a.sku] });
    const p = achados[0];
    if (!p) throw Object.assign(new Error(`Nenhum produto com o SKU "${a.sku}" no catálogo.`), { status: 404 });
    const falta = faltaParaVideo(p);
    if (falta.length) {
      throw Object.assign(new Error(`Antes do vídeo, ${nomeDe(p)} precisa de: ${falta.join(', ')}.`), { status: 409 });
    }
    await assertNoActiveVideoJob(ctx.uid);
    const pedido = montarPedidoVideo(p);
    const ambientadas = ((p._ambientImages as string[] | undefined) ?? []).length;
    const preview = makePreview({
      resumo: `Produzir o vídeo de ${nomeDe(p)}`,
      alvo: `${nomeDe(p)}${skuDe(p) ? ` · ${skuDe(p)}` : ''}`,
      campos: [
        { campo: 'Formato', antes: null, depois: 'Vertical 9:16, ~32s, narração em off e música', mudou: true },
        { campo: 'Fotos de referência', antes: null, depois: `${pedido.inicio.productPhotoUrls?.length ?? 0} fotos reais + a referência do produto`, mudou: true },
        { campo: 'Cenas', antes: null, depois: ambientadas ? `ambientadas (${ambientadas} imagens) e fotos reais` : 'a partir das fotos reais (o produto não tem imagem ambientada)', mudou: true },
      ],
      avisos: [
        'O roteiro é escrito na hora, a partir das fotos — o vídeo só mostra lados e estados do produto que aparecem nelas.',
        'Leva alguns minutos e começa logo depois da aprovação, com o app aberto. Se falhar, os créditos voltam.',
      ],
      payload: { pedido },
    });
    // O débito acontece na rota que roda o vídeo, não em runApprovedWrite — o custo vem daqui.
    return { ...preview, custo: await custoDaAcao(CREDIT_ACTIONS.videoGeneration) };
  },
  execute: async (ctx, _a, preview) => {
    const { pedido } = preview.payload as { pedido: PedidoVideo };
    if (ctx.dryRun) return { dryRun: true, produto: pedido.inicio.productName };
    // Só registra o pedido aprovado; quem roda é /api/agent/video/:actionId/iniciar.
    return { pedidoVideo: pedido, status: 'aguardando início' };
  },
});

// ---------------------------------------------------------------------------
// Categorias — propõe a árvore; uma aprovação cria tudo e vincula os produtos
// ---------------------------------------------------------------------------

const TOOL_CATEGORIAS = 'produtos.categorias.organizar';

registerTool<{ segmento?: string }>({
  name: TOOL_CATEGORIAS,
  provider: 'produtos',
  mode: 'write',
  description: 'Organiza em árvore (pai/filho, até 3 níveis) os nomes da coluna "Categoria" do catálogo que ainda não viraram categoria, reaproveitando as categorias que já existem, e vincula os produtos a elas. Uma aprovação cria a árvore inteira. Não cria atributos — isso continua em Categorias.',
  schema: {
    type: 'object',
    properties: { segmento: { type: 'string', description: 'Segmento da loja, se o usuário disser (ajuda a agrupar).' } },
  },
  preview: async (ctx, a) => {
    const args = { segmento: a.segmento ?? '' };
    const proposta = await comCache(ctx.uid, TOOL_CATEGORIAS, args, async () => {
      const [catalogo, categorias] = await Promise.all([lerCatalogo(ctx.uid), lerCategorias(ctx.uid)]);
      const existentes = categorias.map((c) => ({ id: c.id, name: String(c.name ?? ''), path: (c as { path?: string[] }).path, pathIds: c.pathIds, level: (c as { level?: number }).level }));
      const { nomes, produtos } = categoriasSemVinculo(catalogo, existentes);
      if (!nomes.length) {
        throw Object.assign(new Error(produtos
          ? 'Os produtos sem categoria usam nomes que já existem como categoria — dá para vinculá-los em Categorias, sem criar nada.'
          : 'Não há produto sem categoria com o campo "Categoria" preenchido.'), { status: 409 });
      }
      const arvore = normalizarArvore(await gerarArvore(clienteVertex(), nomes, existentes.map((c) => c.name), a.segmento), nomes);
      return { arvore, existentes, nomes, produtos };
    });
    const { novas, todas } = achatarArvore(proposta.arvore, proposta.existentes);
    return makePreview({
      resumo: `Criar ${novas.length === 1 ? '1 categoria' : `${novas.length} categorias`} e organizar o catálogo`,
      alvo: `Categorias · ${proposta.nomes.length} ${proposta.nomes.length === 1 ? 'nome' : 'nomes'} do catálogo`,
      campos: [
        { campo: 'Árvore proposta', antes: null, depois: arvoreEmTexto(proposta.arvore, proposta.existentes), mudou: true },
        { campo: 'Produtos a vincular', antes: null, depois: `${proposta.produtos} sem categoria hoje`, mudou: true },
      ],
      avisos: [
        'Cria só as categorias novas — as que já existem são reaproveitadas, nada é apagado nem renomeado.',
        'Os produtos ganham a categoria pelo nome do campo "Categoria". Atributos de categoria você define depois, em Categorias.',
      ],
      payload: { novas, todas: todas.map((c) => ({ id: c.id, name: c.name, path: c.path, pathIds: c.pathIds, level: c.level })) },
    });
  },
  execute: async (ctx, a, preview) => {
    const { novas, todas } = preview.payload as { novas: NovaCategoria[]; todas: CategoriaExistente[] };
    if (ctx.dryRun) return { dryRun: true, categorias: novas.length };
    const userRef = adminDb.collection('users').doc(ctx.uid);
    const agora = new Date().toISOString();
    let batch = adminDb.batch();
    let n = 0;
    const commit = async () => { if (n) { await batch.commit(); batch = adminDb.batch(); n = 0; } };
    for (const c of novas) {
      batch.set(userRef.collection('categories').doc(c.id), {
        ...c, attributes: [], inheritParentAttributes: true, inheritImagePrompts: true,
        productCount: 0, aiGenerated: true, createdAt: agora, updatedAt: agora,
      }, { merge: true });
      if (++n >= 400) await commit();
    }
    // Vínculo com o catálogo de agora, não o da prévia: produto vinculado à mão no meio fica como está.
    const vinculos = vinculosDeProdutos(await lerCatalogo(ctx.uid), todas);
    for (const v of vinculos) {
      batch.update(userRef.collection('products').doc(v.docId), { categoryId: v.categoryId, categoryPath: v.categoryPath, updatedAt: agora });
      if (++n >= 400) await commit();
    }
    await commit();
    await esquecerPrevia(ctx.uid, TOOL_CATEGORIAS, { segmento: a.segmento ?? '' });
    return { categorias: novas.length, gravados: vinculos.length, produtos: novas.map((c) => c.path.join(' › ')) };
  },
});

// ---------------------------------------------------------------------------
// Imagens ambientadas — lote em job; o débito é por produto aprovado
// ---------------------------------------------------------------------------

const TOOL_AMBIENTADAS = 'produtos.ambientadas.gerar';
/** Cada item são 4 chamadas de IA (cenas + 3 imagens): lote menor que o de texto. */
export const MAX_AMBIENTADAS_POR_LOTE = 10;

registerTool<ArgsDescricoes>({
  name: TOOL_AMBIENTADAS,
  provider: 'produtos',
  mode: 'write',
  lote: true,
  description: `Gera 3 imagens ambientadas por produto (cena real de uso, pessoa usando, escala) a partir da foto real, como o botão "Ambientar" do app. Roda em segundo plano como lote: as imagens aparecem no card e o usuário aprova produto a produto; cada produto aprovado debita uma ambientação. Sem "skus", pega produtos principais com foto e ainda sem ambientada. No máximo ${MAX_AMBIENTADAS_POR_LOTE} por lote.`,
  schema: {
    type: 'object',
    properties: {
      skus: { type: 'array', items: { type: 'string' }, description: 'SKUs específicos. Omitir para pegar os que têm foto e nenhuma ambientada.' },
      limite: { type: 'integer', description: `Quantos produtos neste lote (1–${MAX_AMBIENTADAS_POR_LOTE}).` },
    },
  },
  preview: async (ctx, a) => {
    const args = { skus: a.skus ?? [], limite: a.limite ?? null };
    const catalogo = await lerCatalogo(ctx.uid);
    const limite = Math.min(MAX_AMBIENTADAS_POR_LOTE, Math.max(1, Math.floor(a.limite ?? (a.skus?.length || LOTE_PADRAO))));
    const semFoto: string[] = [];
    let escolhidos: ProdutoDoc[];
    let naoEncontrados: string[] = [];
    if (a.skus?.length) {
      const r = buscarProdutos(catalogo, { skus: a.skus });
      naoEncontrados = r.naoEncontrados;
      escolhidos = r.achados.filter((p) => (fotoPrincipal(p) ? true : (semFoto.push(nomeDe(p)), false)));
    } else {
      escolhidos = catalogo.filter((p) => ehPai(p) && fotoPrincipal(p) && !((p._ambientImages as string[] | undefined) ?? []).length);
    }
    const total = escolhidos.length;
    escolhidos = escolhidos.slice(0, limite);
    if (!escolhidos.length) {
      throw Object.assign(new Error(
        semFoto.length ? `Sem foto pública para servir de base: ${semFoto.join(', ')}.`
          : naoEncontrados.length ? `Nenhum dos SKUs foi encontrado no catálogo: ${naoEncontrados.join(', ')}.`
            : 'Todo produto principal com foto já tem imagem ambientada.',
      ), { status: 404 });
    }
    const def = { name: TOOL_AMBIENTADAS, provider: 'produtos' as const };
    const custo = await estimateCredits(def, { payload: { itens: escolhidos } });
    // Gerar já custa caro para a plataforma, mesmo antes da aprovação: sem saldo
    // para o lote inteiro, nem começa.
    const saldo = Number((await adminDb.collection('users').doc(ctx.uid).get()).data()?.credits ?? 0);
    if (saldo < custo) {
      throw Object.assign(new Error(`Este lote custa até ${custo} créditos e o saldo é ${saldo}. Peça menos produtos ou recarregue.`), { status: 402 });
    }
    const avisos = [
      'As imagens são acrescentadas ao produto (as ambientadas que ele já tem continuam). A foto principal não muda, e nada vai ao ERP.',
      ...(semFoto.length ? [`Sem foto pública, ficaram de fora: ${semFoto.join(', ')}.`] : []),
      ...(naoEncontrados.length ? [`SKUs não encontrados: ${naoEncontrados.join(', ')}.`] : []),
      ...(!a.skus?.length && total > escolhidos.length ? [`Depois deste lote ainda ficam ${total - escolhidos.length} produtos sem ambientada.`] : []),
    ];
    const n = escolhidos.length;
    const preview = {
      resumo: `Criar imagens ambientadas de ${n === 1 ? '1 produto' : `${n} produtos`}`,
      alvo: n === 1 ? nomeDe(escolhidos[0]) : `${n} produtos do catálogo`,
      campos: [{ campo: 'Produtos', antes: null, depois: escolhidos.map(nomeDe).join(', '), mudou: true }] as PreviewField[],
      avisos,
      custo,
    };
    const { job, reaproveitado } = await criarLote({
      uid: ctx.uid, tool: TOOL_AMBIENTADAS, provider: 'produtos', args,
      itens: escolhidos.map((p) => ({ docId: p._docId, sku: skuDe(p), nome: nomeDe(p) })),
      preview, auto: ctx.aprovacao === 'auto',
    });
    scheduleLote(ctx.uid, job.id);
    return makePreview({ ...preview, payload: { lote: { id: job.id, actionId: job.actionId, reaproveitado } } });
  },
  execute: async (ctx, _a, preview) => {
    const itens = ((preview.payload?.itens ?? []) as { itemId: string; docId: string; nome: string; imagens: string[] }[]);
    if (ctx.dryRun) return { dryRun: true, gravadosIds: itens.map((i) => i.itemId), puladosIds: [], gravados: itens.length };
    const gravadosIds: string[] = [];
    const puladosIds: { id: string; motivo: string }[] = [];
    const produtos: string[] = [];
    for (const it of itens) {
      const ref = produtosCol(ctx.uid).doc(it.docId);
      const snap = await ref.get();
      if (!snap.exists) { puladosIds.push({ id: it.itemId, motivo: 'removido do catálogo' }); continue; }
      const atuais = (snap.data()?._ambientImages as string[] | undefined) ?? [];
      await ref.update({ _ambientImages: [...new Set([...atuais, ...it.imagens])], updatedAt: new Date().toISOString() });
      gravadosIds.push(it.itemId);
      produtos.push(it.nome);
    }
    return { gravados: gravadosIds.length, produtos, gravadosIds, puladosIds };
  },
});
