// Diálogo de confirmação em vidro: o fundo escurece, o cartão sobe com mola.
// Esc cancela, Enter confirma; o foco vai para o botão seguro (Cancelar)
// quando a ação é destrutiva.

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { inscreverConfirmacao, type PedidoConfirmacao } from '../../services/confirmar';
import { useAgentTheme } from '../../modules/agent/theme';
import { MOLA } from '../../modules/agent/movimento';

const Confirmacao: React.FC = () => {
  const { tema } = useAgentTheme();
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => inscreverConfirmacao(setPedido), []);

  useEffect(() => {
    if (!pedido) return;
    (pedido.perigo ? cancelarRef : confirmarRef).current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') pedido.responder(false);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [pedido]);

  return (
    <AnimatePresence>
      {pedido && (
        <div className="alfreds fixed inset-0 z-[250] flex items-end sm:items-center justify-center p-3" data-tema={tema} key={pedido.id}>
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(8, 10, 20, 0.42)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => pedido.responder(false)}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-describedby={`confirmacao-${pedido.id}`}
            className="ag-glass-strong relative w-full max-w-[400px] rounded-[22px] p-5 flex flex-col gap-4"
            style={{ color: 'var(--ag-text)', background: 'var(--ag-bg-2)' }}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.14 } }}
            transition={MOLA}
          >
            <p id={`confirmacao-${pedido.id}`} className="text-[15px] leading-relaxed whitespace-pre-line">
              {pedido.texto}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                ref={cancelarRef}
                onClick={() => pedido.responder(false)}
                className="px-4 py-2 rounded-full text-[14px] font-medium"
                style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
              >
                Cancelar
              </button>
              <button
                ref={confirmarRef}
                onClick={() => pedido.responder(true)}
                className="px-4 py-2 rounded-full text-[14px] font-semibold"
                style={{
                  background: pedido.perigo ? 'var(--ag-danger)' : 'var(--ag-accent)',
                  color: pedido.perigo ? '#fff' : 'var(--ag-accent-ink)',
                }}
              >
                {pedido.confirmar}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Confirmacao;
