import { Zap, Database, Building2, Plug } from 'lucide-react';
import type { Product } from './models';

export type IntegrationKey = 'wake' | 'tiny' | 'bling' | 'idworks';

export const INTEGRATION_META: Record<IntegrationKey, { label: string; Icon: typeof Zap; className: string }> = {
  wake: { label: 'Wake', Icon: Zap, className: 'bg-[var(--ag-blue-soft,#eff6ff)] text-[var(--ag-blue,#1d4ed8)] border-[var(--ag-blue-line,#bfdbfe)]' },
  tiny: { label: 'Tiny ERP', Icon: Database, className: 'bg-[var(--ag-ok-soft,#ecfdf5)] text-[var(--ag-ok,#047857)] border-[var(--ag-ok-line,#a7f3d0)]' },
  bling: { label: 'Bling', Icon: Building2, className: 'bg-[var(--ag-violet-soft,#f5f3ff)] text-[var(--ag-violet,#6d28d9)] border-[var(--ag-violet-line,#ddd6fe)]' },
  idworks: { label: 'IdWorks', Icon: Plug, className: 'bg-[color-mix(in_srgb,#db2777_12%,transparent)] text-[#db2777] border-[color-mix(in_srgb,#db2777_30%,transparent)]' },
};

export function getProductIntegrationLinks(p: Product): IntegrationKey[] {
  const out: IntegrationKey[] = [];
  if (p._wakeProductId) out.push('wake');
  if (p._tinyProductId) out.push('tiny');
  if (p._blingProductId && !p._blingDeleted) out.push('bling');
  if (p._idworksProductId && !p._idworksDeleted) out.push('idworks');
  return out;
}

// Mirrors server/pushLog.ts — what the ERP actually received, field by field.
export type PushLogEntry = {
  campo: string;
  valor?: string;
  itens?: string[];
  bytes?: number;
  truncado?: boolean;
};

export type SendPanelItem = {
  id: string;
  sku: string;
  nome: string;
  status: 'pending' | 'sending' | 'ok' | 'error';
  /** Error message, or the summary of groups that were not written. */
  log?: string;
  /** Fields actually written to the ERP, for the collapsed log. */
  enviado?: PushLogEntry[];
};
export type SendPanelState = { open: boolean; integration: IntegrationKey; items: SendPanelItem[]; sending: boolean };
