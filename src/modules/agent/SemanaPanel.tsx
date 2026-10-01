import React, { useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, ChevronRight, Sparkles } from 'lucide-react';
import { DIAS_CURTOS, inicioDaSemana, type DestinoTarefa, type OrigemTarefa, type TarefaSemana } from './semana';

interface Props {
  tarefas: TarefaSemana[];
  hoje: number;
  onFazer: (prompt: string) => void;
  onAbrir: (destino: DestinoTarefa) => void;
  /** Rodapé "N fontes · +M para conectar" (ver `resumoFontes`); sem ele, sem rodapé. */
  fontes?: { ativas: number; paraConectar: number; alerta: number } | null;
  onAbrirFontes?: () => void;
}

export const ORIGEM: Record<OrigemTarefa, { rotulo: string; cor: string }> = {
  produto: { rotulo: 'Produto', cor: 'var(--ag-orig-produto)' },
  conteudo: { rotulo: 'Conteúdo', cor: 'var(--ag-orig-conteudo)' },
  meli: { rotulo: 'Mercado Livre', cor: 'var(--ag-orig-meli)' },
  operacoes: { rotulo: 'Operações', cor: 'var(--ag-orig-operacoes)' },
};

const ROTULO_DESTINO: Record<DestinoTarefa, string> = {
  produtos: 'Abrir Produtos',
  conteudo: 'Abrir Conteúdo',
  meli: 'Abrir Mercado Livre',
  integracoes: 'Abrir Integrações',
  atividade: 'Revisar',
};

export const Origem: React.FC<{ origem: OrigemTarefa }> = ({ origem }) => (
  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ag-text-2)]">
    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ORIGEM[origem].cor }} />
    {ORIGEM[origem].rotulo}
  </span>
);

