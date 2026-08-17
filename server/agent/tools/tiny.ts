// Tiny ERP (Olist) tools for the operational agent — API **v2 only**.
//
// v2 is an RPC-style API: every call is a form POST to a `.php` endpoint with a
// static token, and the answer is wrapped in { retorno: ... }. tinyV2CallRaw()
// from server/tinyV2.ts already handles the retries, the rate-limit code hidden
// inside a HTTP 200, and the per-record error array — so everything here goes
// through it.
//
// The critical v2 quirk, called out in server/tinyV2.ts:176-179: produto.alterar
// is NOT a partial update. It validates the whole record, so a body missing
// unidade/preco/origem/situacao/tipo is rejected, and a body missing an optional
// field blanks it. Every write below therefore reads the current record first
// and echoes it back with only the requested fields replaced.
//
// NOTE ON ENDPOINT NAMES: Tiny's v2 reference is not reachable publicly (the
// api-docs pages 404), so the pedido/contato endpoint and parameter names below
// follow the canonical v2 contract but have NOT been verified against a live
// account. They fail safe: a wrong name surfaces as a Tiny error during
// preview(), before anything is approved or written.

import { tinyV2CallRaw, normalizeV2Product, num } from '../../tinyV2';
import { registerTool } from '../registry';
import { buildFieldDiff, makePreview, requireStr } from '../preview';
import { withLog } from '../telemetry';
import type { ToolCtx } from '../types';

async function tinyCall<T = any>(ctx: ToolCtx, endpoint: string, params: Record<string, string>): Promise<T> {
  const token = await ctx.tinyToken();
  return withLog<T>(
    ctx.uid,
    // O token vai no corpo do form na v2; redact() em telemetry.ts o remove.
    { provider: 'tiny', operacao: endpoint, alvo: endpoint, requisicao: params },
    () => tinyV2CallRaw(token, endpoint, params),
  );
}

const dryRunResult = (o: Record<string, unknown>) => ({ dryRun: true, ...o });

/** v2 wraps list items as [{ produto: {...} }] / [{ pedido: {...} }]. */
function unwrap<T = any>(arr: unknown, key: string): T[] {
  return Array.isArray(arr) ? arr.map((x: any) => x?.[key] ?? x) : [];
}

async function obterProduto(ctx: ToolCtx, id: string) {
  const r = await tinyCall(ctx, 'produto.obter.php', { id });
  const p = r?.produto;
  if (!p) throw Object.assign(new Error(`Produto ${id} não encontrado no Tiny.`), { status: 404 });
  return p;
}

/** Resolves a SKU (código) to the Tiny internal id the write endpoints need. */
async function resolverProdutoId(ctx: ToolCtx, args: { id?: string; sku?: string }): Promise<string> {
  if (args.id) return String(args.id);
  const sku = requireStr(args as never, 'sku');
  const r = await tinyCall(ctx, 'produtos.pesquisa.php', { pesquisa: sku });
  const encontrados = unwrap(r?.produtos, 'produto').filter((p: any) => String(p?.codigo ?? '').trim() === sku);
  if (!encontrados.length) {
    throw Object.assign(new Error(`Nenhum produto com o SKU "${sku}" no Tiny.`), { status: 404 });
  }
  if (encontrados.length > 1) {
    throw Object.assign(
      new Error(`Mais de um produto com o SKU "${sku}" (ids: ${encontrados.map((p: any) => p.id).join(', ')}). Informe o id.`),
      { status: 400 },
    );
  }
  return String(encontrados[0].id);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

registerTool({
  name: 'tiny.produto.buscar',
  provider: 'tiny',
  mode: 'read',
  description: 'Busca produtos no Tiny ERP por SKU, nome ou id, retornando preço, estoque e dados de cadastro.',
  schema: {
    type: 'object',
    properties: {
      pesquisa: { type: 'string', description: 'SKU ou parte do nome.' },
      id: { type: 'string', description: 'Id interno do Tiny, quando já conhecido.' },
      pagina: { type: 'integer' },
    },
  },
  read: async (ctx, a: { pesquisa?: string; id?: string; pagina?: number }) => {
    if (a.id) return { produto: normalizeV2Product(await obterProduto(ctx, a.id)) };
    const r = await tinyCall(ctx, 'produtos.pesquisa.php', {
      pesquisa: a.pesquisa ?? '',
      pagina: String(a.pagina ?? 1),
    });
    return {
      pagina: r?.pagina ?? 1,
      numeroPaginas: r?.numero_paginas ?? 1,
      produtos: unwrap(r?.produtos, 'produto'),
    };
  },
});

registerTool({
  name: 'tiny.pedido.listar',
  provider: 'tiny',
  mode: 'read',
  description: 'Lista pedidos do Tiny ERP, com filtros por período, situação, cliente ou número do pedido.',
  schema: {
    type: 'object',
    properties: {
      pesquisa: { type: 'string', description: 'Nome do cliente.' },
      numero: { type: 'string', description: 'Número do pedido.' },
      dataInicial: { type: 'string', description: 'dd/mm/aaaa.' },
      dataFinal: { type: 'string', description: 'dd/mm/aaaa.' },
      situacao: { type: 'string', description: 'Ex.: aberto, aprovado, faturado, enviado, entregue, cancelado.' },
      pagina: { type: 'integer' },
    },
  },
  read: async (ctx, a: Record<string, string | number | undefined>) => {
    const params: Record<string, string> = { pagina: String(a.pagina ?? 1) };
    for (const k of ['pesquisa', 'numero', 'dataInicial', 'dataFinal', 'situacao'] as const) {
      if (a[k] != null && a[k] !== '') params[k] = String(a[k]);
    }
    const r = await tinyCall(ctx, 'pedidos.pesquisa.php', params);
    return {
      pagina: r?.pagina ?? 1,
      numeroPaginas: r?.numero_paginas ?? 1,
      pedidos: unwrap(r?.pedidos, 'pedido'),
    };
  },
});

registerTool({
  name: 'tiny.pedido.obter',
  provider: 'tiny',
  mode: 'read',
  description: 'Retorna todos os dados de um pedido do Tiny: itens, valores, cliente, situação, transporte e marcadores.',
  schema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id interno do pedido no Tiny.' } },
    required: ['id'],
  },
  read: async (ctx, a: { id: string }) => {
    const r = await tinyCall(ctx, 'pedido.obter.php', { id: String(a.id) });
    return r?.pedido ?? r;
  },
});

