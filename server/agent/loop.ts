// The conversational loop: Gemini function calling over the tool registry.
//
// Read tools run inline. Write tools never run here — the loop calls preview()
// and creates a pending action, then STOPS and waits for the user. When the user
// approves or rejects (routes.ts → actions.ts), the loop resumes from the stored
// conversation with the real outcome as the function response.
//
// At most ONE write per model turn. That keeps resumption tractable (a single
// suspension point) and matches the per-action approval the UI is built around;
// extra writes in the same turn get a response telling the model to re-issue
// them after this one is decided.

import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { adminDb } from '../firebaseAdmin';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { fetchImageAsBase64 } from '../safeUrl';
import { getTool, toGeminiDeclarations } from './registry';
import { buildContext, resolveConnections } from './connections';
import { createAction } from './actions';
import type { AgentAction, ThreadAttachment, ToolProvider } from './types';

// Tools are registered by importing their modules — the side effect IS the
// registration, so these imports must stay even though nothing is referenced.
import './tools/wake';
import './tools/tiny';
import './tools/discovery';

const MODEL = 'gemini-2.5-flash';
const MAX_STEPS = 8;

const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || firebaseAppletConfig.projectId;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

function getClient(): GoogleGenAI {
  if (!VERTEX_PROJECT) {
    throw Object.assign(new Error('VERTEX_PROJECT_ID não configurado no servidor'), { status: 500 });
  }
  return new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
}

const threadRef = (uid: string, threadId: string) =>
  adminDb.collection('users').doc(uid).collection('agent_threads').doc(threadId);
const messagesCol = (uid: string, threadId: string) => threadRef(uid, threadId).collection('messages');

// ---------------------------------------------------------------------------
// System instruction
// ---------------------------------------------------------------------------

function systemInstruction(conns: { wake: boolean; tiny: boolean }): string {
  const plataformas = [
    conns.wake ? '- Wake Commerce (loja/e-commerce): banners, hotsites, produtos, preço, estoque e SEO.' : null,
    conns.tiny ? '- Tiny ERP (v2): produtos, preço, estoque, pedidos e contatos.' : null,
  ].filter(Boolean).join('\n');

  return `Você é o Agente Operacional do omni360: opera a loja e o ERP do usuário através das ferramentas disponíveis.

Plataformas conectadas nesta conta:
${plataformas || '- Nenhuma plataforma conectada.'}

Como você trabalha:
- Ferramentas de LEITURA rodam na hora. Use-as à vontade para confirmar o estado atual antes de propor qualquer alteração.
- Ferramentas de ESCRITA não executam quando você as chama. Elas montam uma prévia com o antes/depois real e param para o usuário aprovar. Chame uma vez e aguarde — não repita a chamada achando que falhou.
- Proponha no máximo UMA escrita por vez. Se o pedido exigir várias, faça a primeira e continue depois que ela for decidida.

Regras:
- Nunca invente SKU, id, preço ou qualquer identificador. Descubra com uma ferramenta de leitura ou pergunte.
- Antes de criar um banner, use wake.banner.posicionamentos para escolher o posicionamento certo, e confirme com o usuário para onde o banner deve levar.
- Se não existir ferramenta para o que foi pedido, use docs.buscar para checar a documentação da Wake e, se for uma leitura, wake.api.chamar ou tiny.api.chamar. Se for uma alteração sem ferramenta dedicada, diga isso claramente em vez de improvisar.
- Se o pedido for ambíguo ou faltar informação essencial, pergunte antes de propor a ação.
- Se a plataforma necessária não estiver conectada, diga qual é e que ela precisa ser conectada em Integrações.

Responda sempre em português do Brasil, de forma direta e objetiva. Ao propor uma escrita, explique em uma frase o que vai mudar — o usuário verá o diff detalhado no card de aprovação, então não repita os valores campo a campo.`;
}

// ---------------------------------------------------------------------------
// Persistence — one collection serves both the UI and the model history
// ---------------------------------------------------------------------------

interface StoredMessage {
  id: string;
  role: 'user' | 'model' | 'function';
  texto: string;
  anexos?: ThreadAttachment[];
  actionIds?: string[];
  leituras?: { tool: string; ok: boolean }[];
  createdAt: string;
  /** Raw Gemini Content for this turn — what the loop replays as history. */
  content: Content;
  /** Responses already known for a suspended turn, keyed by function name. */
  respostas?: Record<string, unknown>;
  /** The single pending write of a suspended turn. */
  actionId?: string;
  actionTool?: string;
}

