// Montagem da planilha de exportação (modelos Padrão e TinyERP). Pura e sem
// DOM: o botão de exportar (App.tsx) e o Alfred (produtos.planilha.exportar,
// no servidor) usam as mesmas linhas e cabeçalhos — a planilha que o chat
// entrega é a mesma do botão.

import type { Product } from '../types/models';

export type ModeloExportacao = 'standard' | 'tinyerp';

export const TINY_ERP_HEADERS = [
  'ID', 'Código (SKU)', 'Descrição', 'Unidade', 'Classificação fiscal', 'Origem', 'Preço', 'Valor IPI fixo', 'Observações', 'Situação', 'Estoque', 'Preço de custo', 'Cód do Fornecedor', 'Fornecedor', 'Localização', 'Estoque máximo', 'Estoque mínimo', 'Peso líquido (Kg)', 'Peso bruto (Kg)', 'GTIN/EAN', 'GTIN/EAN tributável', 'Descrição complementar', 'CEST', 'Código de Enquadramento IPI', 'Formato embalagem', 'Largura embalagem', 'Altura embalagem', 'Comprimento embalagem', 'Diâmetro embalagem', 'Tipo do produto', 'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5', 'URL imagem 6', 'Categoria', 'Código do pai', 'Variações', 'Marca', 'Garantia', 'Sob encomenda', 'Preço promocional', 'URL imagem externa 1', 'URL imagem externa 2', 'URL imagem externa 3', 'URL imagem externa 4', 'URL imagem externa 5', 'URL imagem externa 6', 'Link do vídeo', 'Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'Slug', 'Dias para preparação', 'Controlar lotes', 'Unidade por caixa', 'URL imagem externa 7', 'URL imagem externa 8', 'URL imagem externa 9', 'URL imagem externa 10', 'Markup', 'Permitir inclusão nas vendas', 'EX TIPI'
];

/** Atributo de múltipla escolha vira "a;b;c" na planilha. */
export const serializarMultiplo = (arr: string[]): string => (Array.isArray(arr) ? arr.join(';') : '');

function sanitizarLinha(row: Record<string, unknown>, nullableFields: string[]) {
  const sanitized = { ...row };
  nullableFields.forEach((field) => {
    if (sanitized[field] === null || sanitized[field] === undefined || sanitized[field] === '') sanitized[field] = '';
  });
  return sanitized;
}

