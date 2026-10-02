import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, RefreshCw } from 'lucide-react';
import type { AgentAction } from '../../types/agent';
import { fetchTools, listenActions } from '../../services/agentChatService';
import { fetchIntegrationsOverview, type IntegrationSummary } from '../../services/integrationsStatusService';
import { listenProjects } from '../../services/contentService';
import { useAgentTheme } from './theme';
import { useEstadoMeli } from './useFontes';
import { MARCA } from './ConnectionsBar';
import { entradasDoApp, montarFontes, type ChaveFonte, type Fonte } from './conectores';
import { BotaoConta } from '../../components/ContaMenu';

interface Props {
  uid: string;
  hasMeli: boolean;
  hasContentAgent: boolean;
  onVoltar: () => void;
  /** Conectar, revalidar ou gerenciar: leva à tela onde aquela conexão se faz. */
  onConectar: (chave: ChaveFonte) => void;
}

const ROTULO_ACAO: Record<NonNullable<Fonte['acao']>, string> = {
  verificar: 'Verificar',
  revalidar: 'Revalidar',
  reconectar: 'Reconectar',
};

const Logo: React.FC<{ chave: ChaveFonte; sigla: string; apagado?: boolean }> = ({ chave, sigla, apagado }) => (
  <span
    className="w-10 h-10 rounded-[12px] grid place-items-center text-[13px] font-bold shrink-0"
    style={apagado
      ? { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }
      : { background: MARCA[chave]?.cor ?? 'var(--ag-fill-2)', color: '#fff' }}
  >
    {sigla}
  </span>
);

