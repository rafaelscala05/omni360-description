import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Pencil, RotateCcw, Save, Send, ShieldAlert, X } from 'lucide-react';
import type { MeliMutationRun, MeliProposalChange, MeliProposalResult } from '../../services/meliService';

const STATUS_LABEL = {
  draft: 'Rascunho', awaiting_review: 'Pronta para revisar', partially_approved: 'Pronta para revisar',
  approved: 'Pronta para revisar', rejected: 'Nada selecionado', applying: 'Publicando', applied: 'Publicada',
  partially_applied: 'Publicada em parte', failed: 'Falhou', stale: 'Desatualizada',
} as const;
const LOCKED = new Set(['stale', 'applying', 'applied', 'partially_applied']);

type PictureRef = { id?: string; url?: string; secure_url?: string };

export function isSensitive(change: MeliProposalChange): boolean {
  return change.requiresConfirmation || change.riskLevel === 'high';
}

// Seleção inicial: tudo o que é seguro já vem marcado; o que é sensível
// (GTIN, título, remover/trocar foto) vem desmarcado e marcar é confirmar.
export function defaultSelected(change: MeliProposalChange): boolean {
  if (change.riskLevel === 'blocked') return false;
  if (change.approvalStatus !== 'pending') return change.approvalStatus === 'approved';
  return !change.requiresConfirmation;
}

function valueText(value: unknown): string {
  if (value == null || value === '') return 'Não preenchido';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const object = value as Record<string, unknown>;
  if (object.valueName) return String(object.valueName);
  return JSON.stringify(value);
}

