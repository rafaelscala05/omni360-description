import Hero from '../components/Hero';
import Section from '../components/Section';
import FeatureShowcase from '../components/FeatureShowcase';
import FinalCTA from '../components/FinalCTA';
import { productFeatures } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function ProductAgentPage() {
  usePageMeta({
    title: 'Agente de Produto | Alfreds',
    description: 'Cadastre, enriqueça e gere SEO, imagens e vídeos do seu catálogo com IA.'
  });

  return (
    <>
      <Hero
        theme="product"
        eyebrow="Agente de Produto"
        titleLead="Seu catálogo"
        titleAccent="pronto para vender"
        titleTail="— no automático."
        subtitle="O Agente de Produto cadastra, enriquece com dados reais, gera SEO, imagens e vídeos do seu catálogo enquanto você foca em crescer."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Ver preços', to: '/precos' }}
        microcopy="10 créditos grátis · sem cartão"
      />
      <Section tone="light">
        <FeatureShowcase theme="product" eyebrow="O que o agente faz" title="Do EAN ao produto pronto." features={productFeatures} />
      </Section>
      <Section tone="light"><FinalCTA theme="product" title="Coloque o Agente de Produto para trabalhar hoje." ctaLabel="Começar grátis" ctaTo="/entrar" /></Section>
    </>
  );
}
