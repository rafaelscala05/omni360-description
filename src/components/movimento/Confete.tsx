// Confete curto em Canvas 2D, sem dependência: ~90 partículas nas cores da
// marca, 1,8 s, e o canvas some sozinho. Reservado para o fim da trilha de
// onboarding — comemoração rara vale mais. Com movimento reduzido, não roda.

import React, { useEffect, useRef } from 'react';

const CORES = ['#ff5b03', '#3053ff', '#12a150', '#828ed1', '#f5b544'];

interface Particula {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; w: number; h: number; cor: string;
}

const Confete: React.FC<{ onFim?: () => void }> = ({ onFim }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (reduzido || !canvas || !ctx) {
      onFim?.();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const ps: Particula[] = Array.from({ length: 90 }, (_, i) => {
      const lado = i % 2 ? 1 : -1;
      return {
        x: W / 2 + lado * W * 0.18,
        y: H * 0.62,
        vx: lado * -(2 + Math.random() * 6) + (Math.random() - 0.5) * 3,
        vy: -(9 + Math.random() * 7),
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        w: 6 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        cor: CORES[i % CORES.length],
      };
    });

    const inicio = performance.now();
    const DUR = 1800;
    let raf = 0;
    const quadro = (agora: number) => {
      const t = agora - inicio;
      ctx.clearRect(0, 0, W, H);
      const alfa = t > DUR - 500 ? Math.max(0, (DUR - t) / 500) : 1;
      for (const p of ps) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = alfa;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.cor;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        ctx.restore();
      }
      if (t < DUR) raf = requestAnimationFrame(quadro);
      else onFim?.();
    };
    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
    // onFim é estável o bastante para o uso; reiniciar no meio cortaria a animação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} aria-hidden className="fixed inset-0 z-[300] pointer-events-none" style={{ width: '100vw', height: '100vh' }} />;
};

export default Confete;
