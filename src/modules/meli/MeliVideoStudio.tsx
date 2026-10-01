import React, { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Loader2, Video, X } from 'lucide-react';
import { auth } from '../../firebase';
import type { CreditAction } from '../../credits';
import type { Product, ProductReference } from '../../types/models';
import ProductReferenceStep from '../../components/modals/ProductReferenceStep';
import VideoGenerationTab from '../../components/modals/VideoGenerationTab';
import { getMeliListingMedia, saveMeliListingMedia, type MeliListing, type MeliListingMedia } from '../../services/meliService';

// Página da Central de Vendedores que explica o envio de Clips. O Mercado
// Livre descontinuou o envio de vídeo por integração para vendedor local,
// então a publicação é manual — o agente entrega o vídeo pronto.
export const MELI_CLIPS_HELP_URL = 'https://vendedores.mercadolivre.com.br/nota/como-enviar-videos-pelos-seus-anuncios';

export interface MeliCreditHelpers {
  ensureCredits: (action: CreditAction) => boolean;
  consumeCredit: (action: CreditAction, productName?: string) => Promise<boolean>;
}

function attributeValue(listing: MeliListing, id: string): string {
  return String(listing.attributes?.find((attribute) => attribute.id === id)?.value_name || '');
}

// O assistente de vídeo trabalha sobre `Product`; o anúncio vira um produto
// sintético (id "meli-<MLB>"), que não existe na coleção de produtos — o
// servidor só grava o vídeo no produto quando o documento existe.
export function productFromListing(listing: MeliListing, options: { description: string; realPhotos: string[]; ambientPhotos: string[]; media: MeliListingMedia | null }): Product {
  const product: Record<string, unknown> = {
    _id: `meli-${listing.itemId}`,
    'Código (SKU)': listing.itemId,
    'Descrição': listing.title,
    'Título SEO': listing.title,
    'Descrição complementar': options.description,
    'Marca': attributeValue(listing, 'BRAND'),
    'Garantia': '',
    attributes: Object.fromEntries((listing.attributes || [])
      .filter((attribute) => attribute.name && attribute.value_name)
      .map((attribute) => [attribute.name!, { value: attribute.value_name }])),
    _ambientImages: options.ambientPhotos,
    _productReference: options.media?.productReference || undefined,
    _videoUrl: options.media?.videoUrl || undefined,
    _videoJobId: options.media?.videoJobId || undefined,
  };
  options.realPhotos.slice(0, 10).forEach((url, index) => { product[`URL imagem externa ${index + 1}`] = url; });
  return product as unknown as Product;
}

