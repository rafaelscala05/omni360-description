// Grafo do Agente de Conteúdo. Nesta task é só um eco, para provar que o
// servidor LangGraph.js sobe e responde — a Task 10 substitui o corpo deste
// arquivo pelo grafo real, vinculado às ferramentas `provider: 'content'`.

import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';

async function echo(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1);
  const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
  return { messages: [{ role: 'assistant' as const, content: `echo: ${text}` }] };
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('echo', echo)
  .addEdge(START, 'echo')
  .addEdge('echo', END)
  .compile();
