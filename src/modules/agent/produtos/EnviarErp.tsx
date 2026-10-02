import React, { useEffect, useRef, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import type { Product } from '../../../types/models';

export type ErpEnvio = 'tiny' | 'wake';

const ROTULO: Record<ErpEnvio, string> = { tiny: 'Tiny', wake: 'Wake' };
const VINCULO: Record<ErpEnvio, (p: Product) => boolean> = {
  tiny: (p) => !!p._tinyProductId,
  wake: (p) => !!p._wakeProductId,
};

interface Props {
  selecionados: Product[];
  /** Integrações conectadas — a desconectada aparece, mas leva a Integrações. */
  conectadas: Record<ErpEnvio, boolean>;
  /** O mesmo envio do "Enviar para" da tabela (painel de envio, com log por produto). */
  onEnviar: (erp: ErpEnvio) => void;
  onConectar: () => void;
}

/**
 * "Enviar ao ERP" da barra de Produtos: manda a seleção ao Tiny ou à Wake.
 * Só vão os selecionados vinculados àquele ERP — a contagem diz quantos antes
 * de clicar, para não haver surpresa com os que ficam de fora.
 */
const EnviarErp: React.FC<Props> = ({ selecionados, conectadas, onEnviar, onConectar }) => {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const n = selecionados.length;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label={`Enviar os ${n} selecionados ao ERP`}
        title="Enviar ao ERP"
        className="min-h-[48px] w-12 sm:w-auto sm:px-4 rounded-full flex items-center justify-center gap-2 text-[14px] font-semibold"
        style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
      >
        <CloudUpload className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">Enviar</span>
      </button>
      {aberto && (
        <div
          role="menu"
          className="absolute right-0 bottom-[calc(100%+8px)] z-40 w-[260px] ag-glass-strong rounded-[18px] p-1.5 flex flex-col"
          style={{ boxShadow: 'var(--ag-shadow)', border: '1px solid var(--ag-hairline)' }}
        >
          <span className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ag-text-3)]">
            Enviar a seleção para
          </span>
          {(['tiny', 'wake'] as const).map((erp) => {
            const vinculados = selecionados.filter(VINCULO[erp]).length;
            const conectada = conectadas[erp];
            const pode = conectada && vinculados > 0;
            const detalhe = !conectada
              ? 'Não conectado · conectar'
              : vinculados === n ? `${n} ${n === 1 ? 'produto' : 'produtos'}` : `${vinculados} de ${n} vinculados`;
            return (
              <button
                key={erp}
                role="menuitem"
                disabled={conectada && !vinculados}
                onClick={() => { setAberto(false); if (pode) onEnviar(erp); else onConectar(); }}
                className="min-h-[44px] px-3 rounded-[12px] flex items-center gap-2 text-left hover:bg-[var(--ag-fill-2)] disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="flex-1 text-[14px] font-semibold text-[var(--ag-text)]">{ROTULO[erp]}</span>
                <span className="text-[12px] tabular-nums text-[var(--ag-text-2)]">{conectada && !vinculados ? 'nenhum vinculado' : detalhe}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EnviarErp;