const Tarefa: React.FC<{ t: TarefaSemana } & Pick<Props, 'onFazer' | 'onAbrir'>> = ({ t, onFazer, onAbrir }) => {
  if (t.estado === 'feita') {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-[18px]" style={{ background: 'var(--ag-fill)' }}>
        <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}>
          <Check className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] text-[var(--ag-text-2)] line-through truncate" style={{ textDecorationColor: 'var(--ag-hairline-2)' }}>{t.titulo}</div>
          {t.detalhe && <div className="text-[12px] text-[var(--ag-text-3)] truncate">{t.detalhe}</div>}
        </div>
      </div>
    );
  }

  const precisa = t.estado === 'precisa';
  return (
    <div
      className="ag-glass ag-sheen rounded-[22px] p-4 flex flex-col gap-2.5 text-left"
      style={precisa ? { borderColor: 'color-mix(in srgb, var(--ag-accent) 35%, transparent)' } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <Origem origem={t.origem} />
        {precisa && (
          <span className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}>
            precisa de você
          </span>
        )}
      </div>
      <div className="text-[15.5px] font-semibold leading-snug text-[var(--ag-text)]">{t.titulo}</div>
      {t.detalhe && <div className="text-[13px] text-[var(--ag-text-2)] -mt-1">{t.detalhe}</div>}
      <div className="flex gap-2 pt-0.5">
        {t.prompt && (
          <button
            onClick={() => onFazer(t.prompt!)}
            className="flex-1 min-h-[44px] px-4 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold transition-transform active:scale-[.98]"
            style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
          >
            <Sparkles className="w-4 h-4" />
            Fazer com Alfred
          </button>
        )}
        <button
          onClick={() => onAbrir(t.destino)}
          className={`${t.prompt ? '' : 'flex-1'} min-h-[44px] px-4 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold transition-colors`}
          style={t.prompt
            ? { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }
            : { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
        >
          {t.prompt ? 'Abrir' : ROTULO_DESTINO[t.destino]}
          {!t.prompt && <ArrowUpRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};

/**
 * "Sua semana": o que o Alfred montou a partir das fontes conectadas, por dia.
 * É o estado inicial da tela do agente — ela nunca abre num campo vazio.
 */
const SemanaPanel: React.FC<Props> = ({ tarefas, hoje, onFazer, onAbrir, fontes, onAbrirFontes }) => {
  const [dia, setDia] = useState(hoje);
  const inicio = inicioDaSemana(new Date());
  const feitas = tarefas.filter((t) => t.estado === 'feita').length;
  const doDia = tarefas.filter((t) => t.dia === dia);
  const pct = tarefas.length ? Math.round((feitas / tarefas.length) * 100) : 0;

  return (
    <section className="w-full flex flex-col gap-4 text-left">
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Sua semana</h1>
        {tarefas.length > 0 && (
          <span className="text-[13px] text-[var(--ag-text-2)] tabular-nums pb-1">{feitas} de {tarefas.length} feitas</span>
        )}
      </div>

      {tarefas.length > 0 && (
        <div className="h-1.5 rounded-full overflow-hidden -mt-2" style={{ background: 'var(--ag-fill-2)' }}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: 'var(--ag-text)' }} />
        </div>
      )}

      <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Dias da semana">
        {DIAS_CURTOS.map((rotulo, i) => {
          const data = new Date(inicio);
          data.setDate(inicio.getDate() + i);
          const doI = tarefas.filter((t) => t.dia === i);
          const abertas = doI.filter((t) => t.estado !== 'feita').length;
          const ativo = i === dia;
          return (
            <button
              key={rotulo}
              role="tab"
              aria-selected={ativo}
              onClick={() => setDia(i)}
              className="flex flex-col items-center gap-0.5 py-2 min-h-[44px] rounded-[14px] transition-colors"
              style={ativo
                ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }
                : { color: i < hoje ? 'var(--ag-text-3)' : 'var(--ag-text-2)' }}
            >
              <span className="text-[10.5px] font-medium">{i === hoje ? 'HOJE' : rotulo}</span>
              <span className="text-[16px] font-semibold tabular-nums" style={ativo ? undefined : { color: 'var(--ag-text)' }}>{data.getDate()}</span>
              <span className="text-[10.5px] h-3.5 leading-none tabular-nums" style={ativo ? undefined : { color: abertas ? 'var(--ag-accent)' : 'var(--ag-ok)' }}>
                {abertas ? abertas : doI.length ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5">
        {doDia.length === 0 ? (
          <div className="ag-glass rounded-[22px] px-4 py-5 text-center text-[14px] text-[var(--ag-text-2)]">
            {tarefas.length === 0
              ? 'Tudo em dia. Conecte mais fontes para o Alfred montar tarefas para você.'
              : dia < hoje ? 'Nada ficou deste dia.' : 'Nada para este dia.'}
          </div>
        ) : (
          doDia.map((t) => <Tarefa key={t.id} t={t} onFazer={onFazer} onAbrir={onAbrir} />)
        )}
      </div>

      {/* A semana é tão boa quanto o que o Alfred enxerga: o rodapé diz de
          onde as tarefas vêm e quanto ainda dá para ligar. */}
      {fontes && onAbrirFontes && (
        <button
          onClick={onAbrirFontes}
          className="min-h-[44px] px-3.5 rounded-[16px] flex items-center justify-between gap-2 text-[12.5px] whitespace-nowrap transition-colors"
          style={{ background: fontes.alerta ? 'var(--ag-warn-soft)' : 'var(--ag-fill)' }}
        >
          <span className="flex items-center gap-2 font-medium" style={{ color: fontes.alerta ? 'var(--ag-warn)' : 'var(--ag-text)' }}>
            {fontes.alerta > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
            {fontes.ativas} {fontes.ativas === 1 ? 'fonte' : 'fontes'}
            {fontes.alerta > 0 && ` · ${fontes.alerta} ${fontes.alerta === 1 ? 'alerta' : 'alertas'}`}
          </span>
          <span className="flex items-center text-[var(--ag-text-2)]">
            {fontes.paraConectar > 0 ? `+${fontes.paraConectar} para conectar` : 'Ver fontes'}
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
      )}
    </section>
  );
};

export default SemanaPanel;
