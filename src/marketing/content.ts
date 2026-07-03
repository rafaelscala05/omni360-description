import produtoCatalogo from '../assets/marketing/alfreds-produto-catalogo.png';
import produtoEdicao from '../assets/marketing/alfreds-produto-edicao.png';
import produtoImagem from '../assets/marketing/alfreds-produto-imagem.png';
import produtoVideo from '../assets/marketing/alfreds-produto-video.png';

export interface FeatureItem {
  title: string;
  description: string;
  screenshot?: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface CaseItem {
  metric: string;
  label: string;
  description: string;
}

export interface SegmentItem {
  title: string;
  pain: string;
}

export const howItWorks = [
  { step: 1, title: 'Conecte', description: 'Suba sua planilha, informe um EAN ou aponte o site da sua loja. Sem integração complicada.' },
  { step: 2, title: 'Os agentes trabalham', description: 'O Agente de Produto e o Agente de Conteúdo executam o trabalho pesado enquanto você cuida de vender.' },
  { step: 3, title: 'Pronto para vender', description: 'Catálogo enriquecido, com SEO, imagens, vídeos e conteúdo que ranqueia — pronto para publicar.' },
];

export const productFeatures: FeatureItem[] = [
  { title: 'Enriquecimento de dados', description: 'O agente busca GTIN/EAN, NCM, peso e dimensões reais e completa o cadastro por você.', screenshot: produtoCatalogo },
  { title: 'SEO automático', description: 'Título, descrição e palavras-chave otimizados para o Google, no seu tom de marca.', screenshot: produtoEdicao },
  { title: 'Ambientação de imagens', description: 'Gera fotos realistas do produto em cenários profissionais e lifestyle.', screenshot: produtoImagem },
  { title: 'Geração de vídeo', description: 'Cria vídeos curtos do produto para acelerar a conversão.', screenshot: produtoVideo },
  { title: 'Categorias e integrações', description: 'Organiza a árvore de categorias e sincroniza com a sua plataforma (ex.: Wake).' },
];

export const contentFeatures: FeatureItem[] = [
  { title: 'Perfil da marca', description: 'O agente entende seu negócio, tom de voz e público a partir do seu site.' },
  { title: 'Mapa de autoridade', description: 'Descobre os temas que a sua marca precisa dominar para ganhar tráfego.' },
  { title: 'Clusters de conteúdo', description: 'Estrutura pautas em clusters pilar-e-satélite com links internos.' },
  { title: 'Produção de artigos', description: 'Escreve artigos otimizados para SEO respeitando a voz da sua marca.' },
  { title: 'Calendário editorial', description: 'Planeja e agenda a produção para manter consistência sem esforço.' },
];

export const segments: SegmentItem[] = [
  { title: 'Loja online', pain: 'Catálogo grande, tempo curto: os agentes cadastram e enriquecem em escala.' },
  { title: 'Marketplace / Seller', pain: 'Padronize dados e conteúdo para performar em cada canal de venda.' },
  { title: 'Indústria', pain: 'Transforme fichas técnicas em cadastros e conteúdo prontos para o varejo.' },
];

export const cases: CaseItem[] = [
  { metric: '−90%', label: 'Tempo por produto', description: 'De uma tarde inteira para minutos por item — exemplo ilustrativo.' },
  { metric: '10×', label: 'Mais itens por dia', description: 'A mesma equipe publica muito mais, sem contratar — exemplo ilustrativo.' },
  { metric: 'minutos', label: 'SEO + imagem + vídeo', description: 'Tudo gerado junto e pronto para publicar — exemplo ilustrativo.' },
];

export const homeFaq: FaqItem[] = [
  { q: 'O que é o Alfreds?', a: 'É um esquadrão de Agentes de IA para e-commerce. Hoje temos o Agente de Produto e o Agente de Conteúdo, e novos agentes estão a caminho.' },
  { q: 'Preciso de cartão para começar?', a: 'Não. Novos usuários recebem 10 créditos grátis para testar os agentes.' },
  { q: 'Como funciona a cobrança?', a: 'Por créditos: cada operação de IA consome uma quantidade de créditos. Você compra pacotes conforme o uso.' },
  { q: 'Meus dados ficam seguros?', a: 'Sim. As chaves de IA ficam no servidor e seus dados não são compartilhados com terceiros.' },
  { q: 'Com quais plataformas integra?', a: 'Importação por planilha/Excel, EAN e integração com plataformas como a Wake.' },
  { q: 'Vou perder o controle do conteúdo?', a: 'Não. Os agentes trabalham no seu tom de marca e você revisa e aprova antes de publicar.' },
];
