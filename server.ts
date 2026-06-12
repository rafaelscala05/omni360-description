import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { GoogleGenAI, Type, ThinkingLevel, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lazy-initialized Gemini API client with telemetry header and dynamic key-refresh check
let aiClient: GoogleGenAI | null = null;
let vertexClient: GoogleGenAI | null = null;
let lastUsedApiKey: string | null = null;

function getVertexClient(): GoogleGenAI {
  if (!vertexClient) {
    const projectId = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    
    if (!projectId) {
      throw new Error("A variável de ambiente VERTEX_PROJECT_ID não está configurada. É necessária para usar a API do Vertex AI.");
    }
    
    vertexClient = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: location,
    });
  }
  return vertexClient;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey || apiKey.trim() === '') {
    console.error(`[DEBUG] GEMINI_API_KEY is ${apiKey === undefined ? 'undefined' : 'empty'}`);
    throw new Error("Chave de API não configurada. A variável GEMINI_API_KEY está vazia. Por favor, acesse o menu 'Settings' (Configurações) > 'Secrets' (Segredos) e insira sua chave do Gemini, ou adicione no arquivo .env se estiver rodando localmente.");
  }
  
  // Remove any spaces and surrounding quotes that might have been accidentally pasted
  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');
  console.log(`[DEBUG] GEMINI_API_KEY is configured. Length: ${trimmedKey.length}, Starts with: ${trimmedKey.substring(0, 4)}...`);
  
  if (!aiClient || lastUsedApiKey !== trimmedKey) {
    aiClient = new GoogleGenAI({
      apiKey: trimmedKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    lastUsedApiKey = trimmedKey;
  }
  return aiClient;
}

// Helper function to call the Gemini API with automatic retry and model fallback (e.g. on 503 high demand error)
async function generateContentWithFallback(params: {
  model: string;
  contents: any;
  config?: any;
}): Promise<any> {
  let primaryModel = params.model || 'gemini-2.5-flash';
  // If the user requested a specific image model, don't override it with text models
  const isSpecialModel = primaryModel.includes('image') || primaryModel.includes('flash-8b');
  const fallbackModel = isSpecialModel ? primaryModel : 'gemini-2.5-flash';
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    attempts++;
    const currentModel = (!isSpecialModel && attempts === maxAttempts) ? fallbackModel : primaryModel;
    try {
      const client = getGeminiClient();
      console.log(`[DEBUG] Calling Gemini. Model: ${currentModel}, Attempt: ${attempts}/${maxAttempts}`);
      return await client.models.generateContent({
        ...params,
        model: currentModel
      });
    } catch (error: any) {
      const errorStr = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
      const is503 = errorStr.includes("503") || 
                    errorStr.includes("UNAVAILABLE") || 
                    errorStr.includes("high demand") || 
                    errorStr.includes("temporarily") ||
                    (error.status && error.status === 503) ||
                    (error.code && error.code === 503);
                    
      console.warn(`[DEBUG] Attempt ${attempts}/${maxAttempts} failed. is503: ${is503}. Error: ${errorStr}`);
      
      if (is503 && attempts < maxAttempts) {
        const delay = attempts * 1000;
        console.log(`[DEBUG] Model is under high demand (503). Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
}

// Intercepts and parses Gemini API core errors to provide clear settings-based feedback
function handleGeminiError(error: any): string {
  const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
  if (errorMsg.includes("Chave de API não configurada")) {
    return errorMsg;
  }
  if (errorMsg.includes("429") && errorMsg.includes("quota")) {
    return "O limite de requisições da sua chave (Quota) foi excedido ou você está sem saldo no Google AI Studio. Verifique os limites da sua conta.";
  }
  if (
    errorMsg.includes("API key not valid") || 
    errorMsg.includes("API_KEY_INVALID") || 
    (errorMsg.includes("400") && errorMsg.includes("key"))
  ) {
    return "A chave de API que você forneceu não é válida. O servidor do Google a recusou. Certifique-se de não estar copiando a chave do Firebase por engano, não deixe espaços, e verifique a aba 'Settings' > 'Secrets'.";
  }
  if (errorMsg.includes("INVALID_ARGUMENT") && !errorMsg.includes("API key not valid")) {
    return "Falha ao processar com a IA. Argumento ou dados inválidos enviados à API. " + errorMsg;
  }
  return errorMsg || "Erro desconhecido ao processar IA.";
}

// Normalizer for image MIME types to guarantee compatible and standard strings for Gemini
function normalizeMimeType(mimeType: string, url: string): string {
  if (!mimeType) return 'image/jpeg';
  
  // Clean the mime-type string by converting to lowercase and stripping semicolon parameters
  let cleanMime = mimeType.split(';')[0].trim().toLowerCase();

  // Map of common image extensions to standard mime-types
  const extMap: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'heic': 'image/heic',
    'heif': 'image/heif'
  };

  // If MIME type is generic "image", invalid, or not starting with "image/", try to infer from extension
  const hasValidFormat = cleanMime.startsWith('image/') && cleanMime.includes('/') && cleanMime.split('/')[1].length > 0;
  
  if (!hasValidFormat || cleanMime === 'image/octet-stream' || cleanMime === 'image') {
    try {
      const parsedUrl = new URL(url);
      const ext = path.extname(parsedUrl.pathname).toLowerCase().replace('.', '');
      if (extMap[ext]) {
        return extMap[ext];
      }
    } catch (e) {
      // If URL parsing fails, check if the string itself ends with an extension
      const lastDot = url.lastIndexOf('.');
      if (lastDot !== -1) {
        const ext = url.slice(lastDot + 1).toLowerCase();
        if (extMap[ext]) {
          return extMap[ext];
        }
      }
    }
  }

  // If we still have an invalid or generic 'image' or something without a slash, default to 'image/jpeg'
  if (!cleanMime.startsWith('image/') || cleanMime === 'image') {
    return 'image/jpeg';
  }

  // Standardize "image/jpg" -> "image/jpeg"
  if (cleanMime === 'image/jpg') {
    return 'image/jpeg';
  }

  return cleanMime;
}

// Helper function to fetch an external image URL and convert it to base64 structure
async function fetchImageAsBase64(url: string): Promise<{ mimeType: string, data: string } | null> {
  try {
    // 1. Detect if it's a local upload path or local URL pointing to uploads
    let localPath: string | null = null;
    const processCwd = process.cwd();
    
    // If it's a relative path starting with /uploads or uploads
    if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
      const cleanRelativePath = url.startsWith('/') ? url.slice(1) : url;
      localPath = path.join(processCwd, cleanRelativePath);
    } 
    // If it contains /uploads/ (like a full URL pointing to our local uploads)
    else if (url.includes('/uploads/')) {
      const uploadsIndex = url.indexOf('/uploads/');
      const relativePart = url.substring(uploadsIndex + 1); // "uploads/..."
      localPath = path.join(processCwd, relativePart);
    }

    if (localPath && fs.existsSync(localPath)) {
      const buffer = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase().replace('.', '');
      const rawMimeType = ext ? `image/${ext}` : 'image/jpeg';
      const mimeType = normalizeMimeType(rawMimeType, url);
      return {
        mimeType,
        data: buffer.toString('base64')
      };
    }

    // 2. Otherwise fetch the external image URL
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const rawMimeType = response.headers.get('content-type') || 'image/jpeg';
    const mimeType = normalizeMimeType(rawMimeType, url);
    return {
      mimeType,
      data: buffer.toString('base64')
    };
  } catch (e) {
    console.error("fetchImageAsBase64 error:", e);
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Serve uploads directory directly
  app.use('/uploads', express.static(uploadsDir));

  // API routes FIRST
  
  // 1. Generate Description
  app.post("/api/gemini/generate-description", async (req, res) => {
    try {
      const { product, template, effectiveAttributes } = req.body;

      const attrsInfo = (effectiveAttributes || []).map((attr: any) => {
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
${attributeInstructions}`;

      let promptText = template.prompt.replace(/{([^{}\n]+)}/g, (match: string, p1: string) => {
        let key = p1.trim();
        
        if (key.toLowerCase() === 'variações agrupadas das filhas') {
          return variacoesText;
        }
        
        if (key.toLowerCase() === 'nome') key = 'Descrição';
        if (key.toLowerCase() === 'sku') key = 'Código (SKU)';
        
        let val = product[key];
        
        if (val === undefined) {
          const foundKey = Object.keys(product).find(k => k.toLowerCase() === key.toLowerCase());
          if (foundKey) {
            val = product[foundKey];
          }
        }
        
        return val != null ? String(val) : '';
      });

      const parts: any[] = [{ text: promptText + "\n\n" + visualEnhancementRules }];

      const imageUrl = product._selectedImage || product['URL imagem 1'] || product['URL imagem externa 1'];
      if (imageUrl) {
        const imgData = await fetchImageAsBase64(imageUrl);
        if (imgData) {
          parts.unshift({
            inlineData: {
              mimeType: imgData.mimeType,
              data: imgData.data
            }
          });
        }
      }

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: { 
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              descricao_html: { type: Type.STRING },
              titulo_seo: { type: Type.STRING },
              descricao_seo: { type: Type.STRING },
              palavras_chave: { type: Type.STRING },
              extracted_attributes: {
                type: Type.OBJECT,
                description: "Atributos extraídos com base na definição da categoria.",
                properties: {},
                additionalProperties: {
                  type: Type.OBJECT,
                  properties: {
                    value: { type: Type.STRING }
                  }
                }
              },
              suggested_attributes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    label: { type: Type.STRING },
                    value: { type: Type.STRING },
                    type: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["descricao_html", "titulo_seo", "descricao_seo", "palavras_chave"]
          }
        }
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error("Backend error generating description:", error.message || error);
      res.status(500).json({ error: handleGeminiError(error) });
    }
  });

  // 2. Generate Product Attributes (Text-based)
  app.post("/api/gemini/generate-attributes", async (req, res) => {
    try {
      const { product, effectiveAttributes } = req.body;
      const currentAttributes = product.attributes || {};

      const attrsInfo = (effectiveAttributes || []).map((attr: any) => {
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
Categoria Path: ${product.categoryPath?.join(' > ') || ''}
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

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          temperature: 0.2
        }
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error("Backend error generating attributes:", error.message || error);
      res.status(500).json({ error: handleGeminiError(error) });
    }
  });

  // 3. Generate Attributes From Image
  app.post("/api/gemini/generate-attributes-from-image", async (req, res) => {
    try {
      const { imageBase64, effectiveAttributes, productContext } = req.body;
      const currentAttributes = productContext.attributes || {};

      const attrsInfo = (effectiveAttributes || []).map((attr: any) => {
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

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash',
        contents: [
          { inlineData: { mimeType: "image/jpeg", data: base64Data } },
          prompt
        ],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          temperature: 0.2
        }
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error("Backend error generating attributes from image:", error.message || error);
      res.status(500).json({ error: handleGeminiError(error) });
    }
  });

  // 4. Generate Category Hierarchy
  app.post("/api/gemini/generate-category-hierarchy", async (req, res) => {
    try {
      const { categories, segment } = req.body;

      const prompt = `
Você é um especialista em arquitetura de dados e e-commerce.
Os usuários importaram a seguinte lista plana de categorias extraídas de uma planilha:
[${categories.join(', ')}]

${segment ? `O segmento do negócio é: ${segment}` : ''}

Sua tarefa é organizar e enriquecer essas categorias em uma estrutura lógica (pai/filho).

Diretrizes:
1. Agrupe categorias semelhantes hierarquicamente.
2. Sugira subcategorias adicionais relevantes se fizer sentido.
3. Tente reaproveitar os nomes exatos passados, organizando na propriedade "hierarchy".
4. Mantenha os níveis rasos (máximo de 3 níveis).

Retorne os dados em formato JSON estrito, conformando-se ao seguinte modelo (Retorne SOMENTE o JSON, sem markdown):

{
  "hierarchy": [
    {
      "name": "Calçados",
      "slug": "calcados",
      "children": [
        {
          "name": "Calçados Masculinos",
          "slug": "calcados-masculinos",
          "children": []
        }
      ]
    }
  ],
  "suggestedNewCategories": [
    { "name": "Acessórios", "reason": "Complementar ao segmento de moda" }
  ]
}
`;

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error("Backend error generating category hierarchy:", error.message || error);
      res.status(500).json({ error: handleGeminiError(error) });
    }
  });

  // 5. Generate Ambient Images (via Gemini API — gemini-2.5-flash-image)
  app.post("/api/gemini/generate-ambient-images", async (req, res) => {
    try {
      const { base64Data, mimeType, ambientPrompt, imageIndex = 0 } = req.body;
      const normalizedMime = normalizeMimeType(mimeType || 'image/jpeg', 'image.png');

      const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

      console.log(`[DEBUG] imageIndex: ${imageIndex}, model: gemini-2.5-flash-image`);
      console.log(`[DEBUG] ambientPrompt[${imageIndex}]: ${ambientPrompt}`);

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash-image',
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: normalizedMime, data: cleanBase64 } },
            { text: ambientPrompt }
          ]
        }],
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF }
          ]
        }
      });

      // Extract the image part from the response candidates
      let imageData: string | null = null;
      for (const candidate of response.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if ((part as any).inlineData?.data) {
            imageData = (part as any).inlineData.data;
            break;
          }
        }
        if (imageData) break;
      }

      if (!imageData) {
        throw new Error("O modelo não retornou uma imagem. Tente novamente.");
      }

      res.json({
        image: `data:image/png;base64,${imageData}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });
    } catch (error: any) {
      console.error("Backend error generating ambient images:", error.message || error);
      res.status(500).json({ error: error.message || "Erro desconhecido ao gerar imagem." });
    }
  });

  // 6. Generate Ambient Image Prompts via Gemini
  app.post("/api/gemini/generate-ambient-prompts", async (req, res) => {
    try {
      const { productName, brand, category, description, base64Data, mimeType } = req.body;
      if (!productName) {
        return res.status(400).json({ error: "productName é obrigatório." });
      }

      const productContext = [productName, brand, category, description]
        .filter(Boolean)
        .join(". ");

      const prompt = `You are a senior commercial photographer and art director for premium e-commerce brands. Your task is to write 3 image transformation instructions in ENGLISH for a generative AI model (gemini-2.5-flash-image). The model receives the product image directly, so you must NOT describe the product's appearance — focus entirely on what should change in the scene.

${base64Data ? 'Analyze the product image provided to understand exactly what this product is, who uses it, where it is realistically used, and what surfaces/objects/environments naturally surround it in real life.' : ''}
Product context: ${productContext}

CRITICAL REALISM RULES (apply to ALL instructions):
- The scene must be SPECIFIC to THIS product and its real-world use context — never generic. Reason from the product: a power tool belongs on a workbench with sawdust, not a marble countertop; a skincare serum belongs on a bathroom shelf with morning light, not a kitchen.
- The result must look like a REAL photograph taken by a professional, NOT an AI render. Demand photographic authenticity: natural and slightly uneven lighting, real soft shadows and contact shadows under the product, subtle surface imperfections (dust, fingerprints, wear, scratches, texture), shallow depth of field with realistic lens bokeh, true-to-life color and white balance, no plastic-perfect surfaces, no symmetrical CGI cleanliness.
- Specify a real camera look: e.g. shot on a 50mm or 85mm lens, f/2.0, natural window light or practical lighting, photojournalistic / lifestyle editorial style.
- Avoid clichés (marble countertop, generic golden hour, floating product, empty studio) unless they genuinely fit the product.

Generate 3 transformation instructions following this exact order and format:

Instruction 0 — Realistic in-context scene: Keep the product exactly as-is (do NOT alter the product), and place it into a believable, lived-in environment where THIS specific product is actually used or displayed, chosen from the product description and category. Build a rich but natural scene: the right surface/material, contextually relevant props that a real owner would have nearby, realistic ambient lighting with direction and soft shadows, and a sense of depth (foreground/background). The product must sit naturally in the scene with a grounded contact shadow — not floating, not centered like a catalog cutout. Make it look like a candid photo from a real home/workspace/store, captured on a 50mm lens at f/2.2 with natural light. Example for a leather wallet: "Keep the product exactly as-is. Place it on a worn wooden café table next to a set of car keys, a folded newspaper and a half-finished espresso, warm morning window light from the left casting a soft natural shadow, shallow depth of field, blurred background of a cozy café interior, shot on 50mm f/2.2, candid lifestyle photograph, photorealistic with subtle surface texture and no AI artifacts."

Instruction 1 — Authentic lifestyle scene with person: Keep the product visually identical to the input image, and show a real-looking person who genuinely belongs to THIS product's target audience naturally using or interacting with it in the right real-world moment (derive the person, action and setting from the product description and category). Make the person look real and candid — natural skin texture and pores, realistic hands and fingers actually gripping/touching the product with correct scale, relaxed unposed body language, everyday authentic clothing that fits the context, no model-perfect stock-photo smile. Build a believable environment around the action with depth and contextual props, motivated natural lighting with soft directional shadows. Capture it as a documentary/lifestyle editorial frame on an 85mm lens at f/2.0, shallow depth of field, true-to-life colors, no AI artifacts. The product must look identical to the input image. Example for running shoes: "Keep the product identical to the input image. Show a man in his early 30s in casual athletic wear lacing up this shoe on his foot while sitting on a city park bench at golden hour, sweat on his skin, real hands with natural detail, blurred green park background, motivated warm side light with a soft shadow, shot on 85mm f/2.0, candid documentary lifestyle photograph, photorealistic, no AI artifacts."

Instruction 2 — Realistic scale reference: Keep the product visually identical to the input image, and show a real person's hands (or the person next to it) holding or interacting with the product to communicate its true real-world size and proportions. Use a clean but NOT artificial setting — a simple real surface or softly blurred everyday background, never an empty CGI void. Demand realistic human hands with correct anatomy, natural skin texture and accurate scale relative to the product, soft natural lighting with a grounded contact shadow. Shoot it like a real close-up product photo on a 50mm lens at f/2.8, photorealistic, no AI artifacts. The product must look identical to the input image and its size must read clearly. Example: "Keep the product identical to the input image. Show a woman's hands with natural skin texture holding this product at chest height over a softly blurred light wooden desk, neutral daylight from a window, soft contact shadow, correct real-life scale, shot on 50mm f/2.8, photorealistic close-up, no AI artifacts, the product clearly showing its real size."

Return ONLY valid JSON with this exact structure, no markdown, no explanations:
{"prompts": ["instruction0", "instruction1", "instruction2"], "productDescription": "concise visual description of the product (colors, materials, key features)"}`;

      const parts: any[] = [];
      if (base64Data) {
        const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        parts.push({ inlineData: { mimeType: normalizeMimeType(mimeType || '', 'upload'), data: cleanBase64 } });
      }
      parts.push({ text: prompt });

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash',
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json" }
      });

      const raw = response.text?.trim() || "{}";
      let parsed: { prompts?: string[]; productDescription?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : {};
      }

      if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== 3) {
        throw new Error("Gemini não retornou 3 prompts no formato esperado.");
      }

      res.json({ prompts: parsed.prompts, productDescription: parsed.productDescription || '' });
    } catch (error: any) {
      console.error("Backend error generating ambient prompts:", error.message || error);
      res.status(500).json({ error: error.message || "Erro desconhecido ao gerar prompts." });
    }
  });

  // 7. Enrich Product Data
  app.post("/api/gemini/enrich-product-data", async (req, res) => {
    try {
      const { product } = req.body;

      const prompt = `Você é um assistente de cadastro de e-commerce.
Busque na internet as especificações técnicas do seguinte produto:
Nome/Descrição: ${product['Descrição']}
Marca: ${product['Marca']}
Categoria: ${product['Categoria']}

Tente encontrar os seguintes dados (se não encontrar, deixe vazio ou null):
- GTIN/EAN (código de barras)
- NCM (Classificação fiscal)
- Peso bruto (Kg)
- Largura embalagem (cm)
- Altura Embalagem (cm)
- Comprimento embalagem (cm)

Retorne APENAS um JSON válido no seguinte formato:
{
  "GTIN/EAN": "...",
  "NCM (Classificação fiscal)": "...",
  "Peso bruto (Kg)": 1.5,
  "Largura embalagem": 20,
  "Altura Embalagem": 15,
  "Comprimento embalagem": 10,
  "log_fontes": "Resumo muito conciso (máx 150 caracteres) das fontes utilizadas."
}`;

      const response = await generateContentWithFallback({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { 
          temperature: 0.2,
          maxOutputTokens: 2048,
          systemInstruction: "Você é um assistente de e-commerce. Seja extremamente conciso. Nunca gere textos longos ou repetitivos. O campo log_fontes deve ter no máximo 150 caracteres. RESPONDA APENAS COM O JSON PURO.",
          tools: [{ googleSearch: {} }]
        }
      });

      let text = response.text || '';
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

      const usage = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
      const parsed = JSON.parse(text || "{}");
      res.json({
        ...parsed,
        _usage: {
          promptTokens: usage.promptTokenCount,
          completionTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount
        }
      });
    } catch (error: any) {
      console.error("Backend error enriching product data:", error.message || error);
      res.status(500).json({ error: handleGeminiError(error) });
    }
  });

  app.post("/api/upload", async (req, res) => {
    try {
      const { imageBase64, imageUrl, filename } = req.body;
      
      let data = '';
      let extension = 'png';

      if (imageBase64) {
        const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        data = imageBase64;
        
        if (matches && matches.length === 3) {
          data = matches[2];
          const mime = matches[1];
          if (mime === 'image/jpeg') extension = 'jpg';
          else if (mime === 'image/webp') extension = 'webp';
        }
      } else if (imageUrl) {
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error("Failed to fetch image");
          const arrayBuffer = await response.arrayBuffer();
          data = Buffer.from(arrayBuffer).toString('base64');
          
          const contentType = response.headers.get('content-type');
          if (contentType === 'image/jpeg') extension = 'jpg';
          else if (contentType === 'image/webp') extension = 'webp';
          else if (contentType === 'image/gif') extension = 'gif';
        } catch (e) {
          console.error("Error downloading image from URL:", e);
          return res.status(400).json({ error: "Failed to download image from URL" });
        }
      } else {
        return res.status(400).json({ error: "No image provided" });
      }

      const safeFilename = filename ? filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() : `img_${Date.now()}`;
      const finalFilename = `${safeFilename}_${Date.now()}.${extension}`;
      const filePath = path.join(uploadsDir, finalFilename);

      fs.writeFileSync(filePath, data, 'base64');

      // Return the URL (absolute URL based on request host)
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers.host;
      const url = `${protocol}://${host}/uploads/${finalFilename}`;
      
      res.json({ url });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to save image" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
