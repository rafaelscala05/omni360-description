import React, { useState } from 'react';
import { X, Check, RefreshCw, Globe, ExternalLink, Play, Pencil } from 'lucide-react';
import type { CalendarArticle } from './types';
import { updateArticle, publishArticle, produceArticle } from '../../services/contentService';

interface Props {
  uid: string;
  projectId: string;
  article: CalendarArticle;
  onClose: () => void;
}

// Pipeline stage order: Research → Outline → Draft → Review → Image
const STAGES = ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem'];

const ArticleView: React.FC<Props> = ({ uid, projectId, article, onClose }) => {
  const [edited, setEdited] = useState(article.articleFinal ?? article.articleDraft ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(article.titulo);
  const [produtos, setProdutos] = useState(
    (article.produtosVinculados ?? []).join(', '),
  );

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(null);
    }
  };

  const saveTitle = () => {
    if (titleDraft.trim()) {
      run('title', () => updateArticle(uid, projectId, article.id, { titulo: titleDraft.trim() }));
    }
    setEditingTitle(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') { setTitleDraft(article.titulo); setEditingTitle(false); }
                  }}
                  className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
                />
                <button onClick={saveTitle} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => { setTitleDraft(article.titulo); setEditingTitle(false); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="font-display text-lg font-bold text-slate-900 truncate">{article.titulo}</h2>
                <button onClick={() => setEditingTitle(true)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded shrink-0">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-xs text-slate-400">KW: {article.kwPrincipal} · {article.scheduledDate}{article.scheduledTime ? ` · ${article.scheduledTime}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg shrink-0"><X className="w-5 h-5" /></button>
        </div>

        {/* Pipeline progress */}
        <div className="flex items-center gap-1.5 px-5 py-3 border-b border-slate-100">
          {STAGES.map((s, i) => {
            const done = article.stage > i + 1 || article.status === 'publicado' || article.status === 'aprovado' || article.status === 'revisao';
            const active = article.status === 'em_producao' && article.stage === i + 1;
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full h-1.5 rounded-full ${done ? 'bg-[#FF5B03]' : active ? 'bg-amber-400 animate-pulse' : 'bg-slate-200'}`} />
                <span className="text-[10px] text-slate-400">{s}</span>
              </div>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {article.status === 'erro' && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{article.lastError}</div>
          )}
          {article.imageUrl && (
            <img src={article.imageUrl} alt="Capa" className="w-full rounded-xl border border-slate-200" />
          )}

          {/* Produtos vinculados */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Produtos vinculados</label>
            <input
              value={produtos}
              onChange={(e) => setProdutos(e.target.value)}
              onBlur={() => run('produtos', () => updateArticle(uid, projectId, article.id, {
                produtosVinculados: produtos.split(',').map((s) => s.trim()).filter(Boolean),
              }))}
              placeholder="Nome ou ID dos produtos, separados por vírgula"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
            />
          </div>

          {article.status === 'agendado' ? (
            <div className="text-center text-slate-400 py-10 text-sm">Artigo ainda não produzido.</div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Conteúdo final (Markdown)</label>
              <textarea
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
                rows={16}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
              />
              {article.metaDescription && <p className="text-xs text-slate-400 mt-1">Meta: {article.metaDescription}</p>}
            </div>
          )}

          {article.urlPublicado && (
            <a href={article.urlPublicado} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[#FF5B03] hover:underline">
              <ExternalLink className="w-4 h-4" /> Ver artigo publicado
            </a>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100">
          {(article.status === 'agendado' || article.status === 'erro') && (
            <button
              onClick={() => run('produce', () => produceArticle(projectId, article.id))}
              disabled={!!busy}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg"
            >
              {busy === 'produce' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Produzir agora
            </button>
          )}
          {(article.status === 'revisao' || article.status === 'aprovado') && (
            <>
              <button
                onClick={() => run('save', () => updateArticle(uid, projectId, article.id, { articleFinal: edited, status: 'aprovado' }))}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
              >
                {busy === 'save' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar e aprovar
              </button>
              <button
                onClick={() => run('publish', () => publishArticle(projectId, article.id))}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg"
              >
                {busy === 'publish' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Publicar no WordPress
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ArticleView;
