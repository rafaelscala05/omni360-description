// src/components/modals/videoWizardShared.tsx
//
// Pieces genuinely shared between VideoGenerationTab.tsx (classic) and
// UgcVideoGenerationTab.tsx (UGC avatar).
import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');

export function PrereqItem({ ok, label, onFix, fixLabel }: {
  ok: boolean; label: string; onFix: () => void; fixLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          : <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
        <span className={cn('text-sm font-medium', ok ? 'text-slate-700' : 'text-slate-600')}>
          {label}
        </span>
      </div>
      {!ok && (
        <button
          type="button"
          onClick={onFix}
          className="shrink-0 text-xs font-bold text-violet-600 hover:text-violet-800 underline underline-offset-2 transition-colors"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}

// Mesmo teto do servidor (MAX_PRODUCT_PHOTOS em server/videoShared.ts).
export const MAX_VIDEO_PHOTOS = 8;

// Fotos reais disponíveis para o vídeo: as da galeria do produto mais as que
// o usuário adicionou na etapa de Referência (ficam em
// _productReference.sourceImages, não nos campos do produto).
export function collectVideoPhotos(galleryPhotos: string[], referenceSourceImages: string[] = []): string[] {
  return Array.from(new Set([...galleryPhotos, ...referenceSourceImages].filter(Boolean)));
}

// Seleção inicial: todas as fotos reais, até o teto.
export function defaultVideoPhotoSelection(photos: string[]): string[] {
  return photos.slice(0, MAX_VIDEO_PHOTOS);
}

// Fotos reais do produto que vão como referência para o roteiro e para o
// vídeo. O vídeo só mostra os lados/estados que estas fotos mostram, então
// desmarcar uma foto também tira aquele ângulo do vídeo. Sempre sobra ao menos
// uma marcada.
export function ProductPhotoPicker({ photos, selected, onChange }: {
  photos: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (photos.length === 0) return null;
  const isSelected = (url: string) => selected.includes(url);
  const atLimit = selected.length >= MAX_VIDEO_PHOTOS;

  function toggle(url: string) {
    if (isSelected(url)) {
      if (selected.length === 1) return;
      onChange(selected.filter((u) => u !== url));
    } else if (!atLimit) {
      // Mantém a ordem da galeria, não a ordem dos cliques.
      onChange(photos.filter((u) => u === url || selected.includes(u)));
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/60">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-slate-800">Fotos do produto enviadas</p>
          <p className="text-xs text-slate-500 leading-relaxed max-w-md">
            O vídeo só mostra os lados e partes do produto que aparecem nas fotos marcadas.
            Desmarque fotos que não representam bem o produto.
          </p>
        </div>
        <span className="text-xs font-bold text-violet-700 bg-violet-50 px-2 py-1 rounded-full shrink-0">
          {selected.length} de {photos.length} marcadas{photos.length > MAX_VIDEO_PHOTOS ? ` · máx. ${MAX_VIDEO_PHOTOS}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {photos.map((url, i) => {
          const on = isSelected(url);
          const locked = on && selected.length === 1;
          const blocked = !on && atLimit;
          return (
            <button
              key={url}
              type="button"
              onClick={() => toggle(url)}
              disabled={locked || blocked}
              aria-pressed={on}
              title={locked ? 'Ao menos uma foto precisa ser enviada' : blocked ? `Máximo de ${MAX_VIDEO_PHOTOS} fotos` : undefined}
              className={cn(
                'relative aspect-square rounded-lg overflow-hidden border-2 bg-white transition-all',
                on ? 'border-violet-500' : 'border-slate-200 opacity-50 hover:opacity-80',
                (locked || blocked) && 'cursor-not-allowed',
              )}
            >
              <img src={url} alt={`Foto ${i + 1} do produto`} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              <span className={cn(
                'absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center',
                on ? 'bg-violet-600 text-white' : 'bg-white/90 border border-slate-300',
              )}>
                {on && <CheckCircle2 className="w-4 h-4" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