async function loadHistory(uid: string, threadId: string): Promise<StoredMessage[]> {
  const snap = await messagesCol(uid, threadId).orderBy('createdAt').get();
  return snap.docs.map((d) => d.data() as StoredMessage);
}

async function saveMessage(uid: string, threadId: string, msg: Omit<StoredMessage, 'id'>): Promise<string> {
  const ref = messagesCol(uid, threadId).doc();
  const clean = JSON.parse(JSON.stringify({ ...msg, id: ref.id }));
  await ref.set(clean);
  await threadRef(uid, threadId).update({ updatedAt: msg.createdAt }).catch(() => {});
  return ref.id;
}

/** Only the Gemini-visible turns, in order. */
const toContents = (msgs: StoredMessage[]): Content[] => msgs.map((m) => m.content).filter(Boolean);

// ---------------------------------------------------------------------------
// SSE emitter
// ---------------------------------------------------------------------------

export type Emit = (event: string, data: unknown) => void;

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

interface StepOutcome {
  suspended: boolean;
}

async function attachmentParts(anexos: ThreadAttachment[]): Promise<Part[]> {
  const parts: Part[] = [];
  for (const a of anexos) {
    if (a.mimeType.startsWith('image/')) {
      try {
        const img = await fetchImageAsBase64(a.url);
        parts.push({ inlineData: { mimeType: a.mimeType, data: img.base64 } });
      } catch {
        // Fall through to the URL-only part below — the model can still hand the
        // URL to a banner tool even if it cannot see the pixels.
      }
    }
    // Always include the URL as text: the write tools take imagemUrl, not bytes.
    parts.push({ text: `[anexo] ${a.nome} — ${a.mimeType} — URL: ${a.url}` });
  }
  return parts;
}

/**
 * Drives the model until it produces a final text answer, needs approval, or
 * hits MAX_STEPS. Returns whether it suspended waiting on the user.
 */
async function runLoop(
  uid: string,
  threadId: string,
  providers: ToolProvider[],
  conns: { wake: boolean; tiny: boolean },
  emit: Emit,
): Promise<StepOutcome> {
  const ai = getClient();
  const ctx = buildContext(uid);
  const declarations = toGeminiDeclarations(providers);

  for (let step = 0; step < MAX_STEPS; step++) {
    const history = await loadHistory(uid, threadId);
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: toContents(history),
      config: {
        systemInstruction: systemInstruction(conns),
        temperature: 0.2,
        tools: [{ functionDeclarations: declarations }],
      },
    });

    let texto = '';
    const calls: { name: string; args: Record<string, unknown>; id?: string }[] = [];
    const modelParts: Part[] = [];

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          texto += part.text;
          modelParts.push({ text: part.text });
          emit('delta', { texto: part.text });
        }
        if (part.functionCall?.name) {
          calls.push({
            name: part.functionCall.name,
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            id: part.functionCall.id,
          });
          modelParts.push(part);
        }
      }
    }

    // Plain answer — the turn is done.
    if (!calls.length) {
      await saveMessage(uid, threadId, {
        role: 'model',
        texto,
        createdAt: new Date().toISOString(),
        content: { role: 'model', parts: modelParts.length ? modelParts : [{ text: texto }] },
      });
      emit('fim', { texto });
      return { suspended: false };
    }

    // Resolve the calls: reads run now, the first write suspends the turn.
    const respostas: Record<string, unknown> = {};
    const leituras: { tool: string; ok: boolean }[] = [];
    let pending: { action: AgentAction; tool: string } | null = null;

    for (const call of calls) {
      const tool = getTool(call.name);
      if (!tool || !providers.includes(tool.provider)) {
        respostas[call.name] = { erro: `Ferramenta "${call.name}" não está disponível nesta conta.` };
        continue;
      }

      if (tool.mode === 'read') {
        try {
          respostas[call.name] = { resultado: await tool.read!(ctx, call.args as never) };
          leituras.push({ tool: call.name, ok: true });
          emit('leitura', { tool: call.name, ok: true });
        } catch (e: any) {
          respostas[call.name] = { erro: e?.message ?? 'Falha na leitura.' };
          leituras.push({ tool: call.name, ok: false });
          emit('leitura', { tool: call.name, ok: false, erro: e?.message });
        }
        continue;
      }

      // Write.
      if (pending) {
        respostas[call.name] = {
          erro: 'Só uma alteração por vez. Proponha esta novamente depois que a anterior for decidida pelo usuário.',
        };
        continue;
      }
      try {
        const preview = await tool.preview!(ctx, call.args as never);
        const action = await createAction({
          uid, threadId, tool: call.name, provider: tool.provider,
          args: call.args, preview, callId: call.id,
        });
        pending = { action, tool: call.name };
        emit('acao', action);
      } catch (e: any) {
        // A failed preview is information for the model, not a dead end: it can
        // fix the arguments (missing CD, unknown SKU) and try again.
        respostas[call.name] = { erro: e?.message ?? 'Não consegui montar a prévia desta ação.' };
        emit('leitura', { tool: call.name, ok: false, erro: e?.message });
      }
    }

    await saveMessage(uid, threadId, {
      role: 'model',
      texto,
      leituras,
      createdAt: new Date().toISOString(),
      content: { role: 'model', parts: modelParts },
      ...(pending
        ? { respostas, actionId: pending.action.id, actionTool: pending.tool, actionIds: [pending.action.id] }
        : {}),
    });

    if (pending) {
      emit('aguardando', { actionId: pending.action.id });
      return { suspended: true };
    }

    // No write proposed — feed the read results back and let the model continue.
    await saveMessage(uid, threadId, {
      role: 'function',
      texto: '',
      createdAt: new Date().toISOString(),
      content: {
        role: 'user',
        parts: Object.entries(respostas).map(([name, response]) => ({
          functionResponse: { name, response: response as Record<string, unknown> },
        })),
      },
    });
  }

  const aviso = 'Parei aqui para não entrar em laço — me diga como quer seguir.';
  await saveMessage(uid, threadId, {
    role: 'model',
    texto: aviso,
    createdAt: new Date().toISOString(),
    content: { role: 'model', parts: [{ text: aviso }] },
  });
  emit('fim', { texto: aviso });
  return { suspended: false };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function sendUserMessage(input: {
  uid: string;
  threadId: string;
  texto: string;
  anexos?: ThreadAttachment[];
  emit: Emit;
}): Promise<void> {
  const { uid, threadId, texto, anexos = [], emit } = input;
  const conns = await resolveConnections(uid);

  const parts: Part[] = [];
  if (texto.trim()) parts.push({ text: texto });
  if (anexos.length) parts.push(...(await attachmentParts(anexos)));
  if (!parts.length) throw Object.assign(new Error('Mensagem vazia.'), { status: 400 });

  await saveMessage(uid, threadId, {
    role: 'user',
    texto,
    anexos,
    createdAt: new Date().toISOString(),
    content: { role: 'user', parts },
  });

  await runLoop(uid, threadId, conns.providers, conns, emit);
}

