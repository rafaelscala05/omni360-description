// Check que se desenha: o círculo enche com uma mola e o traço do check é
// riscado depois. Só anima quando muda de "não feito" para "feito" com o
// componente já na tela — um item que já abre feito aparece pronto, senão a
// lista inteira "comemoraria" a cada render.

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface Props {
  feito: boolean;
  tamanho?: number;
  cor?: string;
  className?: string;
  /** Anima já ao montar (o item acabou de virar "feito" e trocou de componente). */
  animarAoMontar?: boolean;
}

const CheckDesenhado: React.FC<Props> = ({ feito, tamanho = 20, cor = 'var(--ag-ok, #12a150)', className, animarAoMontar }) => {
  const reduzido = useReducedMotion();
  const montou = useRef(false);
  const [animar, setAnimar] = useState(!!animarAoMontar);

  useEffect(() => {
    if (montou.current && feito) setAnimar(true);
    montou.current = true;
  }, [feito]);

  if (!feito) return null;
  const anima = animar && !reduzido;

  return (
    <motion.svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      className={className}
      initial={anima ? { scale: 0.4, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="11" fill={cor} />
      <motion.path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="white"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={anima ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.32, delay: anima ? 0.12 : 0, ease: [0.22, 1, 0.36, 1] }}
      />
    </motion.svg>
  );
};

export default CheckDesenhado;
