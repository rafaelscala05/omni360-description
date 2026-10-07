// De onde veio o último toque: o retângulo da linha (ou do botão) que o
// usuário acabou de tocar. Serve para uma tela cheia "crescer" a partir dela
// (o ProductEditModal abre a partir da linha do produto), sem que cada lista
// precise passar a posição adiante.

import type React from 'react';

let ultimo: { rect: DOMRect; t: number } | null = null;
let instalado = false;

const ALVO = '[data-linha-produto], tr, li, [role="row"], button, a';

export function instalarOrigemToque(): void {
  if (instalado || typeof document === 'undefined') return;
  instalado = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.(ALVO);
      if (el) ultimo = { rect: el.getBoundingClientRect(), t: performance.now() };
    },
    { capture: true, passive: true },
  );
}

/** Retângulo do toque que abriu a tela, se foi há pouco (senão a tela abriu por outro caminho). */
export function origemRecente(janelaMs = 900): DOMRect | null {
  if (!ultimo || performance.now() - ultimo.t > janelaMs) return null;
  return ultimo.rect;
}

/**
 * Estilo de entrada "cresce a partir da origem": clip-path que vai do
 * retângulo tocado até a tela inteira. Sem origem (ou com movimento reduzido),
 * só um fade.
 */
export function estiloAbrirDaOrigem(): React.CSSProperties & Record<string, string> {
  const r = origemRecente();
  const reduzido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!r || reduzido) return { animation: 'ag-fade 0.22s both' } as React.CSSProperties & Record<string, string>;
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    '--o-top': `${Math.max(0, r.top)}px`,
    '--o-right': `${Math.max(0, W - r.right)}px`,
    '--o-bottom': `${Math.max(0, H - r.bottom)}px`,
    '--o-left': `${Math.max(0, r.left)}px`,
    animation: 'ag-abre-da-origem 0.46s cubic-bezier(0.32, 0.72, 0, 1) both',
  } as React.CSSProperties & Record<string, string>;
}
