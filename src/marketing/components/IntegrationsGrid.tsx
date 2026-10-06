import type { ReactNode } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import wakeLogo from '../../assets/integrations/wake.png';
import tinyLogo from '../../assets/integrations/tiny.svg';
import idworksLogo from '../../assets/integrations/idworks.svg';

// Vive numa faixa escura: o logo da Wake é branco e o do Tiny é invertido.
interface Integracao {
  nome: string;
  papel: string;
  logo: ReactNode;
}

const integracoes: Integracao[] = [
  { nome: 'Tiny', papel: 'ERP', logo: <img src={tinyLogo} alt="Tiny" className="h-7 w-auto" style={{ filter: 'brightness(0) invert(1)' }} /> },
  { nome: 'Bling', papel: 'ERP', logo: <span className="font-display text-[24px] font-bold tracking-tight text-[var(--ag-text)]">bling</span> },
  {
    nome: 'IdWorks',
    papel: 'ERP',
    logo: (
      <span className="flex items-center gap-2">
        <img src={idworksLogo} alt="" className="h-7 w-7 rounded-[7px] ring-1 ring-white/25" />
        <span className="font-display text-[20px] font-semibold text-[var(--ag-text)]">IdWorks</span>
      </span>
    ),
  },
  { nome: 'Wake', papel: 'Loja', logo: <img src={wakeLogo} alt="Wake Commerce" className="h-8 w-auto" /> },
  {
    nome: 'Mercado Livre',
    papel: 'Marketplace',
    logo: <span className="rounded-full px-3 py-1 text-[15px] font-bold" style={{ background: '#ffe600', color: '#2d3277' }}>Mercado Livre</span>,
  },
  { nome: 'Planilha ou link', papel: 'Qualquer loja', logo: <FileSpreadsheet className="w-8 h-8 text-[var(--ag-text)]" strokeWidth={1.5} /> },
];

export default function IntegrationsGrid() {
  return (
    <ul className="grid gap-3 grid-cols-2 md:grid-cols-3">
      {integracoes.map((it) => (
        <li key={it.nome} className="ag-glass rounded-[22px] px-5 py-7 flex flex-col items-center justify-center gap-4 text-center">
          <div className="h-9 flex items-center justify-center">{it.logo}</div>
          <div>
            <p className="text-[14.5px] font-semibold text-[var(--ag-text)]">{it.nome}</p>
            <p className="text-[12.5px] text-[var(--ag-text-3)]">{it.papel}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
