import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bold, Italic, Heading2, Heading3, List, Image as ImageIcon, RefreshCw, Check } from 'lucide-react';
import type { BlogPost, BlogCategory } from './types';
import { slugify, uniqueSlug } from './slug';
import { ensureHtml } from '../markdown';
import { saveBlogPost } from '../../../services/blogService';
import { auth } from '../../../firebase';

interface Props {
  uid: string;
  projectId: string;
  post: BlogPost | null; // null = novo
  existingPosts: BlogPost[]; // para uniqueSlug
  categories: BlogCategory[];
  onClose: () => void;
}

async function uploadImage(file: File): Promise<string> {
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

const PostEditor: React.FC<Props> = ({ uid, projectId, post, existingPosts, categories, onClose }) => {
  const isNew = post === null;
  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(!isNew);
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [coverImageUrl, setCoverImageUrl] = useState(post?.coverImageUrl ?? '');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [categoryIds, setCategoryIds] = useState<string[]>(post?.categoryIds ?? []);
  const [metaTitle, setMetaTitle] = useState(post?.seo.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = useState(post?.seo.metaDescription ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'draft' | 'published' | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const slugLocked = post?.status === 'published';

  const otherSlugs = useMemo(
    () => new Set(existingPosts.filter((p) => p.id !== post?.id).map((p) => p.slug)),
    [existingPosts, post?.id],
  );

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (isNew && !slugManuallyEdited) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    setSlug(value);
  };

  const handleCoverUpload = async (file: File) => {
    setUploadingCover(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      setCoverImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar imagem');
    } finally {
      setUploadingCover(false);
    }
  };

  const toggleCategory = (id: string) => {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const exec = (command: string, value?: string) => {
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const handleSave = async (status: 'draft' | 'published') => {
    setError(null);
    if (!title.trim()) {
      setError('Título é obrigatório.');
      return;
    }
    const finalSlug = slugLocked ? slug : uniqueSlug(slug || title, otherSlugs);
    if (!finalSlug) {
      setError('Slug é obrigatório.');
      return;
    }
    setSaving(status);
    try {
      const html = bodyRef.current?.innerHTML ?? '';
      const trimmedMetaTitle = metaTitle.trim();
      const trimmedMetaDescription = metaDescription.trim();
      const publishedAtValue =
        status === 'published' ? (post?.publishedAt ?? new Date().toISOString()) : post?.publishedAt;
      await saveBlogPost(uid, projectId, {
        id: post?.id,
        title: title.trim(),
        slug: finalSlug,
        html,
        excerpt: excerpt.trim(),
        categoryIds,
        status,
        seo: {
          ...(trimmedMetaTitle ? { metaTitle: trimmedMetaTitle } : {}),
          ...(trimmedMetaDescription ? { metaDescription: trimmedMetaDescription } : {}),
        },
        ...(coverImageUrl ? { coverImageUrl } : {}),
        ...(publishedAtValue ? { publishedAt: publishedAtValue } : {}),
        ...(post?.authorName ? { authorName: post.authorName } : {}),
        ...(post?.sourceArticleId ? { sourceArticleId: post.sourceArticleId } : {}),
        createdAt: post?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar post');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <h1 className="font-display text-2xl font-bold text-slate-900">{isNew ? 'Novo post' : 'Editar post'}</h1>
      </div>

      {error && <div className="mb-4 text-sm text-red-400 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Título</label>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Título do post"
            className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Slug</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">/</span>
            <input
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              disabled={slugLocked}
              placeholder="slug-do-post"
              className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03] disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
          {slugLocked && <p className="text-xs text-slate-400 mt-1">Slug imutável após publicado.</p>}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Resumo</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value.slice(0, 300))}
            maxLength={300}
            rows={3}
            placeholder="Resumo curto exibido nas listagens (máx. 300 caracteres)"
            className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03] resize-none"
          />
          <p className="text-xs text-slate-400 mt-1 text-right">{excerpt.length}/300</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Imagem de capa</label>
          {coverImageUrl && (
            <img src={coverImageUrl} alt="Capa" className="w-full max-h-48 object-cover rounded-xl border border-slate-200 mb-2" />
          )}
          <label className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 rounded-xl transition-colors cursor-pointer">
            {uploadingCover ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            {coverImageUrl ? 'Trocar imagem' : 'Enviar imagem'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCoverUpload(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Categorias</label>
          {categories.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma categoria criada ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <label
                  key={c.id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border cursor-pointer transition-colors ${
                    categoryIds.includes(c.id)
                      ? 'bg-[#FF5B03]/10 border-[#FF5B03] text-[#FF5B03]'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(c.id)}
                    onChange={() => toggleCategory(c.id)}
                    className="hidden"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Meta título (SEO)</label>
            <input
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Meta descrição (SEO)</label>
            <input
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Corpo</label>
          <div className="border border-slate-300 rounded-xl overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-1.5 bg-slate-50 border-b border-slate-200">
              <button type="button" onClick={() => exec('bold')} title="Negrito" className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-md">
                <Bold className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => exec('italic')} title="Itálico" className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-md">
                <Italic className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => exec('formatBlock', 'h2')} title="Título 2" className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-md">
                <Heading2 className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => exec('formatBlock', 'h3')} title="Título 3" className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-md">
                <Heading3 className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => exec('insertUnorderedList')} title="Lista" className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-md">
                <List className="w-4 h-4" />
              </button>
            </div>
            {/* ensureHtml: posts antigos do pipeline guardavam Markdown cru —
                converte ao abrir para editar com formatação real. */}
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: ensureHtml(post?.html ?? '') }}
              className="min-h-[240px] px-3.5 py-3 text-sm text-slate-800 focus:outline-none prose prose-sm max-w-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={() => handleSave('draft')}
            disabled={saving !== null}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-60 rounded-xl transition-colors"
          >
            {saving === 'draft' ? <RefreshCw className="w-4 h-4 animate-spin" /> : null} Salvar rascunho
          </button>
          <button
            onClick={() => handleSave('published')}
            disabled={saving !== null}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {saving === 'published' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Publicar
          </button>
        </div>
      </div>
    </div>
  );
};

export default PostEditor;
