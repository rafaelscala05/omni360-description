import React, { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import {
  FILTROS_VAZIOS, OPCOES_CONTEUDO, OPCOES_INTEGRACAO, OPCOES_SYNC, ROTULO_OPCAO,
  type ContagemOpcoes, type FiltrosProdutos,
} from '../produtosAgente';

interface Props {
  filtros: FiltrosProdutos;
  contagem: ContagemOpcoes;
  onMudar: (f: FiltrosProdutos) => void;
  onFechar: () => void;
  /** Telefone: folha que sobe da base; desktop: popover ancorado no botão. */
  folha: boolean;
}

const Opcao: React.FC<{ rotulo: string; n: number; marcada: boolean; onClick: () => void }> = ({ rotulo, n, marcada, onClick }) => (
  <button
    onClick={onClick}
    role="checkbox"
    aria-checked={marcada}
    className="w-full min-h-[44px] flex items-center gap-3 px-3 rounded-[12px] text-left text-[14px] text-[var(--ag-text)] hover:bg-[var(--ag-fill)]"
  >
    <span
      className="w-[20px] h-[20px] rounded-[6px] grid place-items-center shrink-0"
      style={marcada ? { background: 'var(--ag-text)', color: 'var(--ag-bg-2)' } : { border: '1.5px solid var(--ag-hairline-2)' }}
    >
      {marcada && <Check className="w-3 h-3" strokeWidth={3} />}
    </span>
    <span className="flex-1">{rotulo}</span>
    <span className="tabular-nums text-[12.5px] text-[var(--ag-text-3)]">{n}</span>
  </button>
);

const Grupo: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <section className="flex flex-col gap-0.5">
    <h3 className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">{titulo}</h3>
    {children}
  </section>
);

function alternar<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

const PainelFiltros: React.FC<Props> = ({ filtros, contagem, onMudar, onFechar, folha }) => {
  const [buscaCategoria, setBuscaCategoria] = useState('');
  const categorias = useMemo(() => {
    const q = buscaCategoria.trim().toLowerCase();
    return Object.entries(contagem.categoria)
      .filter(([nome]) => !q || nome.toLowerCase().includes(q))
      .sort((a, b) => b[1] - a[1]);
  }, [contagem.categoria, buscaCategoria]);

  const corpo = (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[15px] font-semibold text-[var(--ag-text)]">Filtros</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMudar(FILTROS_VAZIOS)} className="h-9 px-3 rounded-full text-[13px] font-medium text-[var(--ag-text-2)] hover:text-[var(--ag-text)]">Limpar</button>
          <button onClick={onFechar} aria-label="Fechar filtros" className="w-9 h-9 grid place-items-center rounded-full text-[var(--ag-text-2)]"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <Grupo titulo="Integração">
        {OPCOES_INTEGRACAO.map((o) => (
          <Opcao key={o} rotulo={ROTULO_OPCAO[o]} n={contagem.integracao[o]} marcada={filtros.integracao.includes(o)}
            onClick={() => onMudar({ ...filtros, integracao: alternar(filtros.integracao, o) })} />
        ))}
      </Grupo>
      <Grupo titulo="Sincronização">
        {OPCOES_SYNC.map((o) => (
          <Opcao key={o} rotulo={ROTULO_OPCAO[o]} n={contagem.sync[o]} marcada={filtros.sync.includes(o)}
            onClick={() => onMudar({ ...filtros, sync: alternar(filtros.sync, o) })} />
        ))}
      </Grupo>
      <Grupo titulo="Conteúdo">
        {OPCOES_CONTEUDO.map((o) => (
          <Opcao key={o} rotulo={ROTULO_OPCAO[o]} n={contagem.conteudo[o]} marcada={filtros.conteudo.includes(o)}
            onClick={() => onMudar({ ...filtros, conteudo: alternar(filtros.conteudo, o) })} />
        ))}
      </Grupo>
      <Grupo titulo="Categoria">
        <label className="relative flex items-center mx-3 mb-1">
          <Search className="absolute left-3 w-4 h-4 text-[var(--ag-text-3)] pointer-events-none" />
          <input
            value={buscaCategoria}
            onChange={(e) => setBuscaCategoria(e.target.value)}
            placeholder="Buscar categoria"
            className="w-full h-10 pl-9 pr-3 rounded-full text-[16px] md:text-[13.5px] outline-none text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)]"
            style={{ background: 'var(--ag-fill)', border: '1px solid var(--ag-hairline)' }}
          />
        </label>
        <div className="max-h-[220px] overflow-y-auto ag-scroll">
          {categorias.map(([nome, n]) => (
            <Opcao key={nome} rotulo={nome} n={n} marcada={filtros.categoria.includes(nome)}
              onClick={() => onMudar({ ...filtros, categoria: alternar(filtros.categoria, nome) })} />
          ))}
        </div>
      </Grupo>
    </div>
  );

  if (folha) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-label="Filtros">
        <button aria-label="Fechar filtros" className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={onFechar} />
        <div className="relative ag-glass-strong rounded-t-[24px] max-h-[85dvh] overflow-y-auto ag-scroll pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="mx-auto mt-2 w-10 h-1 rounded-full" style={{ background: 'var(--ag-hairline-2)' }} />
          {corpo}
        </div>
      </div>
    );
  }
  return (
    <div
      className="absolute right-0 top-[calc(100%+8px)] z-40 w-[340px] max-h-[70vh] overflow-y-auto ag-scroll ag-glass-strong rounded-[20px] pb-2"
      style={{ boxShadow: 'var(--ag-shadow)', border: '1px solid var(--ag-hairline)' }}
      role="dialog"
      aria-label="Filtros"
    >
      {corpo}
    </div>
  );
};

export default PainelFiltros;
