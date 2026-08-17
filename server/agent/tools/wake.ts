// Wake Commerce (fbits) tools for the operational agent.
//
// Every call goes through fbitsFetch() from server/wakeAgent.ts, so retry,
// backoff and 401 handling are shared with the existing import/push routes.
//
// Two Wake quirks drive the shape of the write tools:
//
//  1. PUT /produtos and PUT /banners/{id} are ATOMIC — they validate and replace
//     the whole record. Sending a partial body blanks every field you omitted.
//     So each write reads the current record first and echoes it back with only
//     the requested fields swapped. This is the same reason buildProductPutBody
//     exists in wakeAgent.ts, which we reuse rather than reimplement.
//  2. Price and stock have dedicated bulk endpoints (PUT /produtos/precos,
//     PUT /produtos/estoques) that are NOT atomic over the whole product. Those
//     are strictly safer than the product PUT, so price/stock edits use them.

import { fbitsFetch, buildProductPutBody } from '../../wakeAgent';
import { fetchImageAsBase64, type ImageFormat } from '../../safeUrl';
import { registerTool } from '../registry';
import { buildFieldDiff, makePreview, requireStr } from '../preview';
import { withLog } from '../telemetry';
import type { ActionPreview, ToolCtx } from '../types';

const SKU_Q = 'tipoIdentificador=Sku';

// A Wake só aceita estes formatos em imagemBanner.formato (enum do OpenAPI).
const FORMATOS_WAKE: readonly ImageFormat[] = ['PNG', 'JPG', 'JPEG'];

async function wakeCall<T = any>(ctx: ToolCtx, method: string, path: string, body?: unknown): Promise<T> {
  const token = await ctx.wakeToken();
  return withLog<T>(
    ctx.uid,
    { provider: 'wake', operacao: method, alvo: path, requisicao: body },
    () => fbitsFetch<T>(token, method, path, body),
  );
}

const sku = (v: string) => encodeURIComponent(v);

/**
 * Marker left in a persisted payload in place of image bytes. Base64 of a real
 * banner is megabytes, and a Firestore document caps at 1 MB — so the preview
 * validates the download (format, size, reachability) and then stores only the
 * URL. execute() re-downloads from the same immutable Storage URL.
 */
interface ImagePlaceholder {
  __fromUrl: string;
  nome: string;
}

async function resolveImage(ph: ImagePlaceholder) {
  const img = await fetchImageAsBase64(ph.__fromUrl, undefined, FORMATOS_WAKE);
  return { base64: img.base64, formato: img.formato, nome: ph.nome };
}

const dryRunResult = (o: Record<string, unknown>) => ({ dryRun: true, ...o });

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

registerTool({
  name: 'wake.banner.listar',
  provider: 'wake',
  mode: 'read',
  description: 'Lista os banners cadastrados na loja Wake, com posicionamento, status e datas de exibição.',
  schema: {
    type: 'object',
    properties: {
      pagina: { type: 'integer', description: 'Página da lista (padrão 1).' },
      quantidadePorPagina: { type: 'integer', description: 'Registros por página (máx. 50).' },
    },
  },
  read: (ctx, a: { pagina?: number; quantidadePorPagina?: number }) => {
    const pagina = a.pagina ?? 1;
    const qtd = Math.min(a.quantidadePorPagina ?? 50, 50);
    return wakeCall(ctx, 'GET', `/banners?pagina=${pagina}&quantidadePorPagina=${qtd}`);
  },
});

registerTool({
  name: 'wake.banner.obter',
  provider: 'wake',
  mode: 'read',
  description: 'Retorna todos os dados de um banner específico da Wake pelo seu id.',
  schema: {
    type: 'object',
    properties: { bannerId: { type: 'integer', description: 'Id do banner.' } },
    required: ['bannerId'],
  },
  read: (ctx, a: { bannerId: number }) => wakeCall(ctx, 'GET', `/banners/${a.bannerId}`),
});

registerTool({
  name: 'wake.banner.posicionamentos',
  provider: 'wake',
  mode: 'read',
  description: 'Lista os posicionamentos possíveis para um banner (ex.: Topo, Centro, Background) com seus ids. Use antes de criar um banner para descobrir o posicionamentoId correto.',
  schema: { type: 'object', properties: {} },
  read: (ctx) => wakeCall(ctx, 'GET', '/banners/posicionamentos'),
});

registerTool({
  name: 'wake.hotsite.listar',
  provider: 'wake',
  mode: 'read',
  description: 'Lista os hotsites (landing pages / vitrines) cadastrados na Wake, com id, nome, url e status.',
  schema: {
    type: 'object',
    properties: {
      pagina: { type: 'integer' },
      quantidadePorPagina: { type: 'integer', description: 'Máx. 50.' },
    },
  },
  read: (ctx, a: { pagina?: number; quantidadePorPagina?: number }) =>
    wakeCall(ctx, 'GET', `/hotsites?pagina=${a.pagina ?? 1}&quantidadePorPagina=${Math.min(a.quantidadePorPagina ?? 50, 50)}`),
});

