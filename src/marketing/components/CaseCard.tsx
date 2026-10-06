import React from 'react';
import { CaseItem } from '../content';

const CaseCard: React.FC<{ item: CaseItem }> = ({ item }) => (
  <div className="ag-glass ag-sheen rounded-[24px] p-6">
    <p className="font-display text-[44px] font-semibold leading-none tracking-[-0.04em] text-[var(--ag-text)]">{item.metric}</p>
    <p className="mt-3 font-semibold text-[var(--ag-text)]">{item.label}</p>
    <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ag-text-2)]">{item.description}</p>
  </div>
);

export default CaseCard;
