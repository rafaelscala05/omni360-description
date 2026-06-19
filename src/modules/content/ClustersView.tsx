import React, { useEffect, useState } from 'react';
import { Sparkles, Check, RefreshCw, Layers } from 'lucide-react';
import type { ContentCluster } from './types';
import { listenClusters, generateClusters, approveCluster } from '../../services/contentService';

interface Props {
  uid: string;
  projectId: string;
}

// Fase 2 — generate, review and approve content clusters.
const ClustersView: React.FC<Props> = ({ uid, projectId }) => {
  const [clusters, setClusters] = useState<ContentCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => listenClusters(uid, projectId, setClusters), [uid, projectId]);

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

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Clusters de Conteúdo</h1>
          <p className="text-sm text-slate-500 mt-0.5">Agrupamentos temáticos estratégicos pesquisados pelo Alfred.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] disabled:opacity-60 rounded-lg shadow-sm transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {clusters.length ? 'Gerar novamente' : 'Gerar clusters'}
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {!clusters.length && !loading && (
        <div className="text-center py-16 text-slate-400">
          <Layers className="w-10 h-10 mx-auto mb-3" />
          <p className="text-sm">Nenhum cluster ainda. Gere a primeira leva com base no seu negócio e catálogo.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clusters.map((cluster) => (
          <div key={cluster.id} className={`bg-white border rounded-2xl shadow-sm p-5 transition-colors ${cluster.aprovado ? 'border-[#004ac6]' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="font-semibold text-slate-900">{cluster.nome}</h3>
              <button
                onClick={() => approveCluster(uid, projectId, cluster.id, !cluster.aprovado)}
                className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${cluster.aprovado ? 'bg-[#004ac6] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                <Check className="w-3.5 h-3.5" /> {cluster.aprovado ? 'Aprovado' : 'Aprovar'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">{cluster.estrategia}</p>
            <ul className="space-y-1.5">
              {cluster.artigos.map((a, i) => (
                <li key={i} className="text-sm text-slate-700 flex flex-col">
                  <span>→ {a.titulo}</span>
                  <span className="text-[11px] text-slate-400">KW: {a.kw}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClustersView;