registerTool({
  name: 'wake.produto.buscar',
  provider: 'wake',
  mode: 'read',
  description: 'Busca um produto da Wake pelo SKU e retorna cadastro, preço e estoque atuais. Sem SKU, retorna uma página da lista de produtos.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'SKU do produto. Omita para listar.' },
      pagina: { type: 'integer' },
    },
  },
  read: async (ctx, a: { sku?: string; pagina?: number }) => {
    if (!a.sku) {
      return wakeCall(ctx, 'GET', `/produtos?pagina=${a.pagina ?? 1}&quantidadeRegistros=20`);
    }
    const id = sku(a.sku);
    const [produto, preco, estoque] = await Promise.all([
      wakeCall(ctx, 'GET', `/produtos/${id}?${SKU_Q}&camposAdicionais=Atributo`),
      wakeCall(ctx, 'GET', `/produtos/${id}/preco?${SKU_Q}`).catch(() => null),
      wakeCall(ctx, 'GET', `/produtos/${id}/estoque?${SKU_Q}`).catch(() => null),
    ]);
    return { produto, preco, estoque };
  },
});

registerTool({
  name: 'wake.categoria.listar',
  provider: 'wake',
  mode: 'read',
  description: 'Lista as categorias cadastradas na loja Wake.',
  schema: { type: 'object', properties: { pagina: { type: 'integer' } } },
  read: (ctx, a: { pagina?: number }) =>
    wakeCall(ctx, 'GET', `/categorias?pagina=${a.pagina ?? 1}&quantidadePorPagina=50`),
});

// ---------------------------------------------------------------------------
// Escrita — banners
// ---------------------------------------------------------------------------

interface BannerCriarArgs {
  nome: string;
  imagemUrl: string;
  posicionamentoId: number;
  urlClique?: string;
  textoAlternativo?: string;
  ordemExibicao?: number;
  ativo?: boolean;
  dataInicio?: string;
  dataFim?: string;
  abrirLinkNovaAba?: boolean;
  hotsiteIds?: number[];
}

