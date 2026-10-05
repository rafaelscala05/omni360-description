// "Meu mapa de conteúdo": o site no centro, os clusters em volta e os artigos
// de cada cluster presos a ele — um grafo de forças no espírito do grafo do
// Obsidian (física viva, arrastar, zoom, rótulos que aparecem conforme o zoom
// e o hover que acende a vizinhança e apaga o resto).
//
// Biblioteca: `react-force-graph-2d` (d3-force + Canvas 2D). Não é a mesma da
// logo porque a logo não usa biblioteca — é um motor próprio para uma esfera
// de geometria fixa, sem física. E Canvas 2D, não WebGL, pelo mesmo motivo do
// motor da logo: a página já tem várias logos animadas e o navegador derruba o
// contexto WebGL mais antigo quando passa do limite. O `@xyflow/react` que
// desenhava este mapa antes é para editores de fluxo, com posições fixas.
//
// Cores: lidas dos tokens `--ag-*` do contêiner a cada troca de tema, porque o
// canvas não herda CSS.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from 'react-force-graph-2d';
import { Maximize2 } from 'lucide-react';
import type { ContentCluster, CalendarArticle, ArticleStatus } from './types';
import { useAgentTheme } from '../agent/theme';

/** Uma cor por cluster — tons que funcionam no claro e no escuro. */
const CORES_CLUSTER = ['#ff7a2f', '#22b07d', '#8b5cf6', '#e0a106', '#14a3b8', '#ef476f', '#5b6cff', '#0ea5e9'];
const SEM_CLUSTER = '__sem_cluster__';

type Tipo = 'site' | 'cluster' | 'artigo';
interface No {
  id: string;
  tipo: Tipo;
  rotulo: string;
  cor: string;
  raio: number;
  status?: ArticleStatus;
  detalhe: string;
  clusterId?: string;
}
type NoGrafo = NodeObject<No>;
type LinkGrafo = LinkObject<No, { tipo: 'site' | 'cluster' }>;

const STATUS_ROTULO: Record<ArticleStatus, string> = {
  agendado: 'Agendado',
  em_producao: 'Em produção',
  revisao: 'Em revisão',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  erro: 'Erro',
};

const clamp = (min: number, max: number, v: number) => Math.max(min, Math.min(max, v));
const idDe = (x: string | number | NoGrafo | undefined): string => (typeof x === 'object' ? String(x.id) : String(x));

interface Paleta { texto: string; texto2: string; texto3: string; linha: string; fundo: string; perigo: string; acento: string }
// Resolve cada token numa cor que o canvas entende: alguns são `color-mix()`,
// que o `fillStyle` não aceita em todo navegador — o `color` computado sim.
const lerPaleta = (el: HTMLElement | null): Paleta => {
  const sonda = el ? document.createElement('span') : null;
  if (sonda && el) { sonda.style.display = 'none'; el.appendChild(sonda); }
  const v = (n: string, f: string) => {
    if (!sonda) return f;
    sonda.style.color = `var(${n})`;
    return getComputedStyle(sonda).color || f;
  };
  const p = {
    texto: v('--ag-text', '#0b0d12'),
    texto2: v('--ag-text-2', '#59626f'),
    texto3: v('--ag-text-3', '#8b94a3'),
    linha: v('--ag-hairline-2', 'rgba(15,23,42,.16)'),
    fundo: v('--ag-fill-solid', '#f2f3f6'),
    perigo: v('--ag-danger', '#dc2626'),
    acento: v('--ag-accent', '#ff5b03'),
  };
  sonda?.remove();
  return p;
};

interface Props {
  clusters: ContentCluster[];
  articles: CalendarArticle[];
  /** Nome do site/empresa — o nó do centro. */
  site?: string;
  onSelectCluster: (clusterId: string) => void;
  onOpenArticle?: (articleId: string) => void;
  altura?: number;
}

