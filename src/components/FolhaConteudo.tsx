// Folha de conteúdo do desktop com agente: a coluna principal vira uma folha
// translúcida encostada no trilho, e a porta ativa do `TrilhoDesktop` é uma
// aba da mesma cor (`--ag-folha`) que encosta nela — o painel parece sair do
// menu. Ao trocar de porta, a folha entra deslizando a partir do trilho.
//
// É um componente (e não um div no App) só para o efeito da animação ter onde
// morar: o App tem retornos antecipados antes da árvore principal.

import React, { useEffect, useRef } from 'react';

interface Props {
  /** Muda quando a porta ativa muda — dispara a entrada. */
  chave: string | null;
  className?: string;
  style?: React.CSSProperties;
  tema: 'claro' | 'escuro';
  children: React.ReactNode;
}

const FolhaConteudo: React.FC<Props> = ({ chave, className, style, tema, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const primeira = useRef(true);

  useEffect(() => {
    // Nada na primeira montagem: a folha já está lá quando o app abre.
    if (primeira.current) { primeira.current = false; return; }
    const el = ref.current;
    if (!el || !el.animate) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Só o conteúdo desliza; a própria folha fica parada para a aba não
    // desencostar dela durante a transição.
    const alvo = el.querySelector<HTMLElement>('[data-folha-conteudo]') ?? el;
    alvo.animate(
      [
        { opacity: 0, transform: 'translateX(-12px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    );
  }, [chave]);

  return (
    <div ref={ref} className={className} style={style} data-tema={tema}>
      {children}
    </div>
  );
};

export default FolhaConteudo;
