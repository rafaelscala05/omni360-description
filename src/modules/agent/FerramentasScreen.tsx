import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, Package, PenLine, Sparkles, Store, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { BotaoConta } from '../../components/ContaMenu';
import AlfredLogo from '../../components/alfredLogo/AlfredLogo';

export type ViewConta = 'categories' | 'history' | 'company' | 'missoes' | 'fontes';

interface Props {
  uid: string;
  products: Product[];
  /** O que só o App sabe e a semana usa (categorias, vídeo, missões). */
  extras?: ExtrasSemana;
  hasAgente: boolean;
  hasContentAgent: boolean;
  hasMeli: boolean;
  onAbrir: (destino: DestinoTarefa, tarefa?: TarefaSemana) => void;
  onAbrirView: (view: ViewConta) => void;
  /** Leva ao chat já mandando `prompt` — o Alfred recebe o contexto da tela. */
  onPedirAlfred: (prompt: string) => void;

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

/** Ícone de cada ferramenta — o mesmo no cartão e em qualquer lugar que a nomeie. */
const ICONE: Record<OrigemTarefa, LucideIcon> = {
  produto: Package,
  conteudo: PenLine,
  meli: Store,
  operacoes: Workflow,
};

/**
 * D2: um cartão por ferramenta, em três faixas que não se confundem —
 * cabeçalho (ícone, nome, o que ela faz e se há pendência), corpo (o número
 * principal e as linhas) e pé (o CTA para abrir a ferramenta, sempre no mesmo
 * lugar e com o nome dela).
 */
const Cartao: React.FC<{
  origem: OrigemTarefa;
  nome: string;
  papel: string;
  pendencias: number;
  kpi: React.ReactNode;
  kpiRotulo: string;
  cta: string;
  onVer: () => void;
  children: React.ReactNode;
}> = ({ origem, nome, papel, pendencias, kpi, kpiRotulo, cta, onVer, children }) => {
  const Icone = ICONE[origem];
  const cor = ORIGEM[origem].cor;
  return (
    <section className="ag-glass ag-sheen rounded-[24px] flex flex-col overflow-hidden">
      <header
        className="flex items-center gap-3 px-5 py-4"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${cor} 10%, transparent), transparent 70%)`,
          borderBottom: '1px solid var(--ag-hairline)',
        }}
      >
        <span
          className="w-11 h-11 rounded-[14px] grid place-items-center shrink-0"
          style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${cor} 22%, transparent)` }}
        >
          <Icone className="w-[22px] h-[22px]" strokeWidth={1.9} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[17px] font-semibold leading-tight text-[var(--ag-text)]">{nome}</span>
          <span className="block text-[12.5px] text-[var(--ag-text-2)] truncate">{papel}</span>
        </span>
        {pendencias > 0 ? <Chip tom="alerta">{pendencias} {pendencias === 1 ? 'pendência' : 'pendências'}</Chip> : <Chip tom="ok">em dia</Chip>}
      </header>

      <div className="px-5 pt-4 pb-2 flex flex-col gap-3 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[34px] leading-none font-semibold tabular-nums text-[var(--ag-text)]">{kpi}</span>
          <span className="text-[13px] text-[var(--ag-text-2)]">{kpiRotulo}</span>
        </div>
        <div>{children}</div>
      </div>

      <div className="px-5 pb-5 pt-2">
        <button
          onClick={onVer}
          className="group w-full min-h-[44px] px-4 rounded-full flex items-center justify-between gap-2 text-[14px] font-semibold transition-[filter] hover:brightness-110"
          style={{ background: 'var(--ag-text)', color: 'var(--ag-surface-solid)' }}
        >
          <span className="flex items-center gap-2">
            <Icone className="w-4 h-4 opacity-80" />
            {cta}
          </span>
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </section>
  );
};

/**
 * Próximos passos da loja, em coluna: o primeiro em destaque (o mesmo
 * `proximoPasso` da semana e da barra), os seguintes como linhas.
 */
