// Tipos do Agente de Conteúdo conversacional. Espelham src/types/agent.ts
// (Agente Operacional), com dois campos a mais em ActionPreview
// (ferramenta/args) porque o card de aprovação precisa saber qual
// ferramenta pausou para decidir se renderiza o diff padrão ou um
// formulário específico (ex.: content.credencial.conectar). Sem anexos por
// enquanto — nenhuma tool do Agente de Conteúdo consome arquivos hoje.

export interface PreviewField {
  campo: string;
  antes: unknown;
  depois: unknown;
  mudou: boolean;
}

export interface ContentActionPreview {
  resumo: string;
  alvo: string;
  campos: PreviewField[];
  avisos: string[];
  ferramenta?: string;
  args?: Record<string, unknown>;
}

export type ContentAgentActionStatus = 'pending' | 'executed' | 'failed' | 'rejected';

export interface ContentAgentAction {
  id: string;
  threadId: string;
  tool: string;
  args: Record<string, unknown>;
  preview: ContentActionPreview;
  status: ContentAgentActionStatus;
  createdAt: string;
  resolvedAt?: string;
  result?: unknown;
  error?: string;
}

export interface ContentThreadMessage {
  id: string;
  role: 'user' | 'model';
  texto: string;
  actionIds?: string[];
  leituras?: { tool: string; ok: boolean; erro?: string }[];
  createdAt: string;
}

export interface ContentAgentThread {
  id: string;
  titulo: string;
  createdAt: string;
  updatedAt: string;
}

// O que está aberto no workspace agora (projeto selecionado, artigo em
// foco) — mandado a cada mensagem/ação pra o agente saber por padrão de
// qual projeto o usuário está falando, sem precisar perguntar o ID (que a
// UI nunca mostra). Espelha WorkspaceContext em server/agent/contentGraph.ts.
export interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
}
