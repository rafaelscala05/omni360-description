import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, CalendarClock, Network } from 'lucide-react';
import type { CalendarArticle, ContentCluster } from './types';
import { listenCalendar } from '../../services/contentService';
import ContentMapView from './ContentMapView';

interface Props {
  uid: string;
  projectId: string;
  empresa: string;
  clusters: ContentCluster[];
  onSelectCluster?: (clusterId: string) => void;
  onOpenArticle?: (articleId: string) => void;
}

const DashboardPanel: React.FC<Props> = ({ uid, projectId, empresa, clusters, onSelectCluster, onOpenArticle }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  const emProducao = articles.filter((a) => a.status === 'em_producao');
  const publicados = articles
    .filter((a) => a.status === 'publicado')
    .sort((a, b) => (b.dataPublicacao ?? '').localeCompare(a.dataPublicacao ?? ''))
    .slice(0, 5);
  const proximos = articles.filter((a) => a.status === 'agendado').slice(0, 5);

  const card = (title: string, icon: React.ReactNode, body: React.ReactNode) => (
    <div className="ag-glass rounded-[22px] p-5">
      <div className="flex items-center gap-2 mb-3 text-(--ag-text)">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {body}
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">Painel de Operações</h1>
        <p className="text-[13.5px] text-(--ag-text-2)">{empresa}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {card(
          'Em produção agora',
          <Activity className="w-4 h-4 text-(--ag-warn)" />,
          emProducao.length ? (
            <ul className="space-y-2">
              {emProducao.map((a) => (
                <li key={a.id} className="text-sm text-(--ag-text)">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-(--ag-warn)">Etapa {a.stage}/5</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-(--ag-text-3)">Nada em produção.</p>
          ),
        )}

        {card(
          'Concluídos recentemente',
          <CheckCircle2 className="w-4 h-4 text-(--ag-ok)" />,
          publicados.length ? (
            <ul className="space-y-2">
              {publicados.map((a) => (
                <li key={a.id} className="text-sm text-(--ag-text)">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-(--ag-text-3)">{(a.dataPublicacao ?? '').split('T')[0]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-(--ag-text-3)">Nenhum artigo publicado.</p>
          ),
        )}

        {card(
          'Próximas publicações',
          <CalendarClock className="w-4 h-4 text-(--ag-accent)" />,
          proximos.length ? (
            <ul className="space-y-2">
              {proximos.map((a) => (
                <li key={a.id} className="text-sm text-(--ag-text)">
                  <span className="block truncate">{a.titulo}</span>
                  <span className="text-[11px] text-(--ag-text-3)">{a.scheduledDate}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-(--ag-text-3)">Nada agendado.</p>
          ),
        )}
      </div>

      {/* Meu Mapa de Conteúdo */}
      <section className="ag-glass rounded-[22px] p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-(--ag-text)">
            <Network className="w-4 h-4 text-(--ag-accent)" /> Meu mapa de conteúdo
          </h2>
          <span className="text-[12px] text-(--ag-text-3)">Arraste, dê zoom e passe o mouse para ver cada grupo · clique num cluster ou artigo para abrir</span>
        </div>
        <ContentMapView
          clusters={clusters}
          articles={articles}
          site={empresa}
          onSelectCluster={onSelectCluster ?? (() => {})}
          onOpenArticle={onOpenArticle}
        />
      </section>
    </div>
  );
};

export default DashboardPanel;
