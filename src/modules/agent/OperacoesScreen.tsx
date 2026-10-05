import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
import type { Product } from '../../types/models';
import { fetchPainelOps } from '../../services/agentChatService';
import { useAgentTheme } from './theme';
import Migalhas from './Migalhas';
import { Aviso, BotaoAlfred, LinhaItem, Secao, Tile, brl, int } from './ops/pecas';
import { NOME_PLATAFORMA, PAPEL } from './ops/papeis';
import SecaoEntrega from './ops/SecaoEntrega';
import { SecaoCatalogo, SecaoPrecos } from './ops/SecaoCatalogo';
import { ORDEM_FUNIL, ROTULO_SITUACAO } from './ops/pedidos';
import {
  COBERTURA_CURTA_DIAS, painelEstoque, variacao,
  type ChavePeriodo, type ItemEstoque, type PainelPedidos, type RespostaPainelOps,
} from './ops/indicadores';

interface Props {
  products: Product[];
  onVoltar: () => void;
  onAbrirFontes: () => void;
  /** Leva ao chat já mandando o pedido. */
  onPedirAlfred: (texto: string) => void;
}

const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const ROTULO_PERIODO: Record<ChavePeriodo, string> = { hoje: 'Hoje', d7: '7 dias', d30: '30 dias' };
const ROTULO_ANTERIOR: Record<ChavePeriodo, string> = { hoje: 'ontem', d7: '7 dias anteriores', d30: '30 dias anteriores' };

