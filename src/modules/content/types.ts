// Data model for the "Agência de Criação de Conteúdo" (Alfred) module.
//
// Everything is segmented per user under `users/{uid}/contentProjects/{projectId}`
// (multiple companies/brands per user). See the plan and alfred_agent_prompt.md.

// ----------------------------------------------------------------------------
// Project configuration (Fase 1 — Onboarding)
// ----------------------------------------------------------------------------

export interface ContentProjectConfig {
  nomeEmpresa: string;
  descricao: string;
  produtoServico: string;
  publicoAlvo: string;
  tomDeVoz: string;
  objetivos: string[];
  palavrasChave: string[];
  referencias: string[];
  frequenciaPostagens: string; // ex.: "2x por semana", "4x por mês"
  // WordPress publishing. The Application Password is sensitive and must never be
  // readable by the client — it lives in a separate secrets subdoc (see below) and
  // is read only by the server via the Admin SDK.
  wordpressUrl: string;
  wordpressUser: string;
}

export type ContentProjectStatus = 'onboarding' | 'ativo' | 'pausado';

export interface ContentProject {
  id: string;
  config: ContentProjectConfig;
  status: ContentProjectStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// Sensitive secret, stored at `.../contentProjects/{id}/secrets/wordpress`.
// Firestore rules forbid client reads; only the Admin SDK (server) reads it.
export interface WordpressSecret {
  appPassword: string;
}

// ----------------------------------------------------------------------------
// Clusters (Fase 2)
// ----------------------------------------------------------------------------

export interface ClusterArticleIdea {
  titulo: string;
  kw: string;
}

export interface ContentCluster {
  id: string;
  nome: string;
  estrategia: string;
  artigos: ClusterArticleIdea[];
  aprovado: boolean;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// Editorial calendar + articles (Fase 3, 4, 5)
// ----------------------------------------------------------------------------

export type ArticleStatus =
  | 'agendado'
  | 'em_producao'
  | 'revisao'
  | 'aprovado'
  | 'publicado'
  | 'erro';

// Pipeline stage 1..5: DeepResearch → Outline → Draft → Image → Review.
export type ArticleStage = 0 | 1 | 2 | 3 | 4 | 5;

export interface CalendarArticle {
  id: string;
  titulo: string;
  kwPrincipal: string;
  clusterId: string;
  scheduledDate: string; // ISO date (YYYY-MM-DD)
  status: ArticleStatus;
  stage: ArticleStage;
  // Outputs accumulated by the 5-stage pipeline.
  researchBrief?: string;
  articleOutline?: string;
  articleDraft?: string;
  imageUrl?: string;
  articleFinal?: string;
  metaDescription?: string;
  slug?: string;
  // Publication results (Fase 5).
  urlPublicado?: string;
  dataPublicacao?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
