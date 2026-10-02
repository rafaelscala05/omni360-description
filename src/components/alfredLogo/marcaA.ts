// O "A" da marca (download-5.svg), em duas formas para a logo animada:
// - `caminhoA()`: o glifo sólido, para desenhar na frente da esfera;
// - `grafoA()`: o mesmo contorno virado grafo — nós ao longo do contorno e
//   uma treliça por dentro das pernas —, para a esfera "montar" o A com
//   linhas e nós.
//
// Coordenadas no espaço 1024 do SVG da logo, normalizadas pelo raio da esfera
// (u, v em torno do centro), que é o que o motor projeta.

/** Contorno do A no espaço local do SVG (antes do transform). */
const CONTORNO_LOCAL: { tipo: 'L' | 'C'; p: number[] }[] = [
  { tipo: 'L', p: [278.847656, 152.832031] },
  { tipo: 'L', p: [163.238281, 398.203125] },
  { tipo: 'L', p: [219.085938, 398.203125] },
  { tipo: 'L', p: [237.960938, 351.019531] },
  { tipo: 'C', p: [237.960938, 351.019531, 246.628906, 326.386719, 280.425781, 336.863281] },
  { tipo: 'C', p: [304.542969, 345.878906, 327.609375, 374.609375, 327.609375, 374.609375] },
  { tipo: 'L', p: [294.582031, 299.117188] },
  { tipo: 'L', p: [261.550781, 299.117188] },
  { tipo: 'L', p: [294.582031, 233.058594] },
  { tipo: 'L', p: [370.074219, 398.203125] },
  { tipo: 'L', p: [425.921875, 398.203125] },
  { tipo: 'L', p: [310.3125, 152.832031] },
];

// transform="translate(44.84 83.26) scale(1.58585)" do SVG.
const TX = 44.84, TY = 83.26, ESC = 1.58585;
const para1024 = (x: number, y: number): [number, number] => [TX + x * ESC, TY + y * ESC];

/** O glifo como Path2D no espaço 1024 (o motor escala para o tamanho). */
export function caminhoA(): Path2D {
  const p = new Path2D();
  CONTORNO_LOCAL.forEach((s, i) => {
    if (s.tipo === 'L') {
      const [x, y] = para1024(s.p[0], s.p[1]);
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    } else {
      const [a, b] = para1024(s.p[0], s.p[1]);
      const [c, d] = para1024(s.p[2], s.p[3]);
      const [e, f] = para1024(s.p[4], s.p[5]);
      p.bezierCurveTo(a, b, c, d, e, f);
    }
  });
  p.closePath();
  return p;
}

export interface GrafoA {
  /** u, v por nó, já divididos pelo raio da esfera (em unidades 1024). */
  uv: Float32Array;
  n: number;
  arestas: Uint16Array;
  /** Comprimento acumulado do contorno por nó (0..1) — por onde a energia corre. */
  contorno: number;
  /** Ordem de montagem: de cima (o vértice do A) para baixo. */
  atraso: Float32Array;
}

const cache = new Map<string, GrafoA>();

/**
 * Nós no contorno a cada `passo` (unidades 1024), cantos preservados, e uma
 * treliça ligando cada nó aos dois mais próximos cujo segmento fica inteiro
 * dentro do A — é isso que faz as pernas lerem como estrutura e não como
 * contorno vazado.
 */
export function grafoA(raioEsfera1024: number, passo: number): GrafoA {
  const chave = `${raioEsfera1024}|${passo}`;
  const pronto = cache.get(chave);
  if (pronto) return pronto;

  // Polígono achatado (curvas em 4 pedaços), com os cantos marcados.
  const poli: [number, number][] = [];
  let ant = para1024(CONTORNO_LOCAL[0].p[0], CONTORNO_LOCAL[0].p[1]);
  poli.push(ant);
  for (const s of CONTORNO_LOCAL.slice(1)) {
    if (s.tipo === 'L') {
      ant = para1024(s.p[0], s.p[1]);
      poli.push(ant);
    } else {
      const p0 = ant;
      const p1 = para1024(s.p[0], s.p[1]);
      const p2 = para1024(s.p[2], s.p[3]);
      const p3 = para1024(s.p[4], s.p[5]);
      for (let k = 1; k <= 4; k++) {
        const t = k / 4, m = 1 - t;
        poli.push([
          m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
          m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
      ant = p3;
    }
  }

  // Nós: cada lado subdividido no passo, sem perder os cantos.
  const pts: [number, number][] = [];
  for (let i = 0; i < poli.length; i++) {
    const a = poli[i], b = poli[(i + 1) % poli.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const partes = Math.max(1, Math.round(len / passo));
    for (let k = 0; k < partes; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / partes, a[1] + ((b[1] - a[1]) * k) / partes]);
  }
  const n = pts.length;

  const pares = new Set<string>();
  const arestas: number[] = [];
  const ligar = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (pares.has(k)) return;
    pares.add(k);
    arestas.push(a, b);
  };
  for (let i = 0; i < n; i++) ligar(i, (i + 1) % n);

  const dentro = (x: number, y: number) => {
    let r = false;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
      const [xi, yi] = poli[i], [xj, yj] = poli[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
    }
    return r;
  };
  for (let i = 0; i < n; i++) {
    const cand: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j++) {
      const salto = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      if (salto < 2) continue;
      const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (d > passo * 2.6) continue;
      let ok = true;
      for (const t of [0.2, 0.5, 0.8]) {
        if (!dentro(pts[i][0] + (pts[j][0] - pts[i][0]) * t, pts[i][1] + (pts[j][1] - pts[i][1]) * t)) { ok = false; break; }
      }
      if (ok) cand.push({ j, d });
    }
    // Um vínculo por nó, e só em nós alternados: com mais, a treliça vira hachura.
    if (i % 2 === 0) cand.sort((x, y) => x.d - y.d).slice(0, 1).forEach(({ j }) => ligar(i, j));
  }

  const uv = new Float32Array(n * 2);
  const atraso = new Float32Array(n);
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of pts) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
  pts.forEach(([x, y], i) => {
    uv[i * 2] = (x - 512) / raioEsfera1024;
    uv[i * 2 + 1] = (y - 512) / raioEsfera1024;
    atraso[i] = (y - yMin) / (yMax - yMin);
  });

  const g: GrafoA = { uv, n, arestas: new Uint16Array(arestas), contorno: n, atraso };
  cache.set(chave, g);
  return g;
}
