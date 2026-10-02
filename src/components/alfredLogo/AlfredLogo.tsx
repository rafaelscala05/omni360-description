// A logo do Alfreds viva: esfera geodésica com anel e satélites, sempre em
// movimento, reagindo ao ponteiro e ao clique (o motor fica em `motor.ts`).
//
// As cores vêm dos tokens `--ag-sphere-*` herdados de `.alfreds`; fora desse
// escopo (a tela de carregamento) valem as cores da marca. Como trocar o tema
// não re-renderiza o canvas, o componente assina o store de tema e relê os
// tokens a cada troca.

import React, { useEffect, useRef } from 'react';
import { useAgentTheme } from '../../modules/agent/theme';
import { MotorLogo, PALETA_PADRAO, type Marca, type Paleta } from './motor';

interface Props {
  /** Lado do quadrado em px. */
  size?: number;
  /** true enquanto o agente responde (ou a página carrega): mais pacotes, giro e onda de voz. */
  ativo?: boolean;
  /** Reage a ponteiro e clique. Desligue onde a logo é só um ícone dentro de outro controle. */
  interativo?: boolean;
  className?: string;
  /** Rótulo acessível; sem ele a logo é decorativa. */
  rotulo?: string;
  /** O A da marca: sólido na frente ('frente') ou montado pela malha ('malha'). */
  marca?: Marca;
}

/** Folga em volta do quadrado para brilho, pings e expansão não serem cortados. */
const FOLGA = 0.18;

function lerPaleta(el: HTMLElement): Paleta {
  const css = getComputedStyle(el);
  const token = (nome: string) => css.getPropertyValue(nome).trim();
  const linhaA = Number(token('--ag-sphere-link-a'));
  return {
    no: token('--ag-sphere-node') || PALETA_PADRAO.no,
    linha: token('--ag-sphere-link') || PALETA_PADRAO.linha,
    linhaA: linhaA ? linhaA / 0.32 : PALETA_PADRAO.linhaA,
    satelite: token('--ag-sphere-sat') || PALETA_PADRAO.satelite,
    aditivo: token('--ag-sphere-blend') === 'aditivo',
  };
}

const AlfredLogo: React.FC<Props> = ({ size = 56, ativo = false, interativo = true, className = '', rotulo, marca = 'nenhuma' }) => {
  const caixaRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motorRef = useRef<MotorLogo | null>(null);
  const { tema } = useAgentTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    const caixa = caixaRef.current;
    if (!canvas || !caixa) return;
    const motor = new MotorLogo(canvas, { tamanho: size, folga: FOLGA, marca });
    motorRef.current = motor;

    const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicarReduzido = () => motor.definirReduzido(reduzir.matches);
    aplicarReduzido();
    reduzir.addEventListener('change', aplicarReduzido);

    // Fora da tela não calcula frame nenhum.
    const io = new IntersectionObserver(([e]) => motor.definirVisivel(e.isIntersecting));
    io.observe(caixa);

    return () => {
      reduzir.removeEventListener('change', aplicarReduzido);
      io.disconnect();
      motor.destruir();
      motorRef.current = null;
    };
  }, [size, marca]);

  useEffect(() => {
    if (motorRef.current && caixaRef.current) motorRef.current.definirPaleta(lerPaleta(caixaRef.current));
  }, [tema, size, marca]);

  useEffect(() => {
    motorRef.current?.definirAtivo(ativo);
  }, [ativo, size, marca]);

  const relativo = (e: React.PointerEvent) => {
    const r = caixaRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const eventos = interativo
    ? {
        onPointerMove: (e: React.PointerEvent) => {
          if (e.pointerType === 'mouse') motorRef.current?.apontar(relativo(e));
        },
        onPointerLeave: () => motorRef.current?.apontar(null),
        // Não impede o clique: dentro de um botão, a navegação continua valendo.
        onPointerDown: (e: React.PointerEvent) => motorRef.current?.tocar(relativo(e)),
      }
    : {};

  return (
    <span
      ref={caixaRef}
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      {...eventos}
    >
      <canvas
        ref={canvasRef}
        className="absolute pointer-events-none"
        style={{
          left: -size * FOLGA,
          top: -size * FOLGA,
          width: size * (1 + FOLGA * 2),
          height: size * (1 + FOLGA * 2),
        }}
      />
    </span>
  );
};

export default AlfredLogo;
