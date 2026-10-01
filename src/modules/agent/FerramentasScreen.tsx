import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Coins, Sparkles } from 'lucide-react';
import type { Product } from '../../types/models';
import type { ExtrasSemana } from './useSemana';
import type { AgentAction } from '../../types/agent';
import { fetchNumerosLoja, listenActions } from '../../services/agentChatService';
import { fetchIntegrationsOverview, type IntegrationSummary } from '../../services/integrationsStatusService';
import { useAgentTheme } from './theme';
import { useAchadosSeo, useProvidersAlfred, useSemana } from './useSemana';
import { proximoPasso, type DestinoTarefa, type OrigemTarefa, type TarefaSemana } from './semana';
import { ORIGEM } from './SemanaPanel';
import { resumoConteudo, resumoProdutos, sugestoesAlfred } from './painelFerramentas';

export type ViewConta = 'categories' | 'history' | 'company' | 'missoes' | 'conectores';

interface Props {
  uid: string;
  products: Product[];
  /** O que só o App sabe e a semana usa (categorias, vídeo, missões). */
  extras?: ExtrasSemana;
  credits: number;
  /** Inicial do nome — o avatar da Conta no topo (F1/D2). */
  inicial?: string;
  hasAgente: boolean;
  hasContentAgent: boolean;
  hasMeli: boolean;
  /** Missões só existem para a coorte que tem a trilha de onboarding. */
  mostrarMissoes: boolean;
  onAbrir: (destino: DestinoTarefa, tarefa?: TarefaSemana) => void;
  onAbrirView: (view: ViewConta) => void;
  /** Leva ao chat já mandando `prompt` — o Alfred recebe o contexto da tela. */
  onPedirAlfred: (prompt: string) => void;
  /** O avatar da Conta abre o menu (Missões, Empresa, Créditos, Indique…). */
  onAbrirMenu: () => void;
}

type Numeros = Awaited<ReturnType<typeof fetchNumerosLoja>>;

const n = (v: number | null | undefined, mais?: boolean) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR')}${mais ? '+' : ''}`);

const Chip: React.FC<{ tom: 'alerta' | 'ok' | 'neutro'; children: React.ReactNode }> = ({ tom, children }) => (
  <span
    className="shrink-0 tabular-nums font-semibold px-2.5 py-0.5 rounded-full text-[12.5px]"
    style={tom === 'alerta'
      ? { background: 'var(--ag-accent-soft)', color: 'var(--ag-accent)' }
      : tom === 'ok' ? { background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' } : { background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}
  >
    {children}
  </span>
);

const Linha: React.FC<{ rotulo: string; valor: React.ReactNode; tom?: 'alerta' | 'ok' | 'neutro'; primeira?: boolean }> = ({ rotulo, valor, tom = 'neutro', primeira }) => (
  <div className="flex items-center justify-between gap-3 py-2 text-[14px]" style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}>
    <span className="text-[var(--ag-text-2)]">{rotulo}</span>
    <Chip tom={tom}>{valor}</Chip>
  </div>
);

/** D2: um cartão por agente — número principal e as pendências dele. */
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
        Ver agente <ChevronRight className="w-4 h-4" />
      </span>
    </button>
    <div className="flex items-baseline gap-2">
      <span className="font-display text-[34px] leading-none font-semibold tabular-nums text-[var(--ag-text)]">{kpi}</span>
      <span className="text-[13px] text-[var(--ag-text-2)]">{kpiRotulo}</span>
    </div>
    <div>{children}</div>
  </section>
);

/** F1: no celular, um agente por linha com o chip do que está pendente. */
const LinhaAgente: React.FC<{
  origem: OrigemTarefa;
  nome: string;
  sub: string;
  pendente: number;
  primeira?: boolean;
  onClick: () => void;
}> = ({ origem, nome, sub, pendente, primeira, onClick }) => (
  <button onClick={onClick} className="w-full flex items-center gap-3 p-3.5 min-h-[56px] text-left" style={primeira ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}>
    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ORIGEM[origem].cor }} />
    <span className="flex-1 min-w-0">
      <span className="block text-[15px] font-semibold text-[var(--ag-text)]">{nome}</span>
      <span className="block text-[13px] text-[var(--ag-text-2)] truncate">{sub}</span>
    </span>
    {pendente > 0 ? <Chip tom="alerta">{pendente}</Chip> : <Chip tom="ok">em dia</Chip>}
    <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
  </button>
);

