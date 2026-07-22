import { Link, NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { getTheme } from '../theme';
import { trackMarketingCtaClick } from '../../analytics';

const agentLinks = [
  { to: '/agente-de-produto', label: 'Agente de Produto', desc: 'Cadastro, SEO, imagens e vídeo' },
  { to: '/agente-de-conteudo', label: 'Agente de Conteúdo', desc: 'Conteúdo que ranqueia' },
];

const pageLinks = [
  { to: '/precos', label: 'Preços' },
  { to: '/casos', label: 'Casos' },
];

export default function MarketingNav() {
  const brand = getTheme('brand');
  return (
    <header className="sticky top-0 z-40 bg-porcelain/90 backdrop-blur border-b border-ink/10">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-center">
          <img src={brand.logo} alt="Alfreds" className="h-7 w-auto" />
        </Link>

        <ul className="hidden md:flex items-center gap-6 text-sm font-medium">
          {/* Submenu Agentes */}
          <li className="relative group">
            <button
              type="button"
              className="flex items-center gap-1 text-ink/70 group-hover:text-orange group-focus-within:text-orange transition-colors"
            >
              Agentes
              <ChevronDown className="w-4 h-4 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-72 invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-200">
              <div className="rounded-2xl border border-ink/10 bg-white shadow-xl p-2">
                {agentLinks.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    className={({ isActive }) =>
                      `block rounded-xl px-4 py-3 transition-colors ${isActive ? 'bg-orange/5' : 'hover:bg-ink/5'}`
                    }
                  >
                    <span className="block font-bold text-ink">{l.label}</span>
                    <span className="block text-xs text-ink/50">{l.desc}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          </li>

          {pageLinks.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) => `hover:text-orange transition-colors ${isActive ? 'text-orange' : 'text-ink/70'}`}
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Link to="/entrar" className="text-sm font-semibold text-ink/80 hover:text-ink">Entrar</Link>
          <Link
            to="/entrar"
            onClick={() => trackMarketingCtaClick({ label: 'Começar grátis', destination: '/entrar' })}
            className="text-sm font-bold px-4 py-2 rounded-xl bg-orange text-white hover:brightness-95 transition"
          >Começar grátis</Link>
        </div>
      </nav>
    </header>
  );
}
