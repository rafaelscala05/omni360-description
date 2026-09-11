// A trilha de missões: para onde a coorte nova volta depois da primeira missão.

import React from 'react';
import type { EstadoItem, ItemId, ItemTrilha } from './trilha';

interface Props {
  nome: string;
  itens: ItemTrilha[];
  onAcao: (id: ItemId, estado: EstadoItem) => void;
}

const rotuloAcao: Record<ItemTrilha['estado'], string> = {
  feito: 'Ver', agora: 'Começar', bloqueado: '—', opcional: 'Quando precisar',
};

const TrilhaMissoes: React.FC<Props> = ({ nome, itens, onAcao }) => {
  const feitos = itens.filter((i) => i.estado === 'feito').length;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">{nome ? `Oi, ${nome}.` : 'Suas missões'}</h1>
        <p className="text-sm text-slate-500">
          {feitos === 0 ? 'Comece por uma — cada missão termina em algo que você consegue abrir.' : `Sua loja já está ${feitos} ${feitos === 1 ? 'missão' : 'missões'} à frente.`}
        </p>
      </div>
      <ol className="flex flex-col rounded-2xl border border-slate-200 bg-white px-4">
        {itens.map((item, i) => (
          <li key={item.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-slate-100 py-3 last:border-b-0">
            <span
              className={[
                'grid h-6 w-6 place-items-center rounded-full border text-[11px] font-bold',
                item.estado === 'feito' ? 'border-emerald-700 bg-emerald-700 text-white' : '',
                item.estado === 'agora' ? 'border-[#FF5B03] text-[#FF5B03]' : '',
                item.estado === 'bloqueado' || item.estado === 'opcional' ? 'border-slate-300 text-slate-400' : '',
              ].join(' ')}
            >
              {item.estado === 'feito' ? '✓' : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${item.estado === 'feito' ? 'text-slate-400 line-through' : ''}`}>{item.titulo}</span>
              <span className="block text-xs text-slate-500">{item.meta}</span>
            </span>
            <button
              type="button"
              disabled={item.estado === 'bloqueado'}
              onClick={() => onAcao(item.id, item.estado)}
              className={`min-h-[44px] px-2 text-xs font-bold ${item.estado === 'agora' ? 'text-[#FF5B03]' : 'text-slate-400'} disabled:cursor-default`}
            >
              {rotuloAcao[item.estado]}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default TrilhaMissoes;