/** Uma linha da planilha para um produto. */
export function linhaExportacao(prod: Product, modelo: ModeloExportacao): Record<string, unknown> {
  let row: any = {};
  if (modelo === 'tinyerp') {
    TINY_ERP_HEADERS.forEach(header => {
      row[header] = '';

      // Map common fields
      if (header === 'ID') row[header] = prod['ID'] || '';
      if (header === 'Código (SKU)') row[header] = prod['Código (SKU)'] || '';
      if (header === 'Descrição') row[header] = prod['Descrição'] || '';
      if (header === 'Unidade') row[header] = prod['Unidade'] || '';
      if (header === 'Classificação fiscal') row[header] = prod['Classificação fiscal'] || prod['NCM (Classificação fiscal)'] || '';
      if (header === 'Origem') row[header] = prod['Origem'] || '0';
      if (header === 'Preço') row[header] = prod['Preço'] || '';
      if (header === 'Valor IPI fixo') row[header] = prod['Valor IPI fixo'] || '';
      if (header === 'Observações') row[header] = prod['Observações'] || '';
      if (header === 'Situação') row[header] = prod['Situação'] || 'Ativo';
      if (header === 'Estoque') row[header] = prod['Estoque'] || '0';
      if (header === 'Preço de custo') row[header] = prod['Preço de custo'] || '';
      if (header === 'Cód do Fornecedor') row[header] = prod['Cód do Fornecedor'] || '';
      if (header === 'Fornecedor') row[header] = prod['Fornecedor'] || '';
      if (header === 'Localização') row[header] = prod['Localização'] || '';
      if (header === 'Estoque máximo') row[header] = prod['Estoque máximo'] || '';
      if (header === 'Estoque mínimo') row[header] = prod['Estoque mínimo'] || '';
      if (header === 'Peso líquido (Kg)') row[header] = prod['Peso líquido (Kg)'] || '';
      if (header === 'Peso bruto (Kg)') row[header] = prod['Peso bruto (Kg)'] || '';
      if (header === 'GTIN/EAN') row[header] = prod['GTIN/EAN'] || '';
      if (header === 'GTIN/EAN tributável') row[header] = prod['GTIN/EAN tributável'] || '';
      if (header === 'Descrição complementar') row[header] = prod['Descrição complementar'] || '';
      if (header === 'CEST') row[header] = prod['CEST'] || '';
      if (header === 'Código de Enquadramento IPI') row[header] = prod['Código de Enquadramento IPI'] || '';
      if (header === 'Formato embalagem') row[header] = prod['Formato embalagem'] || '';
      if (header === 'Largura embalagem') row[header] = prod['Largura embalagem'] || '';
      if (header === 'Altura embalagem') row[header] = prod['Altura embalagem'] || prod['Altura Embalagem'] || '';
      if (header === 'Comprimento embalagem') row[header] = prod['Comprimento embalagem'] || '';
      if (header === 'Diâmetro embalagem') row[header] = prod['Diâmetro embalagem'] || '';
      if (header === 'Tipo do produto') row[header] = prod['Tipo do produto'] || 'P';
      if (header === 'Categoria') row[header] = prod['Categoria'] || '';
      if (header === 'Código do pai') row[header] = prod['Código do pai'] || '';
      if (header === 'Variações') row[header] = prod['Variações'] || '';
      if (header === 'Marca') row[header] = prod['Marca'] || '';
      if (header === 'Garantia') row[header] = prod['Garantia'] || '';
      if (header === 'Sob encomenda') row[header] = prod['Sob encomenda'] || 'N';
      if (header === 'Preço promocional') row[header] = prod['Preço promocional'] || '';
      if (header === 'Link do vídeo') row[header] = prod['Link do vídeo'] || '';
      if (header === 'Título SEO') row[header] = prod['Título SEO'] || '';
      if (header === 'Descrição SEO') row[header] = prod['Descrição SEO'] || '';
      if (header === 'Palavras chave SEO') row[header] = prod['Palavras chave SEO'] || '';
      if (header === 'Slug') row[header] = prod['Slug'] || '';
      if (header === 'Dias para preparação') row[header] = prod['Dias para preparação'] || '';
      if (header === 'Controlar lotes') row[header] = prod['Controlar lotes'] || 'N';
      if (header === 'Unidade por caixa') row[header] = prod['Unidade por caixa'] || '';
      if (header === 'Markup') row[header] = prod['Markup'] || '';
      if (header === 'Permitir inclusão nas vendas') row[header] = prod['Permitir inclusão nas vendas'] || 'S';
      if (header === 'EX TIPI') row[header] = prod['EX TIPI'] || '';

      // Map Images
      if (header === 'URL imagem 1') {
        row[header] = prod._selectedImage?.startsWith('data:') ? '[Imagem Base64]' : (prod._selectedImage || prod['URL imagem 1'] || '');
      }
      for (let i = 2; i <= 6; i++) {
        if (header === `URL imagem ${i}`) {
          const ambientImg = prod._ambientImages?.[i - 2];
          row[header] = ambientImg?.startsWith('data:') ? '[Imagem Base64]' : (ambientImg || prod[`URL imagem ${i}` as keyof Product] || '');
        }
      }
      for (let i = 1; i <= 10; i++) {
        if (header === `URL imagem externa ${i}`) {
          row[header] = prod[`URL imagem externa ${i}` as keyof Product] || '';
        }
      }
    });
  } else {
    // Standard System Model
    row = { ...prod._originalRow };
    // Código (SKU) precisa vir do produto atual: produtos sem _originalRow
    // (ex.: importados da Wake) não têm essa chave e o export ficava sem a coluna.
    row['Código (SKU)'] = prod['Código (SKU)'] || row['Código (SKU)'] || '';
    // Update with generated fields
    row['Descrição complementar'] = prod['Descrição complementar'] || row['Descrição complementar'] || '';
    row['Título SEO'] = prod['Título SEO'] || row['Título SEO'];
    row['Descrição SEO'] = prod['Descrição SEO'] || row['Descrição SEO'];
    row['Palavras chave SEO'] = prod['Palavras chave SEO'] || row['Palavras chave SEO'];

    // Update with enriched fields
    row['GTIN/EAN'] = prod['GTIN/EAN'] || row['GTIN/EAN'];
    row['NCM (Classificação fiscal)'] = prod['NCM (Classificação fiscal)'] || row['NCM (Classificação fiscal)'];
    row['Peso bruto (Kg)'] = prod['Peso bruto (Kg)'] || row['Peso bruto (Kg)'];
    row['Largura embalagem'] = prod['Largura embalagem'] || row['Largura embalagem'];
    row['Altura Embalagem'] = prod['Altura Embalagem'] || row['Altura Embalagem'];
    row['Comprimento embalagem'] = prod['Comprimento embalagem'] || row['Comprimento embalagem'];

    // Update with images
    if (prod._selectedImage) {
      row['URL imagem 1'] = prod._selectedImage.startsWith('data:') ? '[Imagem Base64]' : prod._selectedImage;
    }
    if (prod._ambientImages && prod._ambientImages.length > 0) {
      prod._ambientImages.forEach((img, idx) => {
        const colName = `URL imagem ${idx + 2}`;
        if (idx + 2 <= 5) {
          row[colName] = img.startsWith('data:') ? '[Imagem Base64]' : img;
        }
      });
    }
  }

  // Apply modulo 4.3 - Atributos Dinâmicos na Exportação
  // O modelo TinyERP possui um schema de colunas fixo: atributos dinâmicos
  // adicionados aqui quebram a importação no Tiny, então são omitidos.
  if (modelo !== 'tinyerp' && prod.attributes) {
    Object.entries(prod.attributes).forEach(([key, attr]) => {
      if (Array.isArray(attr.value)) {
        row[key] = serializarMultiplo(attr.value);
      } else {
        row[key] = attr.value;
      }
    });
  }

  return sanitizarLinha(row, ['ID']);
}

