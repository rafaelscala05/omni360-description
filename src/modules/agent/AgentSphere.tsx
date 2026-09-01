// Esfera de partículas conectadas por linhas — o núcleo visual do agente.
// Réplica em three.js de verdade do protótipo do canvas de design (que
// simulava o mesmo efeito em Canvas 2D porque o canvas de design roda em
// iframe sandboxed sem egress de rede, inviabilizando carregar a lib ali).
//
// Espírito do exemplo oficial webgl_buffergeometry_drawrange: todos os
// pares de pontos são pré-computados uma vez; a cada frame, só os pares com
// distância atual menor que `minDistance` entram no drawRange do
// LineSegments. `minDistance` oscila continuamente (Math.sin) — mais forte
// enquanto `active` (o agente está processando/respondendo), mais discreta
// em repouso, para a esfera nunca parecer estática.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  /** Lado do quadrado em px. */
  size?: number;
  /** true enquanto uma resposta está em andamento (SSE delta/leitura chegando). */
  active?: boolean;
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

export default function AgentSphere({ size = 132, active = false }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Lido dentro do loop de animação, que não deve reiniciar a cada mudança
  // de `active` — só o valor lido a cada frame precisa estar atualizado.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const positions = fibonacciSphere(N);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.z = 2.6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Nós.
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointsMat = new THREE.PointsMaterial({ color: 0xff5b03, size: 0.035, sizeAttenuation: true });
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
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.35 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    group.add(lines);

    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      group.rotation.y = t * 0.15;

      const amplitude = activeRef.current ? 0.5 : 0.18;
      const base = activeRef.current ? 0.85 : 0.62;
      const minDistance = base + Math.sin(t * 1.1) * amplitude;

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
  }, [size]);

  return <div ref={mountRef} style={{ width: size, height: size }} />;
}
