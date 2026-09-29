import { adminDb } from '../firebaseAdmin';
import { MeliApiClient } from './apiClient';
import type { MeliBuyerQuestion, MeliListingFacts } from './types';
import { contentHash, jsonSafe } from './utils';

const FACTS_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_listing_facts');
const AUDIT_REF = (uid: string) => adminDb.collection('users').doc(uid).collection('meli_audit_events');

const MAX_ANSWER_LENGTH = 500;
const MAX_ANSWERS = 60;
// Só campos que a proposta sabe escrever (atributos e termos) ou que servem de
// matéria-prima para o texto (description.*, título). Qualquer outra chave é
// ignorada para o cliente não conseguir gravar lixo no documento.
const ALLOWED_FIELD = /^(?:attributes\.[A-Z0-9_]{1,80}|sale_terms\.[A-Z0-9_]{1,80}|description\.[a-z_]{1,40}|title)$/;

export async function getListingFacts(uid: string, itemId: string): Promise<MeliListingFacts> {
  const normalizedId = itemId.toUpperCase();
  const snap = await FACTS_REF(uid).doc(normalizedId).get();
  return snap.exists
    ? snap.data() as MeliListingFacts
    : { itemId: normalizedId, answers: {}, updatedAt: '' };
}

export function normalizeFactAnswers(input: unknown): Record<string, { value: string; valueId: string | null }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('answers deve ser um objeto { campo: valor }.'), { status: 422 });
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_ANSWERS) throw Object.assign(new Error(`Envie no máximo ${MAX_ANSWERS} respostas por vez.`), { status: 422 });
  const result: Record<string, { value: string; valueId: string | null }> = {};
  for (const [fieldPath, raw] of entries) {
    if (!ALLOWED_FIELD.test(fieldPath)) continue;
    const candidate = raw && typeof raw === 'object' ? raw as Record<string, unknown> : { value: raw };
    const value = String(candidate.value ?? '').trim().slice(0, MAX_ANSWER_LENGTH);
    const valueId = typeof candidate.valueId === 'string' && candidate.valueId.trim() ? candidate.valueId.trim().slice(0, 200) : null;
    if (/<[^>]+>|https?:\/\/|www\./i.test(value)) {
      throw Object.assign(new Error(`A resposta de ${fieldPath} não pode conter HTML ou link.`), { status: 422 });
    }
    result[fieldPath] = { value, valueId };
  }
  return result;
}

// Resposta vazia apaga o fato (o vendedor "desrespondeu").
export async function saveListingFacts(uid: string, itemId: string, input: unknown): Promise<MeliListingFacts> {
  const normalizedId = itemId.toUpperCase();
  const answers = normalizeFactAnswers(input);
  const now = new Date().toISOString();
  const ref = FACTS_REF(uid).doc(normalizedId);
  const saved = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() as MeliListingFacts : { itemId: normalizedId, answers: {}, updatedAt: now };
    const next: MeliListingFacts = { itemId: normalizedId, answers: { ...current.answers }, updatedAt: now };
    for (const [fieldPath, answer] of Object.entries(answers)) {
      if (!answer.value) delete next.answers[fieldPath];
      else next.answers[fieldPath] = { value: answer.value, valueId: answer.valueId, answeredAt: now };
    }
    tx.set(ref, jsonSafe(next));
    return next;
  });
  await AUDIT_REF(uid).add({
    actorType: 'user', actorId: uid, action: 'meli.facts.saved', resourceType: 'meli_listing', resourceId: normalizedId,
    metadata: { fields: Object.keys(answers) }, createdAt: now,
  });
  return saved;
}

export function factsHash(facts: MeliListingFacts | null): string | null {
  const answers = facts?.answers || {};
  if (!Object.keys(answers).length) return null;
  return contentHash(Object.fromEntries(Object.entries(answers).map(([key, answer]) => [key, answer.value])));
}

// Texto corrido com os fatos, usado como fonte extra pelo validador de
// descrição/título/atributos: o que o vendedor respondeu deixa de ser "inventado".
export function factsSourceText(facts: MeliListingFacts | null): string {
  return Object.entries(facts?.answers || {}).map(([fieldPath, answer]) => `${fieldPath}: ${answer.value}`).join('\n');
}

// Perguntas de compradores com a resposta do próprio vendedor. As respostas
// são afirmações do vendedor, então também contam como fonte factual; as
// perguntas sem resposta mostram o que falta explicar no anúncio.
export async function fetchBuyerQuestions(uid: string, itemId: string, limit = 40): Promise<MeliBuyerQuestion[]> {
  try {
    const client = new MeliApiClient(uid);
    const payload = await client.get<any>(
      `/questions/search?item=${encodeURIComponent(itemId)}&api_version=4&sort_fields=date_created&sort_types=DESC&limit=${limit}`,
      { allowNotFound: true },
    );
    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
    return questions
      .filter((question: any) => typeof question?.text === 'string' && question.text.trim())
      .map((question: any) => ({
        text: String(question.text).trim().slice(0, 500),
        answer: typeof question.answer?.text === 'string' ? String(question.answer.text).trim().slice(0, 800) : null,
        date: question.date_created ? String(question.date_created) : null,
      }));
  } catch {
    return [];
  }
}

export function buyerAnswersSourceText(questions: MeliBuyerQuestion[]): string {
  return questions.filter((question) => question.answer).map((question) => question.answer).join('\n');
}
