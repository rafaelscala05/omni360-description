import Section from '../../src/marketing/components/Section';

export const Light = () => (
  <Section tone="light">
    <div className="max-w-2xl mx-auto text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-orange">Resultados</span>
      <h2 className="font-display text-3xl md:text-4xl font-extrabold mt-3">Seção em fundo claro</h2>
      <p className="mt-4 text-ink/60">
        A Section aplica largura total, respiro vertical e centraliza o conteúdo até 6xl — usada como faixa entre
        todas as seções da home.
      </p>
    </div>
  </Section>
);

export const Dark = () => (
  <Section tone="dark">
    <div className="max-w-2xl mx-auto text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-orange">Como funciona</span>
      <h2 className="font-display text-3xl md:text-4xl font-extrabold mt-3">Seção em fundo escuro</h2>
      <p className="mt-4 text-porcelain/70">Tone="dark" inverte para fundo ink e texto porcelana.</p>
    </div>
  </Section>
);