registerTool<BannerCriarArgs>({
  name: 'wake.banner.criar',
  provider: 'wake',
  mode: 'write',
  description: 'Cria um novo banner na Wake a partir de uma imagem enviada pelo usuário no chat. Use wake.banner.posicionamentos antes para escolher o posicionamentoId.',
  schema: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'Nome do banner no painel.' },
      imagemUrl: { type: 'string', description: 'URL da imagem anexada pelo usuário nesta conversa.' },
      posicionamentoId: { type: 'integer', description: 'Id do posicionamento (ver wake.banner.posicionamentos).' },
      urlClique: { type: 'string', description: 'Para onde o banner leva ao ser clicado.' },
      textoAlternativo: { type: 'string', description: 'Texto alternativo (acessibilidade e SEO).' },
      ordemExibicao: { type: 'integer' },
      ativo: { type: 'boolean', description: 'Padrão true.' },
      dataInicio: { type: 'string', description: 'ISO 8601. Opcional.' },
      dataFim: { type: 'string', description: 'ISO 8601. Opcional.' },
      abrirLinkNovaAba: { type: 'boolean' },
      hotsiteIds: { type: 'array', items: { type: 'integer' }, description: 'Hotsites onde exibir. Vazio = todos.' },
    },
    required: ['nome', 'imagemUrl', 'posicionamentoId'],
  },
  preview: async (_ctx, a) => {
    const nome = requireStr(a as never, 'nome');
    // Download now so a broken/oversized/unsupported image fails before the user
    // is asked to approve, not after.
    const img = await fetchImageAsBase64(a.imagemUrl, undefined, FORMATOS_WAKE);
    const avisos: string[] = [];
    if (!a.urlClique) avisos.push('Sem urlClique — o banner não será clicável.');
    if (a.hotsiteIds?.length) avisos.push(`Será exibido apenas nos hotsites: ${a.hotsiteIds.join(', ')}.`);

    // A Wake exige dataInicio e textoAlternativo (required no OpenAPI de POST
    // /banners). Em vez de deixar a API recusar com "Erro ao inserir banner!",
    // preenchemos defaults sensatos e avisamos no card o que foi assumido.
    const dataInicio = a.dataInicio ?? new Date().toISOString();
    if (!a.dataInicio) avisos.push('Sem data de início — assumi a partir de agora.');
    const textoAlternativo = a.textoAlternativo?.trim() || nome;
    if (!a.textoAlternativo) avisos.push(`Sem texto alternativo — usei o nome do banner ("${nome}").`);

    const placeholder: ImagePlaceholder = { __fromUrl: a.imagemUrl, nome: `${nome}.${img.formato.toLowerCase()}` };
    // Todos os campos abaixo marcados como obrigatórios no OpenAPI de POST
    // /banners são enviados sempre — omitir qualquer um faz a Wake responder 422
    // com a mensagem genérica "Erro ao inserir banner!".
    const body = {
      nome,
      dataInicio,
      dataFim: a.dataFim,
      ativo: a.ativo ?? true,
      detalhe: {
        posicionamentoId: a.posicionamentoId,
        imagemBanner: placeholder,
        // urlBanner consta como obrigatório, mas a doc diz que, quando
        // preenchido, imagemBanner é DESCONSIDERADO. Como aqui a imagem é o
        // ponto, mandamos string vazia: satisfaz o campo sem descartar o upload.
        urlBanner: '',
        urlClique: a.urlClique,
        textoAlternativo,
        ordemExibicao: a.ordemExibicao ?? 1,
        abrirLinkNovaAba: a.abrirLinkNovaAba ?? false,
        diasExibicao: {
          todosDias: true,
          domingo: true, segunda: true, terca: true, quarta: true,
          quinta: true, sexta: true, sabado: true,
        },
      },
      apresentacao: {
        exibirNoSite: a.ativo ?? true,
        exibirEmTodasBuscas: true,
        naoExibirEmBuscas: false,
        termosBusca: '',
        exibirEmTodasCategorias: true,
        listaHotsites: a.hotsiteIds?.length
          ? { exibirEmTodosHotsites: false, hotsites: a.hotsiteIds.map((hotSiteId) => ({ hotSiteId })) }
          : { exibirEmTodosHotsites: true, hotsites: [] },
        listaParceiros: { exibirEmTodosParceiros: true, parceiros: [] },
      },
    };

    return makePreview({
      resumo: `Criar o banner "${nome}" na Wake`,
      alvo: `Wake · posicionamento ${a.posicionamentoId}`,
      criacao: true,
      campos: buildFieldDiff({}, {
        nome,
        imagem: `${img.formato} · ${(img.bytes / 1024).toFixed(0)} KB`,
        posicionamentoId: a.posicionamentoId,
        urlClique: a.urlClique,
        textoAlternativo,
        ordemExibicao: a.ordemExibicao ?? 1,
        ativo: a.ativo ?? true,
        dataInicio,
        dataFim: a.dataFim,
      }, {
        nome: 'Nome', imagem: 'Imagem', posicionamentoId: 'Posicionamento',
        urlClique: 'URL de clique', textoAlternativo: 'Texto alternativo',
        ordemExibicao: 'Ordem', ativo: 'Ativo', dataInicio: 'Início', dataFim: 'Fim',
      }),
      avisos,
      payload: body,
    });
  },
  execute: async (ctx, a, preview) => {
    const body = structuredClone(preview.payload) as any;
    body.detalhe.imagemBanner = await resolveImage(body.detalhe.imagemBanner as ImagePlaceholder);
    if (ctx.dryRun) return dryRunResult({ acao: 'POST /banners', nome: body.nome });
    const criado = await wakeCall(ctx, 'POST', '/banners', body);
    // The create response is the source of truth for the new id; surface it so
    // the model can chain a hotsite link or a status change.
    return { criado };
  },
});

registerTool({
  name: 'wake.banner.status',
  provider: 'wake',
  mode: 'write',
  description: 'Ativa ou desativa um banner existente na Wake.',
  schema: {
    type: 'object',
    properties: {
      bannerId: { type: 'integer' },
      ativo: { type: 'boolean', description: 'true = ativo, false = inativo.' },
    },
    required: ['bannerId', 'ativo'],
  },
  preview: async (ctx, a: { bannerId: number; ativo: boolean }) => {
    const atual = await wakeCall<any>(ctx, 'GET', `/banners/${a.bannerId}`);
    return makePreview({
      resumo: `${a.ativo ? 'Ativar' : 'Desativar'} o banner "${atual?.nome ?? a.bannerId}"`,
      alvo: `Wake · banner ${a.bannerId}`,
      campos: buildFieldDiff({ ativo: atual?.ativo }, { ativo: a.ativo }, { ativo: 'Ativo' }),
      payload: { status: a.ativo },
    });
  },
  execute: async (ctx, a: { bannerId: number; ativo: boolean }, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: `PUT /banners/${a.bannerId}/status`, status: a.ativo });
    await wakeCall(ctx, 'PUT', `/banners/${a.bannerId}/status`, preview.payload);
    return { bannerId: a.bannerId, ativo: a.ativo };
  },
});

