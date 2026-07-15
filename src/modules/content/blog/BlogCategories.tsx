import React, { useState } from 'react';
import { Plus, Trash2, RefreshCw, Network } from 'lucide-react';
import type { BlogCategory, BlogPost } from './types';
import type { ContentCluster, CalendarArticle } from '../types';
import { slugify } from './slug';
import { saveBlogCategory, deleteBlogCategory, saveBlogPost } from '../../../services/blogService';

interface Props {
  uid: string;
  projectId: string;
  categories: BlogCategory[];
  posts: BlogPost[];
  clusters: ContentCluster[];
  articles: CalendarArticle[];
}

const BlogCategories: React.FC<Props> = ({ uid, projectId, categories, posts, clusters, articles }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [populating, setPopulating] = useState(false);
  const [populateMsg, setPopulateMsg] = useState<string | null>(null);

  // Nº de posts publicados que têm cluster identificável — habilita o botão.
  const linkablePosts = posts.filter(
    (p) => p.status === 'published' && p.sourceArticleId &&
      articles.some((a) => a.id === p.sourceArticleId && clusters.some((c) => c.id === a.clusterId && !c.excluido)),
  ).length;

  // Cria/reaproveita uma categoria por cluster e vincula os posts publicados
  // daquele cluster. Idempotente: reusa categoria com mesmo slug e só adiciona
  // categoryIds ausentes. Só toca posts já publicados (via sourceArticleId).
  const handlePopulateFromClusters = async () => {
    if (!window.confirm(
      'Isto cria (ou reaproveita) uma categoria com o nome de cada cluster e vincula os posts já publicados a ela. Continuar?',
    )) return;
    setError(null);
    setPopulateMsg(null);
    setPopulating(true);
    try {
      const articleCluster = new Map(articles.map((a) => [a.id, a.clusterId]));
      const clusterById = new Map(clusters.filter((c) => !c.excluido).map((c) => [c.id, c]));
      // Slug → categoria existente (para reaproveitar).
      const catBySlug = new Map(categories.map((c) => [c.slug, c]));

      // Agrupa posts publicados por cluster.
      const postsByCluster = new Map<string, BlogPost[]>();
      for (const p of posts) {
        if (p.status !== 'published' || !p.sourceArticleId) continue;
        const clusterId = articleCluster.get(p.sourceArticleId);
        if (!clusterId || !clusterById.has(clusterId)) continue;
        const arr = postsByCluster.get(clusterId) ?? [];
        arr.push(p);
        postsByCluster.set(clusterId, arr);
      }

      let catsCreated = 0;
      let catsReused = 0;
      let linksAdded = 0;

      for (const [clusterId, clusterPosts] of postsByCluster) {
        const cluster = clusterById.get(clusterId)!;
        const slug = slugify(cluster.nome);
        let category = catBySlug.get(slug);
        if (!category) {
          const id = await saveBlogCategory(uid, projectId, { name: cluster.nome, slug });
          category = { id, name: cluster.nome, slug, createdAt: new Date().toISOString() };
          catBySlug.set(slug, category);
          catsCreated++;
        } else {
          catsReused++;
        }
        for (const p of clusterPosts) {
          if ((p.categoryIds ?? []).includes(category.id)) continue;
          await saveBlogPost(uid, projectId, {
            ...p,
            categoryIds: [...(p.categoryIds ?? []), category.id],
          });
          linksAdded++;
        }
      }

      setPopulateMsg(
        postsByCluster.size === 0
          ? 'Nenhum post publicado com cluster identificado.'
          : `${catsCreated} categoria(s) criada(s), ${catsReused} reaproveitada(s), ${linksAdded} vínculo(s) adicionado(s).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao popular categorias pelos clusters');
    } finally {
      setPopulating(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) setSlug(slugify(value));
  };

  const handleAdd = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);
    try {
      await saveBlogCategory(uid, projectId, {
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        // Firestore rejeita valores undefined — só inclui o campo se preenchido.
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setName('');
      setSlug('');
      setSlugManuallyEdited(false);
      setDescription('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar categoria');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: BlogCategory) => {
    if (!window.confirm(`Excluir a categoria "${cat.name}"?`)) return;
    setDeletingId(cat.id);
    try {
      await deleteBlogCategory(uid, projectId, cat.id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="bg-gradient-to-r from-[#FF5B03]/[0.07] to-transparent border border-[#FF5B03]/20 rounded-2xl p-5 mb-5 flex items-center gap-4">
        <div className="shrink-0 w-11 h-11 rounded-xl bg-[#FF5B03]/10 flex items-center justify-center text-[#FF5B03]">
          <Network className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Popular menus pelos Clusters</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Cria uma categoria com o nome de cada cluster e vincula os posts já publicados.
            {linkablePosts > 0 ? ` ${linkablePosts} post(s) elegível(is).` : ' Nenhum post publicado com cluster ainda.'}
          </p>
          {populateMsg && <p className="text-xs text-emerald-600 mt-1.5 font-medium">{populateMsg}</p>}
        </div>
        <button
          onClick={handlePopulateFromClusters}
          disabled={populating || linkablePosts === 0}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors"
        >
          {populating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />} Popular
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 mb-5">
        <h3 className="font-semibold text-slate-900 mb-4">Nova categoria</h3>
        {error && <div className="mb-4 text-sm text-red-400 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex.: Novidades"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Slug</label>
            <input
              value={slug}
              onChange={(e) => { setSlugManuallyEdited(true); setSlug(e.target.value); }}
              placeholder="novidades"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Descrição (opcional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar categoria
          </button>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Nenhuma categoria criada ainda.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-400">/{c.slug}{c.description ? ` — ${c.description}` : ''}</p>
              </div>
              <button
                onClick={() => handleDelete(c)}
                disabled={deletingId === c.id}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 rounded-lg transition-colors shrink-0"
                title="Excluir"
              >
                {deletingId === c.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BlogCategories;
