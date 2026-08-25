import React, { useEffect, useMemo, useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import TurndownService from 'turndown';
import { X, Check, RefreshCw, Globe, ExternalLink, EyeOff, Play, Pencil, Eye, Code, Wand2, Image as ImageIcon, Upload, Trash2, User, ShoppingBag } from 'lucide-react';
import type { CalendarArticle, ArticleSize } from './types';
import {
  updateArticle,
  deleteArticle,
  publishArticle,
  unpublishArticle,
  produceArticle,
  listProductsForLinking,
  regenerateArticleImage,
  type LinkableProduct,
} from '../../services/contentService';
import { markdownToHtml } from './markdown';
import ProductLinkPicker from './ProductLinkPicker';
import ArticleSizePicker from './ArticleSizePicker';
import { auth } from '../../firebase';

// Editor rico (WYSIWYG) só cobre um subconjunto de Markdown (sem tabelas/código);
// a aba "Markdown" continua disponível para ajustes que fogem desse subconjunto.
const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    ['clean'],
  ],
};

async function uploadArticleImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const token = await user.getIdToken();
  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageBase64: dataUrl, filename: file.name }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  }
  const data = (await resp.json()) as { url: string };
  return data.url;
}

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
  const [produtosLinks, setProdutosLinks] = useState<Record<string, string>>(article.produtosLinks ?? {});
  const [showImprovePrompt, setShowImprovePrompt] = useState(false);
  const [improvementPrompt, setImprovementPrompt] = useState('');
  const [productImageChoice, setProductImageChoice] = useState<string>('');
  const [responsavel, setResponsavel] = useState(article.responsavel ?? '');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listProductsForLinking(uid).then(setAllProducts).catch(() => setAllProducts([]));
  }, [uid]);

  const linkedProducts = useMemo(
    () =>
      selectedProductIds.map((id) => ({
        ...(allProducts.find((p) => p.id === id) ?? { id, nome: id, sku: '', imagemPrincipal: undefined }),
        url: produtosLinks[id],
      })),
    [selectedProductIds, allProducts, produtosLinks],
  );

  const saveProdutos = (ids: string[]) => {
    setSelectedProductIds(ids);
    run('produtos', () => updateArticle(uid, projectId, article.id, { produtosVinculados: ids }));
  };
  // Digitar a URL dispara onChange a cada tecla — debounce para não gravar no
  // Firestore a cada caractere (diferente de saveProdutos, que só muda por clique).
  const produtosLinksSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProdutosLinks = (novosLinks: Record<string, string>) => {
    setProdutosLinks(novosLinks);
    if (produtosLinksSaveTimer.current) clearTimeout(produtosLinksSaveTimer.current);
    produtosLinksSaveTimer.current = setTimeout(() => {
      run('produtos-links', () => updateArticle(uid, projectId, article.id, { produtosLinks: novosLinks }));
    }, 600);
  };
  const [destino, setDestino] = useState<'nativo' | 'integracao'>('integracao');
  // O artigo é sempre salvo em Markdown (`edited`). "Visualizar" é a aba padrão,
  // somente leitura, para o usuário conferir o resultado antes de mexer em algo.
  // "Editor" é uma superfície WYSIWYG (HTML) sincronizada com esse Markdown via
  // markdownToHtml/turndown, e "Markdown" edita a fonte diretamente para casos
  // que o editor rico não cobre.
  const [modo, setModo] = useState<'visualizar' | 'editor' | 'markdown'>('visualizar');
  const previewHtml = useMemo(() => markdownToHtml(edited), [edited]);
  const [quillHtml, setQuillHtml] = useState(() => markdownToHtml(edited));

  // O 3º argumento ('user' | 'api' | 'silent') diz se a mudança veio de digitação
  // real ou do próprio Quill normalizando o HTML ao montar/receber `value` — sem
  // esse filtro, trocar de aba já reescrevia `edited` com espaços não-quebráveis
  // inseridos pelo Quill, quebrando o wrap do texto na aba Visualizar.
  const handleQuillChange = (html: string, _delta: unknown, source: string) => {
    if (source !== 'user') return;
    setQuillHtml(html);
    setEdited(turndownService.turndown(html));
  };

  const switchToEditor = () => {
    setQuillHtml(markdownToHtml(edited));
    setModo('editor');
  };

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

  const changeSize = (tamanho: ArticleSize) => {
    run('tamanho', () => updateArticle(uid, projectId, article.id, { tamanho }));
  };

  const saveResponsavel = (value: string) => {
    setResponsavel(value);
    run('responsavel', () => updateArticle(uid, projectId, article.id, { responsavel: value.trim() || undefined }));
  };

  const handleDelete = async () => {
    if (!window.confirm(`Excluir o artigo "${article.titulo}"? Essa ação não pode ser desfeita.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteArticle(uid, projectId, article.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir artigo');
    } finally {
      setDeleting(false);
    }
  };
  const hasDraft = article.stage >= 3 || !!article.articleDraft;

  const handleUploadImage = (file: File) => {
    run('image-upload', async () => {
      const imageUrl = await uploadArticleImage(file);
      await updateArticle(uid, projectId, article.id, { imageUrl });
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-white shrink-0">
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
                className="flex-1 max-w-xl border border-slate-300 rounded-lg px-2 py-1 text-base font-semibold focus:outline-none focus:ring-1 focus:ring-[#FF5B03]"
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
              <h2 className="font-display text-xl font-bold text-slate-900 truncate">{article.titulo}</h2>
              <button
                onClick={() => setEditingTitle(true)}
                title="Editar título"
                className="p-1 text-slate-400 hover:text-[#FF5B03] hover:bg-[#FFF3EC] rounded shrink-0 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <p className="text-xs text-slate-400 mt-0.5">KW: {article.kwPrincipal} · {article.scheduledDate}{article.scheduledTime ? ` · ${article.scheduledTime}` : ''}</p>
          <div className="flex items-center gap-2 mt-2">
            <ArticleSizePicker value={article.tamanho} onChange={changeSize} disabled={busy === 'tamanho'} />
            {hasDraft && (
              <span className="text-[10px] text-slate-400">
                Alterar o tamanho não reprocessa o rascunho já gerado desta produção.
              </span>
            )}
          </div>
        </div>

        {/* Pipeline progress */}
        <div className="hidden md:flex items-center gap-1.5 w-64 shrink-0 self-center">
          {STAGES.map((s, i) => {
            const done = article.stage > i + 1 || article.status === 'publicado' || article.status === 'aprovado' || article.status === 'revisao';
            const active = article.status === 'em_producao' && article.stage === i + 1;
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-1" title={s}>
                <div className={`w-full h-1.5 rounded-full ${done ? 'bg-[#FF5B03]' : active ? 'bg-amber-400 animate-pulse' : 'bg-slate-200'}`} />
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Excluir artigo"
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 rounded-lg"
          >
            {deleting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
          </button>
          <button onClick={onClose} title="Fechar" className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
      </div>

      {article.status === 'erro' && (
        <div className="text-sm text-red-600 bg-red-50 border-b border-red-200 px-6 py-2 shrink-0">{article.lastError}</div>
      )}

      {/* Body: sidebar + editor */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="lg:w-[360px] shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-200 bg-white p-5 space-y-5">
          {/* Cover image card */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Imagem de capa</h3>
            {article.imageUrl ? (
              <img src={article.imageUrl} alt="Capa" className="w-full aspect-video object-cover rounded-lg border border-slate-200" />
            ) : (
              <div className="w-full aspect-video flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 text-xs">
                Nenhuma imagem ainda
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowImprovePrompt((v) => !v)}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
              >
                <Wand2 className="w-3.5 h-3.5" /> {article.imageUrl ? 'Gerar novamente' : 'Gerar imagem'}
              </button>
              <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                {busy === 'image-upload' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Enviar imagem
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={!!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadImage(file);
                    e.target.value = '';
                  }}
                />
              </label>
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
                  <ImageIcon className="w-3.5 h-3.5" /> A partir do produto
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

          {/* Produtos vinculados card */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Produtos vinculados</h3>
            <p className="text-xs text-slate-400">
              Cole o link da página de cada produto — ele aparece clicável na vitrine ao lado do artigo.
            </p>
            <ProductLinkPicker
              products={allProducts}
              selectedIds={selectedProductIds}
              onChange={saveProdutos}
              links={produtosLinks}
              onLinksChange={saveProdutosLinks}
            />
          </div>

          {/* Vitrine de produtos no artigo — sticky: acompanha a rolagem do
              conteúdo, que costuma ser bem mais longo que a coluna lateral. */}
          {linkedProducts.length > 0 && (
            <div className="lg:sticky lg:top-5 border border-slate-200 rounded-xl p-4 space-y-3 bg-gradient-to-b from-orange-50/60 to-white">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <ShoppingBag className="w-3.5 h-3.5 text-[#FF5B03]" /> Produtos no artigo
              </h3>
              <p className="text-xs text-slate-400 -mt-2">Como a vitrine aparece para quem lê o artigo publicado.</p>
              <div className="space-y-2">
                {linkedProducts.map((p) =>
                  p.url ? (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-2.5 p-2 bg-white border border-slate-200 rounded-lg hover:border-[#FF5B03] hover:shadow-sm transition"
                    >
                      {p.imagemPrincipal ? (
                        <img src={p.imagemPrincipal} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                      ) : (
                        <span className="w-10 h-10 rounded-md bg-slate-200 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 text-xs font-medium text-slate-700 truncate group-hover:text-[#FF5B03]">
                        {p.nome}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#FF5B03] shrink-0" />
                    </a>
                  ) : (
                    <div key={p.id} className="flex items-center gap-2.5 p-2 bg-white border border-dashed border-slate-200 rounded-lg opacity-70">
                      {p.imagemPrincipal ? (
                        <img src={p.imagemPrincipal} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                      ) : (
                        <span className="w-10 h-10 rounded-md bg-slate-200 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 text-xs font-medium text-slate-600 truncate">{p.nome}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">sem link</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Responsável card */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <User className="w-3.5 h-3.5 text-slate-400" /> Responsável pelo artigo
            </h3>
            <p className="text-xs text-slate-400">Opcional — exibido como autor ao publicar no blog.</p>
            <input
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              onBlur={(e) => saveResponsavel(e.target.value)}
              placeholder="Nome do responsável"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
            />
          </div>

          {article.urlPublicado && (
            <a href={article.urlPublicado} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[#FF5B03] hover:underline">
              <ExternalLink className="w-4 h-4" /> Ver artigo publicado
            </a>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        {/* Main content editor */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {article.status === 'agendado' ? (
            <div className="text-center text-slate-400 py-16 text-sm">Artigo ainda não produzido.</div>
          ) : (
            <div className="max-w-3xl mx-auto min-w-0">
              <div className="flex items-center justify-between mb-2">
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
                    onClick={switchToEditor}
                    className={`flex items-center gap-1 px-2.5 py-1.5 border-l border-slate-200 ${modo === 'editor' ? 'bg-[#FF5B03] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo('markdown')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 border-l border-slate-200 ${modo === 'markdown' ? 'bg-[#FF5B03] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Code className="w-3.5 h-3.5" /> Markdown
                  </button>
                </div>
              </div>
              {modo === 'visualizar' && (
                <div
                  className="article-preview border border-slate-200 rounded-xl px-6 py-5 bg-white text-[15px] leading-relaxed text-slate-800 break-words [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-[#FF5B03] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-[#FF5B03] [&_blockquote]:pl-3 [&_blockquote]:text-slate-500 [&_strong]:font-semibold [&_img]:max-w-full [&_img]:rounded-lg"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
              {modo === 'editor' && (
                <ReactQuill
                  theme="snow"
                  value={quillHtml}
                  onChange={handleQuillChange}
                  modules={QUILL_MODULES}
                  className="article-editor-quill bg-white rounded-xl border border-slate-200 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-editor]:min-h-[420px] [&_.ql-editor]:text-[15px] [&_.ql-editor]:leading-relaxed [&_.ql-editor]:break-words"
                />
              )}
              {modo === 'markdown' && (
                <textarea
                  value={edited}
                  onChange={(e) => setEdited(e.target.value)}
                  rows={24}
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                />
              )}
              {article.metaDescription && <p className="text-xs text-slate-400 mt-2">Meta: {article.metaDescription}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-200 bg-white shrink-0">
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
          {article.status === 'publicado' && (
            <button
              onClick={() => run('unpublish', () => unpublishArticle(projectId, article.id))}
              disabled={!!busy}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-60 rounded-lg"
            >
              {busy === 'unpublish' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />} Despublicar
            </button>
          )}
      </div>
    </div>
  );
};

export default ArticleView;
