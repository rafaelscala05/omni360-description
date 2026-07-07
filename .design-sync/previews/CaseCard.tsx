import CaseCard from '../../src/marketing/components/CaseCard';

export const Metric = () => (
  <CaseCard item={{ metric: '−90%', label: 'Tempo por produto', description: 'De uma tarde inteira para minutos por item — exemplo ilustrativo.' }} />
);

export const Multiplier = () => (
  <CaseCard item={{ metric: '10×', label: 'Mais itens por dia', description: 'A mesma equipe publica muito mais, sem contratar — exemplo ilustrativo.' }} />
);

export const Row = () => (
  <div className="grid gap-6 md:grid-cols-3">
    <CaseCard item={{ metric: '−90%', label: 'Tempo por produto', description: 'De uma tarde inteira para minutos por item — exemplo ilustrativo.' }} />
    <CaseCard item={{ metric: '10×', label: 'Mais itens por dia', description: 'A mesma equipe publica muito mais, sem contratar — exemplo ilustrativo.' }} />
    <CaseCard item={{ metric: 'minutos', label: 'SEO + imagem + vídeo', description: 'Tudo gerado junto e pronto para publicar — exemplo ilustrativo.' }} />
  </div>
);
