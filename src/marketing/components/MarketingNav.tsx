import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import logo from '../../assets/brand/logo-alfreds-produtos.png';
import { Cta } from './ui';
import { linkCadastro } from '../objetivoSite';

/** As três portas de entrada do onboarding, com a cor de origem de cada uma no app. */
export const PAGINAS_OBJETIVO = [
  { to: '/descricoes-de-produto', label: 'Descrições', cor: 'var(--ag-orig-produto)' },
  { to: '/mercado-livre', label: 'Mercado Livre', cor: 'var(--ag-orig-meli)' },
  { to: '/blog-com-ia', label: 'Blog', cor: 'var(--ag-orig-conteudo)' },
];

const links = [...PAGINAS_OBJETIVO, { to: '/precos', label: 'Preços', cor: '' }];

export default function MarketingNav() {
  const [aberto, setAberto] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setAberto(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 px-3 pt-3">
      <nav
        aria-label="Principal"
        className="ag-glass-strong ag-sheen mx-auto max-w-6xl rounded-[22px] h-14 pl-4 pr-2 flex items-center justify-between gap-4"
      >
        <Link to="/" className="flex items-center shrink-0" aria-label="Alfreds, página inicial">
          <img src={logo} alt="Alfreds" className="h-7 w-auto" />
        </Link>

        <ul className="hidden md:flex items-center gap-1 text-[14.5px] font-medium">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className="flex items-center gap-2 rounded-full px-3.5 py-2 transition-colors hover:bg-[var(--ag-fill)]"
                style={({ isActive }) => ({ color: isActive ? 'var(--ag-text)' : 'var(--ag-text-2)', background: isActive ? 'var(--ag-fill-2)' : undefined })}
              >
                {l.cor && <span className="w-1.5 h-1.5 rounded-full" style={{ background: l.cor }} />}
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5">
          <Link to="/entrar" className="hidden sm:inline-flex rounded-full px-4 py-2 text-[14.5px] font-semibold text-[var(--ag-text)] hover:bg-[var(--ag-fill)]">
            Entrar
          </Link>
          <Cta to={linkCadastro()} rotulo="Começar grátis (nav)" className="!min-h-[40px] !px-4">Começar grátis</Cta>
          <button
            type="button"
            className="md:hidden w-10 h-10 grid place-items-center rounded-full text-[var(--ag-text)] hover:bg-[var(--ag-fill)]"
            aria-expanded={aberto}
            aria-controls="menu-site"
            aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setAberto((v) => !v)}
          >
            {aberto ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {aberto && (
        <div id="menu-site" className="md:hidden ag-glass-strong ag-sheen ag-rise mx-auto mt-2 max-w-6xl rounded-[22px] p-2">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className="flex items-center gap-3 rounded-[16px] px-4 min-h-[48px] text-[16px] font-medium text-[var(--ag-text)] hover:bg-[var(--ag-fill)]">
              <span className="w-2 h-2 rounded-full" style={{ background: l.cor || 'transparent' }} />
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/entrar" className="flex items-center gap-3 rounded-[16px] px-4 min-h-[48px] text-[16px] font-medium text-[var(--ag-text)] hover:bg-[var(--ag-fill)]">
            <span className="w-2 h-2" />
            Entrar
          </NavLink>
        </div>
      )}
    </header>
  );
}
