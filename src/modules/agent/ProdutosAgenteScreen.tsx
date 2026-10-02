import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, CloudUpload, FolderTree, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import type { Product, ProductModalTab } from '../../types/models';
import type { PedidoAlfred } from '../../types/agent';
import BarraProximoPasso from './BarraProximoPasso';
import { useAgentTheme } from './theme';
import { useTelaPequena } from './useViewport';
import {
  FILTROS_PADRAO, FILTROS_VAZIOS, ROTULO_OPCAO, aplicarFiltros, contarFiltros, contarOpcoes, estadoSelecao, paginar,
  pedidoDaSelecao, principais, quantosFiltrosAtivos, semDescricao,
  type FiltrosProdutos, type OpcaoConteudo, type OpcaoIntegracao, type OpcaoSync,
} from './produtosAgente';
import LinhaProduto, { Caixa } from './produtos/LinhaProduto';
import PainelFiltros from './produtos/PainelFiltros';
import Paginacao from './produtos/Paginacao';
import { BotaoConta } from '../../components/ContaMenu';

export type ViewProdutos = 'categories' | 'integrations' | 'products';

interface Props {
  products: Product[];
  /** A mesma seleção da tabela de produtos (`selectedIds` do App). */
  selecionados: Set<string>;
  onSelecionar: (ids: Set<string>) => void;
  /** Créditos por descrição — o custo aparece antes de gastar. */
  custoPorDescricao: number;
  gerando: boolean;
  progresso: { current: number; total: number };
  /** Gera descrição + SEO dos ids (o mesmo fluxo do botão da tabela, com confirmação e débito). */
  onGerarDescricoes: (ids: Set<string>) => void;
  onAbrirProduto: (p: Product, aba: ProductModalTab) => void;
  onAbrirView: (view: ViewProdutos) => void;
  onPedirAlfred: (pedido: PedidoAlfred) => void;
  onVoltar: () => void;
  /** Alfred só aparece com módulo de agente. */
  hasAgente: boolean;
}

/** Um filtro ativo, como pílula removível abaixo do topo. */
interface FiltroAtivo { chave: string; rotulo: string; remover: (f: FiltrosProdutos) => FiltrosProdutos }

function filtrosAtivos(f: FiltrosProdutos): FiltroAtivo[] {
  const sem = <T,>(lista: T[], v: T) => lista.filter((x) => x !== v);
  return [
    ...f.integracao.map((o: OpcaoIntegracao) => ({ chave: `i:${o}`, rotulo: ROTULO_OPCAO[o], remover: (x: FiltrosProdutos) => ({ ...x, integracao: sem(x.integracao, o) }) })),
    ...f.sync.map((o: OpcaoSync) => ({ chave: `s:${o}`, rotulo: ROTULO_OPCAO[o], remover: (x: FiltrosProdutos) => ({ ...x, sync: sem(x.sync, o) }) })),
    ...f.conteudo.map((o: OpcaoConteudo) => ({ chave: `c:${o}`, rotulo: ROTULO_OPCAO[o], remover: (x: FiltrosProdutos) => ({ ...x, conteudo: sem(x.conteudo, o) }) })),
    ...f.categoria.map((o) => ({ chave: `k:${o}`, rotulo: o, remover: (x: FiltrosProdutos) => ({ ...x, categoria: sem(x.categoria, o) }) })),
  ];
}

const estiloBotaoTopo: React.CSSProperties = { background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)' };

/**
 * F2 · Agente Produtos — a porta Ferramentas do catálogo. Lista só os produtos
 * principais com a integração de cada um (e se está em dia com ela) e o que
 * falta, filtra por painel (OU dentro do grupo, E entre grupos), pagina de 50 em
 * 50 e deixa selecionar em massa — a seleção atravessa páginas e filtros. Uma
 * única ação embaixo ("Próximo passo"). A tabela antiga continua a um toque.
 */