registerTool({
  name: 'wake.banner.imagem',
  provider: 'wake',
  mode: 'write',
  description: 'Troca a imagem de um banner já existente na Wake, mantendo todo o resto do cadastro.',
  schema: {
    type: 'object',
    properties: {
      bannerId: { type: 'integer' },
      imagemUrl: { type: 'string', description: 'URL da imagem anexada pelo usuário nesta conversa.' },
    },
    required: ['bannerId', 'imagemUrl'],
  },
  preview: async (ctx, a: { bannerId: number; imagemUrl: string }) => {
    const [atual, img] = await Promise.all([
      wakeCall<any>(ctx, 'GET', `/banners/${a.bannerId}`),
      fetchImageAsBase64(a.imagemUrl, undefined, FORMATOS_WAKE),
    ]);
    const placeholder: ImagePlaceholder = {
      __fromUrl: a.imagemUrl,
      nome: `${atual?.nome ?? `banner-${a.bannerId}`}.${img.formato.toLowerCase()}`,
    };
    return makePreview({
      resumo: `Trocar a imagem do banner "${atual?.nome ?? a.bannerId}"`,
      alvo: `Wake · banner ${a.bannerId}`,
      campos: buildFieldDiff(
        { imagem: atual?.detalhe?.urlBanner },
        { imagem: `nova imagem ${img.formato} · ${(img.bytes / 1024).toFixed(0)} KB` },
        { imagem: 'Imagem' },
      ),
      avisos: ['A imagem anterior deixa de ser exibida imediatamente após a execução.'],
      payload: { Imagem: placeholder },
    });
  },
  execute: async (ctx, a: { bannerId: number; imagemUrl: string }, preview) => {
    const body = { Imagem: await resolveImage((preview.payload as any).Imagem as ImagePlaceholder) };
    if (ctx.dryRun) return dryRunResult({ acao: `PUT /banners/${a.bannerId}/Imagem` });
    await wakeCall(ctx, 'PUT', `/banners/${a.bannerId}/Imagem`, body);
    return { bannerId: a.bannerId, atualizado: true };
  },
});

interface BannerAtualizarArgs {
  bannerId: number;
  nome?: string;
  urlClique?: string;
  textoAlternativo?: string;
  ordemExibicao?: number;
  posicionamentoId?: number;
  ativo?: boolean;
  dataInicio?: string;
  dataFim?: string;
}

registerTool<BannerAtualizarArgs>({
  name: 'wake.banner.atualizar',
  provider: 'wake',
  mode: 'write',
  description: 'Atualiza os dados de um banner existente na Wake (nome, link, ordem, posicionamento, datas). Para trocar a imagem use wake.banner.imagem.',
  schema: {
    type: 'object',
    properties: {
      bannerId: { type: 'integer' },
      nome: { type: 'string' },
      urlClique: { type: 'string' },
      textoAlternativo: { type: 'string' },
      ordemExibicao: { type: 'integer' },
      posicionamentoId: { type: 'integer' },
      ativo: { type: 'boolean' },
      dataInicio: { type: 'string', description: 'ISO 8601.' },
      dataFim: { type: 'string', description: 'ISO 8601.' },
    },
    required: ['bannerId'],
  },
  preview: async (ctx, a) => {
    const atual = await wakeCall<any>(ctx, 'GET', `/banners/${a.bannerId}`);
    const d = atual?.detalhe ?? {};
    const ap = atual?.apresentacao ?? {};

    // PUT /banners/{id} replaces the whole record, so echo everything back and
    // swap only what was asked. imagemBanner is deliberately omitted — including
    // it without bytes would clear the current image.
    const body = {
      nome: a.nome ?? atual?.nome,
      dataInicio: a.dataInicio ?? atual?.dataInicio,
      dataFim: a.dataFim ?? atual?.dataFim,
      ativo: a.ativo ?? atual?.ativo,
      detalhe: {
        posicionamentoId: a.posicionamentoId ?? d.posicionamentoId,
        urlBanner: d.urlBanner,
        ordemExibicao: a.ordemExibicao ?? d.ordemExibicao,
        // The read model calls it abrirBannerNovaAba; the write model calls it
        // abrirLinkNovaAba. Same flag, different name on each side of the API.
        abrirLinkNovaAba: d.abrirBannerNovaAba ?? false,
        largura: d.largura,
        altura: d.altura,
        title: d.title,
        urlClique: a.urlClique ?? d.urlClique,
        urlBannerAlternativo: d.urlBannerAlternativo,
        textoAlternativo: a.textoAlternativo ?? d.textoAlternativo,
        diasExibicao: d.diasExibicao,
      },
      apresentacao: {
        exibirNoSite: ap.exibirNoSite,
        exibirEmTodasBuscas: ap.exibirEmTodasBuscas,
        naoExibirEmBuscas: ap.naoExibirEmBuscas,
        termosBusca: ap.termosBusca,
        exibirEmTodasCategorias: ap.exibirEmTodasCategorias,
        listaHotsites: {
          exibirEmTodosHotsites: ap.listaHotsites?.exibirEmTodosHotSites ?? true,
          hotsites: ap.listaHotsites?.hotSites ?? [],
        },
        listaParceiros: {
          exibirEmTodosParceiros: ap.listaParceiros?.exibirEmTodosParceiros ?? true,
          parceiros: ap.listaParceiros?.parceiros ?? [],
        },
      },
    };

    return makePreview({
      resumo: `Atualizar o banner "${atual?.nome ?? a.bannerId}"`,
      alvo: `Wake · banner ${a.bannerId}`,
      campos: buildFieldDiff(
        {
          nome: atual?.nome, urlClique: d.urlClique, textoAlternativo: d.textoAlternativo,
          ordemExibicao: d.ordemExibicao, posicionamentoId: d.posicionamentoId,
          ativo: atual?.ativo, dataInicio: atual?.dataInicio, dataFim: atual?.dataFim,
        },
        {
          nome: a.nome, urlClique: a.urlClique, textoAlternativo: a.textoAlternativo,
          ordemExibicao: a.ordemExibicao, posicionamentoId: a.posicionamentoId,
          ativo: a.ativo, dataInicio: a.dataInicio, dataFim: a.dataFim,
        },
        {
          nome: 'Nome', urlClique: 'URL de clique', textoAlternativo: 'Texto alternativo',
          ordemExibicao: 'Ordem', posicionamentoId: 'Posicionamento', ativo: 'Ativo',
          dataInicio: 'Início', dataFim: 'Fim',
        },
      ),
      payload: body,
    });
  },
  execute: async (ctx, a, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: `PUT /banners/${a.bannerId}` });
    await wakeCall(ctx, 'PUT', `/banners/${a.bannerId}`, preview.payload);
    return { bannerId: a.bannerId, atualizado: true };
  },
});

