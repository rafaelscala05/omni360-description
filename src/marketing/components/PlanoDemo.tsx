// O card de Plano do chat (`chat/PlanoCard.tsx`) em versão estática: o que o
// turno leu, o que você revisa e onde vai gravar.

import { Check } from 'lucide-react';
import AlfredLogo from '../../components/alfredLogo/AlfredLogo';

type Passo = { texto: string; detalhe?: string; estado: 'feito' | 'agora' | 'depois' };

const PASSOS: Passo[] = [
  { texto: 'Leu 48 produtos do catálogo', estado: 'feito' },
  { texto: 'Conferiu o cadastro atual no Tiny', estado: 'feito' },
  { texto: 'Você revisa 12 descrições', detalhe: 'Uma por vez, com antes e depois', estado: 'agora' },
  { texto: 'Gravar no Tiny', detalhe: 'Só título, descrição, SEO e imagens', estado: 'depois' },
];

export default function PlanoDemo() {
  return (
    <div className="ag-glass-strong ag-sheen rounded-[30px] p-5 sm:p-6" aria-label="Exemplo do card de plano do Alfred">
      <div className="ag-glass rounded-[18px] rounded-br-[6px] ml-auto max-w-[85%] px-4 py-3 text-[14.5px] text-[var(--ag-text)]">
        Escreve a descrição dos produtos de mochila que estão sem texto e manda pro Tiny.
      </div>

      <div className="mt-5 flex items-center gap-2.5">
        <AlfredLogo size={28} interativo={false} />
        <p className="text-[15px] font-semibold text-[var(--ag-text)]">Plano</p>
      </div>

      <ol className="mt-4 flex flex-col">
        {PASSOS.map((p, i) => {
          const ultimo = i === PASSOS.length - 1;
          return (
            <li key={p.texto} className="relative flex gap-3 pb-4">
              {!ultimo && <span aria-hidden className="absolute left-[11px] top-7 bottom-0 w-px" style={{ background: 'var(--ag-hairline-2)' }} />}
              <span
                className="relative w-6 h-6 rounded-full grid place-items-center shrink-0"
                style={
                  p.estado === 'feito'
                    ? { background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }
                    : p.estado === 'agora'
                      ? { background: 'var(--ag-accent)', color: '#fff' }
                      : { border: '1.5px solid var(--ag-hairline-2)' }
                }
              >
                {p.estado === 'feito' && <Check className="w-3.5 h-3.5" />}
                {p.estado === 'agora' && <span className="w-2 h-2 rounded-full bg-white" />}
              </span>
              <div className="pt-0.5">
                <p className="text-[14.5px]" style={{ color: p.estado === 'depois' ? 'var(--ag-text-2)' : 'var(--ag-text)', fontWeight: p.estado === 'agora' ? 600 : 400 }}>
                  {p.texto}
                </p>
                {p.detalhe && <p className="text-[12.5px] text-[var(--ag-text-3)]">{p.detalhe}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-1 flex items-center justify-between rounded-[16px] px-4 py-3" style={{ background: 'var(--ag-fill)' }}>
        <span className="text-[13.5px] text-[var(--ag-text-2)]">Custo, antes de confirmar</span>
        <span className="text-[14px] font-semibold tabular-nums text-[var(--ag-text)]">36 créditos</span>
      </div>

      <div className="mt-3 flex gap-2" aria-hidden>
        <span className="flex-1 min-h-[44px] rounded-full grid place-items-center text-[14px] font-semibold text-white" style={{ background: 'var(--ag-accent)' }}>
          Revisar e aprovar
        </span>
        <span className="min-h-[44px] px-4 rounded-full grid place-items-center text-[14px] font-semibold" style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}>
          Ajustar no chat
        </span>
      </div>
    </div>
  );
}
