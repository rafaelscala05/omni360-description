// src/components/modals/ProductReferenceStep.tsx
//
// Step 0 of the video tab: builds the Product Reference sheet (multi-angle +
// detail close-ups) from the product's real photos. No video — classic or UGC —
// can start without a saved reference; both send it to Veo for product fidelity.
import React, { useMemo, useRef, useState } from 'react';
import {
  ScanSearch, Sparkles, Loader2, AlertCircle, Check, Wand2, Upload, RefreshCw, ImageIcon, X,
} from 'lucide-react';
import type { Product, ProductReference } from '../../types/models';
import {
  MIN_REFERENCE_PHOTOS, MAX_REFERENCE_PHOTOS, collectProductPhotos, buildProductReferenceDoc,
  generateProductReference, adjustProductReference, uploadProductReferenceImage,
} from '../../services/productReferenceService';
import { fetchAndProcessImage } from '../../utils/imageUtils';
import { CREDIT_ACTIONS, type CreditAction } from '../../credits';
import { cn, PrereqItem } from './videoWizardShared';

export interface ProductReferenceStepProps {
  product: Product;
  uid: string;
  ensureCredits: (action: CreditAction) => boolean;
  consumeCredit: (action: CreditAction, productName?: string) => Promise<boolean>;
  onSaved: (reference: ProductReference) => void;
  onNavigateToTab: (tab: 'imagem') => void;
  // Present when editing an already saved reference: lets the user go back to
  // the video without touching it.
  onCancel?: () => void;
}

