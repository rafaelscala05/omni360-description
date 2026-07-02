import { Link } from 'react-router-dom';
import { AgentTheme, getTheme } from '../theme';

interface FinalCTAProps { theme?: AgentTheme; title: string; ctaLabel: string; ctaTo: string; }

export default function FinalCTA({ theme = 'brand', title, ctaLabel, ctaTo }: FinalCTAProps) {
  const t = getTheme(theme);
  return (
    <div className="text-center">
      <h2 className="font-display text-3xl md:text-4xl font-extrabold mb-8 max-w-2xl mx-auto">{title}</h2>
      <Link to={ctaTo} className={`inline-block px-8 py-4 rounded-xl font-bold text-lg ${t.accentBgClass} ${t.onAccentClass} hover:brightness-95 transition`}>{ctaLabel}</Link>
    </div>
  );
}
