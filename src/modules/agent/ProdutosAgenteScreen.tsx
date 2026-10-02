import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, CloudUpload, FolderTree, Loader2, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import AlfredLogo from '../../components/alfredLogo/AlfredLogo';
import type { Product, ProductModalTab } from '../../types/models';
import type { PedidoAlfred } from '../../types/agent';
import BarraProximoPasso from './BarraProximoPasso';
import { useAgentTheme } from './theme';
import { useAbaixoDeMd, useAlturaTeclado, useTelaLarga, useTelaPequena } from './useViewport';
import { useConversaAlfred } from './useConversaAlfred';
import PainelAlfred from './PainelAlfred';
import CardConfirmacao from './produtos/CardConfirmacao';
import FolhaAlfred from './produtos/FolhaAlfred';
import { alvos, montarConfirmacao, type CandidatoMassa, type Confirmacao, type FerramentaMassa } from './confirmacaoMassa';
import { criarLotesEmMassa, previaMassa } from '../../services/agentChatService';
import {
  FILTROS_PADRAO, FILTROS_VAZIOS, ROTULO_OPCAO, aplicarFiltros, contarFiltros, contarOpcoes, estadoSelecao, paginar,
  MAX_SKUS_CONTEXTO, nomeDe, pedidoDaSelecao, principais, quantosFiltrosAtivos, semDescricao, skuDe, temAmbientada, temFoto,
  type FiltrosProdutos, type OpcaoConteudo, type OpcaoIntegracao, type OpcaoSync,
} from './produtosAgente';
import LinhaProduto, { Caixa } from './produtos/LinhaProduto';
import PainelFiltros from './produtos/PainelFiltros';
import Paginacao from './produtos/Paginacao';
import EnviarErp, { type ErpEnvio } from './produtos/EnviarErp';
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
  uid: string;
  /** Saldo — o card de confirmação avisa antes de faltar. */
  credits: number;
  /** Composer do painel focado no telefone — o App esconde a tab bar para o teclado. */
  onFocoChange?: (focado: boolean) => void;
  onRecarregar: () => void;
  /** Tiny e Wake conectados — "Enviar" leva a seleção a eles. */
  erpsConectados: Record<ErpEnvio, boolean>;
  /** O mesmo envio do "Enviar para" da tabela, sobre a seleção. */
  onEnviarErp: (erp: ErpEnvio) => void;
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
  uid, credits, onFocoChange, onRecarregar, erpsConectados, onEnviarErp,
}) => {
  const { tema } = useAgentTheme();
  const telaPequena = useTelaPequena();
  // Painel do Alfred: coluna fixa ≥1280px, sobreposto entre 768 e 1280, folha abaixo de 768.
  const larga = useTelaLarga();
  const emFolha = useAbaixoDeMd();
  const alturaTeclado = useAlturaTeclado();
  const [painelAberto, setPainelAberto] = useState(false);
  const [folha, setFolha] = useState<'fechada' | 'meia' | 'cheia'>('fechada');
  const [focado, setFocado] = useState(false);
  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null);
  // Enquanto o servidor devolve o custo (e quem não está salvo); erro = a prévia falhou.
  const [preparando, setPreparando] = useState<{ erro: string | null } | null>(null);
  const pedidoPrevia = useRef(0);
  const conversa = useConversaAlfred(uid);
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosProdutos>(FILTROS_PADRAO);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const listaRef = useRef<HTMLDivElement>(null);

  const lista = useMemo(() => principais(products), [products]);
  const idsPrincipais = useMemo(() => new Set(lista.map((p) => p._id)), [lista]);
  // A lista filtra com a busca adiada: o campo responde a cada tecla e a
  // filtragem (que inclui o estado de sincronização) roda quando sobra tempo.
  const buscaAdiada = useDeferredValue(busca);
  const visiveis = useMemo(() => aplicarFiltros(lista, filtros, buscaAdiada), [lista, filtros, buscaAdiada]);
  const contagem = useMemo(() => contarOpcoes(lista, filtros, buscaAdiada), [lista, filtros, buscaAdiada]);
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

  useEffect(() => { setPagina(1); }, [filtros, buscaAdiada]);
  // scrollTop, nunca scrollIntoView: este rola todos os ancestrais roláveis.
  const irPara = (n: number) => { setPagina(n); if (listaRef.current) listaRef.current.scrollTop = 0; };

  // A barra age sobre toda a seleção (todas as páginas), não só a aberta.
  const produtosSelecionados = useMemo(() => lista.filter((p) => selecionados.has(p._id)), [lista, selecionados]);
  const n = produtosSelecionados.length;

  // O painel fala desta tela: a seleção vai no contexto de cada mensagem.
  useEffect(() => {
    const skus = produtosSelecionados.map(skuDe).filter(Boolean);
    conversa.definirContexto({ tela: 'produtos', ...(n ? { skus: skus.slice(0, MAX_SKUS_CONTEXTO), totalSelecionados: n } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosSelecionados]);

  // Sair da tela com o campo focado não dispara blur — sem isso a tab bar ficaria escondida.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onFocoChange?.(false), []);

  const mostrarPainel = () => {
    if (emFolha) setFolha((f) => (f === 'fechada' ? 'meia' : f));
    else if (!larga) setPainelAberto(true);
  };
  // O custo vem do servidor (o mesmo `estimateCredits` do débito), nunca da
  // tabela de preços do navegador; e quem não está salvo — novo ou com edição
  // pendente, que o servidor geraria da cópia velha — sai com aviso no card.
  const pedirConfirmacao = async (ferramenta: FerramentaMassa) => {
    const pedido = ++pedidoPrevia.current;
    setConfirmando(null);
    setPreparando({ erro: null });
    mostrarPainel();
    try {
      const ids = produtosSelecionados.map((p) => p._id);
      const previa = await previaMassa(ferramenta, ids);
      if (pedido !== pedidoPrevia.current) return;
      const fora = new Set(previa.naoEncontrados);
      const candidatos: CandidatoMassa[] = produtosSelecionados.map((p) => ({
        id: p._id, nome: nomeDe(p), temDescricao: !semDescricao(p), temAmbientada: temAmbientada(p), temFoto: temFoto(p),
        salvo: !p._isDirty && !fora.has(p._id),
      }));
      setConfirmando(montarConfirmacao(ferramenta, candidatos, previa.custoUnitario));
      setPreparando(null);
    } catch (e) {
      if (pedido !== pedidoPrevia.current) return;
      setPreparando({ erro: e instanceof Error ? e.message : 'Não foi possível conferir o custo.' });
    }
  };
  const cancelarConfirmacao = () => { pedidoPrevia.current++; setConfirmando(null); setPreparando(null); };
  const confirmar = async (sobrescrever: boolean) => {
    if (!confirmando) return;
    await criarLotesEmMassa(confirmando.ferramenta, alvos(confirmando, sobrescrever).map((c) => c.id), sobrescrever);
    setConfirmando(null); // os cards dos lotes chegam pela conversa
  };
  const pedirAoAlfred = () => {
    const pedido = pedidoDaSelecao(produtosSelecionados);
    mostrarPainel();
    void conversa.enviar(pedido.texto, pedido.contexto);
  };

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
  type Acao = { rotulo: string; detalhe?: string; onClick: () => void; desabilitada?: boolean };
  const selecionarSemDescricao: Acao | null = semDescricaoNaLista.length
    ? { rotulo: `Selecionar os ${semDescricaoNaLista.length} sem descrição`, onClick: () => onSelecionar(new Set(semDescricaoNaLista.map((p) => p._id))) }
    : null;
  // Com agente e seleção: as duas ações em massa, confirmadas no painel do Alfred.
  // Sem agente: a geração do botão da tabela, como antes.
  const acao: Acao | null = hasAgente
    ? (n > 0 ? { rotulo: 'Gerar descrição para todas', onClick: () => void pedirConfirmacao('produtos.descricoes.gerar') } : selecionarSemDescricao)
    : gerando
      ? { rotulo: `Gerando ${progresso.current} de ${progresso.total}`, onClick: () => {}, desabilitada: true }
      : n > 0
        ? {
          rotulo: n === 1 ? 'Gerar descrição' : `Gerar ${n} descrições`,
          detalhe: `${n * custoPorDescricao} créditos`,
          onClick: () => onGerarDescricoes(new Set(produtosSelecionados.map((p) => p._id))),
        }
        : selecionarSemDescricao;
  const acaoSecundaria: Acao | null = hasAgente && n > 0
    ? { rotulo: 'Gerar imagem para todas', onClick: () => void pedirConfirmacao('produtos.ambientadas.gerar') }
    : null;

  const painel = hasAgente && (
    <PainelAlfred
      uid={uid}
      conversa={conversa}
      rodape={confirmando ? (
        <CardConfirmacao
          key={`${confirmando.ferramenta}:${confirmando.total}:${confirmando.novos.length}`}
          conf={confirmando}
          saldo={credits}
          onConfirmar={confirmar}
          onCancelar={cancelarConfirmacao}
          onRecarregar={onRecarregar}
        />
      ) : preparando && (
        <div className="ag-glass rounded-[20px] px-4 py-3 flex items-center gap-2 text-[13px]" style={{ boxShadow: 'var(--ag-shadow-sm)' }} aria-live="polite">
          {preparando.erro
            ? <span className="flex-1" style={{ color: 'var(--ag-danger)' }}>{preparando.erro}</span>
            : <><Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ag-text-3)]" /><span className="flex-1 text-[var(--ag-text-2)]">Conferindo custo e catálogo…</span></>}
          <button onClick={cancelarConfirmacao} className="min-h-[36px] px-3 rounded-full font-semibold text-[var(--ag-text-2)]">Cancelar</button>
        </div>
      )}
      vazio={(
        <p className="flex-1 grid place-items-center px-6 text-center text-[13.5px] text-[var(--ag-text-2)]">
          Selecione produtos e escolha uma ação, ou peça qualquer coisa ao Alfred.
        </p>
      )}
      // No telefone, focar o campo abre a folha inteira: em meia altura o teclado deixaria a conversa com poucos px.
      onFoco={(f) => { setFocado(f); onFocoChange?.(f); if (f && emFolha) setFolha('cheia'); }}
      recuoTeclado={emFolha ? alturaTeclado : 0}
      emFoco={emFolha && focado}
    />
  );
  const cabecalhoPainel = (fechar?: () => void) => (
    <div className="h-12 shrink-0 px-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--ag-hairline)' }}>
      <AlfredLogo size={22} ativo={conversa.streaming} interativo={false} />
      <span className="flex-1 text-[14px] font-semibold text-[var(--ag-text)]">Alfred</span>
      {fechar && (
        <button onClick={fechar} aria-label="Fechar o Alfred" className="w-9 h-9 grid place-items-center rounded-full text-[var(--ag-text-2)]">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

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
      <div className="flex-1 min-h-0 flex relative">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
          {hasAgente && !larga && !emFolha && (
            <button
              onClick={() => setPainelAberto((v) => !v)}
              aria-expanded={painelAberto}
              className="h-10 pl-2 pr-3.5 mr-1 rounded-full flex items-center gap-2 text-[13px] font-semibold text-[var(--ag-text)]"
              style={{ background: 'var(--ag-fill-2)' }}
            >
              <AlfredLogo size={20} ativo={conversa.streaming} interativo={false} /> Alfred
            </button>
          )}
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

        {(acao || hasAgente) && !(emFolha && folha !== 'fechada') && (
          <BarraProximoPasso
            n={n}
            acao={acao ? { ...acao, ocupada: !hasAgente && gerando } : null}
            acaoSecundaria={acaoSecundaria}
            extra={n > 0 && (
              <EnviarErp
                selecionados={produtosSelecionados}
                conectadas={erpsConectados}
                onEnviar={onEnviarErp}
                onConectar={() => onAbrirView('integrations')}
              />
            )}
            onPedirAlfred={hasAgente ? pedirAoAlfred : () => onPedirAlfred(pedidoDaSelecao(produtosSelecionados))}
          />
        )}
        {hasAgente && emFolha && <FolhaAlfred altura={folha} onAltura={setFolha}>{painel}</FolhaAlfred>}
      </div>

      {hasAgente && larga && (
        <aside className="w-[380px] shrink-0 flex flex-col min-h-0" style={{ borderLeft: '1px solid var(--ag-hairline)' }}>
          {cabecalhoPainel()}
          <div className="flex-1 min-h-0">{painel}</div>
        </aside>
      )}
      {hasAgente && !larga && !emFolha && painelAberto && (
        <aside
          className="absolute right-0 top-0 bottom-0 z-30 w-[380px] max-w-full flex flex-col min-h-0 ag-glass-strong"
          style={{ boxShadow: 'var(--ag-shadow)', borderLeft: '1px solid var(--ag-hairline)' }}
        >
          {cabecalhoPainel(() => setPainelAberto(false))}
          <div className="flex-1 min-h-0">{painel}</div>
        </aside>
      )}
      </div>
    </div>
  );
};

export default ProdutosAgenteScreen;
