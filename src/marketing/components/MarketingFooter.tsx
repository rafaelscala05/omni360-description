import { Link } from 'react-router-dom';
import logo from '../../assets/brand/logo-alfreds-conteudo.png';

const colunas = [
  {
    titulo: 'Comece por',
    links: [
      { to: '/descricoes-de-produto', label: 'Descrições de produto' },
      { to: '/mercado-livre', label: 'Mercado Livre' },
      { to: '/blog-com-ia', label: 'Blog com IA' },
    ],
  },
  {
    titulo: 'Alfreds',
    links: [
      { to: '/precos', label: 'Preços' },
      { to: '/casos', label: 'Casos' },
      { to: '/contato', label: 'Falar com a gente' },
    ],
  },
  {
    titulo: 'Legal',
    links: [
      { to: '/termos-de-servico', label: 'Termos de Serviço' },
      { to: '/politica-de-privacidade', label: 'Política de Privacidade' },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="px-3 pb-3">
      <div className="ag-glass mx-auto max-w-6xl rounded-[28px] px-6 sm:px-10 py-12">
        <div className="grid gap-10 grid-cols-2 md:grid-cols-5 text-[14.5px]">
          <div className="col-span-2">
            <img src={logo} alt="Alfreds" className="h-8 w-auto mb-4" />
            <p className="max-w-xs leading-relaxed text-[var(--ag-text-2)]">
              O agente de IA que cuida do catálogo, do Mercado Livre e do blog da sua loja. Você aprova, ele grava.
            </p>
          </div>
          {colunas.map((c) => (
            <div key={c.titulo}>
              <p className="font-semibold mb-3 text-[var(--ag-text)]">{c.titulo}</p>
              <ul className="space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="text-[var(--ag-text-2)] hover:text-[var(--ag-text)] transition-colors">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-12 pt-6 text-[13px] text-[var(--ag-text-3)]" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          © {new Date().getFullYear()} Alfreds. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
}
