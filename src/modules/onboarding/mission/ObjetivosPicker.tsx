// Tela 0 da coorte missao-v2: "o que você quer resolver", vários objetivos,
// o primeiro marcado vira a missão desta sessão (uma por sessão). Os outros
// ficam na Semana do Alfred.

import React, { useState } from 'react';
import { OBJETIVOS, type Objetivo } from '../../agent/capacidades';
import { OBJETIVO_INFO, alternarObjetivo, rotuloComecar } from './objetivos';

interface Props {
  onComecar: (objetivos: Objetivo[]) => Promise<void>;
}

const ObjetivosPicker: React.FC<Props> = ({ onComecar }) => {
  const [sel, setSel] = useState<Objetivo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comecar = async () => {
    if (!sel.length || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onComecar(sel);
    } catch {
      setErro('Não conseguimos ativar agora. Confira a conexão e toque de novo.');
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f9fb]">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-5">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">O que você quer resolver?</h1>
          <p className="mt-1 text-sm text-slate-500">Pode marcar mais de um. Começamos pelo primeiro.</p>
        </div>
        <div className="flex flex-col gap-3">
          {OBJETIVOS.map((o) => {
            const i = sel.indexOf(o);
            const info = OBJETIVO_INFO[o];
            return (
              <button
                key={o}
                type="button"
                aria-pressed={i >= 0}
                onClick={() => setSel((s) => alternarObjetivo(s, o))}
                className={[
                  'w-full text-left rounded-2xl border bg-white p-4 grid grid-cols-[24px_1fr] gap-3 transition',
                  i >= 0 ? 'border-[#FF5B03] ring-2 ring-[#FF5B03]/20' : 'border-slate-200',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'mt-0.5 h-6 w-6 rounded-md border grid place-items-center text-xs font-bold',
                    i >= 0 ? 'bg-[#FF5B03] border-[#FF5B03] text-white' : 'border-slate-300',
                  ].join(' ')}
                >
                  {i >= 0 ? i + 1 : ''}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-display text-base font-bold leading-tight">{info.titulo}</span>
                  <span className="text-xs text-slate-500">{info.sub}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF5B03]">{info.agente}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={!sel.length || enviando}
          onClick={comecar}
          className="w-full min-h-[44px] rounded-xl bg-[#FF5B03] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {enviando ? 'Ativando…' : rotuloComecar(sel)}
        </button>
        {erro && <p role="alert" className="text-center text-xs text-red-600">{erro}</p>}
        <p className="text-center text-[11px] text-slate-400">Uns 5 minutos. Pode parar e voltar depois.</p>
      </div>
    </div>
  );
};

export default ObjetivosPicker;
