import { Link } from 'react-router-dom';
import { AgentTheme, getTheme } from '../theme';

interface HeroProps {
  theme?: AgentTheme;
  eyebrow?: string;
  titleLead: string;
  titleAccent: string;
  titleTail?: string;
  subtitle: string;
  primaryCta: { label: string; to: string };
  secondaryCta?: { label: string; to: string };
  microcopy?: string;
}

export default function Hero({ theme = 'brand', eyebrow, titleLead, titleAccent, titleTail, subtitle, primaryCta, secondaryCta, microcopy }: HeroProps) {
  const t = getTheme(theme);
  const dark = theme === 'content';
  return (
    <section className={`relative overflow-hidden ${dark ? 'bg-ink text-porcelain' : 'bg-porcelain text-ink'}`}>
      <div className="max-w-5xl mx-auto px-6 py-24 md:py-32 text-center">
        {eyebrow && <span className={`inline-block mb-5 text-xs font-bold uppercase tracking-widest ${t.accentTextClass}`}>{eyebrow}</span>}
        <h1 className="font-display font-extrabold tracking-tight text-4xl md:text-6xl leading-[1.05]">
          {titleLead} <span className={t.accentTextClass}>{titleAccent}</span>{titleTail ? ` ${titleTail}` : ''}
        </h1>
        <p className={`mt-6 text-lg md:text-xl max-w-2xl mx-auto ${dark ? 'text-porcelain/70' : 'text-ink/70'}`}>{subtitle}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to={primaryCta.to} className={`px-6 py-3.5 rounded-xl font-bold ${t.accentBgClass} ${t.onAccentClass} hover:brightness-95 transition`}>{primaryCta.label}</Link>
          {secondaryCta && (
            <Link to={secondaryCta.to} className={`px-6 py-3.5 rounded-xl font-bold border ${dark ? 'border-porcelain/30 text-porcelain hover:bg-porcelain/10' : 'border-ink/20 text-ink hover:bg-ink/5'} transition`}>{secondaryCta.label}</Link>
          )}
        </div>
        {microcopy && <p className={`mt-4 text-sm ${dark ? 'text-porcelain/50' : 'text-ink/50'}`}>{microcopy}</p>}
      </div>
    </section>
  );
}
