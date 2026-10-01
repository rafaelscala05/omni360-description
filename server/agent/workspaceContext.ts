// O que está aberto na tela do usuário quando ele fala com o agente — mandado
// a cada mensagem/ação pelo cliente (ContentAgentPanel.tsx no workspace de
// conteúdo; "Pedir ao Alfred" de uma tela de Ferramentas) e injetado no system
// prompt por contentGraph.ts. Espelha WorkspaceContext em src/types/agent.ts.
//
// Puro: `sanitizarContexto` roda no servidor principal antes de repassar ao
// grafo, porque o corpo vem do navegador e acaba dentro do system prompt.
// Verificar com `npx tsx scripts/verify-agent-produtos.mjs`.

export interface WorkspaceContext {
  projetoId?: string;
  projetoNome?: string;
  articleId?: string;
  tela?: string;
  skus?: string[];
  totalSelecionados?: number;
}

export const MAX_SKUS_CONTEXTO = 50;
const TELAS = new Set(['produtos']);

const curto = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // Quebra de linha e controle não têm o que fazer num ID/SKU e serviriam
  // para escrever instruções novas dentro do system prompt.
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  return s || undefined;
};

export function sanitizarContexto(raw: unknown): WorkspaceContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: WorkspaceContext = {};
  const projetoId = curto(r.projetoId, 128);
  if (projetoId) out.projetoId = projetoId;
  const projetoNome = curto(r.projetoNome, 160);
  if (projetoNome) out.projetoNome = projetoNome;
  const articleId = curto(r.articleId, 128);
  if (articleId) out.articleId = articleId;
  const tela = curto(r.tela, 32);
  if (tela && TELAS.has(tela)) out.tela = tela;
  if (Array.isArray(r.skus)) {
    const skus = [...new Set(r.skus.map((s) => curto(s, 60)).filter((s): s is string => !!s))].slice(0, MAX_SKUS_CONTEXTO);
    if (skus.length) out.skus = skus;
  }
  const total = Number(r.totalSelecionados);
  if (out.skus && Number.isFinite(total) && total >= out.skus.length) out.totalSelecionados = Math.min(100_000, Math.floor(total));
  return Object.keys(out).length ? out : undefined;
}

/** As linhas do system prompt que descrevem a tela — vazio se não há o que dizer. */
export function linhasDoContexto(contexto: WorkspaceContext | undefined): string[] {
  if (!contexto) return [];
  const partes: string[] = [];
  if (contexto.projetoId) {
    partes.push(`Contexto do workspace: o projeto aberto agora é "${contexto.projetoNome ?? contexto.projetoId}" (projectId: ${contexto.projetoId}).`);
    if (contexto.articleId) partes.push(`Artigo em foco: ${contexto.articleId}.`);
  }
  if (contexto.tela === 'produtos') {
    if (contexto.skus?.length) {
      const total = contexto.totalSelecionados ?? contexto.skus.length;
      const corte = total > contexto.skus.length ? ` (os primeiros ${contexto.skus.length} de ${total})` : '';
      partes.push(
        `Contexto da tela: o usuário veio do catálogo de Produtos com ${total} produto(s) selecionado(s)${corte}. SKUs: ${contexto.skus.join(', ')}.`
        + ' Quando ele disser "estes", "os selecionados" ou não nomear produtos, é destes que está falando: leia-os com produtos.buscar (aceita a lista de SKUs) e, para gravar, passe esses SKUs à ferramenta — nunca troque pelos primeiros incompletos do catálogo.',
      );
    } else {
      partes.push('Contexto da tela: o usuário veio do catálogo de Produtos, sem produto selecionado.');
    }
  }
  return partes;
}
