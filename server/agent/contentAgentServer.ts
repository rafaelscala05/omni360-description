// Servidor HTTP standalone do grafo do Agente de Conteúdo — substitui a
// imagem `langchain/langgraphjs-api` (langgraph-cli) como artefato de
// deploy. Achado ao vivo: essa imagem sobe o Core API completo da LangGraph
// Platform, que exige Postgres+Redis próprios em produção (KeyError
// REDIS_URI) mesmo o grafo já tendo um checkpointer Firestore dedicado —
// infraestrutura duplicada e cara pra um requisito que já resolvemos.
//
// A ponte (server/agent/contentAgentChat.ts) só usa dois endpoints da API
// real do LangGraph.js Server (POST /threads, POST /threads/{id}/runs/
// stream com stream_mode messages+values) — este servidor implementa só
// esses dois, direto sobre `graph.stream()`, sem o resto do Core API
// (fila de runs, TTL de threads, etc. — não fazem falta: threads/mensagens
// já vivem no Firestore via a ponte, e o checkpointer do grafo idem).
//
// Formato do stream: confirmado direto no código-fonte da lib instalada
// (node_modules/@langchain/langgraph/dist/pregel/index.js e messages.js) —
// com `streamMode: ['messages', 'values']` (array, streamModeSingle=false),
// cada item é `[mode, payload]`; para 'messages', payload é
// `[BaseMessage, metadata]` (StreamMessagesHandler._emit); para 'values',
// payload é o snapshot de estado, incluindo `__interrupt__` quando o grafo
// pausa (constants.js: INTERRUPT = "__interrupt__", documentado como
// `values[INTERRUPT][0].value`).
//
// Achado ao vivo (nº 2): BaseMessage tem `type`/`content`/`tool_call_id`/
// `name`/`tool_calls` como campos de instância simples, MAS `JSON.stringify`
// não usa esses campos direto — BaseMessage estende `Serializable`
// (@langchain/core/load/serializable), que define `toJSON()` pro formato de
// serialização próprio do LangChain (`{lc:1, type:"constructor", kwargs}`),
// e `JSON.stringify` sempre chama `.toJSON()` quando existe. `flattenMessage`
// abaixo lê os campos direto do objeto (funciona independente do `toJSON()`)
// e monta o objeto plano que `contentAgentChat.ts` espera.
import express from 'express';
import { Command } from '@langchain/langgraph';
import { graph } from './contentGraph';

const PORT = Number(process.env.PORT) || 8123;

const app = express();
app.use(express.json({ limit: '2mb' }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenMessage(m: any): unknown {
  if (m == null || typeof m !== 'object') return m;
  return {
    type: m.type,
    content: m.content,
    ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenValues(v: any): unknown {
  if (v == null || typeof v !== 'object') return v;
  return { ...v, ...(Array.isArray(v.messages) ? { messages: v.messages.map(flattenMessage) } : {}) };
}

app.post('/threads', (req, res) => {
  res.json({ thread_id: req.body?.thread_id });
});

app.post('/threads/:id/runs/stream', async (req, res) => {
  const threadId = req.params.id;
  const { config, input, command } = req.body ?? {};

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const runConfig = {
      configurable: { ...(config?.configurable ?? {}), thread_id: threadId },
      streamMode: ['messages', 'values'] as ('messages' | 'values')[],
    };
    const payload = command ? new Command({ resume: command.resume }) : input;
    const stream = await graph.stream(payload, runConfig);
    for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
      if (mode === 'messages') emit('messages', [flattenMessage((chunk as [unknown, unknown])[0])]);
      else if (mode === 'values') emit('values', flattenValues(chunk));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[content-agent-server] erro no stream:', err);
    emit('values', { messages: [{ type: 'ai', content: `Erro no agente: ${(err as Error).message}` }] });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[content-agent-server] ouvindo na porta ${PORT}`);
});
