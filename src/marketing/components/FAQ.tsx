import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FaqItem } from '../content';

export default function FAQ({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="max-w-3xl mx-auto ag-glass rounded-[26px] px-2">
      {items.map((it, i) => {
        const aberto = open === i;
        return (
          <div key={it.q} style={i ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}>
            <button
              onClick={() => setOpen(aberto ? null : i)}
              aria-expanded={aberto}
              className="w-full flex items-center justify-between gap-4 px-4 py-5 text-left rounded-[20px] focus-visible:outline-2 focus-visible:outline-[var(--ag-accent)]"
            >
              <span className="text-[17px] font-semibold text-[var(--ag-text)]">{it.q}</span>
              <Plus className={`w-5 h-5 shrink-0 text-[var(--ag-text-2)] transition-transform duration-200 ${aberto ? 'rotate-45' : ''}`} />
            </button>
            {aberto && <p className="px-4 pb-5 -mt-1 max-w-2xl leading-relaxed text-[var(--ag-text-2)]">{it.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
