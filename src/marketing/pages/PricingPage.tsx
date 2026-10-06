import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import Hero from '../components/Hero';
import FAQ from '../components/FAQ';
import FinalCTA from '../components/FinalCTA';
import { Cabecalho, Cta, Section } from '../components/ui';
import { FaqItem } from '../content';
import { linkCadastro } from '../objetivoSite';
import { usePageMeta } from '../usePageMeta';
import { trackPricingViewed } from '../../analytics';

/** Mesmo preço e mínimo da compra no app (`CreditPurchaseModal`). */
const PRECO_CREDITO = 0.5;
const MINIMO = 10;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const INCLUSO = [
  'Os mesmos créditos valem em todos os agentes',
  'Integrações com Tiny, Bling, IdWorks, Wake e Mercado Livre sem custo extra',
  'Conversar e consultar é grátis: só gasta quando o Alfred gera ou grava',
  'Créditos que não vencem',
];

const pricingFaq: FaqItem[] = [
  {
    q: 'Como funciona a cobrança por créditos?',
    a: 'Cada ação do Alfred que usa IA (escrever uma descrição, gerar uma foto ou um vídeo, produzir um artigo) consome créditos. Você compra créditos quando precisar e usa como quiser, sem mensalidade.',
  },
  {
    q: 'Como sei quanto uma ação vai custar?',
    a: 'O custo aparece antes de você confirmar: no botão, no card de aprovação do Alfred e no resumo de cada lote. O histórico de uso fica na sua conta.',
  },
  { q: 'Os créditos expiram?', a: 'Não. Ficam na sua conta até você usar.' },
  { q: 'Preciso de cartão para testar?', a: 'Não. A conta nova começa com 10 créditos grátis.' },
  {
    q: 'Como pago?',
    a: 'Por Pix, boleto ou cartão. Os créditos entram na conta assim que o pagamento é confirmado.',
  },
];

export default function PricingPage() {
  usePageMeta({
    title: 'Preços | Alfreds',
    description: 'Créditos a R$ 0,50, sem mensalidade e sem fidelidade. Comece com 10 créditos grátis.',
  });

  useEffect(() => {
    trackPricingViewed();
  }, []);

  const [creditos, setCreditos] = useState(100);
  const mudar = (d: number) => setCreditos((c) => Math.max(MINIMO, c + d));

  return (
    <>
      <Hero
        titulo="Pague pelo que o Alfred faz. Só isso."
        subtitulo="Sem mensalidade, sem plano por usuário e sem fidelidade. Você compra créditos, usa em qualquer agente e vê o custo de cada ação antes de confirmar."
        primario={{ label: 'Começar com 10 créditos grátis', to: linkCadastro() }}
        secundario={{ label: 'Falar com a gente', to: '/contato' }}
        microcopy="Sem cartão para começar."
      />

      <Section colado>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="ag-glass-strong ag-sheen rounded-[30px] p-6 sm:p-10">
            <p className="text-[15px] text-[var(--ag-text-2)]">Preço por crédito</p>
            <p className="mt-1 font-display text-[64px] md:text-[80px] font-semibold leading-none tracking-[-0.04em] text-[var(--ag-text)] tabular-nums">
              R$ 0,50
            </p>
            <p className="mt-3 text-[15px] text-[var(--ag-text-2)]">Compra mínima de {MINIMO} créditos.</p>

            <div className="mt-10 rounded-[22px] p-5" style={{ background: 'var(--ag-fill)' }}>
              <p className="text-[14px] font-medium text-[var(--ag-text-2)]">Simule uma compra</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => mudar(-10)}
                    disabled={creditos <= MINIMO}
                    aria-label="Menos 10 créditos"
                    className="w-11 h-11 rounded-full grid place-items-center disabled:opacity-30"
                    style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <output className="w-24 text-center font-display text-[28px] font-semibold tabular-nums text-[var(--ag-text)]" aria-live="polite">
                    {creditos}
                  </output>
                  <button
                    type="button"
                    onClick={() => mudar(10)}
                    aria-label="Mais 10 créditos"
                    className="w-11 h-11 rounded-full grid place-items-center"
                    style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <span className="text-[14px] text-[var(--ag-text-2)]">créditos</span>
                </div>
                <p className="font-display text-[28px] font-semibold tabular-nums text-[var(--ag-text)]">{brl(creditos * PRECO_CREDITO)}</p>
              </div>
            </div>
          </div>

          <div className="ag-glass rounded-[30px] p-6 sm:p-10 flex flex-col">
            <h2 className="font-display text-[26px] font-semibold tracking-tight text-[var(--ag-text)]">Incluso em qualquer compra</h2>
            <ul className="mt-6 flex flex-col gap-4">
              {INCLUSO.map((i) => (
                <li key={i} className="flex items-start gap-3 text-[16px] text-[var(--ag-text)]">
                  <span className="mt-0.5 w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}>
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  {i}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-10">
              <Cta to={linkCadastro()} grande className="w-full" rotulo="Começar grátis (preços)">Começar grátis</Cta>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="dark">
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <Cabecalho
            className="!mb-0"
            titulo="Catálogo grande ou muito conteúdo por mês?"
            texto="Para operações de volume, montamos um pacote de créditos sob medida e ajudamos a configurar as integrações."
          />
          <Cta to="/contato" grande>Falar com a gente</Cta>
        </div>
      </Section>

      <Section>
        <Cabecalho titulo="Perguntas sobre cobrança" centro />
        <FAQ items={pricingFaq} />
      </Section>

      <Section colado>
        <FinalCTA title="Teste o Alfred com 10 créditos por nossa conta." ctaLabel="Começar grátis" ctaTo={linkCadastro()} microcopy="Sem cartão. Leva dois minutos." />
      </Section>
    </>
  );
}
