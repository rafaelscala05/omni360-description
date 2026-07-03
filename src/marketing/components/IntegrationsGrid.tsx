import type { ReactNode } from 'react';

/** Marcas das integrações, desenhadas como SVG inline (sem requisições externas). */
const ExcelLogo = () => (
  <svg viewBox="0 0 48 48" className="w-11 h-11" aria-hidden>
    <rect width="48" height="48" rx="11" fill="#1D6F42" />
    <path
      fill="#fff"
      d="M15.5 15.5h4.2l4.3 6 4.3-6h4.2l-6.2 8.5 6.2 8.5h-4.2l-4.3-6-4.3 6h-4.2l6.2-8.5z"
    />
  </svg>
);

const WakeLogo = () => (
  <svg viewBox="0 0 48 48" className="w-11 h-11" aria-hidden>
    <rect width="48" height="48" rx="11" fill="#141311" />
    <path
      fill="#FF5B03"
      d="M11 17h4.4l2.6 9.2 2.7-9.2h3.6l2.7 9.2 2.6-9.2H37l-4.8 14h-4.2l-2.5-8.4-2.5 8.4h-4.2z"
    />
  </svg>
);

const ShopifyLogo = () => (
  <svg viewBox="0 0 48 48" className="w-11 h-11" aria-hidden>
    <rect width="48" height="48" rx="11" fill="#95BF47" />
    <path
      fill="#fff"
      d="M30.7 17.8c-.1-.1-.2-.1-.3-.1l-1.7-.1s-1.4-1.4-1.6-1.5c-.1-.1-.2-.1-.3-.1l-.7 16.2 5.9-1.3s-1.1-11-1.1-11.6c0-.2-.1-.3-.1-.4zm-3.3-.9c-.2 0-.4.1-.6.1 0-.3-.1-.7-.3-1.1-.5-1-1.3-1.5-2.2-1.5-.6-.6-.3.2-.4.2-1-.3-1.9.4-2.6 1.4-.5.7-.9 1.6-1 2.3l-1.8.6c-.5.2-.6.2-.6.7-.1.4-1.5 11.3-1.5 11.3l11 1.9 1.6-15.9c-.9.3-1.4.5-1.6.5zm-2.4.7-1.9.6c.2-.7.5-1.4.9-1.9.2-.2.4-.4.6-.5.2.5.2 1.1.2 1.8zm-1.4-3.1c.2 0 .4 0 .5.1-.2.1-.4.3-.6.5-.5.6-.9 1.5-1.1 2.4l-1.5.5c.4-1.5 1.5-3.4 2.7-4z"
    />
  </svg>
);

const TinyLogo = () => (
  <svg viewBox="0 0 48 48" className="w-11 h-11" aria-hidden>
    <rect width="48" height="48" rx="11" fill="#00C2A8" />
    <text
      x="50%"
      y="55%"
      dominantBaseline="middle"
      textAnchor="middle"
      fill="#fff"
      fontSize="18"
      fontWeight="800"
      fontFamily="'Bricolage Grotesque', sans-serif"
    >
      tiny
    </text>
  </svg>
);

interface Integration {
  name: string;
  logo: ReactNode;
  comingSoon?: boolean;
}

const integrations: Integration[] = [
  { name: 'Planilha / Excel', logo: <ExcelLogo /> },
  { name: 'Wake Commerce', logo: <WakeLogo /> },
  { name: 'Shopify', logo: <ShopifyLogo />, comingSoon: true },
  { name: 'ERP Tiny', logo: <TinyLogo />, comingSoon: true },
];

export default function IntegrationsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      {integrations.map((it) => (
        <div
          key={it.name}
          className="relative flex flex-col items-center gap-3 rounded-2xl border border-ink/10 bg-white px-5 py-7 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:border-orange/30"
        >
          {it.comingSoon && (
            <span className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-ink/5 text-ink/45">
              Em breve
            </span>
          )}
          <div className={it.comingSoon ? 'opacity-60' : ''}>{it.logo}</div>
          <span className="font-bold text-ink/80">{it.name}</span>
        </div>
      ))}
    </div>
  );
}
