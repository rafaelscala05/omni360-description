import React from 'react';
import { MARCA } from '../../modules/agent/ConnectionsBar';
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

/**
 * Seção de uma plataforma, em vidro (tokens `--ag-*`). A tela é sempre clara —
 * os conectores aqui dentro ainda têm cores literais —, por isso a tela abre
 * o próprio escopo `.alfreds` claro: sem agente o shell não é `.alfreds` e os
 * tokens nem existiriam.
 */
const Secao: React.FC<{ chave: string; nome: string; papel: string; children: React.ReactNode }> = ({ chave, nome, papel, children }) => (
  <section className="ag-glass ag-sheen rounded-[24px] overflow-hidden">
    <header className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
      <span
        className="w-10 h-10 rounded-[12px] grid place-items-center text-[13px] font-bold text-white shrink-0"
        style={{ background: MARCA[chave]?.cor }}
      >
        {MARCA[chave]?.glifo}
      </span>
      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold text-[var(--ag-text)]">{nome}</h3>
        <p className="text-[13px] text-[var(--ag-text-2)]">{papel} · importe produtos e envie dados enriquecidos.</p>
      </div>
    </header>
    <div className="px-5 py-5">{children}</div>
  </section>
);

const IntegrationsView: React.FC<Props> = ({ onImport, getPushPayload, onTinyImported, getTinyPushPayload, tinyPushCandidateCount, onBlingImported, getBlingPushPayload, getBlingPushCandidates, onBlingPushed, onIdworksImported, getIdworksPushPayload, getIdworksPushCandidates, onIdworksPushed }) => {
  return (
    <div className="alfreds max-w-3xl mx-auto px-1 md:px-2 py-2 flex flex-col gap-4" data-tema="claro">
      <div>
        <h2 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Integrações</h2>
        <p className="mt-1 text-[14px] text-[var(--ag-text-2)]">Conecte sua loja e seus sistemas para importar e enviar produtos.</p>
      </div>

      <Secao chave="wake" nome="Wake Commerce" papel="Loja">
        <WakeConnector onImport={onImport} getPushPayload={getPushPayload} />
      </Secao>

      <Secao chave="tiny" nome="Tiny ERP" papel="ERP">
        <TinyConnector onImported={onTinyImported} getPushPayload={getTinyPushPayload} pushCandidateCount={tinyPushCandidateCount} />
      </Secao>

      <Secao chave="bling" nome="Bling" papel="ERP">
        <BlingConnector onImported={onBlingImported} getPushPayload={getBlingPushPayload} getPushCandidates={getBlingPushCandidates} onPushed={onBlingPushed} />
      </Secao>

      <Secao chave="idworks" nome="IdWorks" papel="ERP">
        <IdworksConnector onImported={onIdworksImported} getPushPayload={getIdworksPushPayload} getPushCandidates={getIdworksPushCandidates} onPushed={onIdworksPushed} />
      </Secao>
    </div>
  );
};

export default IntegrationsView;
