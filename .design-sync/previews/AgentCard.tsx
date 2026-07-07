import { TrendingUp, Boxes } from 'lucide-react';
import AgentCard from '../../src/marketing/components/AgentCard';

export const Product = () => (
  <AgentCard
    variant="product"
    title="Agente de Produto"
    description="Cadastra, enriquece, gera SEO, imagens e vídeos do seu catálogo."
    to="/agente-de-produto"
  />
);

export const Content = () => (
  <AgentCard
    variant="content"
    title="Agente de Conteúdo"
    description="Planeja, escreve e otimiza o conteúdo que faz sua marca ranquear."
    to="/agente-de-conteudo"
  />
);

export const ComingSoon = () => (
  <AgentCard
    variant="sales"
    title="Agente de Força de Vendas"
    description="Prioriza oportunidades, acompanha metas e apoia seu time a vender mais."
    Icon={TrendingUp}
    comingSoon
  />
);

export const Grid = () => (
  <div className="grid gap-6 md:grid-cols-2">
    <AgentCard variant="product" title="Agente de Produto" description="Cadastra, enriquece e gera SEO do catálogo." to="/agente-de-produto" />
    <AgentCard variant="content" title="Agente de Conteúdo" description="Planeja e escreve conteúdo que ranqueia." to="/agente-de-conteudo" />
    <AgentCard variant="sales" title="Agente de Força de Vendas" description="Prioriza oportunidades de venda." Icon={TrendingUp} comingSoon />
    <AgentCard variant="ops" title="Agente Operacional" description="Cuida de estoque, pedidos e rotinas." Icon={Boxes} comingSoon />
  </div>
);
