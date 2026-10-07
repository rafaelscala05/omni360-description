// Presets de movimento do app — o espelho, para o `motion`, dos tokens
// --ag-dur-* / --ag-ease-* do index.css. Toda animação feita com `motion` sai
// daqui, para nenhuma tela inventar a própria curva.
//
// Movimento reduzido: o App monta <MotionConfig reducedMotion="user">, então os
// componentes `motion` já trocam deslocamento por fade quando o sistema pede.

import { useRef } from 'react';
import type { Transition, Variants } from 'motion/react';

export const DUR = { micro: 0.12, base: 0.22, tela: 0.34 } as const;

export const EASE = {
  mola: [0.22, 1, 0.36, 1],
  sheet: [0.32, 0.72, 0, 1],
  saida: [0.4, 0, 1, 1],
} as const;

/** Mola para o que o usuário arrasta ou o que "assenta" (indicador de aba, barras). */
export const MOLA: Transition = { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 };

/** Mola mais solta, para o que entra com alguma presença (barra de seleção). */
export const MOLA_SUAVE: Transition = { type: 'spring', stiffness: 340, damping: 30 };

/** Ordem das três portas: decide para que lado a tela desliza ao trocar. */
const ORDEM_PORTAS: Record<string, number> = { home: 0, fontes: 0, atividade: 1, ferramentas: 2 };

export function direcaoEntre(de: string, para: string): 1 | -1 {
  const a = ORDEM_PORTAS[de] ?? 2;
  const b = ORDEM_PORTAS[para] ?? 2;
  return b >= a ? 1 : -1;
}

/** Troca de tela: fade + deslize curto na direção da navegação. */
export const telaVariants: Variants = {
  entra: (dir: number) => ({ opacity: 0, x: dir * 12 }),
  fica: { opacity: 1, x: 0, transition: { duration: DUR.tela, ease: EASE.mola } },
  sai: (dir: number) => ({ opacity: 0, x: dir * -8, transition: { duration: DUR.micro, ease: EASE.saida } }),
};

/** Item de lista que entra, sai e se reordena. */
export const itemLista = {
  initial: { opacity: 0, y: 8, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: EASE.mola } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DUR.micro, ease: EASE.saida } },
} as const;

/** Card que sai porque foi resolvido: desliza para a direita, rumo ao "Feito". */
export const itemResolvido = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE.mola } },
  exit: { opacity: 0, x: 48, scale: 0.94, transition: { duration: 0.28, ease: EASE.saida } },
} as const;

/** Vibração curta onde existe (Android); o Safari do iOS não tem a API. */
export function vibrar(ms = 12): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate(ms);
    }
  } catch {
    /* sem vibração não é erro */
  }
}

/** Reinicia uma animação CSS de uso único (ag-shake, ag-bump) num elemento. */
export function reanimar(el: Element | null | undefined, classe: string): void {
  if (!el) return;
  el.classList.remove(classe);
  // Força o reflow para a mesma classe voltar a disparar a animação.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(classe);
}

/**
 * Quantas vezes `valor` mudou desde que o componente montou. Serve de `key`
 * para reanimar uma classe de uso único (ag-vira, ag-bump) só quando o estado
 * muda de verdade — sem animar na primeira renderização, quando a lista
 * inteira apareceria "comemorando".
 */
export function useMudou(valor: unknown): number {
  const anterior = useRef(valor);
  const n = useRef(0);
  if (!Object.is(anterior.current, valor)) {
    anterior.current = valor;
    n.current += 1;
  }
  return n.current;
}

/**
 * Contador que sobe a cada ação que passou a "executed" desde a montagem —
 * o sinal de sucesso da logo do Alfred. Ações que já chegam executadas (o
 * histórico carregando) não contam.
 */
export function useSucessos(acoes: Iterable<{ id: string; status: string }>): number {
  const vistas = useRef<Set<string> | null>(null);
  const n = useRef(0);
  const executadas = new Set<string>();
  for (const a of acoes) if (a.status === 'executed') executadas.add(a.id);
  if (vistas.current === null) vistas.current = executadas;
  else {
    let novas = 0;
    for (const id of executadas) if (!vistas.current.has(id)) novas++;
    if (novas) {
      n.current += 1;
      vistas.current = executadas;
    }
  }
  return n.current;
}