registerTool({
  name: 'tiny.contato.buscar',
  provider: 'tiny',
  mode: 'read',
  description: 'Busca contatos (clientes e fornecedores) no Tiny ERP por nome, CPF/CNPJ ou código.',
  schema: {
    type: 'object',
    properties: {
      pesquisa: { type: 'string', description: 'Nome, razão social ou CPF/CNPJ.' },
      pagina: { type: 'integer' },
    },
  },
  read: async (ctx, a: { pesquisa?: string; pagina?: number }) => {
    const r = await tinyCall(ctx, 'contatos.pesquisa.php', {
      pesquisa: a.pesquisa ?? '',
      pagina: String(a.pagina ?? 1),
    });
    return {
      pagina: r?.pagina ?? 1,
      numeroPaginas: r?.numero_paginas ?? 1,
      contatos: unwrap(r?.contatos, 'contato'),
    };
  },
});

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

interface ProdutoArgs {
  id?: string;
  sku?: string;
  nome?: string;
  preco?: number;
  precoPromocional?: number;
  ncm?: string;
  gtin?: string;
  situacao?: 'A' | 'I';
  descricaoComplementar?: string;
}

registerTool<ProdutoArgs>({
  name: 'tiny.produto.atualizar',
  provider: 'tiny',
  mode: 'write',
  description: 'Atualiza um produto no Tiny ERP: nome, preço, preço promocional, NCM, GTIN, situação e descrição complementar. Identifique por SKU ou por id.',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'Código/SKU do produto no Tiny.' },
      id: { type: 'string', description: 'Id interno, alternativa ao SKU.' },
      nome: { type: 'string' },
      preco: { type: 'number', description: 'Preço de venda.' },
      precoPromocional: { type: 'number' },
      ncm: { type: 'string' },
      gtin: { type: 'string', description: 'EAN/GTIN.' },
      situacao: { type: 'string', enum: ['A', 'I'], description: 'A = ativo, I = inativo.' },
      descricaoComplementar: { type: 'string' },
    },
  },
  preview: async (ctx, a) => {
    const id = await resolverProdutoId(ctx, a);
    const atual = await obterProduto(ctx, id);

    // produto.alterar validates the whole record — required fields are always
    // echoed from Tiny's own current values so nothing gets blanked.
    const produto: Record<string, unknown> = {
      sequencia: 1,
      id,
      codigo: atual?.codigo,
      nome: a.nome ?? atual?.nome,
      unidade: atual?.unidade,
      preco: a.preco ?? atual?.preco,
      origem: atual?.origem,
      situacao: a.situacao ?? atual?.situacao,
      tipo: atual?.tipo,
    };
    if (a.precoPromocional != null) produto.preco_promocional = a.precoPromocional;
    if (a.ncm) produto.ncm = a.ncm;
    if (a.gtin) produto.gtin = a.gtin;
    if (a.descricaoComplementar) produto.descricao_complementar = a.descricaoComplementar;

    const avisos: string[] = [];
    if (a.situacao === 'I') avisos.push('O produto será inativado no Tiny.');
    if (a.preco != null && num(atual?.preco) != null && a.preco < num(atual?.preco)! * 0.5) {
      avisos.push('O novo preço é menos da metade do atual — confirme se não houve erro de digitação.');
    }

    return makePreview({
      resumo: `Atualizar o produto ${atual?.codigo ?? id} no Tiny`,
      alvo: `Tiny · produto ${atual?.codigo ?? id} (${atual?.nome ?? ''})`.trim(),
      campos: buildFieldDiff(
        {
          nome: atual?.nome, preco: atual?.preco, precoPromocional: atual?.preco_promocional,
          ncm: atual?.ncm, gtin: atual?.gtin, situacao: atual?.situacao,
          descricaoComplementar: atual?.descricao_complementar,
        },
        {
          nome: a.nome, preco: a.preco, precoPromocional: a.precoPromocional,
          ncm: a.ncm, gtin: a.gtin, situacao: a.situacao,
          descricaoComplementar: a.descricaoComplementar,
        },
        {
          nome: 'Nome', preco: 'Preço', precoPromocional: 'Preço promocional',
          ncm: 'NCM', gtin: 'GTIN/EAN', situacao: 'Situação',
          descricaoComplementar: 'Descrição complementar',
        },
      ),
      avisos,
      payload: { produtos: [{ produto }] },
    });
  },
  execute: async (ctx, _a, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: 'produto.alterar.php', body: preview.payload });
    await tinyCall(ctx, 'produto.alterar.php', { produto: JSON.stringify(preview.payload) });
    return { atualizado: true };
  },
});

