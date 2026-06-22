import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, CalendarClock, Network } from 'lucide-react';
import type { CalendarArticle, ContentCluster } from './types';
import { listenCalendar, listenClusters } from '../../services/contentService';
import ContentMapView from './ContentMapView';

interface Props {
  uid: string;
  projectId: string;
  empresa: string;
  onSelectCluster?: (clusterId: string) => void;
}

const DashboardPanel: React.FC<Props> = ({ uid, projectId, empresa, onSelectCluster }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [clusters, setClusters] = useState<ContentCluster[]>([]);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);
  useEffect(() => listenClusters(uid, projectId, setClusters), [uid, projectId]);

  const emProducao = articles.filter((a) => a.status === 'em_producao');
  const publicados = articles
    .filter((a) => a.status === 'publicado')
    .sort((a, b) => (b.dataPublicacao ?? '').localeCompare(a.dataPublicacao ?? ''))
    .slice(0, 5);
  const proximos = articles.filter((a) => a.status === 'agendado').slice(0, 5);

  const card = (title: string, icon: React.ReactNode, body: React.ReactNode) => (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3 text-slate-700">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {body}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-900">Painel de Operações</h1>
        <p className="text-sm text-slate-500 mt-0.5">{empresa}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {card(
          'Em produção agora',
          <Activity className="w-4 h-4 text-amber-500" />,
          emProducao.length ? (
            <ul className="space-y-2">
              {emProducao.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-amber-600">Etapa {a.stage}/5</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nada em produção.</p>
          ),
        )}

        {card(
          'Concluídos recentemente',
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
          publicados.length ? (
            <ul className="space-y-2">
              {publicados.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">{(a.dataPublicacao ?? '').split('T')[0]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nenhum artigo publicado.</p>
          ),
        )}

        {card(
          'Próximas publicações',
          <CalendarClock className="w-4 h-4 text-[#004ac6]" />,
          proximos.length ? (
            <ul className="space-y-2">
              {proximos.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">{a.scheduledDate}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nada agendado.</p>
          ),
        )}
      </div>

      {/* Meu Mapa de Conteúdo */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Network className="w-4 h-4 text-[#004ac6]" />
          <h3 className="text-sm font-semibold text-slate-700">Meu Mapa de Conteúdo</h3>
          <span className="ml-auto text-[11px] text-slate-400">Tamanho dos nós ∝ volume de pesquisa · Clique num cluster para abrir</span>
        </div>
        <ContentMapView
          clusters={clusters}
          articles={articles}
          onSelectCluster={onSelectCluster ?? (() => {})}
        />
      </div>
    </div>
  );
};

export default DashboardPanel;
