import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus } from 'lucide-react';

interface Props {
  label?: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}

// Text → tag input with optional clickable suggestions. Type and press Enter (or
// comma) to add; Backspace on empty removes the last; click × to remove.
const TagInput: React.FC<Props> = ({ label, hint, value, onChange, suggestions = [], placeholder }) => {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
  };
  const remove = (t: string) => onChange(value.filter((v) => v !== t));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
      setDraft('');
    } else if (e.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1]);
    }
  };

  const remaining = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div>
      {label && <label className="block text-sm font-semibold text-(--ag-text) mb-1.5">{label}</label>}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-(--ag-hairline-2) bg-(--ag-surface-solid) px-2.5 py-2 focus-within:ring-2 focus-within:ring-(--ag-accent)/30 focus-within:border-(--ag-accent) transition-all">
        <AnimatePresence initial={false}>
          {value.map((tag) => (
            <motion.span
              key={tag}
              layout
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="inline-flex items-center gap-1 rounded-lg border border-(--ag-accent-line) bg-(--ag-accent-soft) px-2 py-0.5 text-xs font-medium text-(--ag-accent)"
            >
              {tag}
              <button type="button" onClick={() => remove(tag)} className="hover:text-(--ag-text)/70">
                <X className="w-3 h-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (draft.trim()) { add(draft); setDraft(''); } }}
          placeholder={value.length ? '' : placeholder}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none py-0.5 text-(--ag-text) placeholder-(--ag-text-3)"
        />
      </div>
      {hint && <p className="text-xs text-(--ag-text-3) mt-1">{hint}</p>}
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {remaining.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-(--ag-hairline-2) bg-(--ag-fill) px-2 py-0.5 text-xs font-medium text-(--ag-text-2) hover:border-(--ag-accent) hover:text-(--ag-accent) transition-colors"
            >
              <Plus className="w-3 h-3" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TagInput;
