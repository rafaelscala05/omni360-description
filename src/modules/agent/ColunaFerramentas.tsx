import React from 'react';
import { LayoutGrid } from 'lucide-react';
import type { OrigemTarefa } from './semana';
import { ORIGEM } from './SemanaPanel';
import { ICONE } from './FerramentasScreen';

/**
 * Segunda coluna da porta Ferramentas no desktop: na visão geral e em cada
 * ferramenta (Produtos, Mercado Livre, Conteúdo…), os agentes ficam à mão para trocar de
 * um para o outro sem voltar à visão geral. Sempre recolhida (só ícones, o
 * nome numa etiqueta ao passar o mouse). Mesmo ícone e cor dos cartões de
 * Ferramentas. Só existe a partir de `md` — no telefone quem troca é a tab bar.
 */
const ColunaFerramentas: React.FC<{
  /** `visao` = a visão geral de Ferramentas está aberta. */
  atual: OrigemTarefa | 'visao' | null;
  hasMeli: boolean;
  hasContentAgent: boolean;
  onAbrir: (origem: OrigemTarefa) => void;
  onVisaoGeral: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Só quando a coluna abre o próprio escopo `.alfreds` (fora da folha do App). */
  tema?: 'claro' | 'escuro';
}> = ({ atual, hasMeli, hasContentAgent, onAbrir, onVisaoGeral, className = '', style, tema }) => {
  const itens: Array<{ origem: OrigemTarefa; nome: string }> = [
    { origem: 'produto', nome: 'Produtos' },
    ...(hasMeli ? [{ origem: 'meli' as const, nome: 'Mercado Livre' }] : []),
    ...(hasContentAgent ? [{ origem: 'conteudo' as const, nome: 'Conteúdo' }] : []),
    { origem: 'operacoes', nome: 'Operações' },
  ];
  return (
    <nav
      aria-label="Agentes"
      data-tema={tema}
      className={`hidden md:flex w-[64px] shrink-0 flex-col items-center gap-1.5 py-4 relative z-30 ${className}`}
      style={{ borderRight: '1px solid var(--ag-hairline)', ...style }}
    >
      <Item rotulo="Visão geral" ativo={atual === 'visao'} onClick={onVisaoGeral}>
        <span
          className="w-10 h-10 rounded-[12px] grid place-items-center transition-[background,box-shadow,color]"
          style={atual === 'visao'
            ? { background: 'var(--ag-fill-2)', color: 'var(--ag-text)', boxShadow: 'inset 0 0 0 1.5px var(--ag-hairline-2)' }
            : { color: 'var(--ag-text-2)' }}
        >
          <LayoutGrid className="w-[18px] h-[18px]" />
        </span>
      </Item>
      <span aria-hidden className="w-6 my-0.5" style={{ borderTop: '1px solid var(--ag-hairline)' }} />
      {itens.map(({ origem, nome }) => {
        const Icone = ICONE[origem];
        const cor = ORIGEM[origem].cor;
        const ativo = atual === origem;
        return (
          <Item key={origem} rotulo={nome} ativo={ativo} onClick={() => onAbrir(origem)}>
            <span
              className="w-10 h-10 rounded-[12px] grid place-items-center transition-[background,box-shadow,color]"
              style={ativo
                ? { background: `color-mix(in srgb, ${cor} 18%, transparent)`, color: cor, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${cor} 45%, transparent)` }
                : { color: 'var(--ag-text-2)' }}
            >
              <Icone className="w-[19px] h-[19px]" strokeWidth={1.9} />
            </span>
          </Item>
        );
      })}
    </nav>
  );
};

/**
 * Um botão da coluna: só o ícone; o nome aparece numa etiqueta ao lado ao
 * passar o mouse (ou focar pelo teclado). O `aria-label` dá o nome a leitores
 * de tela, já que a etiqueta é decorativa.
 */
const Item: React.FC<{ rotulo: string; ativo?: boolean; onClick: () => void; children: React.ReactNode }> = ({ rotulo, ativo, onClick, children }) => (
  <button
    onClick={onClick}
    aria-label={rotulo}
    aria-current={ativo ? 'page' : undefined}
    className="group relative rounded-[12px] outline-none hover:bg-[var(--ag-fill)] focus-visible:bg-[var(--ag-fill)] transition-colors"
  >
    {children}
    <span
      aria-hidden
      className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 whitespace-nowrap px-2.5 py-1.5 rounded-[10px] text-[12.5px] font-semibold opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
      style={{ background: 'var(--ag-text)', color: 'var(--ag-surface-solid)', boxShadow: 'var(--ag-shadow-sm)' }}
    >
      {rotulo}
    </span>
  </button>
);

export default ColunaFerramentas;
