// Renderizador mobile: diálogo empilhado, o palco como cartão inline.
// Não guarda regra de negócio — desenha os turnos que a missão entrega.

import React from 'react';
import Stage, { type StageProps } from './Stage';

export interface Turno {
  autor: 'agente' | 'usuario';
  texto: React.ReactNode;
}

export interface Acao {
  rotulo: string;
  onClick: () => void;
  variante?: 'primaria' | 'secundaria';
  desabilitada?: boolean;
}

export interface RendererProps {
  titulo: string;
  passo: { indice: number; total: number; titulo: string };
  turnos: Turno[];
  palco?: StageProps;
  acoes: Acao[];
}

export const Trilho: React.FC<{ indice: number; total: number; titulo: string }> = ({ indice, total, titulo }) => (
  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
    <span>Etapa <b className="text-[#FF5B03]">{indice}</b> de {total}</span>
    <span className="flex-1 h-[3px] rounded-full bg-slate-200 overflow-hidden">
      <i className="block h-full bg-[#FF5B03]" style={{ width: `${(indice / total) * 100}%` }} />
    </span>
    <span>{titulo}</span>
  </div>
);

export const Bolha: React.FC<{ turno: Turno }> = ({ turno }) => (
  <div
    className={
      turno.autor === 'agente'
        ? 'self-start max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm'
        : 'self-end max-w-[88%] rounded-2xl rounded-br-md bg-[#141311] px-3 py-2 text-sm text-[#E8E0D5]'
    }
  >
    {turno.texto}
  </div>
);

export const Botoes: React.FC<{ acoes: Acao[] }> = ({ acoes }) => (
  <div className="flex flex-col gap-2">
    {acoes.map((a) => (
      <button
        key={a.rotulo}
        type="button"
        onClick={a.onClick}
        disabled={a.desabilitada}
        className={
          a.variante === 'secundaria'
            ? 'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 min-h-[44px] disabled:opacity-40'
            : 'w-full rounded-xl bg-[#FF5B03] px-4 py-2.5 text-sm font-semibold text-white min-h-[44px] disabled:opacity-40'
        }
      >
        {a.rotulo}
      </button>
    ))}
  </div>
);

const MissionChat: React.FC<RendererProps> = ({ passo, turnos, palco, acoes }) => (
  <div className="flex flex-col gap-3 p-4 pb-24">
    <Trilho {...passo} />
    <div className="flex flex-col gap-2">
      {turnos.map((t, i) => <Bolha key={i} turno={t} />)}
    </div>
    {palco && <Stage {...palco} />}
    <Botoes acoes={acoes} />
  </div>
);

export default MissionChat;
