// Conteúdo fictício usado no preview do blog nativo (server/blogPublic.ts)
// enquanto o usuário ainda não publicou nenhum post — assim os 3 templates
// (editorial/minimal/grid) e a página de categoria/artigo aparecem
// preenchidos no preview da aba Aparência, em vez de mostrar estado vazio.
import type { BlogCategory, BlogPost } from './types';

// Imagem de capa gerada como SVG inline (sem dependência de rede) para o
// preview, com uma cor e um rótulo diferentes por post.
function placeholderImage(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">`
    + `<rect width="800" height="500" fill="${color}"/>`
    + `<text x="50%" y="50%" font-family="sans-serif" font-size="32" fill="#ffffff" `
    + `text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

export const PLACEHOLDER_CATEGORIES: BlogCategory[] = [
  { id: 'placeholder-cat-guias', name: 'Guias', slug: 'guias', description: 'Passo a passo prático para o dia a dia da loja.', createdAt: daysAgo(120) },
  { id: 'placeholder-cat-tendencias', name: 'Tendências', slug: 'tendencias', description: 'O que está mudando no e-commerce.', createdAt: daysAgo(120) },
  { id: 'placeholder-cat-bastidores', name: 'Bastidores', slug: 'bastidores', description: 'Como o conteúdo é produzido.', createdAt: daysAgo(120) },
];

export const PLACEHOLDER_POSTS: BlogPost[] = [
  {
    id: 'placeholder-post-1',
    title: 'Como escolher a paleta de cores do seu catálogo',
    slug: 'como-escolher-a-paleta-de-cores-do-seu-catalogo',
    excerpt: 'Cores erradas afastam clientes antes mesmo de lerem a descrição do produto. Veja como escolher uma paleta consistente para fotos, banners e embalagens.',
    coverImageUrl: placeholderImage('Paleta de cores', '#2563eb'),
    categoryIds: ['placeholder-cat-guias'],
    status: 'published',
    publishedAt: daysAgo(2),
    authorName: 'Equipe Alfred',
    seo: { metaTitle: 'Como escolher a paleta de cores do seu catálogo', metaDescription: 'Um guia prático para escolher cores consistentes em fotos, banners e embalagens do seu catálogo.' },
    createdAt: daysAgo(5),
    updatedAt: daysAgo(2),
    html: `
      <p>Antes de fotografar o primeiro produto, vale parar e definir uma paleta. Ela é o que faz a loja parecer <em>uma marca</em>, e não uma coleção de fotos soltas.</p>
      <h2>Comece pelo público, não pelo gosto pessoal</h2>
      <p>A cor que combina com o seu produto nem sempre é a cor que você mais gosta. Observe o que já funciona no seu nicho e onde vale se diferenciar.</p>
      <ul>
        <li>Escolha 1 cor primária e 2 neutras de apoio.</li>
        <li>Teste a paleta em fotos com fundo branco e com fundo colorido.</li>
        <li>Documente os códigos hexadecimais para manter consistência entre fornecedores.</li>
      </ul>
      <blockquote>Consistência visual reduz a taxa de rejeição em páginas de produto — mesmo quando o texto é ótimo.</blockquote>
      <h2>Aplique em todo o funil</h2>
      <p>A mesma paleta deve aparecer nas fotos do produto, nos banners da home e até nas embalagens. Isso reforça reconhecimento de marca em cada etapa da compra.</p>
    `,
  },
  {
    id: 'placeholder-post-2',
    title: '5 tendências de e-commerce para 2026',
    slug: '5-tendencias-de-e-commerce-para-2026',
    excerpt: 'De busca por imagem a descrições geradas por IA: o que já está mudando o comportamento de compra este ano.',
    coverImageUrl: placeholderImage('Tendências 2026', '#059669'),
    categoryIds: ['placeholder-cat-tendencias'],
    status: 'published',
    publishedAt: daysAgo(9),
    authorName: 'Equipe Alfred',
    seo: {},
    createdAt: daysAgo(12),
    updatedAt: daysAgo(9),
    html: `
      <p>Todo ano surgem previsões otimistas demais. Estas cinco já aparecem nos números de conversão de lojas reais.</p>
      <h2>1. Descrições geradas e revisadas por IA</h2>
      <p>O texto deixou de ser gargalo — o trabalho humano migrou para revisão e ajuste de tom.</p>
      <h2>2. Busca visual</h2>
      <p>Clientes fotografam um produto parecido e esperam encontrar o equivalente na sua loja.</p>
      <h2>3. Atributos estruturados</h2>
      <p>Filtros ricos (cor, material, voltagem) aumentam a taxa de conversão em categorias grandes.</p>
      <h2>4. Conteúdo pós-venda automatizado</h2>
      <p>Guias de uso e cuidados viram artigos de blog, não só PDFs anexos ao e-mail.</p>
      <h2>5. Personalização por comportamento de navegação</h2>
      <p>Vitrines que mudam conforme o histórico do visitante, sem depender de cadastro.</p>
    `,
  },
  {
    id: 'placeholder-post-3',
    title: 'Como escrever descrições de produto que convertem',
    slug: 'como-escrever-descricoes-de-produto-que-convertem',
    excerpt: 'Estrutura simples de três blocos para transformar uma ficha técnica em um texto que vende.',
    coverImageUrl: placeholderImage('Descrições que convertem', '#d97706'),
    categoryIds: ['placeholder-cat-guias'],
    status: 'published',
    publishedAt: daysAgo(16),
    authorName: 'Equipe Alfred',
    seo: {},
    createdAt: daysAgo(18),
    updatedAt: daysAgo(16),
    html: `
      <p>A maioria das descrições de produto é só uma lista de especificações. Funciona, mas não convence.</p>
      <h2>Bloco 1 — o problema que o produto resolve</h2>
      <p>Comece pela dor do cliente, não pela ficha técnica. Depois conecte a especificação à solução.</p>
      <h2>Bloco 2 — prova concreta</h2>
      <p>Números, materiais e certificações entram aqui, sempre ligados a um benefício direto.</p>
      <h2>Bloco 3 — próximo passo</h2>
      <p>Feche com o que o cliente deve fazer: escolher a variação certa, ver o guia de tamanhos, ou adicionar ao carrinho.</p>
      <blockquote>Uma descrição boa responde "por que eu" antes de responder "o que é".</blockquote>
    `,
  },
  {
    id: 'placeholder-post-4',
    title: 'Bastidores: como este blog é produzido com IA',
    slug: 'bastidores-como-este-blog-e-produzido-com-ia',
    excerpt: 'Da pesquisa de tema até a publicação: o pipeline de cinco etapas por trás de cada artigo.',
    coverImageUrl: placeholderImage('Bastidores', '#7c3aed'),
    categoryIds: ['placeholder-cat-bastidores'],
    status: 'published',
    publishedAt: daysAgo(23),
    authorName: 'Equipe Alfred',
    seo: {},
    createdAt: daysAgo(25),
    updatedAt: daysAgo(23),
    html: `
      <p>Cada artigo passa pelo mesmo pipeline: pesquisa, outline, rascunho, imagem e revisão.</p>
      <h2>Pesquisa</h2>
      <p>O tema é validado contra buscas reais antes de virar pauta.</p>
      <h2>Outline e rascunho</h2>
      <p>A estrutura é aprovada antes do texto final, o que evita retrabalho.</p>
      <h2>Imagem e revisão</h2>
      <p>A capa é gerada por último, quando o conteúdo já está fechado — e um humano sempre revisa antes de publicar.</p>
    `,
  },
  {
    id: 'placeholder-post-5',
    title: 'SEO para lojas virtuais: primeiros passos',
    slug: 'seo-para-lojas-virtuais-primeiros-passos',
    excerpt: 'Antes de investir em anúncios, garanta que o básico de SEO da loja está no lugar.',
    coverImageUrl: placeholderImage('SEO para lojas', '#dc2626'),
    categoryIds: ['placeholder-cat-tendencias'],
    status: 'published',
    publishedAt: daysAgo(30),
    authorName: 'Equipe Alfred',
    seo: {},
    createdAt: daysAgo(32),
    updatedAt: daysAgo(30),
    html: `
      <p>SEO de e-commerce não começa com backlinks — começa com a estrutura da própria loja.</p>
      <h2>Título e meta descrição por página</h2>
      <p>Cada categoria e produto precisa de título e descrição únicos, sem duplicação entre variações.</p>
      <h2>URLs limpas</h2>
      <p>Evite parâmetros longos e IDs sem sentido na URL de categorias e produtos.</p>
      <h2>Conteúdo de apoio</h2>
      <p>Um blog como este ajuda a capturar buscas que ainda não têm intenção clara de compra.</p>
    `,
  },
];
