import React from 'react';
import { Cta, Selo } from './ui';

interface HeroProps {
  selo?: { cor: string; texto: string };
  titulo: React.ReactNode;
  subtitulo: React.ReactNode;
  primario: { label: string; to: string };
  secundario?: { label: string; to: string };
  microcopy?: string;
  /** Demonstração ao lado do texto (vira coluna a partir de lg). */
  lado?: React.ReactNode;
  /** 'topo' quando a peça ao lado muda de altura (a demo da semana), para o texto não pular. */
  alinhar?: 'centro' | 'topo';
}

/** Abertura das páginas: texto à esquerda, a peça do produto à direita. */
export default function Hero({ selo, titulo, subtitulo, primario, secundario, microcopy, lado, alinhar = 'centro' }: HeroProps) {
  return (
    <section className="relative">
      <div className={`max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-16 md:pt-24 md:pb-24 grid gap-12 ${lado ? `lg:grid-cols-[1.2fr_1fr] ${alinhar === 'topo' ? 'lg:items-start' : 'lg:items-center'}` : ''}`}>
        <div className={lado ? (alinhar === 'topo' ? 'lg:pt-16' : '') : 'max-w-3xl'}>
          {selo && <div className="ag-rise mb-6"><Selo cor={selo.cor}>{selo.texto}</Selo></div>}
          <h1
            className="ag-rise font-display font-semibold text-[var(--ag-text)] text-[40px] sm:text-[52px] lg:text-[58px] leading-[0.98] tracking-[-0.04em] text-balance"
            style={{ animationDelay: '60ms' }}
          >
            {titulo}
          </h1>
          <p className="ag-rise mt-6 max-w-xl text-[18px] md:text-[19px] leading-relaxed text-[var(--ag-text-2)] text-pretty" style={{ animationDelay: '120ms' }}>
            {subtitulo}
          </p>
          <div className="ag-rise mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: '180ms' }}>
            <Cta to={primario.to} grande>{primario.label}</Cta>
            {secundario && <Cta to={secundario.to} variante="vidro" grande>{secundario.label}</Cta>}
          </div>
          {microcopy && <p className="ag-rise mt-4 text-[14px] text-[var(--ag-text-3)]" style={{ animationDelay: '220ms' }}>{microcopy}</p>}
        </div>
        {lado && <div className="ag-rise min-w-0" style={{ animationDelay: '240ms' }}>{lado}</div>}
      </div>
    </section>
  );
}
