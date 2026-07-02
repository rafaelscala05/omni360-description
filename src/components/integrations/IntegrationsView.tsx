import React from 'react';
import { Plug, Store, Database } from 'lucide-react';
import WakeConnector, { type WakePushFields } from './WakeConnector';
import type { WakeNormalizedProduct, WakePushProduct } from '../../services/wakeService';

interface Props {
  onImport: (produtos: WakeNormalizedProduct[]) => Promise<void>;
  getPushPayload: (campos: WakePushFields) => Promise<WakePushProduct[]>;
}

const IntegrationsView: React.FC<Props> = ({ onImport, getPushPayload }) => {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-[#FF5B03]/10 p-2 rounded-lg">
          <Plug className="w-5 h-5 text-[#FF5B03]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800">Integrações</h2>
          <p className="text-sm text-slate-500">Conecte sua loja e seus sistemas para importar e enviar produtos.</p>
        </div>
      </div>

      {/* Wake Commerce */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="bg-slate-900 p-2 rounded-lg">
            <Store className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Wake Commerce</h3>
            <p className="text-xs text-slate-500">Importe produtos e envie dados enriquecidos.</p>
          </div>
        </header>
        <div className="px-5 py-5">
          <WakeConnector onImport={onImport} getPushPayload={getPushPayload} />
        </div>
      </section>

      {/* ERP Tiny — placeholder */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm opacity-70">
        <header className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-slate-200 p-2 rounded-lg">
              <Database className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-700">ERP Tiny</h3>
              <p className="text-xs text-slate-500">Sincronização com o ERP Tiny.</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
            Em breve
          </span>
        </header>
      </section>
    </div>
  );
};

export default IntegrationsView;
