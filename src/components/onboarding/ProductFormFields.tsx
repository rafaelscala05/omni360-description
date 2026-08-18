import React, { useRef } from 'react';
import { Upload, Link as LinkIcon } from 'lucide-react';
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
}

const ProductFormFields: React.FC<Props> = ({ value, onChange, categories, onUploadImage, isUploadingImage }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<ProductFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Imagem *</label>
        {value.imageUrl ? (
          <div className="flex items-center gap-3">
            <img src={value.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
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
            onChange={(e) => set({ imageUrl: e.target.value })}
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
