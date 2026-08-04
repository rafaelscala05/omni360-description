import { Link } from 'react-router-dom';
import { getTheme } from '../theme';

export default function MarketingFooter() {
  const brand = getTheme('content'); // logo preto sobre fundo claro do footer
  return (
    <footer className="bg-porcelain border-t border-ink/10">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-8 grid-cols-2 md:grid-cols-5 text-sm">
        <div className="col-span-2">
          <img src={brand.logo} alt="Alfreds" className="h-8 w-auto mb-3" />
          <p className="text-ink/60 max-w-xs">Um esquadrão de Agentes de IA que trabalham pelo seu e-commerce.</p>
        </div>
        <div>
          <p className="font-bold mb-3">Agentes</p>
          <ul className="space-y-2 text-ink/70">
            <li><Link to="/agente-de-produto" className="hover:text-orange">Agente de Produto</Link></li>
            <li><Link to="/agente-de-conteudo" className="hover:text-orange">Agente de Conteúdo</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-bold mb-3">Empresa</p>
          <ul className="space-y-2 text-ink/70">
            <li><Link to="/precos" className="hover:text-orange">Preços</Link></li>
            <li><Link to="/casos" className="hover:text-orange">Casos</Link></li>
            <li><Link to="/contato" className="hover:text-orange">Contato</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-bold mb-3">Legal</p>
          <ul className="space-y-2 text-ink/70">
            <li><Link to="/termos-de-servico" className="hover:text-orange">Termos de Serviço</Link></li>
            <li><Link to="/politica-de-privacidade" className="hover:text-orange">Política de Privacidade</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink/10 py-6 text-center text-xs text-ink/50">
        © {new Date().getFullYear()} Alfreds. Todos os direitos reservados.
      </div>
    </footer>
  );
}
