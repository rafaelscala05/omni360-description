import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Coins, Menu, Sparkles } from 'lucide-react';
import type { Category, Product } from '../../types/models';
import type { AgentAction } from '../../types/agent';
import { listenActions } from '../../services/agentChatService';
import { fetchIntegrationsOverview, type IntegrationSummary } from '../../services/integrationsStatusService';
import { useAgentTheme } from './theme';
import { useProvidersAlfred, useSemana } from './useSemana';
import { diaNaSemana, inicioDaSemana, proximoPasso, semImagem, type DestinoTarefa, type OrigemTarefa } from './semana';
import { ORIGEM } from './SemanaPanel';

export type ViewConta = 'categories' | 'history' | 'company' | 'missoes';

interface Props {
  uid: string;
  products: Product[];
  /** Para a semana saber quais produtos têm atributo da categoria por preencher. */
  categories?: Category[];
  credits: number;
  hasAgente: boolean;
  hasContentAgent: boolean;
  hasMeli: boolean;
  /** Missões só existem para a coorte que tem a trilha de onboarding. */
  mostrarMissoes: boolean;
  onAbrir: (destino: DestinoTarefa) => void;
  onAbrirView: (view: ViewConta) => void;
  /** Leva ao chat já mandando `prompt` — o Alfred recebe o contexto da tela. */
  onPedirAlfred: (prompt: string) => void;
  onAbrirMenu: () => void;
}

const Linha: React.FC<{ rotulo: string; valor: React.ReactNode; alerta?: boolean; primeira?: boolean }> = ({ rotulo, valor, alerta, primeira }) => (
  <div className="flex items-center justify-between gap-3 py-2 text-[14px]" style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}>
    <span className="text-[var(--ag-text-2)]">{rotulo}</span>
    <span
      className="tabular-nums font-semibold px-2.5 py-0.5 rounded-full text-[12.5px]"
      style={alerta ? { background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' } : { background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}
    >
      {valor}
    </span>
  </div>
);

const Cartao: React.FC<{
  origem: OrigemTarefa;
  nome: string;
  kpi: React.ReactNode;
  kpiRotulo: string;
  onVer: () => void;
  children: React.ReactNode;
}> = ({ origem, nome, kpi, kpiRotulo, onVer, children }) => (
  <section className="ag-glass ag-sheen rounded-[24px] p-5 flex flex-col gap-3">
    <button onClick={onVer} className="flex items-center gap-2.5 min-h-[44px] -my-2 text-left group">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ORIGEM[origem].cor }} />
      <span className="text-[17px] font-semibold text-[var(--ag-text)] flex-1">{nome}</span>
      <span className="flex items-center text-[13px] font-medium text-[var(--ag-text-2)] group-hover:text-[var(--ag-text)]">
        Ver mais <ChevronRight className="w-4 h-4" />
      </span>
    </button>
    <div className="flex items-baseline gap-2">
      <span className="font-display text-[34px] leading-none font-semibold tabular-nums text-[var(--ag-text)]">{kpi}</span>
      <span className="text-[13px] text-[var(--ag-text-2)]">{kpiRotulo}</span>
    </div>
    <div>{children}</div>
  </section>
);

/**
 * Porta "Ferramentas": uma visão de cada agente com um número, as pendências e
 * o caminho para a tela completa. No topo, o próximo passo mais valioso da
 * loja — a mesma conta que a semana do Alfred faz, para as duas portas nunca
 * discordarem sobre o que vem primeiro.
 */
