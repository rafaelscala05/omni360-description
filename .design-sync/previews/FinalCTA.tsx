import FinalCTA from '../../src/marketing/components/FinalCTA';

export const Brand = () => (
  <FinalCTA
    theme="brand"
    title="Comece com 10 créditos grátis e coloque os agentes para trabalhar."
    ctaLabel="Começar grátis"
    ctaTo="/entrar"
  />
);

export const Content = () => (
  <FinalCTA
    theme="content"
    title="Pronto para um conteúdo que ranqueia?"
    ctaLabel="Conhecer o Agente de Conteúdo"
    ctaTo="/agente-de-conteudo"
  />
);
