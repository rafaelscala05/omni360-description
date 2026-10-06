import Hero from '../components/Hero';
import Section from '../components/Section';
import CaseCard from '../components/CaseCard';
import SegmentGrid from '../components/SegmentGrid';
import FinalCTA from '../components/FinalCTA';
import { cases, segments } from '../content';
import { usePageMeta } from '../usePageMeta';
import { linkCadastro } from '../objetivoSite';
import { Cabecalho } from '../components/ui';

export default function CasesPage() {
  usePageMeta({
    title: 'Casos | Alfreds',
    description: 'Resultados de quem usa os Agentes de IA do Alfreds.'
  });

  return (
    <>
      <Hero
        titulo="Do catálogo ao blog, o Alfred se encaixa na sua operação."
        subtitulo="Loja própria, seller de marketplace ou indústria: veja o tipo de trabalho que o Alfred tira da sua equipe."
        primario={{ label: 'Começar grátis', to: linkCadastro() }}
        secundario={{ label: 'Falar com a gente', to: '/contato' }}
      />

      <Section tone="light">
        <Cabecalho titulo="O que muda no dia a dia" texto="Exemplos ilustrativos do ganho que o Alfred entrega. Vamos trocar por casos reais conforme os clientes publicarem os deles." />
        <div className="grid gap-6 md:grid-cols-3">
          {cases.map((c) => (
            <CaseCard key={c.label} item={c} />
          ))}
        </div>
      </Section>

      <Section tone="dark">
        <Cabecalho titulo="Feito para o seu tipo de operação" />
        <SegmentGrid segments={segments} />
      </Section>

      <Section colado>
        <FinalCTA title="Coloque o Alfred para trabalhar no seu catálogo." ctaLabel="Começar grátis" ctaTo={linkCadastro()} />
      </Section>
    </>
  );
}