registerTool({
  name: 'wake.banner.hotsites',
  provider: 'wake',
  mode: 'write',
  description: 'Vincula um banner a um ou mais hotsites na Wake, para que ele apareça naquelas páginas.',
  schema: {
    type: 'object',
    properties: {
      bannerId: { type: 'integer' },
      hotsiteIds: { type: 'array', items: { type: 'integer' }, description: 'Ids dos hotsites a vincular.' },
    },
    required: ['bannerId', 'hotsiteIds'],
  },
  preview: async (ctx, a: { bannerId: number; hotsiteIds: number[] }) => {
    const [banner, vinculados] = await Promise.all([
      wakeCall<any>(ctx, 'GET', `/banners/${a.bannerId}`),
      wakeCall<any[]>(ctx, 'GET', `/banners/${a.bannerId}/hotsites`).catch(() => []),
    ]);
    const atuais = (Array.isArray(vinculados) ? vinculados : []).map((h: any) => h?.hotSiteId ?? h?.hotsiteId);
    const novos = a.hotsiteIds.filter((id) => !atuais.includes(id));
    return makePreview({
      resumo: `Vincular o banner "${banner?.nome ?? a.bannerId}" a ${novos.length} hotsite(s)`,
      alvo: `Wake · banner ${a.bannerId}`,
      campos: buildFieldDiff(
        { hotsites: atuais.join(', ') || '(nenhum)' },
        { hotsites: [...atuais, ...novos].join(', ') || '(nenhum)' },
        { hotsites: 'Hotsites vinculados' },
      ),
      avisos: novos.length === 0 ? ['Todos os hotsites informados já estão vinculados.'] : [],
      payload: { lista: novos.map((hotSiteId) => ({ hotSiteId })) },
    });
  },
  execute: async (ctx, a: { bannerId: number; hotsiteIds: number[] }, preview) => {
    const lista = (preview.payload as any).lista as { hotSiteId: number }[];
    if (!lista.length) return { bannerId: a.bannerId, vinculados: 0 };
    if (ctx.dryRun) return dryRunResult({ acao: `POST /banners/${a.bannerId}/hotsites`, lista });
    await wakeCall(ctx, 'POST', `/banners/${a.bannerId}/hotsites`, lista);
    return { bannerId: a.bannerId, vinculados: lista.length };
  },
});

// ---------------------------------------------------------------------------
// Escrita — produtos
// ---------------------------------------------------------------------------

interface PrecoArgs { sku: string; precoPor?: number; precoDe?: number; precoCusto?: number }

