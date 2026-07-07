import Hero from '../../src/marketing/components/Hero';

export const Brand = () => (
  <Hero
    theme="brand"
    eyebrow="Agentes de IA para e-commerce"
    titleLead="Uma equipe de"
    titleAccent="Agentes de IA"
    titleTail="para cuidar do seu e-commerce."
    subtitle="Enquanto você foca em vender, os agentes do Alfreds cuidam do cadastro, do SEO, das imagens e do conteúdo da sua loja."
    primaryCta={{ label: 'Começar grátis', to: '/entrar' }}
    secondaryCta={{ label: 'Ver os agentes em ação', to: '/agente-de-produto' }}
    microcopy="10 créditos grátis · sem cartão"
  />
);

export const Content = () => (
  <Hero
    theme="content"
    eyebrow="Agente de Conteúdo"
    titleLead="Conteúdo que"
    titleAccent="ranqueia"
    titleTail="na voz da sua marca."
    subtitle="O Agente de Conteúdo planeja, escreve e otimiza artigos para o seu negócio, do mapa de temas ao calendário editorial."
    primaryCta={{ label: 'Conhecer o agente', to: '/agente-de-conteudo' }}
  />
);
