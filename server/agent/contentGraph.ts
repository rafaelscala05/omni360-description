// Grafo real do Agente de Conteúdo — substitui o grafo de brinquedo das
// Tasks 1/2. Cada thread_id (ver Task 11, checkpointer) corresponde a uma
// conversa; uid e agent_settings chegam via `config.configurable`, montados
// pela ponte REST+SSE (server/agent/contentAgentChat.ts, streamRun()) a
// partir do usuário autenticado — nunca a partir de algo que o modelo decide.

import '../agent/tools/index';
import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { toLangChainTools } from '../agent/registry';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../agent/agentSettings';
import { buildContext } from '../agent/connections';
import type { ToolCtx, ToolProvider } from '../agent/types';
import { FirestoreCheckpointSaver } from './firestoreCheckpointer';
import { linhasDoContexto, type WorkspaceContext } from './workspaceContext';


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
      conexoes.tiny ? '- Tiny ERP (v2): produtos, preço, estoque, pedidos e contatos. Para levar ao Tiny o que foi escrito no catálogo do OMNI360 (descrição, SEO, imagens), use tiny.catalogo.enviar com os SKUs — não tiny.produto.atualizar.' : null,
    ].filter(Boolean).join('\n');
    partes.push(`Plataformas de e-commerce/ERP conectadas nesta conta:\n${plataformas || '- Nenhuma plataforma conectada.'}`);
  }

  const providers = config.configurable?.providers ?? [];
  if (providers.includes('produtos')) {
    partes.push('Catálogo do OMNI360: você lê os produtos (produtos.incompletos.listar, produtos.buscar) e escreve descrição + SEO em lote com produtos.descricoes.gerar — isso grava só no catálogo do OMNI360, não no ERP. Essa ferramenta roda em segundo plano: ela devolve na hora que o lote começou, e o card na conversa mostra o progresso e as descrições prontas para o usuário aprovar. Depois de chamá-la, diga em uma ou duas frases quantos produtos estão sendo escritos e que ele pode revisar e aprovar as prontas no card enquanto o resto termina; não espere o fim, não chame de novo e não peça confirmação no chat. produtos.atributos.gerar funciona igual para os atributos da categoria (cor, material…), de graça, e só para produtos com categoria que define atributos. produtos.video.gerar produz o vídeo de um produto (um por vez, sempre pede aprovação, exige descrição, título SEO e a referência do produto); depois de aprovado ele começa sozinho e aparece em Atividade › Rodando. produtos.categorias.organizar propõe a árvore de categorias para os nomes de "Categoria" do catálogo ainda sem categoria e vincula os produtos, numa aprovação só. produtos.ambientadas.gerar cria 3 imagens ambientadas por produto a partir da foto real, em lote como as descrições (até 10; debita uma ambientação por produto aprovado).');
  }
  if (providers.includes('meli')) {
    partes.push('Mercado Livre: meli.propostas.listar e meli.proposta.ver leem as propostas do otimizador; meli.proposta.publicar publica as mudanças escolhidas e sempre pede aprovação.');
  }

  partes.push(...linhasDoContexto(contexto));

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
