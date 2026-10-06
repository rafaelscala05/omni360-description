import AlfredLogo from '../../components/alfredLogo/AlfredLogo';
import { Cta } from './ui';

interface FinalCTAProps {
  title: string;
  texto?: string;
  ctaLabel: string;
  ctaTo: string;
  microcopy?: string;
}

/** Fecho de página: a esfera do Alfred, uma frase e uma ação. */
export default function FinalCTA({ title, texto, ctaLabel, ctaTo, microcopy = '10 créditos grátis para testar. Sem cartão.' }: FinalCTAProps) {
  return (
    <div className="ag-glass-strong ag-sheen rounded-[32px] px-6 py-14 md:py-20 text-center flex flex-col items-center">
      <AlfredLogo size={84} rotulo="Alfred" />
      <h2 className="mt-6 font-display text-[32px] md:text-[46px] font-semibold leading-[1.04] tracking-[-0.035em] text-[var(--ag-text)] max-w-2xl text-balance">
        {title}
      </h2>
      {texto && <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-[var(--ag-text-2)]">{texto}</p>}
      <Cta to={ctaTo} grande className="mt-9">{ctaLabel}</Cta>
      {microcopy && <p className="mt-4 text-[14px] text-[var(--ag-text-3)]">{microcopy}</p>}
    </div>
  );
}
