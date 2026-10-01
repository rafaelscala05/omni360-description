import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, PencilLine, ShieldCheck, X } from 'lucide-react';
import type { AgentAction, PreviewField } from '../../../types/agent';
import { definirAutonomia, iniciarVideoDoAlfred } from '../../../services/agentChatService';
import { estadoVideo } from '../videoAlfred';
import { carregarAutonomia, esquecerAutonomia, rotuloAutonomia } from './autonomia';
import { CredentialForm } from './CredentialForm';
import { Amostra, formatar } from './Amostra';
import LoteCard from './LoteCard';
import Recibo from './Recibo';
import { destinoDaAcao, rotuloDestino } from '../abrirNaFerramenta';
import { useAbrirNaFerramenta } from '../AbrirNaFerramentaContext';


/** Depois de aprovado, o vídeo começa pelo app (useVideosDoAlfred): aqui o andamento e o "tentar de novo". */
const EstadoVideo: React.FC<{ action: AgentAction }> = ({ action }) => {
  const r = estadoVideo(action);
  const [tentando, setTentando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!r.pedidoVideo) return null;
  const falhou = !!(r.videoErro || erro);
  const tentar = async () => {
    setTentando(true);
    setErro(null);
    try { await iniciarVideoDoAlfred(action.id); } catch (e) { setErro(e instanceof Error ? e.message : 'Falhou.'); } finally { setTentando(false); }
  };
  return (
    <div className="px-4 py-2.5 text-[12.5px] flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--ag-hairline)', color: falhou ? 'var(--ag-danger)' : 'var(--ag-text-2)' }}>
      {falhou
        ? <>Vídeo não começou: {erro ?? r.videoErro}</>
        : r.videoJobId
          ? <>Vídeo em produção — acompanhe em Atividade › Rodando.</>
          : <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {r.status === 'escrevendo o roteiro' ? 'Escrevendo o roteiro…' : 'Começando o vídeo…'}</>}
      {falhou && (
        <button
          onClick={() => void tentar()}
          disabled={tentando}
          className="ml-auto inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-full text-[12.5px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
        >
          {tentando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Tentar de novo
        </button>
      )}
    </div>
  );
};

interface Props {
  uid: string;
  action: AgentAction;
  onExecutar: (id: string) => Promise<void>;
  onRejeitar: (id: string) => Promise<void>;
  /** "Ajustar no chat" (A3): recusar dizendo o que mudar. Ausente = sem o botão. */
  onAjustar?: (action: AgentAction) => void;
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
const ActionCard: React.FC<Props> = ({ uid, action, onExecutar, onRejeitar, onAjustar }) => {
  const [busy, setBusy] = useState<'executar' | 'rejeitar' | null>(null);
  const [podeAuto, setPodeAuto] = useState(false);
  const [autoMarcado, setAutoMarcado] = useState(false);
  const pendente = action.status === 'pending';
  const abrir = useAbrirNaFerramenta();
  const destino = destinoDaAcao(action);
  const itens = action.preview.itens ?? [];
  const custo = action.preview.custo ?? 0;

  useEffect(() => {
    if (!pendente) return;
    let vivo = true;
    carregarAutonomia().then(({ travas, auto }) => {
      if (!vivo) return;
      setPodeAuto(!travas.has(action.tool));
      setAutoMarcado(auto.has(action.tool));
    });
    return () => { vivo = false; };
  }, [pendente, action.tool]);
  const semMudanca = action.preview.campos.length > 0 && action.preview.campos.every((c) => !c.mudou);

  const rodar = async (qual: 'executar' | 'rejeitar') => {
    setBusy(qual);
    try {
      // A autonomia vale para as PRÓXIMAS — esta continua passando pela
      // aprovação que o usuário está dando agora.
      if (qual === 'executar' && podeAuto) {
        const jaEra = (await carregarAutonomia()).auto.has(action.tool);
        if (jaEra !== autoMarcado) {
          await definirAutonomia(action.tool, autoMarcado).catch(() => {});
          esquecerAutonomia();
        }
      }
      await (qual === 'executar' ? onExecutar(action.id) : onRejeitar(action.id));
    } finally {
      setBusy(null);
    }
  };

  // Lote em job: progresso ao vivo e aprovação por item, não o Aprovar/Recusar único.
  if (action.preview.lote) return <LoteCard action={action} />;

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

      {itens.length > 0 && (
        <div className="px-4 py-3 grid grid-cols-3 gap-2" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
          {[
            ['Itens', String(itens.length)],
            ['Campos', `${Math.max(...itens.map((it) => it.campos.filter((c) => c.mudou).length))} cada`],
            [custo === 1 ? 'Crédito' : 'Créditos', custo ? String(custo) : 'grátis'],
          ].map(([r, v]) => (
            <div key={r} className="rounded-[14px] px-3 py-2" style={{ background: 'var(--ag-fill)' }}>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--ag-text-3)]">{r}</div>
              <div className="text-[15px] font-semibold text-[var(--ag-text)] tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}

      {itens.length > 0 && <Amostra itens={itens} />}

      {itens.length === 0 && action.preview.campos.length > 0 && (
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

      {pendente && podeAuto && (
        <label
          className="px-4 py-3 flex items-start gap-3 cursor-pointer"
          style={{ borderTop: '1px solid var(--ag-hairline)' }}
        >
          <input
            type="checkbox"
            checked={autoMarcado}
            onChange={(e) => setAutoMarcado(e.target.checked)}
            className="mt-0.5 w-[18px] h-[18px] shrink-0"
            style={{ accentColor: 'var(--ag-text)' }}
          />
          <span className="flex flex-col">
            <span className="text-[13.5px] font-medium text-[var(--ag-text)]">{rotuloAutonomia(action.tool)}: aprovar sozinho</span>
            <span className="text-[12px] text-[var(--ag-text-3)]">Publicar e conectar contas sempre perguntam.</span>
          </span>
        </label>
      )}

      {action.status === 'executed' && action.tool === 'produtos.video.gerar' && <EstadoVideo action={action} />}

      {action.status === 'executed' && action.resolvedAt && <Recibo action={action} />}

      {abrir && destino && action.status !== 'rejected' && (
        <div className="px-4 py-2" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          <button
            onClick={() => abrir(destino)}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
          >
            {rotuloDestino(destino)} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {action.status === 'rejected' && action.ajuste && (
        <div className="px-4 py-2 text-[12px] text-[var(--ag-text-2)] flex items-start gap-1.5" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          <PencilLine className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>Você pediu para ajustar: “{action.ajuste}”</span>
        </div>
      )}

      {!pendente && action.auto && (
        <div className="px-4 py-2 text-[12px] text-[var(--ag-text-3)]" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          Aprovado sozinho, pela autonomia que você ligou para esta ação.
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
            {itens.length > 1 ? `Aprovar ${itens.length === 2 ? 'os 2' : `os ${itens.length}`}` : 'Aprovar'}
          </button>
          <button
            onClick={() => rodar('rejeitar')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-50"
            style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' }}
          >
            {busy === 'rejeitar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Recusar
          </button>
          {onAjustar && (
            <button
              onClick={() => onAjustar(action)}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-50"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' }}
            >
              <PencilLine className="w-4 h-4" />
              Ajustar no chat
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--ag-text-3)]">
            <ShieldCheck className="w-3.5 h-3.5" />
            {semMudanca ? 'Nada muda' : custo && !itens.length ? `${custo} ${custo === 1 ? 'crédito' : 'créditos'} · nada muda até você aprovar` : 'Nada é alterado até você aprovar'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionCard;
