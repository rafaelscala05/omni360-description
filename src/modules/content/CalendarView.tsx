import React, { useEffect, useState } from 'react';
import { CalendarDays, Sparkles, RefreshCw, Play, FileText } from 'lucide-react';
import type { CalendarArticle, ArticleStatus } from './types';
import { listenCalendar, generateCalendar, produceArticle } from '../../services/contentService';
import ArticleView from './ArticleView';

interface Props {
  uid: string;
  projectId: string;
}

const STATUS_LABEL: Record<ArticleStatus, string> = {
  agendado: 'Agendado',
  em_producao: 'Em produção',
  revisao: 'Revisão',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  erro: 'Erro',
};

const STATUS_STYLE: Record<ArticleStatus, string> = {
  agendado: 'bg-slate-100 text-slate-600',
  em_producao: 'bg-amber-100 text-amber-700',
  revisao: 'bg-indigo-100 text-indigo-700',
  aprovado: 'bg-emerald-100 text-emerald-700',
  publicado: 'bg-[#004ac6] text-white',
  erro: 'bg-red-100 text-red-700',
};

// Fase 3 — editorial calendar with per-article status and production controls.
const CalendarView: React.FC<Props> = ({ uid, projectId }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producing, setProducing] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      await generateCalendar(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar calendário');
    } finally {
      setLoading(false);
    }
  };

  const handleProduce = async (articleId: string) => {
    setProducing((p) => ({ ...p, [articleId]: true }));
    setError(null);
    try {
      await produceArticle(projectId, articleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao produzir artigo');
    } finally {
      setProducing((p) => ({ ...p, [articleId]: false }));
    }
  };

  const selectedArticle = articles.find((a) => a.id === selected) ?? null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Calendário Editorial</h1>
          <p className="text-sm text-slate-500 mt-0.5">Artigos agendados. A produção roda automaticamente na data, ou manualmente aqui.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-lg shadow-sm transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {articles.length ? 'Regerar calendário' : 'Gerar calendário'}
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {!articles.length && !loading && (
        <div className="text-center py-16 text-slate-400">
          <CalendarDays className="w-10 h-10 mx-auto mb-3" />
          <p className="text-sm">Nenhum artigo agendado. Aprove clusters e gere o calendário.</p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">
        {articles.map((a) => (
          <div key={a.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors">
            <div className="text-xs font-medium text-slate-500 w-24 shrink-0">{a.scheduledDate}</div>
            <div className="flex-1 min-w-0">
              <button onClick={() => setSelected(a.id)} className="text-sm font-medium text-slate-900 hover:text-[#004ac6] truncate block text-left w-full">
                {a.titulo}
              </button>
              <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal}{a.status === 'em_producao' ? ` · etapa ${a.stage}/5` : ''}</span>
            </div>
            <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
            <div className="flex items-center gap-1 shrink-0">
              {(a.status === 'agendado' || a.status === 'erro') && (
                <button
                  onClick={() => handleProduce(a.id)}
                  disabled={producing[a.id]}
                  title="Produzir agora"
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60 transition-colors"
                >
                  {producing[a.id] ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Produzir
                </button>
              )}
              {(a.status === 'revisao' || a.status === 'aprovado' || a.status === 'publicado') && (
                <button
                  onClick={() => setSelected(a.id)}
                  title="Ver artigo"
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" /> Ver
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedArticle && (
        <ArticleView uid={uid} projectId={projectId} article={selectedArticle} onClose={() => setSelected(null)} />
      )}
    </div>
  );
};

export default CalendarView;
