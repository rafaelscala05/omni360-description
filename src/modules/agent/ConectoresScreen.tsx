// A4 · Fontes e conectores — o que o Alfred enxerga e o que cada conexão
// libera. As seções saem de montarConectores (conectores.ts); aqui só a busca
// do estado (status das quatro integrações + ferramentas por provider) e o
// desenho. Conectar de fato continua na tela de Integrações: cada conector
// tem um formulário próprio (token, OAuth, conta + credenciais).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2, Menu, RefreshCw } from 'lucide-react';
import { fetchIntegrationsOverview, type IntegrationSummary } from '../../services/integrationsStatusService';
import { fetchTools } from '../../services/agentChatService';
import { useAgentTheme } from './theme';
import { MARCA, montarConectores, type Conector, type SecaoConector } from './conectores';

interface Props {
  hasContentAgent: boolean;
  hasMeli: boolean;
  onVoltar: () => void;
  onAbrirIntegracoes: () => void;
  onAbrirMenu: () => void;
}

const TITULO: Record<SecaoConector, string> = {
  atencao: 'Precisa de atenção',
  conectado: 'Conectados',
  disponivel: 'Disponíveis',
};

const Logo: React.FC<{ id: string; apagado?: boolean }> = ({ id, apagado }) => {
  const m = MARCA[id] ?? { glifo: id.slice(0, 2), cor: 'var(--ag-fill-2)' };
  return (
    <span
      className="w-10 h-10 rounded-[12px] grid place-items-center text-[13px] font-bold text-white shrink-0"
      style={{ background: m.cor, filter: apagado ? 'grayscale(1)' : undefined, opacity: apagado ? 0.7 : 1 }}
    >
      {m.glifo}
    </span>
  );
};

const Linha: React.FC<{
  c: Conector;
  primeira: boolean;
  verificando: boolean;
  onVerificar: () => void;
  onConectar: () => void;
}> = ({ c, primeira, verificando, onVerificar, onConectar }) => (
  <div className="flex items-center gap-3 px-3.5 py-3" style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}>
    <Logo id={c.id} apagado={c.secao === 'disponivel'} />
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-semibold text-[var(--ag-text)] truncate">{c.nome}</div>
      <div className="text-[13px] leading-snug" style={{ color: c.alerta ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}>
        {c.alerta ?? c.linha}
      </div>
    </div>
    {c.secao === 'conectado' && (
      <span className="shrink-0 px-2.5 py-1 rounded-full text-[12px] font-medium" style={{ background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }}>
        ativo
      </span>
    )}
    {c.secao === 'atencao' && (
      <div className="flex gap-1.5 shrink-0">
        <button
          onClick={onVerificar}
          disabled={verificando}
          className="min-h-[40px] px-3.5 rounded-full text-[13.5px] font-semibold text-[var(--ag-text)] flex items-center gap-1.5 disabled:opacity-60"
          style={{ background: 'var(--ag-fill-2)' }}
        >
          {verificando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Verificar
        </button>
        <button
          onClick={onConectar}
          className="hidden sm:inline-flex min-h-[40px] px-3.5 rounded-full text-[13.5px] font-semibold items-center"
          style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
        >
          Reconectar
        </button>
      </div>
    )}
    {c.secao === 'disponivel' && (
      <button
        onClick={onConectar}
        className="shrink-0 min-h-[40px] px-4 rounded-full text-[13.5px] font-semibold"
        style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}
      >
        Conectar
      </button>
    )}
  </div>
);

const ConectoresScreen: React.FC<Props> = ({ hasContentAgent, hasMeli, onVoltar, onAbrirIntegracoes, onAbrirMenu }) => {
  const { tema } = useAgentTheme();
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);
  const [ferramentas, setFerramentas] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [verificando, setVerificando] = useState(false);

  const carregarStatus = useCallback(async () => {
    const lista = await fetchIntegrationsOverview().catch(() => null);
    if (lista) setIntegracoes(lista);
  }, []);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      carregarStatus(),
      fetchTools().then(({ tools }) => {
        if (!vivo) return;
        const contagem: Record<string, number> = {};
        for (const t of tools) contagem[t.provider] = (contagem[t.provider] ?? 0) + 1;
        setFerramentas(contagem);
      }).catch(() => {}),
    ]).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [carregarStatus]);

  // Verificar = checar de novo os quatro status. Se a falha era passageira
  // (rede, instância fria), a linha sobe para Conectados; se não, continua
  // aqui e o caminho é reconectar em Integrações.
  const verificar = async () => {
    setVerificando(true);
    try { await carregarStatus(); } finally { setVerificando(false); }
  };

  const conectores = useMemo(
    () => montarConectores({ integracoes, ferramentas, hasContentAgent, hasMeli }),
    [integracoes, ferramentas, hasContentAgent, hasMeli],
  );
  const secoes = (['atencao', 'conectado', 'disponivel'] as SecaoConector[])
    .map((s) => ({ s, itens: conectores.filter((c) => c.secao === s) }))
    .filter((x) => x.itens.length);

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="ag-aurora flex-1 min-h-0 rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        <header className="shrink-0 px-2 sm:px-4 py-2 flex items-center gap-1" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
          <button
            onClick={onAbrirMenu}
            title="Menu"
            className="md:hidden w-9 h-9 rounded-full grid place-items-center shrink-0 text-[var(--ag-text-2)]"
            style={{ background: 'var(--ag-fill)' }}
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>
          <button onClick={onVoltar} className="min-h-[44px] px-2 flex items-center gap-0.5 text-[15px] font-medium text-[var(--ag-text)]">
            <ChevronLeft className="w-5 h-5" /> Alfred
          </button>
        </header>

        <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-28 md:pb-6">
          <div className="max-w-2xl flex flex-col gap-3">
            <div>
              <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Fontes e conectores</h1>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--ag-text-2)]">
                O que o Alfred enxerga para montar a sua semana. Cada conector libera tarefas novas.
              </p>
            </div>

            {carregando ? (
              <div className="ag-glass rounded-[18px] px-4 py-6 flex items-center justify-center gap-2 text-[14px] text-[var(--ag-text-2)]">
                <Loader2 className="w-4 h-4 animate-spin" /> Checando as conexões…
              </div>
            ) : secoes.map(({ s, itens }) => (
              <section key={s} className="flex flex-col gap-2">
                <h2
                  className="px-1 pt-1 text-[11px] font-medium uppercase tracking-[0.06em]"
                  style={{ color: s === 'atencao' ? 'var(--ag-warn)' : 'var(--ag-text-2)' }}
                >
                  {TITULO[s]}
                </h2>
                <div
                  className={s === 'atencao' ? 'rounded-[16px]' : 'ag-glass rounded-[16px]'}
                  style={s === 'atencao'
                    ? { background: 'var(--ag-warn-soft)', border: '1px solid color-mix(in srgb, var(--ag-warn) 35%, transparent)' }
                    : undefined}
                >
                  {itens.map((c, i) => (
                    <Linha
                      key={c.id}
                      c={c}
                      primeira={i === 0}
                      verificando={verificando}
                      onVerificar={verificar}
                      onConectar={onAbrirIntegracoes}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConectoresScreen;