const ContentMapView: React.FC<Props> = ({ clusters, articles, site = 'Site', onSelectCluster, onOpenArticle, altura = 560 }) => {
  const { tema } = useAgentTheme();
  // Ref em estado, não `useRef`: o contêiner só existe depois que os dados
  // chegam (antes, o aviso de vazio ocupa o lugar), e os efeitos abaixo precisam
  // rodar de novo quando ele aparece — senão a largura fica 0 e o grafo nunca monta.
  const [caixa, setCaixa] = useState<HTMLDivElement | null>(null);
  const grafoRef = useRef<ForceGraphMethods<NoGrafo, LinkGrafo> | undefined>(undefined);
  const [largura, setLargura] = useState(0);
  const [paleta, setPaleta] = useState<Paleta>(() => lerPaleta(null));
  const [foco, setFoco] = useState<NoGrafo | null>(null);
  const ajustado = useRef(false);

  useEffect(() => {
    if (!caixa) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.floor(e.contentRect.width)));
    ro.observe(caixa);
    return () => ro.disconnect();
  }, [caixa]);
  // O tema muda os tokens; o canvas precisa reler.
  useEffect(() => { setPaleta(lerPaleta(caixa)); }, [caixa, tema]);

  const dados = useMemo(() => {
    const nodes: No[] = [];
    const links: LinkGrafo[] = [];
    const ativos = clusters.filter((c) => !c.excluido);
    const porCluster = new Map<string, CalendarArticle[]>();
    for (const a of articles) {
      const chave = a.clusterId && ativos.some((c) => c.id === a.clusterId) ? a.clusterId : SEM_CLUSTER;
      porCluster.set(chave, [...(porCluster.get(chave) ?? []), a]);
    }

    nodes.push({ id: 'site', tipo: 'site', rotulo: site, cor: '', raio: 9, detalhe: `${ativos.length} clusters · ${articles.length} artigos` });

    const grupos: Array<{ id: string; nome: string; cor: string; volume: number; kws: ContentCluster['palavrasChave'] }> = ativos.map((c, i) => ({
      id: c.id,
      nome: c.nome,
      cor: CORES_CLUSTER[i % CORES_CLUSTER.length],
      volume: (c.palavrasChave ?? []).reduce((s, k) => s + (k.volume ?? 0), 0),
      kws: c.palavrasChave ?? [],
    }));
    if (porCluster.has(SEM_CLUSTER)) grupos.push({ id: SEM_CLUSTER, nome: 'Sem cluster', cor: '', volume: 0, kws: [] });

    for (const g of grupos) {
      const arts = porCluster.get(g.id) ?? [];
      nodes.push({
        id: g.id,
        tipo: 'cluster',
        rotulo: g.nome,
        cor: g.cor,
        // Tamanho ∝ volume de busca (raiz, para um cluster enorme não engolir os outros).
        raio: clamp(4.5, 9, g.volume > 0 ? 3 + Math.sqrt(g.volume) / 18 : 5),
        detalhe: [
          g.volume > 0 ? `${g.volume.toLocaleString('pt-BR')} buscas/mês` : `${g.kws.length} palavras-chave`,
          `${arts.length} ${arts.length === 1 ? 'artigo' : 'artigos'}`,
        ].join(' · '),
        clusterId: g.id === SEM_CLUSTER ? undefined : g.id,
      });
      links.push({ source: 'site', target: g.id, tipo: 'site' });
      for (const a of arts) {
        const vol = g.kws.find((k) => k.termo === a.kwPrincipal)?.volume;
        nodes.push({
          id: `a:${a.id}`,
          tipo: 'artigo',
          rotulo: a.titulo || a.kwPrincipal,
          cor: g.cor,
          raio: clamp(2.2, 4.2, vol ? 1.6 + Math.sqrt(vol) / 20 : 2.6),
          status: a.status,
          detalhe: [STATUS_ROTULO[a.status], a.kwPrincipal, vol ? `${vol.toLocaleString('pt-BR')}/mês` : ''].filter(Boolean).join(' · '),
        });
        links.push({ source: g.id, target: `a:${a.id}`, tipo: 'cluster' });
      }
    }
    return { nodes: nodes as NoGrafo[], links };
  }, [clusters, articles, site]);

  // Vizinhança de cada nó, para o hover acender só ela.
  const vizinhos = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of dados.links) {
      const s = idDe(l.source), t = idDe(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t); m.get(t)!.add(s);
    }
    return m;
  }, [dados]);

  // Física: o site segura os clusters perto, cada cluster segura os artigos
  // bem perto dele, e a repulsão separa os grupos — o desenho "em ilhas".
  useEffect(() => {
    const g = grafoRef.current;
    if (!g) return;
    g.d3Force('charge')?.strength((n: NoGrafo) => (n.tipo === 'artigo' ? -42 : n.tipo === 'cluster' ? -200 : -280));
    g.d3Force('link')
      ?.distance((l: LinkGrafo) => (l.tipo === 'site' ? 80 : 26))
      .strength((l: LinkGrafo) => (l.tipo === 'site' ? 0.3 : 0.7));
    ajustado.current = false;
    g.d3ReheatSimulation();
  }, [dados, largura > 0]);

  const corDe = (n: No) => (n.tipo === 'site' ? paleta.acento : n.cor || paleta.texto3);
  const temProducao = articles.some((a) => a.status === 'em_producao');

  const desenhar = useCallback((n: NoGrafo, ctx: CanvasRenderingContext2D, escala: number) => {
    const x = n.x ?? 0, y = n.y ?? 0;
    const viz = foco ? (foco.id === n.id || vizinhos.get(String(foco.id))?.has(String(n.id))) : true;
    ctx.globalAlpha = viz ? 1 : 0.14;
    const cor = corDe(n);

    // Halo pulsante: artigo sendo escrito agora.
    if (n.status === 'em_producao') {
      const t = (performance.now() % 1600) / 1600;
      ctx.beginPath();
      ctx.arc(x, y, n.raio + 1 + t * 5, 0, Math.PI * 2);
      ctx.strokeStyle = cor;
      ctx.globalAlpha = (viz ? 1 : 0.14) * (1 - t) * 0.7;
      ctx.lineWidth = 1 / escala * 1.2;
      ctx.stroke();
      ctx.globalAlpha = viz ? 1 : 0.14;
    }

    ctx.beginPath();
    ctx.arc(x, y, n.raio, 0, Math.PI * 2);
    // Publicado/aprovado: cheio. Ainda no calendário: anel (o "rascunho" do mapa).
    const cheio = n.tipo !== 'artigo' || n.status === 'publicado' || n.status === 'aprovado' || n.status === 'em_producao';
    if (cheio) {
      ctx.fillStyle = cor;
      ctx.fill();
    } else {
      ctx.fillStyle = paleta.fundo;
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, 1.4 / escala);
      ctx.strokeStyle = n.status === 'erro' ? paleta.perigo : cor;
      ctx.stroke();
    }
    if (foco?.id === n.id) {
      ctx.beginPath();
      ctx.arc(x, y, n.raio + 2.2, 0, Math.PI * 2);
      ctx.lineWidth = 1.2 / escala;
      ctx.strokeStyle = paleta.texto;
      ctx.stroke();
    }

    // Rótulos como no Obsidian: site e clusters sempre; artigos aparecem com o zoom ou no hover.
    // No hover, os títulos dos vizinhos só com algum zoom — de longe eles se sobrepõem.
    const emFoco = foco?.id === n.id || (!!foco && viz && escala > 1.5);
    const mostrar = n.tipo !== 'artigo' || escala > 2.2 || emFoco;
    if (mostrar) {
      const tam = (n.tipo === 'site' ? 13 : n.tipo === 'cluster' ? 11.5 : 10) / escala;
      ctx.font = `${n.tipo === 'artigo' ? 400 : 600} ${tam}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const texto = n.rotulo.length > 42 ? `${n.rotulo.slice(0, 40)}…` : n.rotulo;
      // Artigo entra suave conforme o zoom chega perto do limiar.
      const alfa = n.tipo === 'artigo' && !emFoco ? clamp(0, 1, (escala - 2.2) / 0.8) : 1;
      ctx.globalAlpha = (viz ? 1 : 0.14) * alfa;
      // Contorno da cor do fundo: o rótulo continua legível sobre as linhas e os nós.
      const ty = y + n.raio + 3.5 / escala;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 / escala;
      ctx.strokeStyle = paleta.fundo;
      ctx.strokeText(texto, x, ty);
      ctx.fillStyle = n.tipo === 'artigo' ? paleta.texto2 : paleta.texto;
      ctx.fillText(texto, x, ty);
    }
    ctx.globalAlpha = 1;
  }, [foco, vizinhos, paleta]);

  const area = useCallback((n: NoGrafo, cor: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(n.x ?? 0, n.y ?? 0, n.raio + 2, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const ligado = (l: LinkGrafo) => !!foco && (idDe(l.source) === String(foco.id) || idDe(l.target) === String(foco.id));

  const ativos = clusters.filter((c) => !c.excluido);
  if (!ativos.length && !articles.length) {
    return (
      <div className="flex items-center justify-center h-64 text-(--ag-text-3) text-sm">
        Nenhum cluster ativo. Gere clusters para visualizar o mapa.
      </div>
    );
  }

  const publicados = articles.filter((a) => a.status === 'publicado').length;

  return (
    <div ref={setCaixa} className="relative w-full overflow-hidden rounded-[18px]" style={{ height: altura, background: 'var(--ag-fill-solid)' }}>
      {largura > 0 && (
        <ForceGraph2D<No, { tipo: 'site' | 'cluster' }>
          ref={grafoRef}
          width={largura}
          height={altura}
          graphData={dados}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeCanvasObject={desenhar}
          nodePointerAreaPaint={area}
          linkColor={(l) => (ligado(l) ? corDe((typeof l.target === 'object' ? l.target : l.source) as No) || paleta.texto2 : paleta.linha)}
          linkWidth={(l) => (ligado(l) ? 1.6 : l.tipo === 'site' ? 1 : 0.6)}
          // Com um nó em foco, só as ligações dele ficam (o resto do grafo já está apagado).
          linkVisibility={(l) => !foco || ligado(l)}
          onNodeHover={(n) => setFoco(n ?? null)}
          onNodeClick={(n) => {
            if (n.tipo === 'cluster' && n.clusterId) onSelectCluster(n.clusterId);
            else if (n.tipo === 'artigo' && onOpenArticle) onOpenArticle(String(n.id).slice(2));
          }}
          onBackgroundClick={() => setFoco(null)}
          // Arrastar solta o nó de volta na física (como no Obsidian), em vez de pregá-lo.
          onNodeDragEnd={(n) => { n.fx = undefined; n.fy = undefined; }}
          showPointerCursor={(o) => !!o && 'tipo' in o && (o.tipo === 'cluster' || (o.tipo === 'artigo' && !!onOpenArticle))}
          // Pulso dos artigos em produção precisa de redesenho contínuo.
          autoPauseRedraw={!temProducao}
          minZoom={0.4}
          maxZoom={8}
          cooldownTicks={180}
          d3VelocityDecay={0.32}
          onEngineStop={() => {
            if (ajustado.current) return;
            ajustado.current = true;
            grafoRef.current?.zoomToFit(500, 48);
          }}
        />
      )}

      {/* Legenda e recentralizar — por cima do canvas, sem tapar o centro. */}
      <div className="pointer-events-none absolute left-3 bottom-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 rounded-full text-[11.5px] text-(--ag-text-2) ag-glass">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--ag-text-2)' }} /> Publicado/aprovado</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ boxShadow: 'inset 0 0 0 1.5px var(--ag-text-2)' }} /> No calendário</span>
        <span className="hidden sm:inline tabular-nums">{ativos.length} clusters · {articles.length} artigos · {publicados} publicados</span>
      </div>
      <button
        onClick={() => grafoRef.current?.zoomToFit(500, 48)}
        aria-label="Recentralizar o mapa"
        title="Recentralizar"
        className="absolute right-3 top-3 w-9 h-9 rounded-full grid place-items-center text-(--ag-text-2) hover:text-(--ag-text) ag-glass"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      {foco && (
        <div className="pointer-events-none absolute right-3 bottom-3 max-w-[280px] px-3 py-2 rounded-[14px] ag-glass">
          <div className="text-[13px] font-semibold text-(--ag-text) leading-snug">{foco.rotulo}</div>
          <div className="text-[11.5px] text-(--ag-text-2)">{foco.detalhe}</div>
        </div>
      )}
    </div>
  );
};

export default ContentMapView;