const ColunaPassos: React.FC<{
  passo: TarefaSemana;
  seguintes: TarefaSemana[];
  podePedir: boolean;
  onAbrir: (destino: DestinoTarefa, tarefa?: TarefaSemana) => void;
  onPedirAlfred: (prompt: string) => void;
}> = ({ passo, seguintes, podePedir, onAbrir, onPedirAlfred }) => (
  <section className="rounded-[24px] overflow-hidden flex flex-col" style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)', boxShadow: 'var(--ag-shadow)' }}>
    <div className="p-5 flex flex-col gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--ag-accent)' }}>Próximos passos da loja</span>
      <span className="flex items-start gap-2">
        <span className="w-2 h-2 mt-2 rounded-full shrink-0" style={{ background: ORIGEM[passo.origem].cor }} aria-hidden />
        <span className="text-[17px] font-semibold leading-snug">{passo.titulo}</span>
      </span>
      <div className="flex flex-col gap-2 pt-1">
        <button
          onClick={() => onAbrir(passo.destino, passo)}
          className="min-h-[42px] px-4 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold"
          style={{ background: 'var(--ag-bg-2)', color: 'var(--ag-text)' }}
        >
          {passo.estado === 'precisa' ? 'Revisar agora' : 'Resolver agora'} <ArrowRight className="w-4 h-4" />
        </button>
        {podePedir && passo.prompt && (
          <button
            onClick={() => onPedirAlfred(passo.prompt!)}
            className="min-h-[42px] px-4 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold"
            style={{ background: 'color-mix(in srgb, var(--ag-bg-2) 14%, transparent)', color: 'var(--ag-bg-2)' }}
          >
            <Sparkles className="w-4 h-4" /> Pedir ao Alfred
          </button>
        )}
      </div>
    </div>
    {seguintes.length > 0 && (
      <div className="px-2 pb-2 flex flex-col">
        <span className="px-3 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: 'color-mix(in srgb, var(--ag-bg-2) 55%, transparent)' }}>Depois</span>
        {seguintes.map((t) => (
          <button
            key={t.id}
            onClick={() => onAbrir(t.destino, t)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-left text-[13.5px] leading-snug transition-colors hover:bg-[color-mix(in_srgb,var(--ag-bg-2)_8%,transparent)]"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--ag-bg-2) 10%, transparent)' }}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ORIGEM[t.origem].cor }} aria-hidden />
            <span className="flex-1 min-w-0">{t.titulo}</span>
            <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
          </button>
        ))}
      </div>
    )}
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

/**
 * Porta "Ferramentas": uma visão de cada agente com um número, as pendências e
 * o caminho para a tela completa. No topo, o próximo passo mais valioso da
 * loja — a mesma conta que a semana do Alfred faz, para as duas portas nunca
 * discordarem sobre o que vem primeiro. No celular é uma lista (F1); a partir
 * de `md`, cartões com números e a coluna "Alfred sugere" (D2).
 */
const FerramentasScreen: React.FC<Props> = ({
  uid, products, extras, hasAgente, hasContentAgent, hasMeli, onAbrir, onAbrirView, onPedirAlfred,
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
  const seguintes = useMemo(
    () => tarefas.filter((t) => t.estado !== 'feita' && t.dia >= hoje && t.id !== passo?.id).slice(0, 4),
    [tarefas, hoje, passo],
  );
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
        className="relative isolate flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {/* Fundo: a esfera do Alfred com o A da marca, grande, desfocada e à
            deriva — presença, não ilustração. Só no desktop (no telefone a
            lista ocupa a tela toda e o canvas custaria bateria). */}
        <div aria-hidden className="hidden md:block pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="ag-deriva absolute -right-[8%] top-[6%]" style={{ filter: 'blur(34px)', opacity: 0.38 }}>
            <AlfredLogo size={560} marca="malha" ativo interativo={false} />
          </div>
        </div>

        <div className="ag-tela-x ag-scroll flex-1 overflow-y-auto pt-4 pb-28 md:pb-8">
          <div className="flex flex-col gap-4 md:gap-5">
            <div className="flex items-center gap-2">
              <BotaoConta />
              <h1 className="font-display text-[28px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)] flex-1">
                <span className="md:hidden">Ferramentas</span>
                <span className="hidden md:inline">Visão geral da loja</span>
              </h1>
            </div>

            {/* No telefone o próximo passo abre a tela; no desktop ele é a coluna da direita. */}
            {passo && (
              <section
                className="md:hidden rounded-[24px] p-5 flex flex-col sm:flex-row sm:items-center gap-4"
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
                  onClick={() => onAbrirView('fontes')}
                />
              </section>

            </div>

            {/* D2 · desktop: cartões + coluna (próximos passos, Alfred sugere) */}
            <div className="hidden md:grid gap-5 items-start grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 grid lg:grid-cols-2 gap-5">
                <Cartao
                  origem="produto" nome="Produtos" papel="Catálogo, descrições e fotos"
                  pendencias={produtos.incompletos}
                  kpi={produtos.incompletos} kpiRotulo={`produtos incompletos de ${produtos.total.toLocaleString('pt-BR')}`}
                  cta="Abrir Produtos" onVer={() => onAbrir('produtos')}
                >
                  <Linha primeira rotulo="Sem descrição" valor={produtos.semDescricao} tom={produtos.semDescricao ? 'alerta' : 'neutro'} />
                  <Linha rotulo="Sem foto" valor={produtos.semFoto} tom={produtos.semFoto ? 'alerta' : 'neutro'} />
                  <Linha rotulo="Sem foto ambientada" valor={produtos.semAmbientada} />
                  <Linha rotulo="Fora do ERP" valor={produtos.foraDoErp} />
                </Cartao>

                {hasContentAgent && (
                  <Cartao
                    origem="conteudo" nome="Conteúdo" papel="Blog, calendário e SEO"
                    pendencias={conteudo.revisao}
                    kpi={conteudo.semana} kpiRotulo="artigos no calendário desta semana"
                    cta="Abrir Conteúdo" onVer={() => onAbrir('conteudo')}
                  >
                    <Linha primeira rotulo="Para aprovar" valor={conteudo.revisao} tom={conteudo.revisao ? 'alerta' : 'neutro'} />
                    <Linha rotulo="Achados da auditoria SEO" valor={achadosSeo.length} />
                    <Linha rotulo="Publicados no mês" valor={conteudo.publicadosMes} tom={conteudo.publicadosMes ? 'ok' : 'neutro'} />
                  </Cartao>
                )}

                {hasMeli && (
                  <Cartao
                    origem="meli" nome="Mercado Livre" papel="Otimização de anúncios"
                    pendencias={meliPropostasAguardando ?? 0}
                    kpi={meliPropostasAguardando ?? '—'} kpiRotulo="propostas de otimização"
                    cta="Abrir Mercado Livre" onVer={() => onAbrir('meli')}
                  >
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
                  origem="operacoes" nome="Operações" papel="Loja, ERP e integrações"
                  pendencias={alertas + pendentes}
                  kpi={tiny ? n(numeros?.pedidosAbertos, numeros?.pedidosAbertosMais) : ativas}
                  kpiRotulo={tiny ? 'pedidos em aberto no Tiny' : `de ${integracoes.length || 4} integrações conectadas`}
                  cta="Abrir Operações" onVer={() => onAbrirView('fontes')}
                >
                  {integracoes.some((i) => i.chave === 'wake' && i.conectado) && (
                    <Linha primeira rotulo="Banners ativos na Wake" valor={n(numeros?.bannersAtivos)} />
                  )}
                  <Linha primeira={!integracoes.some((i) => i.chave === 'wake' && i.conectado)} rotulo="Integrações com alerta" valor={alertas} tom={alertas ? 'alerta' : 'neutro'} />
                  {hasAgente && <Linha rotulo="Aprovações do Alfred" valor={pendentes} tom={pendentes ? 'alerta' : 'neutro'} />}
                </Cartao>
              </div>

              <aside className="min-w-0 flex flex-col gap-4">
                {passo && (
                  <ColunaPassos passo={passo} seguintes={seguintes} podePedir={hasAgente} onAbrir={onAbrir} onPedirAlfred={onPedirAlfred} />
                )}
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

              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FerramentasScreen;
