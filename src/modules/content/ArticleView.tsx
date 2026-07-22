import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, RefreshCw, Globe, ExternalLink, Play, Pencil, Eye, Code, Wand2, Image as ImageIcon } from 'lucide-react';
import type { CalendarArticle } from './types';
import {
  updateArticle,
  publishArticle,
  produceArticle,
  listProductsForLinking,
  regenerateArticleImage,
  type LinkableProduct,
} from '../../services/contentService';
import { markdownToHtml } from './markdown';
import ProductLinkPicker from './ProductLinkPicker';

interface Props {
  uid: string;
  projectId: string;
  article: CalendarArticle;
  onClose: () => void;
  blogEnabled?: boolean;
}

// Pipeline stage order: Research → Outline → Draft → Review → Image
const STAGES = ['Pesquisa', 'Outline', 'Rascunho', 'Revisão', 'Imagem'];

const ArticleView: React.FC<Props> = ({ uid, projectId, article, onClose, blogEnabled }) => {
  const [edited, setEdited] = useState(article.articleFinal ?? article.articleDraft ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(article.titulo);
  const [allProducts, setAllProducts] = useState<LinkableProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(article.produtosVinculados ?? []);
  const [showImprovePrompt, setShowImprovePrompt] = useState(false);
  const [improvementPrompt, setImprovementPrompt] = useState('');
  const [productImageChoice, setProductImageChoice] = useState<string>('');

  useEffect(() => {
    listProductsForLinking(uid).then(setAllProducts).catch(() => setAllProducts([]));
  }, [uid]);

  const linkedProducts = useMemo(
    () =>
      selectedProductIds.map(
        (id) => allProducts.find((p) => p.id === id) ?? { id, nome: id, sku: '', imagemPrincipal: undefined },
      ),
    [selectedProductIds, allProducts],
  );

  const saveProdutos = (ids: string[]) => {
    setSelectedProductIds(ids);
    run('produtos', () => updateArticle(uid, projectId, article.id, { produtosVinculados: ids }));
  };
  const [destino, setDestino] = useState<'nativo' | 'integracao'>('integracao');
  // O artigo é produzido em Markdown; a aba Visualizar mostra o texto renderizado.
  const [modo, setModo] = useState<'visualizar' | 'editar'>('visualizar');
  const previewHtml = useMemo(() => markdownToHtml(edited), [edited]);

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
            <div className="space-y-2">
              <img src={article.imageUrl} alt="Capa" className="w-full rounded-xl border border-slate-200" />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImprovePrompt((v) => !v)}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Gerar novamente
                </button>
                {linkedProducts.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      run('image-product', async () => {
                        const targetId = linkedProducts.length === 1 ? linkedProducts[0].id : productImageChoice;
                        const product = linkedProducts.find((p) => p.id === targetId);
                        if (!product?.imagemPrincipal) {
                          setError('Selecione um produto vinculado que tenha imagem principal.');
                          return;
                        }
                        const { imageUrl } = await regenerateArticleImage(projectId, article.id, {
                          mode: 'fromProduct',
                          baseProductImageUrl: product.imagemPrincipal,
                        });
                        void imageUrl; // listenCalendar no componente pai atualiza o article.imageUrl
                      })
                    }
                    disabled={!!busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
                  >
                    <ImageIcon className="w-3.5 h-3.5" /> Gerar a partir do produto
                  </button>
                )}
                {linkedProducts.length > 1 && (
                  <select
                    value={productImageChoice}
                    onChange={(e) => setProductImageChoice(e.target.value)}
                    className="text-xs border border-slate-300 rounded-lg px-2 py-1.5"
                  >
                    <option value="">Escolher produto...</option>
                    {linkedProducts
                      .filter((p) => p.imagemPrincipal)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              {showImprovePrompt && (
                <div className="flex items-center gap-2">
                  <input
                    value={improvementPrompt}
                    onChange={(e) => setImprovementPrompt(e.target.value)}
                    placeholder="Ex: fundo branco, mais luminosa, foco no produto"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      run('image-improve', async () => {
                        await regenerateArticleImage(projectId, article.id, {
                          mode: 'improve',
                          improvementPrompt,
                        });
                        setShowImprovePrompt(false);
                        setImprovementPrompt('');
                      })
                    }
                    disabled={!!busy || !improvementPrompt.trim()}
                    className="px-3 py-2 text-sm font-medium text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-lg"
                  >
                    {busy === 'image-improve' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Produtos vinculados */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Produtos vinculados</label>
            <ProductLinkPicker products={allProducts} selectedIds={selectedProductIds} onChange={saveProdutos} />
          </div>

          {article.status === 'agendado' ? (
            <div className="text-center text-slate-400 py-10 text-sm">Artigo ainda não produzido.</div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">Conteúdo final</label>
                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setModo('visualizar')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 ${modo === 'visualizar' ? 'bg-[#FF5B03] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Eye className="w-3.5 h-3.5" /> Visualizar
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo('editar')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 border-l border-slate-200 ${modo === 'editar' ? 'bg-[#FF5B03] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Code className="w-3.5 h-3.5" /> Editar (Markdown)
                  </button>
                </div>
              </div>
              {modo === 'visualizar' ? (
                <div
                  className="article-preview border border-slate-200 rounded-lg px-5 py-4 max-h-[420px] overflow-y-auto bg-white text-[15px] leading-relaxed text-slate-800 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-[#FF5B03] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-[#FF5B03] [&_blockquote]:pl-3 [&_blockquote]:text-slate-500 [&_strong]:font-semibold [&_img]:max-w-full [&_img]:rounded-lg"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <textarea
                  value={edited}
                  onChange={(e) => setEdited(e.target.value)}
                  rows={16}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                />
              )}
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
              {blogEnabled && (
                <select
                  value={destino}
                  onChange={(e) => setDestino(e.target.value as 'nativo' | 'integracao')}
                  disabled={!!busy}
                  className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-60"
                >
                  <option value="nativo">Blog nativo</option>
                  <option value="integracao">WordPress/Sanity (integração)</option>
                </select>
              )}
              <button
                onClick={() => run('publish', () => publishArticle(projectId, article.id, blogEnabled ? (destino === 'nativo' ? 'blog' : undefined) : undefined))}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg"
              >
                {busy === 'publish' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} {blogEnabled ? 'Publicar' : 'Publicar no WordPress'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ArticleView;
