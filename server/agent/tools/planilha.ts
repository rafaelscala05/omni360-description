// Planilha pelo chat: exportar o catálogo (o mesmo arquivo do botão, montado
// por src/services/exportPlanilha.ts) e resumir o que chegou incompleto na
// última importação. As duas são leitura — não mudam o catálogo: a exportação
// grava só o arquivo, em users/{uid}/exports/, com link de download.

import * as XLSX from 'xlsx';
import crypto from 'node:crypto';
import firebaseAppletConfig from '../../../firebase-applet-config.json';
import { adminDb, adminStorage } from '../../firebaseAdmin';
import { registerTool } from '../registry';
import { lerCatalogo } from '../produtosGeracao';
import { buscarProdutos, resumoChegada } from '../produtosRules';
import { montarExportacao, type ModeloExportacao } from '../../../src/services/exportPlanilha';
import type { Product } from '../../../src/types/models';

const STORAGE_BUCKET = firebaseAppletConfig.storageBucket;

registerTool<{ modelo?: ModeloExportacao; skus?: string[] }>({
  name: 'produtos.planilha.exportar',
  provider: 'produtos',
  mode: 'read',
  description: 'Exporta o catálogo do OMNI360 numa planilha .xlsx — a mesma do botão Exportar. modelo "standard" mantém as colunas da planilha original e acrescenta descrição, SEO, imagens e atributos; "tinyerp" usa o layout fixo de importação do Tiny. Sem "skus", exporta o catálogo inteiro. Devolve o link de download: mande-o ao usuário como link em markdown.',
  schema: {
    type: 'object',
    properties: {
      modelo: { type: 'string', enum: ['standard', 'tinyerp'], description: 'Padrão: standard.' },
      skus: { type: 'array', items: { type: 'string' }, description: 'Só estes SKUs (opcional).' },
    },
  },
  read: async (ctx, a) => {
    const modelo: ModeloExportacao = a.modelo === 'tinyerp' ? 'tinyerp' : 'standard';
    const catalogo = await lerCatalogo(ctx.uid);
    const produtos = a.skus?.length ? buscarProdutos(catalogo, { skus: a.skus }).achados : catalogo;
    if (!produtos.length) throw Object.assign(new Error('Nenhum produto para exportar.'), { status: 404 });
    const ajustes = await adminDb.collection('users').doc(ctx.uid).collection('settings').doc('excel').get().catch(() => null);
    const originalHeaders = (ajustes?.data()?.originalHeaders as string[] | undefined) ?? [];
    const { linhas, cabecalhos } = montarExportacao(produtos as unknown as Product[], modelo, originalHeaders);

    const ws = XLSX.utils.json_to_sheet(linhas, cabecalhos ? { header: cabecalhos } : undefined);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha 1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const data = new Date().toISOString().split('T')[0];
    const nome = `produtos_exportacao_${modelo === 'tinyerp' ? 'TinyERP' : 'Padrao'}_${data}.xlsx`;
    const caminho = `users/${ctx.uid}/exports/${Date.now()}_${nome}`;
    const token = crypto.randomUUID();
    await adminStorage.bucket(STORAGE_BUCKET).file(caminho).save(buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      resumable: false,
      metadata: { contentDisposition: `attachment; filename="${nome}"`, metadata: { firebaseStorageDownloadTokens: token } },
    });
    return {
      arquivo: nome,
      produtos: produtos.length,
      modelo,
      link: `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(caminho)}?alt=media&token=${token}`,
    };
  },
});

registerTool<{ dias?: number }>({
  name: 'produtos.importacao.resumo',
  provider: 'produtos',
  mode: 'read',
  description: 'Resume o que chegou ao catálogo recentemente (planilha, links, ERP) e o que veio incompleto — sem descrição, foto, SEO, SKU, preço ou categoria —, com exemplos. Use depois de uma importação, ou quando o usuário perguntar "o que chegou incompleto". As pendências também viram tarefas na semana; ofereça completar descrições/atributos/ambientadas com as ferramentas de lote.',
  schema: {
    type: 'object',
    properties: { dias: { type: 'integer', description: 'Janela, em dias (padrão 7, máx. 90).' } },
  },
  read: async (ctx, a) => {
    const dias = Math.min(90, Math.max(1, Math.floor(a.dias ?? 7)));
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    return { dias, ...resumoChegada(await lerCatalogo(ctx.uid), desde) };
  },
});
