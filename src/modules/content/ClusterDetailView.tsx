import React, { useState } from 'react';
import { ArrowLeft, ExternalLink, FileText, MoveRight, RefreshCw, TrendingUp } from 'lucide-react';
import type { ContentCluster, CalendarArticle, SearchIntent, ArticleStatus } from './types';
import { moveArticle } from '../../services/contentService';
import ArticleView from './ArticleView';

export const INTENT_META: Record<SearchIntent, { label: string; chip: string; dot: string }> = {
  informacional: { label: 'Informacional', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  comercial: { label: 'Comercial', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  transacional: { label: 'Transacional', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  navegacional: { label: 'Navegacional', chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
};

const STATUS_STYLE: Record<ArticleStatus, string> = {
  agendado: 'bg-slate-100 text-slate-600',
  em_producao: 'bg-amber-100 text-amber-700',
  revisao: 'bg-indigo-100 text-indigo-700',
  aprovado: 'bg-emerald-100 text-emerald-700',
  publicado: 'bg-[#004ac6] text-white',
  erro: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<ArticleStatus, string> = {
  agendado: 'Agendado',
  em_producao: 'Em produção',
  revisao: 'Revisão',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  erro: 'Erro',
};

interface Props {
  uid: string;
  projectId: string;
  cluster: ContentCluster;
  articles: CalendarArticle[];
  allClusters: ContentCluster[];
  onBack: () => void;
  onGoArticle: (id: string) => void;
}

const ClusterDetailView: React.FC<Props> = ({ uid, projectId, cluster, articles, allClusters, onBack, onGoArticle }) => {
  const [openArticle, setOpenArticle] = useState<string | null>(null);
  const [movingArticleId, setMovingArticleId] = useState<string | null>(null);
  const [movingTargetClusterId, setMovingTargetClusterId] = useState('');
  const [movingBusy, setMovingBusy] = useState(false);

  const intents: SearchIntent[] = ['informacional', 'comercial', 'transacional', 'navegacional'];
  const selectedArticle = articles.find((a) => a.id === openArticle) ?? null;
  const availableClusters = allClusters.filter((c) => c.id !== cluster.id && !c.excluido);

  const confirmMove = async () => {
    if (!movingArticleId || !movingTargetClusterId) return;
    setMovingBusy(true);
    try {
      await moveArticle(uid, projectId, movingArticleId, movingTargetClusterId);
    } finally {
      setMovingBusy(false);
      setMovingArticleId(null);
      setMovingTargetClusterId('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar aos clusters
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-2xl font-bold text-slate-900">{cluster.nome}</h1>
        {cluster.aprovado && <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Aprovado</span>}
      </div>
      <p className="text-sm text-slate-500 mb-6">{cluster.estrategia}</p>

      {/* Keywords by intent */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-slate-400" /> Palavras-chave por intenção</h2>
          <span className="text-[11px] text-slate-400">Volume em breve (Search Insights)</span>
        </div>
        <div className="space-y-3">
          {intents.map((intent) => {
            const kws = (cluster.palavrasChave ?? []).filter((k) => k.intencao === intent);
            if (!kws.length) return null;
            return (
              <div key={intent} className="flex items-start gap-2">
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border shrink-0 ${INTENT_META[intent].chip}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${INTENT_META[intent].dot}`} /> {INTENT_META[intent].label}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {kws.map((k) => (
                    <span key={k.termo} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                      {k.termo}
                      <span className="text-[10px] text-slate-400">{k.volume != null ? `${k.volume}/mês` : '—'}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {!(cluster.palavrasChave ?? []).length && <p className="text-sm text-slate-400">Nenhuma palavra-chave.</p>}
        </div>
      </div>

      {/* Linked articles */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> Artigos vinculados ({articles.length})</h2>
        </div>
        {articles.length ? (
          <div className="divide-y divide-slate-100">
            {articles.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-900 truncate block">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal} · {a.scheduledDate}{a.scheduledTime ? ` · ${a.scheduledTime}` : ''}</span>
                </div>
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onGoArticle(a.id)}
                    title="Visualizar artigo na Produção"
                    className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Ver
                  </button>
                  {availableClusters.length > 0 && (
                    <button
                      onClick={() => { setMovingArticleId(a.id); setMovingTargetClusterId(''); }}
                      title="Mover para outro cluster"
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      <MoveRight className="w-3.5 h-3.5" /> Mover
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 px-5 py-8 text-center">Nenhum artigo vinculado ainda. Gere o calendário para criar artigos deste tema.</p>
        )}
      </div>

      {/* Move article modal */}
      {movingArticleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMovingArticleId(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-slate-900 mb-4">Mover artigo para outro cluster</h3>
            <select
              value={movingTargetClusterId}
              onChange={(e) => setMovingTargetClusterId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] mb-4"
            >
              <option value="">Selecionar cluster…</option>
              {availableClusters.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMovingArticleId(null)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancelar</button>
              <button
                onClick={confirmMove}
                disabled={!movingTargetClusterId || movingBusy}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-lg"
              >
                {movingBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoveRight className="w-4 h-4" />} Mover
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedArticle && (
        <ArticleView uid={uid} projectId={projectId} article={selectedArticle} onClose={() => setOpenArticle(null)} />
      )}
    </div>
  );
};

export default ClusterDetailView;
