import { Product, AttributeDefinition, AttributeValue, Category } from '../types/models';
import { getEffectiveAttributes } from './categoryService';
import { generateJson } from './aiService';
import { fetchAndProcessImage } from '../utils/imageUtils';
import type { Part } from 'firebase/ai';

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
- LIMITE ABSOLUTO: o valor de descricao_html deve ter no máximo 2.500 caracteres (contando as tags HTML). Respeite esse limite — corte o conteúdo se necessário, encerrando com uma tag de fechamento válida.
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

    const attrsInfo = (effectiveAttributes || []).map((attr) => {
      return `- ${attr.key} (${attr.label}): Tipo: ${attr.type}, Opções permitidas: ${attr.options?.length ? attr.options.join(', ') : 'Qualquer'}`;
    }).join('\n');

    const attributeInstructions = (effectiveAttributes || []).length > 0 ? `
PARA CADA UM DOS ATRIBUTOS ABAIXO, EXTRAIA O VALOR DO TEXTO OU IMAGEM (EM PORTUGUÊS DO BRASIL):
${attrsInfo}
Retorne-os no campo "extracted_attributes" do JSON.` : `Se identificar características importantes do produto (cor, material, tamanho, etc), sugira-os no campo "suggested_attributes" do JSON em PORTUGUÊS DO BRASIL.`;

    // Format variations
    let variacoesText = 'Nenhuma';
    if (product._children && product._children.length > 0) {
      const allVariations = product._children.map((c: any) => c['Variações']).filter(Boolean);
      variacoesText = allVariations.join(' | ');
    }

    const visualEnhancementRules = `
ESPECIFICAÇÕES VISUAIS DA DESCRIÇÃO (OBRIGATÓRIO):
1. Use HTML semântico e profissional.
2. Adicione espaçamento extra (margem superior/inferior ou quebras de linha duplas) entre parágrafos, subtítulos e PRINCIPALMENTE entre itens de lista (<li>) para melhorar drasticamente a leitura.
3. Utilize tags <h2> e <h3> para criar seções lógicas e organizadas.
4. Transforme blocos de texto denso em listas bulleted (<ul> e <li>) para facilitar a escaneabilidade.
5. O resultado deve ser visualmente limpo, com ar de e-commerce premium.

ALÉM DOS CAMPOS descricao_html, titulo_seo, descricao_seo e palavras_chave, INCLUA NO JSON:
- "extracted_attributes": objeto onde cada chave é a chave do atributo e o valor é { "value": "..." }.
- "suggested_attributes": array de { "key", "label", "value", "type" }.
${attributeInstructions}`;

    let promptText = template.prompt.replace(/{([^{}\n]+)}/g, (match: string, p1: string) => {
      let key = p1.trim();

      if (key.toLowerCase() === 'variações agrupadas das filhas') {
        return variacoesText;
      }

      if (key.toLowerCase() === 'nome') key = 'Descrição';
      if (key.toLowerCase() === 'sku') key = 'Código (SKU)';

      let val = (product as any)[key];

      if (val === undefined) {
        const foundKey = Object.keys(product).find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey) {
          val = (product as any)[foundKey];
        }
      }

      return val != null ? String(val) : '';
    });

    const parts: Part[] = [{ text: promptText + '\n\n' + visualEnhancementRules }];

    const imageUrl = product._selectedImage || product['URL imagem 1'] || product['URL imagem externa 1'];
    if (imageUrl) {
      try {
        const { base64Data, mimeType } = await fetchAndProcessImage(imageUrl);
        parts.unshift({ inlineData: { mimeType, data: base64Data } });
      } catch (e) {
        console.warn('Não foi possível carregar a imagem do produto para a descrição:', e);
      }
    }

    return await generateJson(parts, { temperature: 0.7, maxOutputTokens: 8192 });
};

export const generateProductAttributes = async (product: Partial<Product>, effectiveAttributes: AttributeDefinition[]) => {
  const currentAttributes = (product as any).attributes || {};

  const attrsInfo = (effectiveAttributes || []).map((attr) => {
    const currentValue = currentAttributes[attr.key]?.value;
    const valueStatus = currentValue ? ` (Valor atual: ${JSON.stringify(currentValue)})` : ' (Vazio/Não preenchido)';
    return `- ${attr.key} (${attr.label}): Tipo: ${attr.type}, Opções permitidas: ${attr.options?.length ? attr.options.join(', ') : 'Qualquer'}${valueStatus}`;
  }).join('\n');

  const prompt = `
Você é um assistente especialista em catálogo de e-commerce.
Sua tarefa é analisar o produto fornecido e extrair atributos com base nas definições esperadas da categoria.

Produto:
Nome: ${product['Descrição'] || ''}
Marca: ${product['Marca'] || ''}
Categoria Path: ${(product as any).categoryPath?.join(' > ') || ''}
Descrição Adicional: ${product['Descrição complementar'] || ''}

Atributos esperados para esta categoria:
${attrsInfo}

Instruções:
1. Para os atributos definidos acima que estão VAZIOS, tente extrair os valores do texto. Responda sempre em PORTUGUÊS DO BRASIL.
2. Se um atributo já possuir um "Valor atual", você só deve sugerir um novo valor se o valor atual estiver claramente errado ou incompleto.
3. Para os atributos do tipo 'select' ou 'multiselect', você DEVE escolher EXATAMENTE entre as 'Opções permitidas'. Se não tiver certeza, não sugira valor.
4. IMPORTANTE: Analise cuidadosamente as características do produto. Se você identificar características IMPORTANTES que NÃO estão na lista de atributos acima (e nem em campos como Marca, Preço, etc), sugira-os na seção "suggestedNewAttributes".
5. EVITE REDUNDÂNCIA E SINÔNIMOS: Não sugira como "novo atributo" algo que já existe na lista de atributos acima ou nos campos padrão do produto, mesmo que com nome ligeiramente diferente (ex: se já existe "Material", não sugira "Composição").
6. IDIOMA: Todos os labels e valores sugeridos devem estar em PORTUGUÊS DO BRASIL.

Retorne EXATAMENTE neste formato JSON:
{
  "attributes": {
    "ChaveDoAtributo": { "value": "ValorSugerido", "confidence": 0.95 }
  },
  "suggestedNewAttributes": [
    { "key": "material_especifico", "label": "Material Específico", "value": "Titânio", "type": "text" }
  ]
}
Responda APENAS com o objeto JSON.
`;

  return await generateJson(prompt, { temperature: 0.2, maxOutputTokens: 8192 });
};