registerTool<PrecoArgs>({
  name: 'wake.produto.preco',
  provider: 'wake',
  mode: 'write',
  description: 'Altera o preço de um produto na Wake (preço por, preço de e/ou preço de custo), identificado pelo SKU.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      precoPor: { type: 'number', description: 'Preço de venda.' },
      precoDe: { type: 'number', description: 'Preço "de" (riscado).' },
      precoCusto: { type: 'number' },
    },
    required: ['sku'],
  },
  preview: async (ctx, a) => {
    const s = requireStr(a as never, 'sku');
    const atual = await wakeCall<any>(ctx, 'GET', `/produtos/${sku(s)}/preco?${SKU_Q}`);
    const avisos: string[] = [];
    if (a.precoPor != null && a.precoDe != null && a.precoDe < a.precoPor) {
      avisos.push('O "preço de" ficará menor que o "preço por" — o desconto aparece invertido na vitrine.');
    }
    if (a.precoCusto != null && a.precoPor != null && a.precoCusto > a.precoPor) {
      avisos.push('Preço de custo maior que o preço de venda: a Wake pode recusar se a loja validar essa regra.');
    }
    return makePreview({
      resumo: `Alterar preço do SKU ${s}`,
      alvo: `Wake · produto ${s}`,
      campos: buildFieldDiff(
        { precoPor: atual?.precoPor, precoDe: atual?.precoDe, precoCusto: atual?.precoCusto },
        { precoPor: a.precoPor, precoDe: a.precoDe, precoCusto: a.precoCusto },
        { precoPor: 'Preço por', precoDe: 'Preço de', precoCusto: 'Preço de custo' },
      ),
      avisos,
      payload: {
        lista: [{
          identificador: s,
          precoPor: a.precoPor,
          precoDe: a.precoDe,
          precoCusto: a.precoCusto,
        }],
      },
    });
  },
  execute: async (ctx, a, preview) => {
    const lista = (preview.payload as any).lista as Record<string, unknown>[];
    lista.forEach((o) => Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]));
    if (ctx.dryRun) return dryRunResult({ acao: 'PUT /produtos/precos', lista });
    await wakeCall(ctx, 'PUT', `/produtos/precos?${SKU_Q}`, lista);
    return { sku: a.sku, atualizado: true };
  },
});

interface EstoqueArgs { sku: string; estoqueFisico: number; centroDistribuicaoId?: number; alertaEstoque?: number }

registerTool<EstoqueArgs>({
  name: 'wake.produto.estoque',
  provider: 'wake',
  mode: 'write',
  description: 'Ajusta o estoque físico de um produto na Wake, por SKU. Quando a loja tem mais de um centro de distribuição, informe qual.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      estoqueFisico: { type: 'integer', description: 'Nova quantidade em estoque.' },
      centroDistribuicaoId: { type: 'integer', description: 'Omita para usar o CD atual do produto quando houver apenas um.' },
      alertaEstoque: { type: 'integer' },
    },
    required: ['sku', 'estoqueFisico'],
  },
  preview: async (ctx, a) => {
    const s = requireStr(a as never, 'sku');
    const [estoque, produto] = await Promise.all([
      wakeCall<any>(ctx, 'GET', `/produtos/${sku(s)}/estoque?${SKU_Q}`),
      wakeCall<any>(ctx, 'GET', `/produtos/${sku(s)}?${SKU_Q}`),
    ]);
    const cds: any[] = Array.isArray(estoque?.listProdutoVarianteCentroDistribuicaoEstoque)
      ? estoque.listProdutoVarianteCentroDistribuicaoEstoque : [];
    const avisos: string[] = [];

    let cdId = a.centroDistribuicaoId;
    if (cdId == null) {
      if (cds.length === 1) cdId = cds[0]?.centroDistribuicaoId;
      else if (cds.length > 1) {
        throw Object.assign(
          new Error(`O produto tem estoque em ${cds.length} centros de distribuição (${cds.map((c) => `${c.centroDistribuicaoId}: ${c.nome}`).join(', ')}). Informe centroDistribuicaoId.`),
          { status: 400 },
        );
      }
    }
    if (cdId == null) throw Object.assign(new Error('Não consegui identificar o centro de distribuição do produto.'), { status: 400 });

    const cdAtual = cds.find((c) => c.centroDistribuicaoId === cdId);
    const produtoVarianteId = produto?.produtoVarianteId ?? produto?.produtoId;
    if (!produtoVarianteId) throw Object.assign(new Error('Não consegui resolver o produtoVarianteId do SKU.'), { status: 400 });
    if (a.estoqueFisico === 0) avisos.push('Estoque zerado — o produto sai de venda na vitrine.');

    return makePreview({
      resumo: `Ajustar estoque do SKU ${s} para ${a.estoqueFisico}`,
      alvo: `Wake · produto ${s} · CD ${cdAtual?.nome ?? cdId}`,
      campos: buildFieldDiff(
        { estoqueFisico: cdAtual?.estoqueFisico ?? estoque?.estoqueFisico, alertaEstoque: undefined },
        { estoqueFisico: a.estoqueFisico, alertaEstoque: a.alertaEstoque },
        { estoqueFisico: 'Estoque físico', alertaEstoque: 'Alerta de estoque' },
      ),
      avisos,
      payload: {
        lista: [{
          identificador: s,
          listaEstoque: [{
            estoqueFisico: a.estoqueFisico,
            centroDistribuicaoId: cdId,
            produtoVarianteId,
            ...(a.alertaEstoque != null ? { alertaEstoque: a.alertaEstoque } : {}),
          }],
        }],
      },
    });
  },
  execute: async (ctx, a, preview) => {
    const lista = (preview.payload as any).lista;
    if (ctx.dryRun) return dryRunResult({ acao: 'PUT /produtos/estoques', lista });
    await wakeCall(ctx, 'PUT', `/produtos/estoques?${SKU_Q}`, lista);
    return { sku: a.sku, estoqueFisico: a.estoqueFisico };
  },
});

