export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
  path: string[];
  pathIds: string[];
  attributes: AttributeDefinition[];
  inheritParentAttributes: boolean;
  imagePrompts?: {
    scene1?: string;
    scene2?: string;
    scene3?: string;
  };
  inheritImagePrompts: boolean;
  productCount: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AttributeType = "text" | "select" | "multiselect" | "checkbox" | "number" | "boolean";

export interface AttributeDefinition {
  id: string;
  key: string;
  label: string;
  type: AttributeType;
  options: string[];
  required: boolean;
  inherited?: boolean;
  inheritedFrom?: string | null;
  order: number;
  aiSuggested: boolean;
  createdAt: string;
}

export interface AttributeValue {
  value: string | string[];
  aiSuggested: boolean;
  confirmed: boolean;
  source: "manual" | "ai" | "imported";
}

export interface AttributePattern {
  id: string;
  name: string;
  attributes: AttributeDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  // Common / Export Columns
  'ID'?: string;
  'Código (SKU)'?: string;
  'Descrição'?: string;
  'Unidade'?: string;
  'NCM (Classificação fiscal)'?: string;
  'Origem'?: string;
  'Preço'?: string | number;
  'Valor IPI fixo'?: string | number;
  'Observações'?: string;
  'Situação'?: string;
  'Estoque'?: string | number;
  'Preço de custo'?: string | number;
  'Cód do fornecedor'?: string;
  'Fornecedor'?: string;
  'Localização'?: string;
  'Estoque máximo'?: string | number;
  'Estoque mínimo'?: string | number;
  'Peso líquido (Kg)'?: string | number;
  'Peso bruto (Kg)'?: string | number;
  'GTIN/EAN'?: string;
  'GTIN/EAN tributável'?: string;
  'Descrição complementar'?: string;
  'CEST'?: string;
  'Código de Enquadramento IPI'?: string;
  'Formato embalagem'?: string;
  'Largura embalagem'?: string | number;
  'Altura Embalagem'?: string | number;
  'Comprimento embalagem'?: string | number;
  'Diâmetro embalagem'?: string | number;
  'Tipo do produto'?: string;
  'URL imagem 1'?: string;
  'URL imagem 2'?: string;
  'URL imagem 3'?: string;
  'URL imagem 4'?: string;
  'URL imagem 5'?: string;
  'URL imagem 6'?: string;
  'Categoria'?: string; // String category from spreadsheet
  'Código do pai'?: string;
  'Variações'?: string;
  'Marca'?: string;
  'Garantia'?: string;
  'Sob encomenda'?: string;
  'Preço promocional'?: string | number;
  'URL imagem externa 1'?: string;
  'URL imagem externa 2'?: string;
  'URL imagem externa 3'?: string;
  'URL imagem externa 4'?: string;
  'URL imagem externa 5'?: string;
  'URL imagem externa 6'?: string;
  'Link do vídeo'?: string;
  'Título SEO'?: string;
  'Descrição SEO'?: string;
  'Palavras chave SEO'?: string;
  'Slug'?: string;
  'Dias para preparação'?: string | number;
  'Controlar lotes'?: string;
  'Unidade por caixa'?: string | number;
  'URL imagem externa 7'?: string;
  'URL imagem externa 8'?: string;
  'URL imagem externa 9'?: string;
  'URL imagem externa 10'?: string;
  'Markup'?: string | number;
  'Permitir inclusão nas vendas'?: string;
  'EX TIPI'?: string;
  
  // Internal fields
  _id: string;
  _statusDescricao: 'Sem descrição' | 'Descrição original' | 'Gerado por IA' | 'Erro';
  _statusSEO: 'Sem SEO' | 'Gerado por IA' | 'Erro';
  _isGenerating?: boolean;
  _isEnriching?: boolean;
  _enrichmentLog?: string;
  _generationLog?: string;
  _generationError?: string;
  _tokenUsage?: {
    enrichment?: { promptTokens: number; completionTokens: number; totalTokens: number };
    generation?: { promptTokens: number; completionTokens: number; totalTokens: number };
    images?: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  _originalRow?: any;
  _children?: Product[];
  _selectedImage?: string;
  _ambientImages?: string[];
  _isDirty?: boolean;
  _videoScript?: import('../services/videoService').VideoScript;
  _videoJobId?: string;
  _videoStatus?: 'idle' | 'generating_script' | 'script_ready' | 'queued' | 'processing' | 'done' | 'error';
  _videoUrl?: string;
  _videoSelectedImage?: string;
  _videoError?: string;

  // Wake Commerce integration
  _wakeProductId?: string;      // produtoId na Wake — chave de merge
  _wakeInformacaoId?: number;   // informacaoId do bloco de descrição na Wake
  _wakeVersionId?: string;      // id da última versão salva em wake_versions

  // Modulo 1 / 3
  categoryId?: string; // FK to actual Category
  categoryPath?: string[]; // cache of path
  attributes?: {
    [attributeKey: string]: AttributeValue;
  };
  isParent?: boolean;
  parentId?: string | null;
  variantAttributes?: string[]; // ex: ['Cor', 'Tamanho']
  variantValues?: { [key: string]: string }; // ex: { 'Cor': 'Azul', 'Tamanho': 'M'}
}

export type ProductModalTab = 'geral' | 'atributos' | 'tecnico' | 'ia' | 'imagem' | 'video' | 'simular';

export interface ProductStatusFlags {
  descricaoGerada: boolean;
  enriquecido: boolean;
  imagensGeradas: boolean;
  atributosGerados: boolean;
  salvo: boolean;
  erro: boolean;
}

/**
 * Fonte única da verdade para o estado de processamento de um produto.
 * Reutilizado na listagem, nos filtros e no modal do produto.
 */
export function getProductStatusFlags(p: Product): ProductStatusFlags {
  const atributosGerados = Object.values(p.attributes ?? {}).some(a => {
    const v = a?.value;
    return Array.isArray(v) ? v.length > 0 : !!v;
  });

  return {
    descricaoGerada: p._statusDescricao === 'Gerado por IA',
    enriquecido: !!p._enrichmentLog,
    imagensGeradas: (p._ambientImages?.length ?? 0) > 0,
    atributosGerados,
    salvo: !p._isDirty,
    erro:
      !!p._generationError ||
      p._statusDescricao === 'Erro' ||
      p._statusSEO === 'Erro',
  };
}
