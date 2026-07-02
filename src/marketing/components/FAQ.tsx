import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FaqItem } from '../content';

export default function FAQ({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="max-w-3xl mx-auto divide-y divide-ink/10">
      {items.map((it, i) => (
        <div key={it.q}>
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between py-5 text-left">
            <span className="font-display font-bold text-lg">{it.q}</span>
            <ChevronDown className={`w-5 h-5 transition ${open === i ? 'rotate-180' : ''}`} />
          </button>
          {open === i && <p className="pb-5 text-ink/60">{it.a}</p>}
        </div>
      ))}
    </div>
  );
}
