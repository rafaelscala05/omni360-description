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
  // Mexe num anúncio público do Mercado Livre — mesma natureza de publicar artigo.
  'meli.proposta.publicar',
  // Vídeo: o débito mais caro do app, num job de minutos que não se desfaz.
  'produtos.video.gerar',
  // Escreve no ERP do cliente, fora do OMNI360.
  'tiny.catalogo.enviar',
];

/** Trava fixa: o modo automático não vale para ela. */
export function isAlwaysAsk(toolName: string): boolean {
  return ALWAYS_ASK_TOOLS.includes(toolName);
}

export const alwaysAskTools = (): string[] => [...ALWAYS_ASK_TOOLS];

/**
 * Sanea o que chega do cliente antes de gravar: só 'ask'/'auto', nomes no
 * formato de ferramenta, e nenhuma trava fixa marcada como automática (ela
 * seria ignorada de qualquer jeito, mas gravada daria a impressão contrária).
 */
export function sanitizeSettings(raw: unknown): AgentSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const approvalMode = r.approvalMode === 'auto' ? 'auto' : 'ask';
  const toolOverrides: Record<string, 'ask' | 'auto'> = {};
  const o = (r.toolOverrides ?? {}) as Record<string, unknown>;
  for (const [nome, modo] of Object.entries(o)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/.test(nome)) continue;
    if (modo !== 'ask' && modo !== 'auto') continue;
    if (modo === 'auto' && isAlwaysAsk(nome)) continue;
    toolOverrides[nome] = modo;
  }
  return { approvalMode, toolOverrides };
}

export function resolveApprovalMode(settings: AgentSettings, toolName: string): 'ask' | 'auto' {
  if (ALWAYS_ASK_TOOLS.includes(toolName)) return 'ask';
  return settings.toolOverrides?.[toolName] ?? settings.approvalMode;
}
