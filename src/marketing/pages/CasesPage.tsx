import Hero from '../components/Hero';
import Section from '../components/Section';
import CaseCard from '../components/CaseCard';
import SegmentGrid from '../components/SegmentGrid';
import FinalCTA from '../components/FinalCTA';
import { cases, segments } from '../content';

export default function CasesPage() {
  return (
    <>
      <Hero
        theme="brand"
        eyebrow="Casos"
        titleLead="Agentes de IA que"
        titleAccent="trabalham por"
        titleTail="cada tipo de operação."
        subtitle="Do catálogo à publicação de conteúdo, veja como o Alfreds se encaixa no dia a dia de diferentes negócios."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Falar com especialista', to: '/contato' }}
      />

      <Section tone="light">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold">Resultados</h2>
          <p className="text-ink/60 mt-3">
            Exemplos ilustrativos do tipo de ganho que os agentes entregam — substituiremos por casos reais conforme
            os primeiros clientes forem publicados.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {cases.map((c) => (
            <CaseCard key={c.label} item={c} />
          ))}
        </div>
      </Section>

      <Section tone="dark">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold">Feito para o seu tipo de operação</h2>
        </div>
        <SegmentGrid segments={segments} />
      </Section>

      <Section tone="light">
        <FinalCTA
          theme="brand"
          title="Coloque os agentes do Alfreds para trabalhar no seu catálogo."
          ctaLabel="Começar grátis"
          ctaTo="/entrar"
        />
      </Section>
    </>
  );
}
