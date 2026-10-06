// Página de conversão de um objetivo da Tela 0 (descrições, Mercado Livre,
// blog). Mesmo esqueleto para as três: promessa → dor → antes/depois →
// primeiros 10 minutos → o que o Alfred faz → garantia → FAQ → cadastro com o
// objetivo já marcado.

import { ShieldCheck } from 'lucide-react';
import type { Objetivo } from '../../modules/agent/capacidades';
import Hero from '../components/Hero';
import DemoObjetivo, { HeroObjetivo } from '../components/DemoObjetivo';
import FAQ from '../components/FAQ';
import FinalCTA from '../components/FinalCTA';
import { Cabecalho, Cta, Section } from '../components/ui';
import { PAGINAS } from '../content';
import { linkCadastro } from '../objetivoSite';
import { usePageMeta } from '../usePageMeta';

const MICROCOPY = '10 créditos grátis para testar. Sem cartão.';

export default function ObjetivoPage({ objetivo }: { objetivo: Objetivo }) {
  const p = PAGINAS[objetivo];
  usePageMeta(p.meta);
  const cadastro = linkCadastro(objetivo);

  return (
    <>
      <Hero
        selo={{ cor: p.cor, texto: p.selo }}
        titulo={p.h1}
        subtitulo={p.sub}
        primario={{ label: `${p.cta} grátis`, to: cadastro }}
        secundario={{ label: p.verDemo, to: '#antes-depois' }}
        microcopy={MICROCOPY}
        lado={<HeroObjetivo objetivo={objetivo} />}
      />

      {/* Dor: três frases que o lojista já disse em voz alta. */}
      <Section colado>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <h2 className="font-display text-[30px] md:text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--ag-text)] text-balance">
            {p.dores.titulo}
          </h2>
          <ul className="flex flex-col">
            {p.dores.itens.map((d, i) => (
              <li key={d.titulo} className="py-5" style={i ? { borderTop: '1px solid var(--ag-hairline-2)' } : undefined}>
                <p className="text-[18px] font-semibold text-[var(--ag-text)]">{d.titulo}</p>
                <p className="mt-1 text-[16px] leading-relaxed text-[var(--ag-text-2)]">{d.texto}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="antes-depois">
        <Cabecalho titulo={p.demo.titulo} texto={p.demo.texto} />
        <DemoObjetivo objetivo={objetivo} />
        <p className="mt-4 text-[13px] text-[var(--ag-text-3)]">Exemplo com dados fictícios.</p>
      </Section>

      {/* Sequência real do primeiro acesso: aqui a numeração diz a ordem. */}
      <Section tone="dark">
        <Cabecalho titulo="Os primeiros 10 minutos." texto="É o caminho que a sua conta faz assim que você entra. Dá para parar e voltar depois." />
        <ol className="grid gap-4 md:grid-cols-3">
          {p.passos.map((s, i) => (
            <li key={s.titulo} className="ag-glass ag-sheen rounded-[26px] p-6 flex flex-col gap-3">
              <span
                className="w-10 h-10 rounded-full grid place-items-center font-display text-[18px] font-semibold"
                style={{ background: p.cor, color: '#141311' }}
              >
                {i + 1}
              </span>
              <h3 className="font-display text-[22px] font-semibold tracking-tight text-[var(--ag-text)]">{s.titulo}</h3>
              <p className="leading-relaxed text-[var(--ag-text-2)]">{s.texto}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <Cta to={cadastro} grande>{`${p.cta} grátis`}</Cta>
        </div>
      </Section>

      <Section>
        <Cabecalho titulo={p.recursos.titulo} texto={p.recursos.texto} />
        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {p.recursos.itens.map((r) => (
            <li key={r.titulo} className="pl-5" style={{ borderLeft: `3px solid ${r.cor}` }}>
              <h3 className="text-[18px] font-semibold text-[var(--ag-text)]">{r.titulo}</h3>
              <p className="mt-1.5 leading-relaxed text-[var(--ag-text-2)]">{r.texto}</p>
            </li>
          ))}
        </ul>

        <div className="mt-16 ag-glass-strong ag-sheen rounded-[26px] p-6 sm:p-8 flex flex-col sm:flex-row gap-5 sm:items-center">
          <span className="w-12 h-12 rounded-[16px] grid place-items-center shrink-0" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}>
            <ShieldCheck className="w-6 h-6" strokeWidth={1.75} />
          </span>
          <div>
            <h3 className="font-display text-[22px] font-semibold tracking-tight text-[var(--ag-text)]">{p.garantia.titulo}</h3>
            <p className="mt-1 max-w-3xl leading-relaxed text-[var(--ag-text-2)]">{p.garantia.texto}</p>
          </div>
        </div>
      </Section>

      <Section>
        <Cabecalho titulo="Antes de começar, você deve estar pensando…" centro />
        <FAQ items={p.faq} />
      </Section>

      <Section colado>
        <FinalCTA title={p.final.titulo} texto={p.final.texto} ctaLabel={`${p.cta} grátis`} ctaTo={cadastro} microcopy={MICROCOPY} />
      </Section>
    </>
  );
}
