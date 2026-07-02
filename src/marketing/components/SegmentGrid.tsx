import { SegmentItem } from '../content';

export default function SegmentGrid({ segments }: { segments: SegmentItem[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {segments.map((s) => (
        <div
          key={s.title}
          className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:border-orange/30"
        >
          <h3 className="font-display text-xl font-bold mb-2">{s.title}</h3>
          <p className="text-ink/60">{s.pain}</p>
        </div>
      ))}
    </div>
  );
}
