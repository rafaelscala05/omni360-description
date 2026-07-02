import { Link } from 'react-router-dom';
import Hero from '../components/Hero';
import Section from '../components/Section';
import FAQ from '../components/FAQ';
import FinalCTA from '../components/FinalCTA';
import { FaqItem } from '../content';
import { usePageMeta } from '../usePageMeta';

interface CreditRow {
  action: string;
  credits: number;
}

const creditTable: CreditRow[] = [
  { action: 'Geração SEO (individual ou em massa)', credits: 1 },
  { action: 'Enriquecimento de dados (individual ou em massa)', credits: 1 },
  { action: 'Geração de Ambientação de imagem', credits: 1 },
  { action: 'Geração de Vídeo de Produto', credits: 5 },
  { action: 'Clusters de Conteúdo', credits: 2 },
  { action: 'Calendário Editorial', credits: 2 },
  { action: 'Produção de Artigo', credits: 5 },
  { action: 'Imagem de Capa de Conteúdo', credits: 1 },
];

const pricingFaq: FaqItem[] = [
  {
    q: 'Como funciona a cobrança por créditos?',
    a: 'Cada operação de IA (geração de SEO, enriquecimento, imagens, vídeos, conteúdo) consome uma quantidade fixa de créditos. Você compra pacotes de créditos e usa como quiser, sem mensalidade obrigatória.',
  },
  {
    q: 'Os créditos expiram?',
    a: 'Não. Os créditos ficam disponíveis na sua conta até serem usados — não há vencimento por período.',
  },
  {
    q: 'Preciso de cartão de crédito para testar?',
    a: 'Não. Novos usuários começam com 10 créditos grátis para testar os agentes antes de comprar qualquer pacote.',
  },
  {
    q: 'Como sei quantos créditos vou gastar?',
    a: 'Cada tela mostra o custo em créditos antes de você confirmar a ação, e o histórico de uso fica disponível na sua conta.',
  },
];

export default function PricingPage() {
  usePageMeta({
    title: 'Preços | Alfreds',
    description: 'Preço transparente por créditos. Comece com 10 créditos grátis.'
  });

  return (
    <>
      <Hero
        theme="brand"
        eyebrow="Preços"
        titleLead="Pague só pelo"
        titleAccent="trabalho que os agentes fazem"
        titleTail="por você."
        subtitle="Sem mensalidade fixa: você compra créditos e usa nos agentes de Produto e de Conteúdo conforme a sua necessidade."
        primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
        secondaryCta={{ label: 'Falar com especialista', to: '/contato' }}
        microcopy="Novos usuários começam com 10 créditos grátis"
      />

      <Section tone="light">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-4">
            Um modelo de <span className="text-orange">créditos</span>, simples de entender.
          </h2>
          <p className="text-ink/60 text-lg">
            Cada vez que um agente executa uma tarefa de IA — gerar uma descrição, enriquecer um produto, criar uma
            imagem ou escrever um artigo — a operação consome uma quantidade fixa de créditos. Você compra pacotes
            de créditos e decide quando e quanto usar, sem contrato de fidelidade.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full max-w-3xl mx-auto border-collapse rounded-2xl overflow-hidden border border-ink/10">
            <thead>
              <tr className="bg-ink text-porcelain">
                <th className="text-left font-display font-bold px-6 py-4">Operação de IA</th>
                <th className="text-right font-display font-bold px-6 py-4">Créditos</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {creditTable.map((row, i) => (
                <tr key={row.action} className={i % 2 === 1 ? 'bg-orange/5' : ''}>
                  <td className="px-6 py-4 border-t border-ink/10">{row.action}</td>
                  <td className="px-6 py-4 border-t border-ink/10 text-right font-bold text-orange">{row.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section tone="dark">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-2xl md:text-3xl font-extrabold mb-4">
            Volume grande? <span className="text-orange">Fale com um especialista.</span>
          </h2>
          <p className="text-porcelain/70 mb-8">
            Para catálogos grandes ou operações de conteúdo intensas, montamos um pacote de créditos sob medida para
            o seu volume.
          </p>
          <Link
            to="/contato"
            className="inline-block px-8 py-4 rounded-xl font-bold text-lg bg-orange text-white hover:brightness-95 transition"
          >
            Falar com especialista
          </Link>
        </div>
      </Section>

      <Section tone="light">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-extrabold">Perguntas sobre cobrança</h2>
        </div>
        <FAQ items={pricingFaq} />
      </Section>

      <Section tone="light">
        <FinalCTA
          theme="brand"
          title="Comece com 10 créditos grátis e teste os agentes hoje."
          ctaLabel="Começar grátis"
          ctaTo="/entrar"
        />
      </Section>
    </>
  );
}