interface EstoqueArgs { id?: string; sku?: string; quantidade: number; observacoes?: string }

registerTool<EstoqueArgs>({
  name: 'tiny.produto.estoque',
  provider: 'tiny',
  mode: 'write',
  description: 'Ajusta o saldo de estoque de um produto no Tiny ERP por balanço (define a quantidade absoluta, não soma).',
  schema: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      id: { type: 'string' },
      quantidade: { type: 'number', description: 'Novo saldo absoluto.' },
      observacoes: { type: 'string', description: 'Motivo do ajuste, gravado no histórico do Tiny.' },
    },
    required: ['quantidade'],
  },
  preview: async (ctx, a) => {
    const id = await resolverProdutoId(ctx, a);
    const atual = await obterProduto(ctx, id);
    const saldoAtual = num(atual?.saldo) ?? num(atual?.estoque_atual);

    const avisos: string[] = [];
    if (a.quantidade === 0) avisos.push('Saldo zerado — o produto sai de venda nos canais integrados ao Tiny.');
    avisos.push('O ajuste é por balanço: o saldo passa a ser exatamente esta quantidade, não é somado ao atual.');

    return makePreview({
      resumo: `Ajustar estoque de ${atual?.codigo ?? id} para ${a.quantidade}`,
      alvo: `Tiny · produto ${atual?.codigo ?? id} (${atual?.nome ?? ''})`.trim(),
      campos: buildFieldDiff(
        { saldo: saldoAtual ?? null },
        { saldo: a.quantidade },
        { saldo: 'Saldo em estoque' },
      ),
      avisos,
      payload: {
        estoque: {
          idProduto: id,
          tipo: 'B', // B = balanço (saldo absoluto)
          quantidade: String(a.quantidade),
          observacoes: a.observacoes ?? 'Ajuste via Agente Operacional',
        },
      },
    });
  },
  execute: async (ctx, a, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: 'produto.atualizar.estoque.php', body: preview.payload });
    await tinyCall(ctx, 'produto.atualizar.estoque.php', { estoque: JSON.stringify(preview.payload) });
    return { quantidade: a.quantidade, atualizado: true };
  },
});

