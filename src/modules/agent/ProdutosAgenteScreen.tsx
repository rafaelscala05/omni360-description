import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronLeft, CloudUpload, FolderTree, Loader2, Package, Search, Table2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ASPECTO, ASPECTO_DO_ROTULO, type Aspecto } from './aspectos';
import type { Product, ProductModalTab } from '../../types/models';
import type { PedidoAlfred } from '../../types/agent';
import BarraProximoPasso from './BarraProximoPasso';
import { useAgentTheme } from './theme';
import {
  ABA_DO_SEGMENTO, FILTROS_DO_SEGMENTO, ROTULO_FILTRO, contarFiltros, filtrarProdutos, nomeDe, pedidoDaSelecao,
  pilulasDe, principais, semDescricao, skuDe,
  type EstadoPilula, type FiltroProdutos, type SegmentoProdutos,
} from './produtosAgente';
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

const PAGINA = 60;

const SEGMENTOS: { id: SegmentoProdutos | ViewProdutos; rotulo: string; Icone: LucideIcon }[] = [
  { id: 'catalogo', rotulo: 'Catálogo', Icone: Package },
  { id: 'imagens', rotulo: 'Imagens', Icone: ASPECTO.imagens.Icone },
  { id: 'videos', rotulo: 'Vídeos', Icone: ASPECTO.video.Icone },
  { id: 'categories', rotulo: 'Categorias', Icone: FolderTree },
  { id: 'integrations', rotulo: 'Envio ERP', Icone: CloudUpload },
];
const ehView = (id: string): id is ViewProdutos => id === 'categories' || id === 'integrations' || id === 'products';

/**
 * Pílula de um aspecto: o ícone diz qual (a cor dele, de `aspectos.tsx`), o
 * fundo diz o estado — feito (tingido na cor do aspecto, com ✓), falta e é
 * obrigatório (âmbar, "sem …"), opcional (só contorno) e gerando (azul).
 */
const Pilula: React.FC<{ rotulo: string; estado: EstadoPilula }> = ({ rotulo, estado }) => {
  const aspecto: Aspecto = ASPECTO_DO_ROTULO[rotulo] ?? 'descricao';
  const { Icone, cor } = ASPECTO[aspecto];
  const estilo: React.CSSProperties =
    estado === 'ok' ? { background: `color-mix(in srgb, ${cor} 11%, transparent)`, color: cor }
      : estado === 'alerta' ? { background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)' }
        : estado === 'rodando' ? { background: 'var(--ag-blue-soft)', color: 'var(--ag-blue)' }
          : { color: 'var(--ag-text-3)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' };
  const texto = estado === 'alerta' ? `sem ${rotulo}` : estado === 'rodando' ? `${rotulo} gerando` : rotulo;
  return (
    <span className="inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full text-[11.5px] font-medium whitespace-nowrap" style={estilo}>
      {estado === 'rodando' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icone className="w-3 h-3" />}
      {texto}
      {estado === 'ok' && <Check className="w-3 h-3" strokeWidth={2.5} />}
    </span>
  );
};

const primeiraImagem = (p: Product): string | null => {
  if (p._selectedImage) return p._selectedImage;
  const rec = p as unknown as Record<string, unknown>;
  const chave = Object.keys(rec).filter((k) => /^URL imagem/i.test(k)).sort().find((k) => String(rec[k] ?? '').trim());
  return chave ? String(rec[chave]).trim() : null;
};

