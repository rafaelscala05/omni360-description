import FeatureShowcase from '../../src/marketing/components/FeatureShowcase';
import produtoCatalogo from '../../src/assets/marketing/alfreds-produto-catalogo.png';
import produtoEdicao from '../../src/assets/marketing/alfreds-produto-edicao.png';
import produtoImagem from '../../src/assets/marketing/alfreds-produto-imagem.png';
import produtoVideo from '../../src/assets/marketing/alfreds-produto-video.png';

const productFeatures = [
  { title: 'Enriquecimento de dados', description: 'O agente busca GTIN/EAN, NCM, peso e dimensões reais e completa o cadastro por você.', screenshot: produtoCatalogo },
  { title: 'SEO automático', description: 'Título, descrição e palavras-chave otimizados para o Google, no seu tom de marca.', screenshot: produtoEdicao },
  { title: 'Ambientação de imagens', description: 'Gera fotos realistas do produto em cenários profissionais e lifestyle.', screenshot: produtoImagem },
  { title: 'Geração de vídeo', description: 'Cria vídeos curtos do produto para acelerar a conversão.', screenshot: produtoVideo },
  { title: 'Categorias e integrações', description: 'Organiza a árvore de categorias e sincroniza com a sua plataforma (ex.: Wake).' },
];

const contentFeatures = [
  { title: 'Perfil da marca', description: 'O agente entende seu negócio, tom de voz e público a partir do seu site.' },
  { title: 'Mapa de autoridade', description: 'Descobre os temas que a sua marca precisa dominar para ganhar tráfego.' },
  { title: 'Clusters de conteúdo', description: 'Estrutura pautas em clusters pilar-e-satélite com links internos.' },
];

export const Product = () => (
  <FeatureShowcase theme="product" eyebrow="Agente de Produto" title="Seu catálogo pronto para performar." features={productFeatures} />
);

export const Content = () => (
  <FeatureShowcase theme="content" eyebrow="Agente de Conteúdo" title="Conteúdo que ranqueia, na voz da sua marca." features={contentFeatures} />
);
