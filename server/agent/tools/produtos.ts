// Ferramentas de Produto do agente — o catálogo que vive em users/{uid}/products.
//
// A geração de descrição do app roda no cliente (Firebase AI Logic); aqui ela
// roda no servidor, via Vertex, com o MESMO template (src/services/
// descriptionTemplate.ts), para o texto do Alfred sair igual ao do botão
// "Gerar". Só escreve no Firestore do OMNI360 — enviar ao ERP continua sendo
// o push de Integrações, que tem as próprias travas (ver CLAUDE.md, Tiny).
//
// O que é gravado: Descrição complementar + os três campos de SEO no pai, e a
// descrição nas variações (o mesmo patch de buildGeneratedParentPatch /
// buildGeneratedChildPatch em App.tsx). Diferente do botão, o nome do produto
// (`Descrição`) NÃO é trocado pelo título SEO: renomear o catálogo inteiro não
// é o que "completar descrições" promete.

import { GoogleGenAI } from '@google/genai';
import firebaseAppletConfig from '../../../firebase-applet-config.json';
import { adminDb } from '../../firebaseAdmin';
import { registerTool } from '../registry';
import { makePreview } from '../preview';
import { comCache, esquecerPrevia } from '../previewCache';
import { defaultTemplate, fillTemplate } from '../../../src/services/descriptionTemplate';
import {
  buscarProdutos, ehPai, faltando, nomeDe, normalizarGeracao, selecionarParaDescricao, semDescricao, semImagem, skuDe,
  textoPuro, variacoesDoPai, LOTE_PADRAO, MAX_DESCRICOES_POR_LOTE, MAX_SKUS_BUSCA,
  type DescricaoGerada, type ProdutoDoc,
} from '../produtosRules';
import type { PreviewField } from '../types';

const TOOL_DESCRICOES = 'produtos.descricoes.gerar';
const TEXT_MODEL = 'gemini-2.5-flash';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

const produtosCol = (uid: string) => adminDb.collection('users').doc(uid).collection('products');

async function lerCatalogo(uid: string): Promise<ProdutoDoc[]> {
  const snap = await produtosCol(uid).get();
  return snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), _docId: d.id }));
}

// Mesmo formato de regras visuais que productService.ts acrescenta ao template.
const REGRAS_VISUAIS = `
ESPECIFICAÇÕES VISUAIS DA DESCRIÇÃO (OBRIGATÓRIO):
1. Use HTML semântico e profissional.
2. Adicione espaçamento extra entre parágrafos, subtítulos e itens de lista para facilitar a leitura.
3. Utilize tags <h2> e <h3> para criar seções lógicas e organizadas.
4. Transforme blocos de texto denso em listas (<ul> e <li>).
5. O resultado deve ser visualmente limpo, com ar de e-commerce premium.
6. Não invente medidas, potência, garantia ou certificações que não estejam nos dados; quando um dado importante faltar, escreva sem ele.`;

async function gerarDescricao(ai: GoogleGenAI, produto: ProdutoDoc, catalogo: ProdutoDoc[]): Promise<DescricaoGerada> {
  const prompt = fillTemplate(produto, defaultTemplate, variacoesDoPai(catalogo, skuDe(produto))) + '\n\n' + REGRAS_VISUAIS;
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const resp = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      });
      const texto = (resp.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');
      return normalizarGeracao(JSON.parse(texto || '{}'));
    } catch (e) {
      ultimoErro = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/503|UNAVAILABLE|high demand|temporarily|JSON|não devolveu/i.test(msg) || tentativa === 3) break;
      await new Promise((r) => setTimeout(r, tentativa * 1000));
    }
  }
  throw ultimoErro;
}

/** Roda `fn` em no máximo `n` itens ao mesmo tempo — o Vertex limita requisições por minuto. */
async function emParalelo<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      try { out[i] = { status: 'fulfilled', value: await fn(itens[i]) }; } catch (e) { out[i] = { status: 'rejected', reason: e }; }
    }
  }));
  return out;
}

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

