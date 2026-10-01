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
  /** Mercado Livre: anúncios (MLB…) selecionados. */
  anuncios?: string[];
  /** Conteúdo: artigos selecionados na produção (do projetoId). */
  artigos?: { id: string; titulo?: string }[];
}

export const MAX_SKUS_CONTEXTO = 50;
const TELAS = new Set(['produtos', 'meli', 'conteudo']);

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
  if (Array.isArray(r.anuncios)) {
    // Código de anúncio é MLB + dígitos: qualquer outra coisa é descartada.
    const anuncios = [...new Set(r.anuncios.map((s) => curto(s, 24)?.toUpperCase()).filter((s): s is string => !!s && /^[A-Z]{3}\d{6,15}$/.test(s)))].slice(0, MAX_SKUS_CONTEXTO);
    if (anuncios.length) out.anuncios = anuncios;
  }
  if (Array.isArray(r.artigos)) {
    const artigos = r.artigos
      .map((a) => (a && typeof a === 'object' ? a as Record<string, unknown> : null))
      .map((a) => a && { id: curto(a.id, 128), titulo: curto(a.titulo, 160) })
      .filter((a): a is { id: string; titulo: string | undefined } => !!a?.id)
      .slice(0, MAX_SKUS_CONTEXTO)
      .map((a) => (a.titulo ? { id: a.id, titulo: a.titulo } : { id: a.id }));
    if (artigos.length) out.artigos = artigos;
  }
  const total = Number(r.totalSelecionados);
  const listados = out.skus?.length ?? out.anuncios?.length ?? out.artigos?.length;
  if (listados && Number.isFinite(total) && total >= listados) out.totalSelecionados = Math.min(100_000, Math.floor(total));
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
  if (contexto.tela === 'meli' && contexto.anuncios?.length) {
    partes.push(
      `Contexto da tela: o usuário veio do Mercado Livre com ${contexto.totalSelecionados ?? contexto.anuncios.length} anúncio(s) selecionado(s): ${contexto.anuncios.join(', ')}.`
      + ' "Estes" ou "os selecionados" são esses anúncios: leia cada um com meli.proposta.ver antes de responder.',
    );
  }
  if (contexto.tela === 'conteudo' && contexto.artigos?.length) {
    const lista = contexto.artigos.map((a) => (a.titulo ? `"${a.titulo}" (${a.id})` : a.id)).join(', ');
    partes.push(
      `Contexto da tela: o usuário veio da produção de artigos${contexto.projetoId ? ` do projeto ${contexto.projetoId}` : ''} com ${contexto.artigos.length} artigo(s) selecionado(s): ${lista}.`
      + ' "Estes" ou "os selecionados" são esses artigos; use os ids acima nas ferramentas de conteúdo.',
    );
  }
  return partes;
}
