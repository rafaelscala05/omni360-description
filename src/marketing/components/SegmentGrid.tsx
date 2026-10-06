import { SegmentItem } from '../content';
import { Store, ShoppingBag, Factory, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  'Loja online': Store,
  'Marketplace / Seller': ShoppingBag,
  'Indústria': Factory,
};

export default function SegmentGrid({ segments }: { segments: SegmentItem[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {segments.map((s) => {
        const Icon = icons[s.title] ?? Store;
        return (
          <div key={s.title} className="ag-glass rounded-[24px] p-6">
            <div className="w-11 h-11 rounded-[14px] grid place-items-center mb-5" style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}>
              <Icon className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <h3 className="font-display text-[20px] font-semibold mb-1.5 text-[var(--ag-text)]">{s.title}</h3>
            <p className="leading-relaxed text-[var(--ag-text-2)]">{s.pain}</p>
          </div>
        );
      })}
    </div>
  );
}