export const generateAttributesFromImage = async (imageBase64: string, effectiveAttributes: AttributeDefinition[], productContext: Partial<Product> = {}) => {
  const currentAttributes = (productContext as any).attributes || {};

  const attrsInfo = (effectiveAttributes || []).map((attr) => {
    const currentValue = currentAttributes[attr.key]?.value;
    const valueStatus = currentValue ? ` (Valor atual: ${JSON.stringify(currentValue)})` : ' (Vazio)';
    return `- ${attr.key} (${attr.label}): Tipo: ${attr.type}, Opções permitidas: ${attr.options?.length ? attr.options.join(', ') : 'Qualquer'}${valueStatus}`;
  }).join('\n');

  const prompt = `
Você é um assistente especialista em e-commerce e análise visual.
Sua tarefa é analisar a imagem do produto e extrair atributos com base nas definições esperadas da categoria.

Nome do Produto de Referência: ${productContext['Descrição'] || ''}

Atributos esperados para esta categoria:
${attrsInfo}

Instruções:
1. Analise visualmente o produto: cor dominante, material, características.
2. Foque em preencher atributos que estão como "(Vazio)". Se já houver um "(Valor atual)", só sugira mudança se a imagem claramente mostrar algo diferente. Responda em PORTUGUÊS DO BRASIL.
3. Para atributos 'select' ou 'multiselect', escolha EXATAMENTE dentre as opções.
4. Se você identificar características visuais RELEVANTES que não estão na lista acima e nem nos campos padrão, sugira-os na seção "suggestedNewAttributes".
5. EVITE REDUNDÂNCIA E SINÔNIMOS: Não sugira atributos que já existem na lista de atributos esperados ou campos padrão, mesmo que com nomes parecidos.
6. IDIOMA: Todos os labels e valores devem estar em PORTUGUÊS DO BRASIL.

Retorne EXATAMENTE neste formato JSON:
{
  "attributes": {
    "ChaveDoAtributo": { "value": "ValorSugerido", "confidence": 0.95 }
  },
  "suggestedNewAttributes": [
    { "key": "cor_detalhe", "label": "Cor do Detalhe", "value": "Dourado", "type": "text" }
  ]
}
Responda APENAS com o objeto JSON.
`;

  const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const parts: Part[] = [
    { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
    { text: prompt },
  ];

  return await generateJson(parts, { temperature: 0.2, maxOutputTokens: 8192 });
};

export async function suggestProductAttributes(
  product: Partial<Product>,
  effectiveAttributes: AttributeDefinition[],
): Promise<{ attributes: Record<string, AttributeValue>; suggestedNewAttributes: AttributeDefinition[] }> {
  const attributes: Record<string, AttributeValue> = {};
  let suggestedNewAttributes: AttributeDefinition[] = [];

  try {
    const textResult = await generateProductAttributes(product, effectiveAttributes);
    if (textResult.attributes) {
      Object.keys(textResult.attributes).forEach((key) => {
        attributes[key] = { value: textResult.attributes[key].value, confirmed: false, aiSuggested: true, source: 'ai' };
      });
    }
    if (textResult.suggestedNewAttributes) {
      suggestedNewAttributes = [...suggestedNewAttributes, ...textResult.suggestedNewAttributes];
    }
  } catch (e) {
    console.error('Erro na análise de texto:', e);
  }

  const imageUrl = product._selectedImage || product['URL imagem 1'];
  if (imageUrl) {
    try {
      let base64 = imageUrl;
      if (!base64.startsWith('data:')) {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const blob = await response.blob();
          base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      }
      if (base64.startsWith('data:')) {
        const imageResult = await generateAttributesFromImage(base64, effectiveAttributes, product);
        if (imageResult.attributes) {
          Object.keys(imageResult.attributes).forEach((key) => {
            attributes[key] = { value: imageResult.attributes[key].value, confirmed: false, aiSuggested: true, source: 'ai' };
          });
        }
        if (imageResult.suggestedNewAttributes) {
          suggestedNewAttributes = [...suggestedNewAttributes, ...imageResult.suggestedNewAttributes];
        }
      }
    } catch (e) {
      console.error('Erro na análise de imagem:', e);
    }
  }

  const uniqueSuggested = suggestedNewAttributes.reduce<AttributeDefinition[]>((acc, curr) => {
    if (!acc.find((a) => a.key === curr.key)) acc.push(curr);
    return acc;
  }, []);

  return { attributes, suggestedNewAttributes: uniqueSuggested };
}
