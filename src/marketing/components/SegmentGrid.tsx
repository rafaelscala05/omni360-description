import { SegmentItem } from '../content';
import { Store, ShoppingBag, Factory, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  'Loja online': Store,
  'Marketplace / Seller': ShoppingBag,
  'Indústria': Factory,
};

export default function SegmentGrid({ segments }: { segments: SegmentItem[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {segments.map((s) => {
        const Icon = icons[s.title] ?? Store;
        return (
          <div
            key={s.title}
            className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:border-orange/30"
          >
            <div className="w-12 h-12 rounded-xl bg-orange/10 text-orange flex items-center justify-center mb-4">
              <Icon className="w-6 h-6" strokeWidth={1.75} />
            </div>
            <h3 className="font-display text-xl font-bold mb-2 text-ink">{s.title}</h3>
            <p className="text-ink/60 leading-relaxed">{s.pain}</p>
          </div>
        );
      })}
    </div>
  );
}
