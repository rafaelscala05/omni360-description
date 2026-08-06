// Aba "Timeline": eventos do CRM e credit_logs num feed único, já fundido e
// ordenado pelo servidor. Responde "o que esse cliente fez, e quando".

import { useEffect, useState } from 'react';
import type { TimelineEntry } from '../../types/crm';
import { getTimeline } from '../../services/adminService';
import { Card, EmptyState, ErrorBanner, Spinner, formatDateTime } from './ui';

export default function CustomerTimeline({ uid }: { uid: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getTimeline(uid)
      .then(({ entries: list }) => {
        if (!cancelled) setEntries(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <Card className="p-5">
      {entries.length === 0 ? (
        <EmptyState
          title="Nenhuma atividade registrada"
          hint="Se o cliente é antigo, rode a reconciliação para trazer o histórico de créditos."
        />
      ) : (
        <ol className="relative">
          {entries.map((entry, i) => (
            <li key={`${entry.kind}-${entry.id}`} className="flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center shrink-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full mt-1.5 ${
                    entry.kind === 'event' ? 'bg-violet-500' : 'bg-amber-400'
                  }`}
                />
                {i < entries.length - 1 && <span className="flex-1 w-px bg-slate-200 mt-1" />}
              </div>

              <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm font-semibold text-slate-800">{entry.label}</span>
                {entry.detail && <span className="text-xs text-slate-400 truncate">{entry.detail}</span>}
                {entry.credits !== 0 && (
                  <span
                    className={`text-xs font-bold ${entry.credits > 0 ? 'text-emerald-600' : 'text-rose-500'}`}
                  >
                    {entry.credits > 0 ? `+${entry.credits}` : `−${Math.abs(entry.credits)}`} cr.
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                  {formatDateTime(entry.ts)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
