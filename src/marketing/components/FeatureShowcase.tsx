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
      <div
        className={`relative rounded-3xl aspect-[4/3] border overflow-hidden flex items-center justify-center ${
          dark ? 'border-porcelain/15 bg-porcelain/5' : 'border-ink/10 bg-white'
        }`}
      >
        {features[active].screenshot ? (
          <img src={features[active].screenshot} alt={features[active].title} className="w-full h-full object-cover" />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundImage: `radial-gradient(circle at 30% 20%, ${dark ? 'rgba(255,91,3,0.10)' : 'rgba(255,91,3,0.06)'}, transparent 60%), radial-gradient(${dark ? 'rgba(232,224,213,0.10)' : 'rgba(20,19,17,0.07)'} 1px, transparent 1px)`,
              backgroundSize: 'auto, 16px 16px',
            }}
          >
            <div
              className={`flex flex-col items-center gap-2 px-6 py-4 rounded-2xl border ${
                dark ? 'border-porcelain/15 bg-ink/40' : 'border-ink/10 bg-porcelain/60'
              }`}
            >
              <span className={`text-[10px] font-bold uppercase tracking-widest ${accentText}`}>Prévia em breve</span>
              <span className={`text-sm text-center ${dark ? 'text-porcelain/50' : 'text-ink/40'}`}>{features[active].title}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