const Secao: React.FC<{ titulo: string; alerta?: boolean; children: React.ReactNode }> = ({ titulo, alerta, children }) => (
  <section className="flex flex-col gap-2">
    <h2
      className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={{ color: alerta ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}
    >
      {titulo}
    </h2>
    <div
      className={alerta ? 'rounded-[20px] overflow-hidden' : 'ag-glass rounded-[20px] overflow-hidden'}
      style={alerta
        ? { background: 'var(--ag-warn-soft)', border: '1px solid color-mix(in srgb, var(--ag-warn) 35%, transparent)' }
        : undefined}
    >
      {children}
    </div>
  </section>
);

const Linha: React.FC<{ f: Fonte; primeira: boolean; verificando: boolean; onAcao: () => void }> = ({ f, primeira, verificando, onAcao }) => (
  <div
    className="flex items-center gap-3 px-3.5 py-3"
    style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}
  >
    <Logo chave={f.chave} sigla={f.sigla} apagado={f.grupo === 'disponivel'} />
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-semibold text-[var(--ag-text)] truncate">{f.nome}</div>
      <div
        className="text-[13px] leading-snug"
        style={{ color: f.grupo === 'atencao' ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}
      >
        {f.grupo === 'atencao' && <AlertTriangle className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />}
        {f.linha}
      </div>
    </div>

    {f.grupo === 'conectado' ? (
      <div className="flex items-center gap-1.5 shrink-0">
        {f.pendentes > 0 && (
          <span
            className="px-2 py-0.5 rounded-full text-[11.5px] font-semibold tabular-nums"
            style={{ background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }}
            title={`${f.pendentes} ${f.pendentes === 1 ? 'aprovação pendente' : 'aprovações pendentes'}`}
          >
            {f.pendentes}
          </span>
        )}
        <button
          onClick={onAcao}
          className="min-h-[36px] px-2.5 rounded-full text-[12px] font-semibold"
          style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}
          title="Gerenciar a conexão"
        >
          ativo
        </button>
      </div>
    ) : (
      <button
        onClick={onAcao}
        disabled={f.acao === 'verificar' && verificando}
        className="min-h-[44px] px-4 rounded-full text-[14px] font-semibold shrink-0 flex items-center gap-1.5 disabled:opacity-60"
        style={f.grupo === 'disponivel'
          ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }
          : { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
      >
        {f.acao === 'verificar' && verificando && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
        {f.acao ? ROTULO_ACAO[f.acao] : 'Conectar'}
      </button>
    )}
  </div>
);

/**
 * "Fontes e conectores" (A4): o que o Alfred enxerga para montar a semana,
 * separado em o que precisa de um toque, o que está ligado (e quantas
 * ferramentas libera) e o que ainda dá para conectar.
 */
const ConectoresScreen: React.FC<Props> = ({ uid, hasMeli, hasContentAgent, onVoltar, onConectar }) => {
  const { tema } = useAgentTheme();
  // Recarga manual ("Verificar"): refaz as checagens de status sem sair da tela.
  const [recarga, setRecarga] = useState(0);
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ferramentas, setFerramentas] = useState<Record<string, number>>({});
  const [acoes, setAcoes] = useState<AgentAction[]>([]);
  const [projetos, setProjetos] = useState<number | null>(null);
  const meli = useEstadoMeli(hasMeli, recarga);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    fetchIntegrationsOverview()
      .then((l) => { if (vivo) setIntegracoes(l); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregando(false); });
    fetchTools()
      .then(({ tools }) => {
        if (!vivo) return;
        const contagem: Record<string, number> = {};
        for (const t of tools) contagem[t.provider] = (contagem[t.provider] ?? 0) + 1;
        setFerramentas(contagem);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [uid, recarga]);

  useEffect(() => listenActions(setAcoes), [uid]);
  useEffect(() => (hasContentAgent ? listenProjects(uid, (l) => setProjetos(l.length)) : undefined), [uid, hasContentAgent]);

  const pendentes = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of acoes) if (a.status === 'pending') c[a.provider] = (c[a.provider] ?? 0) + 1;
    return c;
  }, [acoes]);

  const fontes = useMemo(
    () => montarFontes(entradasDoApp({ integracoes, meli, hasMeli, hasContentAgent, projetos }), ferramentas, pendentes),
    [integracoes, meli, hasMeli, hasContentAgent, projetos, ferramentas, pendentes],
  );

  const acionar = (f: Fonte) => {
    if (f.acao === 'verificar') setRecarga((n) => n + 1);
    else onConectar(f.chave);
  };

  const grupo = (lista: Fonte[]) => lista.map((f, i) => (
    <Linha key={f.chave} f={f} primeira={i === 0} verificando={carregando} onAcao={() => acionar(f)} />
  ));

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        <div className="ag-tela-x ag-scroll flex-1 overflow-y-auto pt-4 pb-28 md:pb-6">
          <div className="max-w-2xl mx-auto flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <BotaoConta />
              <button
                onClick={onVoltar}
                className="min-h-[44px] -ml-1 pr-2 flex items-center text-[15px] font-medium text-[var(--ag-text)]"
              >
                <ChevronLeft className="w-5 h-5" /> Alfred
              </button>
              <button
                onClick={() => setRecarga((n) => n + 1)}
                disabled={carregando}
                title="Checar de novo"
                className="ml-auto w-9 h-9 rounded-full grid place-items-center text-[var(--ag-text-2)] disabled:opacity-60"
                style={{ background: 'var(--ag-fill)' }}
              >
                <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div>
              <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Fontes e conectores</h1>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ag-text-2)]">
                O que o Alfred enxerga para montar a sua semana. Cada conector libera tarefas novas.
              </p>
            </div>

            {carregando && !integracoes.length ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => <div key={i} className="ag-shimmer h-16 rounded-[20px]" />)}
              </div>
            ) : (
              <>
                {fontes.atencao.length > 0 && <Secao titulo="Precisa de atenção" alerta>{grupo(fontes.atencao)}</Secao>}
                {fontes.conectados.length > 0 && <Secao titulo="Conectados">{grupo(fontes.conectados)}</Secao>}
                {fontes.disponiveis.length > 0 && <Secao titulo="Disponíveis">{grupo(fontes.disponiveis)}</Secao>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConectoresScreen;
