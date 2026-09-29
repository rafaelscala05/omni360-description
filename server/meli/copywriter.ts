import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { descriptionRejectionReason, validateSuggestedTitle } from './rules';
import type { MeliBuyerQuestion, MeliListingRecord } from './types';

const MODEL = process.env.MELI_COPY_MODEL || process.env.MELI_ANALYSIS_MODEL || 'gemini-2.5-flash';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
export const COPY_PROMPT_VERSION = 'meli-copy-2026-09-29.1';

const CopySchema = z.object({
  title: z.string().max(300).nullable(),
  description_plain_text: z.string().max(10000).nullable(),
});

export interface ListingCopyInput {
  listing: MeliListingRecord;
  factsText: string;
  buyerQuestions: MeliBuyerQuestion[];
  // Observações visuais da auditoria (ex.: "tampa com rosca", "cor azul").
  // Servem para o tom, mas não liberam números/afirmações sensíveis: o
  // validador continua exigindo que esses dados estejam nas fontes textuais.
  visualNotes: string[];
  titleEditable: boolean;
  maxTitleLength: number;
}

export interface ListingCopyResult {
  title: string | null;
  description: string | null;
  titleRejection: string | null;
  descriptionRejection: string | null;
}

function asObjects(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object')) : [];
}

function systemInstruction(input: ListingCopyInput): string {
  return [
    'Você é redator especialista em anúncios do Mercado Livre Brasil. Escreva em português do Brasil, para vender mais sem enganar.',
    'FONTES: use SOMENTE os fatos do anúncio atual, da ficha técnica, das respostas do vendedor (seller_facts) e das respostas que o vendedor já deu a compradores. Nunca invente número, medida, material, compatibilidade, garantia, certificação, voltagem ou conteúdo da embalagem. Se um fato não estiver nas fontes, não o mencione.',
    input.titleEditable
      ? `TÍTULO: até ${input.maxTitleLength} caracteres, no formato Produto + Marca + Modelo + principal característica (cor, tamanho, material, capacidade) — só com palavras que existam nas fontes. Sem termos promocionais (oferta, promoção, frete grátis, desconto), sem emojis, sem pontuação decorativa, sem caixa alta integral.`
      : 'TÍTULO: não altere; devolva title = null (o título deste anúncio não pode mais ser editado).',
    'DESCRIÇÃO em texto simples (sem HTML, sem markdown com asteriscos, sem links, sem telefone ou e-mail, sem preço ou estoque). Estrutura:',
    '1) um parágrafo de abertura com o que é o produto e para quem/para que serve;',
    '2) "Principais características:" com linhas começando por "- ";',
    '3) "Especificações:" com linhas "- Nome: valor" usando a ficha técnica e os seller_facts;',
    '4) se houver perguntas de compradores, "Perguntas frequentes:" com linhas "P: ..." e "R: ..." respondendo SOMENTE com fatos das fontes — pule a pergunta se não houver fato;',
    '5) "O que você recebe:" apenas se o conteúdo da embalagem estiver nas fontes.',
    'Escreva números exatamente como aparecem nas fontes (mesma grafia, ex.: 1,5 e não 1.5).',
    'Responda com JSON { "title": string|null, "description_plain_text": string|null }.',
  ].join('\n');
}

function context(input: ListingCopyInput, feedback: string | null): string {
  const { listing } = input;
  return JSON.stringify({
    current_title: listing.title,
    current_description: listing.descriptionPlainText,
    condition: listing.condition,
    attributes: asObjects(listing.attributes)
      .filter((attribute) => attribute.value_name)
      .map((attribute) => ({ name: attribute.name || attribute.id, value: attribute.value_name })),
    sale_terms: asObjects(listing.saleTerms)
      .filter((term) => term.value_name)
      .map((term) => ({ name: term.name || term.id, value: term.value_name })),
    seller_facts: input.factsText || null,
    buyer_questions: input.buyerQuestions.slice(0, 25).map((question) => ({ question: question.text, seller_answer: question.answer })),
    visual_notes: input.visualNotes.slice(0, 12),
    ...(feedback ? { previous_attempt_rejected_because: feedback } : {}),
  });
}

async function callModel(input: ListingCopyInput, feedback: string | null): Promise<z.infer<typeof CopySchema>> {
  const ai = new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: `Reescreva o anúncio a partir deste contexto JSON:\n${context(input, feedback)}` }] }],
    config: {
      systemInstruction: systemInstruction(input),
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(CopySchema),
    },
  });
  return CopySchema.parse(JSON.parse(response.text || '{}'));
}

// Gera título e descrição com foco em conversão e passa cada um pelo mesmo
// validador factual da auditoria. Se algo for recusado, tenta de novo uma
// vez dizendo o motivo — é o que transforma "descartado" em texto aprovável.
export async function generateListingCopy(input: ListingCopyInput): Promise<ListingCopyResult> {
  const result: ListingCopyResult = { title: null, description: null, titleRejection: null, descriptionRejection: null };
  let feedback: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const output = await callModel(input, feedback);
    const reasons: string[] = [];
    if (!result.description && output.description_plain_text?.trim()) {
      const description = output.description_plain_text.trim();
      const rejection = descriptionRejectionReason(description, input.listing, input.factsText);
      if (rejection) { result.descriptionRejection = rejection; reasons.push(`Descrição: ${rejection}`); }
      else { result.description = description; result.descriptionRejection = null; }
    }
    if (input.titleEditable && !result.title && output.title?.trim()) {
      const title = output.title.trim();
      const tooLong = title.length > input.maxTitleLength;
      const valid = !tooLong && validateSuggestedTitle(title, input.listing, input.factsText);
      if (!valid) {
        result.titleRejection = tooLong ? `Passa de ${input.maxTitleLength} caracteres.` : 'Usa palavras que não constam no anúncio nem nas suas respostas.';
        reasons.push(`Título: ${result.titleRejection}`);
      } else if (title.toLocaleLowerCase('pt-BR') !== input.listing.title.trim().toLocaleLowerCase('pt-BR')) {
        result.title = title; result.titleRejection = null;
      }
    }
    const needsRetry = (!result.description && result.descriptionRejection) || (input.titleEditable && !result.title && result.titleRejection);
    if (!needsRetry) break;
    feedback = reasons.join(' ');
  }
  return result;
}