interface ItemGerado extends DescricaoGerada {
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
  description: `Escreve com IA a descrição (HTML) e o SEO (título, meta description, palavras-chave) de produtos do catálogo do OMNI360 e grava no cadastro, depois da aprovação. Sem "skus", pega os primeiros produtos principais sem descrição. No máximo ${MAX_DESCRICOES_POR_LOTE} por vez (padrão ${LOTE_PADRAO}). Não envia ao ERP — isso é feito em Integrações.`,
  schema: {
    type: 'object',
    properties: {
      skus: { type: 'array', items: { type: 'string' }, description: 'SKUs específicos. Omitir para pegar os que estão sem descrição.' },
      limite: { type: 'integer', description: `Quantos produtos neste lote (1–${MAX_DESCRICOES_POR_LOTE}).` },
    },
  },
  preview: async (ctx, a) => {
    const args = { skus: a.skus ?? [], limite: a.limite ?? LOTE_PADRAO };
    const gerado = await comCache(ctx.uid, TOOL_DESCRICOES, args, async () => {
      const catalogo = await lerCatalogo(ctx.uid);
      const { escolhidos, naoEncontrados, totalSemDescricao } = selecionarParaDescricao(catalogo, a);
      if (!escolhidos.length) {
        throw Object.assign(new Error(naoEncontrados.length
          ? `Nenhum dos SKUs foi encontrado no catálogo: ${naoEncontrados.join(', ')}.`
          : 'Nenhum produto principal está sem descrição.'), { status: 404 });
      }
      if (!VERTEX_PROJECT) throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor.'), { status: 500 });
      const ai = new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
      const resultados = await emParalelo(escolhidos, 3, (p) => gerarDescricao(ai, p, catalogo));
      const itens: ItemGerado[] = [];
      const falhas: string[] = [];
      resultados.forEach((r, i) => {
        const p = escolhidos[i];
        if (r.status === 'fulfilled') {
          itens.push({
            ...r.value, docId: p._docId, sku: skuDe(p), nome: nomeDe(p),
            descricaoAntes: String(p['Descrição complementar'] ?? ''),
          });
        } else {
          falhas.push(`${nomeDe(p)}: ${r.reason instanceof Error ? r.reason.message : 'falha na geração'}`);
        }
      });
      if (!itens.length) throw new Error(`Não consegui escrever nenhuma descrição. ${falhas.join(' · ')}`);
      return { itens, falhas, naoEncontrados, totalSemDescricao };
    });

    const { itens, falhas, naoEncontrados, totalSemDescricao } = gerado;
    const porItem = itens.map((it) => ({
      alvo: `${it.nome}${it.sku ? ` · ${it.sku}` : ''}`,
      campos: [
        { campo: 'Descrição', antes: trecho(textoPuro(it.descricaoAntes)) || null, depois: trecho(textoPuro(it.descricao), 600), mudou: true },
        { campo: 'Título SEO', antes: null, depois: it.tituloSeo, mudou: !!it.tituloSeo },
        { campo: 'Descrição SEO', antes: null, depois: it.descricaoSeo, mudou: !!it.descricaoSeo },
      ] as PreviewField[],
    }));
    const avisos = [
      'Grava só no catálogo do OMNI360 (descrição, título, meta description e palavras-chave). Nome, preço, estoque e dados fiscais não mudam, e nada vai ao ERP.',
      ...falhas.map((f) => `Ficou de fora — ${f}`),
      ...(naoEncontrados.length ? [`SKUs não encontrados: ${naoEncontrados.join(', ')}.`] : []),
    ];
    const restantes = totalSemDescricao - itens.filter((i) => !i.descricaoAntes.trim()).length;
    if (!a.skus?.length && restantes > 0) avisos.push(`Depois deste lote ainda ficam ${restantes} produtos sem descrição.`);

    return {
      ...makePreview({
        resumo: `Escrever ${itens.length === 1 ? 'a descrição de 1 produto' : `as descrições de ${itens.length} produtos`}`,
        alvo: itens.length === 1 ? porItem[0].alvo : `${itens.length} produtos do catálogo`,
        campos: [{ campo: 'Produtos', antes: null, depois: itens.map((i) => i.nome).join(', '), mudou: true }],
        avisos,
        payload: { itens },
      }),
      itens: porItem,
    };
  },
  execute: async (ctx, a, preview) => {
    const itens = ((preview.payload?.itens ?? []) as ItemGerado[]);
    if (ctx.dryRun) return { dryRun: true, produtos: itens.length };
    const agora = new Date().toISOString();
    const gravados: string[] = [];
    const pulados: string[] = [];
    for (const it of itens) {
      const ref = produtosCol(ctx.uid).doc(it.docId);
      const snap = await ref.get();
      if (!snap.exists) { pulados.push(`${it.nome} (removido do catálogo)`); continue; }
      const atual = snap.data() as Record<string, unknown>;
      // Alguém escreveu uma descrição entre a prévia e a aprovação: a dela vale.
      if (String(atual['Descrição complementar'] ?? '').trim() !== it.descricaoAntes.trim()) {
        pulados.push(`${it.nome} (a descrição mudou desde a prévia)`);
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
    }
    await esquecerPrevia(ctx.uid, TOOL_DESCRICOES, { skus: a.skus ?? [], limite: a.limite ?? LOTE_PADRAO });
    return { gravados: gravados.length, produtos: gravados, pulados };
  },
});
