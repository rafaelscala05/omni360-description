import { useState } from 'react';
import { FeatureItem } from '../content';
import { getTheme } from '../theme';

interface FeatureShowcaseProps {
  theme: 'product' | 'content';
  eyebrow: string;
  title: string;
  features: FeatureItem[];
}

export default function FeatureShowcase({ theme, eyebrow, title, features }: FeatureShowcaseProps) {
  const t = getTheme(theme);
  const [active, setActive] = useState(0);
  const dark = theme === 'content';
  const accentText = dark ? 'text-orange' : t.accentTextClass;
  return (
    <div className="grid gap-10 md:grid-cols-2 md:items-center">
      <div>
        <span className={`text-xs font-bold uppercase tracking-widest ${accentText}`}>{eyebrow}</span>
        <h2 className="font-display text-3xl md:text-4xl font-extrabold mt-3 mb-8">{title}</h2>
        <ul className="space-y-1">
          {features.map((f, i) => (
            <li key={f.title}>
              <button
                onClick={() => setActive(i)}
                className={`w-full text-left py-4 border-t ${dark ? 'border-porcelain/15' : 'border-ink/10'} ${i === active ? '' : 'opacity-60 hover:opacity-100'} transition`}
              >
                <p className="font-display font-bold text-lg flex items-center gap-3">
                  <span className={accentText}>{String(i + 1).padStart(2, '0')}</span> {f.title}
                </p>
                {i === active && <p className={`mt-2 ${dark ? 'text-porcelain/70' : 'text-ink/60'}`}>{f.description}</p>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className={`rounded-3xl aspect-[4/3] border ${dark ? 'border-porcelain/15 bg-porcelain/5' : 'border-ink/10 bg-white'} overflow-hidden flex items-center justify-center`}>
        {features[active].screenshot
          ? <img src={features[active].screenshot} alt={features[active].title} className="w-full h-full object-cover" />
          : <span className={`text-sm ${dark ? 'text-porcelain/40' : 'text-ink/30'}`}>Screenshot: {features[active].title}</span>}
      </div>
    </div>
  );
}
