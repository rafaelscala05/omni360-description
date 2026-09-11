// Tab bar flutuante de vidro (mobile), no padrão de navegação de app da Apple.
//
// Substitui a barra inferior chapada que existia antes. Três diferenças que
// importam: ela flutua sobre o conteúdo com blur (em vez de ser uma faixa
// opaca colada na borda), o destino principal passa a ser o chat do agente
// quando a conta tem algum módulo habilitado, e Integrações ganha um atalho
// direto — era o item que o usuário mais precisa alcançar e só existia
// enterrado no menu lateral.
//
// Créditos e Categorias saíram da barra: ambos continuam a um toque no menu
// lateral, e Créditos também no cabeçalho. Cinco alvos + FAB não cabem em
// 360px sem encolher a área de toque abaixo dos 44px do HIG.

import React from 'react';
import { Layout, Menu, Plug, Plus, Sparkles } from 'lucide-react';

export type TabDestino = 'home' | 'products' | 'integrations';

interface Props {
  atual: string;
  /** Conta com módulo de conteúdo ou de operações — sem isso o chat não existe. */
  mostrarAgente: boolean;
  onNavegar: (destino: TabDestino) => void;
  onNovoProduto: () => void;
  onMenu: () => void;
}

const Item: React.FC<{
  ativo: boolean;
  rotulo: string;
  icone: React.ReactNode;
  onClick: () => void;
}> = ({ ativo, rotulo, icone, onClick }) => (
  <button
    onClick={onClick}
    aria-current={ativo ? 'page' : undefined}
    className={`relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] py-1 transition-colors ${
      ativo ? 'text-[#FF5B03]' : 'text-slate-400'
    }`}
  >
    {ativo && (
      <span className="absolute -top-1.5 w-8 h-[3px] rounded-full bg-[#FF5B03]" />
    )}
    {icone}
    <span className={`text-[10px] leading-none ${ativo ? 'font-bold' : 'font-medium'}`}>{rotulo}</span>
  </button>
);

const AppTabBar: React.FC<Props> = ({ atual, mostrarAgente, onNavegar, onNovoProduto, onMenu }) => (
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
      {mostrarAgente && (
        <Item
          ativo={atual === 'home'}
          rotulo="Alfreds"
          icone={<Sparkles className="w-[19px] h-[19px]" />}
          onClick={() => onNavegar('home')}
        />
      )}

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

      <Item
        ativo={false}
        rotulo="Menu"
        icone={<Menu className="w-[19px] h-[19px]" />}
        onClick={onMenu}
      />
    </div>
  </div>
);

export default AppTabBar;
