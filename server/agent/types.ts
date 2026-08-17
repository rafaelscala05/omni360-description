// Shared types for the Agente Operacional (operational agent) module.
//
// The central idea is that a tool is declared once, in a transport-agnostic
// shape, and every consumer derives from it: today the Gemini function-calling
// loop (server/agent/loop.ts), tomorrow an MCP server (tools/list + tools/call).
// Nothing here imports express, @google/genai or firebase — keep it that way so
// the registry stays portable.

/** Minimal JSON Schema subset we accept for tool parameters. */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export type ToolProvider = 'wake' | 'tiny' | 'docs';

/**
 * Per-request execution context handed to every tool. Credentials are resolved
 * lazily (and throw a 401-shaped error when the integration is not connected)
 * so a tool never has to know where the token lives.
 */
export interface ToolCtx {
  uid: string;
  /** When true, write tools must compute the payload but skip the outbound call. */
  dryRun: boolean;
  wakeToken(): Promise<string>;
  tinyToken(): Promise<string>;
}

/** One row of the before/after table rendered in the approval card. */
export interface PreviewField {
  campo: string;
  antes: unknown;
  depois: unknown;
  mudou: boolean;
}

/**
 * What the user is asked to approve. `antes` always comes from a live read of
 * the remote system, never from the model's assumption.
 *
 * `payload` is the exact request body computed at preview time; execute() reuses
 * it verbatim, which is what guarantees that what was shown is what runs.
 */
export interface ActionPreview {
  resumo: string;
  alvo: string;
  campos: PreviewField[];
  avisos: string[];
  payload?: Record<string, unknown>;
}

export interface ToolDef<A = Record<string, unknown>> {
  name: string;
  provider: ToolProvider;
  mode: 'read' | 'write';
  description: string;
  schema: ToolSchema;
  /** Required when mode === 'read'. Runs inline in the loop, no confirmation. */
  read?: (ctx: ToolCtx, args: A) => Promise<unknown>;
  /** Required when mode === 'write'. Must perform a live read to build `antes`. */
  preview?: (ctx: ToolCtx, args: A) => Promise<ActionPreview>;
  /** Required when mode === 'write'. Only ever called from actions.ts, after approval. */
  execute?: (ctx: ToolCtx, args: A, preview: ActionPreview) => Promise<unknown>;
}

export type AgentActionStatus = 'pending' | 'executed' | 'failed' | 'rejected';

/** Firestore doc at users/{uid}/agent_actions/{id}. */
export interface AgentAction {
  id: string;
  threadId: string;
  tool: string;
  provider: ToolProvider;
  args: Record<string, unknown>;
  preview: ActionPreview;
  status: AgentActionStatus;
  /** Gemini function-call id, used to resume the loop with the matching response. */
  callId?: string;
  createdAt: string;
  resolvedAt?: string;
  result?: unknown;
  error?: string;
  dryRun?: boolean;
}

export type ThreadRole = 'user' | 'model';

export interface ThreadAttachment {
  url: string;
  mimeType: string;
  nome: string;
}

/** Firestore doc at users/{uid}/agent_threads/{threadId}/messages/{id}. */
export interface ThreadMessage {
  id: string;
  role: ThreadRole;
  texto: string;
  anexos?: ThreadAttachment[];
  /** Ids of agent_actions proposed by this model turn. */
  actionIds?: string[];
  /** Read-tool calls made during this turn, for transparency in the UI. */
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
