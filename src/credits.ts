// Credit system definitions shared between App.tsx and the modals.
//
// Each credit-consuming operation is represented by a CreditAction with a stable
// `key` and a pt-BR `label`. The `key` is the canonical identifier used to look
// up the cost in the read-only Firestore config document `config/credits`
// (admin-controlled). The `label` is the human-readable text stored in
// `credit_logs` and shown in the credit history UI.

export interface CreditAction {
  key: string;
  label: string;
}

export const CREDIT_ACTIONS = {
  generateSeoSingle: { key: 'generate_seo_single', label: 'Geração SEO Individual' },
  generateSeoMass: { key: 'generate_seo_mass', label: 'Geração SEO em Massa' },
  enrichSingle: { key: 'enrich_single', label: 'Enriquecimento Individual' },
  enrichMass: { key: 'enrich_mass', label: 'Enriquecimento em Massa' },
  regenerateSingle: { key: 'regenerate_single', label: 'Regeneração Individual' },
  generateHierarchy: { key: 'generate_hierarchy', label: 'Geração de Hierarquia' },
  ambientImage: { key: 'ambient_image', label: 'Geração de Ambientação' },
  regenerateImage: { key: 'regenerate_image', label: 'Regeneração de Imagem' },
  // Agência de Criação de Conteúdo (Alfred)
  contentClusters: { key: 'content_clusters', label: 'Geração de Clusters de Conteúdo' },
  contentCalendar: { key: 'content_calendar', label: 'Geração de Calendário Editorial' },
  contentArticle: { key: 'content_article', label: 'Produção de Artigo' },
  contentImage: { key: 'content_image', label: 'Geração de Imagem de Capa' },
  contentPublish: { key: 'content_publish', label: 'Publicação no WordPress' },
  videoGeneration: { key: 'video_generation', label: 'Geração de Vídeo de Produto' },
} as const satisfies Record<string, CreditAction>;

// Fallback costs, used when the `config/credits` document has not loaded yet or
// does not define a cost for a given action key. The authoritative values live
// in Firestore so they can be tuned without a deploy (see seed-credit-config.cjs).
export const DEFAULT_CREDIT_COSTS: Record<string, number> = {
  generate_seo_single: 1,
  generate_seo_mass: 1,
  enrich_single: 1,
  enrich_mass: 1,
  regenerate_single: 1,
  generate_hierarchy: 1,
  ambient_image: 1,
  regenerate_image: 1,
  content_clusters: 2,
  content_calendar: 2,
  content_article: 5,
  content_image: 1,
  content_publish: 1,
  video_generation: 5,
};

export const DEFAULT_COST = 1;

// Resolves the cost of an action key against (in order): the loaded config map,
// the config-provided `_default`, the hardcoded fallback map, then DEFAULT_COST.
export function resolveCreditCost(
  costs: Record<string, number>,
  key: string,
): number {
  return costs[key] ?? costs._default ?? DEFAULT_CREDIT_COSTS[key] ?? DEFAULT_COST;
}
