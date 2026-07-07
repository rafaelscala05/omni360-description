import React, { useState } from 'react';
import { Check, RefreshCw, Image as ImageIcon, X } from 'lucide-react';
import type { BlogSettings, BlogTemplateId } from './types';
import { BLOG_TEMPLATES } from './types';
import { saveBlogSettings } from '../../../services/blogService';
import { auth } from '../../../firebase';

interface Props {
  uid: string;
  projectId: string;
  settings: BlogSettings;
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

// Mini-previews em CSS puro para cada template — retângulos representando o layout.
const TemplatePreview: React.FC<{ id: BlogTemplateId }> = ({ id }) => {
  if (id === 'editorial') {
    return (
      <div className="h-20 w-full bg-slate-50 rounded-lg p-2 flex gap-1.5">
        <div className="w-1/2 bg-slate-300 rounded" />
        <div className="w-1/2 flex flex-col gap-1.5">
          <div className="h-1/3 bg-slate-200 rounded" />
          <div className="h-1/3 bg-slate-200 rounded" />
          <div className="h-1/3 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }
  if (id === 'minimal') {
    return (
      <div className="h-20 w-full bg-slate-50 rounded-lg p-2 flex justify-center">
        <div className="w-2/3 flex flex-col gap-1.5">
          <div className="h-2 bg-slate-300 rounded w-1/2 mx-auto" />
          <div className="h-1.5 bg-slate-200 rounded" />
          <div className="h-1.5 bg-slate-200 rounded" />
          <div className="h-1.5 bg-slate-200 rounded w-2/3 mx-auto" />
        </div>
      </div>
    );
  }
  return (
    <div className="h-20 w-full bg-slate-50 rounded-lg p-2 grid grid-cols-3 gap-1.5">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-slate-300 rounded" />
      ))}
    </div>
  );
};

const BlogAppearance: React.FC<Props> = ({ uid, projectId, settings }) => {
  const [title, setTitle] = useState(settings.title);
  const [description, setDescription] = useState(settings.description);
  const [savingText, setSavingText] = useState(false);
  const [savedText, setSavedText] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectTemplate = async (id: BlogTemplateId) => {
    await saveBlogSettings(uid, projectId, { template: id });
  };

  const handleSaveText = async () => {
    setSavingText(true);
    setSavedText(false);
    setError(null);
    try {
      await saveBlogSettings(uid, projectId, { title: title.trim(), description: description.trim() });
      setSavedText(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSavingText(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      await saveBlogSettings(uid, projectId, { logoUrl: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    await saveBlogSettings(uid, projectId, { logoUrl: '' });
  };

  const handleColorChange = async (key: 'primary' | 'background' | 'text', value: string) => {
    await saveBlogSettings(uid, projectId, { colors: { ...settings.colors, [key]: value } });
  };

  return (
    <div className="space-y-5">
      {error && <div className="text-sm text-red-400 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Template</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {BLOG_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => handleSelectTemplate(t.id)}
              className={`text-left p-3 rounded-xl border-2 transition-colors ${
                settings.template === t.id ? 'border-[#FF5B03] bg-[#FF5B03]/5' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <TemplatePreview id={t.id} />
              <p className="text-sm font-semibold text-slate-900 mt-3">{t.nome}</p>
              <p className="text-xs text-slate-500 mt-0.5">{t.descricao}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Título e descrição</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Título do blog</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSaveText}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleSaveText}
              rows={2}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03] resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-4">
          {savedText && <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium"><Check className="w-4 h-4" /> Salvo</span>}
          <button
            onClick={handleSaveText}
            disabled={savingText}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-60 rounded-xl shadow-sm transition-colors"
          >
            {savingText ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Logo</h3>
        <div className="flex items-center gap-4">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="Logo" className="h-14 w-auto rounded-lg border border-slate-200 bg-slate-50 p-1" />
          ) : (
            <div className="h-14 w-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-300">
              <ImageIcon className="w-6 h-6" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 rounded-xl transition-colors cursor-pointer">
              {uploadingLogo ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              {settings.logoUrl ? 'Trocar logo' : 'Enviar logo'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = '';
                }}
              />
            </label>
            {settings.logoUrl && (
              <button
                onClick={handleRemoveLogo}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              >
                <X className="w-4 h-4" /> Remover
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Cores</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Primária</label>
            <input
              type="color"
              value={settings.colors.primary}
              onChange={(e) => handleColorChange('primary', e.target.value)}
              className="w-full h-10 rounded-lg border border-slate-300 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Fundo</label>
            <input
              type="color"
              value={settings.colors.background}
              onChange={(e) => handleColorChange('background', e.target.value)}
              className="w-full h-10 rounded-lg border border-slate-300 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Texto</label>
            <input
              type="color"
              value={settings.colors.text}
              onChange={(e) => handleColorChange('text', e.target.value)}
              className="w-full h-10 rounded-lg border border-slate-300 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlogAppearance;
