import type { ReactNode } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import wakeLogo from '../../assets/integrations/wake.png';
import shopifyLogo from '../../assets/integrations/shopify.webp';
import tinyLogo from '../../assets/integrations/tiny.svg';

interface Integration {
  name: string;
  render: () => ReactNode;
  comingSoon?: boolean;
}

const integrations: Integration[] = [
  {
    name: 'Planilha / Excel',
    render: () => <FileSpreadsheet className="w-8 h-8 text-porcelain" strokeWidth={1.5} />,
  },
  {
    name: 'Wake Commerce',
    render: () => <img src={wakeLogo} alt="Wake Commerce" className="max-h-7 w-auto object-contain" />,
  },
  {
    name: 'Shopify',
    render: () => <img src={shopifyLogo} alt="Shopify" className="max-h-8 w-auto object-contain" />,
    comingSoon: true,
  },
  {
    name: 'ERP Tiny',
    // Logo original é azul; invertemos para branco para legibilidade no fundo escuro.
    render: () => (
      <img src={tinyLogo} alt="ERP Tiny" className="max-h-7 w-auto object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
    ),
    comingSoon: true,
  },
];

export default function IntegrationsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      {integrations.map((it) => (
        <div
          key={it.name}
          className="relative flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-9 text-center transition hover:-translate-y-1 hover:bg-white/[0.07] hover:border-white/20"
        >
          {it.comingSoon && (
            <span className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/10 text-porcelain/60">
              Em breve
            </span>
          )}
          <div className={`h-9 flex items-center justify-center ${it.comingSoon ? 'opacity-80' : ''}`}>{it.render()}</div>
          <span className="text-sm font-semibold text-porcelain/70">{it.name}</span>
        </div>
      ))}
    </div>
  );
}
