// Esfera de partículas conectadas por linhas — o núcleo visual do agente.
// Réplica em three.js de verdade do protótipo do canvas de design (que
// simulava o mesmo efeito em Canvas 2D porque o canvas de design roda em
// iframe sandboxed sem egress de rede, inviabilizando carregar a lib ali).
//
// Espírito do exemplo oficial webgl_buffergeometry_drawrange: todos os pares
// de pontos são pré-computados uma vez; a cada frame, só os pares com
// distância atual menor que `minDistance` entram no drawRange do LineSegments.
//
// Em cima disso vem a camada de "voz": `envelope()` simula a amplitude de uma
// fala e comanda tudo — deslocamento radial dos nós (uma onda que atravessa a
// esfera de polo a polo), tamanho do ponto, densidade das linhas e velocidade
// de rotação. Sem áudio real para amostrar, o envelope é uma soma de senoides
// de períodos não-harmônicos: o padrão só se repete depois de minutos, então
// não lê como loop nem como metrônomo. Em repouso o mesmo envelope continua,
// com uma fração da amplitude, para a esfera respirar em vez de congelar.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  /** Lado do quadrado em px. */
  size?: number;
  /** true enquanto uma resposta está em andamento (SSE delta/leitura chegando). */
  active?: boolean;
  /**
   * Só existe como dependência do efeito: as cores vêm das custom properties
   * `--ag-sphere-*` herdadas de `.alfreds`, e trocar o tema não dispara
   * re-render do canvas WebGL sozinho — sem isso a esfera fica com a paleta do
   * tema anterior até a tela ser remontada.
   */
  tema?: string;
}

const N = 90;
const RADIUS = 1;

function fibonacciSphere(n: number): Float32Array {
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    pts[i * 3] = Math.cos(theta) * r * RADIUS;
    pts[i * 3 + 1] = y * RADIUS;
    pts[i * 3 + 2] = Math.sin(theta) * r * RADIUS;
  }
  return pts;
}

/**
 * Amplitude da "fala" em `t` segundos, em 0..1.
 *
 * Três senoides de períodos não-harmônicos retificadas e multiplicadas por uma
 * portadora lenta: a portadora cria as pausas entre frases, as rápidas criam a
 * textura de sílaba dentro de cada uma.
 */
function envelope(t: number): number {
  const frase = 0.55 + 0.45 * Math.sin(t * 0.7);
  const silaba = Math.abs(Math.sin(t * 4.3)) * 0.6 + Math.abs(Math.sin(t * 7.1)) * 0.3;
  const enfase = Math.abs(Math.sin(t * 1.9)) * 0.25;
  return Math.min(1, Math.max(0, frase * (silaba + enfase)));
}

