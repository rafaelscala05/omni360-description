// Renderizador desktop: conversa à esquerda, palco à direita.
// Mesmo contrato do MissionChat — a missão não sabe qual dos dois está ativo.

import React from 'react';
import Stage from './Stage';
import { Bolha, Botoes, Trilho, type RendererProps } from './MissionChat';

const MissionSplit: React.FC<RendererProps> = ({ titulo, passo, turnos, palco, acoes }) => (
  <div className="mx-auto w-full max-w-5xl p-6">
    <div className="grid grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] min-h-[520px] rounded-2xl overflow-hidden border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-r border-slate-200 p-5">
        <Trilho {...passo} />
        <h2 className="font-display text-xl font-extrabold tracking-tight">{titulo}</h2>
        <div className="flex flex-col gap-2 flex-1">
          {turnos.map((t, i) => <Bolha key={i} turno={t} />)}
        </div>
        <Botoes acoes={acoes} />
      </div>
      <div className="flex flex-col gap-3 bg-[#f7f9fb] p-5">
        {palco && <Stage {...palco} />}
      </div>
    </div>
  </div>
);

export default MissionSplit;
