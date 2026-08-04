import React from 'react';
import Section from './Section';

interface LegalLayoutProps {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}

/** Layout de prosa para páginas legais (Termos de Serviço, Política de Privacidade). */
export default function LegalLayout({ title, updatedAt, children }: LegalLayoutProps) {
  return (
    <Section tone="light">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display font-extrabold tracking-tight text-3xl md:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink/50">Última atualização: {updatedAt}</p>
        <div
          className="mt-10 space-y-5 text-ink/80 leading-relaxed
            [&_h2]:font-display [&_h2]:font-extrabold [&_h2]:text-xl [&_h2]:text-ink [&_h2]:mt-10 [&_h2]:mb-3
            [&_p]:leading-relaxed
            [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2
            [&_li]:leading-relaxed
            [&_strong]:font-bold [&_strong]:text-ink
            [&_a]:text-orange [&_a]:underline [&_a]:underline-offset-2"
        >
          {children}
        </div>
      </div>
    </Section>
  );
}