export default function AgentSphere({ size = 132, active = false, tema }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Lido dentro do loop de animação, que não deve reiniciar a cada mudança
  // de `active` — só o valor lido a cada frame precisa estar atualizado.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Custom properties são herdadas, então o próprio nó de montagem já enxerga
    // os tokens definidos lá em cima em `.alfreds[data-tema=…]`.
    const css = getComputedStyle(mount);
    const token = (nome: string, padrao: string) => css.getPropertyValue(nome).trim() || padrao;
    const corNo = new THREE.Color(token('--ag-sphere-node', '#ff5b03'));
    const corLinha = new THREE.Color(token('--ag-sphere-link', '#1e293b'));
    const opacidadeLinha = Number(token('--ag-sphere-link-a', '0.35')) || 0.35;
    // Aditivo soma luz, então sobre fundo claro satura em branco e apaga os
    // nós — é o oposto do brilho que ele produz sobre fundo escuro.
    const aditivo = token('--ag-sphere-blend', 'normal') === 'aditivo';

    const base = fibonacciSphere(N);
    // Posições efetivamente desenhadas — `base` deslocada pela onda de voz.
    const positions = new Float32Array(base);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.z = 2.6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Nós. No tema escuro o blending aditivo faz os pontos somarem luz onde se
    // sobrepõem, que é o que dá o brilho de núcleo em vez de bolinhas chapadas.
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointsMat = new THREE.PointsMaterial({
      color: corNo,
      size: 0.04,
      sizeAttenuation: true,
      transparent: true,
      blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(pointsGeo, pointsMat);
    group.add(points);

    // Todo par possível, pré-computado uma vez; o drawRange recorta pra só
    // os pares cuja distância atual é menor que minDistance, a cada frame.
    const pairs: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) pairs.push([i, j]);
    }
    const linePositions = new Float32Array(pairs.length * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicMaterial({
      color: corLinha,
      transparent: true,
      opacity: opacidadeLinha,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    group.add(lines);

    let raf = 0;
    const inicio = performance.now();
    const tick = () => {
      const t = (performance.now() - inicio) / 1000;
      const falando = activeRef.current;
      const env = envelope(t);
      // Em repouso o mesmo envelope vale ~15% — respira, não fala.
      const amp = falando ? env : env * 0.15;

      group.rotation.y = t * (falando ? 0.15 + env * 0.22 : 0.11);

      // Onda de voz: percorre a esfera no eixo Y, então os nós não pulsam em
      // bloco (isso pareceria um balão inflando) e sim em crista, como um
      // visualizador de áudio enrolado numa esfera.
      const posAttr = pointsGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        const y = base[i * 3 + 1];
        const crista = Math.sin(t * 6.2 - y * 3.4);
        const escala = 1 + amp * 0.16 * crista;
        positions[i * 3] = base[i * 3] * escala;
        positions[i * 3 + 1] = y * escala;
        positions[i * 3 + 2] = base[i * 3 + 2] * escala;
      }
      posAttr.needsUpdate = true;

      pointsMat.size = 0.04 + amp * 0.024;
      pointsMat.opacity = 0.8 + amp * 0.2;
      lineMat.opacity = opacidadeLinha * (falando ? 0.75 + env * 0.6 : 0.9);

      const amplitude = falando ? 0.5 : 0.18;
      const centro = falando ? 0.85 : 0.62;
      const minDistance = centro + Math.sin(t * 1.1) * amplitude;

      let count = 0;
      const linePos = lineGeo.attributes.position as THREE.BufferAttribute;
      for (const [i, j] of pairs) {
        const ax = positions[i * 3], ay = positions[i * 3 + 1], az = positions[i * 3 + 2];
        const bx = positions[j * 3], by = positions[j * 3 + 1], bz = positions[j * 3 + 2];
        const d = Math.hypot(ax - bx, ay - by, az - bz);
        if (d < minDistance) {
          linePos.setXYZ(count * 2, ax, ay, az);
          linePos.setXYZ(count * 2 + 1, bx, by, bz);
          count++;
        }
      }
      linePos.needsUpdate = true;
      lineGeo.setDrawRange(0, count * 2);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      pointsGeo.dispose();
      pointsMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, tema]);

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* Halo. Fica fora do WebGL de propósito: um bloom de verdade exigiria
          EffectComposer e três render targets para um enfeite de 132px. */}
      <div
        className="ag-nucleo-brilho absolute rounded-full"
        data-falando={active ? 'true' : 'false'}
        style={{
          inset: -size * 0.22,
          background: 'radial-gradient(circle, var(--ag-accent) 0%, transparent 62%)',
          filter: `blur(${Math.round(size * 0.16)}px)`,
        }}
      />
      {active && (
        // Os anéis nascem a 18% para dentro: em escala cheia (2,25x do
        // contêiner) passariam por cima do título logo abaixo.
        <div className="absolute" style={{ inset: '18%' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="ag-onda absolute inset-0 rounded-full"
              style={{ border: '1px solid var(--ag-accent)', opacity: 0.35 }}
            />
          ))}
        </div>
      )}
      <div ref={mountRef} className="relative" style={{ width: size, height: size }} />
    </div>
  );
}