registerTool({
  name: 'tiny.pedido.situacao',
  provider: 'tiny',
  mode: 'write',
  description: 'Altera a situação de um pedido no Tiny ERP (ex.: aprovado, preparando_envio, faturado, enviado, entregue, cancelado).',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id interno do pedido.' },
      situacao: {
        type: 'string',
        description: 'Nova situação.',
        enum: ['aberto', 'aprovado', 'preparando_envio', 'faturado', 'pronto_envio', 'enviado', 'entregue', 'nao_entregue', 'cancelado'],
      },
    },
    required: ['id', 'situacao'],
  },
  preview: async (ctx, a: { id: string; situacao: string }) => {
    const r = await tinyCall(ctx, 'pedido.obter.php', { id: String(a.id) });
    const pedido = r?.pedido;
    if (!pedido) throw Object.assign(new Error(`Pedido ${a.id} não encontrado no Tiny.`), { status: 404 });

    const avisos: string[] = [];
    if (a.situacao === 'cancelado') avisos.push('Cancelar um pedido é irreversível no Tiny e libera o estoque reservado.');
    if (a.situacao === 'faturado') avisos.push('Faturar pode disparar emissão de nota fiscal, conforme a configuração da conta.');

    return makePreview({
      resumo: `Mudar o pedido nº ${pedido?.numero ?? a.id} para "${a.situacao}"`,
      alvo: `Tiny · pedido ${pedido?.numero ?? a.id} · ${pedido?.nome ?? pedido?.cliente?.nome ?? ''}`.trim(),
      campos: buildFieldDiff(
        { situacao: pedido?.situacao, valor: pedido?.valor },
        { situacao: a.situacao, valor: undefined },
        { situacao: 'Situação', valor: 'Valor' },
      ),
      avisos,
      payload: { id: String(a.id), situacao: a.situacao },
    });
  },
  execute: async (ctx, a: { id: string; situacao: string }, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: 'pedido.alterar.situacao.php', body: preview.payload });
    await tinyCall(ctx, 'pedido.alterar.situacao.php', preview.payload as Record<string, string>);
    return { id: a.id, situacao: a.situacao };
  },
});

interface ContatoArgs {
  id: string;
  nome?: string;
  email?: string;
  fone?: string;
  celular?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

registerTool<ContatoArgs>({
  name: 'tiny.contato.atualizar',
  provider: 'tiny',
  mode: 'write',
  description: 'Atualiza os dados cadastrais de um contato (cliente ou fornecedor) no Tiny ERP.',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id interno do contato. Use tiny.contato.buscar para descobrir.' },
      nome: { type: 'string' },
      email: { type: 'string' },
      fone: { type: 'string' },
      celular: { type: 'string' },
      endereco: { type: 'string' },
      numero: { type: 'string' },
      bairro: { type: 'string' },
      cidade: { type: 'string' },
      uf: { type: 'string' },
      cep: { type: 'string' },
    },
    required: ['id'],
  },
  preview: async (ctx, a) => {
    const r = await tinyCall(ctx, 'contato.obter.php', { id: String(a.id) });
    const atual = r?.contato;
    if (!atual) throw Object.assign(new Error(`Contato ${a.id} não encontrado no Tiny.`), { status: 404 });

    // contato.alterar mirrors produto.alterar: it validates the record, so the
    // identifying fields are echoed and only the requested keys are replaced.
    const contato: Record<string, unknown> = {
      sequencia: 1,
      id: String(a.id),
      nome: a.nome ?? atual?.nome,
      tipo_pessoa: atual?.tipo_pessoa,
      cpf_cnpj: atual?.cpf_cnpj,
    };
    const campos = ['email', 'fone', 'celular', 'endereco', 'numero', 'bairro', 'cidade', 'uf', 'cep'] as const;
    for (const k of campos) if (a[k] !== undefined) contato[k] = a[k];

    return makePreview({
      resumo: `Atualizar o contato "${atual?.nome ?? a.id}" no Tiny`,
      alvo: `Tiny · contato ${a.id}`,
      campos: buildFieldDiff(
        {
          nome: atual?.nome, email: atual?.email, fone: atual?.fone, celular: atual?.celular,
          endereco: atual?.endereco, numero: atual?.numero, bairro: atual?.bairro,
          cidade: atual?.cidade, uf: atual?.uf, cep: atual?.cep,
        },
        {
          nome: a.nome, email: a.email, fone: a.fone, celular: a.celular,
          endereco: a.endereco, numero: a.numero, bairro: a.bairro,
          cidade: a.cidade, uf: a.uf, cep: a.cep,
        },
        {
          nome: 'Nome', email: 'E-mail', fone: 'Telefone', celular: 'Celular',
          endereco: 'Endereço', numero: 'Número', bairro: 'Bairro',
          cidade: 'Cidade', uf: 'UF', cep: 'CEP',
        },
      ),
      payload: { contatos: [{ contato }] },
    });
  },
  execute: async (ctx, a, preview) => {
    if (ctx.dryRun) return dryRunResult({ acao: 'contato.alterar.php', body: preview.payload });
    await tinyCall(ctx, 'contato.alterar.php', { contato: JSON.stringify(preview.payload) });
    return { id: a.id, atualizado: true };
  },
});