export default function MeliVideoStudio({ listing, description, realPhotos, ambientPhotos, credits, onClose, onVideoReady }: {
  listing: MeliListing;
  description: string;
  realPhotos: string[];
  ambientPhotos: string[];
  credits: MeliCreditHelpers;
  onClose: () => void;
  onVideoReady: (videoUrl: string) => void;
}) {
  const [media, setMedia] = useState<MeliListingMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingReference, setEditingReference] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = auth.currentUser?.uid || '';

  useEffect(() => {
    getMeliListingMedia(listing.itemId).then(setMedia)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar o vídeo.'))
      .finally(() => setLoading(false));
  }, [listing.itemId]);

  const product = useMemo(() => productFromListing(listing, { description, realPhotos, ambientPhotos, media }), [listing, description, realPhotos, ambientPhotos, media]);
  const save = async (patch: Parameters<typeof saveMeliListingMedia>[1]) => {
    try { setMedia(await saveMeliListingMedia(listing.itemId, patch)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao salvar.'); }
  };
  const getIdToken = async () => {
    if (!auth.currentUser) throw new Error('Usuário não autenticado.');
    return auth.currentUser.getIdToken();
  };
  const reference = media?.productReference || null;

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={onClose}>
    <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-(--ag-surface-solid) rounded-2xl shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="sticky top-0 z-10 bg-(--ag-surface-solid) backdrop-blur border-b px-5 py-3 flex items-center gap-3">
        <Video className="w-5 h-5 text-(--ag-violet)" />
        <div className="min-w-0 flex-1"><h2 className="font-bold text-(--ag-text)">Vídeo do anúncio</h2><p className="text-xs text-(--ag-text-2) truncate">{listing.title}</p></div>
        <button onClick={onClose} className="p-2 hover:bg-(--ag-fill-2) rounded-full" aria-label="Fechar"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5 space-y-4">
        {error && <p className="text-sm text-(--ag-danger) bg-(--ag-danger-soft) border border-(--ag-danger-line) rounded-xl px-4 py-3">{error}</p>}
        {loading ? <div className="py-12 flex justify-center text-sm text-(--ag-text-2)"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando…</div>
          : !reference || editingReference ? <>
            <p className="text-sm text-(--ag-text-2)">Primeiro a IA monta uma <strong>referência do produto</strong> a partir das fotos reais — é ela que garante que o produto no vídeo seja idêntico ao seu.</p>
            <ProductReferenceStep
              product={product}
              uid={uid}
              ensureCredits={credits.ensureCredits}
              consumeCredit={credits.consumeCredit}
              onSaved={(saved: ProductReference) => { setEditingReference(false); void save({ productReference: saved }); }}
              onNavigateToTab={onClose}
              onCancel={reference ? () => setEditingReference(false) : undefined}
            />
          </>
            : <VideoGenerationTab
              product={product}
              uid={uid}
              getIdToken={getIdToken}
              productReferenceUrl={reference.imageUrl}
              referenceSourceImages={reference.sourceImages}
              onEditReference={() => setEditingReference(true)}
              onNavigateToTab={onClose}
              onVideoJobStarted={(_productId, jobId) => { void save({ videoJobId: jobId }); }}
              onVideoGenerated={(_productId, videoUrl, jobId) => {
                if (media?.videoUrl === videoUrl) return;
                void save({ videoUrl, videoJobId: jobId });
                onVideoReady(videoUrl);
              }}
            />}
        {media?.videoUrl && <PublishClipHelp videoUrl={media.videoUrl} itemId={listing.itemId} />}
      </div>
    </div>
  </div>;
}

export function PublishClipHelp({ videoUrl, itemId }: { videoUrl: string; itemId: string }) {
  return <div className="border border-(--ag-violet-line) bg-(--ag-violet-soft) rounded-2xl p-4">
    <p className="text-sm font-bold text-(--ag-text)">Como publicar no Mercado Livre</p>
    <p className="text-xs text-(--ag-text-2) mt-1">O Mercado Livre não aceita mais vídeo enviado por integração: ele entra como <strong>Clip</strong>, pelo painel do vendedor. O vídeo já sai no formato de Clip (vertical, cerca de 30 segundos).</p>
    <ol className="text-xs text-(--ag-text) mt-2 space-y-1 list-decimal list-inside">
      <li>Baixe o vídeo.</li>
      <li>No Mercado Livre, abra <strong>Anúncios → Clips</strong> (ou o anúncio {itemId} → Clips) e envie o arquivo.</li>
      <li>Vincule o Clip ao anúncio {itemId}. Depois da moderação ele aparece no anúncio.</li>
    </ol>
    <div className="flex flex-wrap gap-2 mt-3">
      <a href={videoUrl} download={`clip_${itemId}.mp4`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-(--ag-violet) hover:brightness-95 text-white text-sm font-bold px-4 py-2 rounded-xl"><Download className="w-4 h-4" /> Baixar vídeo</a>
      <a href={MELI_CLIPS_HELP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-(--ag-hairline-2) bg-(--ag-surface-solid) text-(--ag-text) text-sm font-semibold px-4 py-2 rounded-xl"><ExternalLink className="w-4 h-4" /> Ajuda do Mercado Livre sobre Clips</a>
    </div>
  </div>;
}