const ProdutosAgenteScreen: React.FC<Props> = ({
  products, selecionados, onSelecionar, custoPorDescricao, gerando, progresso,
  onGerarDescricoes, onAbrirProduto, onAbrirView, onPedirAlfred, onVoltar, hasAgente,
}) => {
  const { tema } = useAgentTheme();
  const telaPequena = useTelaPequena();
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosProdutos>(FILTROS_PADRAO);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const listaRef = useRef<HTMLDivElement>(null);

  const lista = useMemo(() => principais(products), [products]);
  const idsPrincipais = useMemo(() => new Set(lista.map((p) => p._id)), [lista]);
  const visiveis = useMemo(() => aplicarFiltros(lista, filtros, busca), [lista, filtros, busca]);
  const contagem = useMemo(() => contarOpcoes(lista, filtros, busca), [lista, filtros, busca]);
  const pag = useMemo(() => paginar(visiveis, pagina), [visiveis, pagina]);
  const idsDaPagina = useMemo(() => pag.itens.map((p) => p._id), [pag.itens]);
  const selecao = estadoSelecao(idsDaPagina, selecionados, visiveis.length);
  const nFiltros = quantosFiltrosAtivos(filtros);
  const ativos = filtrosAtivos(filtros);
  const incompletos = useMemo(() => contarFiltros(lista, ['incompletos']).incompletos, [lista]);

  // A seleção é a mesma da tabela, que aceita variações. Aqui só pais existem:
  // uma variação selecionada lá seria gerada sem aparecer nesta lista.
  useEffect(() => {
    if ([...selecionados].some((id) => !idsPrincipais.has(id))) {
      onSelecionar(new Set([...selecionados].filter((id) => idsPrincipais.has(id))));
    }
  }, [selecionados, idsPrincipais, onSelecionar]);

  useEffect(() => { setPagina(1); }, [filtros, busca]);
  // scrollTop, nunca scrollIntoView: este rola todos os ancestrais roláveis.
  const irPara = (n: number) => { setPagina(n); if (listaRef.current) listaRef.current.scrollTop = 0; };

  // A barra age sobre toda a seleção (todas as páginas), não só a aberta.
  const produtosSelecionados = useMemo(() => lista.filter((p) => selecionados.has(p._id)), [lista, selecionados]);
  const n = produtosSelecionados.length;

  const alternar = (id: string) => {
    const prox = new Set(selecionados);
    if (prox.has(id)) prox.delete(id); else prox.add(id);
    onSelecionar(prox);
  };
  const alternarPagina = () => {
    const prox = new Set(selecionados);
    if (selecao.paginaToda) idsDaPagina.forEach((id) => prox.delete(id));
    else idsDaPagina.forEach((id) => prox.add(id));
    onSelecionar(prox);
  };

  // O próximo passo sem seleção é selecionar o que está incompleto — a tela
  // nunca fica sem uma ação principal.
  const semDescricaoNaLista = visiveis.filter(semDescricao);
  const acao: { rotulo: string; detalhe?: string; onClick: () => void; desabilitada?: boolean } | null = gerando
    ? { rotulo: `Gerando ${progresso.current} de ${progresso.total}`, onClick: () => {}, desabilitada: true }
    : n > 0
      ? {
        rotulo: n === 1 ? 'Gerar descrição' : `Gerar ${n} descrições`,
        detalhe: `${n * custoPorDescricao} créditos`,
        onClick: () => onGerarDescricoes(new Set(produtosSelecionados.map((p) => p._id))),
      }
      : semDescricaoNaLista.length
        ? {
          rotulo: `Selecionar os ${semDescricaoNaLista.length} sem descrição`,
          onClick: () => onSelecionar(new Set(semDescricaoNaLista.map((p) => p._id))),
        }
        : null;

  const campoBusca = (
    <label className="relative flex items-center">
      <Search className="absolute left-3.5 w-4 h-4 text-[var(--ag-text-3)] pointer-events-none" />
      <input
        autoFocus={buscando}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou SKU"
        aria-label="Buscar produto por nome ou SKU"
        // 16px: abaixo disso o Safari do iOS dá zoom ao focar.
        className="w-full h-11 pl-10 pr-10 rounded-full text-[16px] md:text-[14px] outline-none text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)]"
        style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)' }}
      />
      {busca && (
        <button onClick={() => setBusca('')} aria-label="Limpar busca" className="absolute right-2 w-7 h-7 grid place-items-center rounded-full text-[var(--ag-text-3)] hover:text-[var(--ag-text)]">
          <X className="w-4 h-4" />
        </button>
      )}
    </label>
  );

  const atalho = (rotulo: string, Icone: typeof Table2, view: ViewProdutos, title?: string) => (
    <button
      onClick={() => onAbrirView(view)}
      title={title}
      aria-label={rotulo}
      className="h-11 px-3 lg:px-4 rounded-full flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ag-text)] transition-colors hover:bg-[var(--ag-fill-2)] shrink-0"
      style={estiloBotaoTopo}
    >
      <Icone className="w-4 h-4 text-[var(--ag-text-2)]" />
      <span className="hidden lg:inline">{rotulo}</span>
      {view === 'products' && <ArrowUpRight className="hidden lg:block w-3.5 h-3.5 text-[var(--ag-text-3)]" />}
    </button>
  );

  const faixa = 'px-4 py-2 text-[13px] text-[var(--ag-text-2)]';
  const estiloFaixa: React.CSSProperties = { borderTop: '1px solid var(--ag-hairline)', background: 'var(--ag-fill)' };

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Barra do topo: volta para Ferramentas; no telefone, a lupa abre a busca. */}
        <div className="ag-tela-x flex items-center gap-1 pt-2 shrink-0">
          <button
            onClick={onVoltar}
            className="min-h-[44px] -ml-1 pr-3 flex items-center text-[14px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
          >
            <ChevronLeft className="w-5 h-5" /> Ferramentas
          </button>
          <span className="flex-1" />
          <button
            onClick={() => { setBuscando((b) => !b); if (buscando) setBusca(''); }}
            aria-label={buscando ? 'Fechar busca' : 'Buscar'}
            className="md:hidden w-11 h-11 grid place-items-center text-[var(--ag-text)]"
          >
            {buscando ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
          </button>
          <BotaoConta />
        </div>

        <div ref={listaRef} className="ag-tela-x ag-scroll flex-1 overflow-y-auto pb-6">
          <div className="flex flex-col gap-4">
            {/* Título + resumo; à direita, busca (desktop), filtros e os atalhos. */}
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-[var(--ag-text)]">Produtos</h1>
                <p className="text-[13.5px] text-[var(--ag-text-2)]">
                  {lista.length.toLocaleString('pt-BR')} {lista.length === 1 ? 'produto principal' : 'produtos principais'}
                  {incompletos > 0 && <> · <span style={{ color: 'var(--ag-warn)' }}>{incompletos} incompletos</span></>}
                </p>
              </div>
              <div className="hidden md:block w-[260px] lg:w-[320px]">{campoBusca}</div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setFiltrosAbertos((v) => !v)}
                    aria-expanded={filtrosAbertos}
                    className="h-11 px-4 rounded-full flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ag-text)]"
                    style={nFiltros ? { ...estiloBotaoTopo, boxShadow: 'inset 0 0 0 1px var(--ag-text)' } : estiloBotaoTopo}
                  >
                    <SlidersHorizontal className="w-4 h-4 text-[var(--ag-text-2)]" />
                    Filtros{nFiltros > 0 && <span className="tabular-nums"> · {nFiltros}</span>}
                  </button>
                  {filtrosAbertos && (
                    <PainelFiltros folha={telaPequena} filtros={filtros} contagem={contagem} onMudar={setFiltros} onFechar={() => setFiltrosAbertos(false)} />
                  )}
                </div>
                {atalho('Categorias', FolderTree, 'categories')}
                {atalho('Envio ERP', CloudUpload, 'integrations')}
                {atalho('Tabela completa', Table2, 'products', 'A planilha inteira: todas as colunas, variações, filtros, exportar e enviar')}
              </div>
            </div>

            {buscando && <div className="md:hidden">{campoBusca}</div>}

            {ativos.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {ativos.map((a) => (
                  <button
                    key={a.chave}
                    onClick={() => setFiltros(a.remover(filtros))}
                    aria-label={`Remover filtro ${a.rotulo}`}
                    className="h-8 pl-3 pr-2 rounded-full text-[12.5px] font-medium flex items-center gap-1"
                    style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' }}
                  >
                    {a.rotulo} <X className="w-3.5 h-3.5 text-[var(--ag-text-3)]" />
                  </button>
                ))}
                <button onClick={() => setFiltros(FILTROS_VAZIOS)} className="h-8 px-2 text-[12.5px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">
                  Limpar
                </button>
              </div>
            )}

            {visiveis.length === 0 ? (
              <div className="ag-glass rounded-[22px] px-5 py-10 flex flex-col items-center gap-3 text-center text-[14px] text-[var(--ag-text-2)]">
                {busca ? 'Nenhum produto com esse nome ou SKU.' : lista.length === 0 ? 'O catálogo está vazio.' : nFiltros ? 'Nenhum produto com esses filtros.' : 'Nada aqui.'}
                {nFiltros > 0 && (
                  <button onClick={() => setFiltros(FILTROS_VAZIOS)} className="h-10 px-4 rounded-full text-[13px] font-semibold text-[var(--ag-text)]" style={{ background: 'var(--ag-fill-2)' }}>
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <section className="ag-glass rounded-[22px] overflow-hidden">
                {/* Cabeçalho: caixa da página, contagem e (desktop largo) o que cada coluna mostra. */}
                <div className="flex items-center gap-1 pl-1 pr-3 py-1 text-[12.5px] text-[var(--ag-text-2)]" style={{ background: 'var(--ag-fill)' }}>
                  <Caixa marcada={selecao.paginaToda} rotulo="Selecionar os desta página" onClick={alternarPagina} />
                  <span className="flex-1">
                    {visiveis.length.toLocaleString('pt-BR')} {visiveis.length === 1 ? 'produto' : 'produtos'}
                    {n > 0 && <> · <span className="font-semibold text-[var(--ag-text)]">{n} selecionado{n === 1 ? '' : 's'}</span></>}
                  </span>
                  <span className="hidden lg:block w-[170px] text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">Integração</span>
                  <span className="hidden lg:block w-[38%] text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">O que tem</span>
                </div>
                {selecao.oferecerTodos && (
                  <div className={faixa} style={estiloFaixa}>
                    {idsDaPagina.length} desta página selecionados ·{' '}
                    <button className="font-semibold text-[var(--ag-accent)]" onClick={() => onSelecionar(new Set([...selecionados, ...visiveis.map((p) => p._id)]))}>
                      Selecionar todos os {visiveis.length.toLocaleString('pt-BR')} do filtro
                    </button>
                  </div>
                )}
                {!selecao.oferecerTodos && n > 0 && n > idsDaPagina.filter((id) => selecionados.has(id)).length && (
                  <div className={faixa} style={estiloFaixa}>
                    {n} selecionados no total ·{' '}
                    <button className="font-semibold text-[var(--ag-accent)]" onClick={() => onSelecionar(new Set())}>Limpar seleção</button>
                  </div>
                )}
                {pag.itens.map((p) => (
                  <LinhaProduto
                    key={p._id}
                    p={p}
                    marcado={selecionados.has(p._id)}
                    onMarcar={() => alternar(p._id)}
                    onAbrir={() => onAbrirProduto(p, 'geral')}
                    mostrarVideo={filtros.conteudo.includes('semVideo')}
                  />
                ))}
              </section>
            )}
            <Paginacao pagina={pag.pagina} totalPaginas={pag.totalPaginas} inicio={pag.inicio} fim={pag.fim} total={visiveis.length} onIr={irPara} />
          </div>
        </div>

        {(acao || hasAgente) && (
          <BarraProximoPasso
            n={n}
            acao={acao ? { ...acao, ocupada: gerando } : null}
            onPedirAlfred={hasAgente ? () => onPedirAlfred(pedidoDaSelecao(produtosSelecionados)) : undefined}
          />
        )}
      </div>
    </div>
  );
};

export default ProdutosAgenteScreen;
