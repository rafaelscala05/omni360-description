// Motor da logo animada do Alfreds: a esfera geodésica com anel e satélites
// (os SVGs da marca), redesenhada em Canvas 2D a cada frame.
//
// Canvas 2D e não WebGL de propósito: a logo aparece em até quatro lugares ao
// mesmo tempo (trilho, tab bar, cabeçalho e o centro do Alfred), e o navegador
// derruba o contexto WebGL mais antigo quando a página passa do limite. Em 2D
// cada instância custa um canvas pequeno e ~500 segmentos por frame.
//
// Um único requestAnimationFrame serve todas as instâncias (`ticker`), e uma
// instância fora da tela (IntersectionObserver) nem calcula o frame.
//
// Camadas de comportamento, todas somando sobre o mesmo estado (calor por nó e
// por aresta, velocidades de giro, deslocamento radial, offset dos satélites):
// - sempre: giro lento, "pacotes" de dados percorrendo as arestas e, de tempos
//   em tempos, um evento aleatório — a esfera nunca para;
// - `ativo` (o agente respondendo): mais pacotes, giro mais rápido e a onda de
//   voz atravessando a esfera de polo a polo;
// - ponteiro em cima: inclina na direção dele e acende o nó mais próximo com a
//   vizinhança;
// - clique/toque: um efeito sorteado (nunca o mesmo duas vezes seguidas).
//
// `marca` põe o A da marca junto: 'frente' é o glifo sólido na frente da
// esfera (como no download-5.svg), com um reflexo que passa de tempos em
// tempos; 'malha' é o A feito de nós e linhas, preso à face da esfera, que se
// desmonta de volta nela e se remonta.

import { caminhoA, grafoA, type GrafoA } from './marcaA';

export type Marca = 'nenhuma' | 'frente' | 'malha';

export interface Paleta {
  no: string;
  linha: string;
  /** Multiplicador da opacidade das linhas (token `--ag-sphere-link-a` / 0,32). */
  linhaA: number;
  satelite: string;
  /** Tema escuro: brilho dos pacotes soma luz em vez de cobrir. */
  aditivo: boolean;
}

export const PALETA_PADRAO: Paleta = {
  no: '#ff5b03',
  linha: '#141311',
  linhaA: 0.72,
  satelite: '#e8e0d5',
  aditivo: false,
};

// ── Geometria ────────────────────────────────────────────────────────────────

interface Malha {
  v: Float32Array; // x,y,z unitários
  n: number;
  arestas: Uint16Array; // pares a,b
  vizinhos: number[][];
  laranja: Uint8Array; // nós que nascem laranja (fixos, como na logo)
  semente: Float32Array; // 0..1 por nó, para efeitos com variação
}

const malhas = new Map<number, Malha>();

/** Icosfera: icosaedro subdividido `nivel` vezes — a malha triangulada da logo. */
function malha(nivel: number): Malha {
  const pronta = malhas.get(nivel);
  if (pronta) return pronta;

  const t = (1 + Math.sqrt(5)) / 2;
  const pts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalizar);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < nivel; s++) {
    const meio = new Map<string, number>();
    const pontoMedio = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const achado = meio.get(k);
      if (achado !== undefined) return achado;
      const p = normalizar([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2, (pts[a][2] + pts[b][2]) / 2]);
      pts.push(p);
      meio.set(k, pts.length - 1);
      return pts.length - 1;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = pontoMedio(a, b), bc = pontoMedio(b, c), ca = pontoMedio(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }

  const n = pts.length;
  const vistas = new Set<string>();
  const pares: number[] = [];
  const vizinhos: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b, c] of faces) {
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? `${x}_${y}` : `${y}_${x}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      pares.push(x, y);
      vizinhos[x].push(y);
      vizinhos[y].push(x);
    }
  }

  // Pseudoaleatório com semente fixa: a mesma esfera em todo carregamento.
  let r = 0x2f6e2b1;
  const aleatorio = () => {
    r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
    return ((r >>> 0) % 10000) / 10000;
  };
  const laranja = new Uint8Array(n);
  const semente = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    laranja[i] = aleatorio() < 0.42 ? 1 : 0;
    semente[i] = aleatorio();
  }

  const m: Malha = { v: new Float32Array(pts.flat()), n, arestas: new Uint16Array(pares), vizinhos, laranja, semente };
  malhas.set(nivel, m);
  return m;
}

function normalizar(p: number[]): number[] {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
}

// ── Brilho pré-renderizado (barato: drawImage em vez de shadowBlur) ─────────

const brilhos = new Map<string, HTMLCanvasElement>();
function brilho(cor: string, nucleoBranco: boolean): HTMLCanvasElement {
  const chave = `${cor}|${nucleoBranco}`;
  const pronto = brilhos.get(chave);
  if (pronto) return pronto;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  // O degradê do canvas interpola sem pré-multiplicar: terminar em
  // rgba(0,0,0,0) passa por marrom no caminho, e o brilho fica "sujo" no claro.
  const transparente = transparenteDe(cor);
  grad.addColorStop(0, cor);
  grad.addColorStop(nucleoBranco ? 0.25 : 0.18, cor);
  grad.addColorStop(nucleoBranco ? 1 : 0.55, transparente);
  grad.addColorStop(1, transparente);
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.fill();
  brilhos.set(chave, c);
  // Núcleo branco só no escuro (soma de luz); no claro um núcleo branco
  // sobre fundo branco some e o pacote parece um furo.
  if (!nucleoBranco) return c;
  const nucleo = g.createRadialGradient(32, 32, 0, 32, 32, 9);
  nucleo.addColorStop(0, 'rgba(255,255,255,0.9)');
  nucleo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = nucleo;
  g.fill();
  return c;
}

function transparenteDe(cor: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(cor);
  if (!m) return 'rgba(255,255,255,0)';
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0)`;
}

