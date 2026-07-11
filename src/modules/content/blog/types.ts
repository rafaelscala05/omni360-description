// Data model do módulo Blog (CMS nativo). Compartilhado entre client e server
// (mesmo padrão de src/modules/content/types.ts).
//
// Persistência: users/{uid}/contentProjects/{projectId}/blog/settings (doc),
// .../blogPosts/{postId}, .../blogCategories/{catId}. Lookup público via
// coleções raiz blogSlugs/{slug} e blogDomains/{domain} (server-only).

export type BlogTemplateId = 'editorial' | 'minimal' | 'grid';

export const BLOG_TEMPLATES: Array<{ id: BlogTemplateId; nome: string; descricao: string }> = [
  { id: 'editorial', nome: 'Revista', descricao: 'Estilo magazine: post em destaque + grade de 3 colunas.' },
  { id: 'minimal', nome: 'Minimal', descricao: 'Uma coluna serifada, foco total na leitura.' },
  { id: 'grid', nome: 'Vitrine', descricao: 'Mosaico visual com capas grandes e cabeçalho escuro.' },
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

// Fontes disponíveis para o blog (servidas via Google Fonts no SSR público).
// `family` é o nome na API do Google Fonts; `stack` é o fallback CSS.
export interface BlogFontOption {
  family: string;
  stack: string;
  categoria: 'serifada' | 'sem serifa';
}

export const BLOG_FONTS: BlogFontOption[] = [
  { family: 'Merriweather', stack: 'Georgia, serif', categoria: 'serifada' },
  { family: 'Lora', stack: 'Georgia, serif', categoria: 'serifada' },
  { family: 'Playfair Display', stack: 'Georgia, serif', categoria: 'serifada' },
  { family: 'Source Serif 4', stack: 'Georgia, serif', categoria: 'serifada' },
  { family: 'Inter', stack: 'system-ui, sans-serif', categoria: 'sem serifa' },
  { family: 'Montserrat', stack: 'system-ui, sans-serif', categoria: 'sem serifa' },
  { family: 'Open Sans', stack: 'system-ui, sans-serif', categoria: 'sem serifa' },
  { family: 'Roboto', stack: 'system-ui, sans-serif', categoria: 'sem serifa' },
];

export interface BlogFonts {
  heading: string; // family de BLOG_FONTS
  body: string;
}

export const DEFAULT_BLOG_FONTS: BlogFonts = {
  heading: 'Playfair Display',
  body: 'Merriweather',
};

// Opções de layout do personalizador de aparência. Todos os campos têm
// default no SSR, então settings antigos continuam válidos sem migração.
export interface BlogLayout {
  contentWidth: 'estreito' | 'normal' | 'largo';   // 680 / 1024 / 1280 px
  headerAlign: 'esquerda' | 'centro';
  cardStyle: 'sombra' | 'borda' | 'plano';          // cards do template grid/listas
  cornerRadius: 'reto' | 'suave' | 'arredondado';   // 0 / 8px / 16px
  showCategoriesNav: boolean;
  footerText?: string; // vazio = "© ano título"
}

export const DEFAULT_BLOG_LAYOUT: BlogLayout = {
  contentWidth: 'normal',
  headerAlign: 'esquerda',
  cardStyle: 'borda',
  cornerRadius: 'suave',
  showCategoriesNav: true,
};

export interface BlogSettings {
  enabled: boolean;
  slug: string; // identificador público único global (claim server-side em blogSlugs)
  title: string;
  description: string;
  template: BlogTemplateId;
  logoUrl?: string;
  colors: BlogColors;
  fonts?: BlogFonts;   // ausente = DEFAULT_BLOG_FONTS
  layout?: BlogLayout; // ausente = DEFAULT_BLOG_LAYOUT
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
