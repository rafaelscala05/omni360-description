import Hero from '../components/Hero';
import Section from '../components/Section';
import FeatureShowcase from '../components/FeatureShowcase';
import FinalCTA from '../components/FinalCTA';
import { contentFeatures } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function ContentAgentPage() {
  usePageMeta({
    title: 'Agente de Conteúdo | Alfreds',
    description: 'Produza conteúdo que ranqueia, na voz da sua marca, com IA.'
  });

  return (
    <>
      <Hero
        theme="content"
        eyebrow="Agente de Conteúdo"
        titleLead="Conteúdo que"
        titleAccent="ranqueia"
        titleTail="— na voz da sua marca."
        subtitle="O Agente de Conteúdo entende seu negócio, mapeia oportunidades e produz artigos otimizados para SEO, sem afogar sua equipe no operacional."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Ver preços', to: '/precos' }}
        microcopy="10 créditos grátis · sem cartão"
      />
      <Section tone="dark">
        <FeatureShowcase theme="content" eyebrow="O que o agente faz" title="Da estratégia ao artigo publicado." features={contentFeatures} />
      </Section>
      <Section tone="dark"><FinalCTA theme="product" title="Coloque o Agente de Conteúdo para trabalhar hoje." ctaLabel="Começar grátis" ctaTo="/entrar" /></Section>
    </>
  );
}
