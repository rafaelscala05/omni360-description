// Anel de progresso que se preenche com mola. Em 100% solta um brilho uma vez
// (só quando chega a 100% com o anel na tela, não quando já abre completo).

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface Props {
  pct: number;
  tamanho?: number;
  espessura?: number;
  cor?: string;
  trilho?: string;
  children?: React.ReactNode;
}

const AnelProgresso: React.FC<Props> = ({
  pct,
  tamanho = 44,
  espessura = 4,
  cor = 'var(--ag-ok, #12a150)',
  trilho = 'var(--ag-fill-2)',
  children,
}) => {
  const reduzido = useReducedMotion();
  const r = (tamanho - espessura) / 2;
  const frac = Math.max(0, Math.min(1, pct / 100));
  const anterior = useRef(frac);
  const [brilho, setBrilho] = useState(0);

  useEffect(() => {
    if (frac >= 1 && anterior.current < 1) setBrilho(Date.now());
    anterior.current = frac;
  }, [frac]);

  return (
    <span className="relative inline-flex items-center justify-center flex-none" style={{ width: tamanho, height: tamanho }}>
      {brilho > 0 && !reduzido && (
        <motion.span
          key={brilho}
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ boxShadow: `0 0 0 0 ${cor}` }}
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 1.7 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="absolute inset-0 rounded-full" style={{ border: `2px solid ${cor}` }} />
        </motion.span>
      )}
      <svg width={tamanho} height={tamanho} className="-rotate-90" aria-hidden>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke={trilho} strokeWidth={espessura} />
        <motion.circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke={cor}
          strokeWidth={espessura}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: frac }}
          transition={reduzido ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }}
          style={{ opacity: frac === 0 ? 0 : 1 }}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
};

export default AnelProgresso;
