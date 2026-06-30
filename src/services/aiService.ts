import {
  getAI,
  getGenerativeModel,
  VertexAIBackend,
  ResponseModality,
  HarmCategory,
  HarmBlockThreshold,
  type Part,
  type GenerateContentResult,
  type ModelParams,
  type GenerationConfig,
} from 'firebase/ai';
import { app } from '../firebase';

// Initialize the Firebase AI Logic service with the Vertex AI Gemini backend (global location).
const ai = getAI(app, { backend: new VertexAIBackend('global') });

const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

// Safety settings used for ambient image generation (all OFF, matching the previous server behavior).
const IMAGE_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Retry wrapper: retries on transient 503 / UNAVAILABLE / high-demand errors with linear backoff.
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
      const is503 =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('temporarily') ||
        error?.status === 503 ||
        error?.code === 503;
      if (is503 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Tolerant JSON parser: strips markdown fences and falls back to extracting the first {...} block.
export function parseJsonResponse(text: string): any {
  let cleaned = (text || '').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned || '{}');
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('A IA não retornou um JSON válido.');
  }
}

// Maps Firebase AI / Vertex errors to friendly Portuguese messages.
export function handleAiError(error: any): string {
  const msg = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
  if (msg.includes('429') || /RESOURCE_EXHAUSTED|quota|limite/i.test(msg)) {
    return 'O limite de requisições (Quota) foi excedido ou a cota do projeto acabou. Verifique os limites do seu projeto no Firebase/Google Cloud.';
  }
  if (msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return 'Permissão negada. Verifique se o Firebase AI Logic (Vertex AI) está habilitado no console do seu projeto.';
  }
  return msg || 'Erro desconhecido ao processar a IA.';
}

export type ContentInput = string | Array<string | Part>;

interface JsonCallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

// Generates a JSON response from text/image input. Returns the parsed object.
export async function generateJson(contents: ContentInput, options: JsonCallOptions = {}): Promise<any> {
  const generationConfig: GenerationConfig = {
    responseMimeType: 'application/json',
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
  };
  const params: ModelParams = { model: TEXT_MODEL, generationConfig };
  if (options.systemInstruction) params.systemInstruction = options.systemInstruction;

  const model = getGenerativeModel(ai, params);
  const result = await withRetry(() => model.generateContent(contents as any));
  return parseJsonResponse(result.response.text());
}

// Generates grounded text using the Google Search tool. Returns raw text + usage (JSON mode is NOT
// forced because grounding frequently ignores responseMimeType).
export async function generateGrounded(
  contents: ContentInput,
  options: JsonCallOptions = {},
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const params: ModelParams = {
    model: TEXT_MODEL,
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    },
  };
  if (options.systemInstruction) params.systemInstruction = options.systemInstruction;

  const model = getGenerativeModel(ai, params);
  const result = await withRetry(() => model.generateContent(contents as any));
  const usage = result.response.usageMetadata;
  return {
    text: result.response.text(),
    usage: {
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
    },
  };
}

// Extracts the first inline image (base64) from a generateContent result.
export function extractImage(result: GenerateContentResult): string | null {
  for (const candidate of result.response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if ((part as any).inlineData?.data) {
        return (part as any).inlineData.data as string;
      }
    }
  }
  return null;
}

// Generates an ambient/lifestyle image from an input image + prompt. Returns a data URL.
export async function generateImage(base64Data: string, mimeType: string, prompt: string, aspectRatio: string = '1:1'): Promise<string> {
  const model = getGenerativeModel(ai, {
    model: IMAGE_MODEL,
    generationConfig: {
      responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE],
    },
    safetySettings: IMAGE_SAFETY_SETTINGS,
  });

  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const fullPrompt = `${prompt}\n\nOutput the image in ${aspectRatio} aspect ratio.`;
  const result = await withRetry(() =>
    model.generateContent([
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: cleanBase64 } },
      { text: fullPrompt },
    ] as any),
  );

  const imageData = extractImage(result);
  if (!imageData) throw new Error('O modelo não retornou uma imagem. Tente novamente.');
  return `data:image/png;base64,${imageData}`;
}
