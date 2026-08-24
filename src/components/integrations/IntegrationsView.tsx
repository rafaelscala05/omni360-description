import React from 'react';
import { Plug, Store, Database } from 'lucide-react';
import WakeConnector, { type WakePushFields } from './WakeConnector';
import TinyConnector from './TinyConnector';
import type { WakeNormalizedProduct, WakePushProduct } from '../../services/wakeService';
import type { TinyPushProduct } from '../../services/tinyService';
import BlingConnector, { type BlingPushFields, type BlingPushCandidate } from './BlingConnector';
import type { BlingPushProduct, BlingPushResult } from '../../services/blingService';
import IdworksConnector, { type IdworksPushFields, type IdworksPushCandidate } from './IdworksConnector';
import type { IdworksPushProduct, IdworksPushResult } from '../../services/idworksService';

interface Props {
  onImport: (produtos: WakeNormalizedProduct[]) => Promise<void>;
  getPushPayload: (campos: WakePushFields) => Promise<WakePushProduct[]>;
  onTinyImported: () => void;
  getTinyPushPayload: () => Promise<TinyPushProduct[]>;
  tinyPushCandidateCount: number;
  onBlingImported: () => void;
  getBlingPushPayload: (campos: BlingPushFields) => Promise<BlingPushProduct[]>;
  getBlingPushCandidates: (campos: BlingPushFields) => BlingPushCandidate[];
  onBlingPushed: (results: BlingPushResult[]) => void;
  onIdworksImported: () => void;
  getIdworksPushPayload: (campos: IdworksPushFields) => Promise<IdworksPushProduct[]>;
  getIdworksPushCandidates: (campos: IdworksPushFields) => IdworksPushCandidate[];
  onIdworksPushed: (results: IdworksPushResult[]) => void;
}

const IntegrationsView: React.FC<Props> = ({ onImport, getPushPayload, onTinyImported, getTinyPushPayload, tinyPushCandidateCount, onBlingImported, getBlingPushPayload, getBlingPushCandidates, onBlingPushed, onIdworksImported, getIdworksPushPayload, getIdworksPushCandidates, onIdworksPushed }) => {
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

      {/* ERP Tiny */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="bg-slate-900 p-2 rounded-lg">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">ERP Tiny</h3>
            <p className="text-xs text-slate-500">Importe produtos e envie dados enriquecidos.</p>
          </div>
        </header>
        <div className="px-5 py-5">
          <TinyConnector onImported={onTinyImported} getPushPayload={getTinyPushPayload} pushCandidateCount={tinyPushCandidateCount} />
        </div>
      </section>

      {/* ERP Bling */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="bg-slate-900 p-2 rounded-lg">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">ERP Bling</h3>
            <p className="text-xs text-slate-500">Importe produtos e envie dados enriquecidos.</p>
          </div>
        </header>
        <div className="px-5 py-5">
          <BlingConnector onImported={onBlingImported} getPushPayload={getBlingPushPayload} getPushCandidates={getBlingPushCandidates} onPushed={onBlingPushed} />
        </div>
      </section>

      {/* ERP IdWorks */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="bg-slate-900 p-2 rounded-lg">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">ERP IdWorks</h3>
            <p className="text-xs text-slate-500">Importe produtos e envie dados enriquecidos.</p>
          </div>
        </header>
        <div className="px-5 py-5">
          <IdworksConnector onImported={onIdworksImported} getPushPayload={getIdworksPushPayload} getPushCandidates={getIdworksPushCandidates} onPushed={onIdworksPushed} />
        </div>
      </section>
    </div>
  );
};

export default IntegrationsView;
