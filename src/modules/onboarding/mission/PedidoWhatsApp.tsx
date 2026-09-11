// Pedido de WhatsApp durante a espera: o número é pedido como serviço ("te
// aviso quando ficar pronto"), com o bônus de onboarding como contrapartida.
// Compartilhado pelas duas missões; aparece dentro do palco.

import React, { useState } from 'react';
import { formatarWhatsapp, normalizarWhatsapp, whatsappValido } from './whatsapp';
import { ONBOARDING_BONUS, WHATSAPP_CONSENT_TEXT } from '../../../types/onboarding';

interface Props {
  onEnviar: (whatsapp: string) => Promise<void>;
}

const PedidoWhatsApp: React.FC<Props> = ({ onEnviar }) => {
  const [valor, setValor] = useState('');
  const [estado, setEstado] = useState<'aberto' | 'enviando' | 'feito' | 'recusado'>('aberto');
  const [erro, setErro] = useState<string | null>(null);
  const digitos = normalizarWhatsapp(valor);

  if (estado === 'recusado') return null;
  if (estado === 'feito') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <b>Anotado.</b> Te chamo quando ficar pronto — e os {ONBOARDING_BONUS} créditos já estão na sua conta.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 border-l-[3px] border-l-[#FF5B03] bg-white p-3">
      <p className="text-xs leading-relaxed">
        Isso leva uns minutos. Te chamo no WhatsApp quando ficar pronto? Você ganha <b>{ONBOARDING_BONUS} créditos</b>.
      </p>
      <input
        id="missao-whatsapp"
        type="tel"
        inputMode="tel"
        value={valor}
        onChange={(e) => setValor(formatarWhatsapp(normalizarWhatsapp(e.target.value)))}
        placeholder="(11) 98765-4321"
        className="w-full rounded-lg border border-slate-200 bg-[#f7f9fb] px-3 py-2 font-mono text-xs"
      />
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!whatsappValido(digitos) || estado === 'enviando'}
          onClick={async () => {
            setErro(null);
            setEstado('enviando');
            try {
              await onEnviar(valor);
              setEstado('feito');
            } catch (e) {
              setErro(e instanceof Error ? e.message : 'Não consegui salvar agora.');
              setEstado('aberto');
            }
          }}
          className="flex-1 min-h-[44px] rounded-xl bg-[#FF5B03] px-3 text-xs font-semibold text-white disabled:opacity-40"
        >
          {estado === 'enviando' ? 'Salvando…' : 'Pode me chamar'}
        </button>
        <button
          type="button"
          onClick={() => setEstado('recusado')}
          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600"
        >
          Espero aqui
        </button>
      </div>
      <p className="text-[10px] leading-snug text-slate-400">{WHATSAPP_CONSENT_TEXT}</p>
    </div>
  );
};

export default PedidoWhatsApp;