interface SeoArgs { sku: string; seoTitle?: string; seoDescription?: string; seoKeywords?: string }

registerTool<SeoArgs>({
  name: 'wake.produto.seo',
  provider: 'wake',
  mode: 'write',
  description: 'Atualiza o SEO de um produto na Wake: title e as metatags description e keywords.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      seoTitle: { type: 'string' },
      seoDescription: { type: 'string' },
      seoKeywords: { type: 'string' },
    },
    required: ['sku'],
  },
  preview: async (ctx, a) => {
    const s = requireStr(a as never, 'sku');
    const atual = await wakeCall<any>(ctx, 'GET', `/produtos/${sku(s)}/seo?${SKU_Q}`).catch(() => null);
    const meta = (n: string) => (Array.isArray(atual?.metatags)
      ? atual.metatags.find((m: any) => (m?.name ?? '').toLowerCase() === n)?.content
      : undefined);

    const avisos: string[] = [];
    if (a.seoTitle && a.seoTitle.length > 60) avisos.push(`O title tem ${a.seoTitle.length} caracteres; o Google costuma cortar acima de ~60.`);
    if (a.seoDescription && a.seoDescription.length > 160) avisos.push(`A description tem ${a.seoDescription.length} caracteres; o ideal é até ~160.`);

    // The SEO PUT replaces the metatag array wholesale, so carry over whichever
    // side the user didn't provide instead of dropping it.
    const metaTags: { name: string; content: string }[] = [];
    const desc = a.seoDescription ?? meta('description');
    const keys = a.seoKeywords ?? meta('keywords');
    if (desc) metaTags.push({ name: 'description', content: desc });
    if (keys) metaTags.push({ name: 'keywords', content: keys });

    return makePreview({
      resumo: `Atualizar SEO do SKU ${s}`,
      alvo: `Wake · produto ${s}`,
      campos: buildFieldDiff(
        { seoTitle: atual?.title, seoDescription: meta('description'), seoKeywords: meta('keywords') },
        { seoTitle: a.seoTitle, seoDescription: a.seoDescription, seoKeywords: a.seoKeywords },
        { seoTitle: 'Title', seoDescription: 'Meta description', seoKeywords: 'Meta keywords' },
      ),
      avisos,
      payload: {
        tagCanonical: atual?.tagCanonical ?? undefined,
        title: a.seoTitle ?? atual?.title,
        metaTags,
      },
    });
  },
  execute: async (ctx, a, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: `PUT /produtos/${a.sku}/seo`, body: preview.payload });
    await wakeCall(ctx, 'PUT', `/produtos/${sku(a.sku)}/seo?${SKU_Q}`, preview.payload);
    return { sku: a.sku, atualizado: true };
  },
});