const FerramentasScreen: React.FC<Props> = ({
  uid, products, categories, credits, hasAgente, hasContentAgent, hasMeli, mostrarMissoes, onAbrir, onAbrirView, onPedirAlfred, onAbrirMenu,
}) => {
  const { tema } = useAgentTheme();
  const [acoes, setAcoes] = useState<AgentAction[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);

  useEffect(() => (hasAgente ? listenActions(setAcoes) : undefined), [uid, hasAgente]);
  useEffect(() => {
    let vivo = true;
    fetchIntegrationsOverview().then((l) => { if (vivo) setIntegracoes(l); }).catch(() => {});
    return () => { vivo = false; };
  }, [uid]);

  const providers = useProvidersAlfred(uid, hasAgente);
  const { tarefas, hoje, artigos, meliPropostasAguardando } = useSemana({
    uid, products, acoes, integracoes, hasContentAgent, hasMeli, providers, categories,
  });
  const passo = proximoPasso(tarefas, hoje);

  const produtos = useMemo(() => {
    const pais = products.filter((p) => !String(p['Código do pai'] ?? '').trim());
    return {
      total: pais.length,
      semDescricao: pais.filter((p) => !String(p['Descrição complementar'] ?? '').trim()).length,
      semFoto: pais.filter((p) => semImagem(p as unknown as Record<string, unknown>)).length,
      noErp: pais.filter((p) => p._tinyProductId || p._blingProductId || p._idworksProductId).length,
    };
  }, [products]);

  const conteudo = useMemo(() => {
    const inicio = inicioDaSemana(new Date());
    const daSemana = artigos.filter((a) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(a.scheduledDate);
      return m && diaNaSemana(inicio, new Date(+m[1], +m[2] - 1, +m[3])) !== null;
    });
    return {
      semana: daSemana.length,
      revisao: daSemana.filter((a) => a.status === 'revisao').length,
      publicados: daSemana.filter((a) => a.status === 'publicado').length,
    };
  }, [artigos]);

  const pendentes = acoes.filter((a) => a.status === 'pending').length;

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="ag-aurora flex-1 min-h-0 rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 pt-4 pb-28 md:pb-6">
          <div className="max-w-5xl mx-auto flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={onAbrirMenu}
                title="Menu"
                className="md:hidden w-9 h-9 rounded-full grid place-items-center shrink-0 text-[var(--ag-text-2)]"
                style={{ background: 'var(--ag-fill)' }}
              >
                <Menu className="w-[18px] h-[18px]" />
              </button>
              <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)] flex-1">Ferramentas</h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium text-[var(--ag-text-2)] tabular-nums" style={{ background: 'var(--ag-fill)' }}>
                <Coins className="w-3.5 h-3.5" /> {credits}
              </span>
            </div>

            {passo && (
              <section
                className="rounded-[24px] p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)', boxShadow: 'var(--ag-shadow)' }}
              >
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--ag-accent)' }}>Próximo passo da loja</span>
                  <span className="text-[17px] font-semibold leading-snug">{passo.titulo}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  {hasAgente && passo.prompt && (
                    <button
                      onClick={() => onPedirAlfred(passo.prompt!)}
                      className="flex-1 sm:flex-none min-h-[44px] px-4 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold"
                      style={{ background: 'color-mix(in srgb, var(--ag-bg-2) 16%, transparent)', color: 'var(--ag-bg-2)' }}
                    >
                      <Sparkles className="w-4 h-4" /> Pedir ao Alfred
                    </button>
                  )}
                  <button
                    onClick={() => onAbrir(passo.destino)}
                    className="flex-1 sm:flex-none min-h-[44px] px-5 rounded-full text-[14px] font-semibold"
                    style={{ background: 'var(--ag-bg-2)', color: 'var(--ag-text)' }}
                  >
                    Resolver agora
                  </button>
                </div>
              </section>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <Cartao origem="produto" nome="Produtos" kpi={produtos.total.toLocaleString('pt-BR')} kpiRotulo="produtos no catálogo" onVer={() => onAbrir('produtos')}>
                <Linha primeira rotulo="Sem descrição" valor={produtos.semDescricao} alerta={produtos.semDescricao > 0} />
                <Linha rotulo="Sem foto" valor={produtos.semFoto} alerta={produtos.semFoto > 0} />
                <Linha rotulo="Vinculados a um ERP" valor={produtos.noErp} />
              </Cartao>

              {hasContentAgent && (
                <Cartao origem="conteudo" nome="Conteúdo" kpi={conteudo.semana} kpiRotulo="artigos agendados na semana" onVer={() => onAbrir('conteudo')}>
                  <Linha primeira rotulo="Em revisão" valor={conteudo.revisao} alerta={conteudo.revisao > 0} />
                  <Linha rotulo="Publicados na semana" valor={conteudo.publicados} />
                </Cartao>
              )}

              {hasMeli && (
                <Cartao
                  origem="meli"
                  nome="Mercado Livre"
                  kpi={meliPropostasAguardando ?? '—'}
                  kpiRotulo="propostas de melhoria esperando você"
                  onVer={() => onAbrir('meli')}
                >
                  <Linha
                    primeira
                    rotulo="Otimizador de anúncios"
                    valor={meliPropostasAguardando === null ? 'sem dados' : meliPropostasAguardando ? 'revisar' : 'em dia'}
                    alerta={!!meliPropostasAguardando}
                  />
                </Cartao>
              )}

              <Cartao
                origem="operacoes"
                nome="Operações e integrações"
                kpi={integracoes.filter((i) => i.conectado).length}
                kpiRotulo={`de ${integracoes.length || 4} integrações conectadas`}
                onVer={() => onAbrir('integracoes')}
              >
                {integracoes.map((i, idx) => (
                  <Linha
                    key={i.chave}
                    primeira={idx === 0}
                    rotulo={i.nome}
                    valor={i.erro ? 'sem checagem' : !i.conectado ? 'desconectado' : i.validado ? 'ativo' : 'verificar'}
                    alerta={i.conectado && !i.validado}
                  />
                ))}
                {hasAgente && <Linha rotulo="Aprovações do Alfred" valor={pendentes} alerta={pendentes > 0} />}
              </Cartao>
            </div>

            <section className="ag-glass rounded-[24px] p-2 grid grid-cols-2 sm:grid-cols-4 gap-1">
              {([
                ['categories', 'Categorias'],
                ['history', 'Histórico e créditos'],
                ['company', 'Empresa'],
                ...(mostrarMissoes ? [['missoes', 'Missões']] : []),
              ] as [ViewConta, string][]).map(([view, rotulo]) => (
                <button
                  key={view}
                  onClick={() => onAbrirView(view)}
                  className="min-h-[48px] px-3 rounded-[18px] flex items-center justify-between text-[14px] font-medium text-[var(--ag-text)] hover:bg-[var(--ag-fill)] transition-colors"
                >
                  {rotulo}
                  <ChevronRight className="w-4 h-4 text-[var(--ag-text-3)]" />
                </button>
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FerramentasScreen;
