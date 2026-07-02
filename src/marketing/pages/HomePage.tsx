import Hero from '../components/Hero';
import Section from '../components/Section';
import AgentCard from '../components/AgentCard';
import HowItWorks from '../components/HowItWorks';
import FeatureShowcase from '../components/FeatureShowcase';
import SegmentGrid from '../components/SegmentGrid';
import CaseCard from '../components/CaseCard';
import IntegrationsGrid from '../components/IntegrationsGrid';
import PricingSummary from '../components/PricingSummary';
import TrustSection from '../components/TrustSection';
import FAQ from '../components/FAQ';
import FinalCTA from '../components/FinalCTA';
import { productFeatures, contentFeatures, segments, cases, homeFaq } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function HomePage() {
  usePageMeta({
    title: 'Alfreds — Agentes de IA para E-commerce',
    description: 'Uma equipe de Agentes de IA que cuidam do cadastro, SEO, imagens e conteúdo do seu e-commerce.'
  });

  return (
    <>
      <Hero
        eyebrow="Agentes de IA para e-commerce"
        titleLead="Uma equipe de"
        titleAccent="Agentes de IA"
        titleTail="para cuidar do seu e-commerce."
        subtitle="Enquanto você foca em vender, os agentes do Alfreds cuidam do cadastro, do SEO, das imagens e do conteúdo da sua loja."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Ver os agentes em ação', to: '/agente-de-produto' }}
        microcopy="10 créditos grátis · sem cartão"
      />

      {/* Problema */}
      <Section tone="light">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-4">Cadastro manual e conteúdo parado <span className="text-orange">travam suas vendas</span>.</h2>
          <p className="text-ink/60 text-lg">Planilhas infinitas, descrições pobres e um blog que ninguém atualiza. O Alfreds coloca um esquadrão de agentes para resolver isso por você.</p>
        </div>
      </Section>

      {/* Conheça os agentes */}
      <Section tone="light">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold">Conheça o esquadrão</h2>
          <p className="text-ink/60 mt-3">Dois agentes disponíveis hoje. Novos agentes chegando em breve.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <AgentCard theme="product" title="Agente de Produto" description="Cadastra, enriquece, gera SEO, imagens e vídeos do seu catálogo." to="/agente-de-produto" />
          <AgentCard theme="content" title="Agente de Conteúdo" description="Planeja, escreve e otimiza o conteúdo que faz sua marca ranquear." to="/agente-de-conteudo" />
        </div>
        <p className="text-center text-ink/40 mt-8 text-sm">🔜 Novos agentes em breve</p>
      </Section>

      {/* Como funciona */}
      <Section tone="dark">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Como funciona</h2></div>
        <HowItWorks />
      </Section>

      {/* Agente de Produto em detalhe */}
      <Section tone="light">
        <FeatureShowcase theme="product" eyebrow="Agente de Produto" title="Seu catálogo pronto para performar." features={productFeatures} />
      </Section>

      {/* Agente de Conteúdo em detalhe */}
      <Section tone="dark">
        <FeatureShowcase theme="content" eyebrow="Agente de Conteúdo" title="Conteúdo que ranqueia, na voz da sua marca." features={contentFeatures} />
      </Section>

      {/* Segmentos */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Feito para o seu tipo de operação</h2></div>
        <SegmentGrid segments={segments} />
      </Section>

      {/* Cases */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Resultados</h2></div>
        <div className="grid gap-6 md:grid-cols-3">{cases.map((c) => <CaseCard key={c.label} item={c} />)}</div>
      </Section>

      {/* Integrações */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Integrações</h2></div>
        <IntegrationsGrid />
      </Section>

      {/* Preços */}
      <Section tone="light"><PricingSummary /></Section>

      {/* Confiança */}
      <Section tone="dark">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Segurança e confiança</h2></div>
        <TrustSection />
      </Section>

      {/* FAQ */}
      <Section tone="light">
        <div className="text-center mb-12"><h2 className="font-display text-3xl md:text-4xl font-extrabold">Perguntas frequentes</h2></div>
        <FAQ items={homeFaq} />
      </Section>

      {/* CTA final */}
      <Section tone="light"><FinalCTA title="Comece com 10 créditos grátis e coloque os agentes para trabalhar." ctaLabel="Começar grátis" ctaTo="/entrar" /></Section>
    </>
  );
}
