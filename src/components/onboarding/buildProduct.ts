// Conversão do formulário de cadastro em Product, e o casamento do breadcrumb
// raspado com as categorias do usuário.
//
// Extraídos de ProductUrlImportModal para serem compartilhados com a Missão
// Produto — os dois caminhos precisam produzir exatamente o mesmo formato.

import type { Category, Product } from '../../types/models';
import type { ProductFormValue } from './ProductFormFields';

function normalizeForCompare(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Tenta casar o segmento mais específico do breadcrumb extraído da página
// (ex.: "Travesseiro" de ["Cama", "Travesseiro"]) contra o nome-folha de
// alguma categoria já existente do usuário.
export function matchExistingCategory(breadcrumb: string[] | undefined, categories: Category[]): Category | undefined {
  if (!breadcrumb?.length) return undefined;
  for (let i = breadcrumb.length - 1; i >= 0; i--) {
    const target = normalizeForCompare(breadcrumb[i]);
    const match = categories.find((c) => normalizeForCompare(c.path[c.path.length - 1] ?? '') === target);
    if (match) return match;
  }
  return undefined;
}

export function buildProduct(form: ProductFormValue, categories: Category[]): Product {
  const category = categories.find((c) => c.id === form.categoryId);
  return {
    _id: `prod_url_${Date.now()}`,
    _statusDescricao: 'Sem descrição',
    _statusSEO: 'Sem SEO',
    _isDirty: true,
    _selectedImage: form.imageUrl,
    'Descrição': form.title,
    'Descrição complementar': form.description || undefined,
    'Categoria': category?.path.join(' > '),
    categoryId: form.categoryId || undefined,
    categoryPath: category?.path,
    'Preço': form.price || undefined,
    'URL imagem externa 1': form.imageUrl,
  };
}
