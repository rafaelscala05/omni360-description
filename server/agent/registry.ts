// Transport-agnostic tool registry — the "MCP" of the unified agent.
//
// Tools register themselves here at import time. Consumers ask for the subset
// they're allowed to see and convert it to their own wire format. Today that's
// LangChain/LangGraph tools (toLangChainTools, below); a future
// server/agent/mcp.ts maps the same list to MCP tools/list and tools/call
// without touching a single tool definition.

import type { ToolDef, ToolProvider, ToolSchema, ToolCtx } from './types';
import { tool } from '@langchain/core/tools';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { interrupt, isGraphInterrupt } from '@langchain/langgraph';
import * as z from 'zod';
import { resolveApprovalMode, type AgentSettings } from './agentSettings';
import { estimateCredits, recordAutoAction, runApprovedWrite } from './execution';

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
  // Objeto sem `properties` vira um schema que o Vertex AI recusa com HTTP 400
  // — e o catálogo inteiro é vinculado de uma vez, então uma ferramenta assim
  // derruba o chat de toda conta que tem o provider dela conectado.
  const aberto = objetoAberto(def.schema, '');
  if (aberto) {
    throw new Error(`Ferramenta "${def.name}": "${aberto}" é um objeto sem properties, que o Vertex AI recusa. Declare as properties ou receba como string (JSON).`);
  }
  tools.set(def.name, def as ToolDef<any>);
}

