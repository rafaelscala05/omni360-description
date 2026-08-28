import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import type { ContentAgentAction, PreviewField } from '../../../types/contentAgent';
import { CredentialForm } from './CredentialForm';

interface Props {
  uid: string;
  action: ContentAgentAction;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
}

function formatar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const Linha: React.FC<{ campo: PreviewField }> = ({ campo }) => (
  <div className={`grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${campo.mudou ? '' : 'opacity-50'}`}>
    <div className="text-slate-500 truncate" title={campo.campo}>{campo.campo}</div>
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <span className={`truncate max-w-full ${campo.mudou ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-600'}`}>
        {formatar(campo.antes)}
      </span>
      {campo.mudou && (
        <>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <span className="font-medium text-slate-900 break-words">{formatar(campo.depois)}</span>
        </>
      )}
    </div>
  </div>
);

/**
 * content.credencial.conectar é a única ferramenta que pausa mas não mostra o
 * diff padrão — a senha/token nunca vira argumento de tool call (nunca passa
 * pelo modelo), então o formulário grava o segredo direto no Firestore e só
 * então resolve a ação (aprovando ou rejeitando o interrupt), igual ao fluxo
 * do antigo bridge via CopilotKit.
 */
const ContentActionCard: React.FC<Props> = ({ uid, action, onExecutar, onRejeitar }) => {
  const [busy, setBusy] = useState<'executar' | 'rejeitar' | null>(null);
  const pendente = action.status === 'pending';
  const semMudanca = action.preview.campos.length > 0 && action.preview.campos.every((c) => !c.mudou);

  const rodar = async (qual: 'executar' | 'rejeitar') => {
    setBusy(qual);
    try {
      await (qual === 'executar' ? onExecutar(action.id) : onRejeitar(action.id));
    } finally {
      setBusy(null);
    }
  };

  if (pendente && action.tool === 'content.credencial.conectar') {
    const args = action.args as { provider?: 'wordpress' | 'sanity'; projectId?: string };
    if (args.provider && args.projectId) {
      return (
        <CredentialForm
          uid={uid}
          provider={args.provider}
          projectId={args.projectId}
          onDone={(ok) => void (ok ? onExecutar(action.id) : onRejeitar(action.id))}
        />
      );
    }
  }

  const selo = {
    pending: { texto: 'Aguardando sua aprovação', classe: 'bg-amber-50 text-amber-700 border-amber-200' },
    executed: { texto: 'Executado', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    failed: { texto: 'Falhou', classe: 'bg-red-50 text-red-700 border-red-200' },
    rejected: { texto: 'Rejeitado', classe: 'bg-slate-100 text-slate-500 border-slate-200' },
  }[action.status];

  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-opacity ${pendente ? 'border-orange/40 shadow-sm' : 'border-slate-200'} ${action.status === 'rejected' ? 'opacity-60' : ''}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-slate-900 text-sm">{action.preview.resumo}</div>
          <div className="text-xs text-slate-500 mt-0.5 truncate" title={action.preview.alvo}>{action.preview.alvo}</div>
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-1 rounded-full border ${selo.classe}`}>
          {selo.texto}
        </span>
      </div>

      {action.preview.campos.length > 0 && (
        <div className="divide-y divide-slate-50">
          {action.preview.campos.map((c, i) => <Linha key={`${c.campo}-${i}`} campo={c} />)}
        </div>
      )}

      {action.preview.avisos.length > 0 && (
        <div className="px-4 py-3 bg-amber-50/60 border-t border-amber-100 space-y-1.5">
          {action.preview.avisos.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {action.error && (
        <div className="px-4 py-3 bg-red-50 border-t border-red-100 text-xs text-red-700">{action.error}</div>
      )}

      {pendente && (
        <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={() => rodar('executar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-orange text-white text-sm font-medium hover:bg-orange/90 disabled:opacity-50 transition-colors"
          >
            {busy === 'executar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Executar
          </button>
          <button
            onClick={() => rodar('rejeitar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-200/70 disabled:opacity-50 transition-colors"
          >
            {busy === 'rejeitar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Rejeitar
          </button>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            {semMudanca ? 'Nada muda' : 'Nada é alterado até você aprovar'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ContentActionCard;