// ── Ticker compartilhado ─────────────────────────────────────────────────────

const instancias = new Set<MotorLogo>();
let raf = 0;
let ultimo = 0;

function quadro(agora: number) {
  const dt = Math.min(0.05, (agora - ultimo) / 1000 || 0.016);
  ultimo = agora;
  instancias.forEach((m) => m.passo(dt));
  raf = instancias.size ? requestAnimationFrame(quadro) : 0;
}

function registrar(m: MotorLogo) {
  instancias.add(m);
  if (!raf) {
    ultimo = performance.now();
    raf = requestAnimationFrame(quadro);
  }
}

function remover(m: MotorLogo) {
  instancias.delete(m);
  if (!instancias.size && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

// ── O motor ──────────────────────────────────────────────────────────────────

/** Ângulos dos 4 satélites na logo (graus, eixo y para baixo); o laranja é o último. */
const SATELITES = [-122.7, -35.6, 149.3, 60.1].map((g) => (g * Math.PI) / 180);
const FAIXAS = 9; // degraus de profundidade das linhas, como no SVG (0,05 → 0,45)
const MAX_PACOTES = 36;

type Efeito = 'onda' | 'giro' | 'expansao' | 'orbita' | 'enxame' | 'varredura' | 'pulso' | 'reflexo' | 'remontar';
const EFEITOS_CLIQUE: Efeito[] = ['onda', 'giro', 'expansao', 'orbita', 'enxame', 'varredura', 'pulso'];
const EFEITOS_SOZINHO: Efeito[] = ['onda', 'enxame', 'varredura', 'pulso', 'orbita'];
/** Efeitos que só existem com o A — entram no sorteio conforme a marca. */
const EFEITO_DA_MARCA: Record<Marca, Efeito | null> = { nenhuma: null, frente: 'reflexo', malha: 'remontar' };

interface Pacote { a: number; b: number; t: number; vel: number; saltos: number }
interface Ping { no: number; t: number; forte: boolean }

export interface OpcoesMotor {
  /** Lado do quadrado da logo, em px CSS. */
  tamanho: number;
  /** Folga em volta (fração do tamanho) para brilho e expansão não serem cortados. */
  folga: number;
  marca?: Marca;
}

export class MotorLogo {
  private ctx: CanvasRenderingContext2D;
  private m: Malha;
  private compacto: boolean;
  private tamanho: number;
  private folga: number;
  private dpr = 1;

  private paleta: Paleta = PALETA_PADRAO;
  private glow: HTMLCanvasElement | null = null;

  // Projeção do frame atual.
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private yMundo: Float32Array; // y depois da rotação, antes da projeção (varredura)
  private faixas: Int32Array[];
  private faixasN = new Int32Array(FAIXAS);

  // Estado.
  private calorNo: Float32Array;
  private calorAresta: Float32Array;
  private indiceAresta = new Map<number, number>();
  private pacotes: Pacote[] = [];
  private pings: Ping[] = [];

  private t = 0;
  private rotY = 0.6;
  private rotX = 0.32;
  private velY = 0;
  private velX = 0;
  private inclinaAlvoX = 0;
  private inclinaAlvoY = 0;
  private inclinaX = 0;
  private inclinaY = 0;
  private anel = 0;
  private velAnel = 0;
  private satOffset = 0;

  private ativo = false;
  private reduzido = false;
  private visivel = true;
  private ponteiro: { x: number; y: number } | null = null;
  private noPerto = -1;

  private proximoEvento = 3 + Math.random() * 4;
  private acumuladorPacote = 0;
  private ultimoEfeito: Efeito | null = null;

  // Efeitos com duração.
  private onda: { origem: number; t: number; saltos: Int16Array; max: number } | null = null;
  private expansao = -1;
  private varredura = -1;
  private orbita: { t: number; de: number; dir: number } | null = null;
  private pulso = -1;

  // A da marca.
  private marca: Marca;
  private glifo: Path2D | null = null;
  private grafo: GrafoA | null = null;
  private ax: Float32Array = new Float32Array(0);
  private ay: Float32Array = new Float32Array(0);
  private az: Float32Array = new Float32Array(0);
  private mx: Float32Array = new Float32Array(0);
  private my: Float32Array = new Float32Array(0);
  private mk: Float32Array = new Float32Array(0);
  /** Nó da esfera de onde cada nó do A sai ao se montar (e para onde volta). */
  private origemA: Int16Array = new Int16Array(0);
  private montagem: { t: number; desmontando: boolean } | null = null;
  private corridas: number[] = [];
  private reflexo = -1;

  constructor(private canvas: HTMLCanvasElement, opcoes: OpcoesMotor) {
    this.ctx = canvas.getContext('2d')!;
    this.tamanho = opcoes.tamanho;
    this.folga = opcoes.folga;
    // Abaixo de ~48px a malha densa vira um borrão: icosaedro uma vez
    // subdividido (42 nós) lê como esfera geodésica até em 20px.
    this.compacto = opcoes.tamanho < 48;
    this.m = malha(this.compacto ? 1 : 2);
    this.marca = opcoes.marca ?? 'nenhuma';
    if (this.marca === 'frente') {
      this.glifo = caminhoA();
      this.reflexo = 0.2;
    }
    if (this.marca === 'malha') {
      this.grafo = grafoA((this.compacto ? 0.36 : 0.385) * 1024, this.compacto ? 70 : 44);
      this.glifo = caminhoA();
      const g = this.grafo.n;
      this.ax = new Float32Array(g);
      this.ay = new Float32Array(g);
      this.az = new Float32Array(g);
      this.mx = new Float32Array(g);
      this.my = new Float32Array(g);
      this.mk = new Float32Array(g);
      this.origemA = new Int16Array(g).fill(-1);
      // Nasce montando: a primeira coisa que se vê é a esfera formar o A.
      this.montagem = { t: 0, desmontando: false };
      this.corridas = [0];
    }

    const { n, arestas } = this.m;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.yMundo = new Float32Array(n);
    this.calorNo = new Float32Array(n);
    this.calorAresta = new Float32Array(arestas.length / 2);
    this.faixas = Array.from({ length: FAIXAS }, () => new Int32Array(arestas.length / 2));
    for (let e = 0; e < arestas.length / 2; e++) {
      this.indiceAresta.set(this.chave(arestas[e * 2], arestas[e * 2 + 1]), e);
    }

    this.dimensionar();
    registrar(this);
  }

  destruir() {
    remover(this);
  }

  definirPaleta(p: Paleta) {
    this.paleta = p;
    this.glow = brilho(p.no, p.aditivo);
    if (!this.visivel || this.reduzido) this.desenhar();
  }

  /** Algo deu certo: a malha expande e volta, uma vez. */
  comemorar() {
    this.disparar('expansao');
  }

  definirAtivo(ativo: boolean) {
    if (ativo && !this.ativo) this.disparar('pulso');
    this.ativo = ativo;
  }

  definirReduzido(r: boolean) {
    this.reduzido = r;
  }

  definirVisivel(v: boolean) {
    this.visivel = v;
  }

  /** Coordenadas relativas ao quadrado da logo (0..1); null quando o ponteiro sai. */
  apontar(p: { x: number; y: number } | null) {
    this.ponteiro = p;
    if (!p) {
      this.inclinaAlvoX = 0;
      this.inclinaAlvoY = 0;
      this.noPerto = -1;
      return;
    }
    this.inclinaAlvoY = (p.x - 0.5) * 0.9;
    this.inclinaAlvoX = (p.y - 0.5) * 0.7;
  }

  /** Clique/toque: um efeito sorteado, a partir do nó mais perto do ponto. */
  tocar(p: { x: number; y: number }) {
    this.ponteiro = p;
    const no = this.noMaisPerto(p);
    const extra = EFEITO_DA_MARCA[this.marca];
    this.disparar(this.sortear(extra ? [...EFEITOS_CLIQUE, extra] : EFEITOS_CLIQUE), no);
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  passo(dt: number) {
    if (!this.visivel) return;
    if (this.reduzido) dt *= 0.25;
    this.t += dt;
    this.atualizar(dt);
    this.desenhar();
  }

  private atualizar(dt: number) {
    const ativo = this.ativo;
    const env = ativo ? envelope(this.t) : 0;

    // Giro base + impulsos de clique (amortecidos).
    const base = ativo ? 0.5 + env * 0.5 : this.ponteiro ? 0.32 : 0.2;
    this.rotY += (base + this.velY) * dt;
    this.rotX += this.velX * dt;
    const amortece = Math.exp(-2.4 * dt);
    this.velY *= amortece;
    this.velX *= amortece;
    // Sem impulso, a inclinação volta devagar para a da logo.
    this.rotX += (0.32 + Math.sin(this.t * 0.37) * 0.08 - this.rotX) * (1 - Math.exp(-0.8 * dt));

    const segue = 1 - Math.exp(-6 * dt);
    this.inclinaX += (this.inclinaAlvoX - this.inclinaX) * segue;
    this.inclinaY += (this.inclinaAlvoY - this.inclinaY) * segue;

    // Anel: deriva lenta, mais rápida quando ativo.
    this.anel += (ativo ? 0.45 : 0.07) * dt + this.velAnel * dt;
    this.velAnel *= Math.exp(-2 * dt);
    if (this.orbita) {
      this.orbita.t += dt / 1.5;
      const k = Math.min(1, this.orbita.t);
      this.satOffset = this.orbita.de + this.orbita.dir * Math.PI * 2 * suave(k);
      if (k >= 1) {
        this.satOffset = this.orbita.de;
        this.orbita = null;
      }
    }

    // Calor esfria.
    const esfria = Math.exp(-dt * 2.4);
    for (let i = 0; i < this.calorNo.length; i++) this.calorNo[i] *= esfria;
    const esfriaA = Math.exp(-dt * 1.7);
    for (let i = 0; i < this.calorAresta.length; i++) this.calorAresta[i] *= esfriaA;

    // Ponteiro em cima: o nó mais perto acende com a vizinhança.
    if (this.ponteiro) {
      this.noPerto = this.noMaisPerto(this.ponteiro);
      if (this.noPerto >= 0) {
        this.aquecerNo(this.noPerto, 1);
        for (const v of this.m.vizinhos[this.noPerto]) {
          this.aquecerAresta(this.noPerto, v, 0.85);
          this.aquecerNo(v, 0.45);
        }
        if (Math.random() < dt * 2.5) this.lancarPacote(this.noPerto);
      }
    }

    // Pacotes ambientes: sempre algum dado correndo.
    if (!this.reduzido || ativo) {
      const taxa = ativo ? 4 + env * 6 : this.compacto ? 0.45 : 0.9;
      this.acumuladorPacote += dt * taxa;
      while (this.acumuladorPacote >= 1) {
        this.acumuladorPacote -= 1;
        this.lancarPacote();
      }
    }
    this.moverPacotes(dt);

    for (const p of this.pings) p.t += dt / (p.forte ? 0.9 : 0.6);
    this.pings = this.pings.filter((p) => p.t < 1);

    // Evento aleatório de tempos em tempos, para a esfera nunca repetir.
    if (!this.reduzido) {
      this.proximoEvento -= dt;
      if (this.proximoEvento <= 0) {
        this.proximoEvento = (ativo ? 2.5 : 6) + Math.random() * (ativo ? 3 : 7);
        const extra = EFEITO_DA_MARCA[this.marca];
        this.disparar(this.sortear(extra ? [...EFEITOS_SOZINHO, extra, extra] : EFEITOS_SOZINHO));
      }
    }

    // Efeitos com duração.
    if (this.onda) {
      const o = this.onda;
      o.t += dt;
      const frente = o.t / 0.085;
      for (let i = 0; i < this.m.n; i++) {
        const d = frente - o.saltos[i];
        if (d >= 0 && d < 1) this.aquecerNo(i, 1 - d * 0.3);
      }
      const { arestas } = this.m;
      for (let e = 0; e < arestas.length / 2; e++) {
        const a = arestas[e * 2], b = arestas[e * 2 + 1];
        const s = Math.max(o.saltos[a], o.saltos[b]);
        const d = frente - s;
        if (d >= 0 && d < 1 && o.saltos[a] !== o.saltos[b]) this.calorAresta[e] = Math.max(this.calorAresta[e], 1 - d * 0.4);
      }
      if (frente > o.max + 2) this.onda = null;
    }
    if (this.expansao >= 0) {
      this.expansao += dt;
      if (this.expansao > 2.2) this.expansao = -1;
    }
    if (this.varredura >= 0) {
      this.varredura += dt / 1.1;
      if (this.varredura > 1) this.varredura = -1;
    }
    if (this.pulso >= 0) {
      this.pulso += dt / 1.2;
      if (this.pulso > 1) this.pulso = -1;
    }
    if (this.reflexo >= 0) {
      this.reflexo += dt / 1.1;
      if (this.reflexo > 1) this.reflexo = -1;
    }
    if (this.montagem) {
      this.montagem.t += dt;
      if (this.montagem.desmontando && this.montagem.t > 1.1) this.montagem = { t: 0, desmontando: false };
      else if (!this.montagem.desmontando && this.montagem.t > 1.6) this.montagem = null;
    }
    if (this.grafo) {
      // Energia correndo pelo contorno do A: uma em repouso, três respondendo.
      const quer = ativo ? 3 : 1;
      while (this.corridas.length < quer) this.corridas.push(Math.random() * this.grafo.contorno);
      if (this.corridas.length > quer) this.corridas.length = quer;
      const vel = (ativo ? 16 : 7) * dt;
      for (let i = 0; i < this.corridas.length; i++) this.corridas[i] = (this.corridas[i] + vel * (1 + i * 0.37)) % this.grafo.contorno;
    }
  }

  private disparar(efeito: Efeito, no = -1) {
    this.ultimoEfeito = efeito;
    const origem = no >= 0 ? no : this.noDaFrente();
    switch (efeito) {
      case 'onda': {
        const saltos = this.bfs(origem);
        let max = 0;
        for (let i = 0; i < saltos.length; i++) max = Math.max(max, saltos[i]);
        this.onda = { origem, t: 0, saltos, max };
        this.pings.push({ no: origem, t: 0, forte: true });
        break;
      }
      case 'giro': {
        const lado = Math.random() < 0.5 ? -1 : 1;
        this.velY += lado * (5 + Math.random() * 4);
        this.velX += (Math.random() - 0.5) * 5;
        this.velAnel -= lado * 3;
        break;
      }
      case 'expansao':
        this.expansao = 0;
        break;
      case 'orbita':
        if (!this.orbita) this.orbita = { t: 0, de: this.satOffset, dir: Math.random() < 0.5 ? -1 : 1 };
        break;
      case 'enxame':
        for (let i = 0; i < (this.compacto ? 6 : 14); i++) this.lancarPacote(origem, 4 + Math.floor(Math.random() * 5));
        this.pings.push({ no: origem, t: 0, forte: true });
        break;
      case 'varredura':
        this.varredura = 0;
        break;
      case 'reflexo':
        this.reflexo = 0;
        break;
      case 'remontar':
        if (!this.montagem) this.montagem = { t: 0, desmontando: true };
        break;
      case 'pulso':
        this.pulso = 0;
        if (this.marca === 'frente') this.reflexo = 0;
        for (let i = 0; i < this.m.n; i++) if (this.m.laranja[i]) this.aquecerNo(i, 0.6);
        break;
    }
  }

  private sortear(lista: Efeito[]): Efeito {
    const opcoes = lista.filter((e) => e !== this.ultimoEfeito);
    return opcoes[Math.floor(Math.random() * opcoes.length)];
  }

  private lancarPacote(de = -1, saltos = 2 + Math.floor(Math.random() * 5)) {
    if (this.pacotes.length >= MAX_PACOTES) return;
    const a = de >= 0 ? de : Math.floor(Math.random() * this.m.n);
    const viz = this.m.vizinhos[a];
    const b = viz[Math.floor(Math.random() * viz.length)];
    this.pacotes.push({ a, b, t: 0, vel: (this.ativo ? 3.2 : 2) + Math.random() * 1.6, saltos });
  }

  private moverPacotes(dt: number) {
    for (const p of this.pacotes) {
      p.t += dt * p.vel;
      this.aquecerAresta(p.a, p.b, 0.9 * Math.min(1, p.t * 2));
      if (p.t >= 1) {
        this.aquecerNo(p.b, 0.9);
        if (p.saltos-- > 0) {
          const viz = this.m.vizinhos[p.b];
          let prox = viz[Math.floor(Math.random() * viz.length)];
          if (prox === p.a) prox = viz[(viz.indexOf(prox) + 1) % viz.length];
          p.a = p.b;
          p.b = prox;
          p.t = 0;
        } else {
          p.saltos = -1;
          if (this.pings.length < 10) this.pings.push({ no: p.b, t: 0, forte: false });
        }
      }
    }
    this.pacotes = this.pacotes.filter((p) => p.saltos >= 0);
  }

  // ── Desenho ────────────────────────────────────────────────────────────────

  private dimensionar() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const lado = this.tamanho * (1 + this.folga * 2);
    this.canvas.width = Math.round(lado * this.dpr);
    this.canvas.height = Math.round(lado * this.dpr);
  }

  private desenhar() {
    const { ctx, m, tamanho: S, paleta } = this;
    const lado = this.canvas.width / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, lado, lado);

    const c = lado / 2;
    const ativo = this.ativo;
    const env = ativo ? envelope(this.t) : 0;
    // Proporções do SVG 1024: esfera e anel no raio 409,6.
    const rAnel = S * 0.4;
    const rEsfera = S * (this.compacto ? 0.36 : 0.385);

    // Projeção: rotação Y (giro + ponteiro), depois X (inclinação + ponteiro).
    const ay = this.rotY + this.inclinaY;
    const ax = this.rotX + this.inclinaX;
    const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
    const exp = this.expansao;
    for (let i = 0; i < m.n; i++) {
      let x = m.v[i * 3], y = m.v[i * 3 + 1], z = m.v[i * 3 + 2];
      let escala = 1;
      if (ativo) escala += env * 0.07 * Math.sin(this.t * 6.2 - y * 3.4);
      if (exp >= 0) escala += 0.42 * (0.4 + m.semente[i] * 0.6) * mola(exp);
      if (this.pulso >= 0) escala += 0.05 * Math.sin(this.pulso * Math.PI);
      x *= escala; y *= escala; z *= escala;
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      const persp = 1 + z2 * 0.09;
      this.px[i] = c + x1 * rEsfera * persp;
      this.py[i] = c + y2 * rEsfera * persp;
      this.pz[i] = z2;
      this.yMundo[i] = y2;
    }

    // Varredura: um paralelo atravessa a esfera e acende quem ele cruza.
    if (this.varredura >= 0) {
      const yv = -1.15 + this.varredura * 2.3;
      for (let i = 0; i < m.n; i++) {
        if (Math.abs(this.yMundo[i] - yv) < 0.09) this.aquecerNo(i, 1);
      }
    }

    // Linhas em degraus de profundidade (como o SVG: fundo quase some).
    this.faixasN.fill(0);
    const E = m.arestas.length / 2;
    for (let e = 0; e < E; e++) {
      const z = (this.pz[m.arestas[e * 2]] + this.pz[m.arestas[e * 2 + 1]]) / 2;
      const f = Math.min(FAIXAS - 1, Math.max(0, Math.floor(((z + 1) / 2) * FAIXAS)));
      this.faixas[f][this.faixasN[f]++] = e;
    }
    const espessura = this.compacto ? Math.max(0.4, S * 0.015) : Math.max(0.6, S * 0.0045);
    ctx.lineCap = 'round';
    ctx.lineWidth = espessura;
    ctx.strokeStyle = paleta.linha;
    const linhaBase = ativo ? 1.15 : 1;
    // Pequena, a metade de trás só embola a frente: fica de fora.
    for (let f = this.compacto ? 4 : 0; f < FAIXAS; f++) {
      const n = this.faixasN[f];
      if (!n) continue;
      ctx.globalAlpha = Math.min(1, (0.05 + f * 0.05) * paleta.linhaA * linhaBase * (this.compacto ? 1.5 : 1));
      ctx.beginPath();
      const lista = this.faixas[f];
      for (let k = 0; k < n; k++) {
        const e = lista[k];
        const a = m.arestas[e * 2], b = m.arestas[e * 2 + 1];
        ctx.moveTo(this.px[a], this.py[a]);
        ctx.lineTo(this.px[b], this.py[b]);
      }
      ctx.stroke();
    }

    // Arestas aquecidas (pacotes, onda, ponteiro) em laranja.
    ctx.strokeStyle = paleta.no;
    ctx.lineWidth = espessura * 1.7;
    for (let e = 0; e < E; e++) {
      const h = this.calorAresta[e];
      if (h < 0.04) continue;
      const a = m.arestas[e * 2], b = m.arestas[e * 2 + 1];
      const frente = ((this.pz[a] + this.pz[b]) / 2 + 1) / 2;
      ctx.globalAlpha = h * (0.2 + frente * 0.8);
      ctx.beginPath();
      ctx.moveTo(this.px[a], this.py[a]);
      ctx.lineTo(this.px[b], this.py[b]);
      ctx.stroke();
    }

    // Nós. Laranja: maiores na frente (3 → 6,5 no SVG); neutros: pontos pequenos.
    const u = S / 1024;
    const k = this.compacto ? 2.1 : 1.9;
    for (let i = 0; i < m.n; i++) {
      const frente = (this.pz[i] + 1) / 2;
      const h = this.calorNo[i];
      if (m.laranja[i] || h > 0.08) {
        const r = Math.max(0.5, (3 + 3.5 * frente) * u * k * (1 + h * 0.8 + (ativo ? env * 0.35 : 0)));
        ctx.globalAlpha = Math.min(1, (0.45 + 0.55 * frente) * (m.laranja[i] ? 1 : h));
        ctx.fillStyle = paleta.no;
        ctx.beginPath();
        ctx.arc(this.px[i], this.py[i], r, 0, Math.PI * 2);
        ctx.fill();
      } else if (!this.compacto) {
        ctx.globalAlpha = (0.3 + 0.35 * frente) * paleta.linhaA;
        ctx.fillStyle = paleta.linha;
        ctx.beginPath();
        ctx.arc(this.px[i], this.py[i], Math.max(0.45, 3.07 * u * k * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Paralelo da varredura.
    if (this.varredura >= 0) {
      const yv = -1.15 + this.varredura * 2.3;
      const larg = Math.sqrt(Math.max(0, 1 - yv * yv));
      if (larg > 0) {
        ctx.globalAlpha = 0.75 * Math.sin(this.varredura * Math.PI);
        ctx.strokeStyle = paleta.no;
        ctx.lineWidth = espessura * 1.6;
        ctx.beginPath();
        ctx.ellipse(c, c + yv * rEsfera, larg * rEsfera, larg * rEsfera * Math.abs(Math.sin(ax)) * 0.9 + 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (this.grafo) this.desenharMalhaA(c, rEsfera, espessura);

    // Brilhos: pacotes e pings.
    const glow = this.glow ?? brilho(paleta.no, paleta.aditivo);
    if (paleta.aditivo) ctx.globalCompositeOperation = 'lighter';
    const rPacote = this.compacto ? Math.max(1.2, S * 0.055) : Math.max(2.2, S * 0.032);
    for (const p of this.pacotes) {
      const t = Math.min(1, p.t);
      const x = this.px[p.a] + (this.px[p.b] - this.px[p.a]) * t;
      const y = this.py[p.a] + (this.py[p.b] - this.py[p.a]) * t;
      const z = this.pz[p.a] + (this.pz[p.b] - this.pz[p.a]) * t;
      const frente = (z + 1) / 2;
      ctx.globalAlpha = 0.25 + frente * 0.75;
      const r = rPacote * (0.6 + frente * 0.5);
      ctx.drawImage(glow, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = paleta.no;
    for (const p of this.pings) {
      const frente = (this.pz[p.no] + 1) / 2;
      ctx.globalAlpha = (1 - p.t) * (0.2 + frente * 0.7) * (p.forte ? 1 : 0.6);
      ctx.lineWidth = Math.max(0.6, espessura * (p.forte ? 2 : 1.2));
      ctx.beginPath();
      ctx.arc(this.px[p.no], this.py[p.no], (p.forte ? 0.16 : 0.07) * S * suave(p.t), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pulso: um anel sai da esfera (o "pensando" ao começar a responder).
    if (this.pulso >= 0) {
      ctx.globalAlpha = 0.5 * (1 - this.pulso);
      ctx.strokeStyle = paleta.no;
      ctx.lineWidth = Math.max(0.8, S * 0.008);
      ctx.beginPath();
      ctx.arc(c, c, rEsfera * (1 + this.pulso * 0.32), 0, Math.PI * 2);
      ctx.stroke();
    }

    this.desenharAnel(c, rAnel, env);
    if (this.marca === 'frente') this.desenharGlifo(c, env);
    ctx.globalAlpha = 1;
  }

  /** Opção 'frente': o A sólido, girando de leve no próprio eixo, com reflexo. */
  private desenharGlifo(c: number, env: number) {
    const { ctx, tamanho: S, paleta } = this;
    const giro = Math.sin(this.t * 0.45) * 0.22 + this.inclinaY * 0.5;
    const k = S / 1024;
    ctx.save();
    ctx.translate(c, c);
    // Escala horizontal pelo cosseno: o A vira como uma placa, sem sair do lugar.
    ctx.scale(Math.cos(giro) * (1 + env * 0.03), 1 + env * 0.03);
    ctx.translate(-512 * k, -512 * k);
    ctx.scale(k, k);
    ctx.globalAlpha = 1;
    ctx.fillStyle = paleta.no;
    ctx.fill(this.glifo!);
    if (this.reflexo >= 0) {
      // Faixa clara atravessando o glifo na diagonal, recortada nele.
      ctx.clip(this.glifo!);
      const x = 200 + this.reflexo * 700;
      const g = ctx.createLinearGradient(x - 90, 300, x + 90, 700);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(250, 300, 520, 450);
    }
    ctx.restore();
  }

  /**
   * Opção 'malha': o A como grafo preso à face da esfera. Cada nó do A sai do
   * nó da esfera mais próximo (de cima para baixo) e volta para ele ao
   * desmontar; alguns ficam ligados por um fio fino ao nó da esfera que está
   * embaixo, e esse vínculo troca enquanto a esfera gira.
   */
  private desenharMalhaA(c: number, rEsfera: number, espessura: number) {
    const { ctx, paleta, tamanho: S } = this;
    const g = this.grafo!;
    const giro = Math.sin(this.t * 0.45) * 0.28 + this.inclinaY * 0.8;
    const incl = this.inclinaX * 0.6;
    const ca = Math.cos(giro), sa = Math.sin(giro), cb = Math.cos(incl), sb = Math.sin(incl);
    for (let i = 0; i < g.n; i++) {
      const u = g.uv[i * 2], v = g.uv[i * 2 + 1];
      const z = Math.sqrt(Math.max(0, 1 - u * u - v * v));
      const x1 = u * ca + z * sa;
      const z1 = -u * sa + z * ca;
      const y2 = v * cb - z1 * sb;
      const z2 = v * sb + z1 * cb;
      const persp = 1 + z2 * 0.09;
      this.ax[i] = c + x1 * rEsfera * persp;
      this.ay[i] = c + y2 * rEsfera * persp;
      this.az[i] = z2;
    }

    // Progresso de cada nó na montagem (0 = dentro da esfera, 1 = no A).
    const mont = this.montagem;
    const progresso = (i: number) => {
      if (!mont) return 1;
      if (mont.desmontando) return 1 - suave(clamp((mont.t - (1 - g.atraso[i]) * 0.45) / 0.55));
      return suave(clamp((mont.t - g.atraso[i] * 0.8) / 0.75));
    };
    if (mont && mont.t < 0.02 && !mont.desmontando) this.origemA.fill(-1);
    const { mx: px, my: py, mk: pk } = this;
    for (let i = 0; i < g.n; i++) {
      const k = progresso(i);
      pk[i] = k;
      if (k >= 1) { px[i] = this.ax[i]; py[i] = this.ay[i]; continue; }
      if (this.origemA[i] < 0) this.origemA[i] = this.noMaisPertoTela(this.ax[i], this.ay[i]);
      const o = this.origemA[i];
      px[i] = this.px[o] + (this.ax[i] - this.px[o]) * k;
      py[i] = this.py[o] + (this.ay[i] - this.py[o]) * k;
    }
    if (!mont) this.origemA.fill(-1);

    // Vão na esfera atrás do A (apaga parte do que já foi desenhado), senão a
    // malha de trás compete com a letra. Acompanha a montagem.
    let montado = 0;
    for (let i = 0; i < g.n; i++) montado += pk[i];
    montado /= g.n;
    if (montado > 0.01) {
      const k = S / 1024;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.72 * montado;
      ctx.translate(c, c);
      ctx.scale(Math.cos(giro), 1);
      ctx.translate(-512 * k, -512 * k);
      ctx.scale(k, k);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 34;
      ctx.fill(this.glifo!);
      ctx.stroke(this.glifo!);
      ctx.restore();
    }

    // Fios até a esfera: a cada terceiro nó, para o nó visível mais perto.
    ctx.strokeStyle = paleta.no;
    ctx.lineWidth = espessura;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i < g.n; i += 3) {
      if (pk[i] < 1) continue;
      const o = this.noMaisPertoTela(px[i], py[i]);
      if (o < 0) continue;
      ctx.moveTo(px[i], py[i]);
      ctx.lineTo(this.px[o], this.py[o]);
    }
    ctx.stroke();

    // Arestas: contorno (as `contorno` primeiras) mais grosso que a treliça.
    const ar = g.arestas;
    for (let e = 0; e < ar.length / 2; e++) {
      const a = ar[e * 2], b = ar[e * 2 + 1];
      const k = Math.min(pk[a], pk[b]);
      if (k <= 0.02) continue;
      const doContorno = e < g.contorno;
      ctx.globalAlpha = k * (doContorno ? 0.95 : 0.55);
      ctx.lineWidth = espessura * (doContorno ? 2.3 : 1.25);
      ctx.beginPath();
      ctx.moveTo(px[a], py[a]);
      ctx.lineTo(px[b], py[b]);
      ctx.stroke();
    }

    ctx.fillStyle = paleta.no;
    const rNo = Math.max(0.7, S * (this.compacto ? 0.018 : 0.0085));
    for (let i = 0; i < g.n; i++) {
      ctx.globalAlpha = Math.max(0.15, pk[i]);
      ctx.beginPath();
      ctx.arc(px[i], py[i], rNo, 0, Math.PI * 2);
      ctx.fill();
    }

    // Energia correndo pelo contorno.
    if (!mont) {
      const glow = this.glow ?? brilho(paleta.no, paleta.aditivo);
      if (paleta.aditivo) ctx.globalCompositeOperation = 'lighter';
      const r = this.compacto ? Math.max(1.2, S * 0.06) : Math.max(2.4, S * 0.04);
      for (const s of this.corridas) {
        const i = Math.floor(s), j = (i + 1) % g.contorno, f = s - i;
        ctx.globalAlpha = 1;
        ctx.drawImage(glow, px[i] + (px[j] - px[i]) * f - r, py[i] + (py[j] - py[i]) * f - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private noMaisPertoTela(x: number, y: number): number {
    let melhor = -1, dist = Infinity;
    for (let i = 0; i < this.m.n; i++) {
      if (this.pz[i] < 0.1) continue;
      const d = (this.px[i] - x) ** 2 + (this.py[i] - y) ** 2;
      if (d < dist) { dist = d; melhor = i; }
    }
    return melhor;
  }

  /** Anel com quatro vãos e os satélites dentro dos vãos — o contorno da logo. */
  private desenharAnel(c: number, rAnel: number, env: number) {
    const { ctx, tamanho: S, paleta } = this;
    const expAnel = this.expansao >= 0 ? 0.08 * mola(this.expansao) : 0;
    const r = rAnel * (1 + expAnel);
    const rSat = S * (this.compacto ? 0.056 : 0.041);
    const traco = this.compacto ? Math.max(0.6, S * 0.026) : Math.max(1, S * 0.0057);
    const giro = this.anel + this.satOffset;
    const vao = Math.asin(Math.min(0.95, (rSat + traco * 2.2) / r));

    ctx.lineCap = 'round';
    ctx.strokeStyle = paleta.linha;
    ctx.lineWidth = traco;
    ctx.globalAlpha = paleta.aditivo ? 0.85 : 0.75;
    // Os vãos ficam onde os satélites estão; ordenados, os arcos vão de um ao próximo.
    const angulos = SATELITES.map((a) => a + giro);
    const ordem = angulos.map((a, i) => ({ a: norm(a), i })).sort((x, y) => x.a - y.a);
    ctx.beginPath();
    for (let k = 0; k < ordem.length; k++) {
      const de = ordem[k].a + vao;
      let ate = ordem[(k + 1) % ordem.length].a - vao;
      if (ate <= de) ate += Math.PI * 2;
      ctx.moveTo(c + Math.cos(de) * r, c + Math.sin(de) * r);
      ctx.arc(c, c, r, de, ate);
    }
    ctx.stroke();

    for (let i = 0; i < SATELITES.length; i++) {
      const a = angulos[i];
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      const principal = i === SATELITES.length - 1;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      if (principal) {
        const rr = rSat * 1.07 * (1 + env * 0.18 + (this.pulso >= 0 ? 0.2 * Math.sin(this.pulso * Math.PI) : 0));
        ctx.fillStyle = paleta.no;
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = paleta.satelite;
        ctx.arc(x, y, rSat, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = paleta.aditivo ? 0.85 : 0.75;
        ctx.stroke();
      }
    }
  }

  // ── Auxiliares ─────────────────────────────────────────────────────────────

  private chave(a: number, b: number) {
    return a < b ? a * 4096 + b : b * 4096 + a;
  }

  private aquecerNo(i: number, h: number) {
    if (h > this.calorNo[i]) this.calorNo[i] = h;
  }

  private aquecerAresta(a: number, b: number, h: number) {
    const e = this.indiceAresta.get(this.chave(a, b));
    if (e !== undefined && h > this.calorAresta[e]) this.calorAresta[e] = h;
  }

  /** Nó da face visível mais perto do ponto (0..1 do quadrado da logo). */
  private noMaisPerto(p: { x: number; y: number }): number {
    const lado = this.canvas.width / this.dpr;
    const off = (lado - this.tamanho) / 2;
    const x = off + p.x * this.tamanho;
    const y = off + p.y * this.tamanho;
    let melhor = -1;
    let dist = Infinity;
    for (let i = 0; i < this.m.n; i++) {
      if (this.pz[i] < 0) continue;
      const d = (this.px[i] - x) ** 2 + (this.py[i] - y) ** 2;
      if (d < dist) { dist = d; melhor = i; }
    }
    return melhor;
  }

  private noDaFrente(): number {
    const candidatos: number[] = [];
    for (let i = 0; i < this.m.n; i++) if (this.pz[i] > 0.3) candidatos.push(i);
    return candidatos.length ? candidatos[Math.floor(Math.random() * candidatos.length)] : 0;
  }

  private bfs(origem: number): Int16Array {
    const d = new Int16Array(this.m.n).fill(-1);
    d[origem] = 0;
    const fila = [origem];
    for (let k = 0; k < fila.length; k++) {
      const a = fila[k];
      for (const b of this.m.vizinhos[a]) {
        if (d[b] < 0) { d[b] = d[a] + 1; fila.push(b); }
      }
    }
    return d;
  }
}

/** Amplitude simulada de fala em 0..1 — senoides de períodos não-harmônicos. */
function envelope(t: number): number {
  const frase = 0.55 + 0.45 * Math.sin(t * 0.7);
  const silaba = Math.abs(Math.sin(t * 4.3)) * 0.6 + Math.abs(Math.sin(t * 7.1)) * 0.3;
  const enfase = Math.abs(Math.sin(t * 1.9)) * 0.25;
  return Math.min(1, Math.max(0, frase * (silaba + enfase)));
}

/** Expansão com retorno elástico: sobe rápido, volta oscilando e assenta. */
function mola(t: number): number {
  if (t < 0.18) return suave(t / 0.18);
  const u = t - 0.18;
  return Math.exp(-u * 3.2) * Math.cos(u * 9);
}

function suave(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function clamp(k: number): number {
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

function norm(a: number): number {
  const d = Math.PI * 2;
  return ((a % d) + d) % d;
}
