// Tipos do agente unificado (Conteúdo + Operações), compartilhados pelo
// módulo e pelo serviço. Espelham server/agent/types.ts — mantenha os dois
// em sincronia.

export type ToolProvider = 'wake' | 'tiny' | 'docs' | 'content';

export interface PreviewField {
  campo: string;
  antes: unknown;
  depois: unknown;
  mudou: boolean;
}

export interface ActionPreview {
  resumo: string;
  alvo: string;
  campos: PreviewField[];
  avisos: string[];
  /** Nome da ferramenta e argumentos originais — dá pra UI renderizar um
   * formulário específico por ferramenta (ex.: content.credencial.conectar)
   * em vez do diff padrão. Sempre presentes: registry.ts inclui os dois em
   * todo interrupt(), de qualquer provider. */
  ferramenta?: string;
  args?: Record<string, unknown>;
}

export type AgentActionStatus = 'pending' | 'executed' | 'failed' | 'rejected';

export interface AgentAction {
  id: string;
  threadId: string;
  tool: string;
  provider: ToolProvider;
  args: Record<string, unknown>;
  preview: ActionPreview;
  status: AgentActionStatus;
  createdAt: string;
  resolvedAt?: string;
  result?: unknown;
  error?: string;
  dryRun?: boolean;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'model';
  texto: string;
  actionIds?: string[];
  leituras?: { tool: string; ok: boolean; erro?: string }[];
  createdAt: string;
}

export interface AgentConnections {
  wake: boolean;
  tiny: boolean;
  providers: ToolProvider[];
}

export interface AgentToolInfo {
  name: string;
  provider: ToolProvider;
  mode: 'read' | 'write';
  description: string;
}

export interface AgentLog {
  id: string;
  provider: 'wake' | 'tiny';
  tool?: string;
  /** GET/POST/PUT na Wake; nome do endpoint .php no Tiny. */
  operacao: string;
  alvo: string;
  requisicao?: unknown;
  resposta?: unknown;
  status: number | null;
  ok: boolean;
  erro?: string | null;
  ms: number;
  at: string;
}

// O que está aberto no workspace de conteúdo agora (projeto selecionado,
// artigo em foco) — mandado a cada mensagem/ação pra o agente saber por
// padrão de qual projeto o usuário está falando, sem precisar perguntar o
// ID (que a UI nunca mostra). Espelha WorkspaceContext em
// server/agent/contentGraph.ts.
export interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
}
