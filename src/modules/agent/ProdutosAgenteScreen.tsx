import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RefreshCw, Search, Sparkles, X } from 'lucide-react';
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

const SEGMENTOS: { id: SegmentoProdutos | ViewProdutos; rotulo: string }[] = [
  { id: 'catalogo', rotulo: 'Catálogo' },
  { id: 'categories', rotulo: 'Categorias' },
  { id: 'imagens', rotulo: 'Imagens' },
  { id: 'videos', rotulo: 'Vídeos' },
  { id: 'integrations', rotulo: 'Envio ERP' },
];
const ehView = (id: string): id is ViewProdutos => id === 'categories' || id === 'integrations' || id === 'products';

const COR_PILULA: Record<EstadoPilula, { background: string; color: string }> = {
  ok: { background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' },
  alerta: { background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)' },
  opcional: { background: 'var(--ag-fill)', color: 'var(--ag-text-3)' },
  rodando: { background: 'var(--ag-blue-soft)', color: 'var(--ag-blue)' },
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
    <span className="w-12 h-12 rounded-[12px] shrink-0 overflow-hidden grid place-items-center" style={{ background: 'var(--ag-fill)' }}>
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

  return (
    <div className="alfreds h-full flex flex-col" data-tema={tema}>
      <div
        className="ag-aurora flex-1 min-h-0 rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ag-hairline)', boxShadow: 'var(--ag-shadow)' }}
      >
        <div className="flex items-center gap-1 px-2 sm:px-4 pt-2 shrink-0">
          <button
            onClick={onVoltar}
            className="min-h-[44px] pl-1 pr-3 flex items-center text-[15px] font-medium text-[var(--ag-text)]"
          >
            <ChevronLeft className="w-5 h-5" /> Ferramentas
          </button>
          <span className="flex-1" />
          <button
            onClick={() => { setBuscando((b) => !b); if (buscando) setBusca(''); }}
            aria-label={buscando ? 'Fechar busca' : 'Buscar'}
            className="w-11 h-11 grid place-items-center text-[var(--ag-text)]"
          >
            {buscando ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
          </button>
          <BotaoConta />
        </div>

        <div className="ag-scroll flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="font-display text-[30px] font-semibold tracking-tight text-[var(--ag-text)] flex-1">Produtos</h1>
              <button
                onClick={() => onAbrirView('products')}
                className="min-h-[44px] flex items-center text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
              >
                Tabela completa <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {buscando && (
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome ou SKU"
                aria-label="Buscar produto por nome ou SKU"
                // 16px: abaixo disso o Safari do iOS dá zoom ao focar.
                className="h-11 px-4 rounded-full text-[16px] outline-none text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)]"
                style={{ background: 'var(--ag-surface-solid)', border: '1px solid var(--ag-hairline)' }}
              />
            )}

            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]">
              {SEGMENTOS.map((s) => {
                const ativo = s.id === segmento;
                return (
                  <button
                    key={s.id}
                    onClick={() => escolherSegmento(s.id)}
                    aria-pressed={ativo}
                    className="h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1"
                    style={ativo
                      ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }
                      : { background: 'var(--ag-surface-solid)', color: 'var(--ag-text)', border: '1px solid var(--ag-hairline)' }}
                  >
                    {s.rotulo}
                    {ehView(s.id) && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
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
                    className="h-[30px] px-3 rounded-full text-[12.5px] font-medium tabular-nums"
                    style={ativo
                      ? (alerta ? { background: 'var(--ag-warn-soft)', color: 'var(--ag-warn)', boxShadow: 'inset 0 0 0 1px var(--ag-warn)' } : { background: 'var(--ag-fill-2)', color: 'var(--ag-text)' })
                      : { background: 'var(--ag-fill)', color: 'var(--ag-text-2)' }}
                  >
                    {ROTULO_FILTRO[f]} · {contagens[f]}
                  </button>
                );
              })}
            </div>

            {visiveis.length === 0 ? (
              <div className="ag-glass rounded-[22px] px-5 py-8 text-center text-[14px] text-[var(--ag-text-2)]">
                {busca ? 'Nenhum produto com esse nome ou SKU.' : lista.length === 0 ? 'O catálogo está vazio.' : 'Nada aqui — esta parte do catálogo está em dia.'}
              </div>
            ) : (
              <section className="ag-glass rounded-[22px] overflow-hidden">
                {selecionaveis && (
                  <div className="flex items-center gap-3 pl-4 pr-3 py-1 text-[13px] text-[var(--ag-text-2)]">
                    <span className="flex-1">
                      {visiveis.length} {visiveis.length === 1 ? 'produto' : 'produtos'}
                      {n > 0 && <> · <span className="font-semibold text-[var(--ag-text)]">{n} selecionado{n === 1 ? '' : 's'}</span></>}
                    </span>
                    <Caixa marcada={todosVisiveisMarcados} rotulo="Selecionar todos os da lista" onClick={alternarTodos} />
                  </div>
                )}
                {visiveis.slice(0, limite).map((p, i) => (
                  <div
                    key={p._id}
                    className="flex items-center gap-3 pl-3.5 pr-3 py-2.5"
                    style={i === 0 && !selecionaveis ? undefined : { borderTop: '1px solid var(--ag-hairline)' }}
                  >
                    <button
                      onClick={() => onAbrirProduto(p, ABA_DO_SEGMENTO[segmento])}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                    >
                      <Miniatura p={p} />
                      <span className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <span className="text-[14px] font-semibold text-[var(--ag-text)] truncate">{nomeDe(p)}</span>
                        <span className="flex gap-1 flex-wrap">
                          {pilulasDe(p, segmento).map((pl) => (
                            <span key={pl.rotulo} className="text-[11px] font-medium px-[7px] py-[2px] rounded-[6px]" style={COR_PILULA[pl.estado]}>
                              {pl.estado === 'rodando' ? `${pl.rotulo} gerando` : pl.rotulo}
                            </span>
                          ))}
                        </span>
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
                className="min-h-[44px] text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]"
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
