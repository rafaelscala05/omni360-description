// Número que conta até o valor novo em vez de trocar de uma vez. Quando o
// valor sobe (e `mostrarGanho`), um "+N" sobe e some ao lado — é o que faz o
// crédito recebido "chegar" ao saldo. Descida não ganha destaque: gastar
// crédito não deve parecer alarme.

import React, { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

interface Props {
  valor: number;
  className?: string;
  style?: React.CSSProperties;
  formatar?: (n: number) => string;
  /** Mostra "+N" flutuando quando o valor sobe. */
  mostrarGanho?: boolean;
  duracao?: number;
}

const fmtPadrao = (n: number) => Math.round(n).toLocaleString('pt-BR');

const NumeroAnimado: React.FC<Props> = ({ valor, className, style, formatar = fmtPadrao, mostrarGanho, duracao = 0.8 }) => {
  const reduzido = useReducedMotion();
  const [exibido, setExibido] = useState(valor);
  const anterior = useRef(valor);
  const [ganho, setGanho] = useState<{ n: number; chave: number } | null>(null);

  useEffect(() => {
    const de = anterior.current;
    anterior.current = valor;
    if (de === valor) return;
    // De 0 é o saldo chegando do servidor, não um ganho.
    if (mostrarGanho && de > 0 && valor > de) setGanho({ n: valor - de, chave: Date.now() });
    if (reduzido || !Number.isFinite(de) || !Number.isFinite(valor)) {
      setExibido(valor);
      return;
    }
    const ctrl = animate(de, valor, {
      duration: duracao,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setExibido(v),
    });
    return () => ctrl.stop();
  }, [valor, reduzido, mostrarGanho, duracao]);

  return (
    <span className={`relative inline-block tabular-nums ${className ?? ''}`} style={style}>
      {formatar(exibido)}
      {ganho && (
        <span
          key={ganho.chave}
          aria-hidden
          className="ag-sobe-some absolute left-full top-0 ml-1 text-[0.45em] font-semibold whitespace-nowrap"
          style={{ color: 'var(--ag-ok, #12a150)' }}
          onAnimationEnd={() => setGanho(null)}
        >
          +{formatar(ganho.n)}
        </span>
      )}
    </span>
  );
};

export default NumeroAnimado;
