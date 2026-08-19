import React, { useEffect, useRef, useState } from 'react';
import { Upload, Link as LinkIcon, ImageOff, Plus, Loader2, X } from 'lucide-react';
import type { Category } from '../../types/models';

export interface ProductFormValue {
  title: string;
  categoryId: string;
  imageUrl: string;
  price: string;
  description: string;
}

interface Props {
  value: ProductFormValue;
  onChange: (value: ProductFormValue) => void;
  categories: Category[];
  onUploadImage: (file: File) => Promise<void>;
  isUploadingImage: boolean;
  onCreateCategory: (name: string) => Promise<string | null>;
  /** Nome de categoria inferido a partir do breadcrumb da página importada (ex.: "Travesseiro"). */
  suggestedCategoryName?: string;
}

const ProductFormFields: React.FC<Props> = ({ value, onChange, categories, onUploadImage, isUploadingImage, onCreateCategory, suggestedCategoryName }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [createCategoryError, setCreateCategoryError] = useState<string | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);

  // Pré-abre o formulário de criação de categoria com o nome sugerido pelo
  // breadcrumb da página — o usuário só precisa confirmar, não digitar do
  // zero. Só entra em ação se o usuário ainda não escolheu/criou nada e não
  // dispensou a sugestão.
  useEffect(() => {
    if (!suggestedCategoryName || value.categoryId || isAddingCategory || dismissedSuggestion) return;
    setIsAddingCategory(true);
    setNewCategoryName(suggestedCategoryName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedCategoryName]);

  const set = (patch: Partial<ProductFormValue>) => onChange({ ...value, ...patch });
  const imageFailedToLoad = !!value.imageUrl && value.imageUrl === brokenImageUrl;

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setIsCreatingCategory(true);
    setCreateCategoryError(null);
    try {
      const id = await onCreateCategory(name);
      if (id) {
        set({ categoryId: id });
        setIsAddingCategory(false);
        setNewCategoryName('');
      } else {
        setCreateCategoryError('Não foi possível criar a categoria.');
      }
    } catch (e) {
      setCreateCategoryError(e instanceof Error ? e.message : 'Não foi possível criar a categoria.');
    } finally {
      setIsCreatingCategory(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Imagem *</label>
        {value.imageUrl && !imageFailedToLoad ? (
          <div className="flex items-center gap-3">
            <img
              src={value.imageUrl}
              alt=""
              className="w-16 h-16 rounded-xl object-cover border border-slate-200"
              onError={() => setBrokenImageUrl(value.imageUrl)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-orange-600 font-semibold hover:text-orange-700"
            >
              Trocar imagem
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingImage}
              className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm font-semibold text-slate-500 hover:border-orange-400 hover:text-orange-600 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {isUploadingImage ? 'Enviando...' : 'Anexar foto'}
            </button>
          </div>
        )}
        {imageFailedToLoad && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <ImageOff className="w-3.5 h-3.5 shrink-0" /> Não conseguimos carregar essa imagem. Envie um arquivo ou cole outro link.
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUploadImage(file);
            e.target.value = '';
          }}
        />
        <div className="flex items-center gap-2 mt-1">
          <LinkIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="url"
            value={value.imageUrl}
            onChange={(e) => { setBrokenImageUrl(null); set({ imageUrl: e.target.value }); }}
            placeholder="ou cole a URL de uma imagem"
            className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Título do produto *</label>
        <input
          type="text"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Ex: Tênis Esportivo Pro"
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Categoria *</label>
        {isAddingCategory ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateCategory(); } }}
                placeholder="Nome da nova categoria"
                disabled={isCreatingCategory}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={isCreatingCategory || !newCategoryName.trim()}
                className="shrink-0 flex items-center justify-center w-10 h-10 bg-[#FF5B03] text-white rounded-xl hover:bg-[#E14E00] transition-colors disabled:opacity-50"
              >
                {isCreatingCategory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); setCreateCategoryError(null); setDismissedSuggestion(true); }}
                disabled={isCreatingCategory}
                className="shrink-0 flex items-center justify-center w-10 h-10 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {suggestedCategoryName && (
              <p className="text-xs text-slate-400">Sugerida a partir da página do produto — edite se quiser.</p>
            )}
            {createCategoryError && <p className="text-xs text-red-600">{createCategoryError}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={value.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all appearance-none cursor-pointer"
            >
              <option value="">Selecione uma categoria...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.path.join(' > ')}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsAddingCategory(true)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-orange-600 hover:text-orange-700 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Criar
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Preço (opcional)</label>
        <input
          type="text"
          value={value.price}
          onChange={(e) => set({ price: e.target.value })}
          placeholder="Ex: 199,90"
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
        />
      </div>
    </div>
  );
};

export default ProductFormFields;
export function isProductFormValid(value: ProductFormValue): boolean {
  return !!(value.title.trim() && value.categoryId && value.imageUrl.trim());
}
