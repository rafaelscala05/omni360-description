import { Link } from 'react-router-dom';
import { getTheme } from '../theme';
import { ArrowRight } from 'lucide-react';

interface AgentCardProps {
  theme: 'product' | 'content';
  title: string;
  description: string;
  to: string;
}

export default function AgentCard({ theme, title, description, to }: AgentCardProps) {
  const t = getTheme(theme);
  const dark = theme === 'content';
  const ctaClass = dark ? 'text-orange' : t.accentTextClass;
  return (
    <Link to={to} className={`group block rounded-3xl p-8 border transition hover:-translate-y-1 ${dark ? 'bg-ink text-porcelain border-ink' : 'bg-white text-ink border-orange/30'}`}>
      <img src={t.logo} alt={t.name} className="h-8 w-auto mb-6" />
      <h3 className="font-display text-2xl font-extrabold mb-2">{title}</h3>
      <p className={`${dark ? 'text-porcelain/70' : 'text-ink/60'} mb-6`}>{description}</p>
      <span className={`inline-flex items-center gap-1.5 font-bold ${ctaClass}`}>
        Conhecer o agente <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
      </span>
    </Link>
  );
}
