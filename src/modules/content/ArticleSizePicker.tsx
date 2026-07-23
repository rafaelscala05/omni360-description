import React from 'react';
import type { ArticleSize } from './types';

interface Props {
  value?: ArticleSize;
  onChange: (size: ArticleSize) => void;
  disabled?: boolean;
}

const OPTIONS: { size: ArticleSize; letter: string; label: string; range: string }[] = [
  { size: 'curto', letter: 'C', label: 'Curto', range: '600–900 palavras' },
  { size: 'medio', letter: 'M', label: 'Médio', range: '1.200–1.800 palavras' },
  { size: 'longo', letter: 'L', label: 'Longo', range: '2.200–3.000 palavras' },
];

// Compact 3-way segmented control for the article's target size (Curto/Médio/Longo).
// Articles created before this feature have no `tamanho` — treated as 'medio'.
const ArticleSizePicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const active = value ?? 'medio';
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 overflow-hidden shrink-0" role="group" aria-label="Tamanho do artigo">
      {OPTIONS.map((opt) => (
        <button
          key={opt.size}
          type="button"
          disabled={disabled}
          title={`${opt.label} (${opt.range})`}
          onClick={() => opt.size !== active && onChange(opt.size)}
          className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
            opt.size === active ? 'bg-[#FF5B03] text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
          }`}
        >
          {opt.letter}
        </button>
      ))}
    </div>
  );
};

export default ArticleSizePicker;
