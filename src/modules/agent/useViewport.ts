// Fatos sobre a viewport (e o espaço da tela) que o CSS sozinho não entrega.

import type React from 'react';
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

/**
 * Largura, em px, de um elemento — para layouts que dependem do espaço que a
 * tela de fato tem, não da janela: o app tem a barra lateral à esquerda, então
 * uma janela de 1440 px deixa bem menos que isso para o Alfred.
 */
export function useLarguraDe(ref: React.RefObject<HTMLElement | null>): number {
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entrada]) => setLargura(Math.round(entrada.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return largura;
}

/**
 * Desktop largo (`xl` do Tailwind): onde o Alfred cabe em três colunas —
 * semana, conversa e atividade — em vez de alternar entre semana e conversa.
 * Abaixo disso a barra lateral do app come espaço demais para três colunas.
 */
export function useTelaLarga(): boolean {
  const [larga, setLarga] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1280,
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const aplicar = () => setLarga(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  return larga;
}

/**
 * Abaixo do `md` do Tailwind (768px): onde o Alfred da tela de Produtos vira
 * folha em vez de painel sobreposto. Não é `useTelaPequena` (640px), que
 * decide o modo foco do composer.
 */
export function useAbaixoDeMd(): boolean {
  const [abaixo, setAbaixo] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const aplicar = () => setAbaixo(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  return abaixo;
}
