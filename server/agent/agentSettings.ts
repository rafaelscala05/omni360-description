// Configuração de aprovação por usuário, users/{uid}/agent_settings. Pura e
// sem I/O — quem lê/escreve o doc no Firestore é o chamador (o node do grafo
// que monta o ToolCtx); isto só resolve a decisão dado o estado já carregado.

export interface AgentSettings {
  approvalMode: 'ask' | 'auto';
  toolOverrides?: Record<string, 'ask' | 'auto'>;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { approvalMode: 'ask' };

// Trava estrutural: nada aqui muda o comportamento dessas ferramentas, não
// importa o que o usuário configurou. Publicar expõe conteúdo publicamente;
// conectar credencial exige preencher um formulário — nenhuma das duas
// aceita "rodar sem perguntar".
const ALWAYS_ASK_TOOLS: readonly string[] = [
  'content.artigo.publicar',
  'content.artigo.despublicar',
  'content.credencial.conectar',
  // Apaga o projeto inteiro em cascata (clusters, calendário, blog, credenciais
  // conectadas): irreversível e alto raio de impacto, diferente das outras
  // exclusões (cluster/artigo/post/categoria), que seguem o modo configurado.
  'content.projeto.excluir',
];

export function resolveApprovalMode(settings: AgentSettings, toolName: string): 'ask' | 'auto' {
  if (ALWAYS_ASK_TOOLS.includes(toolName)) return 'ask';
  return settings.toolOverrides?.[toolName] ?? settings.approvalMode;
}
