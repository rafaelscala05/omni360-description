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
// não é uma ação que aceita "rodar sem perguntar".
const ALWAYS_ASK_TOOLS: readonly string[] = [
  'content.artigo.publicar',
  'content.artigo.despublicar',
];

export function resolveApprovalMode(settings: AgentSettings, toolName: string): 'ask' | 'auto' {
  if (ALWAYS_ASK_TOOLS.includes(toolName)) return 'ask';
  return settings.toolOverrides?.[toolName] ?? settings.approvalMode;
}