function editorValue(change: MeliProposalChange): string {
  if (typeof change.newValue === 'string') return change.newValue;
  const value = change.newValue as Record<string, unknown> | null;
  if (change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.')) return String(value?.valueName || '');
  return '';
}

function pictureUrl(pictures: PictureRef[], id: unknown): string | null {
  const picture = pictures.find((entry) => String(entry.id) === String(id));
  return picture ? picture.secure_url || picture.url || null : null;
}

function PictureChange({ change, pictures }: { change: MeliProposalChange; pictures: PictureRef[] }) {
  const value = (change.newValue || {}) as Record<string, any>;
  const action = String(value.action || '');
  const current = pictureUrl(pictures, value.pictureId);
  const thumb = (url: string | null, label: string) => <div className="w-24 shrink-0"><div className="aspect-square rounded-lg bg-slate-100 border overflow-hidden">{url && <img src={url} alt="" className="w-full h-full object-contain" />}</div><p className="text-[10px] text-slate-500 mt-1 text-center">{label}</p></div>;
  if (action === 'create') return <div className="flex items-center gap-3">{thumb(value.source || null, value.targetOrder ? `Entra na posição ${value.targetOrder}` : 'Entra no fim')}<p className="text-xs text-slate-600">Foto nova gerada pela IA.</p></div>;
  if (action === 'reorder') return <div className="flex items-center gap-3">{thumb(current, 'Foto atual')}<ArrowRight className="w-4 h-4 text-slate-400" /><p className="text-xs text-slate-700">Mover para a posição <strong>{value.targetOrder}</strong>{Number(value.targetOrder) === 1 ? ' (capa da busca)' : ''}.</p></div>;
  if (action === 'remove') return <div className="flex items-center gap-3">{thumb(current, 'Será removida')}<p className="text-xs text-slate-700">Remover esta foto do anúncio.</p></div>;
  if (action === 'restore') return <p className="text-xs text-slate-700">Restaurar o conjunto de fotos anterior à publicação.</p>;
  return <p className="text-xs text-slate-700">{valueText(change.newValue)}</p>;
}

function ChangeCard({ change, pictures, selected, locked, busy, onToggle, onEdit }: {
  change: MeliProposalChange;
  pictures: PictureRef[];
  selected: boolean;
  locked: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: (change: MeliProposalChange, value: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editorValue(change));
  useEffect(() => { setDraft(editorValue(change)); }, [change.newValue]);
  const isPicture = change.fieldPath.startsWith('pictures.');
  const isDescription = change.fieldPath === 'description.plain_text';
  const isTitle = change.fieldPath === 'title';
  const blocked = change.riskLevel === 'blocked';
  const sensitive = isSensitive(change);
  const canEdit = !locked && !isPicture && !blocked;
  const save = async () => {
    const value = change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.')
      ? { ...(change.newValue as Record<string, unknown>), valueName: draft, valueId: null }
      : draft;
    await onEdit(change, value);
    setEditing(false);
  };
  const border = blocked ? 'border-slate-200 opacity-60' : selected ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200';
  return <div className={`border rounded-xl bg-white overflow-hidden ${border}`}>
    <label className={`flex items-start gap-3 p-3 ${locked || blocked ? '' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={selected} disabled={locked || blocked || busy} onChange={onToggle} className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-slate-900">{change.label || change.fieldPath}</p>
          {change.changeType === 'add' && !isPicture && <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">novo</span>}
          {change.evidence.some((entry) => entry.startsWith('Informado pelo vendedor')) && <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5">sua resposta</span>}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{change.reason}</p>
        {sensitive && !blocked && !locked && <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Dado sensível: confira antes de marcar. Marcar confirma que está correto.</p>}
        {blocked && <p className="text-[11px] text-slate-500 mt-1">Este campo não pode ser alterado por aqui.</p>}
      </div>
    </label>
    <div className="px-3 pb-3">
      {isPicture ? <PictureChange change={change} pictures={pictures} />
        : editing ? <div className="space-y-2">
          {isDescription ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={12} className="w-full border rounded-lg px-3 py-2 text-sm resize-y" />
            : <input value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />}
          {isTitle && <p className="text-[11px] text-slate-400">{draft.length} caracteres</p>}
          <div className="flex justify-end gap-2"><button onClick={() => setEditing(false)} className="text-xs text-slate-500 px-2">Cancelar</button><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 text-xs font-bold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Salvar</button></div>
        </div>
          : <div className={isDescription ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
            {!isDescription && <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5"><p className="text-[10px] font-bold uppercase text-slate-400">Hoje</p><p className="text-sm text-slate-500 mt-0.5 line-through decoration-slate-300 break-words">{valueText(change.oldValue)}</p></div>}
            <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-2.5">
              <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase text-emerald-700">{isDescription ? 'Nova descrição' : 'Fica assim'}</p>{canEdit && <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-blue-700 inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Editar</button>}</div>
              <p className={`text-sm text-slate-800 mt-0.5 whitespace-pre-wrap break-words ${isDescription ? 'max-h-72 overflow-y-auto' : ''}`}>{valueText(change.newValue)}</p>
              {isTitle && typeof change.newValue === 'string' && <p className="text-[10px] text-slate-400 mt-1">{change.newValue.length} caracteres</p>}
            </div>
            {isDescription && change.oldValue != null && <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Ver descrição atual</summary><p className="whitespace-pre-wrap mt-2 max-h-56 overflow-y-auto bg-slate-50 border rounded-lg p-2.5">{valueText(change.oldValue)}</p></details>}
          </div>}
    </div>
  </div>;
}

function MutationStatus({ run }: { run: MeliMutationRun }) {
  const tone = run.status === 'succeeded' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : run.status === 'failed' ? 'bg-red-50 border-red-200 text-red-800' : run.status === 'partial' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800';
  const label = { queued: 'Na fila para publicar…', running: 'Publicando no Mercado Livre…', verifying: 'Conferindo o anúncio no Mercado Livre…', succeeded: 'Publicado e conferido no Mercado Livre.', partial: 'Parte das melhorias foi publicada.', failed: 'A publicação falhou.', rolled_back: 'Revertido.' }[run.status];
  const active = ['queued', 'running', 'verifying'].includes(run.status);
  return <div className={`border rounded-xl p-3 text-sm ${tone}`}>
    <p className="font-bold flex items-center gap-2">{active ? <Loader2 className="w-4 h-4 animate-spin" /> : run.status === 'succeeded' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{label}</p>
    {run.error && <p className="mt-1 text-xs">{run.error}</p>}
    {[...run.differences, ...run.warnings].map((line) => <p key={line} className="mt-1 text-xs">• {line}</p>)}
  </div>;
}

export default function ProposalReview({ result, pictures, busy, writeEnabled, mutationRun, onEdit, onPublish, onRollback }: {
  result: MeliProposalResult;
  pictures: PictureRef[];
  busy: boolean;
  writeEnabled: boolean;
  mutationRun: MeliMutationRun | null;
  onEdit: (change: MeliProposalChange, value: unknown) => Promise<void>;
  onPublish: (changeIds: string[]) => Promise<void>;
  onRollback: () => void;
}) {
  const { proposal, changes } = result;
  const locked = LOCKED.has(proposal.status);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changes.filter(defaultSelected).map((change) => change.id)));
  const [seen, setSeen] = useState<Set<string>>(() => new Set(changes.map((change) => change.id)));
  const [confirming, setConfirming] = useState(false);
  // Mudança nova (ex.: foto gerada agora) entra com a seleção padrão; as já
  // vistas mantêm a escolha do vendedor.
  useEffect(() => {
    const fresh = changes.filter((change) => !seen.has(change.id));
    if (!fresh.length) return;
    setSeen((current) => new Set([...current, ...fresh.map((change) => change.id)]));
    setSelected((current) => new Set([...current, ...fresh.filter(defaultSelected).map((change) => change.id)]));
  }, [changes]);
  useEffect(() => {
    setSelected(new Set(changes.filter(defaultSelected).map((change) => change.id)));
    setSeen(new Set(changes.map((change) => change.id)));
    setConfirming(false);
  }, [proposal.id]);
  const toggle = (id: string) => { setConfirming(false); setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const edit = async (change: MeliProposalChange, value: unknown) => { await onEdit(change, value); setSelected((current) => new Set([...current, change.id])); };
  const selectable = changes.filter((change) => change.riskLevel !== 'blocked');
  const chosen = changes.filter((change) => selected.has(change.id) && change.riskLevel !== 'blocked');
  const mutationActive = Boolean(mutationRun && ['queued', 'running', 'verifying'].includes(mutationRun.status));
  const canPublish = writeEnabled && !locked && chosen.length > 0 && !busy && !mutationActive;
  const groups: Array<{ title: string; items: MeliProposalChange[] }> = [
    { title: 'Texto', items: changes.filter((change) => change.fieldPath === 'title' || change.fieldPath.startsWith('description')) },
    { title: 'Ficha técnica', items: changes.filter((change) => change.fieldPath.startsWith('attributes.') || change.fieldPath.startsWith('sale_terms.')) },
    { title: 'Fotos', items: changes.filter((change) => change.fieldPath.startsWith('pictures.')) },
  ].filter((group) => group.items.length);

  return <section className="space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-base font-black text-slate-900">Melhorias prontas</h3><p className="text-xs text-slate-500 mt-0.5">Marque o que quer publicar. O que ficar desmarcado não é enviado.</p></div>
      <span className="text-[10px] font-bold uppercase rounded-full border border-slate-200 bg-slate-50 px-2 py-1 shrink-0">{STATUS_LABEL[proposal.status]}</span>
    </div>
    {proposal.impactScope.warnings.length > 0 && <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 flex gap-2"><ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" /><div>{proposal.impactScope.warnings.map((warning) => <p key={warning} className="text-xs text-amber-800">{warning}</p>)}{proposal.impactScope.relatedItemIds.length > 0 && <p className="text-[11px] text-amber-700 mt-1">Anúncios afetados: {proposal.impactScope.relatedItemIds.join(', ')}</p>}</div></div>}
    {proposal.status === 'stale' && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">O anúncio mudou depois destas sugestões. Otimize de novo para gerar melhorias atualizadas.</div>}
    {!locked && selectable.length > 1 && <div className="flex gap-3 text-xs"><button onClick={() => setSelected(new Set(selectable.map((change) => change.id)))} className="font-semibold text-blue-700">Marcar todas</button><button onClick={() => setSelected(new Set())} className="font-semibold text-slate-500">Desmarcar todas</button></div>}
    {groups.map((group) => <div key={group.title} className="space-y-2"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{group.title}</p>{group.items.map((change) => <ChangeCard key={change.id} change={change} pictures={pictures} selected={selected.has(change.id)} locked={locked} busy={busy} onToggle={() => toggle(change.id)} onEdit={edit} />)}</div>)}
    {mutationRun && <MutationStatus run={mutationRun} />}
    {!writeEnabled && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800"><strong>Publicação indisponível:</strong> reconecte a conta depois de habilitar “Leitura e escrita” no aplicativo do Mercado Livre.</div>}
    <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-white/95 backdrop-blur border-t flex items-center justify-between gap-3">
      <div>{['applied', 'partially_applied'].includes(proposal.status) && <button disabled={busy || mutationActive} onClick={onRollback} className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 border border-amber-300 rounded-lg px-3 py-2 hover:bg-amber-50 disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5" /> Desfazer publicação</button>}</div>
      {!locked && (confirming
        ? <div className="flex items-center gap-2"><button onClick={() => setConfirming(false)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 px-2"><X className="w-3.5 h-3.5" /> Cancelar</button><button disabled={!canPublish} onClick={() => { setConfirming(false); void onPublish(chosen.map((change) => change.id)); }} className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 bg-[#FFE600] hover:bg-[#f1d900] rounded-xl px-4 py-2.5 disabled:opacity-40"><Send className="w-4 h-4" /> Confirmar: publicar no Mercado Livre</button></div>
        : <button disabled={!canPublish} onClick={() => setConfirming(true)} className="inline-flex items-center gap-2 text-sm font-bold text-white bg-slate-900 rounded-xl px-4 py-2.5 disabled:opacity-40">{busy || mutationActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Publicar {chosen.length} melhoria{chosen.length === 1 ? '' : 's'}</button>)}
    </div>
  </section>;
}
