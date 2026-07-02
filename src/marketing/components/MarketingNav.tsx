import { Link, NavLink } from 'react-router-dom';
import { getTheme } from '../theme';

const links = [
  { to: '/agente-de-produto', label: 'Agente de Produto' },
  { to: '/agente-de-conteudo', label: 'Agente de Conteúdo' },
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
          {links.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} className={({ isActive }) => `hover:text-orange transition-colors ${isActive ? 'text-orange' : 'text-ink/70'}`}>
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Link to="/entrar" className="text-sm font-semibold text-ink/80 hover:text-ink">Entrar</Link>
          <Link to="/entrar" className="text-sm font-bold px-4 py-2 rounded-xl bg-orange text-white hover:brightness-95 transition">Começar grátis</Link>
        </div>
      </nav>
    </header>
  );
}
