import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Pause, Play, ShieldCheck, Square, Trash2, Undo2, X } from 'lucide-react';
import type { AgentAction } from '../../../types/agent';
import { agirNoLote, definirAutonomia, listenLote, type AcaoLote } from '../../../services/agentChatService';
import { camposDoItem, linhaProgresso, linhasAoVivo, podeDesfazer, resumoLote, type LoteJob } from '../lote';
import { Amostra } from './Amostra';
import { carregarAutonomia, esquecerAutonomia, rotuloAutonomia } from './autonomia';

const Botao: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  ocupado?: boolean;
  principal?: boolean;
  icone: React.ReactNode;
  children: React.ReactNode;
}> = ({ onClick, disabled, ocupado, principal, icone, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-50"
    style={principal
      ? { background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)', boxShadow: '0 8px 20px -10px var(--ag-accent)' }
      : { background: 'var(--ag-fill-2)', color: 'var(--ag-text-2)' }}
  >
    {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : icone}
    {children}
  </button>
);

/**
 * O card de um lote em job (A2/A3 do desenho): o Alfred escreve item a item
 * em segundo plano e o card mostra "7 de 12 · agora: …", as prontas numa
 * amostra navegável e "Aprovar 5 prontas" enquanto o resto termina. Pausar e
 * parar ficam aqui também. O conteúdo vem direto de agent_jobs/{id}; cada
 * botão passa pela rota do lote, que é quem grava e debita.
 */
const LoteCard: React.FC<{ action: AgentAction }> = ({ action }) => {
  const loteId = action.preview.lote!.id;
  const [job, setJob] = useState<LoteJob | null>(null);
  const [ocupado, setOcupado] = useState<AcaoLote | 'item' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [podeAuto, setPodeAuto] = useState(false);
  const [autoMarcado, setAutoMarcado] = useState(false);

  useEffect(() => listenLote(loteId, setJob), [loteId]);

  const pendente = action.status === 'pending';
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

  const prontos = useMemo(() => (job?.itens ?? []).filter((i) => i.estado === 'pronto' && i.resultado), [job]);
  const amostra = useMemo(
    () => prontos.map((i) => ({ alvo: `${i.nome}${i.sku ? ` · ${i.sku}` : ''}`, campos: camposDoItem(i) })),
    [prontos],
  );

  const total = action.preview.lote!.total || 1;
  const custoPorItem = (action.preview.custo ?? 0) / total;
  const r = job ? resumoLote(job) : null;
  const status = job?.status ?? 'rodando';
  const util = r ? r.total - job!.itens.filter((i) => i.estado === 'descartado' && !i.resultado).length : total;
  const pct = r && util ? Math.round((r.gerados / util) * 100) : 0;

  const agir = async (acao: AcaoLote, itens?: string[], marcador: AcaoLote | 'item' = acao) => {
    setOcupado(marcador);
    setErro(null);
    try {
      // "Aprovar sozinho" vale para os próximos lotes; este segue pela aprovação de agora.
      if (acao === 'aprovar' && podeAuto) {
        const jaEra = (await carregarAutonomia()).auto.has(action.tool);
        if (jaEra !== autoMarcado) {
          await definirAutonomia(action.tool, autoMarcado).catch(() => {});
          esquecerAutonomia();
        }
      }
      await agirNoLote(loteId, acao, itens);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao falar com o servidor.');
    } finally {
      setOcupado(null);
    }
  };

  const selo = !pendente
    ? {
      executed: { texto: action.dryRun ? 'Simulado (dry-run)' : 'Concluído', fundo: 'var(--ag-ok-soft)', cor: 'var(--ag-ok)' },
      failed: { texto: 'Nada gravado', fundo: 'var(--ag-danger-soft)', cor: 'var(--ag-danger)' },
      rejected: { texto: 'Recusado', fundo: 'var(--ag-fill)', cor: 'var(--ag-text-3)' },
      pending: { texto: '', fundo: '', cor: '' },
    }[action.status]
    : status === 'pausado'
      ? { texto: 'Pausado', fundo: 'var(--ag-fill-2)', cor: 'var(--ag-text-2)' }
      : status === 'rodando'
        ? { texto: 'Trabalhando', fundo: 'var(--ag-blue-soft)', cor: 'var(--ag-blue)' }
        : { texto: 'Esperando você', fundo: 'var(--ag-warn-soft)', cor: 'var(--ag-warn)' };

  const trabalhando = status === 'rodando' || status === 'pausado';
  const recibo = (action.result ?? {}) as { gravados?: number; pulados?: string[] };

  return (
    <div
      className="ag-glass rounded-[20px] overflow-hidden"
      style={{
        boxShadow: prontos.length && pendente ? '0 0 0 4px var(--ag-accent-soft), var(--ag-shadow)' : 'var(--ag-shadow-sm)',
        opacity: action.status === 'rejected' ? 0.6 : 1,
      }}
    >
      <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
        <div className="min-w-0">
          <div className="font-semibold text-[var(--ag-text)] text-[14px] leading-snug">{action.preview.resumo}</div>
          <div className="text-[12px] text-[var(--ag-text-3)] mt-0.5 truncate" title={action.preview.alvo}>{action.preview.alvo}</div>
        </div>
        <span className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: selo.fundo, color: selo.cor }}>
          {selo.texto}
        </span>
      </div>

      {job && (trabalhando || r!.gerados > 0) && (
        <div className="px-4 py-3 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
          <div className="text-[13px] text-[var(--ag-text-2)] tabular-nums truncate" aria-live="polite">{linhaProgresso(job)}</div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--ag-fill-2)' }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(pct, trabalhando ? 4 : 0)}%`, background: status === 'pausado' ? 'var(--ag-text-3)' : 'var(--ag-blue)' }}
            />
          </div>
          {r!.gravados > 0 && (
            <div className="text-[12px] text-[var(--ag-text-2)] flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" style={{ color: 'var(--ag-ok)' }} />
              {r!.gravados} {r!.gravados === 1 ? 'gravado' : 'gravados'} no catálogo
              {r!.falhas + r!.pulados > 0 && <span className="text-[var(--ag-text-3)]">· {r!.falhas + r!.pulados} ficaram de fora</span>}
            </div>
          )}
        </div>
      )}

      {/* Lote que grava sozinho (o "Gerar … para todas" da tela de Produtos):
          o que está acontecendo, item a item, em texto corrido. */}
      {job?.auto && job.itens.some((i) => i.estado !== 'fila') && (
        <ul className="px-4 py-2 flex flex-col gap-0.5 text-[13px]" style={{ borderBottom: '1px solid var(--ag-hairline)' }} aria-live="polite">
          {linhasAoVivo(job).map((l, i) => (
            <li key={i} className="truncate" style={{ color: l.tom === 'ok' ? 'var(--ag-ok)' : l.tom === 'alerta' ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>{l.texto}</li>
          ))}
        </ul>
      )}

      {!job && pendente && (
        <div className="px-4 py-3 text-[13px] text-[var(--ag-text-2)] flex items-center gap-2" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Preparando o lote…
        </div>
      )}

      {pendente && prontos.length > 0 && (
        <>
          <div className="px-4 pt-3 text-[13px] font-medium text-[var(--ag-text)]">
            {status === 'rodando'
              ? `${prontos.length === 1 ? 'A primeira está pronta' : `As ${prontos.length} primeiras estão prontas`} — revise enquanto termino o resto.`
              : `${prontos.length === 1 ? '1 pronta' : `${prontos.length} prontas`} para revisar.`}
          </div>
          <Amostra
            itens={amostra}
            rodape={(i) => (
              <button
                onClick={() => void agir('descartar', [prontos[i].id], 'item')}
                disabled={!!ocupado}
                className="self-start inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-[12.5px] font-medium disabled:opacity-50"
                style={{ background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}
              >
                {ocupado === 'item' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Descartar esta
              </button>
            )}
          />
        </>
      )}

      {pendente && action.preview.avisos.length > 0 && (
        <div className="px-4 py-3 space-y-1.5" style={{ background: 'var(--ag-warn-soft)', borderTop: '1px solid var(--ag-hairline)' }}>
          {action.preview.avisos.map((a, i) => (
            <div key={i} className="flex gap-2 text-[12px]" style={{ color: 'var(--ag-warn)' }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {(erro || action.error) && (
        <div className="px-4 py-3 text-[12px]" style={{ background: 'var(--ag-danger-soft)', borderTop: '1px solid var(--ag-hairline)', color: 'var(--ag-danger)' }}>
          {erro ?? action.error}
        </div>
      )}

      {!pendente && (
        <div className="px-4 py-2 text-[12px] text-[var(--ag-text-2)] flex items-center gap-1.5 flex-wrap" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          {action.status === 'executed' && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ag-ok)' }} />}
          Recibo: {recibo.gravados ?? 0} {recibo.gravados === 1 ? 'produto gravado' : 'produtos gravados'} no catálogo
          {action.resolvedAt && <> em {new Date(action.resolvedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
          {!!recibo.pulados?.length && <span className="text-[var(--ag-text-3)]">· de fora: {recibo.pulados.join('; ')}</span>}
          {action.auto && <span className="text-[var(--ag-text-3)]">· {job?.origem === 'massa' ? `${Math.round(custoPorItem * (recibo.gravados ?? 0))} créditos` : 'aprovado sozinho, pela autonomia ligada'}</span>}
          {job && podeDesfazer(job) && (
            <span className="ml-auto">
              <Botao onClick={() => void agir('desfazer')} disabled={!!ocupado} ocupado={ocupado === 'desfazer'} icone={<Undo2 className="w-4 h-4" />}>Desfazer</Botao>
            </span>
          )}
          {job?.desfeito && <span className="ml-auto text-[var(--ag-text-3)]">Desfeito</span>}
        </div>
      )}

      {pendente && podeAuto && prontos.length > 0 && !action.auto && (
        <label className="px-4 py-3 flex items-start gap-3 cursor-pointer" style={{ borderTop: '1px solid var(--ag-hairline)' }}>
          <input
            type="checkbox"
            checked={autoMarcado}
            onChange={(e) => setAutoMarcado(e.target.checked)}
            className="mt-0.5 w-[18px] h-[18px] shrink-0"
            style={{ accentColor: 'var(--ag-text)' }}
          />
          <span className="flex flex-col">
            <span className="text-[13.5px] font-medium text-[var(--ag-text)]">{rotuloAutonomia(action.tool)}: aprovar sozinho</span>
            <span className="text-[12px] text-[var(--ag-text-3)]">Os próximos lotes gravam cada item assim que fica pronto.</span>
          </span>
        </label>
      )}

      {pendente && (
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap" style={{ background: 'var(--ag-fill)', borderTop: '1px solid var(--ag-hairline)' }}>
          {prontos.length > 0 && (
            <Botao principal onClick={() => void agir('aprovar')} disabled={!!ocupado} ocupado={ocupado === 'aprovar'} icone={<Check className="w-4 h-4" />}>
              {prontos.length === 1 ? 'Aprovar a pronta' : `Aprovar ${prontos.length} prontas`}
              {custoPorItem > 0 && <span className="font-medium opacity-80">· {Math.round(custoPorItem * prontos.length)} créd.</span>}
            </Botao>
          )}
          {status === 'rodando' && (
            <Botao onClick={() => void agir('pausar')} disabled={!!ocupado} ocupado={ocupado === 'pausar'} icone={<Pause className="w-4 h-4" />}>Pausar</Botao>
          )}
          {status === 'pausado' && (
            <Botao onClick={() => void agir('retomar')} disabled={!!ocupado} ocupado={ocupado === 'retomar'} icone={<Play className="w-4 h-4" />}>Continuar</Botao>
          )}
          {trabalhando && (
            <Botao onClick={() => void agir('parar')} disabled={!!ocupado} ocupado={ocupado === 'parar'} icone={<Square className="w-3.5 h-3.5" />}>Parar aqui</Botao>
          )}
          {!trabalhando && (
            <Botao onClick={() => void agir('descartar')} disabled={!!ocupado} ocupado={ocupado === 'descartar'} icone={<X className="w-4 h-4" />}>Recusar o resto</Botao>
          )}
          {!action.auto && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--ag-text-3)]">
              <ShieldCheck className="w-3.5 h-3.5" />
              Só grava o que você aprovar
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LoteCard;