export default function ProductReferenceStep({
  product, uid, ensureCredits, consumeCredit, onSaved, onNavigateToTab, onCancel,
}: ProductReferenceStepProps) {
  const existing = product._productReference;
  const productName = product['Título SEO'] || product['Descrição'] || 'Produto';

  // Photos added right here (data URLs), uploaded only when the reference is saved.
  const [addedPhotos, setAddedPhotos] = useState<string[]>([]);
  const photos = useMemo(() => {
    const all = [...collectProductPhotos(product), ...(existing?.sourceImages ?? []), ...addedPhotos];
    return all.filter((url, i) => all.indexOf(url) === i);
  }, [product, existing, addedPhotos]);

  const [selected, setSelected] = useState<string[]>(() =>
    (existing?.sourceImages?.length ? existing.sourceImages : collectProductPhotos(product)).slice(0, MAX_REFERENCE_PHOTOS),
  );
  const [caracteristicas, setCaracteristicas] = useState(existing?.caracteristicas ?? '');
  const [preview, setPreview] = useState<string | null>(existing?.imageUrl ?? null);
  const [ajuste, setAjuste] = useState('');
  const [ajustes, setAjustes] = useState<string[]>(existing?.ajustes ?? []);
  const [busy, setBusy] = useState<'generate' | 'adjust' | 'save' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedPhotos = selected.filter((url) => photos.includes(url));
  const enoughPhotos = photos.length >= MIN_REFERENCE_PHOTOS;
  const canGenerate = selectedPhotos.length >= MIN_REFERENCE_PHOTOS && !busy;
  const unchanged = !!existing && preview === existing.imageUrl
    && caracteristicas.trim() === (existing.caracteristicas ?? '')
    && selectedPhotos.join('|') === existing.sourceImages.join('|');

  function toggle(url: string) {
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= MAX_REFERENCE_PHOTOS) return prev;
      return [...prev, url];
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy('upload');
    setError(null);
    try {
      const dataUrls: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const raw = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Não foi possível ler a imagem'));
          reader.readAsDataURL(file);
        });
        // Normalizes to a ≤1024px JPEG — keeps the later Storage upload small.
        const { base64Data, mimeType } = await fetchAndProcessImage(raw);
        dataUrls.push(`data:${mimeType};base64,${base64Data}`);
      }
      setAddedPhotos((prev) => [...prev, ...dataUrls]);
      setSelected((prev) => [...prev, ...dataUrls].slice(0, MAX_REFERENCE_PHOTOS));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar imagem');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Every generation (first or adjustment) is a new image and costs credits —
  // debited only after it succeeds, same rule as avatars and ambient images.
  async function runPaid(kind: 'generate' | 'adjust', fn: () => Promise<string>): Promise<boolean> {
    if (!ensureCredits(CREDIT_ACTIONS.productReference)) return false;
    setBusy(kind);
    setError(null);
    try {
      const dataUrl = await fn();
      const paid = await consumeCredit(CREDIT_ACTIONS.productReference, productName);
      if (!paid) {
        setError('Não foi possível debitar os créditos. Tente novamente.');
        return false;
      }
      setPreview(dataUrl);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar a referência');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    const ok = await runPaid('generate', () =>
      generateProductReference({ photoUrls: selectedPhotos, productName, caracteristicas }),
    );
    if (ok) setAjustes([]);
  }

  async function handleAdjust() {
    if (!preview || !ajuste.trim()) return;
    const pedido = ajuste.trim();
    const ok = await runPaid('adjust', () =>
      adjustProductReference({ currentImage: preview, photoUrls: selectedPhotos, ajuste: pedido }),
    );
    if (ok) {
      setAjustes((prev) => [...prev, pedido]);
      setAjuste('');
    }
  }

  async function handleSave() {
    if (!preview) return;
    if (unchanged && existing) { onSaved(existing); return; }
    setBusy('save');
    setError(null);
    try {
      const stamp = Date.now();
      const sourceImages = await Promise.all(selectedPhotos.map((url, i) =>
        url.startsWith('data:') ? uploadProductReferenceImage(uid, product._id, url, `foto_${stamp}_${i}`) : url,
      ));
      const imageUrl = preview.startsWith('data:')
        ? await uploadProductReferenceImage(uid, product._id, preview, `referencia_${stamp}`)
        : preview;
      onSaved(buildProductReferenceDoc({ imageUrl, sourceImages, caracteristicas, ajustes }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar a referência');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
          <ScanSearch className="w-5 h-5 text-violet-600" />
          Referência do produto
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          Antes do vídeo, montamos um mapa de referência com o produto em vários ângulos e os detalhes de cada item.
          Ele acompanha o produto em todas as cenas do vídeo para manter cores, formato e acabamento fiéis ao original.
        </p>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      {!enoughPhotos && (
        <PrereqItem
          ok={false}
          label={`Pelo menos ${MIN_REFERENCE_PHOTOS} fotos do produto em posições diferentes (${photos.length} encontrada${photos.length === 1 ? '' : 's'})`}
          onFix={() => onNavigateToTab('imagem')}
          fixLabel="Ir para Imagens"
        />
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="text-sm font-bold text-slate-800">
            Fotos usadas na referência
            <span className="ml-2 text-xs font-medium text-slate-400">
              {selectedPhotos.length}/{MAX_REFERENCE_PHOTOS} selecionadas · frente, costas, lateral e detalhes funcionam melhor
            </span>
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
          >
            {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Adicionar fotos
          </button>
        </div>

        {photos.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {photos.map((url) => {
              const isSelected = selected.includes(url);
              const isAdded = addedPhotos.includes(url);
              return (
                <div key={url} className="relative">
                  <button
                    type="button"
                    onClick={() => toggle(url)}
                    className={cn(
                      'relative block w-full aspect-square rounded-xl overflow-hidden border-2 transition-all bg-slate-50',
                      isSelected ? 'border-violet-600 ring-2 ring-violet-600/20' : 'border-slate-200 opacity-60 hover:opacity-100',
                    )}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    {isSelected && (
                      <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                  {isAdded && (
                    <button
                      type="button"
                      title="Remover foto"
                      onClick={() => {
                        setAddedPhotos((prev) => prev.filter((u) => u !== url));
                        setSelected((prev) => prev.filter((u) => u !== url));
                      }}
                      className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-500 flex items-center justify-center shadow-sm hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
            <ImageIcon className="w-4 h-4" /> Nenhuma foto do produto ainda
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-bold text-slate-800">
          Características do produto <span className="text-xs font-medium text-slate-400">(opcional)</span>
        </label>
        <textarea
          value={caracteristicas}
          onChange={(e) => setCaracteristicas(e.target.value)}
          rows={3}
          placeholder="Ex.: tampa de rosca prata, logo gravado em baixo relevo na lateral, alça de couro marrom, fundo emborrachado."
          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 resize-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
        />
      </div>

      <div className="flex gap-3 flex-wrap">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={!!busy} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 disabled:opacity-40">
            Voltar
          </button>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={cn(
            'px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all',
            preview
              ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-md hover:shadow-lg',
          )}
        >
          {busy === 'generate' ? <Loader2 className="w-4 h-4 animate-spin" /> : preview ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {busy === 'generate' ? 'Gerando referência...' : preview ? 'Gerar nova referência' : 'Gerar referência do produto'}
        </button>
      </div>

      {preview && (
        <div className="space-y-4 pt-6 border-t border-slate-100">
          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white relative">
            <img src={preview} alt="Referência do produto" className="w-full max-h-[560px] object-contain" referrerPolicy="no-referrer" />
            {(busy === 'generate' || busy === 'adjust') && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
              </div>
            )}
          </div>

          {ajustes.length > 0 && (
            <ul className="text-xs text-slate-500 space-y-1">
              {ajustes.map((a, i) => <li key={i}>✓ Ajuste aplicado: {a}</li>)}
            </ul>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-800">Pedir um ajuste</label>
            <div className="flex gap-2 flex-col sm:flex-row">
              <input
                type="text"
                value={ajuste}
                onChange={(e) => setAjuste(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ajuste.trim() && !busy) handleAdjust(); }}
                placeholder="Ex.: o logo é azul, não preto; adicione um close da etiqueta interna."
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none"
              />
              <button
                type="button"
                onClick={handleAdjust}
                disabled={!ajuste.trim() || !!busy || selectedPhotos.length < MIN_REFERENCE_PHOTOS}
                className="px-4 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-bold hover:bg-violet-50 flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {busy === 'adjust' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {busy === 'adjust' ? 'Ajustando...' : 'Aplicar ajuste'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!!busy}
            className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg flex items-center gap-2 disabled:opacity-40 active:scale-95"
          >
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy === 'save' ? 'Salvando...' : 'Salvar e escolher o tipo de vídeo'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </p>
      )}
    </section>
  );
}
