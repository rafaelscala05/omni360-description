import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import type { AgentAction, PreviewField } from '../../../types/agent';
import { CredentialForm } from './CredentialForm';

interface Props {
  uid: string;
  action: AgentAction;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
}

function formatar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * A divisória vai no style de cada linha, e não num `divide-y` no pai: o
 * utilitário só define a espessura da borda, a cor cai no `currentColor` do
 * texto e vira um traço preto sobre o vidro.
 */
const Linha: React.FC<{ campo: PreviewField; primeira: boolean }> = ({ campo, primeira }) => (
  <div
    className={`grid grid-cols-[minmax(0,5.5rem)_1fr] sm:grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${campo.mudou ? '' : 'opacity-45'}`}
    style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}
  >
    <div className="text-[var(--ag-text-3)] truncate" title={campo.campo}>{campo.campo}</div>
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <span
        className={`truncate max-w-full ${campo.mudou ? 'line-through' : ''}`}
        style={{
          color: campo.mudou ? 'var(--ag-text-3)' : 'var(--ag-text-2)',
          textDecorationColor: 'var(--ag-hairline-2)',
        }}
      >
        {formatar(campo.antes)}
      </span>
      {campo.mudou && (
        <>
          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[var(--ag-text-3)]" />
          <span className="font-medium text-[var(--ag-text)] break-words">{formatar(campo.depois)}</span>
        </>
      )}
    </div>
  </div>
);

/**
 * content.credencial.conectar é a única ferramenta que pausa mas não mostra o
 * diff padrão — a senha/token nunca vira argumento de tool call (nunca passa
 * pelo modelo), então o formulário grava o segredo direto no Firestore e só
 * então resolve a ação (aprovando ou rejeitando o interrupt).
 */
const ActionCard: React.FC<Props> = ({ uid, action, onExecutar, onRejeitar }) => {
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
    pending: { texto: 'Aguardando aprovação', fundo: 'var(--ag-warn-soft)', cor: 'var(--ag-warn)' },
    executed: {
      texto: action.dryRun ? 'Simulado (dry-run)' : 'Executado',
      fundo: 'var(--ag-ok-soft)',
      cor: 'var(--ag-ok)',
    },
    failed: { texto: 'Falhou', fundo: 'var(--ag-danger-soft)', cor: 'var(--ag-danger)' },
    rejected: { texto: 'Rejeitado', fundo: 'var(--ag-fill)', cor: 'var(--ag-text-3)' },
  }[action.status];

  return (
    <div
      className="ag-glass rounded-[20px] overflow-hidden transition-all duration-200"
      style={{
        borderColor: pendente ? 'var(--ag-accent)' : 'var(--ag-hairline)',
        boxShadow: pendente
          ? '0 0 0 4px var(--ag-accent-soft), var(--ag-shadow)'
          : 'var(--ag-shadow-sm)',
        opacity: action.status === 'rejected' ? 0.6 : 1,
      }}
    >
      <div
        className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3"
        style={{ borderBottom: '1px solid var(--ag-hairline)' }}
      >
        <div className="min-w-0 order-2 sm:order-1">
          <div className="font-semibold text-[var(--ag-text)] text-[14px] leading-snug">{action.preview.resumo}</div>
          <div className="text-[12px] text-[var(--ag-text-3)] mt-0.5 truncate" title={action.preview.alvo}>
            {action.preview.alvo}
          </div>
        </div>
        <span
          className="shrink-0 self-start order-1 sm:order-2 text-[11px] font-semibold px-2.5 py-1 rounded-full"
          style={{ background: selo.fundo, color: selo.cor }}
        >
          {selo.texto}
        </span>
      </div>

      {action.preview.campos.length > 0 && (
        <div>
          {action.preview.campos.map((c, i) => (
            <Linha key={`${c.campo}-${i}`} campo={c} primeira={i === 0} />
          ))}
        </div>
      )}

      {action.preview.avisos.length > 0 && (
        <div
          className="px-4 py-3 space-y-1.5"
          style={{ background: 'var(--ag-warn-soft)', borderTop: '1px solid var(--ag-hairline)' }}
        >
          {action.preview.avisos.map((a, i) => (
            <div key={i} className="flex gap-2 text-[12px]" style={{ color: 'var(--ag-warn)' }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {action.error && (
        <div
          className="px-4 py-3 text-[12px]"
          style={{
            background: 'var(--ag-danger-soft)',
            borderTop: '1px solid var(--ag-hairline)',
            color: 'var(--ag-danger)',
          }}
        >
          {action.error}
        </div>
      )}

      {pendente && (
        <div
          className="px-4 py-3 flex items-center gap-2 flex-wrap"
          style={{ background: 'var(--ag-fill)', borderTop: '1px solid var(--ag-hairline)' }}
        >
          <button
            onClick={() => rodar('executar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-50"
            style={{
              background: 'var(--ag-accent)',
              color: 'var(--ag-accent-ink)',
              boxShadow: '0 8px 20px -10px var(--ag-accent)',
            }}
          >
            {busy === 'executar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Executar
          </button>
          <button
            onClick={() => rodar('rejeitar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-50"
            style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' }}
          >
            {busy === 'rejeitar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Rejeitar
          </button>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--ag-text-3)]">
            <ShieldCheck className="w-3.5 h-3.5" />
            {semMudanca ? 'Nada muda' : 'Nada é alterado até você aprovar'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionCard;
