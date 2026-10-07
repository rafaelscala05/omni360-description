import React, { useEffect, useState } from 'react';
import { confirmar } from '../../../services/confirmar';
import { ExternalLink, Plus, Pencil, Trash2, RefreshCw, Rocket, FileText, Tag, Palette, Globe2 } from 'lucide-react';
import type { BlogSettings, BlogPost, BlogCategory } from './types';
import { DEFAULT_BLOG_COLORS } from './types';
import {
  listenBlogSettings, saveBlogSettings, listenBlogPosts, deleteBlogPost, listenBlogCategories,
  claimBlogSlug,
} from '../../../services/blogService';
import { listenClusters, listenCalendar } from '../../../services/contentService';
import type { ContentCluster, CalendarArticle } from '../types';
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
  const [clusters, setClusters] = useState<ContentCluster[]>([]);
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
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
  useEffect(() => listenClusters(uid, projectId, setClusters), [uid, projectId]);
  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

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
    if (!await confirmar(`Excluir o post "${post.title}"?`)) return;
    setDeletingId(post.id);
    try {
      await deleteBlogPost(uid, projectId, post.id);
    } finally {
      setDeletingId(null);
    }
  };

  if (settings === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-(--ag-text-3)">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (settings === null) {
    return (
      <div className="max-w-lg">
        <div className="text-center mb-6">
          <Rocket className="w-10 h-10 mx-auto text-(--ag-accent) mb-3" />
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">Criar blog</h1>
          <p className="text-[13.5px] text-(--ag-text-2)">Configure o endereço e o título do seu blog para começar.</p>
        </div>

        <div className="ag-glass rounded-[22px] p-6 space-y-4">
          {setupError && <div className="text-sm text-(--ag-danger) bg-(--ag-danger-soft) border border-(--ag-danger-line) rounded-lg px-3 py-2">{setupError}</div>}
          <div>
            <label className="block text-sm font-semibold text-(--ag-text) mb-1.5">Endereço do blog</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-(--ag-text-3) whitespace-nowrap">{window.location.origin}/b/</span>
              <input
                value={setupSlug}
                onChange={(e) => setSetupSlug(e.target.value)}
                placeholder="minha-empresa"
                className="flex-1 border border-(--ag-hairline-2) rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--ag-accent)/30 focus:border-(--ag-accent)"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-(--ag-text) mb-1.5">Título</label>
            <input
              value={setupTitle}
              onChange={(e) => setSetupTitle(e.target.value)}
              placeholder="Blog da Minha Empresa"
              className="w-full border border-(--ag-hairline-2) rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--ag-accent)/30 focus:border-(--ag-accent)"
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={handleCreateBlog}
              disabled={creating}
              className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 disabled:opacity-60 rounded-full transition-colors"
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
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">{settings.title}</h1>
          <p className="text-[13.5px] text-(--ag-text-2)">Gerencie posts, categorias, aparência e domínios do seu blog.</p>
        </div>
        <button
          onClick={() => window.open(`/b/${settings.slug}/`, '_blank')}
          className="flex items-center gap-1.5 h-11 px-4 text-[13.5px] font-semibold text-(--ag-text) bg-(--ag-surface-solid) border border-(--ag-hairline) hover:bg-(--ag-fill) rounded-full transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> Ver blog
        </button>
      </div>

      <div className="flex items-center gap-1 mb-5 bg-(--ag-fill-2) rounded-xl p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
 tab === key ? 'bg-(--ag-surface-solid) text-(--ag-text) shadow-sm' : 'text-(--ag-text-2) hover:text-(--ag-text)'
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
              className="flex items-center gap-1.5 h-11 px-4 text-[13.5px] font-semibold text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 rounded-full transition-colors"
            >
              <Plus className="w-4 h-4" /> Novo post
            </button>
          </div>

          {posts.length === 0 ? (
            <div className="text-center py-16 text-(--ag-text-3)">
              <FileText className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm">Nenhum post criado ainda.</p>
            </div>
          ) : (
            <div className="ag-glass rounded-[22px] [&>*+*]:border-t [&>*+*]:border-(--ag-hairline) overflow-hidden">
              {posts.map((post) => (
                <div key={post.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-(--ag-fill) transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-(--ag-text) truncate">{post.title}</p>
                    <p className="text-xs text-(--ag-text-3)">
                      Atualizado em {new Date(post.updatedAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${
 post.status === 'published' ? 'bg-(--ag-ok-soft) text-(--ag-ok)' : 'bg-(--ag-fill-2) text-(--ag-text-2)'
 }`}
                  >
                    {post.status === 'published' ? 'Publicado' : 'Rascunho'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingPost(post)}
                      className="p-2 text-(--ag-text-3) hover:text-(--ag-text) hover:bg-(--ag-fill-2) rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(post)}
                      disabled={deletingId === post.id}
                      className="p-2 text-(--ag-text-3) hover:text-(--ag-danger) hover:bg-(--ag-danger-soft) disabled:opacity-60 rounded-lg transition-colors"
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

      {tab === 'categorias' && (
        <BlogCategories
          uid={uid}
          projectId={projectId}
          categories={categories}
          posts={posts}
          clusters={clusters}
          articles={articles}
        />
      )}
      {tab === 'aparencia' && <BlogAppearance uid={uid} projectId={projectId} settings={settings} hasPosts={posts.length > 0} />}
      {tab === 'dominios' && <BlogDomains uid={uid} projectId={projectId} settings={settings} />}
    </div>
  );
};

export default BlogView;
