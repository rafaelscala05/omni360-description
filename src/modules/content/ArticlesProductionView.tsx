import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock,
} from 'lucide-react';
import type { CalendarArticle, ArticleStatus, ArticleSize, ContentCluster } from './types';
import { listenCalendar, generateCalendar, produceArticle, updateArticle } from '../../services/contentService';
import ArticleView from './ArticleView';
import ArticleSizePicker from './ArticleSizePicker';

interface Props {
  uid: string;
  projectId: string;
  clusters: ContentCluster[];
  initialOpenId?: string;
  onGoCluster: (clusterId: string) => void;
  blogEnabled?: boolean;
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
  revisao: 'bg-orange-100 text-orange-700',
  aprovado: 'bg-emerald-100 text-emerald-700',
  publicado: 'bg-[#FF5B03] text-white',
  erro: 'bg-red-100 text-red-700',
};

function formatDateTime(date: string, time?: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return time ? `${day} · ${time}` : day;
}

const ArticlesProductionView: React.FC<Props> = ({ uid, projectId, clusters, initialOpenId, onGoCluster, blogEnabled }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producing, setProducing] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(initialOpenId ?? null);

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedTime, setReschedTime] = useState('');

  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  const didOpenInitial = useRef(false);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  useEffect(() => {
    if (initialOpenId && !didOpenInitial.current && articles.length) {
      didOpenInitial.current = true;
      setSelected(initialOpenId);
    }
  }, [initialOpenId, articles]);

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

  const openReschedule = (a: CalendarArticle) => {
    setReschedulingId(a.id);
    setReschedDate(a.scheduledDate);
    setReschedTime(a.scheduledTime ?? '');
  };

  const confirmReschedule = async () => {
    if (!reschedulingId || !reschedDate) return;
    await updateArticle(uid, projectId, reschedulingId, {
      scheduledDate: reschedDate,
      scheduledTime: reschedTime || undefined,
    });
    setReschedulingId(null);
  };

  const startTitleEdit = (a: CalendarArticle) => {
    setEditingTitleId(a.id);
    setTitleDraft(a.titulo);
  };

  const saveTitleEdit = async () => {
    if (!editingTitleId || !titleDraft.trim()) return;
    await updateArticle(uid, projectId, editingTitleId, { titulo: titleDraft.trim() });
    setEditingTitleId(null);
  };

  const changeSize = (articleId: string, tamanho: ArticleSize) => {
    updateArticle(uid, projectId, articleId, { tamanho });
  };

  const selectedArticle = articles.find((a) => a.id === selected) ?? null;
  const clusterName = (clusterId: string) => clusters.find((c) => c.id === clusterId)?.nome ?? null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Produção de Artigos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Artigos agendados. Produza manualmente ou aguarde a automação na data.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg shadow-sm transition-colors"
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
        {articles.map((a) => {
          const cName = clusterName(a.clusterId);
          return (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
              <div className="text-xs font-medium text-slate-500 w-24 shrink-0">
                {formatDateTime(a.scheduledDate, a.scheduledTime)}
              </div>

              <div className="flex-1 min-w-0">
                {editingTitleId === a.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setEditingTitleId(null); }}
                      className="flex-1 border border-slate-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                    />
                    <button onClick={saveTitleEdit} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingTitleId(null)} className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => setSelected(a.id)} className="text-sm font-medium text-slate-900 hover:text-[#FF5B03] truncate text-left">
                      {a.titulo}
                    </button>
                    <button onClick={() => startTitleEdit(a)} className="p-0.5 text-slate-300 hover:text-slate-600 rounded shrink-0">
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal}{a.status === 'em_producao' ? ` · etapa ${a.stage}/5` : ''}</span>
                  <ArticleSizePicker value={a.tamanho} onChange={(size) => changeSize(a.id, size)} />
                  {cName && (
                    <button
                      onClick={() => onGoCluster(a.clusterId)}
                      className="text-[11px] font-medium text-[#FF5B03] bg-[#FFF3EC] px-1.5 py-0.5 rounded hover:bg-[#FFD3BF] transition-colors"
                    >
                      {cName}
                    </button>
                  )}
                </div>
              </div>

              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>
                {STATUS_LABEL[a.status]}
              </span>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openReschedule(a)}
                  title="Reagendar"
                  className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                </button>
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
          );
        })}
      </div>

      {reschedulingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setReschedulingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-slate-900 mb-4">Reagendar artigo</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
                <input
                  type="date"
                  value={reschedDate}
                  onChange={(e) => setReschedDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Horário</label>
                <input
                  type="time"
                  value={reschedTime}
                  onChange={(e) => setReschedTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setReschedulingId(null)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancelar</button>
              <button onClick={confirmReschedule} className="px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-lg">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {selectedArticle && (
        <ArticleView uid={uid} projectId={projectId} article={selectedArticle} onClose={() => setSelected(null)} blogEnabled={blogEnabled} />
      )}
    </div>
  );
};

export default ArticlesProductionView;
