import React, { useMemo } from 'react';
import {
  ReactFlow, Background, Controls,
  type Node, type Edge, type NodeProps,
  Handle, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ContentCluster, CalendarArticle } from './types';

const CLUSTER_COLORS = [
  '#f97316', '#10b981', '#8b5cf6', '#f59e0b',
  '#14b8a6', '#f43f5e', '#6366f1', '#06b6d4',
];

function clamp(min: number, max: number, val: number) {
  return Math.max(min, Math.min(max, val));
}

function radialPos(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

type CircleData = {
  bg: string;
  size: number;
  label: string;
  tooltip: string;
  isCluster: boolean;
  clusterId?: string;
};

const CircleNode = ({ data }: NodeProps) => {
  const d = data as CircleData;
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden', pointerEvents: 'none' }} />
      <div
        title={d.tooltip}
        style={{
          width: d.size,
          height: d.size,
          borderRadius: '50%',
          background: d.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: d.size >= 60 ? 12 : d.size >= 40 ? 10 : 0,
          fontWeight: 600,
          fontFamily: 'inherit',
          overflow: 'hidden',
          padding: '0 4px',
          textAlign: 'center',
          lineHeight: 1.2,
          cursor: d.isCluster ? 'pointer' : 'default',
          boxSizing: 'border-box',
          userSelect: 'none',
        }}
      >
        {d.size >= 40 ? (d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label) : ''}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden', pointerEvents: 'none' }} />
    </>
  );
};

const nodeTypes = { circle: CircleNode };

interface Props {
  clusters: ContentCluster[];
  articles: CalendarArticle[];
  onSelectCluster: (clusterId: string) => void;
}

const ContentMapView: React.FC<Props> = ({ clusters, articles, onSelectCluster }) => {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const SITE_R = 40;
    const R1 = 220;
    const R2 = 110;

    nodes.push({
      id: 'site',
      type: 'circle',
      position: { x: -SITE_R, y: -SITE_R },
      data: {
        bg: '#FF5B03',
        size: SITE_R * 2,
        label: 'Site',
        tooltip: 'Site principal',
        isCluster: false,
      } satisfies CircleData,
    });

    const active = clusters.filter((c) => !c.excluido);
    const angleStep = active.length ? (2 * Math.PI) / active.length : 0;

    active.forEach((cluster, ci) => {
      const color = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
      const kws = cluster.palavrasChave ?? [];
      const sumVol = kws.reduce((s, k) => s + (k.volume ?? 0), 0);
      const r = clamp(22, 52, sumVol > 0 ? sumVol / 500 : 26);
      const angle = angleStep * ci - Math.PI / 2;
      const center = radialPos(0, 0, R1, angle);
      const volStr = sumVol > 0
        ? `${sumVol.toLocaleString('pt-BR')}/mês`
        : `${kws.length} palavras-chave`;

      nodes.push({
        id: cluster.id,
        type: 'circle',
        position: { x: center.x - r, y: center.y - r },
        data: {
          bg: color,
          size: r * 2,
          label: cluster.nome,
          tooltip: `${cluster.nome}\nVolume total: ${volStr}`,
          isCluster: true,
          clusterId: cluster.id,
        } satisfies CircleData,
      });

      edges.push({
        id: `s-${cluster.id}`,
        source: 'site',
        target: cluster.id,
        style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
        type: 'straight',
      });

      const clusterArts = articles.filter((a) => a.clusterId === cluster.id);
      const artStep = clusterArts.length ? (2 * Math.PI) / clusterArts.length : 0;

      clusterArts.forEach((art, ai) => {
        const kwVol = kws.find((k) => k.termo === art.kwPrincipal)?.volume;
        const ar = clamp(8, 22, kwVol != null && kwVol > 0 ? kwVol / 500 : 10);
        const artAngle = artStep * ai + angle;
        const artCenter = radialPos(center.x, center.y, R2, artAngle);
        const volLine = kwVol != null ? `\nVolume: ${kwVol.toLocaleString('pt-BR')}/mês` : '';

        nodes.push({
          id: art.id,
          type: 'circle',
          position: { x: artCenter.x - ar, y: artCenter.y - ar },
          data: {
            bg: color + 'cc',
            size: ar * 2,
            label: art.titulo,
            tooltip: `${art.titulo}\nKW: ${art.kwPrincipal}${volLine}`,
            isCluster: false,
          } satisfies CircleData,
        });

        edges.push({
          id: `${cluster.id}-${art.id}`,
          source: cluster.id,
          target: art.id,
          style: { stroke: '#cbd5e1', strokeWidth: 1 },
          type: 'straight',
        });
      });
    });

    return { nodes, edges };
  }, [clusters, articles]);

  const handleNodeClick = (_evt: React.MouseEvent, node: Node) => {
    const d = node.data as CircleData;
    if (d.isCluster && d.clusterId) onSelectCluster(d.clusterId);
  };

  const active = clusters.filter((c) => !c.excluido);
  if (!active.length) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Nenhum cluster ativo. Gere clusters para visualizar o mapa.
      </div>
    );
  }

  return (
    <div style={{ height: 520, width: '100%', borderRadius: 12, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export default ContentMapView;
