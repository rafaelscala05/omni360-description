import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, Loader2, ShieldCheck, X } from 'lucide-react';
import type { AgentAction, PreviewField } from '../../../types/agent';
import { definirAutonomia, fetchAgentSettings } from '../../../services/agentChatService';
import { CredentialForm } from './CredentialForm';
import { destinoGravacao } from '../plano';

/** Uma linha do resultado da execução, quando a ferramenta devolve contagens conhecidas. */
function recibo(result: unknown): string | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const partes: string[] = [];
  if (typeof r.gravados === 'number') partes.push(`${r.gravados} ${r.gravados === 1 ? 'produto' : 'produtos'}`);
  if (Array.isArray(r.pulados) && r.pulados.length) partes.push(`${r.pulados.length} pulado(s)`);
  if (typeof r.mudancas === 'number' && typeof r.execucao === 'string') partes.push(`${r.mudancas} mudança(s) na fila de publicação`);
  return partes.length ? partes.join(' · ') : null;
}

// As travas fixas (publicar, credencial…) vêm do servidor uma vez por sessão:
// nelas o "aprovar sozinho" não aparece, porque o servidor ignoraria.
let travasCache: Promise<{ travas: Set<string>; auto: Set<string> }> | null = null;
function carregarAutonomia() {
  travasCache ??= fetchAgentSettings()
    .then(({ settings, travas }) => ({
      travas: new Set(travas),
      auto: new Set(Object.entries(settings.toolOverrides ?? {}).filter(([, m]) => m === 'auto').map(([t]) => t)),
    }))
    .catch(() => { travasCache = null; return { travas: new Set<string>(), auto: new Set<string>() }; });
  return travasCache;
}

/** Nome da ação para o "Próximas … : aprovar sozinho". */
function rotuloAutonomia(tool: string): string {
  if (tool === 'produtos.descricoes.gerar') return 'Próximas descrições';
  if (tool.startsWith('wake.') || tool.startsWith('tiny.')) return 'Próximas alterações deste tipo';
  return 'Próximas vezes';
}

const Bloco: React.FC<{ rotulo: string; valor: unknown; destaque?: boolean }> = ({ rotulo, valor, destaque }) => (
  <div
    className="rounded-[14px] px-3 py-2.5"
    style={destaque
      ? { background: 'var(--ag-ok-soft)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--ag-ok) 30%, transparent)' }
      : { background: 'var(--ag-fill)' }}
  >
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] mb-1" style={{ color: destaque ? 'var(--ag-ok)' : 'var(--ag-text-3)' }}>{rotulo}</div>
    <div className="text-[13px] leading-[1.5] break-words whitespace-pre-wrap" style={{ color: destaque ? 'var(--ag-text)' : 'var(--ag-text-2)' }}>
      {formatar(valor) === '—' ? 'vazio' : formatar(valor)}
    </div>
  </div>
);

/**
 * Lote: um item por vez, com antes e depois empilhados e setas para navegar —
 * "aprovar 12" sem ver nenhum seria aprovar às cegas, e uma tabela com 36
 * linhas ninguém lê no celular.
 */
const Amostra: React.FC<{ itens: NonNullable<AgentAction['preview']['itens']> }> = ({ itens }) => {
  const [i, setI] = useState(0);
  const item = itens[Math.min(i, itens.length - 1)];
  return (
    <div className="px-4 py-3 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-[var(--ag-text)] truncate" title={item.alvo}>{item.alvo}</span>
        {itens.length > 1 && (
          <span className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setI((v) => Math.max(0, v - 1))}
              disabled={i === 0}
              aria-label="Item anterior"
              className="w-9 h-9 rounded-full grid place-items-center disabled:opacity-35"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[12px] tabular-nums text-[var(--ag-text-2)] min-w-[3.2rem] text-center">{i + 1} / {itens.length}</span>
            <button
              onClick={() => setI((v) => Math.min(itens.length - 1, v + 1))}
              disabled={i >= itens.length - 1}
              aria-label="Próximo item"
              className="w-9 h-9 rounded-full grid place-items-center disabled:opacity-35"
              style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </span>
        )}
      </div>
      {item.campos.map((c, k) => (
        c.antes === null || c.antes === undefined || !c.mudou
          ? <Bloco key={k} rotulo={c.campo} valor={c.depois} destaque={c.mudou} />
          : (
            <div key={k} className="grid gap-2">
              <Bloco rotulo={`${c.campo} · antes`} valor={c.antes} />
              <Bloco rotulo={`${c.campo} · depois`} valor={c.depois} destaque />
            </div>
          )
      ))}
    </div>
  );
};

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
  const [podeAuto, setPodeAuto] = useState(false);
  const [autoMarcado, setAutoMarcado] = useState(false);
  const pendente = action.status === 'pending';
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
          travasCache = null;
        }
      }
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

      {itens.length > 0 && (
        <div className="px-4 py-3 grid grid-cols-3 gap-2" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
          {[
            ['Itens', String(itens.length)],
            ['Campos', `${Math.max(...itens.map((it) => it.campos.filter((c) => c.mudou).length))} cada`],
            ['Custo', custo ? `${custo} ${custo === 1 ? 'crédito' : 'créditos'}` : 'grátis'],
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

      {action.status === 'executed' && action.resolvedAt && (
        <div className="px-4 py-2 text-[12px] text-[var(--ag-text-2)] flex items-center gap-1.5" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ag-ok)' }} />
          Recibo: gravado {destinoGravacao(action.provider) || ''} em {new Date(action.resolvedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {recibo(action.result) && <span className="text-[var(--ag-text-3)]">· {recibo(action.result)}</span>}
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