registerTool({
  name: 'wake.produto.descricao',
  provider: 'wake',
  mode: 'write',
  description: 'Substitui o texto do bloco de informações (descrição) de um produto na Wake. Aceita HTML.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      descricaoHtml: { type: 'string', description: 'Novo conteúdo, em HTML.' },
    },
    required: ['sku', 'descricaoHtml'],
  },
  preview: async (ctx, a: { sku: string; descricaoHtml: string }) => {
    const s = requireStr(a as never, 'sku');
    const infos = await wakeCall<any[]>(ctx, 'GET', `/produtos/${sku(s)}/informacoes?${SKU_Q}`).catch(() => []);
    const bloco = Array.isArray(infos)
      ? (infos.find((i) => i?.tipoInformacao === 'Informacoes') ?? infos[0])
      : undefined;
    if (!bloco?.informacaoId) {
      throw Object.assign(new Error(`O produto ${s} não tem bloco de informações para atualizar.`), { status: 400 });
    }
    const resumir = (h?: string) => (h ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    return makePreview({
      resumo: `Substituir a descrição do SKU ${s}`,
      alvo: `Wake · produto ${s} · bloco ${bloco.informacaoId}`,
      campos: buildFieldDiff(
        { descricao: resumir(bloco?.texto) },
        { descricao: resumir(a.descricaoHtml) },
        { descricao: 'Descrição (texto)' },
      ),
      avisos: ['O conteúdo anterior do bloco é substituído por completo.'],
      payload: {
        informacaoId: bloco.informacaoId,
        body: {
          titulo: bloco?.titulo ?? 'Informações',
          texto: a.descricaoHtml,
          exibirSite: bloco?.exibirSite ?? true,
          tipoInformacao: bloco?.tipoInformacao ?? 'Informacoes',
        },
      },
    });
  },
  execute: async (ctx, a: { sku: string; descricaoHtml: string }, preview) => {
    const { informacaoId, body } = preview.payload as any;
    if (ctx.dryRun) return dryRunResult({ acao: `PUT /produtos/${a.sku}/informacoes/${informacaoId}` });
    await wakeCall(ctx, 'PUT', `/produtos/${sku(a.sku)}/informacoes/${informacaoId}?${SKU_Q}`, body);
    return { sku: a.sku, atualizado: true };
  },
});

interface ProdutoCadastroArgs {
  sku: string;
  nome?: string;
  ean?: string;
  exibirSite?: boolean;
  freteGratis?: boolean;
  garantia?: string;
  peso?: number;
  altura?: number;
  largura?: number;
  comprimento?: number;
  prazoEntrega?: number;
}

registerTool<ProdutoCadastroArgs>({
  name: 'wake.produto.atualizar',
  provider: 'wake',
  mode: 'write',
  description: 'Atualiza dados de cadastro de um produto na Wake (nome, EAN, exibição no site, frete grátis, garantia, peso e dimensões). Para preço use wake.produto.preco e para estoque wake.produto.estoque.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      nome: { type: 'string' },
      ean: { type: 'string' },
      exibirSite: { type: 'boolean' },
      freteGratis: { type: 'boolean' },
      garantia: { type: 'string' },
      peso: { type: 'number', description: 'Em gramas.' },
      altura: { type: 'number' },
      largura: { type: 'number' },
      comprimento: { type: 'number' },
      prazoEntrega: { type: 'integer' },
    },
    required: ['sku'],
  },
  preview: async (ctx, a) => {
    const s = requireStr(a as never, 'sku');
    // camposAdicionais=Estoque|Atributo so the atomic PUT body stays valid —
    // same reason the push route in wakeAgent.ts asks for them.
    const current = await wakeCall<any>(
      ctx, 'GET', `/produtos/${sku(s)}?${SKU_Q}&camposAdicionais=Estoque&camposAdicionais=Atributo`,
    );
    const overrides: Record<string, unknown> = {
      ean: a.ean, exibirSite: a.exibirSite, freteGratis: a.freteGratis, garantia: a.garantia,
      peso: a.peso, altura: a.altura, largura: a.largura, comprimento: a.comprimento,
      prazoEntrega: a.prazoEntrega,
    };
    const body = buildProductPutBody(current, [], a.nome, overrides);

    return makePreview({
      resumo: `Atualizar cadastro do SKU ${s}`,
      alvo: `Wake · produto ${s}`,
      campos: buildFieldDiff(
        {
          nome: current?.nomeProdutoPai ?? current?.nome, ean: current?.ean,
          exibirSite: current?.exibirSite, freteGratis: current?.freteGratis,
          garantia: current?.garantia, peso: current?.peso, altura: current?.altura,
          largura: current?.largura, comprimento: current?.comprimento, prazoEntrega: current?.prazoEntrega,
        },
        {
          nome: a.nome, ean: a.ean, exibirSite: a.exibirSite, freteGratis: a.freteGratis,
          garantia: a.garantia, peso: a.peso, altura: a.altura, largura: a.largura,
          comprimento: a.comprimento, prazoEntrega: a.prazoEntrega,
        },
        {
          nome: 'Nome', ean: 'EAN', exibirSite: 'Exibir no site', freteGratis: 'Frete grátis',
          garantia: 'Garantia', peso: 'Peso', altura: 'Altura', largura: 'Largura',
          comprimento: 'Comprimento', prazoEntrega: 'Prazo de entrega',
        },
      ),
      avisos: a.exibirSite === false ? ['O produto deixa de aparecer na loja.'] : [],
      payload: body,
    });
  },
  execute: async (ctx, a, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: `PUT /produtos/${a.sku}`, body: preview.payload });
    await wakeCall(ctx, 'PUT', `/produtos/${sku(a.sku)}?${SKU_Q}`, preview.payload);
    return { sku: a.sku, atualizado: true };
  },
});
