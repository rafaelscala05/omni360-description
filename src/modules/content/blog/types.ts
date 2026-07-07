// Data model do módulo Blog (CMS nativo). Compartilhado entre client e server
// (mesmo padrão de src/modules/content/types.ts).
//
// Persistência: users/{uid}/contentProjects/{projectId}/blog/settings (doc),
// .../blogPosts/{postId}, .../blogCategories/{catId}. Lookup público via
// coleções raiz blogSlugs/{slug} e blogDomains/{domain} (server-only).

export type BlogTemplateId = 'editorial' | 'minimal' | 'grid';

export const BLOG_TEMPLATES: Array<{ id: BlogTemplateId; nome: string; descricao: string }> = [
  { id: 'editorial', nome: 'Editorial', descricao: 'Estilo revista: post em destaque + lista com imagens.' },
  { id: 'minimal', nome: 'Minimal', descricao: 'Uma coluna tipográfica, foco em leitura.' },
  { id: 'grid', nome: 'Grid', descricao: 'Cards em grade com imagem de capa.' },
];

export interface BlogColors {
  primary: string;    // ex.: '#2563eb'
  background: string; // ex.: '#ffffff'
  text: string;       // ex.: '#0f172a'
}

export const DEFAULT_BLOG_COLORS: BlogColors = {
  primary: '#2563eb',
  background: '#ffffff',
  text: '#0f172a',
};

export interface BlogSettings {
  enabled: boolean;
  slug: string; // identificador público único global (claim server-side em blogSlugs)
  title: string;
  description: string;
  template: BlogTemplateId;
  logoUrl?: string;
  colors: BlogColors;
  customDomains: string[];    // espelho de blogDomains para exibição na UI
  verifiedDomains?: string[]; // subconjunto de customDomains já verificados (exibição)
  createdAt: string;
  updatedAt: string;
}

export type BlogPostStatus = 'draft' | 'published';

export interface BlogPost {
  id: string;
  title: string;
  slug: string; // kebab-case; imutável após publicado
  html: string; // corpo (mesmo formato HTML do pipeline de artigos)
  excerpt: string;
  coverImageUrl?: string;
  categoryIds: string[];
  status: BlogPostStatus;
  publishedAt?: string;
  seo: { metaTitle?: string; metaDescription?: string };
  authorName?: string;
  sourceArticleId?: string; // quando publicado a partir do calendário editorial
  createdAt: string;
  updatedAt: string;
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
}

// Coleção raiz blogDomains/{domain} — server-only.
export interface BlogDomainDoc {
  uid: string;
  projectId: string;
  verified: boolean;
  verificationToken: string;
  createdAt: string;
}
