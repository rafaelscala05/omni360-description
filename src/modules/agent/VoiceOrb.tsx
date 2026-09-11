// O núcleo do agente na barra de título — o "cérebro" que fica sempre visível.
//
// Não é a AgentSphere: a malha de 90 nós vira uma bola cinza ilegível abaixo de
// ~48px, e seriam dois contextos WebGL vivos na mesma página para desenhar um
// ponto de 32px (o limite de contextos por página é baixo, e o navegador
// derruba o mais antigo ao estourar).
//
// Em repouso ele respira. Respondendo, vira um visualizador de voz: o halo
// ganha amplitude, anéis concêntricos saem do centro e um equalizador de
// quatro barras aparece dentro do núcleo. As durações das barras e dos anéis
// são propositalmente primas entre si (1,00 / 0,74 / 1,22 / 0,86 s) — em
// cadência única o conjunto pulsa como metrônomo, que lê como máquina; fora
// de fase lê como fala.

import React from 'react';

interface Props {
  /** Lado do quadrado em px. */
  size?: number;
  /** true enquanto o agente responde (SSE em andamento). */
  ativo?: boolean;
}

const BARRAS = [
  { altura: 0.42, duracao: 1, atraso: 0 },
  { altura: 0.78, duracao: 0.74, atraso: 0.18 },
  { altura: 0.6, duracao: 1.22, atraso: 0.06 },
  { altura: 0.34, duracao: 0.86, atraso: 0.29 },
];

const VoiceOrb: React.FC<Props> = ({ size = 34, ativo = false }) => (
  <span
    className="relative inline-grid place-items-center shrink-0"
    style={{ width: size, height: size }}
    aria-hidden
  >
    <span
      className="ag-nucleo-brilho absolute rounded-full"
      data-falando={ativo ? 'true' : 'false'}
      style={{
        inset: -size * 0.42,
        background: 'radial-gradient(circle, var(--ag-accent) 0%, transparent 66%)',
        filter: `blur(${Math.round(size * 0.3)}px)`,
      }}
    />

    {ativo && (
      // Nascem levemente para dentro: em escala cheia os anéis passariam da
      // borda arredondada da superfície e sairiam cortados em reta.
      <span className="absolute" style={{ inset: '12%' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="ag-onda absolute inset-0 rounded-full"
            style={{ border: '1.5px solid var(--ag-accent)' }}
          />
        ))}
      </span>
    )}

    <span
      className="relative rounded-full grid place-items-center overflow-hidden"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 32% 26%, #ffdcc2 0%, var(--ag-accent) 46%, #b83500 100%)',
        boxShadow: `0 ${size * 0.12}px ${size * 0.5}px ${-size * 0.16}px var(--ag-accent), inset 0 ${-size * 0.06}px ${size * 0.2}px rgba(0,0,0,.32)`,
      }}
    >
      {ativo && (
        <span className="flex items-center gap-[2px]" style={{ height: size * 0.52 }}>
          {BARRAS.map((b, i) => (
            <span
              key={i}
              className="ag-eq-barra rounded-full"
              style={{
                width: Math.max(2, Math.round(size * 0.06)),
                height: `${b.altura * 100}%`,
                background: 'rgba(255,255,255,.92)',
                animationDuration: `${b.duracao}s`,
                animationDelay: `${b.atraso}s`,
              }}
            />
          ))}
        </span>
      )}
    </span>
  </span>
);

export default VoiceOrb;
