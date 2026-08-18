import React from 'react';
import { Check, Loader2 } from 'lucide-react';

interface Props {
  icon: React.ElementType;
  title: string;
  description: string;
  costLabel: string;
  isRunning: boolean;
  isDone: boolean;
  error: string | null;
  onRun: () => void;
  onSkip: () => void;
}

const EnrichmentStepCard: React.FC<Props> = ({ icon: Icon, title, description, costLabel, isRunning, isDone, error, onRun, onSkip }) => {
  return (
    <div className="text-center py-4">
      <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4 ${isDone ? 'bg-emerald-50' : 'bg-orange-50'}`}>
        {isDone ? <Check className="w-7 h-7 text-emerald-500" /> : <Icon className="w-7 h-7 text-orange-500" />}
      </div>
      <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>
      {!isDone && <p className="text-xs text-slate-400 mt-2 font-semibold uppercase tracking-wide">{costLabel}</p>}
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{error}</p>}

      {!isDone && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={onSkip}
            disabled={isRunning}
            className="px-5 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            Pular
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors disabled:opacity-50"
          >
            {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
            {isRunning ? 'Gerando...' : 'Gerar'}
          </button>
        </div>
      )}
    </div>
  );
};

export default EnrichmentStepCard;
