import React from 'react';

interface SectionProps {
  tone?: 'light' | 'dark';
  id?: string;
  className?: string;
  children: React.ReactNode;
}

/** Faixa de conteúdo full-width com fundo claro (porcelana) ou escuro (ink). */
export default function Section({ tone = 'light', id, className = '', children }: SectionProps) {
  const toneClass = tone === 'dark' ? 'bg-ink text-porcelain' : 'bg-porcelain text-ink';
  return (
    <section id={id} className={`w-full ${toneClass} ${className}`}>
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">{children}</div>
    </section>
  );
}
