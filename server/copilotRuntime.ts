// Ponte entre o Express principal e o servidor LangGraph.js do Agente de
// Conteúdo. @copilotkit/runtime v2 fala fetch (Request/Response) nativo, não
// Express — a delegação abaixo é o padrão documentado pelo próprio pacote
// (node_modules/@copilotkit/runtime/skills/runtime/references/setup-endpoint.md)
// para expor um handler fetch-native dentro de uma rota Express, com streaming
// via SSE preservado (sem bufferizar o corpo da resposta).
import type express from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2';
import { LangGraphAgent } from '@copilotkit/runtime/langgraph';
import { adminAuth } from './firebaseAdmin';

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_LANGGRAPH_URL || 'http://localhost:8123';
const BASE_PATH = '/api/copilotkit';

export function registerCopilotRuntime(app: express.Application): void {
  const runtime = new CopilotRuntime({
    agents: {
      content_agent: new LangGraphAgent({
        deploymentUrl: CONTENT_AGENT_URL,
        graphId: 'content_agent',
      }),
    },
  });

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    hooks: {
      // Verifica o token Firebase e substitui qualquer uid que o cliente
      // tenha mandado por um valor confiável, resolvido no servidor — nunca
      // confiamos em uid vindo do navegador. O uid verificado entra em
      // forwardedProps.config.configurable, que o SDK do LangGraph.js
      // repassa como config.configurable do grafo (ver RunsInvokePayload em
      // @langchain/langgraph-sdk/dist/types.d.ts).
      onBeforeHandler: async ({ route, request }) => {
        if (route.method !== 'agent/run') return;

        const auth = request.headers.get('authorization') ?? '';
        const token = auth.replace(/^Bearer\s+/i, '');
        if (!token) throw new Response('Não autenticado', { status: 401 });
        const decoded = await adminAuth.verifyIdToken(token).catch(() => null);
        if (!decoded) throw new Response('Não autenticado', { status: 401 });

        const body = await request.clone().json().catch(() => ({}) as Record<string, unknown>);
        const forwardedProps = (body.forwardedProps ?? {}) as Record<string, unknown>;
        const config = (forwardedProps.config ?? {}) as Record<string, unknown>;
        const configurable = (config.configurable ?? {}) as Record<string, unknown>;

        body.forwardedProps = {
          ...forwardedProps,
          config: { ...config, configurable: { ...configurable, uid: decoded.uid } },
        };

        return new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(body),
        });
      },
      onError: async ({ error, route }) => {
        console.error('[copilotkit]', route?.method, error);
      },
    },
  });

  app.all(`${BASE_PATH}/*`, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : (req as unknown as BodyInit),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const webRes = await handler(webReq);
    res.status(webRes.status);
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    if (webRes.body) {
      Readable.fromWeb(webRes.body as unknown as WebReadableStream).pipe(res);
    } else {
      res.end();
    }
  });
}