const Miniatura: React.FC<{ p: Product }> = ({ p }) => {
  const url = primeiraImagem(p);
  const [falhou, setFalhou] = useState(false);
  return (
    <span className="w-12 h-12 rounded-[12px] shrink-0 overflow-hidden grid place-items-center" style={{ background: 'var(--ag-fill)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline)' }}>
      {url && !falhou ? (
        <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setFalhou(true)} />
      ) : (
        <span className="text-[15px] font-semibold text-[var(--ag-text-3)]">{nomeDe(p).slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
};

const Caixa: React.FC<{ marcada: boolean; rotulo: string; onClick: () => void }> = ({ marcada, rotulo, onClick }) => (
  <button
    onClick={onClick}
    role="checkbox"
    aria-checked={marcada}
    aria-label={rotulo}
    className="w-11 h-11 -mr-1.5 grid place-items-center shrink-0"
  >
    <span
      className="w-[22px] h-[22px] rounded-[7px] grid place-items-center transition-colors"
      style={marcada
        ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }
        : { border: '1.5px solid var(--ag-hairline-2)', background: 'var(--ag-surface-solid)' }}
    >
      {marcada && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
    </span>
  </button>
);

/**
 * F2 · Agente Produtos — a porta Ferramentas do catálogo. Lista só os produtos
 * principais com o que falta em cada um, deixa selecionar em massa e põe uma
 * única ação embaixo ("Próximo passo"): a mesma geração do botão da tabela,
 * com a confirmação de custo dela, ou "Pedir ao Alfred" levando a seleção como
 * contexto. A tabela antiga continua a um toque, para o que esta tela não faz.
 */
const ProdutosAgenteScreen: React.FC<Props> = ({
  products, selecionados, onSelecionar, custoPorDescricao, gerando, progresso,
  onGerarDescricoes, onAbrirProduto, onAbrirView, onPedirAlfred, onVoltar, hasAgente,
}) => {
  const { tema } = useAgentTheme();
  const [segmento, setSegmento] = useState<SegmentoProdutos>('catalogo');
  const [filtro, setFiltro] = useState<FiltroProdutos>('incompletos');
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [limite, setLimite] = useState(PAGINA);

  const lista = useMemo(() => principais(products), [products]);
  const idsPrincipais = useMemo(() => new Set(lista.map((p) => p._id)), [lista]);
  const filtros = FILTROS_DO_SEGMENTO[segmento];
  const contagens = useMemo(() => contarFiltros(lista, filtros), [lista, filtros]);
  const visiveis = useMemo(() => filtrarProdutos(lista, filtro, busca), [lista, filtro, busca]);

  // A seleção é a mesma da tabela, que aceita variações. Aqui só pais existem:
  // uma variação selecionada lá seria gerada sem aparecer nesta lista.
  useEffect(() => {
    if ([...selecionados].some((id) => !idsPrincipais.has(id))) {
      onSelecionar(new Set([...selecionados].filter((id) => idsPrincipais.has(id))));
    }
  }, [selecionados, idsPrincipais, onSelecionar]);

  useEffect(() => { setLimite(PAGINA); }, [filtro, busca, segmento]);

  const escolherSegmento = (id: SegmentoProdutos | ViewProdutos) => {
    if (ehView(id)) { onAbrirView(id); return; }
    setSegmento(id);
    setFiltro(FILTROS_DO_SEGMENTO[id][0]);
  };

  const selecionaveis = segmento === 'catalogo';
  const produtosSelecionados = useMemo(() => lista.filter((p) => selecionados.has(p._id)), [lista, selecionados]);
  const n = produtosSelecionados.length;
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((p) => selecionados.has(p._id));

  const alternar = (id: string) => {
    const prox = new Set(selecionados);
    if (prox.has(id)) prox.delete(id); else prox.add(id);
    onSelecionar(prox);
  };
  const alternarTodos = () => {
    const prox = new Set(selecionados);
    if (todosVisiveisMarcados) visiveis.forEach((p) => prox.delete(p._id));
    else visiveis.forEach((p) => prox.add(p._id));
    onSelecionar(prox);
  };

  // O próximo passo sem seleção é selecionar o que está incompleto — a tela
  // nunca fica sem uma ação principal.
  const semDescricaoNaLista = visiveis.filter(semDescricao);
  const acao: { rotulo: string; detalhe?: string; onClick: () => void; desabilitada?: boolean } | null = !selecionaveis
    ? null
    : gerando
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

  const incompletos = contagens.incompletos ?? contarFiltros(lista, ['incompletos']).incompletos;

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

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
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

        <div className="ag-tela-x ag-scroll flex-1 overflow-y-auto pb-6">
          <div className="flex flex-col gap-4">
            {/* Título + o que esta tela resume; à direita, a busca (desktop) e a tabela completa. */}
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-[var(--ag-text)]">Produtos</h1>
                <p className="text-[13.5px] text-[var(--ag-text-2)]">
                  {lista.length.toLocaleString('pt-BR')} {lista.length === 1 ? 'produto principal' : 'produtos principais'}
                  {incompletos > 0 && <> · <span style={{ color: 'var(--ag-warn)' }}>{incompletos} incompletos</span></>}
                </p>
              </div>
              <div className="hidden md:block w-[300px] lg:w-[360px]">{campoBusca}</div>
              <button
                onClick={() => onAbrirView('products')}
                title="A planilha inteira: todas as colunas, variações, filtros, exportar e enviar"
                className="self-start md:self-auto h-11 px-4 rounded-full flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ag-text)] transition-colors hover:bg-[var(--ag-fill-2)]"
                style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)' }}
              >
                <Table2 className="w-4 h-4 text-[var(--ag-text-2)]" /> Tabela completa <ArrowUpRight className="w-3.5 h-3.5 text-[var(--ag-text-3)]" />
              </button>
            </div>

            {buscando && <div className="md:hidden">{campoBusca}</div>}

            {/* Segmentos: os três primeiros filtram esta lista; os dois últimos abrem outra tela (↗). */}
            <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 [scrollbar-width:none]">
              {SEGMENTOS.map((sg) => {
                const ativo = sg.id === segmento;
                return (
                  <button
                    key={sg.id}
                    onClick={() => escolherSegmento(sg.id)}
                    aria-pressed={ativo}
                    className="h-10 pl-3 pr-3.5 rounded-full text-[13.5px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors"
                    style={ativo
                      ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }
                      : { background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', border: '1px solid var(--ag-hairline)' }}
                  >
                    <sg.Icone className="w-4 h-4" style={{ opacity: ativo ? 1 : 0.7 }} />
                    {sg.rotulo}
                    {ehView(sg.id) && <ArrowUpRight className="w-3.5 h-3.5 opacity-50" />}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {filtros.map((f) => {
                const ativo = f === filtro;
                const alerta = f !== 'todos' && contagens[f] > 0;
                return (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    aria-pressed={ativo}
                    className="h-8 px-3 rounded-full text-[12.5px] font-medium tabular-nums flex items-center gap-1.5"
                    style={ativo
                      ? (alerta ? { background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)', boxShadow: 'inset 0 0 0 1px var(--ag-warn)' } : { background: 'var(--ag-fill-2)', color: 'var(--ag-text)', boxShadow: 'inset 0 0 0 1px var(--ag-hairline-2)' })
                      : { background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}
                  >
                    {ROTULO_FILTRO[f]}
                    <span className="font-semibold" style={{ opacity: ativo ? 1 : 0.8 }}>{contagens[f]}</span>
                  </button>
                );
              })}
            </div>

            {visiveis.length === 0 ? (
              <div className="ag-glass rounded-[22px] px-5 py-10 text-center text-[14px] text-[var(--ag-text-2)]">
                {busca ? 'Nenhum produto com esse nome ou SKU.' : lista.length === 0 ? 'O catálogo está vazio.' : 'Nada aqui — esta parte do catálogo está em dia.'}
              </div>
            ) : (
              <section className="ag-glass rounded-[22px] overflow-hidden">
                {/* Cabeçalho da lista: contagem, seleção e (desktop) o que cada coluna mostra. */}
                <div className="flex items-center gap-3 pl-4 pr-3 py-1 text-[12.5px] text-[var(--ag-text-2)]" style={{ background: 'var(--ag-fill)' }}>
                  <span className="flex-1">
                    {visiveis.length} {visiveis.length === 1 ? 'produto' : 'produtos'}
                    {n > 0 && <> · <span className="font-semibold text-[var(--ag-text)]">{n} selecionado{n === 1 ? '' : 's'}</span></>}
                  </span>
                  <span className="hidden md:block w-[46%] text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">O que tem</span>
                  {selecionaveis ? (
                    <Caixa marcada={todosVisiveisMarcados} rotulo="Selecionar todos os da lista" onClick={alternarTodos} />
                  ) : <span className="h-11" />}
                </div>
                {visiveis.slice(0, limite).map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center gap-3 pl-3.5 pr-3 py-2.5 transition-colors hover:bg-[var(--ag-fill)]"
                    style={{ borderTop: '1px solid var(--ag-hairline)', background: selecionados.has(p._id) ? 'var(--ag-fill)' : undefined }}
                  >
                    <button
                      onClick={() => onAbrirProduto(p, ABA_DO_SEGMENTO[segmento])}
                      className="flex-1 min-w-0 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-3 text-left"
                    >
                      <span className="flex-1 min-w-0 flex items-center gap-3">
                        <Miniatura p={p} />
                        <span className="min-w-0 flex flex-col">
                          <span className="text-[14px] font-semibold text-[var(--ag-text)] truncate">{nomeDe(p)}</span>
                          {skuDe(p) && <span className="text-[12px] font-mono text-[var(--ag-text-3)] truncate">{skuDe(p)}</span>}
                        </span>
                      </span>
                      <span className="md:w-[46%] flex gap-1 flex-wrap pl-[60px] md:pl-0">
                        {pilulasDe(p, segmento).map((pl) => <Pilula key={pl.rotulo} rotulo={pl.rotulo} estado={pl.estado} />)}
                      </span>
                    </button>
                    {selecionaveis && (
                      <Caixa marcada={selecionados.has(p._id)} rotulo={`Selecionar ${nomeDe(p)}${skuDe(p) ? ` (${skuDe(p)})` : ''}`} onClick={() => alternar(p._id)} />
                    )}
                  </div>
                ))}
              </section>
            )}
            {visiveis.length > limite && (
              <button
                onClick={() => setLimite((l) => l + PAGINA)}
                className="self-center h-10 px-4 rounded-full text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
                style={{ background: 'var(--ag-fill)' }}
              >
                Mostrar mais {Math.min(PAGINA, visiveis.length - limite)} de {visiveis.length - limite}
              </button>
            )}
          </div>
        </div>

        {(acao || (hasAgente && selecionaveis)) && (
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
