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
  publicoAlvo: string[];
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
  // Sanity publishing. The API token is sensitive — stored in a separate
  // secrets subdoc (secrets/sanity), never readable by the client.
  sanityProjectId: string;
  sanityDataset: string;
  estiloImagem?: 'Realista' | 'Ilustracao' | '3D' | 'Cartoon';
  // URL do site do cliente, capturada no passo "Analisar site com IA" do
  // onboarding. Reaproveitada para disparar a Auditoria de SEO (SE Ranking).
  siteUrl?: string;
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

// Sensitive secret, stored at `.../contentProjects/{id}/secrets/sanity`.
// Firestore rules forbid client reads; only the Admin SDK (server) reads it.
export interface SanitySecret {
  apiToken: string;
}

// ----------------------------------------------------------------------------
// Auditoria de SEO (SE Ranking Data API) — insumo para a geração de Clusters
// ----------------------------------------------------------------------------

export type AuditStageStatus = 'processing' | 'finished' | 'failed' | 'canceled';

export interface SeoAuditIssue {
  code: string;
  title: string;
  severity: 'error' | 'warning' | 'notice';
  count: number;
}

// SE Ranking's position-distribution buckets from domain/overview/db.
export interface DomainPositionBuckets {
  top1_5?: number;
  top6_10?: number;
  top11_20?: number;
  top21_50?: number;
  top51_100?: number;
}

export interface DomainOverviewStats {
  keywordsCount?: number;
  trafficEstimate?: number;
  priceEstimate?: number; // valor estimado do tráfego orgânico em anúncios equivalentes
  positions?: DomainPositionBuckets;
}

export interface DomainHistoryPoint {
  year?: number;
  month?: number;
  keywordsCount?: number;
  trafficEstimate?: number;
}

// Crawl (technical site audit) and Domain Analysis run as two INDEPENDENT
// stages: the crawl is slow/async (needs polling, can be canceled), Domain
// Analysis is a handful of fast calls resolved synchronously when the audit is
// triggered. Neither stage's completion depends on the other. Cluster
// generation only needs domainStatus === 'finished' (keywordPool); the crawl
// fields are supplementary technical context for the prompt.
export interface SeoAudit {
  id: string;
  domain: string;

  // Crawl (site-audit) — polled via /seo-audit/:id/refresh, cancelable.
  // Desativado por ora no servidor (CRAWL_ENABLED em seoAgent.ts) — por isso
  // opcional: um audit disparado enquanto desativado nunca preenche estes campos.
  seRankingAuditId?: number;
  crawlStatus?: AuditStageStatus;
  crawlErrorMessage?: string;
  healthScore?: number;      // score_percent (0-100) do relatório do SE Ranking
  pagesCrawled?: number;
  totalErrors?: number;
  totalWarnings?: number;
  totalNotices?: number;
  totalPassed?: number;
  topIssues?: SeoAuditIssue[];

  // Domain Analysis (SE Ranking domain/*) — resolvido no próprio trigger.
  domainStatus: AuditStageStatus;
  domainErrorMessage?: string;
  domainOverview?: DomainOverviewStats;
  domainHistory?: DomainHistoryPoint[];
  domainTrend?: string;
  competitorDomain?: string; // extraído de "Referências/concorrentes", se algum parecer um domínio válido
  domainKeywords?: ClusterKeyword[];     // o que o domínio já rankeia (detalhado, completo)
  domainGapKeywords?: ClusterKeyword[];  // lacuna vs. concorrente (detalhado, completo)
  keywordPool?: ClusterKeyword[]; // base real (domínio + lacunas + expansão do catálogo) usada na geração de Clusters

  createdAt: string;
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// Clusters (Fase 2)
// ----------------------------------------------------------------------------

// Search intent classification for cluster keywords.
export type SearchIntent = 'informacional' | 'comercial' | 'transacional' | 'navegacional';

// De onde veio cada palavra-chave (SE Ranking Data API, ou sugestão livre da
// IA/usuário) — mostrado na UI para dar contexto sobre a origem do dado.
export type KeywordOrigin = 'dominio' | 'lacuna' | 'relacionada' | 'similar' | 'longtail' | 'ia';

// Todos os campos além de termo/intencao são dados reais retornados pela SE
// Ranking Data API (quando disponíveis) — volume, cpc, dificuldade e
// competição vêm de qualquer endpoint de keyword research; posição e tráfego
// só quando o termo vem de domain/keywords (o domínio já rankeia por ele).
export interface ClusterKeyword {
  termo: string;
  intencao: SearchIntent;
  volume?: number;         // volume de busca mensal
  cpc?: number;             // custo por clique médio
  dificuldade?: number;     // keyword difficulty, 0-100
  competicao?: number;      // competição em anúncios, 0-1
  posicao?: number;         // posição atual do domínio para esse termo, se já rankeado
  trafego?: number;         // tráfego orgânico estimado que esse termo já traz ao domínio
  origem?: KeywordOrigin;
}

export interface ContentCluster {
  id: string;
  nome: string;        // Tema principal
  estrategia: string;  // Descrição do tema abordado
  palavrasChave: ClusterKeyword[];
  aprovado: boolean;
  excluido?: boolean;  // soft-delete: mantém o doc, mas remove da listagem ativa
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

// Pipeline stage 1..5: DeepResearch → Outline → Draft → Review → Image.
export type ArticleStage = 0 | 1 | 2 | 3 | 4 | 5;

// Alvo de palavras do artigo. Artigos sem o campo (criados antes desta feature)
// são tratados como 'medio' em toda a aplicação.
export type ArticleSize = 'curto' | 'medio' | 'longo';

export interface CalendarArticle {
  id: string;
  titulo: string;
  kwPrincipal: string;
  clusterId: string;
  scheduledDate: string; // ISO date (YYYY-MM-DD)
  scheduledTime?: string;        // "HH:MM" — hora de publicação
  produtosVinculados?: string[]; // IDs de Product._id vinculados (artigos antigos podem ter texto livre até serem re-vinculados)
  tamanho?: ArticleSize;
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