/** Cabeçalhos: o schema fixo do Tiny, ou os do arquivo original + colunas geradas + atributos. */
export function cabecalhosExportacao(produtos: Product[], modelo: ModeloExportacao, originalHeaders: string[]): string[] | undefined {
  if (modelo === 'tinyerp') return [...TINY_ERP_HEADERS];
  if (!originalHeaders.length) return undefined;
  const headers = [...originalHeaders];
  if (!headers.includes('Código (SKU)')) headers.unshift('Código (SKU)');
  for (const col of ['Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'URL imagem 1', 'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5']) {
    if (!headers.includes(col)) headers.push(col);
  }
  // Atributos dinâmicos (nunca no modelo TinyERP, cujo schema é fixo).
  for (const p of produtos) {
    for (const k of Object.keys(p.attributes ?? {})) if (!headers.includes(k)) headers.push(k);
  }
  return headers;
}

/** Linhas + cabeçalhos — variações já são entradas próprias do catálogo (ligadas por 'Código do pai'). */
export function montarExportacao(produtos: Product[], modelo: ModeloExportacao, originalHeaders: string[]) {
  return { linhas: produtos.map((p) => linhaExportacao(p, modelo)), cabecalhos: cabecalhosExportacao(produtos, modelo, originalHeaders) };
}
