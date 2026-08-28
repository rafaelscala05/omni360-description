// Grafo do Agente de Conteúdo. Nesta task tem um tool de brinquedo que chama
// interrupt() — só para validar o round-trip de aprovação ponta a ponta antes
// de construir o catálogo real (Task 10 substitui isto).

import { StateGraph, START, END, MessagesAnnotation, interrupt } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { ChatVertexAI } from '@langchain/google-vertexai';
import * as z from 'zod';

const toyWriteTool = tool(
  async ({ mensagem }: { mensagem: string }) => {
    const decisao = interrupt({
      resumo: `Confirma o envio: "${mensagem}"?`,
      alvo: 'brinquedo',
      campos: [],
      avisos: [],
    }) as { aprovado: boolean };
    if (!decisao?.aprovado) return 'Ação cancelada pelo usuário.';
    return `Mensagem enviada: ${mensagem}`;
  },
  {
    name: 'toy_write',
    description: 'Ferramenta de teste que pede aprovação antes de "enviar" uma mensagem.',
    schema: z.object({ mensagem: z.string() }),
  },
);

const model = new ChatVertexAI({
  model: 'gemini-2.5-flash',
  location: process.env.VERTEX_LOCATION || 'us-central1',
  authOptions: { projectId: process.env.VERTEX_PROJECT_ID },
}).bindTools([toyWriteTool]);

async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1) as { tool_calls?: unknown[] } | undefined;
  return last?.tool_calls?.length ? 'tools' : END;
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', new ToolNode([toyWriteTool]))
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['tools', END])
  .addEdge('tools', 'agent')
  .compile();
