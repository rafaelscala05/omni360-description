import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Check, RefreshCw, Layers, Eye, Pencil, Trash2, X, FileText } from 'lucide-react';
import type { ContentCluster, CalendarArticle } from './types';
import {
  listenClusters, listenCalendar, generateClusters, approveCluster, updateClusterName, excludeCluster,
} from '../../services/contentService';
import { INTENT_META } from './ClusterDetailView';
import ClusterDetailView from './ClusterDetailView';

interface Props {
  uid: string;
  projectId: string;
  onGoArticle: (id: string) => void;
  initialSelectedId?: string | null;
  onInitialClusterHandled?: () => void;
}

// Fase 2 — clusters enxutos: tema + palavras-chave por intenção, com ações de
// aprovar, editar (só o tema), ver mais e excluir (soft-delete). Artigos de
// clusters excluídos aparecem na aba "Sem cluster".
const ClustersView: React.FC<Props> = ({ uid, projectId, onGoArticle, initialSelectedId, onInitialClusterHandled }) => {
  const [clusters, setClusters] = useState<ContentCluster[]>([]);
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'clusters' | 'orphans'>('clusters');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => listenClusters(uid, projectId, setClusters), [uid, projectId]);
  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  const onInitialClusterHandledRef = React.useRef(onInitialClusterHandled);
  useEffect(() => { onInitialClusterHandledRef.current = onInitialClusterHandled; });

  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onInitialClusterHandledRef.current?.();
    }
  }, [initialSelectedId]);

  const active = useMemo(() => clusters.filter((c) => !c.excluido), [clusters]);
  const activeIds = useMemo(() => new Set(active.map((c) => c.id)), [active]);
  const orphanArticles = useMemo(() => articles.filter((a) => !activeIds.has(a.clusterId)), [articles, activeIds]);
  const countFor = (clusterId: string) => articles.filter((a) => a.clusterId === clusterId).length;

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      await generateClusters(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar clusters');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (c: ContentCluster) => { setEditingId(c.id); setEditName(c.nome); };
  const saveEdit = async () => {
    if (editingId && editName.trim()) await updateClusterName(uid, projectId, editingId, editName.trim());
    setEditingId(null);
  };

  const selectedCluster = clusters.find((c) => c.id === selectedId) ?? null;
  if (selectedCluster) {
    return (
      <ClusterDetailView
        uid={uid}
        projectId={projectId}
        cluster={selectedCluster}
        articles={articles.filter((a) => a.clusterId === selectedCluster.id)}
        allClusters={active}
        onBack={() => setSelectedId(null)}
        onGoArticle={onGoArticle}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Clusters de Conteúdo</h1>
          <p className="text-sm text-slate-500 mt-0.5">Temas estratégicos e palavras-chave por intenção de busca.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {active.length ? 'Gerar novamente' : 'Gerar clusters'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-200">
        {([['clusters', `Clusters (${active.length})`], ['orphans', `Sem cluster (${orphanArticles.length})`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-[#004ac6] text-[#004ac6]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {tab === 'clusters' ? (
        !active.length && !loading ? (
          <div className="text-center py-16 text-slate-400">
            <Layers className="w-10 h-10 mx-auto mb-3" />
            <p className="text-sm">Nenhum cluster ativo. Gere a primeira leva com base no seu negócio e catálogo.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AnimatePresence initial={false}>
              {active.map((cluster) => {
                const kws = cluster.palavrasChave ?? [];
                return (
                  <motion.div
                    key={cluster.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.18 }}
                    className={`group bg-white border rounded-xl shadow-sm p-4 transition-colors ${cluster.aprovado ? 'border-[#004ac6]' : 'border-slate-200'}`}
                  >
                    {/* Title row */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      {editingId === cluster.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                            className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                          />
                          <button onClick={saveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <h3 className="font-semibold text-slate-900 text-sm truncate">{cluster.nome}</h3>
                      )}
                    </div>

                    {editingId !== cluster.id && (
                      <>
                        <p className="text-xs text-slate-500 line-clamp-2 mb-3">{cluster.estrategia}</p>

                        {/* Keyword chips (compact) */}
                        {kws.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {kws.slice(0, 4).map((k) => (
                              <span key={k.termo} className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${INTENT_META[k.intencao].chip}`} title={INTENT_META[k.intencao].label}>
                                <span className={`w-1.5 h-1.5 rounded-full ${INTENT_META[k.intencao].dot}`} /> {k.termo}
                              </span>
                            ))}
                            {kws.length > 4 && <span className="text-[11px] text-slate-400 px-1 py-0.5">+{kws.length - 4}</span>}
                          </div>
                        )}

                        {/* Footer: count + actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><FileText className="w-3.5 h-3.5" /> {countFor(cluster.id)} artigos</span>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => approveCluster(uid, projectId, cluster.id, !cluster.aprovado)}
                              title={cluster.aprovado ? 'Aprovado' : 'Aprovar'}
                              className={`p-1.5 rounded-lg transition-colors ${cluster.aprovado ? 'text-[#004ac6] bg-[#eef3ff]' : 'text-slate-400 hover:text-[#004ac6] hover:bg-slate-100'}`}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setSelectedId(cluster.id)} title="Ver mais" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><Eye className="w-4 h-4" /></button>
                            <button onClick={() => startEdit(cluster)} title="Editar tema" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => excludeCluster(uid, projectId, cluster.id)} title="Excluir" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )
      ) : (
        // Orphan articles (cluster excluded or missing)
        orphanArticles.length ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100 overflow-hidden">
            {orphanArticles.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-900 truncate block">{a.titulo}</span>
                  <span className="text-[11px] text-slate-400">KW: {a.kwPrincipal} · {a.scheduledDate}</span>
                </div>
                <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 shrink-0">{a.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-3" />
            <p className="text-sm">Nenhum artigo sem cluster.</p>
          </div>
        )
      )}
    </div>
  );
};

export default ClustersView;