const Bloco: React.FC<{ titulo: string; detalhe: string; onClick: () => void }> = ({ titulo, detalhe, onClick }) => (
  <button onClick={onClick} className="ag-glass rounded-[14px] p-3 text-left">
    <span className="block text-[14px] font-semibold text-[var(--ag-text)]">{titulo}</span>
    <span className="block text-[12px] text-[var(--ag-text-2)]">{detalhe}</span>
  </button>
);

/**
 * Porta "Ferramentas": uma visão de cada agente com um número, as pendências e
 * o caminho para a tela completa. No topo, o próximo passo mais valioso da
 * loja — a mesma conta que a semana do Alfred faz, para as duas portas nunca
 * discordarem sobre o que vem primeiro. No celular é uma lista (F1); a partir
 * de `md`, cartões com números e a coluna "Alfred sugere" (D2).
 */
const FerramentasScreen: React.FC<Props> = ({
  uid, products, extras, credits, inicial, hasAgente, hasContentAgent, hasMeli, mostrarMissoes, onAbrir, onAbrirView, onPedirAlfred, onAbrirMenu,
}) => {
  const { tema } = useAgentTheme();
  const [acoes, setAcoes] = useState<AgentAction[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegrationSummary[]>([]);
  const [numeros, setNumeros] = useState<Numeros | null>(null);

  useEffect(() => (hasAgente ? listenActions(setAcoes) : undefined), [uid, hasAgente]);
  useEffect(() => {
    let vivo = true;
    fetchIntegrationsOverview().then((l) => { if (vivo) setIntegracoes(l); }).catch(() => {});
    if (hasAgente) fetchNumerosLoja().then((r) => { if (vivo) setNumeros(r); }).catch(() => {});
    return () => { vivo = false; };
  }, [uid, hasAgente]);

  const providers = useProvidersAlfred(uid, hasAgente);
  const { tarefas, hoje, artigos, meliPropostasAguardando } = useSemana({
    uid, products, acoes, integracoes, hasContentAgent, hasMeli, providers, extras,
  });
  const achadosSeo = useAchadosSeo(uid, hasContentAgent);
  const passo = proximoPasso(tarefas, hoje);
  const sugestoes = useMemo(() => (hasAgente ? sugestoesAlfred(tarefas, passo) : []), [hasAgente, tarefas, passo]);

  const produtos = useMemo(() => resumoProdutos(products), [products]);
  const conteudo = useMemo(() => resumoConteudo(artigos), [artigos]);

  const pendentes = acoes.filter((a) => a.status === 'pending').length;
  const ativas = integracoes.filter((i) => i.conectado && !i.erro).length;
  const alertas = integracoes.filter((i) => i.erro || (i.conectado && !i.validado)).length;
  const tiny = integracoes.find((i) => i.chave === 'tiny')?.conectado;
  const opsSub = tiny && numeros?.pedidosAbertos != null
    ? `${n(numeros.pedidosAbertos, numeros.pedidosAbertosMais)} pedidos em aberto no Tiny`
    : `${ativas} ${ativas === 1 ? 'integração ativa' : 'integrações ativas'}`;

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="ag-aurora flex-1 min-h-0 rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 pt-4 pb-28 md:pb-6">
          <div className="max-w-6xl mx-auto flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[28px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)] flex-1">
                <span className="md:hidden">Ferramentas</span>
                <span className="hidden md:inline">Visão geral da loja</span>
              </h1>
              <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium text-[var(--ag-text-2)] tabular-nums" style={{ background: 'var(--ag-fill)' }}>
                <Coins className="w-3.5 h-3.5" /> {credits}
              </span>
              {/* F1: a Conta sai do Menu e vira o avatar no cabeçalho. */}
              <button
                onClick={onAbrirMenu}
                aria-label="Conta"
                className="md:hidden w-11 h-11 rounded-full grid place-items-center text-[15px] font-semibold text-[var(--ag-text)] shrink-0"
                style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline-2)' }}
              >
                {(inicial || 'C').slice(0, 1).toUpperCase()}
              </button>
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
                    onClick={() => onAbrir(passo.destino, passo)}
                    className="flex-1 sm:flex-none min-h-[44px] px-5 rounded-full text-[14px] font-semibold"
                    style={{ background: 'var(--ag-bg-2)', color: 'var(--ag-text)' }}
                  >
                    Resolver agora
                  </button>
                </div>
              </section>
            )}

            {/* F1 · celular: lista */}
            <div className="md:hidden flex flex-col gap-3">
              <section className="ag-glass rounded-[22px]">
                <LinhaAgente
                  primeira
                  origem="produto"
                  nome="Produtos"
                  sub={`${produtos.total.toLocaleString('pt-BR')} no catálogo · ${produtos.incompletos} incompletos`}
                  pendente={produtos.incompletos}
                  onClick={() => onAbrir('produtos')}
                />
                {hasContentAgent && (
                  <LinhaAgente
                    origem="conteudo"
                    nome="Conteúdo"
                    sub={`${conteudo.semana} ${conteudo.semana === 1 ? 'artigo' : 'artigos'} na semana · ${conteudo.revisao} para aprovar`}
                    pendente={conteudo.revisao}
                    onClick={() => onAbrir('conteudo')}
                  />
                )}
                {hasMeli && (
                  <LinhaAgente
                    origem="meli"
                    nome="Mercado Livre"
                    sub={meliPropostasAguardando === null ? 'Otimizador de anúncios' : `${meliPropostasAguardando} propostas de otimização`}
                    pendente={meliPropostasAguardando ?? 0}
                    onClick={() => onAbrir('meli')}
                  />
                )}
                <LinhaAgente
                  origem="operacoes"
                  nome="Operações"
                  sub={opsSub}
                  pendente={alertas + pendentes}
                  onClick={() => onAbrirView('conectores')}
                />
              </section>

              <h2 className="px-1 pt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ag-text-2)]">Conta</h2>
              <div className="grid grid-cols-2 gap-2">
                <Bloco titulo="Créditos" detalhe={`${credits.toLocaleString('pt-BR')} disponíveis`} onClick={() => onAbrirView('history')} />
                <Bloco titulo="Integrações" detalhe={`${ativas} ${ativas === 1 ? 'ativa' : 'ativas'}${alertas ? ` · ${alertas} ${alertas === 1 ? 'alerta' : 'alertas'}` : ''}`} onClick={() => onAbrirView('conectores')} />
                <Bloco titulo="Categorias" detalhe="Árvore e atributos" onClick={() => onAbrirView('categories')} />
                {mostrarMissoes && extras?.missoesResumo
                  ? <Bloco titulo="Missões" detalhe={`${extras.missoesResumo.feitas} de ${extras.missoesResumo.total}`} onClick={() => onAbrirView('missoes')} />
                  : <Bloco titulo="Empresa" detalhe="Dados para nota" onClick={() => onAbrirView('company')} />}
              </div>
            </div>

            {/* D2 · desktop: cartões + Alfred sugere */}
            <div className="hidden md:flex gap-4 items-start">
              <div className="flex-1 min-w-0 grid lg:grid-cols-2 gap-4">
                <Cartao origem="produto" nome="Produtos" kpi={produtos.incompletos} kpiRotulo={`produtos incompletos de ${produtos.total.toLocaleString('pt-BR')}`} onVer={() => onAbrir('produtos')}>
                  <Linha primeira rotulo="Sem descrição" valor={produtos.semDescricao} tom={produtos.semDescricao ? 'alerta' : 'neutro'} />
                  <Linha rotulo="Sem foto" valor={produtos.semFoto} tom={produtos.semFoto ? 'alerta' : 'neutro'} />
                  <Linha rotulo="Sem foto ambientada" valor={produtos.semAmbientada} />
                  <Linha rotulo="Fora do ERP" valor={produtos.foraDoErp} />
                </Cartao>

                {hasContentAgent && (
                  <Cartao origem="conteudo" nome="Conteúdo" kpi={conteudo.semana} kpiRotulo="artigos no calendário desta semana" onVer={() => onAbrir('conteudo')}>
                    <Linha primeira rotulo="Para aprovar" valor={conteudo.revisao} tom={conteudo.revisao ? 'alerta' : 'neutro'} />
                    <Linha rotulo="Achados da auditoria SEO" valor={achadosSeo.length} />
                    <Linha rotulo="Publicados no mês" valor={conteudo.publicadosMes} tom={conteudo.publicadosMes ? 'ok' : 'neutro'} />
                  </Cartao>
                )}

                {hasMeli && (
                  <Cartao origem="meli" nome="Mercado Livre" kpi={meliPropostasAguardando ?? '—'} kpiRotulo="propostas de otimização" onVer={() => onAbrir('meli')}>
                    <Linha
                      primeira
                      rotulo="Para revisar"
                      valor={meliPropostasAguardando === null ? 'sem dados' : meliPropostasAguardando || 'em dia'}
                      tom={meliPropostasAguardando ? 'alerta' : 'neutro'}
                    />
                    <Linha rotulo="Anúncios ativos sem vídeo" valor={n(numeros?.meliSemVideo)} />
                  </Cartao>
                )}

                <Cartao
                  origem="operacoes"
                  nome="Operações"
                  kpi={tiny ? n(numeros?.pedidosAbertos, numeros?.pedidosAbertosMais) : ativas}
                  kpiRotulo={tiny ? 'pedidos em aberto no Tiny' : `de ${integracoes.length || 4} integrações conectadas`}
                  onVer={() => onAbrirView('conectores')}
                >
                  {integracoes.some((i) => i.chave === 'wake' && i.conectado) && (
                    <Linha primeira rotulo="Banners ativos na Wake" valor={n(numeros?.bannersAtivos)} />
                  )}
                  <Linha primeira={!integracoes.some((i) => i.chave === 'wake' && i.conectado)} rotulo="Integrações com alerta" valor={alertas} tom={alertas ? 'alerta' : 'neutro'} />
                  {hasAgente && <Linha rotulo="Aprovações do Alfred" valor={pendentes} tom={pendentes ? 'alerta' : 'neutro'} />}
                </Cartao>
              </div>

              <aside className="w-[300px] shrink-0 flex flex-col gap-3">
                {sugestoes.length > 0 && (
                  <section className="ag-glass rounded-[24px] p-4 flex flex-col gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-full shrink-0" style={{ background: 'var(--ag-accent)', boxShadow: 'inset 0 0 0 4px color-mix(in srgb, var(--ag-accent) 45%, var(--ag-bg-2))' }} />
                      <span className="text-[15px] font-semibold text-[var(--ag-text)]">Alfred sugere</span>
                    </div>
                    {sugestoes.map((s) => (
                      <button
                        key={s.prompt}
                        onClick={() => onPedirAlfred(s.prompt)}
                        className="text-left p-3 rounded-[12px] text-[14px] leading-snug text-[var(--ag-text)] transition-colors hover:brightness-95"
                        style={{ background: 'var(--ag-fill)' }}
                      >
                        {s.titulo}
                      </button>
                    ))}
                  </section>
                )}

                <section className="ag-glass rounded-[24px] p-4 flex flex-col">
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ag-text-2)] pb-1">Conta</span>
                  {([
                    ['history', 'Créditos', credits.toLocaleString('pt-BR')],
                    ...(mostrarMissoes && extras?.missoesResumo ? [['missoes', 'Missões', `${extras.missoesResumo.feitas} de ${extras.missoesResumo.total}`]] : []),
                    ['conectores', 'Integrações', `${ativas} ativas${alertas ? ` · ${alertas} alerta` : ''}`],
                    ['categories', 'Categorias', ''],
                    ['company', 'Empresa', ''],
                  ] as [ViewConta, string, string][]).map(([view, rotulo, valor], i) => (
                    <button
                      key={view}
                      onClick={() => onAbrirView(view)}
                      className="flex items-center justify-between gap-2 py-2.5 text-[14px] text-left"
                      style={i ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}
                    >
                      <span className="text-[var(--ag-text)]">{rotulo}</span>
                      <span className="flex items-center gap-1 text-[var(--ag-text-2)] tabular-nums">{valor}<ChevronRight className="w-4 h-4 text-[var(--ag-text-3)]" /></span>
                    </button>
                  ))}
                </section>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FerramentasScreen;
