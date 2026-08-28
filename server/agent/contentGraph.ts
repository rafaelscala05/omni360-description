// Grafo real do Agente de Conteúdo — substitui o grafo de brinquedo das
// Tasks 1/2. Cada thread_id (ver Task 11, checkpointer) corresponde a uma
// conversa; uid e agent_settings chegam via `config.configurable`, montados
// pelo runtime do CopilotKit (server/copilotRuntime.ts) a partir do usuário
// autenticado — nunca a partir de algo que o modelo decide.

import '../agent/tools/content';
import '../agent/tools/contentSeo';
import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { toLangChainTools } from '../agent/registry';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../agent/agentSettings';
import type { ToolCtx } from '../agent/types';
import { FirestoreCheckpointSaver } from './firestoreCheckpointer';

const SYSTEM_PROMPT = [
  'Você é o Agente de Conteúdo do Alfreds — cuida da criação e publicação de',
  'conteúdo (clusters, calendário editorial, artigos, SEO) para o e-commerce',
  'do usuário. Responda sempre em português do Brasil. Nunca peça senhas,',
  'tokens ou credenciais pelo chat — se precisar conectar WordPress ou',
  'Sanity, avise o usuário para usar o formulário de conexão.',
].join(' ');

interface ContentGraphConfig {
  configurable?: { uid?: string; settings?: AgentSettings };
}

function buildTools(config: ContentGraphConfig) {
  const uid = config.configurable?.uid;
  if (!uid) throw new Error('uid ausente na configuração do grafo — o runtime do CopilotKit deveria sempre fornecer.');
  const settings = config.configurable?.settings ?? DEFAULT_AGENT_SETTINGS;
  // Ferramentas de conteúdo não usam wakeToken()/tinyToken() — só uid/dryRun.
  const ctx: ToolCtx = {
    uid,
    dryRun: false,
    wakeToken: async () => { throw new Error('wakeToken indisponível para o Agente de Conteúdo'); },
    tinyToken: async () => { throw new Error('tinyToken indisponível para o Agente de Conteúdo'); },
  };
  return toLangChainTools(['content'], ctx, settings);
}

async function callModel(state: typeof MessagesAnnotation.State, config: ContentGraphConfig) {
  const tools = buildTools(config);
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    location: process.env.VERTEX_LOCATION || 'us-central1',
    authOptions: { projectId: process.env.VERTEX_PROJECT_ID },
  }).bindTools(tools);

  const response = await model.invoke([{ role: 'system', content: SYSTEM_PROMPT }, ...state.messages]);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1) as { tool_calls?: unknown[] } | undefined;
  return last?.tool_calls?.length ? 'tools' : END;
}

async function toolsNode(state: typeof MessagesAnnotation.State, config: ContentGraphConfig) {
  const node = new ToolNode(buildTools(config));
  return node.invoke(state, config as never);
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, ['tools', END])
  .addEdge('tools', 'agent')
  .compile({ checkpointer: new FirestoreCheckpointSaver() });
