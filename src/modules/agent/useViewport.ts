// Dois fatos sobre a viewport que o CSS sozinho não entrega.

import { useEffect, useState } from 'react';

/** Telefone (abaixo do breakpoint `sm` do Tailwind). */
export function useTelaPequena(): boolean {
  const [pequena, setPequena] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const aplicar = () => setPequena(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  return pequena;
}

/**
 * Altura, em px, que o teclado virtual está cobrindo da viewport.
 *
 * No iOS o teclado não redimensiona a layout viewport: ele cobre. Um layout
 * `h-full` continua com a altura toda e o campo de digitar simplesmente fica
 * atrás do teclado — o comportamento que faz uma web app parecer web app. A
 * visual viewport é a única que enxerga isso, e a diferença entre as duas é
 * exatamente o quanto o teclado ocupa.
 *
 * O listener de `scroll` importa tanto quanto o de `resize`: com o teclado
 * aberto o iOS desloca a visual viewport (`offsetTop`) quando o usuário
 * arrasta, e sem reagir a isso o campo volta a sumir.
 */
export function useAlturaTeclado(): number {
  const [altura, setAltura] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const medir = () => {
      const coberto = window.innerHeight - vv.height - vv.offsetTop;
      // Abaixo de ~80px é barra de endereço encolhendo, não teclado.
      setAltura(coberto > 80 ? Math.round(coberto) : 0);
    };

    medir();
    vv.addEventListener('resize', medir);
    vv.addEventListener('scroll', medir);
    return () => {
      vv.removeEventListener('resize', medir);
      vv.removeEventListener('scroll', medir);
    };
  }, []);

  return altura;
}