/**
 * Called after the user approves or rejects. Closes the suspended function call
 * with the real outcome, then lets the model continue from there.
 */
export async function resumeAfterAction(input: {
  uid: string;
  threadId: string;
  action: AgentAction;
  outcome: { ok: boolean; result?: unknown; error?: string; rejeitada?: boolean };
  emit: Emit;
}): Promise<void> {
  const { uid, threadId, action, outcome, emit } = input;

  const history = await loadHistory(uid, threadId);
  const suspended = [...history].reverse().find((m) => m.actionId === action.id);

  const resposta = outcome.rejeitada
    ? { recusada: true, mensagem: 'O usuário não aprovou esta ação. Não tente executá-la de novo; pergunte o que ele prefere.' }
    : outcome.ok
      ? { resultado: outcome.result ?? { ok: true } }
      : { erro: outcome.error ?? 'A execução falhou.' };

  // Replay every call of the suspended turn: the reads we already resolved, plus
  // this write's real outcome. Gemini requires a response for each call it made.
  const respostas: Record<string, unknown> = { ...(suspended?.respostas ?? {}) };
  respostas[action.tool] = resposta;

  await saveMessage(uid, threadId, {
    role: 'function',
    texto: '',
    createdAt: new Date().toISOString(),
    content: {
      role: 'user',
      parts: Object.entries(respostas).map(([name, response]) => ({
        functionResponse: { name, response: response as Record<string, unknown> },
      })),
    },
  });

  const conns = await resolveConnections(uid);
  await runLoop(uid, threadId, conns.providers, conns, emit);
}

export async function createThread(uid: string, titulo: string): Promise<string> {
  const conns = await resolveConnections(uid);
  const ref = threadRef(uid, adminDb.collection('_').doc().id);
  const now = new Date().toISOString();
  await ref.set({
    id: ref.id,
    titulo: titulo?.trim() ? titulo.trim().slice(0, 80) : 'Nova conversa',
    providers: conns.providers,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}
