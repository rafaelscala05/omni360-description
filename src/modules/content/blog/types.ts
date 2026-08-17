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

// ----------------------------------------------------------------------------
// Aparência modular (mix-and-match). Cinco eixos independentes, 3 variantes cada.
// `BlogSettings.appearance` é opcional: ausente = deriva do preset do `template`
// legado (PRESETS) → DEFAULT_BLOG_APPEARANCE. Assim blogs antigos não migram.
// ----------------------------------------------------------------------------

export type BlogHeaderVariant = 'logo-esquerda' | 'logo-centro' | 'logo-topo';
export type BlogFooterVariant = 'simples' | 'colunas' | 'centralizado';
export type BlogCategoryVariant = 'grade' | 'lista' | 'destaque-grade';
export type BlogCardVariant = 'com-borda' | 'plano' | 'sombra';
export type BlogArticleVariant = 'centrado' | 'capa-larga' | 'lateral-meta';

export interface BlogAppearance {
  header: BlogHeaderVariant;
  footer: BlogFooterVariant;
  footerShowCategories: boolean;   // inclui submenu de categorias no rodapé
  category: BlogCategoryVariant;
  card: BlogCardVariant;
  cardShowAuthor: boolean;
  cardShowExcerpt: boolean;
  cardShowMeta: boolean;           // data + tempo de leitura
  cardShowCategory: boolean;       // chip da categoria
  article: BlogArticleVariant;
}

export const DEFAULT_BLOG_APPEARANCE: BlogAppearance = {
  header: 'logo-esquerda',
  footer: 'simples',
  footerShowCategories: true,
  category: 'destaque-grade',
  card: 'com-borda',
  cardShowAuthor: false,
  cardShowExcerpt: true,
  cardShowMeta: true,
  cardShowCategory: true,
  article: 'centrado',
};

// Presets "Estilos rápidos": reproduzem os 3 temas monolíticos antigos como
// pontos de partida. São também o fallback de blogs sem `appearance` (via
// `template`), garantindo continuidade visual sem migração de dados.
export const BLOG_APPEARANCE_PRESETS: Record<BlogTemplateId, BlogAppearance> = {
  editorial: {
    header: 'logo-esquerda', footer: 'simples', footerShowCategories: true,
    category: 'destaque-grade', card: 'com-borda',
    cardShowAuthor: false, cardShowExcerpt: true, cardShowMeta: true, cardShowCategory: true,
    article: 'centrado',
  },
  minimal: {
    header: 'logo-topo', footer: 'centralizado', footerShowCategories: false,
    category: 'lista', card: 'plano',
    cardShowAuthor: true, cardShowExcerpt: true, cardShowMeta: true, cardShowCategory: false,
    article: 'centrado',
  },
  grid: {
    header: 'logo-esquerda', footer: 'colunas', footerShowCategories: true,
    category: 'grade', card: 'sombra',
    cardShowAuthor: false, cardShowExcerpt: false, cardShowMeta: true, cardShowCategory: true,
    article: 'capa-larga',
  },
};

// Rótulos para a UI da aba Aparência (nome + descrição curta por variante).
export const BLOG_APPEARANCE_OPTIONS = {
  header: [
    { id: 'logo-esquerda', nome: 'Logo à esquerda', descricao: 'Logo à esquerda, menu à direita.' },
    { id: 'logo-centro', nome: 'Logo ao centro', descricao: 'Logo centralizado com menu logo abaixo.' },
    { id: 'logo-topo', nome: 'Logo em destaque', descricao: 'Logo grande no topo, tagline e menu centralizados.' },
  ],
  footer: [
    { id: 'simples', nome: 'Simples', descricao: 'Uma linha com o texto do rodapé.' },
    { id: 'colunas', nome: 'Em colunas', descricao: 'Marca à esquerda e submenu de categorias à direita.' },
    { id: 'centralizado', nome: 'Centralizado', descricao: 'Texto e links centralizados.' },
  ],
  category: [
    { id: 'grade', nome: 'Grade', descricao: 'Mosaico de cards em 3 colunas.' },
    { id: 'lista', nome: 'Lista', descricao: 'Uma coluna, cards na horizontal.' },
    { id: 'destaque-grade', nome: 'Destaque + grade', descricao: 'Primeiro post em destaque + grade.' },
  ],
  card: [
    { id: 'com-borda', nome: 'Com borda', descricao: 'Card delimitado por borda fina.' },
    { id: 'plano', nome: 'Plano', descricao: 'Sem card, só o conteúdo.' },
    { id: 'sombra', nome: 'Com sombra', descricao: 'Card elevado com sombra suave.' },
  ],
  article: [
    { id: 'centrado', nome: 'Centrado', descricao: 'Coluna única centralizada, capa no topo.' },
    { id: 'capa-larga', nome: 'Capa larga', descricao: 'Capa full-bleed com título sobreposto.' },
    { id: 'lateral-meta', nome: 'Meta lateral', descricao: 'Metadados numa coluna lateral fixa.' },
  ],
} as const;

export function effectiveAppearance(s: Pick<BlogSettings, 'appearance' | 'template'>): BlogAppearance {
  const base = BLOG_APPEARANCE_PRESETS[s.template] ?? DEFAULT_BLOG_APPEARANCE;
  return { ...base, ...(s.appearance ?? {}) };
}

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
  appearance?: BlogAppearance; // ausente = preset do template (effectiveAppearance)
  customDomains: string[];    // espelho de blogDomains para exibição na UI
  verifiedDomains?: string[]; // subconjunto de customDomains já verificados (exibição)
  createdAt: string;
  updatedAt: string;
}

export type BlogPostStatus = 'draft' | 'published';

// Vitrine de produtos vinculados ao artigo de origem, congelada no momento da
// publicação (mesmo padrão de coverImageUrl/title — cópia, não referência
// viva, então segue exibível mesmo se o produto for depois alterado/excluído).
export interface BlogPostProduct {
  id: string;
  nome: string;
  imagemPrincipal?: string;
  preco?: number;
}

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
  products?: BlogPostProduct[]; // snapshot dos produtos vinculados ao artigo, se houver
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
