// Peças comuns do site, todas sobre os tokens `--ag-*` do Alfred: o site usa o
// mesmo vidro, a mesma aurora e os mesmos botões em pílula do app, para quem
// cria a conta reconhecer na hora a tela que encontra do outro lado.

import React from 'react';
import { Link } from 'react-router-dom';
import { trackMarketingCtaClick } from '../../analytics';

type VarianteCta = 'primario' | 'escuro' | 'vidro';

const ESTILO_CTA: Record<VarianteCta, React.CSSProperties> = {
  primario: { background: 'var(--ag-accent)', color: '#fff', boxShadow: '0 10px 28px -12px color-mix(in srgb, var(--ag-accent) 70%, transparent)' },
  escuro: { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' },
  vidro: { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' },
};

interface CtaProps {
  to: string;
  children: React.ReactNode;
  variante?: VarianteCta;
  grande?: boolean;
  className?: string;
  /** Texto do evento de analytics; por padrão, o próprio rótulo. */
  rotulo?: string;
}

/** Botão-link em pílula. `to` com `#` rola até a âncora em vez de navegar. */
export function Cta({ to, children, variante = 'primario', grande, className = '', rotulo }: CtaProps) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,filter] duration-150 hover:brightness-[1.06] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ag-accent)] ${
    grande ? 'min-h-[52px] px-7 text-[16px]' : 'min-h-[44px] px-5 text-[14.5px]'
  } ${className}`;
  const track = () => trackMarketingCtaClick({ label: rotulo ?? (typeof children === 'string' ? children : to), destination: to });
  if (to.startsWith('#')) {
    return <a href={to} onClick={track} className={cls} style={ESTILO_CTA[variante]}>{children}</a>;
  }
  return <Link to={to} onClick={track} className={cls} style={ESTILO_CTA[variante]}>{children}</Link>;
}

interface SectionProps {
  tone?: 'light' | 'dark';
  id?: string;
  className?: string;
  /** Sem respiro no topo: continua a seção de cima. */
  colado?: boolean;
  children: React.ReactNode;
}

/**
 * Faixa de conteúdo. A clara é transparente (deixa a aurora do layout passar);
 * a escura reabre o escopo `.alfreds` no tema escuro, então tudo dentro dela
 * segue os mesmos tokens sem uma classe de cor própria.
 */
export function Section({ tone = 'light', id, className = '', colado, children }: SectionProps) {
  const inner = <div className={`max-w-6xl mx-auto px-4 sm:px-6 pb-16 md:pb-24 ${colado ? '' : 'pt-16 md:pt-24'}`}>{children}</div>;
  if (tone === 'dark') {
    return (
      <section id={id} data-tema="escuro" className={`alfreds ag-aurora scroll-mt-20 ${className}`}>
        {inner}
      </section>
    );
  }
  return <section id={id} className={`relative scroll-mt-20 ${className}`}>{inner}</section>;
}

/** Selo de origem, igual ao das tarefas da semana: bolinha na cor + nome. */
export function Selo({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium ag-glass" style={{ color: 'var(--ag-text-2)' }}>
      <span className="w-2 h-2 rounded-full" style={{ background: cor }} />
      {children}
    </span>
  );
}

interface CabecalhoProps {
  titulo: React.ReactNode;
  texto?: React.ReactNode;
  centro?: boolean;
  className?: string;
}

/** Título de seção: display grande, frase em caixa de sentença, apoio curto. */
export function Cabecalho({ titulo, texto, centro, className = '' }: CabecalhoProps) {
  return (
    <div className={`${centro ? 'text-center mx-auto' : ''} max-w-2xl mb-12 ${className}`}>
      <h2 className="font-display text-[32px] md:text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--ag-text)] text-balance">
        {titulo}
      </h2>
      {texto && <p className="mt-4 text-[17px] leading-relaxed text-[var(--ag-text-2)] text-pretty">{texto}</p>}
    </div>
  );
}
