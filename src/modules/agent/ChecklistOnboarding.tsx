// Checklist do onboarding na tela do Alfred: as etapas da trilha (trilha.ts),
// cada uma com o seu check. Enquanto houver etapa aberta (`emOnboarding`), é o
// que abre em cima e "Sua semana" fica recolhida embaixo.

import React from 'react';
import { Check, ChevronRight, Lock } from 'lucide-react';
import type { EstadoItem, ItemId, ItemTrilha } from '../onboarding/mission/trilha';

interface Props {
  itens: ItemTrilha[];
  onAcao: (id: ItemId, estado: EstadoItem) => void;
}

const ChecklistOnboarding: React.FC<Props> = ({ itens, onAcao }) => {
  // O opcional não conta no progresso: não é o que falta para terminar.
  const obrigatorios = itens.filter((i) => i.estado !== 'opcional');
  const feitos = obrigatorios.filter((i) => i.estado === 'feito').length;
  const pct = obrigatorios.length ? Math.round((feitos / obrigatorios.length) * 100) : 0;
  // A primeira etapa aberta é a vez de agora; as outras ficam em segundo plano.
  const vez = itens.find((i) => i.estado === 'agora')?.id;

  return (
    <section className="w-full flex flex-col gap-3 text-left" aria-label="Primeiros passos">
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Primeiros passos</h1>
        <span className="text-[13px] text-[var(--ag-text-2)] tabular-nums pb-1">{feitos} de {obrigatorios.length} feitos</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden -mt-1" style={{ background: 'var(--ag-fill-2)' }}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: 'var(--ag-text)' }} />
      </div>

      <ol className="ag-glass rounded-[22px] overflow-hidden">
        {itens.map((item, i) => {
          const feito = item.estado === 'feito';
          const bloqueado = item.estado === 'bloqueado';
          const daVez = item.id === vez;
          return (
            <li key={item.id} style={i > 0 ? { borderTop: '1px solid var(--ag-hairline)' } : undefined}>
              <button
                type="button"
                disabled={bloqueado}
                onClick={() => onAcao(item.id, item.estado)}
                className="w-full min-h-[56px] px-4 py-3 flex items-center gap-3 text-left disabled:cursor-default"
              >
                <span
                  className="w-6 h-6 rounded-full grid place-items-center shrink-0"
                  style={feito
                    ? { background: 'var(--ag-ok-soft)', color: 'var(--ag-ok)' }
                    : { border: `1.5px solid ${daVez ? 'var(--ag-accent)' : 'var(--ag-hairline-2)'}`, color: 'var(--ag-text-3)' }}
                  aria-hidden
                >
                  {feito ? <Check className="w-3.5 h-3.5" /> : bloqueado ? <Lock className="w-3 h-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[14.5px] font-semibold truncate ${feito ? 'line-through text-[var(--ag-text-2)]' : 'text-[var(--ag-text)]'}`}
                    style={feito ? { textDecorationColor: 'var(--ag-hairline-2)' } : undefined}
                  >
                    {item.titulo}
                  </span>
                  <span className="block text-[12px] text-[var(--ag-text-3)] truncate">
                    {item.estado === 'opcional' ? `Opcional · ${item.meta}` : item.meta}
                  </span>
                </span>
                {daVez ? (
                  <span className="shrink-0 px-3 py-1.5 rounded-full text-[12.5px] font-semibold" style={{ background: 'var(--ag-text)', color: 'var(--ag-bg-2)' }}>
                    Começar
                  </span>
                ) : !bloqueado && (
                  <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ag-text-3)]" />
                )}
                <span className="sr-only">{feito ? 'feito' : bloqueado ? 'bloqueado' : 'a fazer'}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default ChecklistOnboarding;
