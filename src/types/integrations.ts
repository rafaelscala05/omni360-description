import { Zap, Database, Building2, Plug } from 'lucide-react';
import type { Product } from './models';

export type IntegrationKey = 'wake' | 'tiny' | 'bling' | 'idworks';

export const INTEGRATION_META: Record<IntegrationKey, { label: string; Icon: typeof Zap; className: string }> = {
  wake: { label: 'Wake', Icon: Zap, className: 'bg-blue-50 text-blue-700 border-blue-200/60' },
  tiny: { label: 'Tiny ERP', Icon: Database, className: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
  bling: { label: 'Bling', Icon: Building2, className: 'bg-violet-50 text-violet-700 border-violet-200/60' },
  idworks: { label: 'IdWorks', Icon: Plug, className: 'bg-pink-50 text-pink-700 border-pink-200/60' },
};

export function getProductIntegrationLinks(p: Product): IntegrationKey[] {
  const out: IntegrationKey[] = [];
  if (p._wakeProductId) out.push('wake');
  if (p._tinyProductId) out.push('tiny');
  if (p._blingProductId && !p._blingDeleted) out.push('bling');
  if (p._idworksProductId && !p._idworksDeleted) out.push('idworks');
  return out;
}

export type SendPanelItem = { id: string; sku: string; nome: string; status: 'pending' | 'sending' | 'ok' | 'error'; log?: string };
export type SendPanelState = { open: boolean; integration: IntegrationKey; items: SendPanelItem[]; sending: boolean };
