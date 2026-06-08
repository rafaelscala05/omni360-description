import { Product, AttributeDefinition, Category } from '../types/models';
import { getEffectiveAttributes } from './categoryService';

export interface Template {
  id: string;
  name: string;
  prompt: string;
}

export const defaultTemplate: Template = {
  id: 'default',
  name: 'Padrão (E-commerce SEO)',
  prompt: `Você é um especialista em SEO e copywriting para e-commerce.

Gere conteúdo altamente detalhado, persuasivo e otimizado para o produto abaixo. O objetivo é explicar muito bem o produto, seus benefícios, casos de uso e especificações, tirando todas as dúvidas do cliente.

**Dados do produto:**
- SKU: {Código (SKU)}
- Nome: {Descrição}
- Categoria: {Categoria}
- Marca: {Marca}
- Descrição atual: {Descrição complementar}
- Preço: R$ {Preço}
- Variações disponíveis: {Variações agrupadas das filhas}

**Análise Visual (IMPORTANTE):**
Se uma imagem for fornecida junto com este prompt, analise-a detalhadamente. Identifique e descreva:
- Cores exatas e predominantes
- Texturas e materiais aparentes
- Detalhes de design, acabamento e formato
Incorpore essas características visuais de forma natural e persuasiva na descrição.

**Retorne APENAS um JSON válido, sem markdown, sem explicações, no formato:**

{
  "descricao_html": "<div class='product-description'>...</div>",
  "titulo_seo": "Título de até 60 caracteres com palavra-chave principal",
  "descricao_seo": "Meta description de até 160 caracteres, atrativa e com CTA",
  "palavras_chave": "palavra1, palavra2, palavra3, palavra4, palavra5"
}

**REGRAS para descricao_html:**
- Estrutura Rica e Detalhada: 
  <h2> [Frase de efeito sobre o produto] </h2>
  <p> [Apresentação detalhada do produto, o que é, para que serve, qual problema resolve] </p>
  <h3>Principais Benefícios</h3> <ul> [Lista com os maiores benefícios e diferenciais] </ul>
  <h3>Detalhes e Especificações</h3> <ul> [Lista de características técnicas, material, medidas, etc] </ul>
  <h3>Dicas de Uso / Como Usar</h3> <p> [Explicação de como extrair o melhor do produto no dia a dia] </p>
  <p> [Fechamento persuasivo mencionando a marca e categoria] </p>
- Seja extremamente detalhista e explicativo. Não economize nas palavras se for para agregar valor.
- 300 a 600 palavras.
- Português do Brasil, tom profissional mas acessível.
- Inclua o nome do produto e categoria como palavras-chave naturais ao longo do texto.
- Se houver variações, mencione as opções disponíveis no texto.

**REGRAS para titulo_seo:**
- Máximo 60 caracteres
- Inclua o nome do produto e marca
- Formato: "[Nome do Produto] - [Marca] | [Benefício ou Categoria]"

**REGRAS para descricao_seo:**
- Máximo 160 caracteres
- Tom convidativo com CTA implícito
- Inclua o preço ou benefício principal

**REGRAS para palavras_chave:**
- 5 a 10 keywords separadas por vírgula
- Misture: nome exato, variações de busca, categoria, marca`
};

export const generateDescriptionText = async (product: Product, categories: Category[], template: Template = defaultTemplate): Promise<any> => {
    const effectiveAttributes = product.categoryId 
      ? getEffectiveAttributes(product.categoryId, categories)
      : [];

    const response = await fetch('/api/gemini/generate-description', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product, categories, template, effectiveAttributes })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Erro de comunicação com o servidor (Status ${response.status})`);
    }

    return await response.json();
};

export const generateProductAttributes = async (product: Partial<Product>, effectiveAttributes: AttributeDefinition[]) => {
  const response = await fetch('/api/gemini/generate-attributes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ product, effectiveAttributes })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Erro ao gerar atributos via IA (Status ${response.status})`);
  }

  return await response.json();
};

export const generateAttributesFromImage = async (imageBase64: string, effectiveAttributes: AttributeDefinition[], productContext: Partial<Product> = {}) => {
  const response = await fetch('/api/gemini/generate-attributes-from-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ imageBase64, effectiveAttributes, productContext })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Erro ao analisar atributos via imagem (Status ${response.status})`);
  }

  return await response.json();
};
