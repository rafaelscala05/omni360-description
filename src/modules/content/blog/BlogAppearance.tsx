import React, { useEffect, useState } from 'react';
import { Check, RefreshCw, Image as ImageIcon, X, ExternalLink } from 'lucide-react';
import type { BlogSettings, BlogTemplateId, BlogLayout, BlogFonts } from './types';
import { BLOG_TEMPLATES, BLOG_FONTS, DEFAULT_BLOG_FONTS, DEFAULT_BLOG_LAYOUT } from './types';
import { saveBlogSettings } from '../../../services/blogService';
import { auth } from '../../../firebase';

interface Props {
  uid: string;
  projectId: string;
  settings: BlogSettings;
  hasPosts: boolean;
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

// Carrega as fontes curadas no admin para o seletor mostrar cada família real.
function useGoogleFontsPreview() {
  useEffect(() => {
    const id = 'blog-fonts-preview';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${BLOG_FONTS.map((f) => `family=${f.family.replace(/ /g, '+')}:wght@400;700`).join('&')}&display=swap`;
    document.head.appendChild(link);
  }, []);
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

// Grupo de botões-pílula para opções de layout (uma escolha por grupo).
function OptionPills<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="inline-flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              value === o.value
                ? 'border-[#FF5B03] bg-[#FF5B03]/10 text-[#E14E00]'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const BlogAppearance: React.FC<Props> = ({ uid, projectId, settings, hasPosts }) => {
  useGoogleFontsPreview();
  const [title, setTitle] = useState(settings.title);
  const [description, setDescription] = useState(settings.description);
  const [footerText, setFooterText] = useState(settings.layout?.footerText ?? '');
  const [savingText, setSavingText] = useState(false);
  const [savedText, setSavedText] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // O iframe de preview recarrega a cada alteração salva (updatedAt muda).
  const previewUrl = `/b/${settings.slug}/?preview=1&_v=${encodeURIComponent(settings.updatedAt)}`;

  const fonts: BlogFonts = { ...DEFAULT_BLOG_FONTS, ...(settings.fonts ?? {}) };
  const layout: BlogLayout = { ...DEFAULT_BLOG_LAYOUT, ...(settings.layout ?? {}) };

  // Helper central: salva um patch e reporta erro no banner.
  const patch = async (p: Partial<BlogSettings>, msg: string) => {
    setError(null);
    try {
      await saveBlogSettings(uid, projectId, p);
    } catch (e) {
      setError(e instanceof Error ? e.message : msg);
    }
  };

  const patchLayout = (p: Partial<BlogLayout>) =>
    patch({ layout: { ...layout, ...p } }, 'Erro ao salvar layout');

  const handleSaveText = async () => {
    setSavingText(true);
    setSavedText(false);
    setError(null);
    try {
      await saveBlogSettings(uid, projectId, {
        title: title.trim(),
        description: description.trim(),
        layout: { ...layout, footerText: footerText.trim() },
      });
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

  return (
    <div className="space-y-5">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,44%)] gap-5 items-start">
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Template</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {BLOG_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => patch({ template: t.id }, 'Erro ao salvar template')}
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
            <h3 className="font-semibold text-slate-900 mb-1">Tipografia</h3>
            <p className="text-xs text-slate-500 mb-4">Fontes servidas via Google Fonts no blog publicado.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([['heading', 'Títulos'], ['body', 'Texto do corpo']] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {BLOG_FONTS.map((f) => (
                      <button
                        key={f.family}
                        type="button"
                        onClick={() => patch({ fonts: { ...fonts, [key]: f.family } }, 'Erro ao salvar fonte')}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors ${
                          fonts[key] === f.family
                            ? 'border-[#FF5B03] bg-[#FF5B03]/5'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <span className="text-sm text-slate-800" style={{ fontFamily: `'${f.family}', ${f.stack}` }}>
                          {f.family}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">{f.categoria}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Layout</h3>
            <div className="space-y-4">
              <OptionPills
                label="Largura do conteúdo"
                value={layout.contentWidth}
                options={[
                  { value: 'estreito', label: 'Estreito (680px)' },
                  { value: 'normal', label: 'Normal (1024px)' },
                  { value: 'largo', label: 'Largo (1280px)' },
                ]}
                onChange={(v) => patchLayout({ contentWidth: v })}
              />
              <OptionPills
                label="Alinhamento do cabeçalho"
                value={layout.headerAlign}
                options={[
                  { value: 'esquerda', label: 'À esquerda' },
                  { value: 'centro', label: 'Centralizado' },
                ]}
                onChange={(v) => patchLayout({ headerAlign: v })}
              />
              <OptionPills
                label="Estilo dos cards"
                value={layout.cardStyle}
                options={[
                  { value: 'borda', label: 'Com borda' },
                  { value: 'sombra', label: 'Com sombra' },
                  { value: 'plano', label: 'Plano' },
                ]}
                onChange={(v) => patchLayout({ cardStyle: v })}
              />
              <OptionPills
                label="Cantos"
                value={layout.cornerRadius}
                options={[
                  { value: 'reto', label: 'Retos' },
                  { value: 'suave', label: 'Suaves' },
                  { value: 'arredondado', label: 'Arredondados' },
                ]}
                onChange={(v) => patchLayout({ cornerRadius: v })}
              />
              <div className="flex items-center justify-between pt-1">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Menu de categorias no cabeçalho</p>
                  <p className="text-[11px] text-slate-400">Exibe os links das categorias abaixo do título.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={layout.showCategoriesNav}
                  onClick={() => patchLayout({ showCategoriesNav: !layout.showCategoriesNav })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    layout.showCategoriesNav ? 'bg-[#FF5B03]' : 'bg-slate-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    layout.showCategoriesNav ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Cores</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {([['primary', 'Primária'], ['background', 'Fundo'], ['text', 'Texto']] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
                  <input
                    type="color"
                    value={settings.colors[key]}
                    onChange={(e) => patch({ colors: { ...settings.colors, [key]: e.target.value } }, 'Erro ao salvar cor')}
                    className="w-full h-10 rounded-lg border border-slate-300 cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Identidade e textos</h3>
            <div className="space-y-3">
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
                      onClick={() => patch({ logoUrl: '' }, 'Erro ao remover logo')}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                    >
                      <X className="w-4 h-4" /> Remover
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Título do blog</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Descrição</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03] resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Texto do rodapé</label>
                <input
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  placeholder={`© ${new Date().getFullYear()} ${settings.title}`}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5B03]/30 focus:border-[#FF5B03]"
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
        </div>

        {/* Preview ao vivo do blog (recarrega a cada alteração salva). */}
        <div className="xl:sticky xl:top-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Preview ao vivo</p>
              <a
                href={`/b/${settings.slug}/`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-[#FF5B03] hover:underline"
              >
                Abrir em nova aba <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            {!hasPosts && (
              <div className="px-4 py-2 text-xs text-slate-500 bg-amber-50 border-b border-amber-100">
                Mostrando conteúdo de exemplo — some assim que você publicar o primeiro post de verdade.
              </div>
            )}
            <iframe
              key={previewUrl}
              src={previewUrl}
              title="Preview do blog"
              className="w-full h-[640px] bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlogAppearance;
