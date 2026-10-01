// Tab bar flutuante de vidro (mobile), no padrão de navegação de app da Apple.
//
// Com algum módulo de agente habilitado, a barra são as três portas do produto
// — Alfred (a semana + o chat), Atividade (o que espera aprovação e o que já
// foi feito) e Ferramentas (o painel de cada agente). Não há mais o Menu: as
// ferramentas estão em Ferramentas e a Conta (créditos, integrações, empresa,
// ajuda, sair…) sai do avatar no topo de cada tela (`ContaMenu.tsx`). A tela
// do Alfred esconde a barra enquanto o campo de digitar está focado, para o
// teclado ficar só com o composer.
//
// Sem módulo de agente não há chat nem atividade: a barra antiga (Catálogo,
// novo produto, Integrações) continua valendo.
//
// A barra é vidro do design system do agente (tokens `--ag-*`, escopo
// `.alfreds`): segue o tema claro/escuro que o usuário escolheu no Alfred, em
// qualquer tela. Cor nenhuma aqui é literal — um `text-slate-500` solto some
// sobre o vidro escuro.

import React from 'react';
import { Bell, Columns3, Layout, Menu, Plug, Plus } from 'lucide-react';
import { useAgentTheme } from '../modules/agent/theme';

export type TabDestino = 'home' | 'atividade' | 'ferramentas' | 'products' | 'integrations';

interface Props {
  atual: string;
  /** Conta com módulo de conteúdo ou de operações — sem isso o chat não existe. */
  mostrarAgente: boolean;
  /** Aprovações do Alfred esperando o usuário — selo na aba Atividade. */
  pendentes?: number;
  onNavegar: (destino: TabDestino) => void;
  onNovoProduto: () => void;
  /** Gaveta do menu antigo — só na barra de quem não tem agente. */
  onMenu: () => void;
}

const Item: React.FC<{
  ativo: boolean;
  rotulo: string;
  icone: React.ReactNode;
  selo?: number;
  onClick: () => void;
}> = ({ ativo, rotulo, icone, selo, onClick }) => (
  <button
    onClick={onClick}
    aria-current={ativo ? 'page' : undefined}
    aria-label={selo ? `${rotulo}, ${selo} pendente(s)` : undefined}
    className="relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] py-1 transition-colors"
    style={{ color: ativo ? 'var(--ag-text)' : 'var(--ag-text-2)' }}
  >
    {ativo && (
      <span className="absolute inset-x-1.5 -inset-y-0.5 rounded-[18px]" style={{ background: 'var(--ag-fill-2)' }} />
    )}
    <span className="relative">
      {icone}
      {!!selo && (
        <span
          className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-semibold leading-[17px] text-center"
          style={{ background: 'var(--ag-accent)', color: 'var(--ag-accent-ink)' }}
        >
          {selo > 99 ? '99+' : selo}
        </span>
      )}
    </span>
    <span className={`relative text-[10px] leading-none ${ativo ? 'font-bold' : 'font-medium'}`}>{rotulo}</span>
  </button>
);

const Barra: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { tema } = useAgentTheme();
  return (
    <div
      className="alfreds md:hidden fixed left-0 right-0 bottom-0 z-30 px-3 pointer-events-none"
      data-tema={tema}
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="ag-glass-strong ag-sheen pointer-events-auto relative flex items-center gap-1 px-2 pt-2 pb-1.5 rounded-[26px]">
        {children}
      </div>
    </div>
  );
};

const Orbe: React.FC = () => (
  <span
    className="block w-[19px] h-[19px] rounded-full"
    style={{ background: 'var(--ag-accent)', boxShadow: 'inset 0 0 0 3.5px color-mix(in srgb, var(--ag-accent) 45%, var(--ag-bg-2))' }}
  />
);

const AppTabBar: React.FC<Props> = ({ atual, mostrarAgente, pendentes = 0, onNavegar, onNovoProduto, onMenu }) => {
  if (mostrarAgente) {
    return (
      <Barra>
        <Item ativo={atual === 'home'} rotulo="Alfred" icone={<Orbe />} onClick={() => onNavegar('home')} />
        <Item
          ativo={atual === 'atividade'}
          rotulo="Atividade"
          icone={<Bell className="w-[19px] h-[19px]" />}
          selo={pendentes}
          onClick={() => onNavegar('atividade')}
        />
        <Item
          ativo={atual === 'ferramentas'}
          rotulo="Ferramentas"
          icone={<Columns3 className="w-[19px] h-[19px]" />}
          onClick={() => onNavegar('ferramentas')}
        />
      </Barra>
    );
  }

  return (
    <Barra>
      <Item
        ativo={atual === 'products'}
        rotulo="Catálogo"
        icone={<Layout className="w-[19px] h-[19px]" />}
        onClick={() => onNavegar('products')}
      />

      <div className="flex-none w-14 flex justify-center relative">
        <button
          onClick={onNovoProduto}
          title="Novo Produto"
          className="absolute -top-[30px] w-[54px] h-[54px] rounded-full flex items-center justify-center transition-transform active:scale-95"
          style={{
            background: 'var(--ag-accent)',
            color: 'var(--ag-accent-ink)',
            border: '4px solid var(--ag-bg-2)',
            boxShadow: '0 10px 24px -6px var(--ag-accent)',
          }}
        >
          <Plus className="w-[22px] h-[22px]" />
        </button>
      </div>

      <Item
        ativo={atual === 'integrations'}
        rotulo="Integrações"
        icone={<Plug className="w-[19px] h-[19px]" />}
        onClick={() => onNavegar('integrations')}
      />

      <Item ativo={false} rotulo="Menu" icone={<Menu className="w-[19px] h-[19px]" />} onClick={onMenu} />
    </Barra>
  );
};

export default AppTabBar;

