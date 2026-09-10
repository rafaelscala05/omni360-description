// Tela 0: a pergunta é "o que você quer resolver", não "qual agente".
//
// Duas variantes honestas. Conta vazia (caso principal): nada
// pré-selecionado e nenhum número. Conta com catálogo: Produto vem marcado
// com a contagem real.

import React, { useState } from 'react';
import { MISSOES, sugerirTrilha } from './missionSteps';
import type { AccountSignal, MissionId } from './missionTypes';
import { trackMissionStarted } from '../../../analytics';

interface Props {
  signal: AccountSignal;
  semDescricao: number;
  onEscolher: (missionId: MissionId) => void;
}

const MissionPicker: React.FC<Props> = ({ signal, semDescricao, onEscolher }) => {
  const { sugerida, variante } = sugerirTrilha(signal);
  const [escolhida, setEscolhida] = useState<MissionId | null>(sugerida);

  const dadoProduto =
    variante === 'com-catalogo'
      ? `${signal.produtos} produtos · ${semDescricao} sem descrição`
      : 'comece colando o link de um produto';
  const dadoConteudo =
    signal.temProjetoConteudo ? 'você já tem um projeto de conteúdo' : 'seu site ainda não tem blog';

  const cartao = (id: MissionId, dado: string) => {
    const def = MISSOES[id];
    const ativo = escolhida === id;
    const escuro = id === 'conteudo';
    return (
      <button
        key={id}
        type="button"
        onClick={() => setEscolhida(id)}
        aria-pressed={ativo}
        className={[
          'relative w-full text-left rounded-2xl border p-4 flex flex-col gap-1.5 transition',
          escuro ? 'bg-[#141311] text-[#E8E0D5] border-[#141311]' : 'bg-white border-slate-200',
          ativo ? 'ring-2 ring-[#FF5B03] border-[#FF5B03]' : '',
        ].join(' ')}
      >
        {ativo && sugerida === id && (
          <span className="absolute -top-2.5 left-4 rounded-full bg-[#FF5B03] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Sugerido pra você
          </span>
        )}
        <span className="font-display text-base font-bold leading-tight">{def.resultado}</span>
        <span className={escuro ? 'text-xs text-[#E8E0D5]/60' : 'text-xs text-slate-500'}>{dado}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF5B03]">{def.agente}</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#f7f9fb]">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-5">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            O que você quer resolver primeiro?
          </h1>
          <p className="mt-1 text-sm text-slate-500">Dá pra fazer os dois. Comece pelo que aperta mais.</p>
        </div>
        <div className="flex flex-col gap-3">
          {cartao('produto', dadoProduto)}
          {cartao('conteudo', dadoConteudo)}
        </div>
        <button
          type="button"
          disabled={!escolhida}
          onClick={() => {
            if (!escolhida) return;
            trackMissionStarted({
              missionId: escolhida,
              sugerida,
              aceitouSugestao: escolhida === sugerida,
            });
            onEscolher(escolhida);
          }}
          className="w-full min-h-[44px] rounded-xl bg-[#FF5B03] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Começar
        </button>
        <p className="text-center text-[11px] text-slate-400">
          {escolhida ? 'Uns 4 minutos. Pode parar e voltar depois.' : 'Escolha um para começar. Pode parar e voltar depois.'}
        </p>
      </div>
    </div>
  );
};

export default MissionPicker;