function haQuanto(ms: number | null): string {
  if (!ms) return 'ainda não atualizado';
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'atualizado agora';
  if (min < 60) return `atualizado há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `atualizado há ${h} h` : `atualizado há ${Math.round(h / 24)} d`;
}

// --- Peças ------------------------------------------------------------------

const Delta: React.FC<{ atual: number; anterior: number; rotulo: string }> = ({ atual, anterior, rotulo }) => {
  const v = variacao(atual, anterior);
  if (v === null) return <span className="text-[12px] text-[var(--ag-text-3)]">sem base em {rotulo}</span>;
  const sobe = v >= 0;
  const Icone = sobe ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="text-[12px] text-[var(--ag-text-2)] flex items-center gap-0.5">
      <Icone className="w-3.5 h-3.5" style={{ color: sobe ? 'var(--ag-ok)' : 'var(--ag-danger)' }} aria-hidden />
      <span className="tabular-nums font-semibold" style={{ color: sobe ? 'var(--ag-ok)' : 'var(--ag-danger)' }}>
        {sobe ? '+' : ''}{Math.round(v * 100)}%
      </span>
      <span className="truncate">vs {rotulo}</span>
    </span>
  );
};

/** Receita diária de 30 dias: uma série só, então uma cor só e sem legenda. */
const BarrasDiarias: React.FC<{ serie: PainelPedidos['serie'] }> = ({ serie }) => {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...serie.map((d) => d.receita));
  const ativo = foco !== null ? serie[foco] : null;
  return (
    <div className="ag-glass rounded-[18px] px-4 pt-3 pb-2.5">
      <div className="flex items-baseline justify-between gap-2 min-h-[20px]">
        <span className="text-[12.5px] font-medium text-[var(--ag-text-2)]">Receita por dia · 30 dias</span>
        <span className="text-[12.5px] tabular-nums text-[var(--ag-text)]" aria-live="polite">
          {ativo ? <>{diaCurto(ativo.dia)} · <b>{brl(ativo.receita)}</b> · {int(ativo.pedidos)} {ativo.pedidos === 1 ? 'pedido' : 'pedidos'}</> : <span className="text-[var(--ag-text-3)]">máx. {brl(max, true)}</span>}
        </span>
      </div>
      <div className="mt-2 h-28 flex items-end gap-[2px]" onMouseLeave={() => setFoco(null)} role="list" aria-label="Receita por dia">
        {serie.map((d, i) => (
          <div
            key={d.dia}
            role="listitem"
            aria-label={`${diaCurto(d.dia)}: ${brl(d.receita)}, ${d.pedidos} pedidos`}
            className="flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setFoco(i)}
            onClick={() => setFoco(i)}
          >
            <div
              className="w-full rounded-t-[4px] transition-opacity"
              style={{
                height: d.receita > 0 ? `${Math.max(3, (d.receita / max) * 100)}%` : '2px',
                background: d.receita > 0 ? 'var(--ag-orig-operacoes)' : 'var(--ag-hairline-2)',
                opacity: foco === null || foco === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[var(--ag-text-3)]" style={{ borderTop: '1px solid var(--ag-hairline)', paddingTop: 4 }}>
        <span>{diaCurto(serie[0]?.dia ?? '')}</span>
        <span>{diaCurto(serie[14]?.dia ?? '')}</span>
        <span>hoje</span>
      </div>
    </div>
  );
};

const Canais: React.FC<{ canais: PainelPedidos['canais']; detalhados: number }> = ({ canais, detalhados }) => {
  const total = canais.reduce((s, c) => s + c.receita, 0) || 1;
  return (
    <div className="ag-glass rounded-[18px] px-4 py-3">
      <div className="text-[12.5px] font-medium text-[var(--ag-text-2)]">Por canal · 30 dias</div>
      {canais.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--ag-text-3)]">{detalhados < 1 ? 'Calculando — os canais chegam com o detalhe de cada pedido.' : 'Sem vendas no período.'}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {canais.slice(0, 6).map((c) => (
            <li key={c.nome} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate text-[var(--ag-text)]">{c.nome}</span>
                <span className="shrink-0 tabular-nums text-[var(--ag-text-2)]">{brl(c.receita, true)} · {Math.round((c.receita / total) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--ag-fill)' }}>
                <div className="h-full rounded-full" style={{ width: `${(c.receita / total) * 100}%`, background: 'var(--ag-orig-operacoes)' }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {detalhados < 1 && canais.length > 0 && (
        <p className="mt-2 text-[11.5px] text-[var(--ag-text-3)]">Com base em {Math.round(detalhados * 100)}% dos pedidos — o resto ainda está sendo detalhado.</p>
      )}
    </div>
  );
};

// --- Tela -------------------------------------------------------------------

/**
 * Centro de Operações (`mainView === 'operacoes'`): vendas, funil do pedido e
 * estoque, lidos de uma fonte por domínio (ops/papeis.ts). Vendas e funil
 * vêm prontos do servidor (sync de pedidos); o estoque sai do catálogo.
 */
const OperacoesScreen: React.FC<Props> = ({ products, onVoltar, onAbrirFontes, onPedirAlfred }) => {
  const { tema } = useAgentTheme();
  const [dados, setDados] = useState<RespostaPainelOps | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [periodo, setPeriodo] = useState<ChavePeriodo>('d7');
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    fetchPainelOps(recarga > 0)
      .then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [recarga]);

  // Enquanto o histórico (pedidos ou catálogo da loja) está chegando, o painel se atualiza sozinho.
  const importando = dados?.sync?.estado === 'importando' || dados?.loja?.estado === 'importando';
  useEffect(() => {
    if (!importando) return;
    const t = setInterval(() => {
      fetchPainelOps().then(setDados).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [importando]);

  const pedidos = dados?.pedidos ?? null;
  const estoque = useMemo(() => painelEstoque(products, pedidos?.vendidos30d ?? {}), [products, pedidos]);
  const fontes = dados?.fontes;
  const nomePedidos = fontes?.pedidos ? NOME_PLATAFORMA[fontes.pedidos] : null;
  const nomeEstoque = fontes?.estoque ? NOME_PLATAFORMA[fontes.estoque] : null;
  const nomeErp = fontes?.pedidos && PAPEL[fontes.pedidos] === 'erp' ? NOME_PLATAFORMA[fontes.pedidos] : null;
  const loja = dados?.loja ?? null;
  const lendoLoja = loja?.estado === 'importando'
    ? `Lendo o catálogo da loja · ${int(loja.lidos)} variantes até agora`
    : loja?.estado === 'credencial' ? 'A conexão com a Wake precisa de atenção — o catálogo parou de atualizar.'
      : null;

  const subtitulo = !fontes ? '' : [
    nomePedidos && `Pedidos do ${nomePedidos}`,
    nomeEstoque && `estoque do ${nomeEstoque}`,
    fontes.catalogoLoja && `loja ${NOME_PLATAFORMA[fontes.catalogoLoja]}`,
  ].filter(Boolean).join(' · ');

  const p = pedidos?.periodos[periodo];

  const pedirParados = () => {
    if (!pedidos) return;
    const lista = pedidos.parados.slice(0, 5).map((x) => `#${x.numero} (${ROTULO_SITUACAO[x.situacao].toLowerCase()} há ${x.dias} dias)`).join(', ');
    onPedirAlfred(`Tenho ${pedidos.totalParados} pedidos parados no ${nomePedidos}. Os mais antigos: ${lista}. Verifique a situação de cada um e proponha o próximo passo.`);
  };
  const itensEstoque: ItemEstoque[] = [...estoque.esgotadosQueVendiam, ...estoque.coberturaCurta, ...estoque.abaixoMinimo]
    .filter((x, i, a) => a.findIndex((y) => y.sku === x.sku) === i);
  const pedirEstoque = () => {
    const lista = itensEstoque.slice(0, 8).map((x) => `${x.sku} (saldo ${int(x.estoque)}, vendeu ${int(x.vendidos30)} em 30 dias)`).join('; ');
    onPedirAlfred(`Estes produtos estão esgotados ou acabando: ${lista}. Confira o estoque no ${nomeEstoque ?? 'ERP'} e me ajude a priorizar a reposição.`);
  };
  const pedirVendas = () => onPedirAlfred(
    'Analise minhas vendas no Centro de Operações (hoje, 7 e 30 dias, por canal) e me diga o que mudou em relação ao período anterior e onde devo prestar atenção.',
  );

  const sync = dados?.sync;
  const statusSync = !sync ? null
    : sync.estado === 'importando' ? `importando histórico · ${Math.round(sync.progresso * 100)}%`
      : sync.estado === 'em-dia' ? haQuanto(sync.atualizadoEm)
        : sync.estado === 'erro' ? 'falha ao atualizar — tentando de novo' : null;

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div className="ag-tela-x ag-scroll flex-1 overflow-y-auto pt-1 pb-28 md:pb-6">
        <Migalhas itens={[{ rotulo: 'Ferramentas', onClick: onVoltar }, { rotulo: 'Operações' }]} />
        <div className="max-w-5xl flex flex-col gap-6 mt-2">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Centro de Operações</h1>
              <p className="mt-1 text-[14px] text-[var(--ag-text-2)]">
                {subtitulo || 'Vendas, pedidos e estoque da loja num lugar só.'}
                {statusSync && <span className="text-[var(--ag-text-3)]"> · {statusSync}</span>}
              </p>
            </div>
            <button
              onClick={() => setRecarga((n) => n + 1)}
              disabled={carregando}
              title="Atualizar agora"
              className="w-9 h-9 shrink-0 rounded-full grid place-items-center text-[var(--ag-text-2)] disabled:opacity-60"
              style={{ background: 'var(--ag-fill)' }}
            >
              <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {erro && !dados && <Aviso tom="warn" titulo="Não deu para carregar o painel" texto={erro} acao={{ rotulo: 'Tentar de novo', onClick: () => setRecarga((n) => n + 1) }} />}

          {carregando && !dados && !erro && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="ag-shimmer h-24 rounded-[18px]" />)}
            </div>
          )}

          {dados && !fontes?.pedidos && (
            <Aviso
              titulo="Conecte um ERP ou a loja"
              texto="O Centro de Operações lê pedidos e estoque do ERP (Tiny) ou, sem ERP, da loja Wake."
              acao={{ rotulo: 'Conectar', onClick: onAbrirFontes }}
            />
          )}
          {dados && fontes?.pedidos && !dados.pedidosSuportados && (
            <Aviso
              titulo={`Pedidos do ${nomePedidos} ainda não chegam aqui`}
              texto={`Por enquanto o Centro de Operações lê pedidos do Tiny. O estoque abaixo já vem do catálogo importado do ${nomePedidos}.`}
            />
          )}
          {sync?.estado === 'credencial' && (
            <Aviso tom="warn" titulo={`A conexão com o ${nomePedidos} precisa de atenção`} texto="Os pedidos pararam de atualizar porque a credencial foi recusada." acao={{ rotulo: 'Verificar', onClick: onAbrirFontes }} />
          )}

          {/* Vendas */}
          {pedidos && p && (
            <Secao
              titulo="Vendas"
              nota="Cancelados não entram na receita."
              acao={<BotaoAlfred onClick={pedirVendas}>Analisar</BotaoAlfred>}
            >
              <div role="tablist" aria-label="Período" className="self-start flex p-0.5 rounded-full" style={{ background: 'var(--ag-fill)' }}>
                {(Object.keys(ROTULO_PERIODO) as ChavePeriodo[]).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={periodo === k}
                    onClick={() => setPeriodo(k)}
                    className="min-h-[32px] px-3.5 rounded-full text-[13px] font-semibold transition-colors"
                    style={periodo === k ? { background: 'var(--ag-raised)', color: 'var(--ag-text)', boxShadow: 'var(--ag-shadow-sm)' } : { color: 'var(--ag-text-2)' }}
                  >
                    {ROTULO_PERIODO[k]}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Tile rotulo="Receita" valor={brl(p.receita, true)}><Delta atual={p.receita} anterior={p.anterior.receita} rotulo={ROTULO_ANTERIOR[periodo]} /></Tile>
                <Tile rotulo="Pedidos" valor={int(p.pedidos)}><Delta atual={p.pedidos} anterior={p.anterior.pedidos} rotulo={ROTULO_ANTERIOR[periodo]} /></Tile>
                <Tile rotulo="Ticket médio" valor={p.pedidos ? brl(p.ticket) : '—'}><Delta atual={p.ticket} anterior={p.anterior.ticket} rotulo={ROTULO_ANTERIOR[periodo]} /></Tile>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                <BarrasDiarias serie={pedidos.serie} />
                <Canais canais={pedidos.canais} detalhados={pedidos.detalhados} />
              </div>
            </Secao>
          )}

          {/* Funil do pedido */}
          {pedidos && (
            <Secao
              titulo="Funil do pedido"
              nota="Situação atual dos pedidos dos últimos 30 dias."
              acao={pedidos.totalParados > 0 ? <BotaoAlfred onClick={pedirParados}>Resolver parados</BotaoAlfred> : undefined}
            >
              <div className="ag-glass rounded-[18px] grid grid-cols-3 sm:grid-cols-6 overflow-hidden">
                {[...ORDEM_FUNIL, 'cancelado' as const].map((s, i) => (
                  <div
                    key={s}
                    className="px-3 py-3 flex flex-col gap-0.5 min-w-0"
                    style={i === 0 ? undefined : { borderLeft: '1px solid var(--ag-hairline)' }}
                  >
                    <span className="text-[12px] text-[var(--ag-text-2)] truncate">{ROTULO_SITUACAO[s]}</span>
                    <span className="text-[20px] font-semibold tabular-nums" style={{ color: s === 'cancelado' ? 'var(--ag-text-3)' : 'var(--ag-text)' }}>{int(pedidos.funil[s])}</span>
                  </div>
                ))}
              </div>
              {pedidos.totalParados > 0 ? (
                <div className="ag-glass rounded-[18px] overflow-hidden">
                  <div className="px-4 pt-3 pb-1 text-[12.5px] font-medium flex items-center gap-1" style={{ color: 'var(--ag-warn)' }}>
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                    {int(pedidos.totalParados)} {pedidos.totalParados === 1 ? 'pedido parado' : 'pedidos parados'} · em aberto ou aprovado há mais de 2 dias, faturado há mais de 3
                  </div>
                  <ul>
                    {pedidos.parados.slice(0, 5).map((x, i) => (
                      <LinhaItem key={x.idExterno} primeira={i === 0} titulo={`Pedido #${x.numero}`} sub={`${ROTULO_SITUACAO[x.situacao]} · ${brl(x.valor)}`} valor={`${x.dias} dias`} tom="warn" />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="px-1 text-[13px] text-[var(--ag-text-3)]">Nenhum pedido parado.</p>
              )}
            </Secao>
          )}

          {dados?.entrega && pedidos && (
            <SecaoEntrega entrega={dados.entrega} nomeFonte={nomePedidos ?? 'ERP'} onPedirAlfred={onPedirAlfred} />
          )}

          {/* Estoque */}
          {fontes?.estoque && (
            <Secao
              titulo="Estoque"
              nota={`Do catálogo importado do ${nomeEstoque}. Cobertura = saldo ÷ ritmo de venda dos últimos 30 dias.`}
              acao={itensEstoque.length > 0 ? <BotaoAlfred onClick={pedirEstoque}>Priorizar reposição</BotaoAlfred> : undefined}
            >
              {estoque.avaliados === 0 ? (
                <Aviso
                  titulo="O estoque ainda não chegou"
                  texto={`Nenhum produto do catálogo tem saldo informado. Importe os produtos do ${nomeEstoque} para o estoque aparecer aqui.`}
                  acao={{ rotulo: 'Fontes', onClick: onAbrirFontes }}
                />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Tile rotulo="Esgotados que vendiam" valor={int(estoque.esgotadosQueVendiam.length)} alerta={estoque.esgotadosQueVendiam.length > 0}>
                      <span className="text-[12px] text-[var(--ag-text-3)]">{int(estoque.esgotados)} esgotados no total</span>
                    </Tile>
                    <Tile rotulo={`Acabam em menos de ${COBERTURA_CURTA_DIAS} dias`} valor={pedidos && pedidos.detalhados < 0.5 ? '—' : int(estoque.coberturaCurta.length)} alerta={estoque.coberturaCurta.length > 0}>
                      <span className="text-[12px] text-[var(--ag-text-3)]">
                        {pedidos && pedidos.detalhados < 0.5 ? 'calculando o ritmo de venda' : 'no ritmo de venda atual'}
                      </span>
                    </Tile>
                    <Tile rotulo="Abaixo do mínimo" valor={int(estoque.abaixoMinimo.length)} alerta={estoque.abaixoMinimo.length > 0}>
                      <span className="text-[12px] text-[var(--ag-text-3)]">{int(estoque.avaliados)} itens com saldo informado</span>
                    </Tile>
                  </div>
                  {itensEstoque.length > 0 && (
                    <div className="ag-glass rounded-[18px] overflow-hidden">
                      <ul>
                        {itensEstoque.slice(0, 6).map((x, i) => (
                          <LinhaItem
                            key={x.sku}
                            primeira={i === 0}
                            titulo={x.nome}
                            sub={`${x.sku} · vendeu ${int(x.vendidos30)} em 30 dias${x.minimo ? ` · mínimo ${int(x.minimo)}` : ''}`}
                            valor={x.estoque <= 0 ? 'esgotado' : x.diasCobertura !== null ? `${int(x.estoque)} un · ${x.diasCobertura} d` : `${int(x.estoque)} un`}
                            tom="warn"
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {estoque.semEstoqueInformado > 0 && (
                    <p className="px-1 text-[12px] text-[var(--ag-text-3)]">{int(estoque.semEstoqueInformado)} itens sem saldo informado ficaram de fora.</p>
                  )}
                </>
              )}
            </Secao>
          )}

          {dados?.catalogo && (
            <SecaoCatalogo catalogo={dados.catalogo} nomeErp={nomeErp} carregando={lendoLoja} onPedirAlfred={onPedirAlfred} onAbrirFontes={onAbrirFontes} />
          )}
          {dados?.precos && <SecaoPrecos precos={dados.precos} nomeErp={nomeErp} onPedirAlfred={onPedirAlfred} />}
          {dados && fontes?.pedidos && !fontes.catalogoLoja && (
            <Aviso
              titulo="Conecte a loja para ver catálogo e preços"
              texto="Com a Wake conectada, o painel compara o catálogo e os preços do ERP com o que está à venda na loja."
              acao={{ rotulo: 'Conectar', onClick: onAbrirFontes }}
            />
          )}

          <button
            onClick={onAbrirFontes}
            className="self-start min-h-[44px] flex items-center gap-1 text-[14px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
          >
            Fontes e conectores <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default OperacoesScreen;
