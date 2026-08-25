import React, { useMemo, useState } from 'react';
import { Search, X, Link2 } from 'lucide-react';
import type { LinkableProduct } from '../../services/contentService';

interface Props {
  products: LinkableProduct[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** id do produto -> URL da página do produto, informada manualmente (a plataforma não tem URL pública nativa). */
  links?: Record<string, string>;
  onLinksChange?: (links: Record<string, string>) => void;
}

const ProductLinkPicker: React.FC<Props> = ({ products, selectedIds, onChange, links, onLinksChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () =>
      selectedIds.map(
        (id) => products.find((p) => p.id === id) ?? { id, nome: id, sku: '', imagemPrincipal: undefined },
      ),
    [selectedIds, products],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => !selectedIds.includes(p.id))
      .filter((p) => p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products, query, selectedIds]);

  const addProduct = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery('');
    setOpen(false);
  };

  const removeProduct = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
    if (onLinksChange && links) {
      const { [id]: _removed, ...rest } = links;
      onLinksChange(rest);
    }
  };

  const setLink = (id: string, url: string) => {
    if (!onLinksChange) return;
    onLinksChange({ ...links, [id]: url });
  };

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-1.5">
          {selected.map((p) =>
            onLinksChange ? (
              <div key={p.id} className="flex items-start gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-md bg-slate-200 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate leading-tight">{p.nome}</p>
                  <div className="flex items-center gap-1 mt-1 border border-slate-200 rounded-md bg-white px-2 py-1 focus-within:ring-1 focus-within:ring-[#FF5B03] focus-within:border-[#FF5B03]">
                    <Link2 className="w-3 h-3 text-slate-400 shrink-0" />
                    <input
                      value={links?.[p.id] ?? ''}
                      onChange={(e) => setLink(p.id, e.target.value)}
                      placeholder="Link do produto (opcional)"
                      className="flex-1 min-w-0 text-xs text-slate-600 focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  className="text-slate-400 hover:text-slate-700 shrink-0 mt-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-700 self-start"
              >
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-slate-300" />
                )}
                {p.nome}
                <button
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ),
          )}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center border border-slate-300 rounded-lg px-3 py-2 focus-within:ring-1 focus-within:ring-[#FF5B03] focus-within:border-[#FF5B03]">
          <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Buscar produto por nome ou SKU..."
            className="flex-1 text-sm focus:outline-none"
          />
        </div>
        {open && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addProduct(p.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
              >
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-6 h-6 rounded object-cover" />
                ) : (
                  <span className="w-6 h-6 rounded bg-slate-200" />
                )}
                <span className="flex-1 truncate">{p.nome}</span>
                <span className="text-slate-400 text-xs">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductLinkPicker;
