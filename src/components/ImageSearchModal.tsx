import React, { useState, useEffect } from 'react';
import { X, Search, Image as ImageIcon, Loader2, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { Product, Category } from '../types/models';
import { fetchAndProcessImage } from '../utils/imageUtils';
import { generateImage, generateJson } from '../services/aiService';
import { getEffectiveImagePrompts } from '../services/categoryService';
import { storage } from '../firebase';
import { ref, uploadString } from 'firebase/storage';
import type { Part } from 'firebase/ai';
import { CREDIT_ACTIONS, type CreditAction } from '../credits';
import { trackImageGenerated } from '../analytics';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  uid: string;
  onSave: (productId: string, selectedImage: string, ambientImages: string[], tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  credits: number;
  getCreditCost: (key: string) => number;
  consumeCredit: (action: CreditAction, productName?: string, sku?: string) => Promise<boolean>;
  existingCategories?: Category[];
  defaultAspectRatio?: string;
}

const IMAGE_TITLES = ['Produto Ambientado', 'Produto em Uso', 'Escala e Tamanho'];

interface AmbientPromptContext {
  productName: string;
  brand?: string;
  category?: string;
  description?: string;
}

interface CustomScenes {
  scene1?: string;
  scene2?: string;
  scene3?: string;
}

// Generates 3 English ambient-image transformation instructions from the product context + image.
// If customScenes are provided, their scene descriptions replace the default scene guidance while
// keeping the surrounding photographic expertise (lighting, camera, realism) intact.
async function generateAmbientPrompts(
  ctx: AmbientPromptContext,
  base64Data?: string,
  mimeType?: string,
  customScenes?: CustomScenes,
): Promise<{ prompts: string[]; productDescription: string }> {
  const productContext = [ctx.productName, ctx.brand, ctx.category, ctx.description]
    .filter(Boolean)
    .join('. ');

  const scene1Override = customScenes?.scene1
    ? `The scene must show: ${customScenes.scene1}. Apply the same realism rules: natural lighting, soft contact shadow, shallow depth of field, shot on a 50mm lens at f/2.2, candid lifestyle photograph, photorealistic, no AI artifacts.`
    : null;

  const scene2Override = customScenes?.scene2
    ? `The scene must show: ${customScenes.scene2}. Apply the same realism rules: authentic candid look, real-looking person with natural skin texture and unposed body language, motivated natural lighting, shot on an 85mm lens at f/2.0, photorealistic, no AI artifacts.`
    : null;

  const scene3Override = customScenes?.scene3
    ? `The scene must show: ${customScenes.scene3}. Apply the same realism rules: realistic human hands with correct anatomy and natural skin texture, soft natural lighting with a grounded contact shadow, shot on a 50mm lens at f/2.8, photorealistic close-up, no AI artifacts, the product clearly showing its real size.`
    : null;

  const prompt = `You are a senior commercial photographer and art director for premium e-commerce brands. Your task is to write 3 image transformation instructions in ENGLISH for a generative AI model (gemini-2.5-flash-image). The model receives the product image directly, so you must NOT describe the product's appearance — focus entirely on what should change in the scene.

${base64Data ? 'Analyze the product image provided to understand exactly what this product is, who uses it, where it is realistically used, and what surfaces/objects/environments naturally surround it in real life.' : ''}
Product context: ${productContext}

CRITICAL REALISM RULES (apply to ALL instructions):
- The scene must be SPECIFIC to THIS product and its real-world use context — never generic. Reason from the product: a power tool belongs on a workbench with sawdust, not a marble countertop; a skincare serum belongs on a bathroom shelf with morning light, not a kitchen.
- The result must look like a REAL photograph taken by a professional, NOT an AI render. Demand photographic authenticity: natural and slightly uneven lighting, real soft shadows and contact shadows under the product, subtle surface imperfections (dust, fingerprints, wear, scratches, texture), shallow depth of field with realistic lens bokeh, true-to-life color and white balance, no plastic-perfect surfaces, no symmetrical CGI cleanliness.
- Specify a real camera look: e.g. shot on a 50mm or 85mm lens, f/2.0, natural window light or practical lighting, photojournalistic / lifestyle editorial style.
- Avoid clichés (marble countertop, generic golden hour, floating product, empty studio) unless they genuinely fit the product.

Generate 3 transformation instructions following this exact order and format:

${scene1Override
  ? `Instruction 0 — Realistic in-context scene: Keep the product exactly as-is (do NOT alter the product). ${scene1Override}`
  : `Instruction 0 — Realistic in-context scene: Keep the product exactly as-is (do NOT alter the product), and place it into a believable, lived-in environment where THIS specific product is actually used or displayed, chosen from the product description and category. Build a rich but natural scene: the right surface/material, contextually relevant props that a real owner would have nearby, realistic ambient lighting with direction and soft shadows, and a sense of depth (foreground/background). The product must sit naturally in the scene with a grounded contact shadow — not floating, not centered like a catalog cutout. Make it look like a candid photo from a real home/workspace/store, captured on a 50mm lens at f/2.2 with natural light. Example for a leather wallet: "Keep the product exactly as-is. Place it on a worn wooden café table next to a set of car keys, a folded newspaper and a half-finished espresso, warm morning window light from the left casting a soft natural shadow, shallow depth of field, blurred background of a cozy café interior, shot on 50mm f/2.2, candid lifestyle photograph, photorealistic with subtle surface texture and no AI artifacts."`}

${scene2Override
  ? `Instruction 1 — Authentic lifestyle scene with person: Keep the product visually identical to the input image. ${scene2Override}`
  : `Instruction 1 — Authentic lifestyle scene with person: Keep the product visually identical to the input image, and show a real-looking person who genuinely belongs to THIS product's target audience naturally using or interacting with it in the right real-world moment (derive the person, action and setting from the product description and category). Make the person look real and candid — natural skin texture and pores, realistic hands and fingers actually gripping/touching the product with correct scale, relaxed unposed body language, everyday authentic clothing that fits the context, no model-perfect stock-photo smile. Build a believable environment around the action with depth and contextual props, motivated natural lighting with soft directional shadows. Capture it as a documentary/lifestyle editorial frame on an 85mm lens at f/2.0, shallow depth of field, true-to-life colors, no AI artifacts. The product must look identical to the input image. Example for running shoes: "Keep the product identical to the input image. Show a man in his early 30s in casual athletic wear lacing up this shoe on his foot while sitting on a city park bench at golden hour, sweat on his skin, real hands with natural detail, blurred green park background, motivated warm side light with a soft shadow, shot on 85mm f/2.0, candid documentary lifestyle photograph, photorealistic, no AI artifacts."`}

${scene3Override
  ? `Instruction 2 — Realistic scale reference: Keep the product visually identical to the input image. ${scene3Override}`
  : `Instruction 2 — Realistic scale reference: Keep the product visually identical to the input image, and show a real person's hands (or the person next to it) holding or interacting with the product to communicate its true real-world size and proportions. Use a clean but NOT artificial setting — a simple real surface or softly blurred everyday background, never an empty CGI void. Demand realistic human hands with correct anatomy, natural skin texture and accurate scale relative to the product, soft natural lighting with a grounded contact shadow. Shoot it like a real close-up product photo on a 50mm lens at f/2.8, photorealistic, no AI artifacts. The product must look identical to the input image and its size must read clearly. Example: "Keep the product identical to the input image. Show a woman's hands with natural skin texture holding this product at chest height over a softly blurred light wooden desk, neutral daylight from a window, soft contact shadow, correct real-life scale, shot on 50mm f/2.8, photorealistic close-up, no AI artifacts, the product clearly showing its real size."`}

Return ONLY valid JSON with this exact structure, no markdown, no explanations:
{"prompts": ["instruction0", "instruction1", "instruction2"], "productDescription": "concise visual description of the product (colors, materials, key features)"}`;

  const parts: Part[] = [];
  if (base64Data) {
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: cleanBase64 } });
  }
  parts.push({ text: prompt });

  const parsed = await generateJson(parts);

  if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== 3) {
    throw new Error('A IA não retornou 3 prompts no formato esperado.');
  }

  return { prompts: parsed.prompts, productDescription: parsed.productDescription || '' };
}

export default function ImageSearchModal({ isOpen, onClose, product, uid, onSave, credits, getCreditCost, consumeCredit, existingCategories = [], defaultAspectRatio = '1:1' }: ImageSearchModalProps) {
  const [step, setStep] = useState<'search' | 'ambient'>('search');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<string>(defaultAspectRatio);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ambientImages, setAmbientImages] = useState<string[]>([]);
  const [imagePrompts, setImagePrompts] = useState<string[]>(['', '', '']);
  const [imageRegenerating, setImageRegenerating] = useState<boolean[]>([false, false, false]);
  const [tokenUsage, setTokenUsage] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const [productDescription, setProductDescription] = useState('');
  // Confirmação de consumo de créditos antes de gerar/regenerar imagens.
  const [confirmAction, setConfirmAction] = useState<{ type: 'ambient' } | { type: 'regenerate'; index: number } | null>(null);

  useEffect(() => {
    if (isOpen && product && step === 'search') {
      setSelectedImageUrl(product._selectedImage || '');
      setAmbientImages(product._ambientImages || []);
      setImagePrompts(['', '', '']);
      setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
      setProductDescription('');
    }
  }, [isOpen, product]);

  const handleOpenGoogleImages = () => {
    if (!product) return;
    const query = `${product['Descrição']} ${product['Marca'] || ''}`.trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
    window.open(url, '_blank');
  };

  const callGenerateImage = async (base64Data: string, mimeType: string, prompt: string, _imageIndex: number, retries = 2): Promise<string | null> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await generateImage(base64Data, mimeType, prompt, aspectRatio);
      } catch (error: any) {
        const isQuotaError = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
        if (isQuotaError && attempt < retries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw error;
      }
    }
    return null;
  };

  const handleGenerateAmbient = () => {
    if (!selectedImageUrl || !product) return;
    if (credits < getCreditCost(CREDIT_ACTIONS.ambientImage.key)) {
      alert('Você não possui créditos suficientes. Por favor, adicione mais créditos.');
      return;
    }
    // Pede confirmação do custo em créditos antes de gerar.
    setConfirmAction({ type: 'ambient' });
  };

  const runGenerateAmbient = async () => {
    if (!selectedImageUrl || !product) return;

    setIsGenerating(true);
    setStep('ambient');

    try {
      // 1. Process image first — needed by Gemini for visual analysis
      const { base64Data, mimeType } = await fetchAndProcessImage(selectedImageUrl);

      // 2. Resolve per-category custom scenes if feature is enabled
      const categoryPromptsEnabled = localStorage.getItem('enableCategoryImagePrompts') === 'true';
      const customScenes = categoryPromptsEnabled && product.categoryId
        ? getEffectiveImagePrompts(product.categoryId, existingCategories) ?? undefined
        : undefined;

      // 3. Generate prompts WITH the product image so Gemini can visually anchor them
      const { prompts, productDescription: desc } = await generateAmbientPrompts(
        {
          productName: product['Descrição'] || '',
          brand: product['Marca'] || '',
          category: product['Categoria'] || '',
          description: product['Descrição complementar'] || '',
        },
        base64Data,
        mimeType,
        customScenes,
      );
      setImagePrompts(prompts);
      if (desc) setProductDescription(desc);

      // 4. Generate all 3 ambient images (retry/backoff handled inside callGenerateImage)
      const validImages: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const imgData = await callGenerateImage(base64Data, mimeType, prompts[i], i);
          validImages.push(imgData || '');
        } catch (genError: any) {
          const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(genError.message || "");
          if (isQuota && validImages.length > 0) break;
          if (i === 0) throw genError;
          validImages.push('');
        }
      }

      if (validImages.every(img => !img)) throw new Error("Não foi possível gerar nenhuma imagem.");
      setAmbientImages(validImages);

      // Debit only after at least one image was generated successfully.
      await consumeCredit(CREDIT_ACTIONS.ambientImage, product['Descrição'], product['Código (SKU)']);
      trackImageGenerated({ type: 'ambient', sku: product['Código (SKU)'] as string });

    } catch (error: any) {
      console.error("Erro ao gerar ambientações:", error);
      const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
      alert(isQuota
        ? "O limite de uso da IA foi atingido (Erro 429). Aguarde um momento e tente novamente."
        : `Erro: ${error.message || "Erro ao processar a imagem."}`
      );
      setStep('search');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateImage = (index: number) => {
    if (!selectedImageUrl || !product) return;
    if (credits < getCreditCost(CREDIT_ACTIONS.regenerateImage.key)) {
      alert('Você não possui créditos suficientes. Por favor, adicione mais créditos.');
      return;
    }
    // Pede confirmação do custo em créditos antes de regenerar.
    setConfirmAction({ type: 'regenerate', index });
  };

  const runRegenerateImage = async (index: number) => {
    if (!selectedImageUrl || !product) return;

    setImageRegenerating(prev => { const n = [...prev]; n[index] = true; return n; });

    try {
      const { base64Data, mimeType } = await fetchAndProcessImage(selectedImageUrl);
      const imgData = await callGenerateImage(base64Data, mimeType, imagePrompts[index], index);
      if (imgData) {
        setAmbientImages(prev => { const n = [...prev]; n[index] = imgData; return n; });
        // Debit only after the image was regenerated successfully.
        await consumeCredit(CREDIT_ACTIONS.regenerateImage, product['Descrição'], product['Código (SKU)']);
        trackImageGenerated({ type: 'regenerate', sku: product['Código (SKU)'] as string });
      }
    } catch (error: any) {
      const isQuota = /429|RESOURCE_EXHAUSTED|quota|limite/.test(error.message || "");
      alert(isQuota
        ? "Limite de uso da IA atingido. Aguarde e tente novamente."
        : `Erro ao regenerar imagem: ${error.message}`
      );
    } finally {
      setImageRegenerating(prev => { const n = [...prev]; n[index] = false; return n; });
    }
  };

  // Uploads an image (data URL or external URL) to Firebase Storage and returns a public download URL.
  // External URLs are fetched/normalized client-side first (handles CORS via proxies in fetchAndProcessImage).
  const uploadImage = async (base64OrUrl: string, filename: string): Promise<string> => {
    try {
      // Already a persistent Firebase Storage URL — nothing to re-upload.
      if (base64OrUrl.includes('firebasestorage.googleapis.com') || base64OrUrl.includes('storage.googleapis.com')) {
        return base64OrUrl;
      }

      let dataUrl: string;
      if (base64OrUrl.startsWith('data:')) {
        dataUrl = base64OrUrl;
      } else {
        // External URL (e.g. TinyERP S3): fetch + normalize to JPEG base64 via proxies.
        const { base64Data, mimeType } = await fetchAndProcessImage(base64OrUrl);
        dataUrl = `data:${mimeType};base64,${base64Data}`;
      }

      const safeName = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
      const path = `users/${uid}/product-images/${safeName}_${Date.now()}.${ext}`;
      const storageRef = ref(storage, path);

      await uploadString(storageRef, dataUrl, 'data_url');
      return `https://storage.googleapis.com/${storageRef.bucket}/${storageRef.fullPath}`;
    } catch (error) {
      console.error('Error uploading image to Firebase Storage:', error);
      throw error;
    }
  };

  const handleSave = async () => {
    if (product && selectedImageUrl) {
      setIsSaving(true);
      try {
        const finalSelectedImage = await uploadImage(selectedImageUrl, product['Código (SKU)'] || 'produto');
        const finalAmbientImages = await Promise.all(
          ambientImages.map((img, idx) =>
            img ? uploadImage(img, `${product['Código (SKU)'] || 'produto'}_ambientacao_${idx + 1}`) : Promise.resolve('')
          )
        );
        onSave(product._id, finalSelectedImage, finalAmbientImages.filter(Boolean), tokenUsage.totalTokens > 0 ? tokenUsage : undefined);
        handleClose();
      } catch (error: any) {
        console.error('Erro ao salvar imagens:', error);
        alert(`Erro ao salvar as imagens no Firebase Storage: ${error?.message || 'erro desconhecido'}. Verifique se o Firebase Storage está habilitado e se as regras permitem upload.`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleClose = () => {
    setStep('search');
    setSelectedImageUrl('');
    setAmbientImages([]);
    setImagePrompts(['', '', '']);
    setImageRegenerating([false, false, false]);
    setProductDescription('');
    setConfirmAction(null);
    onClose();
  };

  const handleConfirmAction = () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    if (action.type === 'ambient') {
      runGenerateAmbient();
    } else {
      runRegenerateImage(action.index);
    }
  };

  if (!isOpen || !product) return null;

  const confirmCost = confirmAction
    ? getCreditCost(confirmAction.type === 'ambient' ? CREDIT_ACTIONS.ambientImage.key : CREDIT_ACTIONS.regenerateImage.key)
    : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-gray-900/60" onClick={() => setConfirmAction(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                <ImageIcon className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-gray-900">
                {confirmAction.type === 'ambient' ? 'Gerar imagens de ambientação' : 'Regenerar imagem'}
              </h4>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Esta ação consumirá <span className="font-bold text-gray-900">{confirmCost} {confirmCost === 1 ? 'crédito' : 'créditos'}</span>.
              Você possui <span className="font-bold text-gray-900">{credits}</span>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmAction}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={handleClose} />

        <div className="relative inline-block w-full max-w-4xl p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900">
              {step === 'search' ? 'Imagem do Produto' : 'Ambientações Geradas'}
            </h3>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-500 focus:outline-none">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-500">
              <strong>Produto:</strong> {product['Descrição']} <br />
              <strong>SKU:</strong> {product['Código (SKU)']} | <strong>Marca:</strong> {product['Marca']}
            </p>
          </div>

          {step === 'search' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                <Search className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-blue-900">Como adicionar uma imagem:</h4>
                  <ol className="mt-1 text-sm text-blue-800 list-decimal list-inside space-y-1">
                    <li>Clique no botão abaixo para buscar o produto no Google Imagens.</li>
                    <li>Encontre a imagem desejada, clique com o botão direito e selecione <strong>"Copiar endereço da imagem"</strong>.</li>
                    <li>Cole a URL no campo abaixo.</li>
                  </ol>
                  <button
                    onClick={handleOpenGoogleImages}
                    className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Buscar no Google Imagens
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  URL da Imagem
                </label>
                <input
                  type="url"
                  id="imageUrl"
                  value={selectedImageUrl}
                  onChange={(e) => setSelectedImageUrl(e.target.value)}
                  placeholder="https://exemplo.com/imagem.jpg"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>

              {selectedImageUrl && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Pré-visualização:</p>
                  <div className="relative w-48 h-48 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <img
                      src={selectedImageUrl}
                      alt="Pré-visualização"
                      className="w-full h-full object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/200?text=Erro+ao+carregar'; }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={!selectedImageUrl || isSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : 'Salvar Apenas Imagem'}
                </button>
                <button
                  onClick={handleGenerateAmbient}
                  disabled={!selectedImageUrl}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ImageIcon className="w-4 h-4" />
                  Gerar Ambientações
                </button>
              </div>

              {/* Aspect Ratio Selector */}
              <div className="pt-3 border-t border-gray-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-gray-700">Formato:</span>
                  {['1:1', '4:3', '3:4', '16:9', '9:16'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAspectRatio(r)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-all ${
                        aspectRatio === r
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    Padrão configurável em Configurações → Imagens
                  </span>
                </div>
              </div>
            </div>
          )}

          {step === 'ambient' && (
            <div className="space-y-6">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
                  <p className="text-gray-600">A IA está analisando o produto e gerando 3 imagens personalizadas...</p>
                  <p className="text-sm text-gray-400 mt-2">Isso pode levar alguns segundos.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {IMAGE_TITLES.map((title, idx) => (
                      <div key={idx} className="flex flex-col gap-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>

                        <div className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm bg-gray-50">
                          {ambientImages[idx] ? (
                            <img src={ambientImages[idx]} alt={title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                              <ImageIcon className="w-10 h-10" />
                            </div>
                          )}
                          {imageRegenerating[idx] && (
                            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                            </div>
                          )}
                        </div>

                        <textarea
                          value={imagePrompts[idx]}
                          onChange={(e) => setImagePrompts(prev => { const n = [...prev]; n[idx] = e.target.value; return n; })}
                          rows={3}
                          placeholder="Sugerir um novo prompt..."
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 resize-none"
                        />

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRegenerateImage(idx)}
                            disabled={imageRegenerating[idx] || imageRegenerating.some(r => r)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Gerar novamente
                          </button>
                          {ambientImages[idx] && (
                            <a
                              href={ambientImages[idx]}
                              download={`${product['Código (SKU)'] || 'produto'}_${title.toLowerCase().replace(/ /g, '_')}.png`}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                              <Download className="w-3 h-3" />
                              Baixar
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
                    <button
                      onClick={() => setStep('search')}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : 'Salvar Imagens no Produto'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
