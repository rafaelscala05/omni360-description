// Tab bar flutuante de vidro (mobile), no padrão de navegação de app da Apple.
//
// Com algum módulo de agente habilitado, a barra são as três portas do produto
// — Alfred (a semana + o chat), Atividade (o que espera aprovação e o que já
// foi feito) e Ferramentas (o painel de cada agente) — mais o Menu, que segue
// dando acesso ao resto. A tela do Alfred esconde a barra enquanto o campo de
// digitar está focado, para o teclado ficar só com o composer.
//
// Sem módulo de agente não há chat nem atividade: a barra antiga (Catálogo,
// novo produto, Integrações) continua valendo.

import React from 'react';
import { Bell, Columns3, Layout, Menu, Plug, Plus } from 'lucide-react';

export type TabDestino = 'home' | 'atividade' | 'ferramentas' | 'products' | 'integrations';

interface Props {
  atual: string;
  /** Conta com módulo de conteúdo ou de operações — sem isso o chat não existe. */
  mostrarAgente: boolean;
  /** Aprovações do Alfred esperando o usuário — selo na aba Atividade. */
  pendentes?: number;
  onNavegar: (destino: TabDestino) => void;
  onNovoProduto: () => void;
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
    className={`relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] py-1 transition-colors ${
      ativo ? 'text-[#0b0d12]' : 'text-slate-500'
    }`}
  >
    {ativo && (
      <span className="absolute inset-x-1.5 -inset-y-0.5 rounded-[18px] bg-[rgba(15,23,42,.06)]" />
    )}
    <span className="relative">
      {icone}
      {!!selo && (
        <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#B83F00] text-white text-[10px] font-semibold leading-[17px] text-center">
          {selo > 99 ? '99+' : selo}
        </span>
      )}
    </span>
    <span className={`relative text-[10px] leading-none ${ativo ? 'font-bold' : 'font-medium'}`}>{rotulo}</span>
  </button>
);

const Barra: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="md:hidden fixed left-0 right-0 bottom-0 z-30 px-3 pointer-events-none"
    style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
  >
    <div
      className="pointer-events-auto relative flex items-center gap-1 px-2 pt-2 pb-1.5 rounded-[26px] border border-white/60"
      style={{
        background: 'rgba(255,255,255,.78)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), 0 8px 30px -10px rgba(9,12,20,.28)',
      }}
    >
      {children}
    </div>
  </div>
);

const Orbe: React.FC = () => (
  <span
    className="block w-[19px] h-[19px] rounded-full"
    style={{ background: '#ff5b03', boxShadow: 'inset 0 0 0 3.5px #ffb27f' }}
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
        <Item ativo={false} rotulo="Menu" icone={<Menu className="w-[19px] h-[19px]" />} onClick={onMenu} />
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
          className="absolute -top-[30px] w-[54px] h-[54px] rounded-full flex items-center justify-center text-white transition-transform active:scale-95"
          style={{
            background: 'linear-gradient(160deg,#ff7a33,#ff5b03)',
            border: '4px solid rgba(255,255,255,.85)',
            boxShadow: '0 10px 24px -6px rgba(255,91,3,.55)',
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

