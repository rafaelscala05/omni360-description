// Tipos do Agente Operacional compartilhados pelo módulo e pelo serviço.
// Espelham server/agent/types.ts — mantenha os dois em sincronia.

export type ToolProvider = 'wake' | 'tiny' | 'docs';

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

export interface ThreadAttachment {
  url: string;
  mimeType: string;
  nome: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'model' | 'function';
  texto: string;
  anexos?: ThreadAttachment[];
  actionIds?: string[];
  leituras?: { tool: string; ok: boolean }[];
  createdAt: string;
}

export interface AgentThread {
  id: string;
  titulo: string;
  providers: ToolProvider[];
  createdAt: string;
  updatedAt: string;
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
