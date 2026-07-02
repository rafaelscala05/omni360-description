import React from 'react';
import { CaseItem } from '../content';

interface CaseCardProps {
  item: CaseItem;
}

const CaseCard: React.FC<CaseCardProps> = ({ item }) => {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6">
      <p className="font-display text-4xl font-extrabold text-orange">{item.metric}</p>
      <p className="font-bold mt-1">{item.label}</p>
      <p className="text-ink/50 text-sm mt-2">{item.description}</p>
    </div>
  );
};

export default CaseCard;
