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
              <div key={p.id} className="flex items-start gap-2 p-2 bg-(--ag-fill) border border-(--ag-hairline) rounded-lg">
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-md bg-(--ag-fill-2) shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-(--ag-text) truncate leading-tight">{p.nome}</p>
                  <div className="flex items-center gap-1 mt-1 border border-(--ag-hairline) rounded-md bg-(--ag-surface-solid) px-2 py-1 focus-within:ring-1 focus-within:ring-(--ag-accent) focus-within:border-(--ag-accent)">
                    <Link2 className="w-3 h-3 text-(--ag-text-3) shrink-0" />
                    <input
                      value={links?.[p.id] ?? ''}
                      onChange={(e) => setLink(p.id, e.target.value)}
                      placeholder="Link do produto (opcional)"
                      className="flex-1 min-w-0 text-xs text-(--ag-text-2) focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  className="text-(--ag-text-3) hover:text-(--ag-text) shrink-0 mt-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 bg-(--ag-fill-2) border border-(--ag-hairline) rounded-full text-xs text-(--ag-text) self-start"
              >
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-(--ag-hairline-2)" />
                )}
                {p.nome}
                <button
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  className="text-(--ag-text-3) hover:text-(--ag-text)"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ),
          )}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center border border-(--ag-hairline-2) rounded-lg px-3 py-2 focus-within:ring-1 focus-within:ring-(--ag-accent) focus-within:border-(--ag-accent)">
          <Search className="w-4 h-4 text-(--ag-text-3) mr-2 shrink-0" />
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
          <div className="absolute z-10 mt-1 w-full bg-(--ag-surface-solid) border border-(--ag-hairline) rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addProduct(p.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-(--ag-fill)"
              >
                {p.imagemPrincipal ? (
                  <img src={p.imagemPrincipal} alt="" className="w-6 h-6 rounded object-cover" />
                ) : (
                  <span className="w-6 h-6 rounded bg-(--ag-fill-2)" />
                )}
                <span className="flex-1 truncate">{p.nome}</span>
                <span className="text-(--ag-text-3) text-xs">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductLinkPicker;
