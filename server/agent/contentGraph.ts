// Grafo real do Agente de Conteúdo — substitui o grafo de brinquedo das
// Tasks 1/2. Cada thread_id (ver Task 11, checkpointer) corresponde a uma
// conversa; uid e agent_settings chegam via `config.configurable`, montados
// pela ponte REST+SSE (server/agent/contentAgentChat.ts, streamRun()) a
// partir do usuário autenticado — nunca a partir de algo que o modelo decide.

import '../agent/tools/content';
import '../agent/tools/contentSeo';
import '../agent/tools/contentBlog';
import '../agent/tools/wake';
import '../agent/tools/tiny';
import '../agent/tools/discovery';
import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { toLangChainTools } from '../agent/registry';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../agent/agentSettings';
import { buildContext } from '../agent/connections';
import type { ToolCtx, ToolProvider } from '../agent/types';
import { FirestoreCheckpointSaver } from './firestoreCheckpointer';

interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
}

interface ContentGraphConfig {
  configurable?: {
    uid?: string;
    settings?: AgentSettings;
    contexto?: WorkspaceContext;
    providers?: ToolProvider[];
    conexoes?: { wake: boolean; tiny: boolean };
  };
}

const SYSTEM_PROMPT = [
  'Você é o Agente do Alfreds: cuida da criação e publicação de conteúdo',
  '(clusters, calendário editorial, artigos, SEO) e opera a loja/ERP do',
  'usuário (Wake Commerce, Tiny ERP) através das ferramentas disponíveis.',
  'Responda sempre em português do Brasil. Nunca peça senhas, tokens ou',
  'credenciais pelo chat — se precisar conectar uma integração, avise o',
  'usuário para usar o formulário de conexão correspondente.',
  'Ferramentas de LEITURA rodam na hora. Ferramentas de ESCRITA não',
  'executam quando você as chama — elas montam uma prévia com o antes/depois',
  'real e param para o usuário aprovar. Chame uma vez e aguarde; não repita',
  'a chamada achando que falhou. Proponha no máximo uma escrita por vez.',
  'Nunca invente SKU, id, preço ou qualquer identificador de e-commerce/ERP',
  '— descubra com uma ferramenta de leitura ou pergunte.',
  'Nunca peça o ID de um projeto de conteúdo ao usuário — ele não vê IDs na',
  'UI, só nomes. Se o contexto do workspace abaixo indicar um projeto',
  'aberto, use o ID dele por padrão sem perguntar. Se não houver, ou o',
  'usuário mencionar outro projeto por nome, chame content.projetos.listar',
  'para resolver o nome em ID antes de qualquer outra ferramenta que',
  'precise de projectId.',
].join(' ');

// Injetado a cada chamada (não fixo no bind do modelo) porque reflete o
// contexto/conexões NO MOMENTO da mensagem — ver
// server/agent/contentAgentChat.ts, que resolve providers/conexoes por
// requisição a partir dos módulos habilitados na conta e das credenciais
// Wake/Tiny conectadas.
function buildSystemPrompt(config: ContentGraphConfig): string {
  const contexto = config.configurable?.contexto;
  const conexoes = config.configurable?.conexoes;
  const partes = [SYSTEM_PROMPT];

  if (conexoes) {
    const plataformas = [
      conexoes.wake ? '- Wake Commerce (loja/e-commerce): banners, hotsites, produtos, preço, estoque e SEO.' : null,
      conexoes.tiny ? '- Tiny ERP (v2): produtos, preço, estoque, pedidos e contatos.' : null,
    ].filter(Boolean).join('\n');
    partes.push(`Plataformas de e-commerce/ERP conectadas nesta conta:\n${plataformas || '- Nenhuma plataforma conectada.'}`);
  }

  if (contexto?.projetoId) {
    partes.push(`Contexto do workspace: o projeto aberto agora é "${contexto.projetoNome ?? contexto.projetoId}" (projectId: ${contexto.projetoId}).`);
    if (contexto.articleId) partes.push(`Artigo em foco: ${contexto.articleId}.`);
  }

  return partes.join(' ');
}

function buildTools(config: ContentGraphConfig) {
  const uid = config.configurable?.uid;
  if (!uid) throw new Error('uid ausente na configuração do grafo — server/agent/contentAgentChat.ts deveria sempre fornecer.');
  const settings = config.configurable?.settings ?? DEFAULT_AGENT_SETTINGS;
  const providers = config.configurable?.providers ?? ['content'];
  const ctx: ToolCtx = buildContext(uid);
  return toLangChainTools(providers, ctx, settings);
}

async function callModel(state: typeof MessagesAnnotation.State, config: ContentGraphConfig) {
  const tools = buildTools(config);
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    location: process.env.VERTEX_LOCATION || 'us-central1',
    authOptions: { projectId: process.env.VERTEX_PROJECT_ID },
  }).bindTools(tools);

  const response = await model.invoke([{ role: 'system', content: buildSystemPrompt(config) }, ...state.messages]);
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
