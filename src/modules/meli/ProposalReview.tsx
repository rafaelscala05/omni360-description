import React from 'react';
import { Check, GitCompareArrows, Loader2, ShieldAlert, X } from 'lucide-react';
import type { MeliApprovalStatus, MeliProposalChange, MeliProposalResult } from '../../services/meliService';

const RISK_LABEL = { low: 'Baixo', medium: 'Médio', high: 'Alto', blocked: 'Bloqueado' } as const;
const STATUS_LABEL = {
  draft: 'Rascunho', awaiting_review: 'Aguardando revisão', partially_approved: 'Revisão parcial',
  approved: 'Aprovada', rejected: 'Rejeitada', stale: 'Desatualizada',
} as const;

function displayValue(value: unknown): string {
  if (value == null || value === '') return 'Não preenchido';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const object = value as Record<string, unknown>;
  if (object.valueName) return String(object.valueName);
  if (object.action) return `${String(object.action)}${object.pictureId ? ` · ${String(object.pictureId)}` : ''}`;
  return JSON.stringify(value, null, 2);
}

function ChangeCard({ change, busy, onDecide }: {
  change: MeliProposalChange;
  busy: boolean;
  onDecide: (change: MeliProposalChange, status: Exclude<MeliApprovalStatus, 'pending'>) => void;
}) {
  const riskStyle = change.riskLevel === 'blocked' || change.riskLevel === 'high' ? 'text-red-700 bg-red-50 border-red-200'
    : change.riskLevel === 'medium' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200';
  const decisionStyle = change.approvalStatus === 'approved' ? 'border-emerald-300 ring-1 ring-emerald-200'
    : change.approvalStatus === 'rejected' ? 'border-red-200 opacity-75' : 'border-slate-200';
  return <div className={`border rounded-xl overflow-hidden ${decisionStyle}`}>
    <div className="p-3 flex items-start justify-between gap-3 bg-slate-50/70">
      <div><p className="text-xs font-mono text-slate-500">{change.fieldPath}</p><p className="text-sm font-semibold text-slate-800 mt-0.5">{change.reason}</p></div>
      <span className={`text-[10px] font-bold uppercase border rounded-full px-2 py-1 ${riskStyle}`}>{RISK_LABEL[change.riskLevel]}</span>
    </div>
    <div className="grid grid-cols-2 divide-x border-y border-slate-100">
      <div className="p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Atual</p><p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">{displayValue(change.oldValue)}</p></div>
      <div className="p-3 bg-blue-50/30"><p className="text-[10px] font-bold uppercase text-blue-500">Proposto</p><p className="text-xs text-slate-800 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">{displayValue(change.newValue)}</p></div>
    </div>
    {change.evidence.length > 0 && <p className="px-3 pt-3 text-[11px] text-slate-500">Evidência: {change.evidence.join(' · ')}</p>}
    <div className="p-3 flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-400">Confiança {Math.round(change.confidence * 100)}%{change.requiresConfirmation ? ' · confirmação explícita' : ''}</span>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onDecide(change, 'rejected')} className={`inline-flex items-center gap-1 text-xs font-bold border px-3 py-1.5 rounded-lg disabled:opacity-50 ${change.approvalStatus === 'rejected' ? 'bg-red-600 text-white border-red-600' : 'text-red-700 border-red-200 hover:bg-red-50'}`}><X className="w-3.5 h-3.5" /> Rejeitar</button>
        <button disabled={busy || change.riskLevel === 'blocked'} onClick={() => onDecide(change, 'approved')} className={`inline-flex items-center gap-1 text-xs font-bold border px-3 py-1.5 rounded-lg disabled:opacity-50 ${change.approvalStatus === 'approved' ? 'bg-emerald-600 text-white border-emerald-600' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'}`}><Check className="w-3.5 h-3.5" /> Aprovar</button>
      </div>
    </div>
  </div>;
}

export default function ProposalReview({ result, busy, onDecide, onApproveLowRisk }: {
  result: MeliProposalResult;
  busy: boolean;
  onDecide: (change: MeliProposalChange, status: Exclude<MeliApprovalStatus, 'pending'>) => void;
  onApproveLowRisk: () => void;
}) {
  const { proposal, changes } = result;
  const lowRiskPending = changes.filter((change) => change.riskLevel === 'low' && change.approvalStatus === 'pending').length;
  return <section className="space-y-3 border-t border-slate-200 pt-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2"><GitCompareArrows className="w-5 h-5 text-blue-600 mt-0.5" /><div><h3 className="text-sm font-black text-slate-900">Proposta v{proposal.version}</h3><p className="text-xs text-slate-500">{proposal.summary}</p></div></div><span className="text-[10px] font-bold uppercase rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{STATUS_LABEL[proposal.status]}</span></div>
    {proposal.impactScope.warnings.length > 0 && <div className="border border-amber-200 bg-amber-50 rounded-xl p-3"><div className="flex gap-2"><ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" /><div>{proposal.impactScope.warnings.map((warning) => <p key={warning} className="text-xs text-amber-800">{warning}</p>)}{proposal.impactScope.relatedItemIds.length > 0 && <p className="text-[11px] text-amber-700 mt-1">Anúncios relacionados: {proposal.impactScope.relatedItemIds.join(', ')}</p>}</div></div></div>}
    <div className="flex items-center justify-between"><p className="text-xs text-slate-500">{proposal.approvedCount} aprovadas · {proposal.rejectedCount} rejeitadas · {changes.length - proposal.approvedCount - proposal.rejectedCount} pendentes</p>{lowRiskPending > 0 && <button disabled={busy} onClick={onApproveLowRisk} className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Aprovar {lowRiskPending} de baixo risco</button>}</div>
    {proposal.status === 'stale' && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">O anúncio mudou depois do snapshot-base. Esta proposta não pode mais ser aprovada.</div>}
    <div className="space-y-3">{changes.map((change) => <ChangeCard key={change.id} change={change} busy={busy || proposal.status === 'stale'} onDecide={onDecide} />)}</div>
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600"><strong>Publicação ainda desativada:</strong> as decisões ficam registradas, mas somente a Fase D poderá montar e aplicar o payload aprovado.</div>
  </section>;
}
