// src/components/modals/videoWizardShared.tsx
//
// Pieces genuinely shared between VideoGenerationTab.tsx (classic) and
// UgcVideoGenerationTab.tsx (UGC avatar) — extracted verbatim, no behavior change.
import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');

export function PrereqItem({ ok, label, onFix, fixLabel }: {
  ok: boolean; label: string; onFix: () => void; fixLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
        <span className={cn('text-sm font-medium', ok ? 'text-slate-700' : 'text-slate-600')}>
          {label}
        </span>
      </div>
      {!ok && (
        <button
          type="button"
          onClick={onFix}
          className="shrink-0 text-xs font-bold text-violet-600 hover:text-violet-800 underline underline-offset-2 transition-colors"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}
