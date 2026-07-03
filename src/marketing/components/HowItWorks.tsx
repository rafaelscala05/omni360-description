import { howItWorks } from '../content';

export default function HowItWorks() {
  return (
    <div className="grid gap-8 md:grid-cols-3">
      {howItWorks.map((s) => (
        <div key={s.step} className="relative">
          <div className="w-12 h-12 rounded-2xl bg-orange text-white font-display font-extrabold text-xl flex items-center justify-center mb-4 shadow-lg shadow-orange/25">
            {s.step}
          </div>
          <h3 className="font-display text-xl font-bold mb-2 text-porcelain">{s.title}</h3>
          <p className="text-porcelain/60 leading-relaxed">{s.description}</p>
        </div>
      ))}
    </div>
  );
}
