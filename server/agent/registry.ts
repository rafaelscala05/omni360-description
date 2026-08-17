// Transport-agnostic tool registry — the "MCP" of the operational agent.
//
// Tools register themselves here at import time. Consumers ask for the subset
// they're allowed to see and convert it to their own wire format. Today that's
// Gemini FunctionDeclarations; a future server/agent/mcp.ts maps the same list
// to MCP tools/list and tools/call without touching a single tool definition.

import type { ToolDef, ToolProvider, ToolSchema } from './types';

const tools = new Map<string, ToolDef<any>>();

export function registerTool<A>(def: ToolDef<A>): void {
  if (tools.has(def.name)) {
    throw new Error(`Ferramenta duplicada no registry: ${def.name}`);
  }
  // Fail loudly at boot rather than at the first model call — a write tool
  // without preview() would be a hole in the approval invariant.
  if (def.mode === 'write' && (!def.preview || !def.execute)) {
    throw new Error(`Ferramenta de escrita "${def.name}" precisa de preview() e execute().`);
  }
  if (def.mode === 'read' && !def.read) {
    throw new Error(`Ferramenta de leitura "${def.name}" precisa de read().`);
  }
  // Gemini/Vertex constrain function names to [a-zA-Z0-9_.:-]{1,64}.
  if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/.test(def.name)) {
    throw new Error(`Nome de ferramenta inválido para function calling: ${def.name}`);
  }
  tools.set(def.name, def as ToolDef<any>);
}

export function getTool(name: string): ToolDef<any> | undefined {
  return tools.get(name);
}

/** All tools for the given providers, sorted for a stable prompt. */
export function listTools(providers: ToolProvider[]): ToolDef<any>[] {
  const allowed = new Set(providers);
  return [...tools.values()]
    .filter((t) => allowed.has(t.provider))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Introspection payload for GET /api/agent/tools (and the future MCP tools/list). */
export function describeTools(providers: ToolProvider[]) {
  return listTools(providers).map((t) => ({
    name: t.name,
    provider: t.provider,
    mode: t.mode,
    description: t.description,
    inputSchema: t.schema,
  }));
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: ToolSchema;
}

/**
 * Gemini wire format. The write-mode marker is appended to the description so
 * the model knows the call will pause for human approval instead of returning a
 * result immediately — without it, models tend to re-call the tool thinking it
 * failed.
 */
export function toGeminiDeclarations(providers: ToolProvider[]): GeminiFunctionDeclaration[] {
  return listTools(providers).map((t) => ({
    name: t.name,
    description: t.mode === 'write'
      ? `${t.description}\n[ESCRITA] Esta ação altera dados reais e será apresentada ao usuário para aprovação antes de rodar. Chame uma vez e aguarde o resultado.`
      : t.description,
    parametersJsonSchema: t.schema,
  }));
}

/** Test seam — lets the verify script build an isolated registry. */
export function _resetRegistry(): void {
  tools.clear();
}
