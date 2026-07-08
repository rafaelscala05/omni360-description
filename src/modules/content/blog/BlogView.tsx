import React, { useEffect, useState } from 'react';
import { ExternalLink, Plus, Pencil, Trash2, RefreshCw, Rocket, FileText, Tag, Palette, Globe2 } from 'lucide-react';
import type { BlogSettings, BlogPost, BlogCategory } from './types';
import { DEFAULT_BLOG_COLORS } from './types';
import {
  listenBlogSettings, saveBlogSettings, listenBlogPosts, deleteBlogPost, listenBlogCategories,
  claimBlogSlug,
} from '../../../services/blogService';
import PostEditor from './PostEditor';
import BlogCategories from './BlogCategories';
import BlogAppearance from './BlogAppearance';
import BlogDomains from './BlogDomains';

interface Props {
  uid: string;
  projectId: string;
}

type BlogTab = 'posts' | 'categorias' | 'aparencia' | 'dominios';

const TABS: Array<{ key: BlogTab; label: string; icon: React.ElementType }> = [
  { key: 'posts', label: 'Posts', icon: FileText },
  { key: 'categorias', label: 'Categorias', icon: Tag },
  { key: 'aparencia', label: 'Aparência', icon: Palette },
  { key: 'dominios', label: 'Domínios', icon: Globe2 },
];

const BlogView: React.FC<Props> = ({ uid, projectId }) => {
  const [settings, setSettings] = useState<BlogSettings | null | undefined>(undefined);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tab, setTab] = useState<BlogTab>('posts');
  const [editingPost, setEditingPost] = useState<BlogPost | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Setup inicial
  const [setupSlug, setSetupSlug] = useState('');
  const [setupTitle, setSetupTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => listenBlogSettings(uid, projectId, setSettings), [uid, projectId]);
  useEffect(() => listenBlogPosts(uid, projectId, setPosts), [uid, projectId]);
  useEffect(() => listenBlogCategories(uid, projectId, setCategories), [uid, projectId]);

  const handleCreateBlog = async () => {
    setSetupError(null);
    const slug = setupSlug.trim().toLowerCase();
    if (!slug || !setupTitle.trim()) {
      setSetupError('Endereço do blog e título são obrigatórios.');
      return;
    }
    setCreating(true);
    try {
      // O servidor normaliza (slugifica) o valor recebido e devolve o slug
      // canônico — é ele que deve ser persistido, não o input bruto do usuário.
      const { slug: claimedSlug } = await claimBlogSlug(projectId, slug);
      await saveBlogSettings(uid, projectId, {
        enabled: true,
        slug: claimedSlug,
        title: setupTitle.trim(),
        description: '',
        template: 'editorial',
        colors: DEFAULT_BLOG_COLORS,
        customDomains: [],
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : 'Erro ao criar blog');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (post: BlogPost) => {
    if (!window.confirm(`Excluir o post "${post.title}"?`)) return;
    setDeletingId(post.id);
    try {
      await deleteBlogPost(uid, projectId, post.id);
    } finally {
      setDeletingId(null);
    }
  };

  if (settings === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (settings === null) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <Rocket className="w-10 h-10 mx-auto text-[#FF5B03] mb-3" />
          <h1 className="font-display text-2xl font-bold text-slate-900">Criar blog</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure o endereço e o título do seu blog para começar.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          {setupError && <div className="text-sm text-red-400 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{setupError}</div>}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Endereço do blog</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 whitespace-nowrap">{window.location.origin}/b/</span>
              <input
                value={setupSlug}
                onChange={(e) => setSetupSlug(e.target.value)}
                placeholder="minha-empresa"
                className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Título</label>
            <input
              value={setupTitle}
              onChange={(e) => setSetupTitle(e.target.value)}
              placeholder="Blog da Minha Empresa"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={handleCreateBlog}
              disabled={creating}
              className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
            >
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} Criar blog
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editingPost !== null) {
    return (
      <PostEditor
        uid={uid}
        projectId={projectId}
        post={editingPost === 'new' ? null : editingPost}
        existingPosts={posts}
        categories={categories}
        onClose={() => setEditingPost(null)}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">{settings.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie posts, categorias, aparência e domínios do seu blog.</p>
        </div>
        <button
          onClick={() => window.open(`/b/${settings.slug}/`, '_blank')}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 rounded-xl transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> Ver blog
        </button>
      </div>

      <div className="flex items-center gap-1 mb-5 bg-slate-100 rounded-xl p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'posts' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setEditingPost('new')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] rounded-xl shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> Novo post
            </button>
          </div>

          {posts.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <FileText className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm">Nenhum post criado ainda.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">
              {posts.map((post) => (
                <div key={post.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{post.title}</p>
                    <p className="text-xs text-slate-400">
                      Atualizado em {new Date(post.updatedAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${
                      post.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {post.status === 'published' ? 'Publicado' : 'Rascunho'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingPost(post)}
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(post)}
                      disabled={deletingId === post.id}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 rounded-lg transition-colors"
                      title="Excluir"
                    >
                      {deletingId === post.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'categorias' && <BlogCategories uid={uid} projectId={projectId} categories={categories} />}
      {tab === 'aparencia' && <BlogAppearance uid={uid} projectId={projectId} settings={settings} hasPosts={posts.length > 0} />}
      {tab === 'dominios' && <BlogDomains uid={uid} projectId={projectId} settings={settings} />}
    </div>
  );
};

export default BlogView;
