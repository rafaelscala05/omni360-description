import React, { useState } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import type { BlogCategory } from './types';
import { slugify } from './slug';
import { saveBlogCategory, deleteBlogCategory } from '../../../services/blogService';

interface Props {
  uid: string;
  projectId: string;
  categories: BlogCategory[];
}

const BlogCategories: React.FC<Props> = ({ uid, projectId, categories }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        description: description.trim() || undefined,
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