function objetoAberto(s: unknown, caminho: string): string | null {
  const n = (s ?? {}) as { type?: unknown; properties?: Record<string, unknown>; items?: unknown };
  if (caminho && n.type === 'object' && !n.properties) return caminho;
  for (const [k, v] of Object.entries(n.properties ?? {})) {
    const achou = objetoAberto(v, caminho ? `${caminho}.${k}` : k);
    if (achou) return achou;
  }
  return n.items ? objetoAberto(n.items, `${caminho}[]`) : null;
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

/** Test seam — lets the verify script build an isolated registry. */
export function _resetRegistry(): void {
  tools.clear();
}

// LangChain tools exigem um schema Zod; o registry guarda JSON Schema puro
// (para ser reaproveitável pelo Gemini function-calling e, no futuro, MCP).
// Testado ao vivo: um z.object({}).passthrough() vazio esconde os nomes e
// tipos dos campos do modelo — sem ver o schema real, ele inventa nomes
// (ex.: "nome_empresa" em vez de "nomeEmpresa") e as ferramentas falham por
// "parâmetro obrigatório ausente". Por isso a conversão abaixo é real, campo
// a campo, e não um passthrough.
function jsonSchemaPropertyToZod(prop: unknown): z.ZodTypeAny {
  const p = (prop ?? {}) as Record<string, unknown>;
  const description = typeof p.description === 'string' ? p.description : undefined;

  let base: z.ZodTypeAny;
  if (Array.isArray(p.enum) && p.enum.every((v) => typeof v === 'string')) {
    base = z.enum(p.enum as [string, ...string[]]);
  } else if (p.type === 'array') {
    base = z.array(jsonSchemaPropertyToZod(p.items));
  } else if (p.type === 'number' || p.type === 'integer') {
    base = z.number();
  } else if (p.type === 'boolean') {
    base = z.boolean();
  } else if (p.type === 'object') {
    // Testado ao vivo: um objeto aberto (z.record) vira, na conversão pro
    // formato de function declaration do Vertex AI, um schema sem
    // `properties` — a API recusa com HTTP 400 em TODA a chamada do modelo
    // (não só quando essa ferramenta é usada), porque o catálogo inteiro é
    // vinculado de uma vez. Quando o JSON Schema já define `properties`
    // aninhadas, respeita-as recursivamente; só cai pro objeto aberto quando
    // não há nada declarado (não deveria acontecer em nenhuma ferramenta
    // registrada, mas evita quebrar tudo se acontecer).
    base = p.properties && typeof p.properties === 'object'
      ? jsonSchemaToZod(p as unknown as ToolSchema)
      : z.record(z.string(), z.unknown());
  } else {
    base = z.string();
  }
  return description ? base.describe(description) : base;
}

function jsonSchemaToZod(schema: ToolSchema) {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const field = jsonSchemaPropertyToZod(prop);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return z.object(shape);
}

/**
 * Converte o registry em ferramentas do LangChain/LangGraph. Ferramentas de
 * leitura chamam `.read()` direto. Ferramentas de escrita sempre chamam
 * `.preview()`; a partir daí, ou seguem para `.execute()` (modo automático
 * para aquele tool) ou pausam o grafo com `interrupt()` até a aprovação — o
 * mesmo invariante do loop do Operacional, só que via LangGraph em vez de
 * `agent_actions`.
 */
export function toLangChainTools(
  providers: ToolProvider[],
  ctx: ToolCtx,
  settings: AgentSettings,
): DynamicStructuredTool[] {
  return listTools(providers).map((def) =>
    tool(
      // Erros de qualquer ferramenta (read/preview/execute) viram texto de
      // retorno em vez de exceção — uma exceção aqui derrubaria o nó do grafo
      // inteiro; devolver o erro como resultado deixa o modelo explicar ao
      // usuário e tentar de novo, mesmo espírito de sendError() nas rotas
      // HTTP existentes, sem ter uma resposta HTTP no meio.
      async (args: Record<string, unknown>) => {
        try {
          if (def.mode === 'read') {
            return await def.read!(ctx, args);
          }

          const mode = resolveApprovalMode(settings, def.name);

          // Lote em job: o preview() criou o lote e a ação e já devolveu. Não
          // há interrupt — a aprovação é por item, no card, pela rota do lote
          // (loteRoutes.ts), e no automático o próprio worker grava cada item
          // pronto. O modelo só fica sabendo que começou.
          if (def.lote) {
            const preview = await def.preview!({ ...ctx, aprovacao: mode }, args);
            const lote = (preview.payload?.lote ?? {}) as { id?: string; actionId?: string; reaproveitado?: boolean };
            return {
              acaoLote: lote.actionId,
              lote: lote.id,
              resumo: preview.resumo,
              status: lote.reaproveitado ? 'este mesmo lote já estava em andamento' : 'iniciado',
              proximoPasso: mode === 'auto'
                ? 'Roda em segundo plano e grava cada item assim que fica pronto (aprovação automática ligada). Não chame de novo.'
                : 'Roda em segundo plano. As descrições aparecem no card conforme ficam prontas, e o usuário revisa e aprova lá — inclusive as prontas antes do fim. Não chame de novo nem peça confirmação no chat.',
            };
          }

          const preview = await def.preview!(ctx, args);
          if (mode === 'auto') {
            try {
              const result = await runApprovedWrite(ctx, def, args, preview);
              await recordAutoAction(ctx, def, args, preview, { result });
              return result;
            } catch (err) {
              await recordAutoAction(ctx, def, args, preview, { error: err instanceof Error ? err.message : String(err) });
              throw err;
            }
          }

          const decisao = interrupt({
            ferramenta: def.name,
            resumo: preview.resumo,
            alvo: preview.alvo,
            campos: preview.campos,
            avisos: preview.avisos,
            // Lote: antes/depois por item e o custo em créditos — a aprovação
            // mostra uma amostra navegável e quanto vai gastar antes de gastar.
            ...(preview.itens?.length ? { itens: preview.itens } : {}),
            // A prévia pode trazer o próprio custo quando o débito acontece fora
            // de runApprovedWrite (o vídeo debita na rota que o roda).
            custo: preview.custo ?? await estimateCredits(def, preview),
            // Argumentos originais da chamada — dá pro frontend renderizar UI
            // específica por ferramenta (ex.: content.credencial.conectar
            // usa args.provider/args.projectId pra saber qual formulário
            // mostrar) sem precisar inventar um novo campo por caso de uso.
            args,
          }) as { aprovado: boolean; ajuste?: string };

          // "Ajustar no chat" (A3): não aprovou, mas disse o que mudar. Volta ao
          // modelo como resultado desta chamada — o turno segue e ele propõe de
          // novo, já ajustado, em vez de a conversa terminar num "cancelado".
          if (!decisao?.aprovado && decisao?.ajuste) {
            return `Proposta NÃO aprovada. Antes de gravar, o usuário pediu este ajuste: "${decisao.ajuste}". Refaça a proposta com o ajuste, chamando ${def.name} de novo com os argumentos corrigidos. Se o ajuste não couber nesta ferramenta, explique em uma frase.`;
          }
          if (!decisao?.aprovado) return 'Ação cancelada pelo usuário.';
          return await runApprovedWrite(ctx, def, args, preview);
        } catch (err) {
          // interrupt() propaga suspendendo a execução via uma exceção
          // especial (GraphInterrupt) que o runtime do LangGraph precisa
          // enxergar subir — testado ao vivo: sem este re-throw, o catch
          // genérico abaixo a transforma em "Erro ao executar..." e a
          // aprovação nunca pausa o grafo de verdade.
          if (isGraphInterrupt(err)) throw err;
          const e = err as { status?: number; message?: string };
          return `Erro ao executar ${def.name}: ${e.message ?? 'erro desconhecido'}`;
        }
      },
      {
        name: def.name,
        description: def.mode === 'write'
          ? `${def.description}\n[ESCRITA] Esta ação será apresentada ao usuário para aprovação antes de rodar.`
          : def.description,
        schema: jsonSchemaToZod(def.schema),
      },
    ),
  );
}
