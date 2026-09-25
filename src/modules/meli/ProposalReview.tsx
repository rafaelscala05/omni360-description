import React, { useEffect, useState } from 'react';
import { Check, GitCompareArrows, Loader2, Pencil, RotateCcw, Save, Send, ShieldAlert, X } from 'lucide-react';
import type { MeliApprovalStatus, MeliMutationRun, MeliProposalChange, MeliProposalResult } from '../../services/meliService';

const RISK_LABEL = { low: 'Baixo', medium: 'Médio', high: 'Alto', blocked: 'Bloqueado' } as const;
const STATUS_LABEL = {
  draft: 'Rascunho', awaiting_review: 'Aguardando revisão', partially_approved: 'Revisão parcial',
  approved: 'Aprovada', rejected: 'Rejeitada', applying: 'Publicando', applied: 'Aplicada',
  partially_applied: 'Aplicação parcial', failed: 'Falhou', stale: 'Desatualizada',
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

function editorValue(change: MeliProposalChange): string {
  if (typeof change.newValue === 'string') return change.newValue;
  const value = change.newValue as Record<string, unknown> | null;
  if (change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.')) return String(value?.valueName || '');
  return '';
}

function ChangeCard({ change, busy, locked, onDecide, onEdit }: {
  change: MeliProposalChange;
  busy: boolean;
  locked: boolean;
  onDecide: (change: MeliProposalChange, status: Exclude<MeliApprovalStatus, 'pending'>) => void;
  onEdit: (change: MeliProposalChange, value: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editorValue(change));
  const pictureValue = change.newValue && typeof change.newValue === 'object' ? change.newValue as Record<string, unknown> : {};
  const [pictureAction, setPictureAction] = useState(String(pictureValue.action || 'reorder'));
  const [pictureSource, setPictureSource] = useState(String(pictureValue.source || ''));
  const [targetOrder, setTargetOrder] = useState(String(pictureValue.targetOrder || ''));
  const canEdit = !locked && pictureValue.action !== 'restore';
  const pictureIncomplete = change.fieldPath.startsWith('pictures.') && (
    (['create', 'replace'].includes(String(pictureValue.action || '')) && !String(pictureValue.source || '').startsWith('https://'))
    || (pictureValue.action === 'reorder' && (!Number.isInteger(Number(pictureValue.targetOrder)) || Number(pictureValue.targetOrder) < 1))
  );
  useEffect(() => {
    setDraft(editorValue(change));
    const value = change.newValue && typeof change.newValue === 'object' ? change.newValue as Record<string, unknown> : {};
    setPictureAction(String(value.action || 'reorder'));
    setPictureSource(String(value.source || ''));
    setTargetOrder(String(value.targetOrder || ''));
  }, [change.newValue]);
  const save = async () => {
    let value: unknown = draft;
    if (change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.')) {
      value = { ...(change.newValue as Record<string, unknown>), valueName: draft, valueId: null };
    } else if (change.fieldPath.startsWith('pictures.')) {
      value = {
        ...pictureValue, action: pictureAction,
        ...((pictureAction === 'create' || pictureAction === 'replace') ? { source: pictureSource } : {}),
        ...(pictureAction === 'reorder' ? { targetOrder: Number(targetOrder) } : {}),
      };
    }
    await onEdit(change, value);
    setEditing(false);
  };
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
      <div className="p-3 bg-blue-50/30"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase text-blue-500">Proposto</p>{canEdit && <button onClick={() => setEditing((value) => !value)} className="text-[10px] font-bold text-blue-700 inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Editar</button>}</div>
        {!editing ? <p className="text-xs text-slate-800 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">{displayValue(change.newValue)}</p>
          : change.fieldPath.startsWith('pictures.') ? <div className="mt-2 space-y-2"><select value={pictureAction} onChange={(event) => setPictureAction(event.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"><option value="reorder">Reordenar</option><option value="remove">Remover</option><option value="replace">Substituir</option><option value="create">Criar</option></select>{(pictureAction === 'create' || pictureAction === 'replace') && <input value={pictureSource} onChange={(event) => setPictureSource(event.target.value)} placeholder="URL HTTPS da nova imagem" className="w-full border rounded-lg px-2 py-1.5 text-xs" />}{pictureAction === 'reorder' && <input type="number" min="1" value={targetOrder} onChange={(event) => setTargetOrder(event.target.value)} placeholder="Nova posição (começa em 1)" className="w-full border rounded-lg px-2 py-1.5 text-xs" />}</div>
            : change.fieldPath === 'description.plain_text' ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} className="w-full border rounded-lg px-2 py-1.5 text-xs mt-2 resize-y" />
              : <input value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-xs mt-2" />}
        {editing && <div className="flex justify-end gap-2 mt-2"><button onClick={() => setEditing(false)} className="text-[11px] text-slate-500">Cancelar</button><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-blue-600 rounded-md px-2 py-1 disabled:opacity-50"><Save className="w-3 h-3" /> Salvar</button></div>}
      </div>
    </div>
    {change.evidence.length > 0 && <p className="px-3 pt-3 text-[11px] text-slate-500">Evidência: {change.evidence.join(' · ')}</p>}
    <div className="p-3 flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-400">Confiança {Math.round(change.confidence * 100)}%{change.requiresConfirmation ? ' · confirmação explícita' : ''}</span>
      <div className="flex gap-2">
        <button disabled={busy || locked} onClick={() => onDecide(change, 'rejected')} className={`inline-flex items-center gap-1 text-xs font-bold border px-3 py-1.5 rounded-lg disabled:opacity-50 ${change.approvalStatus === 'rejected' ? 'bg-red-600 text-white border-red-600' : 'text-red-700 border-red-200 hover:bg-red-50'}`}><X className="w-3.5 h-3.5" /> Rejeitar</button>
        <button disabled={busy || locked || change.riskLevel === 'blocked' || pictureIncomplete} title={pictureIncomplete ? 'Edite a sugestão para informar URL ou posição antes de aprovar.' : undefined} onClick={() => onDecide(change, 'approved')} className={`inline-flex items-center gap-1 text-xs font-bold border px-3 py-1.5 rounded-lg disabled:opacity-50 ${change.approvalStatus === 'approved' ? 'bg-emerald-600 text-white border-emerald-600' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'}`}><Check className="w-3.5 h-3.5" /> Aprovar</button>
      </div>
    </div>
  </div>;
}

export default function ProposalReview({ result, busy, writeEnabled, mutationRun, onDecide, onEdit, onApproveLowRisk, onApply, onRollback }: {
  result: MeliProposalResult;
  busy: boolean;
  writeEnabled: boolean;
  mutationRun: MeliMutationRun | null;
  onDecide: (change: MeliProposalChange, status: Exclude<MeliApprovalStatus, 'pending'>) => void;
  onEdit: (change: MeliProposalChange, value: unknown) => Promise<void>;
  onApproveLowRisk: () => void;
  onApply: () => void;
  onRollback: () => void;
}) {
  const { proposal, changes } = result;
  const lowRiskPending = changes.filter((change) => change.riskLevel === 'low' && change.approvalStatus === 'pending').length;
  const pending = changes.filter((change) => change.approvalStatus === 'pending').length;
  const locked = ['stale', 'applying', 'applied', 'partially_applied'].includes(proposal.status);
  const canApply = writeEnabled && !locked && pending === 0 && proposal.approvedCount > 0;
  const mutationActive = mutationRun && ['queued', 'running', 'verifying'].includes(mutationRun.status);
  return <section className="space-y-3 border-t border-slate-200 pt-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2"><GitCompareArrows className="w-5 h-5 text-blue-600 mt-0.5" /><div><h3 className="text-sm font-black text-slate-900">Proposta v{proposal.version}</h3><p className="text-xs text-slate-500">{proposal.summary}</p></div></div><span className="text-[10px] font-bold uppercase rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{STATUS_LABEL[proposal.status]}</span></div>
    {proposal.impactScope.warnings.length > 0 && <div className="border border-amber-200 bg-amber-50 rounded-xl p-3"><div className="flex gap-2"><ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" /><div>{proposal.impactScope.warnings.map((warning) => <p key={warning} className="text-xs text-amber-800">{warning}</p>)}{proposal.impactScope.relatedItemIds.length > 0 && <p className="text-[11px] text-amber-700 mt-1">Anúncios relacionados: {proposal.impactScope.relatedItemIds.join(', ')}</p>}</div></div></div>}
    <div className="flex items-center justify-between"><p className="text-xs text-slate-500">{proposal.approvedCount} aprovadas · {proposal.rejectedCount} rejeitadas · {changes.length - proposal.approvedCount - proposal.rejectedCount} pendentes</p>{lowRiskPending > 0 && <button disabled={busy || locked} onClick={onApproveLowRisk} className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Aprovar {lowRiskPending} de baixo risco</button>}</div>
    {proposal.status === 'stale' && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">O anúncio mudou depois do snapshot-base. Esta proposta não pode mais ser aprovada.</div>}
    <div className="space-y-3">{changes.map((change) => <ChangeCard key={change.id} change={change} busy={busy} locked={locked} onDecide={onDecide} onEdit={onEdit} />)}</div>
    {!writeEnabled && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800"><strong>Publicação indisponível:</strong> reconecte a conta depois de habilitar “Leitura e escrita” no aplicativo do Mercado Livre.</div>}
    {mutationRun && <div className={`border rounded-xl p-3 text-xs ${mutationRun.status === 'succeeded' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : mutationRun.status === 'failed' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}><p className="font-bold">Publicação: {mutationRun.status === 'queued' ? 'na fila' : mutationRun.status === 'running' ? 'aplicando' : mutationRun.status === 'verifying' ? 'verificando no Mercado Livre' : mutationRun.status === 'succeeded' ? 'aplicada e verificada' : mutationRun.status === 'partial' ? 'aplicação parcial' : 'falhou'}</p>{mutationRun.error && <p className="mt-1">{mutationRun.error}</p>}{mutationRun.differences.map((difference) => <p key={difference} className="mt-1">• {difference}</p>)}{mutationRun.warnings.map((warning) => <p key={warning} className="mt-1">• {warning}</p>)}</div>}
    <div className="flex justify-end gap-2 border-t pt-3">{['applied', 'partially_applied'].includes(proposal.status) && <button disabled={busy || Boolean(mutationActive)} onClick={onRollback} className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 border border-amber-300 rounded-lg px-3 py-2 hover:bg-amber-50 disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5" /> Criar proposta de reversão</button>}<button disabled={busy || Boolean(mutationActive) || !canApply} onClick={onApply} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg px-4 py-2 disabled:opacity-40">{mutationActive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Aplicar alterações aprovadas</button></div>
  </section>;
}
